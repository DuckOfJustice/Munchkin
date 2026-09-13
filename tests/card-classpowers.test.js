// Task 12 (Plan 2026-09-12): die beiden fehlenden Klassenkraefte.
//
//   DIEB "In den Ruecken fallen": "Lege eine Karte ab, um einem Spieler in
//     den Ruecken zu fallen (-2 im Kampf). Das darfst du nur einmal pro Opfer
//     pro Kampf tun, aber falls zwei Spieler zusammen gegen ein Monster
//     kaempfen, darfst du beiden in den Ruecken fallen."
//   DIEB "Diebstahl": "Lege eine Karte ab, um einem anderen Spieler einen
//     kleinen Gegenstand zu stehlen. Wuerfle. Bei einer 4 oder mehr gelingt
//     es. Ansonsten wirst du verhauen und verlierst eine Stufe."
//   PRIESTER "Auferstehung": "Wenn du eine oder mehrere Karten offen ziehen
//     sollst, darfst du stattdessen ... vom entsprechenden Ablagestapel
//     ziehen. Du musst danach fuer jede so gezogene Karte eine Karte von
//     deiner Hand ablegen."
//
// Wichtig fuer den Rueckenfall: der Malus MUSS in combatTotals landen, sonst
// veraltet der Bereit-Status der Mitspielenden unbemerkt (combatSignature).
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, combatTotals, combatSignature, refreshCombatReady,
  handleThiefBackstab, handleThiefSteal, handlePriestResurrect,
  handleResolveCardChoice, thiefPowerInfo, priestResurrectPiles,
} = require('../server.js');

function findCard(name, category) {
  const c = ALL_CARDS.find((x) => x.name === name && (!category || x.category === category));
  if (!c) throw new Error(`Testkarte nicht gefunden: ${name}`);
  return c;
}

function makePlayer(overrides) {
  return Object.assign({
    id: 'p1', name: 'A', level: 5, hand: [], races: [], classes: [], powerGroups: [],
    raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), attachments: { cheatedItemId: null }, activeCurses: [],
    isBot: false, connected: true,
  }, overrides || {});
}

function makeRoom(extra) {
  return Object.assign({
    code: 'TEST',
    players: [makePlayer({ id: 'p1', name: 'A' }), makePlayer({ id: 'p2', name: 'B' }),
      makePlayer({ id: 'p3', name: 'C' })],
    turnIndex: 0, turnPhase: 'tuer', combatHappenedThisTurn: false,
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
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

const dieb = findCard('DIEB', 'class');
const priester = findCard('PRIESTER', 'class');
// LEPRACHAUN, Stufe 4: keine Sonderregel ausser "+5 gegen Elfen", und Elfen
// kommen in diesem Test nicht vor.
const monster = findCard('LEPRACHAUN', 'monster');
const fueller = ALL_CARDS.filter((c) => c.type === 'treasure' && c.category === 'treasure_other').slice(0, 6);

// Kampf: p2 ist Angreiferin, p1 ist die Diebin AUSSERHALB des Kampfes.
function kampfRaum(extra) {
  const room = makeRoom(Object.assign({
    turnPhase: 'kampf', combatHappenedThisTurn: true,
    combat: {
      actorId: 'p2', helperId: null, helperPending: null, monsterIds: [monster.id],
      actorModifier: 0, monsterModifier: 0, mustFlee: false, fromHand: false, ready: {},
    },
  }, extra || {}));
  room.players[0].classes = [dieb.id];
  room.players[0].hand = [fueller[0].id, fueller[1].id];
  return room;
}

function run() {
  // ------------------------------------------------------------------
  // 1) In den Ruecken fallen
  // ------------------------------------------------------------------
  {
    const room = kampfRaum();
    const vorher = combatTotals(room).playerStrength;
    handleThiefBackstab(room, 'p1', fueller[0].id, 'p2');
    assert.strictEqual(combatTotals(room).playerStrength, vorher - 2, '-2 im Kampf');
    assert.ok(!room.players[0].hand.includes(fueller[0].id), 'die Karte ist abgelegt');
    assert.ok(room.treasureDiscard.includes(fueller[0].id), 'die Karte liegt im Ablagestapel');
    done(room);
  }
  {
    // "nur einmal pro Opfer pro Kampf"
    const room = kampfRaum();
    const vorher = combatTotals(room).playerStrength;
    handleThiefBackstab(room, 'p1', fueller[0].id, 'p2');
    handleThiefBackstab(room, 'p1', fueller[1].id, 'p2');
    assert.strictEqual(combatTotals(room).playerStrength, vorher - 2, 'der zweite Rueckenfall zaehlt nicht');
    assert.ok(room.players[0].hand.includes(fueller[1].id), 'und kostet auch keine zweite Karte');
    done(room);
  }
  {
    // "falls zwei Spieler zusammen kaempfen, darfst du beiden in den Ruecken fallen"
    const room = kampfRaum();
    room.combat.helperId = 'p3';
    const vorher = combatTotals(room).playerStrength;
    handleThiefBackstab(room, 'p1', fueller[0].id, 'p2');
    handleThiefBackstab(room, 'p1', fueller[1].id, 'p3');
    assert.strictEqual(combatTotals(room).playerStrength, vorher - 4, 'beide Opfer zaehlen');
    done(room);
  }
  {
    // Nicht-Kaempfende und man selbst sind keine Ziele.
    const room = kampfRaum();
    const vorher = combatTotals(room).playerStrength;
    handleThiefBackstab(room, 'p1', fueller[0].id, 'p3'); // p3 kaempft nicht mit
    handleThiefBackstab(room, 'p1', fueller[0].id, 'p1'); // nicht sich selbst
    assert.strictEqual(combatTotals(room).playerStrength, vorher, 'kein Malus');
    assert.strictEqual(room.players[0].hand.length, 2, 'keine Karte verbraucht');
    done(room);
  }
  {
    // Wer kein Dieb ist, kann es nicht.
    const room = kampfRaum();
    room.players[0].classes = [];
    const vorher = combatTotals(room).playerStrength;
    handleThiefBackstab(room, 'p1', fueller[0].id, 'p2');
    assert.strictEqual(combatTotals(room).playerStrength, vorher, 'ohne Dieb-Klasse kein Malus');
    done(room);
  }
  {
    // Der Bereit-Status der Mitspielenden muss verfallen - sonst wird ein
    // Kampf mit veralteten Zahlen ausgewertet.
    const room = kampfRaum();
    refreshCombatReady(room);
    room.combat.ready = { p2: true };
    const sigVorher = combatSignature(room);
    handleThiefBackstab(room, 'p1', fueller[0].id, 'p2');
    assert.notStrictEqual(combatSignature(room), sigVorher, 'die Kampfsignatur aendert sich');
    assert.deepStrictEqual(room.combat.ready, {}, 'der Bereit-Status ist zurueckgesetzt');
    done(room);
  }
  {
    // Verlaesst das Opfer den Kampf (Helferin zieht zurueck, UEBERFALLTRANK),
    // faellt sein Malus weg - der Rueckenfall gilt der Person, nicht dem Kampf.
    const room = kampfRaum();
    room.combat.helperId = 'p3';
    handleThiefBackstab(room, 'p1', fueller[0].id, 'p3');
    const mitHelferin = combatTotals(room).playerStrength;
    room.combat.helperId = null;
    const ohneHelferin = combatTotals(room).playerStrength;
    assert.strictEqual(ohneHelferin, mitHelferin - room.players[2].level + 2,
      'mit der Helferin verschwindet auch ihr Rueckenfall-Malus');
    done(room);
  }
  {
    // Ohne Kampf gibt es nichts zu hintergehen.
    const room = makeRoom();
    room.players[0].classes = [dieb.id];
    room.players[0].hand = [fueller[0].id];
    handleThiefBackstab(room, 'p1', fueller[0].id, 'p2');
    assert.ok(room.players[0].hand.includes(fueller[0].id), 'ohne Kampf passiert nichts');
    done(room);
  }

  // ------------------------------------------------------------------
  // 2) Diebstahl
  // ------------------------------------------------------------------
  const kleiner = findCard('LEDERRÜSTUNG', 'item');
  const grosser = ALL_CARDS.find((c) => c.category === 'item' && c.big);
  assert.ok(grosser, 'es gibt mindestens einen Grossen Gegenstand');

  const origRandom = Math.random;
  try {
    {
      // Wurf 4: gelingt -> Auswahl unter den kleinen Gegenstaenden.
      Math.random = () => 0.5; // rollDie() -> 4
      const room = makeRoom();
      room.players[0].classes = [dieb.id];
      room.players[0].hand = [fueller[0].id];
      room.players[1].equipped.armor = kleiner.id;
      handleThiefSteal(room, 'p1', fueller[0].id, 'p2');
      assert.ok(!room.players[0].hand.includes(fueller[0].id), 'die Karte ist bezahlt');
      assert.ok(room.pendingCardAction, 'die Diebin waehlt den Gegenstand');
      assert.strictEqual(room.pendingCardAction.playerId, 'p1');
      const opt = room.pendingCardAction.options[0];
      handleResolveCardChoice(room, 'p1', opt.id);
      assert.strictEqual(room.players[1].equipped.armor, null, 'das Opfer traegt ihn nicht mehr');
      assert.ok(room.players[0].hand.includes(kleiner.id), 'die Diebin hat ihn auf der Hand');
      assert.strictEqual(room.players[0].level, 5, 'keine Stufe verloren');
      done(room);
    }
    {
      // Wurf 3: misslingt -> eine Stufe weniger, Karte trotzdem weg.
      Math.random = () => 0.4; // rollDie() -> 3
      const room = makeRoom();
      room.players[0].classes = [dieb.id];
      room.players[0].hand = [fueller[0].id];
      room.players[1].equipped.armor = kleiner.id;
      handleThiefSteal(room, 'p1', fueller[0].id, 'p2');
      assert.strictEqual(room.players[0].level, 4, 'erwischt: -1 Stufe');
      assert.strictEqual(room.players[1].equipped.armor, kleiner.id, 'das Opfer behaelt den Gegenstand');
      assert.ok(!room.players[0].hand.includes(fueller[0].id), 'die Karte ist trotzdem bezahlt');
      done(room);
    }
    {
      // Grosse Gegenstaende sind keine "kleinen Gegenstaende".
      Math.random = () => 0.5; // rollDie() -> 4
      const room = makeRoom();
      room.players[0].classes = [dieb.id];
      room.players[0].hand = [fueller[0].id];
      room.players[1].equipped.hands = [grosser.id, null];
      handleThiefSteal(room, 'p1', fueller[0].id, 'p2');
      assert.ok(!room.pendingCardAction, 'ein Grosser Gegenstand ist kein Ziel');
      assert.deepStrictEqual(room.players[1].equipped.hands, [grosser.id, null], 'er bleibt beim Opfer');
      done(room);
    }
    {
      // Ohne Dieb-Klasse geht gar nichts.
      Math.random = () => 0.5;
      const room = makeRoom();
      room.players[0].hand = [fueller[0].id];
      room.players[1].equipped.armor = kleiner.id;
      handleThiefSteal(room, 'p1', fueller[0].id, 'p2');
      assert.ok(room.players[0].hand.includes(fueller[0].id), 'keine Karte bezahlt');
      assert.strictEqual(room.players[1].equipped.armor, kleiner.id);
      done(room);
    }
  } finally {
    Math.random = origRandom;
  }

  // ------------------------------------------------------------------
  // 3) Auferstehung
  // ------------------------------------------------------------------
  {
    const room = makeRoom({ turnIndex: 0 });
    room.players[0].classes = [priester.id];
    room.players[0].hand = [fueller[0].id, fueller[1].id];
    room.treasureDiscard = [fueller[2].id, fueller[3].id];
    handlePriestResurrect(room, 'p1', 'treasure');
    assert.ok(room.players[0].hand.includes(fueller[3].id), 'die oberste Karte des Ablagestapels ist auf der Hand');
    assert.ok(!room.treasureDiscard.includes(fueller[3].id), 'und nicht mehr im Ablagestapel');
    assert.ok(room.pendingCardAction, 'der Preis wird sofort eingefordert');
    // Fuer jede gezogene Karte genau eine ablegen - die geholte selbst zaehlt nicht.
    assert.ok(!room.pendingCardAction.options.some((o) => o.id.includes(fueller[3].id)),
      'die geholte Karte kann nicht gleich wieder abgelegt werden');
    const vorherHand = room.players[0].hand.length;
    handleResolveCardChoice(room, 'p1', room.pendingCardAction.options[0].id);
    assert.strictEqual(room.players[0].hand.length, vorherHand - 1, 'genau eine Karte bezahlt');
    assert.strictEqual(room.treasureDiscard.length, 2, 'sie liegt wieder im Ablagestapel');
    done(room);
  }
  {
    // Leerer Stapel oder leere Hand: nichts passiert.
    const room = makeRoom();
    room.players[0].classes = [priester.id];
    room.players[0].hand = [fueller[0].id];
    handlePriestResurrect(room, 'p1', 'treasure'); // Ablagestapel leer
    assert.strictEqual(room.players[0].hand.length, 1);
    assert.ok(!room.pendingCardAction);
    room.treasureDiscard = [fueller[2].id];
    room.players[0].hand = [];
    handlePriestResurrect(room, 'p1', 'treasure'); // Hand leer, kein Preis zahlbar
    assert.strictEqual(room.treasureDiscard.length, 1, 'ohne Handkarte keine Auferstehung');
    done(room);
  }
  {
    // Keine Priesterin: keine Auferstehung.
    const room = makeRoom();
    room.players[0].hand = [fueller[0].id];
    room.treasureDiscard = [fueller[2].id];
    handlePriestResurrect(room, 'p1', 'treasure');
    assert.strictEqual(room.treasureDiscard.length, 1);
    done(room);
  }
  {
    // Eine laufende Kartenaktion darf nicht ueberschrieben werden (Task 9).
    const room = makeRoom();
    room.players[0].classes = [priester.id];
    room.players[0].hand = [fueller[0].id];
    room.treasureDiscard = [fueller[2].id];
    room.pendingCardAction = { playerId: 'p2', cardName: 'FREMD', kind: 'choice', options: [] };
    handlePriestResurrect(room, 'p1', 'treasure');
    assert.strictEqual(room.pendingCardAction.cardName, 'FREMD', 'die fremde Kartenaktion bleibt stehen');
    assert.strictEqual(room.treasureDiscard.length, 1);
    done(room);
  }

  // ------------------------------------------------------------------
  // 4) Was der Client angeboten bekommt (privat im yourInfo)
  // ------------------------------------------------------------------
  {
    const room = kampfRaum();
    const info = thiefPowerInfo(room, room.players[0]);
    assert.deepStrictEqual(info.backstabTargets.map((t) => t.id), ['p2'],
      'nur Kaempfende sind Rueckenfall-Ziele');
    handleThiefBackstab(room, 'p1', fueller[0].id, 'p2');
    assert.deepStrictEqual(thiefPowerInfo(room, room.players[0]).backstabTargets, [],
      'ein schon hintergangenes Opfer verschwindet aus der Liste');
    assert.strictEqual(thiefPowerInfo(room, room.players[1]), null, 'Nicht-Diebe bekommen nichts');
    done(room);
  }
  {
    const room = makeRoom();
    room.players[0].classes = [dieb.id];
    room.players[0].hand = [fueller[0].id];
    room.players[1].equipped.armor = kleiner.id;
    assert.deepStrictEqual(thiefPowerInfo(room, room.players[0]).stealTargets.map((t) => t.id), ['p2'],
      'nur wer einen kleinen Gegenstand traegt, ist Diebstahl-Ziel');
    room.players[0].hand = [];
    assert.deepStrictEqual(thiefPowerInfo(room, room.players[0]).stealTargets, [],
      'ohne Handkarte als Preis gibt es nichts zu stehlen');
    done(room);
  }
  {
    const room = makeRoom();
    room.players[0].classes = [priester.id];
    room.players[0].hand = [fueller[0].id];
    assert.deepStrictEqual(priestResurrectPiles(room, room.players[0]), [], 'leere Stapel: nichts');
    room.doorDiscard = [fueller[2].id];
    assert.deepStrictEqual(priestResurrectPiles(room, room.players[0]), ['door']);
    assert.deepStrictEqual(priestResurrectPiles(room, room.players[1]), [], 'Nicht-Priester: nichts');
    done(room);
  }

  console.log('OK - Klassenkraefte: Dieb (Ruecken/Diebstahl) und Priester (Auferstehung).');
}

run();
