// Kampfreaktionskarten (Task 8): Karten, die einen LAUFENDEN Kampf
// veraendern - Kumpel verdoppelt das Monster, Wanderndes Monster/Illusion
// haengen ein Handmonster an bzw. tauschen eines aus, Hilf mir nimmt einen
// Gegenstand von einem beliebigen Spieler, Ueberfalltrank gibt den Kampf an
// eine andere Person weiter. Sie reiten alle auf der bestehenden
// combatAllReady-Schranke statt ein eigenes Fenster zu brauchen.
const assert = require('assert');
const {
  ALL_CARDS, combatTotals, handlePlayCombatCard, handleResolveCardChoice,
  handleResolveCardTarget, handleAttemptFlee, handleAckConsequence, resolveCombatWin,
  newEquipped, handleEquipItem, equippedItemIds, COMBAT_REACTION_CARDS,
  handleSetCombatReady, scheduleBotActionsIfNeeded,
} = require('../server.js');

function byName(name) {
  const c = ALL_CARDS.find((x) => x.name === name);
  assert.ok(c, `Karte "${name}" nicht gefunden`);
  return c;
}
function makePlayer(id, extra) {
  return Object.assign({
    id, name: id.toUpperCase(), level: 5, hand: [], races: [], classes: [],
    powerGroups: [], raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), attachments: { cheatedItemId: null }, activeCurses: [],
    isBot: false, connected: true,
  }, extra || {});
}

const treasureFiller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 20).map((c) => c.id);

function makeRoom(players, extra) {
  return Object.assign({
    code: 'T', players, turnIndex: 0, turnPhase: 'kampf', combatHappenedThisTurn: true,
    doorDeck: [], doorDiscard: [], treasureDeck: treasureFiller.slice(), treasureDiscard: [],
    revealedDoorCard: null, doorReveal: null, dieRoll: null,
    combat: null, pendingConsequence: null, pendingCardAction: null, pendingRoll: null,
    winner: null, phase: 'playing', logs: [], lastActivity: Date.now(),
    cleanupTimer: null, botTimer: null, settings: { sets: {} },
  }, extra || {});
}

function done(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  if (room.botTimer) clearTimeout(room.botTimer);
  return room;
}

function combatRoom(players, monsterIds, combatOverrides) {
  return makeRoom(players, {
    combat: Object.assign({
      actorId: players[0].id, helperId: null, helperPending: null, monsterIds,
      actorModifier: 0, monsterModifier: 0, mustFlee: false, fromHand: false,
      classDiscards: {}, fleeBonus: 0, treasureDelta: 0, ready: {}, readySignature: null,
    }, combatOverrides || {}),
  });
}

function run() {
  // -------------------------------------------------------------------
  // Kartennamen stimmen mit den Rohdaten ueberein
  // -------------------------------------------------------------------
  ['KUMPEL', 'WANDERNDES MONSTER', 'ILLUSION', 'HILF MIR', 'ÜBERFALLTRANK'].forEach((n) => {
    assert.ok(byName(n) && COMBAT_REACTION_CARDS[n], `${n} muss in COMBAT_REACTION_CARDS stehen`);
  });

  // -------------------------------------------------------------------
  // KUMPEL: verdoppelt Stufe UND Schatzzahl - und darf beim Ablegen nicht
  // doppelt auf den Stapel wandern (die Falle aus dem Auftrag).
  // -------------------------------------------------------------------
  {
    const goblin = byName('LAHMER GOBLIN'); // Stufe 1, 1 Schatz
    const kumpel = byName('KUMPEL');
    const a = makePlayer('a', { hand: [kumpel.id] });
    const room = combatRoom([a, makePlayer('b')], [goblin.id]);
    const vorher = combatTotals(room).monsterStrength;
    handlePlayCombatCard(room, 'a', kumpel.id);
    assert.strictEqual(room.combat.monsterIds.length, 2, 'ein zweites Monster muss dazukommen');
    assert.deepStrictEqual(room.combat.monsterIds, [goblin.id, goblin.id], 'dieselbe Karten-ID, zweimal');
    assert.strictEqual(combatTotals(room).monsterStrength, vorher * 2, 'gleiche Stufe noch einmal');
    assert.ok(!a.hand.includes(kumpel.id), 'die Karte ist verbraucht');
    assert.ok(room.doorDiscard.includes(kumpel.id), 'Kumpel selbst landet im Ablagestapel');

    resolveCombatWin(room);
    assert.strictEqual(a.level, 5 + 2, '1 Stufe pro besiegtem Monster, also 2 fuer beide Kopien');
    assert.strictEqual(a.hand.length, 2, '1 Schatz pro Monster, also 2 fuer beide Kopien');
    const imAblagestapel = room.doorDiscard.filter((id) => id === goblin.id);
    assert.strictEqual(imAblagestapel.length, 1,
      'die verdoppelte ID darf beim Ablegen nur EINMAL auf den Stapel wandern');
    done(room);
  }

  // -------------------------------------------------------------------
  // WANDERNDES MONSTER: haengt ein Monster von der Hand an den Kampf an.
  // -------------------------------------------------------------------
  {
    const goblin = byName('LAHMER GOBLIN'); // Stufe 1
    const orks = byName('3.872 ORKS'); // Stufe 10
    const wandernd = byName('WANDERNDES MONSTER');
    const a = makePlayer('a', { hand: [wandernd.id, orks.id] });
    const room = combatRoom([a, makePlayer('b')], [goblin.id]);
    handlePlayCombatCard(room, 'a', wandernd.id);
    assert.ok(!a.hand.includes(wandernd.id), 'die Karte ist verbraucht');
    assert.ok(room.doorDiscard.includes(wandernd.id));
    assert.strictEqual(room.pendingCardAction.kind, 'choice', 'welches Handmonster, ist eine Wahl');
    const optionId = room.pendingCardAction.options.find((o) => o.label === orks.name).id;
    handleResolveCardChoice(room, 'a', optionId);
    assert.deepStrictEqual(room.combat.monsterIds, [goblin.id, orks.id], 'das Handmonster schliesst sich an');
    assert.ok(!a.hand.includes(orks.id), 'das Monster kommt von der Hand');
    assert.strictEqual(combatTotals(room).monsterStrength, 1 + 10, 'Kampfstaerken addiert');
    assert.strictEqual(room.pendingCardAction, null, 'Wahl ist danach abgeraeumt');
    done(room);
  }

  // -------------------------------------------------------------------
  // WANDERNDES MONSTER / ILLUSION ohne Monster auf der Hand: Karte bleibt
  // liegen (kein Verbrauch, keine Wahl).
  // -------------------------------------------------------------------
  {
    const goblin = byName('LAHMER GOBLIN');
    const wandernd = byName('WANDERNDES MONSTER');
    const a = makePlayer('a', { hand: [wandernd.id] });
    const room = combatRoom([a, makePlayer('b')], [goblin.id]);
    handlePlayCombatCard(room, 'a', wandernd.id);
    assert.ok(a.hand.includes(wandernd.id), 'ohne Handmonster bleibt die Karte liegen');
    assert.strictEqual(room.pendingCardAction, null);
    assert.strictEqual(room.combat.monsterIds.length, 1);
    done(room);
  }

  // -------------------------------------------------------------------
  // ILLUSION: tauscht ein Monster gegen eines von der Hand - der alte
  // Monster-Verstaerker (monsterModifier) verfaellt mit dem alten Monster.
  // -------------------------------------------------------------------
  {
    const orks = byName('3.872 ORKS');
    const goblin = byName('LAHMER GOBLIN');
    const illusion = byName('ILLUSION');
    const a = makePlayer('a', { hand: [illusion.id, goblin.id] });
    const room = combatRoom([a, makePlayer('b')], [orks.id], { monsterModifier: 7 });
    handlePlayCombatCard(room, 'a', illusion.id);
    const optionId = room.pendingCardAction.options.find((o) => o.label === goblin.name).id;
    handleResolveCardChoice(room, 'a', optionId);
    assert.deepStrictEqual(room.combat.monsterIds, [goblin.id], 'das alte Monster ist ersetzt');
    assert.ok(room.doorDiscard.includes(orks.id), 'das alte Monster landet im Ablagestapel');
    assert.strictEqual(room.combat.monsterModifier, 0,
      'Verstaerker galten dem alten Monster und verfallen mit ihm');
    done(room);
  }

  // -------------------------------------------------------------------
  // HILF MIR: nimmt den Gegenstand mit dem hoechsten Bonus von einer
  // beliebigen Person.
  // -------------------------------------------------------------------
  {
    const ruestung = byName('LEDERRÜSTUNG');
    const hilfMir = byName('HILF MIR');
    const a = makePlayer('a', { hand: [hilfMir.id] });
    const b = makePlayer('b', { hand: [ruestung.id] });
    const room = combatRoom([a, b], [byName('LAHMER GOBLIN').id]);
    handleEquipItem(room, 'b', ruestung.id);
    assert.ok(equippedItemIds(b).includes(ruestung.id), 'Testvoraussetzung: B traegt die Ruestung');
    handlePlayCombatCard(room, 'a', hilfMir.id);
    assert.strictEqual(room.pendingCardAction.kind, 'targetPlayer');
    handleResolveCardTarget(room, 'a', 'b');
    assert.ok(!equippedItemIds(b).includes(ruestung.id), 'B traegt die Ruestung nicht mehr');
    assert.ok(a.hand.includes(ruestung.id), 'A haelt die Ruestung jetzt auf der Hand');
    assert.strictEqual(room.pendingCardAction, null);
    done(room);
  }

  // WANDERNDES MONSTER/ILLUSION brauchen ein Monster auf der Hand ("Spiele
  // diese Karte MIT EINEM MONSTER VON DEINER HAND"). Ohne eines bleibt die
  // Karte liegen - und es darf auch keine Karten-Animation dafuer geben.
  {
    const wandernd = byName('WANDERNDES MONSTER');
    const a = makePlayer('a', { hand: [wandernd.id] }); // kein Monster dabei
    const room = combatRoom([a, makePlayer('b')], [byName('LAHMER GOBLIN').id]);
    handlePlayCombatCard(room, 'a', wandernd.id);
    assert.ok(a.hand.includes(wandernd.id), 'ohne Handmonster bleibt die Karte liegen');
    assert.strictEqual(room.combat.monsterIds.length, 1, 'es kommt kein Monster dazu');
    assert.ok(!room.cardPlay, 'und es wird keine Karten-Animation ausgeloest');
    assert.deepStrictEqual(COMBAT_REACTION_CARDS['WANDERNDES MONSTER'].brauchtHandmonster, true,
      'der Client erfaehrt die Bedingung ueber diese Kennzeichnung');
    done(room);
  }

  // "Spiele diese Karte, waehrend du dich im Kampf befindest." - anders als
  // KUMPEL/WANDERNDES MONSTER/ILLUSION/UEBERFALLTRANK (die ausdruecklich
  // "wenn jemand (du eingeschlossen!) im Kampf ist" sagen) darf HILF MIR nur
  // spielen, wer selbst kaempft.
  {
    const ruestung = byName('LEDERRÜSTUNG');
    const hilfMir = byName('HILF MIR');
    const a = makePlayer('a');
    const b = makePlayer('b', { hand: [ruestung.id] });
    const c = makePlayer('c', { hand: [hilfMir.id] });   // steht NICHT im Kampf
    const room = combatRoom([a, b, c], [byName('LAHMER GOBLIN').id]);
    handleEquipItem(room, 'b', ruestung.id);
    handlePlayCombatCard(room, 'c', hilfMir.id);
    assert.ok(c.hand.includes(hilfMir.id), 'die Karte bleibt auf der Hand');
    assert.strictEqual(room.pendingCardAction, null, 'und es wird keine Zielauswahl geoeffnet');
    assert.ok(equippedItemIds(b).includes(ruestung.id), 'B behaelt die Ruestung');

    // Als Helferin im selben Kampf geht es dann doch.
    room.combat.helperId = 'c';
    handlePlayCombatCard(room, 'c', hilfMir.id);
    assert.strictEqual(room.pendingCardAction && room.pendingCardAction.kind, 'targetPlayer',
      'wer im Kampf steht, darf sie spielen');
    done(room);
  }

  // -------------------------------------------------------------------
  // ÜBERFALLTRANK: eine andere Person kaempft, aber der urspruengliche
  // Spieler darf danach trotzdem pluendern - der Zug wechselt nie
  // (room.turnIndex bleibt stehen).
  // -------------------------------------------------------------------
  {
    // a) Sieg: B kaempft und gewinnt, A bekommt trotzdem die Pluenderphase.
    const goblin = byName('LAHMER GOBLIN');
    const trank = byName('ÜBERFALLTRANK');
    const a = makePlayer('a', { hand: [trank.id] });
    const b = makePlayer('b');
    const room = combatRoom([a, b], [goblin.id]);
    handlePlayCombatCard(room, 'a', trank.id);
    assert.strictEqual(room.pendingCardAction.kind, 'targetPlayer');
    handleResolveCardTarget(room, 'a', 'b');
    assert.strictEqual(room.combat.actorId, 'b', 'B kaempft jetzt');
    assert.strictEqual(room.combat.originalActorId, 'a', 'A bleibt als urspruengliche Person vermerkt');
    assert.strictEqual(room.turnIndex, 0, 'der Zug wechselt nie - turnIndex bleibt bei A stehen');

    resolveCombatWin(room);
    assert.strictEqual(b.level, 6, 'B (nicht A) bekommt die Siegesstufe');
    assert.ok(b.hand.length >= 1, 'B (nicht A) bekommt den Schatz');
    assert.strictEqual(room.turnPhase, 'pluendern',
      'A bekommt trotzdem die Pluenderphase statt direkt zu "gabe" zu gehen');
    assert.strictEqual(room.players[room.turnIndex].id, 'a', 'currentPlayer ist weiterhin A');
    done(room);
  }
  {
    // b) Niederlage: B kaempft und verliert (misslungene Flucht), A bekommt
    // trotzdem die Pluenderphase, sobald die Konsequenz bestaetigt ist.
    const filzlaus = byName('FILZLAUSE'); // FLEE_IMPOSSIBLE: Flucht ist unmoeglich, Ergebnis eindeutig
    const trank = byName('ÜBERFALLTRANK');
    const a = makePlayer('a', { hand: [trank.id] });
    const b = makePlayer('b');
    const room = combatRoom([a, b], [filzlaus.id]);
    handlePlayCombatCard(room, 'a', trank.id);
    handleResolveCardTarget(room, 'a', 'b');
    room.combat.mustFlee = true;
    handleAttemptFlee(room, 'b', -9); // B ist jetzt die kaempfende Person
    assert.ok(room.pendingConsequence, 'die Konsequenz haengt an B, weil B verloren hat');
    assert.strictEqual(room.pendingConsequence.playerId, 'b');
    handleAckConsequence(room, 'b');
    assert.strictEqual(room.turnPhase, 'pluendern',
      'A bekommt die Pluenderphase, unabhaengig vom Kampfausgang');
    assert.strictEqual(room.players[room.turnIndex].id, 'a', 'currentPlayer ist weiterhin A');
    done(room);
  }
  {
    // c) Fix Round 1, Finding 1 (Regression): der Kampf endet weder durch
    // Sieg noch durch Flucht, sondern durch MAHLZEIT! (endCombatNoLevel ohne
    // thenLoot) - auch dieser Pfad muss c.originalActorId respektieren,
    // sonst landet A faelschlich in "gabe" statt "pluendern".
    const goblin = byName('LAHMER GOBLIN');
    const trank = byName('ÜBERFALLTRANK');
    const mahlzeit = byName('MAHLZEIT!');
    const a = makePlayer('a', { hand: [trank.id] });
    const b = makePlayer('b', { hand: [mahlzeit.id] });
    const room = combatRoom([a, b], [goblin.id]);
    handlePlayCombatCard(room, 'a', trank.id);
    handleResolveCardTarget(room, 'a', 'b');
    assert.strictEqual(room.combat.actorId, 'b', 'B kaempft jetzt');
    handlePlayCombatCard(room, 'b', mahlzeit.id);
    assert.strictEqual(room.combat, null, 'MAHLZEIT! beendet den Kampf sofort');
    assert.strictEqual(room.turnPhase, 'pluendern',
      'A bekommt die Pluenderphase auch ueber den endCombatNoLevel-Pfad (MAHLZEIT!/Traenke/Lampe)');
    assert.strictEqual(room.players[room.turnIndex].id, 'a', 'currentPlayer ist weiterhin A');
    done(room);
  }
  {
    // d) Regression (Bugreport "Ueberfalltrank/Netztroll... Spiel eingefroren"):
    // wird der Kampf per UEBERFALLTRANK an einen BOT weitergegeben, muss der
    // Bot-Scheduler den Kampf trotzdem weiterbringen. scheduleBotActionsIfNeeded
    // ermittelte "wer ist dran" vor dem Fix ueber currentPlayer(room) (= die
    // Person, die gerade AM ZUG ist - hier weiterhin A), nicht ueber
    // room.combat.actorId (nach der Uebergabe: der Bot). Ist der Bot in
    // Wirklichkeit dran, aber "dran" zeigt faelschlich auf den menschlichen
    // Zuginhaber, wird nie ein Bot-Timer eingeplant - der Kampf haengt fuer
    // immer (auch die "Schlimme Dinge" eines spaeter besiegten/verlorenen
    // Monsters wie NETZ-TROLL kommen dadurch nie zustande).
    const goblin = byName('LAHMER GOBLIN');
    const trank = byName('ÜBERFALLTRANK');
    const a = makePlayer('a', { hand: [trank.id] }); // am Zug (turnIndex 0)
    const bot = makePlayer('bot', { isBot: true });
    const room = combatRoom([a, bot], [goblin.id]);
    handlePlayCombatCard(room, 'a', trank.id);
    handleResolveCardTarget(room, 'a', 'bot');
    assert.strictEqual(room.combat.actorId, 'bot', 'der Bot kaempft jetzt anstelle von A');
    assert.strictEqual(room.players[room.turnIndex].id, 'a', 'der Zug bleibt trotzdem bei A');

    // combatReadyRequired verlangt "Bereit" von allen anderen verbundenen,
    // menschlichen Spieler:innen - hier: A (der Bot ist ja jetzt actorId).
    handleSetCombatReady(room, 'a', true);
    scheduleBotActionsIfNeeded(room);
    assert.ok(room.botTimer, 'ein Bot-Timer muss eingeplant werden - der (neue) Kampf-Akteur ist ein Bot');
    done(room);
  }

  console.log('OK - Kampfreaktionen: Kumpel verdoppelt (dedupliziert abgelegt), Wanderndes Monster/' +
    'Illusion haengen Handmonster an bzw. tauschen, Hilf mir nimmt einen Gegenstand, ' +
    'Ueberfalltrank gibt den Kampf weiter und holt die Pluenderphase zur urspruenglichen Person zurueck, ' +
    'und uebergibt ihn an einen Bot, ohne dass der Bot-Scheduler haengen bleibt.');
}

run();
console.log('1/1 Tests erfolgreich (card-combat-reactions.test.js).');
