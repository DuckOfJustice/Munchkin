// Die Siegesstufe ist nur durch ein besiegtes Monster erreichbar. Verkaufen
// darf auf Stufe 10 bringen, aber nicht gewinnen lassen - GOTTLICHE
// INTERVENTION ist die einzige gedruckte Ausnahme.
const assert = require('assert');
const {
  ALL_CARDS, handleSellItems, MAX_LEVEL, newEquipped, handleUseCardPower,
} = require('../server.js');

function findCard(name, category) {
  const c = ALL_CARDS.find((x) => x.name === name && (!category || x.category === category));
  if (!c) throw new Error(`Testkarte nicht gefunden: ${name}`);
  return c;
}

function makePlayer(id, extra) {
  return Object.assign({
    id, name: id.toUpperCase(), level: 9, hand: [], races: [], classes: [],
    powerGroups: [], raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), isBot: false, connected: true, halblingSaleUsed: false,
  }, extra || {});
}

function makeRoom(extra) {
  return Object.assign({
    code: 'T', players: [], turnIndex: 0, doorDiscard: [], treasureDiscard: [],
    logs: [], phase: 'playing', winner: null, combat: null, pendingCardAction: null,
    pendingConsequence: null, lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  }, extra || {});
}

function done(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  if (room.botTimer) clearTimeout(room.botTimer);
  return room;
}

function run() {
  // -------------------------------------------------------------------
  // Verkaufen bringt auf Stufe 10, gewinnt aber nicht
  // -------------------------------------------------------------------
  {
    const teuer = ALL_CARDS.filter((c) => c.set === 'base' && c.gold >= 400).slice(0, 4);
    assert.ok(teuer.length >= 3, 'genug teure Karten fuer den Test noetig');
    const p = makePlayer('a', { hand: teuer.map((c) => c.id) });
    const room = makeRoom({ players: [p] });
    handleSellItems(room, 'a', teuer.map((c) => c.id));
    assert.strictEqual(p.level, MAX_LEVEL, 'Verkaufen muss auf Stufe 10 bringen duerfen');
    assert.strictEqual(room.winner, null, 'Verkaufen darf das Spiel NICHT gewinnen');
    assert.strictEqual(room.phase, 'playing', 'die Partie laeuft weiter');
    done(room);
  }

  // -------------------------------------------------------------------
  // GOTTLICHE INTERVENTION: hebt ALLE Priester an, darf gewinnen
  // -------------------------------------------------------------------
  {
    const karte = findCard('GOTTLICHE INTERVENTION', 'door_other');
    const priesterKarte = findCard('PRIESTER');
    const a = makePlayer('a', { level: 9, classes: [priesterKarte.id], hand: [karte.id] });
    const b = makePlayer('b', { level: 3, classes: [priesterKarte.id] });
    const nichtPriester = makePlayer('c', { level: 5, classes: [] });
    const room = makeRoom({ players: [a, b, nichtPriester] });
    handleUseCardPower(room, 'a', karte.id);
    assert.strictEqual(a.level, MAX_LEVEL, 'spielender Priester steigt auf Stufe 10');
    assert.strictEqual(b.level, 4, 'jeder andere Priester steigt ebenfalls 1 Stufe auf');
    assert.strictEqual(nichtPriester.level, 5, 'Nicht-Priester bleibt unveraendert');
    assert.strictEqual(room.winner, 'a', 'GOTTLICHE INTERVENTION darf die Siegesstufe bringen');
    assert.ok(!a.hand.includes(karte.id), 'Karte wird nach dem Spielen abgelegt');
    done(room);
  }

  // -------------------------------------------------------------------
  // GOTTLICHE INTERVENTION ohne Priester am Tisch: keine Wirkung, kein Absturz
  // -------------------------------------------------------------------
  {
    const karte = findCard('GOTTLICHE INTERVENTION', 'door_other');
    const a = makePlayer('a', { level: 9, classes: [], hand: [karte.id] });
    const room = makeRoom({ players: [a] });
    handleUseCardPower(room, 'a', karte.id);
    assert.strictEqual(a.level, 9, 'ohne Priester am Tisch aendert sich nichts');
    assert.strictEqual(room.winner, null);
    done(room);
  }

  console.log('OK - Siegregel: Verkaufen bringt auf Stufe 10 ohne zu gewinnen, GOTTLICHE INTERVENTION ist die gedruckte Ausnahme.');
}

run();
