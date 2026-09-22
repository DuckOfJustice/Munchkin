// Regellücken Welle 1 (Spec 2026-09-22-regelluecken-welle1-design.md):
// Hase, Halb-Blut, Schilde, Huhn, Zaubercouch.
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
    code: 'TEST', players, turnIndex: 0, turnPhase: 'aerger', combatHappenedThisTurn: false,
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [], itemAttachments: {},
    revealedDoorCard: null, pendingConsequence: null, pendingCardAction: null, pendingRoll: null,
    combat: null, winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
    settings: { sets: {} },
  }, extra || {});
  raeume.push(room);
  return room;
}
const fertig = () => raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });

// --- 1. DER GANZ NORMALE HASE: "Bei einer 6 ... kann der Helfer nicht mehr
// entkommen". Beide wuerfeln eine 6 zum Weglaufen: nur die kaempfende Person
// entkommt, die helfende scheitert.
{
  const hase = findCard('DER GANZ NORMALE HASE', 'monster').id;
  const a = makePlayer({ level: 3 });
  const h = makePlayer({ id: 'p2', name: 'B', level: 3 });
  const room = makeRoom([a, h]);
  S.startCombat(room, 'p1', [hase], { fromHand: false });
  room.combat.helperId = 'p2';
  const zufall = Math.random;
  Math.random = () => 0.99; // jeder Wurf eine 6
  try {
    S.hasenWurf(room, null);            // Hase wird zum Film-Hasen (Stufe 15)
    assert.strictEqual(room.combat.helferGefangen, true, 'bei einer 6 ist der Helfer gefangen');
    room.combat.mustFlee = true;
    S.handleAttemptFlee(room, 'p1', 0);
    S.handleAttemptFlee(room, 'p2', 0);
  } finally { Math.random = zufall; }
  assert.ok(room.pendingConsequence, 'es gibt Schlimme Dinge');
  assert.strictEqual(room.pendingConsequence.playerId, 'p2', 'die helfende Person ist gescheitert');
  assert.ok(room.logs.some((l) => /kann nicht mehr entkommen/.test(l.text)), 'der Verlauf nennt den Grund');
}
// Gegenprobe: ohne 6 entkommt die helfende Person normal.
{
  const hase = findCard('DER GANZ NORMALE HASE', 'monster').id;
  const room = makeRoom([makePlayer({ level: 3 }), makePlayer({ id: 'p2', name: 'B', level: 3 })]);
  S.startCombat(room, 'p1', [hase], { fromHand: false });
  room.combat.helperId = 'p2';
  const zufall = Math.random;
  try {
    Math.random = () => 0; // Hase: Wurf 1
    S.hasenWurf(room, null);
    assert.ok(!room.combat.helferGefangen);
    room.combat.mustFlee = true;
    Math.random = () => 0.99; // Flucht: 6
    S.handleAttemptFlee(room, 'p1', 0);
    S.handleAttemptFlee(room, 'p2', 0);
  } finally { Math.random = zufall; }
  assert.strictEqual(room.pendingConsequence, null, 'beide entkommen');
}
// Ein Halbling-Helfer, vom Hase gefangen: kein Wiederholungswurf-Angebot -
// der wuerde nichts aendern (helferGefangen erzwingt Scheitern so wie
// FLEE_IMPOSSIBLE), die Karte waere umsonst weg. Siehe halblingRerollPossible.
{
  const hase = findCard('DER GANZ NORMALE HASE', 'monster').id;
  const karte = findCard('GEILER HELM', 'item').id;
  const halbling = findCard('HALBLING', 'race').id;
  const a = makePlayer({ level: 3 });
  const h = makePlayer({ id: 'p2', name: 'B', level: 3, races: [halbling], hand: [karte] });
  const room = makeRoom([a, h]);
  S.startCombat(room, 'p1', [hase], { fromHand: false });
  room.combat.helperId = 'p2';
  const zufall = Math.random;
  Math.random = () => 0.99; // jeder Wurf eine 6 - ohne die Sperre waere die Flucht sogar geschafft
  try {
    S.hasenWurf(room, null);
    room.combat.mustFlee = true;
    S.handleAttemptFlee(room, 'p1', 0);
    S.handleAttemptFlee(room, 'p2', 0);
  } finally { Math.random = zufall; }
  assert.ok(!room.combat || !room.combat.fleeRerollOffer, 'kein Wiederholungsangebot fuer den gefangenen Helfer');
  assert.ok(room.pendingConsequence, 'der gefangene Halbling-Helfer bekommt trotzdem das Miese Zeug');
  assert.strictEqual(room.pendingConsequence.playerId, 'p2');
  assert.ok(h.hand.includes(karte), 'die Handkarte bleibt, da kein Angebot verbraucht wurde');
}
// Kam die helfende Person erst NACH dem Hasenwurf dazu, gilt die Sperre
// trotzdem - der Check in handleAttemptFlee liest c.helperId zum
// Flucht-Zeitpunkt, nicht zum Wurf-Zeitpunkt.
{
  const hase = findCard('DER GANZ NORMALE HASE', 'monster').id;
  const a = makePlayer({ level: 3 });
  const h = makePlayer({ id: 'p2', name: 'B', level: 3 });
  const room = makeRoom([a, h]);
  S.startCombat(room, 'p1', [hase], { fromHand: false });
  // noch kein Helfer beim Wurf.
  const zufall = Math.random;
  Math.random = () => 0.99; // jeder Wurf eine 6
  try {
    S.hasenWurf(room, null);
    assert.strictEqual(room.combat.helferGefangen, true);
    room.combat.helperId = 'p2'; // erst jetzt kommt die Hilfe dazu
    room.combat.mustFlee = true;
    S.handleAttemptFlee(room, 'p1', 0);
    S.handleAttemptFlee(room, 'p2', 0);
  } finally { Math.random = zufall; }
  assert.ok(room.pendingConsequence, 'die spaet dazugekommene Hilfe ist trotzdem gefangen');
  assert.strictEqual(room.pendingConsequence.playerId, 'p2', 'die spaet dazugekommene Hilfe scheitert');
}

fertig();
console.log('card-regelluecken-welle1: alle Checks gruen');
