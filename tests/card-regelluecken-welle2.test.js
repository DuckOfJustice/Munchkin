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

// --- TEMPORÄRE ANMNESIE: "Bis dahin wirst du überall als klassenloser Mensch
// gezählt." Ende: ein gewonnener Kampf, an dem die Person beteiligt war.
{
  const anmnesie = findCard('TEMPORÄRE ANMNESIE').id;
  const elf = findCard('ELF', 'race').id;
  const krieger = findCard('KRIEGER', 'class').id;
  const p = makePlayer({ races: [elf], classes: [krieger] });
  const room = makeRoom([p]);
  assert.ok(S.hasRace(p, 'ELF') && S.hasClass(p, 'KRIEGER'), 'Testvoraussetzung');
  S.addActiveCurse(room, p, 'TEMPORÄRE ANMNESIE', anmnesie);
  assert.ok(!S.hasRace(p, 'ELF'), 'Rasse vergessen');
  assert.ok(!S.hasClass(p, 'KRIEGER'), 'Klasse vergessen');
  assert.deepStrictEqual([p.races.length, p.classes.length], [1, 1], 'die Karten bleiben ausliegen');
  // Monsterbonus gegen Elfen greift nicht mehr.
  const sauger = findCard('GESICHTSSAUGER', 'monster');
  S.startCombat(room, 'p1', [sauger.id], { fromHand: false });
  assert.strictEqual(S.combatTotals(room).monsterStrength, sauger.level, '"+6 gegen Elfen" zaehlt nicht mehr');
  room.combat = null;
}
// Ein Gegenstand, der eine Klasse verleiht, zaehlt ebenfalls nicht.
{
  const anmnesie = findCard('TEMPORÄRE ANMNESIE').id;
  const ohren = findCard('FALSCHE OHREN');
  const p = makePlayer();
  p.equipped.special = [ohren.id];
  const room = makeRoom([p]);
  assert.ok(S.monsterSeesRace(p, 'ELF'), 'Testvoraussetzung: Falsche Ohren machen zum Elfen');
  S.addActiveCurse(room, p, 'TEMPORÄRE ANMNESIE', anmnesie);
  assert.ok(!S.monsterSeesRace(p, 'ELF'), 'auch geliehene Rassen sind vergessen');
}
// Ende: gewonnener Kampf, kaempfend ODER helfend.
{
  const anmnesie = findCard('TEMPORÄRE ANMNESIE').id;
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const ende = (alsHelfer) => {
    const a = makePlayer({ id: 'p1', name: 'A', level: 9 });
    const h = makePlayer({ id: 'p2', name: 'B' });
    const room = makeRoom([a, h]);
    const opfer = alsHelfer ? h : a;
    S.addActiveCurse(room, opfer, 'TEMPORÄRE ANMNESIE', anmnesie);
    S.startCombat(room, 'p1', [monster.id], { fromHand: false });
    if (alsHelfer) room.combat.helperId = 'p2';
    S.resolveCombatWin(room);
    return !opfer.activeCurses.some((f) => f.kind === 'traitsVergessen');
  };
  assert.ok(ende(false), 'eigener Sieg beendet die Anmnesie');
  assert.ok(ende(true), 'Sieg als Hilfe beendet die Anmnesie');
}

fertig();
console.log('card-regelluecken-welle2: alle Checks gruen');
