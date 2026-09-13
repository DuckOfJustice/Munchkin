// Clerical Errors, Task 1 (Plan 2026-09-13): ORK, GNOM und BARDE.
//
// Die drei Karten stehen in data/cards.json als "door_other" und waren damit
// gar nicht ausspielbar - handlePlayRaceOrClass fiel in seinen else-Zweig.
// Getestet wird deshalb zuerst die Spielbarkeit, danach die vier Kraefte, die
// dieser Server automatisch verrechnet:
//
//   ORK:   "Wenn ein Ork, der alleine kaempft, ein Monster um mehr als 10
//          Punkte besiegt, steigt er eine zusaetzliche Stufe auf."
//   GNOM:  "Du erhaeltst +1 fuer jeden nicht-einmal einsetzbaren Gegenstand,
//          der mit den Buchstaben G oder N beginnt."
//   GNOM:  "Monster behandeln dich wie einen Halbling."
//   GNOM:  "Monster, die ein 'Nase' im Namen haben, werden dich nicht
//          angreifen. Wenn du sie nicht besiegen kannst, wirst du automatisch
//          weglaufen."
//   BARDE: "Bardenglueck: Wenn du in deinem Zug einen Kampf gewinnst, ziehe
//          einen zusaetzlichen Schatz."
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, handlePlayRaceOrClass, raceItemBonusSum,
  monsterSeesRace, fleeIsAutomatic, monsterVictoryExtras, combatTotals,
  TRAIT_DOOR_CARDS,
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

// touchRoom() haengt an jedem Raum einen Aufraeum-Timer - ohne clearTimeout
// am Ende laeuft der Testprozess nicht aus (gleiche Bauform wie
// tests/card-abilities.test.js).
const raeume = [];
function makeRoom(players) {
  const room = {
    code: 'TEST', players, turnIndex: 0, turnPhase: 'tuer',
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
    logs: [], combat: null, combatHappenedThisTurn: false,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  };
  raeume.push(room);
  return room;
}

// --- Spielbarkeit ----------------------------------------------------------
assert.deepStrictEqual(TRAIT_DOOR_CARDS, { ORK: 'race', GNOM: 'race', BARDE: 'class' });

['ORK', 'GNOM'].forEach((name) => {
  const c = findCard(name, 'door_other');
  const p = makePlayer({ hand: [c.id] });
  const room = makeRoom([p]);
  handlePlayRaceOrClass(room, p.id, c.id);
  assert.deepStrictEqual(p.races, [c.id], `${name} muss als Rasse angelegt werden`);
  assert.deepStrictEqual(p.hand, [], `${name} muss die Hand verlassen`);
});

{
  const c = findCard('BARDE', 'door_other');
  const p = makePlayer({ hand: [c.id] });
  const room = makeRoom([p]);
  handlePlayRaceOrClass(room, p.id, c.id);
  assert.deepStrictEqual(p.classes, [c.id], 'BARDE muss als Klasse angelegt werden');
}

// Obergrenze gilt weiter: ohne HALB-BLUT keine zweite Rasse.
{
  const ork = findCard('ORK', 'door_other');
  const gnom = findCard('GNOM', 'door_other');
  const p = makePlayer({ races: [ork.id], hand: [gnom.id] });
  const room = makeRoom([p]);
  handlePlayRaceOrClass(room, p.id, gnom.id);
  assert.deepStrictEqual(p.races, [ork.id], 'zweite Rasse ohne Halb-Blut abgelehnt');
  assert.deepStrictEqual(p.hand, [gnom.id], 'abgelehnte Karte bleibt auf der Hand');
}

// --- GNOM: +1 je G/N-Gegenstand -------------------------------------------
{
  const gnom = findCard('GNOM', 'door_other');
  const p = makePlayer({ races: [gnom.id] });
  assert.strictEqual(raceItemBonusSum(p), 0, 'ohne Ausruestung kein Gnom-Bonus');

  // GHOULPEITSCHE (G) und NAPALMSTAB (N) zaehlen, VORPALE KLINGE (V) nicht.
  const g = findCard('GHOULPEITSCHE');
  const n = findCard('NAPALMSTAB');
  const v = findCard('VORPALE KLINGE');
  p.equipped.hands = [g.id, n.id];
  assert.strictEqual(raceItemBonusSum(p), 2, 'G- und N-Gegenstand geben je +1');
  p.equipped.hands = [v.id, null];
  assert.strictEqual(raceItemBonusSum(p), 0, 'andere Anfangsbuchstaben zaehlen nicht');

  // Ohne die Rasse gibt es den Bonus nicht.
  const ohne = makePlayer({ equipped: newEquipped() });
  ohne.equipped.hands = [g.id, n.id];
  assert.strictEqual(raceItemBonusSum(ohne), 0, 'Bonus haengt an der Rasse');
}

// --- GNOM: Monster sehen einen Halbling ------------------------------------
{
  const gnom = findCard('GNOM', 'door_other');
  const p = makePlayer({ races: [gnom.id] });
  assert.ok(monsterSeesRace(p, 'HALBLING'), 'Monster behandeln den Gnom als Halbling');
  assert.ok(!monsterSeesRace(p, 'ELF'), 'aber nicht als Elf');

  // Wirkt sich auf die Kampfrechnung aus: STRICHMAENNCHEN hat "+4 gegen
  // Halblinge" (MONSTER_TRAIT_BONUS).
  const monster = findCard('STRICHMÄNNCHEN', 'monster');
  const room = makeRoom([p]);
  room.combat = {
    actorId: p.id, helperId: null, monsterIds: [monster.id],
    actorModifier: 0, monsterModifier: 0, backstabbed: {},
  };
  const mitGnom = combatTotals(room).monsterStrength;
  p.races = [];
  const ohneGnom = combatTotals(room).monsterStrength;
  assert.strictEqual(mitGnom - ohneGnom, 4, 'Halbling-Bonus des Monsters trifft den Gnom');
}

// --- GNOM: automatische Flucht vor "Nase"-Monstern -------------------------
{
  const gnom = findCard('GNOM', 'door_other');
  const p = makePlayer({ races: [gnom.id] });
  const nase = findCard('LAUFENDE NASE', 'monster');
  const anderes = findCard('STRICHMÄNNCHEN', 'monster');
  const room = makeRoom([p]);

  room.combat = { actorId: p.id, monsterIds: [nase.id] };
  assert.ok(fleeIsAutomatic(room, p), 'Gnom entkommt der Laufenden Nase automatisch');

  room.combat = { actorId: p.id, monsterIds: [nase.id, anderes.id] };
  assert.ok(!fleeIsAutomatic(room, p), 'ein nicht betroffenes Monster macht die Flucht wieder zur Wuerfelsache');

  room.combat = { actorId: p.id, monsterIds: [nase.id] };
  p.races = [];
  assert.ok(!fleeIsAutomatic(room, p), 'ohne Gnom gilt die Regel nicht');
}

// --- ORK: Sieg allein mit mehr als 10 Punkten Abstand ----------------------
{
  const ork = findCard('ORK', 'door_other');
  const monster = findCard('STRICHMÄNNCHEN', 'monster'); // Stufe 1
  const p = makePlayer({ races: [ork.id], level: 20 });
  const room = makeRoom([p]);
  room.combat = {
    actorId: p.id, helperId: null, monsterIds: [monster.id],
    actorModifier: 0, monsterModifier: 0, backstabbed: {},
  };
  // 20 gegen 1+4 (Halbling-Bonus greift nicht) -> Abstand 19 > 10.
  let extras = monsterVictoryExtras(room, p, null, [monster]);
  assert.strictEqual(extras.levels, 1, 'Ork bekommt die Extrastufe');

  // Mit Helfer:in gilt "alleine kaempft" nicht mehr.
  const helfer = makePlayer({ id: 'p2', name: 'B' });
  room.players.push(helfer);
  room.combat.helperId = helfer.id;
  extras = monsterVictoryExtras(room, p, helfer, [monster]);
  assert.strictEqual(extras.levels, 0, 'mit Hilfe keine Extrastufe');

  // Knapper Sieg reicht nicht.
  room.combat.helperId = null;
  p.level = 3;
  extras = monsterVictoryExtras(room, p, null, [monster]);
  assert.strictEqual(extras.levels, 0, 'Abstand von 10 oder weniger gibt keine Extrastufe');
}

// --- BARDE: Bardenglueck ---------------------------------------------------
{
  const barde = findCard('BARDE', 'door_other');
  const monster = findCard('STRICHMÄNNCHEN', 'monster');
  const p = makePlayer({ classes: [barde.id] });
  const room = makeRoom([p]);
  room.combat = {
    actorId: p.id, helperId: null, monsterIds: [monster.id],
    actorModifier: 0, monsterModifier: 0, backstabbed: {},
  };
  assert.strictEqual(monsterVictoryExtras(room, p, null, [monster]).treasures, 1,
    'Barde zieht einen Extraschatz');
  p.classes = [];
  assert.strictEqual(monsterVictoryExtras(room, p, null, [monster]).treasures, 0,
    'ohne Barde kein Extraschatz');
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });

console.log('card-clerical-traits: ok');
