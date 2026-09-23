// Regellücken Welle 4 (Spec 2026-09-23-drei-flueche-welle4-design.md):
// TOURISTENFALLE, HUNGRIGER RUCKSACK, TEMPORÄRE ANMNESIE.
const assert = require('assert');
const S = require('../server.js');
const { ALL_CARDS, newEquipped } = S;

const findCard = (name, category) => {
  const c = ALL_CARDS.find((x) => x.name === name && (!category || x.category === category));
  if (!c) throw new Error(`Testkarte nicht gefunden: ${name}`);
  return c;
};
function makePlayer(o) {
  return Object.assign({
    id: 'p1', name: 'A', level: 5, hand: [], races: [], classes: [], powerGroups: [],
    raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), attachments: { cheatedItemId: null }, activeCurses: [],
    isBot: false, connected: true, gender: 'm', genderBeiSlippern: null,
  }, o || {});
}
const raeume = [];
function makeRoom(players, extra) {
  const room = Object.assign({
    code: 'TEST', players, turnIndex: 0, turnPhase: 'kampf', combatHappenedThisTurn: true,
    doorDeck: [], doorDiscard: [],
    treasureDeck: ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 20).map((c) => c.id),
    treasureDiscard: [], itemAttachments: {},
    revealedDoorCard: null, pendingConsequence: null, pendingCardAction: null, pendingRoll: null,
    combat: null, winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
    settings: { sets: {} },
  }, extra || {});
  raeume.push(room);
  return room;
}
const fertig = () => raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
const verfluche = (room, p, name) => S.addActiveCurse(room, p, name, findCard(name).id);
const hatFluch = (p, name) => (p.activeCurses || []).some((f) => f.name === name);

// --- TOURISTENFALLE: "Du darfst nicht 'Auf Aerger aus sein'. Dieser Fluch
// bleibt bestehen, bis du einem anderen Spieler geholfen hast, einen Kampf zu
// gewinnen."
{
  const goblin = findCard('LAHMER GOBLIN', 'monster');
  const p = makePlayer({ hand: [goblin.id] });
  const room = makeRoom([p], { turnPhase: 'aerger' });
  verfluche(room, p, 'TOURISTENFALLE');
  assert.ok(hatFluch(p, 'TOURISTENFALLE'), 'der Fluch steht im Tracker');
  S.handlePlayMonsterFromHand(room, 'p1', goblin.id);
  assert.strictEqual(room.combat, null, 'kein Kampf gegen ein Monster aus der Hand');
  assert.ok(p.hand.includes(goblin.id), 'das Monster bleibt auf der Hand');
}
// Gegenprobe ohne Fluch: das Monster aus der Hand startet einen Kampf.
{
  const goblin = findCard('LAHMER GOBLIN', 'monster');
  const p = makePlayer({ hand: [goblin.id] });
  const room = makeRoom([p], { turnPhase: 'aerger' });
  S.handlePlayMonsterFromHand(room, 'p1', goblin.id);
  assert.ok(room.combat, 'ohne Fluch geht es in den Kampf');
}
// Ein eigener Sieg beendet den Fluch nicht, ein Sieg als Helfer:in schon.
{
  const goblin = findCard('LAHMER GOBLIN', 'monster');
  const a = makePlayer({ id: 'p1', name: 'A' });
  const b = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([a, b]);
  verfluche(room, a, 'TOURISTENFALLE');
  verfluche(room, b, 'TOURISTENFALLE');
  S.startCombat(room, 'p1', [goblin.id], { fromHand: false });
  room.combat.helperId = 'p2';
  S.resolveCombatWin(room);
  assert.ok(hatFluch(a, 'TOURISTENFALLE'), 'eigener Sieg: der Fluch bleibt');
  assert.ok(!hatFluch(b, 'TOURISTENFALLE'), 'als Helfer:in gewonnen: der Fluch endet');
}

// --- HUNGRIGER RUCKSACK: am Ende des eigenen Zuges (vor der Milden Gabe)
// wuerfeln; der Rucksack frisst so viele zufaellige Handkarten; bei 6 endet
// der Fluch und die Hand bleibt unversehrt.
{
  const tuer = ALL_CARDS.filter((c) => c.type === 'door' && c.category === 'monster').slice(0, 1).map((c) => c.id);
  const schaetze = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 5).map((c) => c.id);
  const spiele = (wurf, fluch) => {
    const p = makePlayer({ hand: schaetze.slice() });
    const room = makeRoom([p], { turnPhase: 'pluendern', doorDeck: tuer.slice() });
    if (fluch) verfluche(room, p, 'HUNGRIGER RUCKSACK');
    const zufall = Math.random;
    let erster = true;
    // Erster Aufruf = Wuerfel, danach die Zufallsauswahl der Karten.
    Math.random = () => { if (erster) { erster = false; return (wurf - 1) / 6 + 0.01; } return 0; };
    try { S.handleLootRoom(room, 'p1'); } finally { Math.random = zufall; }
    return { p, room };
  };
  const drei = spiele(3, true);
  assert.strictEqual(drei.room.turnPhase, 'gabe');
  assert.strictEqual(drei.p.hand.length, 6 - 3, 'Wurf 3: drei Karten gefressen (5 + 1 geplündert - 3)');
  assert.ok(hatFluch(drei.p, 'HUNGRIGER RUCKSACK'), 'der Fluch bleibt');

  const sechs = spiele(6, true);
  assert.strictEqual(sechs.p.hand.length, 6, 'Wurf 6: die Hand bleibt unversehrt');
  assert.ok(!hatFluch(sechs.p, 'HUNGRIGER RUCKSACK'), 'Wurf 6: der Fluch endet');

  const ohne = spiele(3, false);
  assert.strictEqual(ohne.p.hand.length, 6, 'ohne Fluch frisst nichts');
}
// Kleine Hand: der Rucksack frisst hoechstens, was da ist.
{
  const tuer = ALL_CARDS.filter((c) => c.type === 'door' && c.category === 'monster').slice(0, 1).map((c) => c.id);
  const p = makePlayer({ hand: [] });
  const room = makeRoom([p], { turnPhase: 'pluendern', doorDeck: tuer.slice() });
  verfluche(room, p, 'HUNGRIGER RUCKSACK');
  const zufall = Math.random;
  let erster = true;
  Math.random = () => { if (erster) { erster = false; return 4 / 6 + 0.01; } return 0; };
  try { S.handleLootRoom(room, 'p1'); } finally { Math.random = zufall; }
  assert.strictEqual(p.hand.length, 0, 'Wurf 5 bei einer Karte: die eine Karte ist weg');
  assert.ok(room.doorDiscard.includes(tuer[0]), 'die gefressene Karte liegt auf dem Ablagestapel');
}

fertig();
console.log('card-clerical-fluechewelle4: alle Checks gruen');
