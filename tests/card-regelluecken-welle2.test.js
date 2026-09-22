// Regellücken Welle 2 (Spec 2026-09-22-regelluecken-welle2-design.md):
// Touristenfalle, Hungriger Rucksack, Temporäre Anmnesie, Gummi-Golem.
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

// --- TOURISTENFALLE: "Du darfst nicht 'Auf Ärger aus sein'. Dieser Fluch
// bleibt bestehen, bis du einem anderen Spieler geholfen hast, einen Kampf zu
// gewinnen."
{
  const falle = findCard('TOURISTENFALLE').id;
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const p = makePlayer({ hand: [monster.id] });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  S.addActiveCurse(room, p, 'TOURISTENFALLE', falle);
  assert.ok(p.activeCurses.some((f) => f.kind === 'keinAergerSuchen'), 'Fluch ist eingetragen');
  S.handlePlayMonsterFromHand(room, 'p1', monster.id);
  assert.strictEqual(room.combat, null, 'kein Kampf: "Auf Ärger aus sein" ist gesperrt');
  assert.ok(p.hand.includes(monster.id), 'das Monster bleibt auf der Hand');
  assert.ok(room.logs.some((l) => /Touristenfalle/i.test(l.text)), 'der Verlauf nennt den Grund');
}
// Gegenprobe: ohne Fluch startet der Kampf.
{
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const p = makePlayer({ hand: [monster.id] });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  S.handlePlayMonsterFromHand(room, 'p1', monster.id);
  assert.ok(room.combat, 'ohne Fluch beginnt der Kampf');
}
// Ende: nur ein Sieg als HELFENDE Person beendet den Fluch.
{
  const falle = findCard('TOURISTENFALLE').id;
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const a = makePlayer({ id: 'p1', name: 'A', level: 9 });
  const h = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([a, h]);
  S.addActiveCurse(room, h, 'TOURISTENFALLE', falle);
  S.startCombat(room, 'p1', [monster.id], { fromHand: false });
  room.combat.helperId = 'p2';
  S.resolveCombatWin(room);
  assert.ok(!h.activeCurses.some((f) => f.kind === 'keinAergerSuchen'), 'Sieg als Hilfe beendet den Fluch');
}
{
  const falle = findCard('TOURISTENFALLE').id;
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const a = makePlayer({ id: 'p1', name: 'A', level: 9 });
  const room = makeRoom([a, makePlayer({ id: 'p2', name: 'B' })]);
  S.addActiveCurse(room, a, 'TOURISTENFALLE', falle);
  S.startCombat(room, 'p1', [monster.id], { fromHand: false });
  S.resolveCombatWin(room);
  assert.ok(a.activeCurses.some((f) => f.kind === 'keinAergerSuchen'), 'der eigene Sieg beendet den Fluch nicht');
}

fertig();
console.log('card-regelluecken-welle2: alle Checks gruen');
