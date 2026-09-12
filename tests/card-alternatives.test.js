// Task 10: Kampf-Alternativen und Sofort-Effekte bei Kampfbeginn.
// Vier Basis-Set-Monster bieten etwas anderes als einen reinen Kampf an -
// aber nur, wenn die Bedingung auf der Karte erfuellt ist:
//   MÖCHTEGERN-VAMPIR: nur ein Priester darf wegjagen (Schatz, keine Stufe).
//   LAUFENDE NASE: nur bestechbar mit einem getragenen Gegenstand >= 200 GS.
//   PIT BULL: nur ablenkbar mit einem getragenen Stab (o. Aehnliches).
//   ZUNGENDÄMON: erzwungenes Ablegen VOR dem Kampf - keine Wahl OB, nur WELCHER
//   Gegenstand.
const assert = require('assert');
const {
  ALL_CARDS, handleDrawDoor, handleResolveCardChoice, handleResolveCardCardChoice,
  newEquipped, hasClass, equippedItemIds, CONSEQUENCE_OVERRIDES,
} = require('../server.js');

function byName(n) { const c = ALL_CARDS.find((x) => x.name === n); assert.ok(c, n); return c; }

function makePlayer(id, extra) {
  return Object.assign({
    id, name: id.toUpperCase(), level: 5, hand: [], races: [], classes: [],
    powerGroups: [], raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), attachments: { cheatedItemId: null }, activeCurses: [],
    isBot: false, connected: true,
  }, extra || {});
}

const treasureFiller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 20).map((c) => c.id);

function raumMitTuerkarte(p, monsterName) {
  const m = byName(monsterName);
  return {
    code: 'T', players: [p], turnIndex: 0, turnPhase: 'tuer',
    doorDeck: [m.id], doorDiscard: [], treasureDeck: treasureFiller.slice(), treasureDiscard: [],
    logs: [], combat: null, pendingCardAction: null, pendingConsequence: null,
    revealedDoorCard: null, doorReveal: null, combatHappenedThisTurn: false,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  };
}

function done(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  if (room.botTimer) clearTimeout(room.botTimer);
  return room;
}

function run() {
  const priester = byName('PRIESTER');
  const napalmstab = byName('NAPALMSTAB');
  const teuresTuch = byName('COOLES TUCH FÜR HARTE KERLE'); // 400 GS, Kopf-Slot

  // -------------------------------------------------------------------
  // 1) MÖCHTEGERN-VAMPIR: nur Priester bekommen die Wahl
  // -------------------------------------------------------------------
  {
    const p = makePlayer('a', { classes: [priester.id] });
    const room = raumMitTuerkarte(p, 'MÖCHTEGERN-VAMPIR');
    handleDrawDoor(room, p.id);
    assert.ok(room.pendingCardAction, 'Priester muss die Wahl bekommen');
    assert.strictEqual(room.pendingCardAction.kind, 'choice');
    assert.strictEqual(room.pendingCardAction.options.length, 2);

    handleResolveCardChoice(room, p.id, 'alt');
    assert.strictEqual(room.pendingCardAction, null, 'Wahl ist aufgeloest');
    assert.strictEqual(p.level, 5, 'ausdruecklich KEINE Stufe dafuer');
    assert.strictEqual(p.hand.length, 3, 'Schatz (3 Karten) trotzdem erhalten');
    assert.ok(room.doorDiscard.length === 1, 'Vampir liegt auf dem Ablagestapel');
    assert.strictEqual(room.turnPhase, 'aerger');
    assert.strictEqual(room.combat, null, 'es gab nie einen echten Kampf');
    done(room);
  }
  {
    const p = makePlayer('a'); // klassenlos
    const room = raumMitTuerkarte(p, 'MÖCHTEGERN-VAMPIR');
    handleDrawDoor(room, p.id);
    assert.ok(!room.pendingCardAction, 'ohne Priesterklasse keine Wahl');
    assert.ok(room.combat, 'stattdessen ein normaler Kampf');
    done(room);
  }

  // -------------------------------------------------------------------
  // 2) LAUFENDE NASE: nur mit einem getragenen Gegenstand >= 200 GS
  // -------------------------------------------------------------------
  {
    const p = makePlayer('a');
    p.equipped.head = teuresTuch.id;
    const room = raumMitTuerkarte(p, 'LAUFENDE NASE');
    handleDrawDoor(room, p.id);
    assert.ok(room.pendingCardAction, 'mit teurem Gegenstand gibt es die Bestechungs-Option');

    handleResolveCardChoice(room, p.id, 'alt');
    assert.strictEqual(p.equipped.head, null, 'Bestechungsgegenstand ist weg');
    assert.ok(room.treasureDiscard.includes(teuresTuch.id), 'Gegenstand liegt im Schatz-Ablagestapel');
    assert.strictEqual(p.hand.length, 0, 'kein Schatz fuer die Bestechung');
    assert.strictEqual(p.level, 5, 'keine Stufe');
    assert.strictEqual(room.turnPhase, 'aerger');
    done(room);
  }
  {
    const p = makePlayer('a');
    const room = raumMitTuerkarte(p, 'LAUFENDE NASE');
    handleDrawDoor(room, p.id);
    assert.ok(!room.pendingCardAction, 'ohne Gegenstand >= 200 GS keine Option');
    assert.ok(room.combat, 'stattdessen ein normaler Kampf');
    done(room);
  }

  // -------------------------------------------------------------------
  // 3) PIT BULL: nur mit einem getragenen Stab
  // -------------------------------------------------------------------
  {
    const p = makePlayer('a');
    p.equipped.hands[0] = napalmstab.id;
    const room = raumMitTuerkarte(p, 'PIT BULL');
    handleDrawDoor(room, p.id);
    assert.ok(room.pendingCardAction, 'mit Stab gibt es die Ablenk-Option');

    handleResolveCardChoice(room, p.id, 'alt');
    assert.strictEqual(p.equipped.hands[0], null, 'Stab ist weg');
    assert.ok(room.treasureDiscard.includes(napalmstab.id));
    assert.strictEqual(p.level, 5, 'keine Stufe (automatische Flucht)');
    assert.strictEqual(room.turnPhase, 'aerger');
    done(room);
  }
  {
    const p = makePlayer('a');
    const room = raumMitTuerkarte(p, 'PIT BULL');
    handleDrawDoor(room, p.id);
    assert.ok(!room.pendingCardAction, 'ohne Stab keine Option');
    assert.ok(room.combat, 'stattdessen ein normaler Kampf');
    done(room);
  }

  // -------------------------------------------------------------------
  // 4) ZUNGENDÄMON: erzwungenes Ablegen VOR dem Kampf - keine Wahl OB, nur
  //    WELCHER Gegenstand. Der bestehende Badstuff-Eintrag bleibt unberuehrt.
  // -------------------------------------------------------------------
  {
    const p = makePlayer('a');
    p.equipped.head = teuresTuch.id;
    const room = raumMitTuerkarte(p, 'ZUNGENDÄMON');
    handleDrawDoor(room, p.id);
    assert.ok(room.pendingCardAction, 'Ablegen ist erzwungen (keine Wahl OB)');
    assert.strictEqual(room.pendingCardAction.kind, 'chooseCard', 'keine fight/pass-Wahl, nur welche Karte');
    assert.ok(room.pendingCardAction.candidateIds.includes(teuresTuch.id));
    assert.strictEqual(room.combat, null, 'Kampf beginnt erst NACH dem Ablegen');

    handleResolveCardCardChoice(room, p.id, teuresTuch.id);
    assert.strictEqual(p.equipped.head, null, 'Gegenstand ist vor dem Kampf abgelegt');
    assert.ok(room.treasureDiscard.includes(teuresTuch.id));
    assert.ok(room.combat, 'Kampf startet danach automatisch');
    assert.strictEqual(room.pendingCardAction, null);
    done(room);
  }
  {
    const p = makePlayer('a'); // kein Gegenstand zum Ablegen
    const room = raumMitTuerkarte(p, 'ZUNGENDÄMON');
    handleDrawDoor(room, p.id);
    assert.ok(!room.pendingCardAction, 'nichts zum Ablegen - keine Wahl noetig');
    assert.ok(room.combat, 'Kampf startet direkt');
    done(room);
  }
  // Bestehender Badstuff-Eintrag (CONSEQUENCE_OVERRIDES) bleibt unangetastet.
  assert.strictEqual(typeof CONSEQUENCE_OVERRIDES['ZUNGENDÄMON'], 'function');

  // Kontrolle: PRIESTER-Klassenzugehoerigkeit wird ueber hasClass erkannt
  // (bestaetigt, dass die Bedingungstabelle dieselbe Pruefung verwendet wie
  // der Rest des Servers).
  assert.ok(hasClass(makePlayer('x', { classes: [priester.id] }), 'PRIESTER'));
  assert.ok(equippedItemIds); // nur Existenzpruefung des importierten Helfers

  console.log('OK - Kampf-Alternativen: Bedingungen der Karten werden geprueft (Vampir/Nase/Bulle/Daemon).');
}

run();
