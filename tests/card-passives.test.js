// Verifiziert die DAUERWIRKUNGEN der Basis-Set-Karten: Effekte, die ohne
// Zutun gelten und deshalb vom Server selbst angewendet werden müssen -
// Fluchschutz, Monster, die bestimmte Munchkins gar nicht angreifen,
// Monsterboni gegen Rassen/Klassen, Weglaufen-Modifikatoren, Bonusstufen
// beim Sieg, Handkartenlimit.
//
// Aufgefallen sind die, weil Schutzsandalen im Spiel wirkungslos waren: der
// Fluch traf trotzdem. Jeder Test hier prüft VERHALTEN (ganze Handler auf
// einem echten Raum-Objekt), nicht nur den Tabelleninhalt - eine Tabelle, die
// nirgends ausgewertet wird, bestünde einen reinen Tabellentest.
const assert = require('assert');
const {
  ALL_CARDS, handleDrawDoor, handleEvaluateCombat, handleAttemptFlee,
  handleRequestHelp, handleUseGuaranteedFlee, combatTotals, handLimit,
  DOOR_OTHER_AS_CURSE, handleUseClassCombatDiscard, classCombatPowerInfo,
  UNDEAD_MONSTERS, handleSetCombatReady, combatReadyRequired, combatAllReady,
  refreshCombatReady, handleSetCombatModifier, handleFleeReroll, handleSellItems, endTurn,
} = require('../server.js');

function findCard(name, category) {
  const c = ALL_CARDS.find((x) => x.name === name && (!category || x.category === category));
  if (!c) throw new Error(`Testkarte nicht gefunden: ${name}`);
  return c;
}

const ELF = findCard('ELF', 'race').id;
const ZWERG = findCard('ZWERG', 'race').id;
const KRIEGER = findCard('KRIEGER', 'class').id;
const DIEB = findCard('DIEB', 'class').id;

function makePlayer(overrides) {
  return Object.assign({
    id: 'p1', name: 'A', level: 5, hand: [], races: [], classes: [], powerGroups: [],
    raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: { head: null, armor: null, feet: null, hands: [null, null] },
  }, overrides || {});
}

// Gefüllter Schatzstapel, damit Siegesschätze/Tuba-Schatz nicht am leeren
// Stapel scheitern und der Ablagestapel nicht neu gemischt werden muss.
const treasureFiller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 20).map((c) => c.id);

function makeRoom(extra) {
  return Object.assign({
    code: 'TEST',
    players: [makePlayer({ id: 'p1', name: 'A' }), makePlayer({ id: 'p2', name: 'B' })],
    turnIndex: 0, turnPhase: 'tuer', combatHappenedThisTurn: false,
    doorDeck: [], doorDiscard: [], treasureDeck: treasureFiller.slice(), treasureDiscard: [],
    revealedDoorCard: null, doorReveal: null, dieRoll: null,
    combat: null, pendingConsequence: null, pendingCardAction: null,
    winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
    settings: { sets: {} },
  }, extra || {});
}

function done(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  if (room.botTimer) clearTimeout(room.botTimer);
  return room;
}

// Zieht genau eine vorgegebene Türkarte.
function drawRoom(cardId, actorOverrides) {
  const room = makeRoom({ doorDeck: [cardId] });
  Object.assign(room.players[0], actorOverrides || {});
  handleDrawDoor(room, 'p1');
  return done(room);
}

// Raum mitten im Kampf gegen ein benanntes Monster.
function combatRoom(monsterName, actorOverrides, combatOverrides) {
  const m = findCard(monsterName, 'monster');
  const room = makeRoom({
    turnPhase: 'kampf', combatHappenedThisTurn: true,
    combat: Object.assign({
      actorId: 'p1', helperId: null, helperPending: null, monsterIds: [m.id],
      actorModifier: 0, monsterModifier: 0, mustFlee: false, fromHand: false,
    }, combatOverrides || {}),
  });
  Object.assign(room.players[0], actorOverrides || {});
  return { room, m };
}

function lastLog(room) {
  return room.logs.length ? room.logs[room.logs.length - 1].text : '';
}

function run() {
  // -------------------------------------------------------------------
  // SCHUTZSANDALEN - der gemeldete Fehler: "Flüche, die du ziehst, nachdem
  // du eine Tür eintrittst, haben keine Wirkung."
  // -------------------------------------------------------------------
  const sandalen = findCard('SCHUTZSANDALEN', 'item');
  const fluch = findCard('VERLIERE 1 STUFE');
  assert.ok(DOOR_OTHER_AS_CURSE.has(fluch.name), 'Testvoraussetzung: "VERLIERE 1 STUFE" läuft als Fluch auf');

  const ungeschuetzt = drawRoom(fluch.id, { level: 5 });
  assert.ok(ungeschuetzt.pendingConsequence, 'ohne Schutzsandalen muss der Fluch ganz normal auflaufen');
  assert.strictEqual(ungeschuetzt.players[0].level, 4, 'ohne Schutz kostet "VERLIERE 1 STUFE" eine Stufe');

  const geschuetzt = drawRoom(fluch.id, {
    level: 5, equipped: { head: null, armor: null, feet: sandalen.id, hands: [null, null] },
  });
  assert.strictEqual(geschuetzt.pendingConsequence, null, 'mit Schutzsandalen darf gar keine Fluch-Konsequenz auflaufen');
  assert.strictEqual(geschuetzt.players[0].level, 5, 'mit Schutzsandalen bleibt die Stufe unverändert');
  assert.ok(geschuetzt.doorDiscard.includes(fluch.id), 'der wirkungslose Fluch landet trotzdem auf dem Ablagestapel');
  assert.strictEqual(geschuetzt.turnPhase, 'aerger', 'nach dem abgewehrten Fluch geht es normal in Phase 2');
  assert.ok(/Schutzsandalen/i.test(lastLog(geschuetzt)), 'der Verlauf muss den Grund nennen');

  // Gegenprobe: die Sandalen dürfen nur im Schuh-Slot wirken, nicht als
  // beliebige Handkarte.
  const nurAufDerHand = drawRoom(fluch.id, { level: 5, hand: [sandalen.id] });
  assert.ok(nurAufDerHand.pendingConsequence, 'Schutzsandalen auf der Hand schützen nicht - sie müssen getragen werden');

  // -------------------------------------------------------------------
  // Monster, die bestimmte Munchkins nicht angreifen
  // -------------------------------------------------------------------
  const drache = findCard('PLUTONIUMDRACHE', 'monster');
  const schwach = drawRoom(drache.id, { level: 5 });
  assert.strictEqual(schwach.combat, null, '"Greift niemanden mit Stufe 5 oder niedriger an" - kein Kampf auf Stufe 5');
  assert.ok(schwach.doorDiscard.includes(drache.id), 'das vorbeiziehende Monster landet auf dem Ablagestapel');
  assert.strictEqual(schwach.turnPhase, 'aerger', 'der Zug läuft mit Phase 2 weiter');

  const stark = drawRoom(drache.id, { level: 6 });
  assert.ok(stark.combat, 'ab Stufe 6 greift der Plutoniumdrache an');

  // KRAKZILLA: "Greift niemanden mit Stufe 4 oder niedriger an, AUSSER Elfen."
  const krakzilla = findCard('KRAKZILLA', 'monster');
  assert.strictEqual(drawRoom(krakzilla.id, { level: 4 }).combat, null, 'Krakzilla verschont Nicht-Elfen auf Stufe 4');
  assert.ok(drawRoom(krakzilla.id, { level: 4, races: [ELF] }).combat, 'Elfen greift Krakzilla auch auf Stufe 4 an');

  // ANWALT: "Greift keinen Dieb an (berufliche Höflichkeit)."
  const anwalt = findCard('ANWALT', 'monster');
  assert.strictEqual(drawRoom(anwalt.id, { classes: [DIEB] }).combat, null, 'der Anwalt greift keinen Dieb an');
  assert.ok(drawRoom(anwalt.id, {}).combat, 'ohne Dieb-Klasse greift der Anwalt an');

  // -------------------------------------------------------------------
  // Monsterboni gegen Rassen/Klassen
  // -------------------------------------------------------------------
  const sauger = combatRoom('GESICHTSSAUGER', { level: 5 });
  assert.strictEqual(combatTotals(sauger.room).monsterStrength, sauger.m.level,
    'ohne Elf im Kampf bleibt der Gesichtssauger auf seiner gedruckten Stufe');
  const saugerElf = combatRoom('GESICHTSSAUGER', { level: 5, races: [ELF] });
  assert.strictEqual(combatTotals(saugerElf.room).monsterStrength, saugerElf.m.level + 6,
    '"+6 gegen Elfen" muss automatisch auf die Monsterstärke kommen');

  // Der Bonus gilt auch, wenn erst die Helfer:in die Rasse hat.
  const saugerHelfer = combatRoom('GESICHTSSAUGER', { level: 5 }, { helperId: 'p2' });
  saugerHelfer.room.players[1].races = [ELF];
  assert.strictEqual(combatTotals(saugerHelfer.room).monsterStrength, saugerHelfer.m.level + 6,
    'ein Elf als Helfer:in löst den Monsterbonus ebenfalls aus');

  // KRAKZILLA: "Elfen haben -4!" ist derselbe Mechanismus.
  const krak = combatRoom('KRAKZILLA', { level: 5, races: [ELF] });
  assert.strictEqual(combatTotals(krak.room).monsterStrength, krak.m.level + 4, 'Krakzilla: "Elfen haben -4!"');

  // -------------------------------------------------------------------
  // Monster, die die Kampfrechnung verändern
  // -------------------------------------------------------------------
  const ruestung = findCard('MITHRIL-RÜSTUNG', 'item'); // +3
  const equipMithril = { head: null, armor: ruestung.id, feet: null, hands: [null, null] };

  const ghoule = combatRoom('GEMEINE GHOULE', { level: 7, equipped: equipMithril });
  assert.strictEqual(combatTotals(ghoule.room).playerStrength, 7,
    '"kämpfe nur mit deiner Charakterstufe" - Ausrüstungsboni zählen gegen die Gemeinen Ghoule nicht');

  const versicherung = combatRoom('VERSICHERUNGSVERTRETER', { level: 7, equipped: equipMithril });
  assert.strictEqual(combatTotals(versicherung.room).playerStrength, 3,
    '"Deine Stufe zählt nicht im Kampf" - nur die Boni zählen');

  // Gegenprobe an einem Monster ohne Sonderregel: beides zusammen.
  const normal = combatRoom('LAHMER GOBLIN', { level: 7, equipped: equipMithril });
  assert.strictEqual(combatTotals(normal.room).playerStrength, 10, 'normalerweise zählen Stufe UND Boni');

  // PAVILLON: "Niemand kann dir helfen."
  const pavillon = combatRoom('PAVILLON', { level: 5 });
  handleRequestHelp(pavillon.room, 'p1', 'p2');
  done(pavillon.room);
  assert.strictEqual(pavillon.room.combat.helperPending, null, 'gegen den Pavillon darf keine Hilfe angefragt werden');

  const goblinHelp = combatRoom('LAHMER GOBLIN', { level: 5 });
  handleRequestHelp(goblinHelp.room, 'p1', 'p2');
  done(goblinHelp.room);
  assert.ok(goblinHelp.room.combat.helperPending, 'bei normalen Monstern bleibt die Hilfe-Anfrage möglich');

  // -------------------------------------------------------------------
  // KRIEGER gewinnt Gleichstände
  // -------------------------------------------------------------------
  const goblin = findCard('LAHMER GOBLIN', 'monster');
  const tieWarrior = combatRoom('LAHMER GOBLIN', { level: goblin.level, classes: [KRIEGER] });
  handleEvaluateCombat(tieWarrior.room, 'p1');
  done(tieWarrior.room);
  assert.strictEqual(tieWarrior.room.combat, null, 'Krieger gewinnen den Gleichstand - kein Fliehen nötig');
  assert.strictEqual(tieWarrior.room.players[0].level, goblin.level + 1, 'der gewonnene Gleichstand bringt die Stufe');

  const tiePlain = combatRoom('LAHMER GOBLIN', { level: goblin.level });
  handleEvaluateCombat(tiePlain.room, 'p1');
  done(tiePlain.room);
  assert.ok(tiePlain.room.combat && tiePlain.room.combat.mustFlee, 'ohne Krieger verliert der Gleichstand weiterhin');

  // -------------------------------------------------------------------
  // Weglaufen: feste Modifikatoren, Sperren, Strafen
  // -------------------------------------------------------------------
  function flee(monsterName, actorOverrides) {
    const { room } = combatRoom(monsterName, actorOverrides, { mustFlee: true });
    handleAttemptFlee(room, 'p1', 0);
    return done(room);
  }

  const stiefel = findCard('STIEFEL ZUM ECHT SCHNELLEN DAVONLAUFEN', 'item');
  assert.strictEqual(flee('LAHMER GOBLIN', {}).dieRoll.mod, 1,
    'Lahmer Goblin: "+1 auf Weglaufen" muss automatisch zählen');
  assert.strictEqual(flee('LAHMER GOBLIN', { races: [ELF] }).dieRoll.mod, 2,
    'Elf (+1) und Goblin (+1) addieren sich');
  assert.strictEqual(flee('SCHNECKEN AUF SPEED', {}).dieRoll.mod, -2,
    'Schnecken auf Speed: "-2 auf Weglaufen"');
  assert.strictEqual(flee('SCHNECKEN AUF SPEED', {
    equipped: { head: null, armor: null, feet: stiefel.id, hands: [null, null] },
  }).dieRoll.mod, 0, 'Weglaufstiefel (+2) heben den Schnecken-Malus (-2) auf');

  // FILZLAUSE: "Denen kannst du nicht entkommen!"
  const laeuse = flee('FILZLAUSE', {});
  assert.strictEqual(laeuse.dieRoll.success, false, 'vor den Filzläusen gibt es kein Entkommen - egal was gewürfelt wird');
  assert.ok(laeuse.pendingConsequence, 'die gescheiterte Flucht löst die Schlimmen Dinge aus');

  // TOPFPFLANZE: "Keine. Automatische Flucht."
  const topf = flee('TOPFPFLANZE', {});
  assert.strictEqual(topf.dieRoll.success, true, 'vor der Topfpflanze gelingt die Flucht immer');
  assert.strictEqual(topf.pendingConsequence, null, 'automatische Flucht darf keine Schlimmen Dinge auslösen');

  // MR. BONES: "Auch bei einer erfolgreichen Flucht verlierst du 1 Stufe."
  // Mit +9 manuellem Modifikator ist der Wurf garantiert erfolgreich.
  const bones = combatRoom('MR. BONES', { level: 5 }, { mustFlee: true });
  handleAttemptFlee(bones.room, 'p1', 9);
  done(bones.room);
  assert.strictEqual(bones.room.dieRoll.success, true, 'Testvoraussetzung: der Wurf gelingt');
  assert.strictEqual(bones.room.players[0].level, 4, 'Mr. Bones kostet auch bei gelungener Flucht 1 Stufe');

  // TUBA DER VERZAUBERUNG: Schatz auf dem Weg nach draußen.
  const tuba = findCard('TUBA DER VERZAUBERUNG', 'item');
  const tubaRoom = combatRoom('LAHMER GOBLIN', {
    level: 5, equipped: { head: null, armor: null, feet: null, hands: [tuba.id, null] },
  }, { mustFlee: true });
  const handVorher = tubaRoom.room.players[0].hand.length;
  handleAttemptFlee(tubaRoom.room, 'p1', 9);
  done(tubaRoom.room);
  assert.strictEqual(tubaRoom.room.dieRoll.mod, 9 + 3 + 1, 'Tuba (+3) und Goblin (+1) kommen zum manuellen Wert dazu');
  assert.strictEqual(tubaRoom.room.players[0].hand.length, handVorher + 1,
    'nach gelungener Flucht bringt die Tuba eine verdeckte Schatzkarte');

  // -------------------------------------------------------------------
  // HALBLING - war komplett wirkungslos: beide Rassenkraefte fehlten, und
  // die Monsterboni der Zusatz-Sets, die ausdruecklich Halblinge nennen,
  // standen nicht in MONSTER_TRAIT_BONUS.
  // -------------------------------------------------------------------
  const HALBLING = findCard('HALBLING', 'race').id;

  // "+2 gegen Halblinge." (Affenbande, Clerical Errors)
  const affen = combatRoom('AFFENBANDE', { level: 1, races: [HALBLING] });
  const affenTotals = combatTotals(affen.room);
  done(affen.room);
  const affenOhne = combatRoom('AFFENBANDE', { level: 1 });
  const affenOhneTotals = combatTotals(affenOhne.room);
  done(affenOhne.room);
  assert.strictEqual(affenTotals.monsterStrength - affenOhneTotals.monsterStrength, 2,
    'Affenbande: "+2 gegen Halblinge" muss automatisch zaehlen');

  // "Falls du deinen ersten Weglaufwurf verpatzt, darfst du 1 Karte ablegen
  // und es noch mal probieren." Die Schnecken geben -2, damit scheitert der
  // Wurf garantiert (max. 6 - 2 = 4, noetig sind 5) - der Test braucht also
  // kein Glueck.
  const koeder = findCard('GEILER HELM', 'item').id;
  const halbFlucht = combatRoom('SCHNECKEN AUF SPEED',
    { races: [HALBLING], hand: [koeder] }, { mustFlee: true });
  handleAttemptFlee(halbFlucht.room, 'p1', 0);
  assert.strictEqual(halbFlucht.room.dieRoll.success, false, 'Testvoraussetzung: der erste Wurf scheitert');
  assert.ok(halbFlucht.room.combat && halbFlucht.room.combat.fleeRerollOffer,
    'nach dem verpatzten Wurf muss dem Halbling der zweite Versuch angeboten werden');
  assert.strictEqual(halbFlucht.room.pendingConsequence, null,
    'solange das Angebot offen ist, darf das Miese Zeug noch nicht zuschlagen');

  // Ein zweiter Wurf ohne Karte wird nicht geschenkt.
  handleAttemptFlee(halbFlucht.room, 'p1', 0);
  assert.ok(halbFlucht.room.combat && halbFlucht.room.combat.fleeRerollOffer,
    'ein offenes Angebot muss erst beantwortet werden, kein Gratis-Wurf');

  // Karte ablegen -> neuer Wurf; er scheitert wieder (Schnecken), also greift
  // jetzt das Miese Zeug, und ein drittes Angebot gibt es nicht.
  handleFleeReroll(halbFlucht.room, 'p1', koeder);
  done(halbFlucht.room);
  assert.ok(!halbFlucht.room.players[0].hand.includes(koeder), 'die abgelegte Karte ist von der Hand weg');
  assert.ok(halbFlucht.room.treasureDiscard.includes(koeder), 'die abgelegte Schatzkarte liegt auf dem Schatz-Ablagestapel');
  assert.ok(halbFlucht.room.pendingConsequence, 'nach dem zweiten Fehlwurf schlagen die Schlimmen Dinge zu');
  assert.strictEqual(halbFlucht.room.combat, null, 'nur EIN Wiederholungswurf - danach ist der Kampf vorbei');

  // Ohne Handkarte gibt es nichts abzulegen - dann sofort das Miese Zeug.
  const halbLeer = combatRoom('SCHNECKEN AUF SPEED', { races: [HALBLING], hand: [] }, { mustFlee: true });
  handleAttemptFlee(halbLeer.room, 'p1', 0);
  done(halbLeer.room);
  assert.ok(halbLeer.room.pendingConsequence, 'ohne Handkarte kein Wiederholungswurf');

  // Das Angebot ablehnen (cardId null) kostet keine Karte.
  const halbNein = combatRoom('SCHNECKEN AUF SPEED', { races: [HALBLING], hand: [koeder] }, { mustFlee: true });
  handleAttemptFlee(halbNein.room, 'p1', 0);
  handleFleeReroll(halbNein.room, 'p1', null);
  done(halbNein.room);
  assert.ok(halbNein.room.players[0].hand.includes(koeder), 'wer ablehnt, behaelt seine Karte');
  assert.ok(halbNein.room.pendingConsequence, 'wer ablehnt, bekommt das Miese Zeug');

  // Vor den Filzlaeusen gibt es kein Entkommen - dann waere die Karte umsonst
  // weg, also gar kein Angebot.
  const halbLaeuse = combatRoom('FILZLAUSE', { races: [HALBLING], hand: [koeder] }, { mustFlee: true });
  handleAttemptFlee(halbLaeuse.room, 'p1', 0);
  done(halbLaeuse.room);
  assert.ok(halbLaeuse.room.pendingConsequence, 'gegen ein unentkommbares Monster kein Wiederholungsangebot');

  // Fremdeingabe: eine Karte, die nicht auf der Hand liegt, darf nichts tun.
  const halbFremd = combatRoom('SCHNECKEN AUF SPEED', { races: [HALBLING], hand: [koeder] }, { mustFlee: true });
  handleAttemptFlee(halbFremd.room, 'p1', 0);
  handleFleeReroll(halbFremd.room, 'p1', 'gibt-es-nicht');
  handleFleeReroll(halbFremd.room, 'p2', koeder);
  done(halbFremd.room);
  assert.ok(halbFremd.room.combat && halbFremd.room.combat.fleeRerollOffer,
    'fremde Karten-IDs und fremde Spieler:innen duerfen das Angebot nicht ausloesen');

  // "Du darfst 1 Gegenstand pro Runde zum doppelten Preis verkaufen."
  // 600 Goldstuecke reichen normal nicht fuer eine Stufe, verdoppelt schon.
  const helm = findCard('GEILER HELM', 'item');
  function sellRoom(overrides) {
    const room = makeRoom();
    Object.assign(room.players[0], { level: 1, hand: [helm.id] }, overrides || {});
    handleSellItems(room, 'p1', [helm.id]);
    return done(room);
  }
  assert.strictEqual(sellRoom({}).players[0].level, 1, 'ohne Halbling bringen 600 Goldstuecke keine Stufe');
  const halbVerkauf = sellRoom({ races: [HALBLING] });
  assert.strictEqual(halbVerkauf.players[0].level, 2, 'Halbling: 600 verdoppelt = 1200 Goldstuecke = 1 Stufe');
  assert.ok(halbVerkauf.players[0].halblingSaleUsed, 'der Doppelverkauf ist fuer diese Runde verbraucht');

  // Zweiter Verkauf in derselben Runde: normaler Preis.
  halbVerkauf.players[0].hand = [helm.id];
  handleSellItems(halbVerkauf, 'p1', [helm.id]);
  assert.strictEqual(halbVerkauf.players[0].level, 2, 'nur EIN Gegenstand pro Runde zum doppelten Preis');

  // Nach dem Zugwechsel geht es wieder.
  endTurn(halbVerkauf);
  assert.strictEqual(halbVerkauf.players[0].halblingSaleUsed, false, 'der Zugwechsel setzt den Doppelverkauf zurueck');

  // -------------------------------------------------------------------
  // RATTE AM SPIESS: garantierte Flucht nur bis Monsterstufe 8
  // -------------------------------------------------------------------
  const ratte = findCard('RATTE AM SPIESS', 'item');
  const gegenSchwach = combatRoom('PAVILLON', { level: 5, hand: [ratte.id] }, { mustFlee: true }); // Stufe 8
  handleUseGuaranteedFlee(gegenSchwach.room, 'p1', ratte.id);
  done(gegenSchwach.room);
  assert.strictEqual(gegenSchwach.room.combat, null, 'gegen ein Monster der Stufe 8 wirkt die Ratte am Spieß');

  const gegenStark = combatRoom('3.872 ORKS', { level: 5, hand: [ratte.id] }, { mustFlee: true }); // Stufe 10
  handleUseGuaranteedFlee(gegenStark.room, 'p1', ratte.id);
  done(gegenStark.room);
  assert.ok(gegenStark.room.combat, 'gegen ein Monster über Stufe 8 wirkt die Ratte am Spieß nicht');
  assert.ok(gegenStark.room.players[0].hand.includes(ratte.id), 'die wirkungslose Karte darf nicht verbraucht werden');

  // "... sogar dann, wenn du die Ratte am Spieß lediglich im Rucksack mit dir
  // trägst" - sie muss auch angelegt funktionieren.
  const ratteAngelegt = combatRoom('PAVILLON', {
    level: 5, equipped: { head: null, armor: null, feet: null, hands: [ratte.id, null] },
  }, { mustFlee: true });
  handleUseGuaranteedFlee(ratteAngelegt.room, 'p1', ratte.id);
  done(ratteAngelegt.room);
  assert.strictEqual(ratteAngelegt.room.combat, null, 'die Ratte am Spieß wirkt auch aus dem angelegten Zustand');

  // -------------------------------------------------------------------
  // Bonusstufen und Bonusschätze beim Sieg
  // -------------------------------------------------------------------
  const boss = combatRoom('HIPPOGREIF', { level: 30 }); // sicher stärker als das Monster
  handleEvaluateCombat(boss.room, 'p1');
  done(boss.room);
  assert.strictEqual(boss.room.players[0].lastReward.levelsGained, 2,
    'Bossmonster: 1 Stufe fürs Besiegen + 1 zusätzliche laut Kartentext');

  const huhn = findCard('GROSSES WUTENDES HUHN', 'monster');
  const napalm = findCard('NAPALMSTAB', 'item');
  const mitFeuer = combatRoom('GROSSES WUTENDES HUHN', {
    level: 30, equipped: { head: null, armor: null, feet: null, hands: [napalm.id, null] },
  });
  handleEvaluateCombat(mitFeuer.room, 'p1');
  done(mitFeuer.room);
  assert.strictEqual(mitFeuer.room.players[0].lastReward.levelsGained, 2,
    '"zusätzliche Stufe, wenn du es mit Feuer oder Flammen besiegst"');
  const ohneFeuer = combatRoom('GROSSES WUTENDES HUHN', { level: 30 });
  handleEvaluateCombat(ohneFeuer.room, 'p1');
  done(ohneFeuer.room);
  assert.strictEqual(ohneFeuer.room.players[0].lastReward.levelsGained, 1,
    'ohne Feuer bleibt es beim Huhn bei einer Stufe');
  assert.ok(huhn.treasureCount >= 1, 'Testvoraussetzung: das Huhn lässt überhaupt einen Schatz da');

  // TOPFPFLANZE: "Elfen ziehen 1 zusätzlichen Schatz."
  const topfpflanze = findCard('TOPFPFLANZE', 'monster');
  const topfElf = combatRoom('TOPFPFLANZE', { level: 30, races: [ELF] });
  handleEvaluateCombat(topfElf.room, 'p1');
  done(topfElf.room);
  assert.strictEqual(topfElf.room.players[0].lastReward.cardIds.length, topfpflanze.treasureCount + 1,
    'Elfen bekommen von der Topfpflanze einen Schatz mehr');

  // PIKOTZU: "Extrastufe, wenn du es ohne Hilfe und Boni besiegst."
  const pikoNackt = combatRoom('PIKOTZU', { level: 30 });
  handleEvaluateCombat(pikoNackt.room, 'p1');
  done(pikoNackt.room);
  assert.strictEqual(pikoNackt.room.players[0].lastReward.levelsGained, 2, 'Pikotzu ohne Boni: Extrastufe');
  const pikoMitBonus = combatRoom('PIKOTZU', { level: 30, equipped: equipMithril });
  handleEvaluateCombat(pikoMitBonus.room, 'p1');
  done(pikoMitBonus.room);
  assert.strictEqual(pikoMitBonus.room.players[0].lastReward.levelsGained, 1, 'Pikotzu mit Ausrüstungsbonus: keine Extrastufe');

  // ELF als Helfer:in: "Für jedes Monster, das du jemandem anderen hilfst zu
  // töten, steigst du 1 Stufe auf."
  const elfHilft = combatRoom('LAHMER GOBLIN', { level: 30 }, { helperId: 'p2' });
  elfHilft.room.players[1].races = [ELF];
  elfHilft.room.players[1].level = 3;
  handleEvaluateCombat(elfHilft.room, 'p1');
  done(elfHilft.room);
  assert.strictEqual(elfHilft.room.players[1].level, 4, 'ein Elf steigt fürs Helfen eine Stufe auf');

  const menschHilft = combatRoom('LAHMER GOBLIN', { level: 30 }, { helperId: 'p2' });
  menschHilft.room.players[1].level = 3;
  handleEvaluateCombat(menschHilft.room, 'p1');
  done(menschHilft.room);
  assert.strictEqual(menschHilft.room.players[1].level, 3, 'ohne Elfen-Rasse bringt Helfen keine Stufe');

  // -------------------------------------------------------------------
  // Klassenkräfte, die Handkarten kosten
  // -------------------------------------------------------------------
  const ZAUBERER = findCard('ZAUBERER', 'class').id;
  const PRIESTER = findCard('PRIESTER', 'class').id;
  const futter = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 5).map((c) => c.id);

  // KRIEGER "Berserken": bis zu 3 Karten, je +1 im Kampf.
  const berserk = combatRoom('LAHMER GOBLIN', { level: 1, classes: [KRIEGER], hand: futter.slice(0, 4) });
  const power = classCombatPowerInfo(berserk.room, berserk.room.players[0]);
  assert.ok(power, 'ein Kämpfer mit Krieger-Klasse muss eine nutzbare Klassenkraft angeboten bekommen');
  assert.strictEqual(power.label, 'Berserken');
  assert.strictEqual(power.remaining, 3, 'zu Kampfbeginn sind alle 3 Karten noch offen');

  handleUseClassCombatDiscard(berserk.room, 'p1', futter[0]);
  done(berserk.room);
  assert.strictEqual(berserk.room.combat.actorModifier, 1, 'jede abgelegte Karte gibt +1');
  assert.ok(!berserk.room.players[0].hand.includes(futter[0]), 'die abgelegte Karte verlässt die Hand');
  assert.ok(berserk.room.treasureDiscard.includes(futter[0]), 'sie landet auf dem passenden Ablagestapel');

  handleUseClassCombatDiscard(berserk.room, 'p1', futter[1]);
  handleUseClassCombatDiscard(berserk.room, 'p1', futter[2]);
  done(berserk.room);
  assert.strictEqual(berserk.room.combat.actorModifier, 3, 'drei Karten ergeben +3');
  assert.strictEqual(classCombatPowerInfo(berserk.room, berserk.room.players[0]).remaining, 0, 'nach 3 Karten ist Schluss');

  handleUseClassCombatDiscard(berserk.room, 'p1', futter[3]);
  done(berserk.room);
  assert.strictEqual(berserk.room.combat.actorModifier, 3, '"bis zu 3 Karten" - die vierte darf nichts mehr bringen');
  assert.ok(berserk.room.players[0].hand.includes(futter[3]), 'und sie darf auch nicht verbraucht werden');

  // Ohne passende Klasse gibt es die Kraft gar nicht.
  const ohneKlasse = combatRoom('LAHMER GOBLIN', { level: 1, hand: futter.slice() });
  assert.strictEqual(classCombatPowerInfo(ohneKlasse.room, ohneKlasse.room.players[0]), null,
    'ohne Klasse wird keine Kartenabwurf-Kraft angeboten');
  handleUseClassCombatDiscard(ohneKlasse.room, 'p1', futter[0]);
  done(ohneKlasse.room);
  assert.strictEqual(ohneKlasse.room.combat.actorModifier, 0, 'ohne Klasse bleibt der Abwurf wirkungslos');

  // Wer nur zuschaut, darf nicht abwerfen.
  const zuschauer = combatRoom('LAHMER GOBLIN', { level: 1, classes: [KRIEGER] });
  zuschauer.room.players[1].classes = [KRIEGER];
  zuschauer.room.players[1].hand = futter.slice();
  assert.strictEqual(classCombatPowerInfo(zuschauer.room, zuschauer.room.players[1]), null,
    'wer nicht im Kampf steht, bekommt die Kraft nicht angeboten');
  handleUseClassCombatDiscard(zuschauer.room, 'p2', futter[0]);
  done(zuschauer.room);
  assert.strictEqual(zuschauer.room.combat.actorModifier, 0, 'Zuschauer:innen dürfen den Kampf so nicht beeinflussen');

  // PRIESTER "Vertreiben": nur gegen Untote, dafür +3.
  const gegenUntot = combatRoom('MR. BONES', { level: 1, classes: [PRIESTER], hand: futter.slice() });
  assert.ok(UNDEAD_MONSTERS.has('MR. BONES'), 'Testvoraussetzung: Mr. Bones gilt als untot');
  const priesterPower = classCombatPowerInfo(gegenUntot.room, gegenUntot.room.players[0]);
  assert.ok(priesterPower && priesterPower.bonus === 3, 'Vertreiben gibt +3 pro Karte');
  handleUseClassCombatDiscard(gegenUntot.room, 'p1', futter[0]);
  done(gegenUntot.room);
  assert.strictEqual(gegenUntot.room.combat.actorModifier, 3, 'eine Karte gegen Untote bringt +3');

  const gegenLebend = combatRoom('LAHMER GOBLIN', { level: 1, classes: [PRIESTER], hand: futter.slice() });
  assert.strictEqual(classCombatPowerInfo(gegenLebend.room, gegenLebend.room.players[0]), null,
    'gegen nicht-untote Monster darf der Priester nicht vertreiben');
  handleUseClassCombatDiscard(gegenLebend.room, 'p1', futter[0]);
  done(gegenLebend.room);
  assert.strictEqual(gegenLebend.room.combat.actorModifier, 0, 'und der Abwurf bleibt folgenlos');

  // ZAUBERER "Flugzauber": wirkt auf den Weglaufwurf, nicht auf die
  // Kampfstärke.
  const flug = combatRoom('LAHMER GOBLIN', { level: 1, classes: [ZAUBERER], hand: futter.slice() }, { mustFlee: true });
  const flugPower = classCombatPowerInfo(flug.room, flug.room.players[0]);
  assert.ok(flugPower && flugPower.kind === 'flee', 'beim Fliehen bietet der Zauberer den Flugzauber an');
  handleUseClassCombatDiscard(flug.room, 'p1', futter[0]);
  handleUseClassCombatDiscard(flug.room, 'p1', futter[1]);
  done(flug.room);
  assert.strictEqual(flug.room.combat.fleeBonus, 2, 'zwei Karten ergeben +2 auf Weglaufen');
  handleAttemptFlee(flug.room, 'p1', 0);
  done(flug.room);
  assert.strictEqual(flug.room.dieRoll.mod, 2 + 1, 'Flugzauber (+2) und Lahmer Goblin (+1) landen im Wurf');

  // Im laufenden Kampf (nicht beim Fliehen) hat der Zauberer die Kraft nicht.
  const zaubererImKampf = combatRoom('LAHMER GOBLIN', { level: 1, classes: [ZAUBERER], hand: futter.slice() });
  assert.strictEqual(classCombatPowerInfo(zaubererImKampf.room, zaubererImKampf.room.players[0]), null,
    'der Flugzauber gilt nur fürs Weglaufen, nicht für die Kampfstärke');

  // -------------------------------------------------------------------
  // Bereit-Check vor der Kampfauswertung
  // -------------------------------------------------------------------
  // Die Spieler:innen der übrigen Tests sind absichtlich "nicht verbunden"
  // (kein connected-Feld), damit die Bereit-Sperre dort nicht greift. Hier
  // wird sie gezielt aktiviert.
  function readyRoom(extra) {
    const r = combatRoom('LAHMER GOBLIN', { level: 30, connected: true });
    r.room.players[1].connected = true;
    Object.assign(r.room.players[1], extra || {});
    refreshCombatReady(r.room);
    return r.room;
  }

  const warten = readyRoom();
  assert.deepStrictEqual(combatReadyRequired(warten), ['p2'], 'alle außer der kämpfenden Person müssen bestätigen');
  assert.strictEqual(combatAllReady(warten), false, 'zu Beginn ist niemand bereit');
  handleEvaluateCombat(warten, 'p1');
  done(warten);
  assert.ok(warten.combat, 'solange jemand fehlt, darf der Kampf nicht ausgewertet werden');

  handleSetCombatReady(warten, 'p2', true);
  assert.strictEqual(combatAllReady(warten), true, 'nach der Bestätigung ist alles bereit');
  handleEvaluateCombat(warten, 'p1');
  done(warten);
  assert.strictEqual(warten.combat, null, 'jetzt wird ausgewertet');

  // Bots und Getrennte blockieren nicht.
  const mitBot = readyRoom({ isBot: true });
  assert.deepStrictEqual(combatReadyRequired(mitBot), [], 'Bots müssen nicht bestätigen');
  handleEvaluateCombat(mitBot, 'p1');
  done(mitBot);
  assert.strictEqual(mitBot.combat, null, 'ein Tisch aus Bots wertet ohne Warten aus');

  const mitGetrennt = readyRoom({ connected: false });
  assert.deepStrictEqual(combatReadyRequired(mitGetrennt), [], 'Getrennte werden übersprungen');

  // Der Kern der Sache: ändert sich am Kampf etwas, verfällt "bereit".
  const stale = readyRoom();
  handleSetCombatReady(stale, 'p2', true);
  assert.strictEqual(combatAllReady(stale), true, 'Testvoraussetzung: alle bereit');
  handleSetCombatModifier(stale, 'p2', 'monster', 10); // z.B. "Uralt +10"
  refreshCombatReady(stale); // läuft im Betrieb in broadcastState
  done(stale);
  assert.strictEqual(combatAllReady(stale), false,
    'wer nach dem Bereitmelden noch das Monster verstärkt, setzt den Bereit-Status zurück');
  handleEvaluateCombat(stale, 'p1');
  done(stale);
  assert.ok(stale.combat, 'und der Kampf darf danach nicht mit veralteter Zustimmung auslaufen');

  // Wer gar nicht bestätigen muss, kann auch nicht bestätigen.
  const fremd = readyRoom();
  handleSetCombatReady(fremd, 'p1', true); // die kämpfende Person selbst
  done(fremd);
  assert.strictEqual(combatAllReady(fremd), false, 'die kämpfende Person bestätigt nicht für sich selbst');

  // Zurücknehmen muss gehen.
  const zurueck = readyRoom();
  handleSetCombatReady(zurueck, 'p2', true);
  handleSetCombatReady(zurueck, 'p2', false);
  done(zurueck);
  assert.strictEqual(combatAllReady(zurueck), false, '"doch noch nicht bereit" muss die Freigabe zurücknehmen');

  // -------------------------------------------------------------------
  // ZWERG: "Du darfst sechs Karten auf deiner Hand haben."
  // -------------------------------------------------------------------
  assert.strictEqual(handLimit(makePlayer({})), 5, 'Standard-Handkartenlimit bleibt 5');
  assert.strictEqual(handLimit(makePlayer({ races: [ZWERG] })), 6, 'Zwerge dürfen 6 Karten halten');

  console.log('OK - Dauerwirkungen des Basis-Sets: Fluchschutz, Monsterregeln, Weglaufen, Siegesboni, Klassenkräfte, Bereit-Check, Handlimit.');
}

run();
