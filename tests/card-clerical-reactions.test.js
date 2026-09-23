// Clerical Errors, Task 6 (Plan 2026-09-13): Reaktionen auf Wuerfel, Flueche
// und fremde Siege.
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, fluchZiel, ROLL_REACTION_CARDS, ROLL_REROLL_CARDS,
  handlePlayReactionCard, rollWithWindow, TREASURE_POWER_OVERRIDES,
  COMBAT_POTION_OVERRIDES, applyCombatPotionAction,
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
    isBot: false, connected: true, gender: 'm', genderBeiSlippern: null,
  }, overrides || {});
}

const raeume = [];
function makeRoom(players, extra) {
  const room = Object.assign({
    code: 'TEST', players, turnIndex: 0, turnPhase: 'kampf',
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
    itemAttachments: {}, logs: [], combat: null, combatHappenedThisTurn: false,
    lastCombatWinnerId: null, pendingRoll: null,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  }, extra || {});
  raeume.push(room);
  return room;
}

// --- KATZENINTERVENTION wuerfelt neu ---------------------------------------
{
  assert.ok(ROLL_REACTION_CARDS.has('KATZENINTERVENTION'), 'reagiert auf Wuerfelwuerfe');
  assert.ok(ROLL_REROLL_CARDS.has('KATZENINTERVENTION'), 'und wuerfelt neu statt zu setzen');
  assert.ok(!ROLL_REROLL_CARDS.has('GEZINKTER WÜRFEL'), 'der gezinkte Wuerfel setzt weiterhin den Wert');

  const katze = findCard('KATZENINTERVENTION');
  const p = makePlayer({ hand: [katze.id] });
  const room = makeRoom([p]);
  let ergebnis = null;
  rollWithWindow(room, p, 'test', (wurf) => { ergebnis = wurf; });
  assert.ok(room.pendingRoll, 'das Fenster ist offen, weil jemand die Katze haelt');
  assert.strictEqual(ergebnis, null, 'noch nichts aufgeloest');

  // Der uebergebene Wert wird bei der Katze ignoriert - sie wuerfelt neu.
  // Math.random wird dafuer festgenagelt: ohne das waere "1 <= ergebnis <= 6"
  // auch dann wahr, wenn die Katze den uebergebenen Wert einfach setzt - der
  // Unterschied zum GEZINKTEN WÜRFEL waere untestbar.
  const echtesRandom = Math.random;
  Math.random = () => 0; // -> rollDie() === 1, also garantiert nicht die 6
  try {
    handlePlayReactionCard(room, p.id, katze.id, 6);
  } finally {
    Math.random = echtesRandom;
  }
  assert.strictEqual(ergebnis, 1, 'die Katze wuerfelt neu, statt die uebergebene 6 zu setzen');
  assert.deepStrictEqual(p.hand, [], 'die Karte ist verbraucht');
  assert.strictEqual(room.pendingRoll, null);
}

// --- DAS MANCHMAL VERLÄSSLICHE AMULETT -------------------------------------
{
  const amulett = findCard('DAS MANCHMAL VERLÄSSLICHE AMULETT');
  const fluch = findCard('HUHN AUF DEINEM KOPF', 'door_other');

  // 200 Durchlaeufe: manchmal blockt es (dann ist das Ziel null und das
  // Amulett bleibt), manchmal nicht (dann ist es abgeworfen).
  let geblockt = 0; let durch = 0;
  for (let i = 0; i < 200; i++) {
    const p = makePlayer({ level: 5 });
    p.equipped.special = [amulett.id];
    const room = makeRoom([p]);
    let ziel; fluchZiel(room, p, null, fluch, (o) => { ziel = o; });
    if (ziel === null) {
      geblockt++;
      assert.ok(p.equipped.special.includes(amulett.id), 'beim Blocken bleibt das Amulett');
      assert.ok(p.level === 5 || p.level === 6, 'bei einer 6 gibt es zusaetzlich 1 Stufe');
    } else {
      durch++;
      assert.strictEqual(ziel.id, p.id, 'ohne Block trifft der Fluch die Person selbst');
      assert.ok(!p.equipped.special.includes(amulett.id), 'und das Amulett ist abgeworfen');
    }
  }
  assert.ok(geblockt > 0 && durch > 0, `beide Ausgaenge kommen vor (${geblockt} geblockt, ${durch} durch)`);
}

// --- PRÄCHTIGER HUT wirft den Fluch auf jemand anderen ---------------------
{
  const hut = findCard('PRÄCHTIGER HUT');
  const fluch = findCard('HUHN AUF DEINEM KOPF', 'door_other');
  const a = makePlayer({ id: 'p1', name: 'A' });
  a.equipped.head = hut.id;
  const b = makePlayer({ id: 'p2', name: 'B' });
  const c = makePlayer({ id: 'p3', name: 'C' });
  const room = makeRoom([a, b, c]);
  for (let i = 0; i < 50; i++) {
    let ziel; fluchZiel(room, a, null, fluch, (o) => { ziel = o; });
    assert.ok(ziel && ziel.id !== a.id, 'der Hut traegt den Fluch immer weiter');
  }
  // Allein am Tisch gibt es niemanden, auf den zurueckgeworfen werden koennte.
  const allein = makeRoom([a]);
  let alleinZiel; fluchZiel(allein, a, null, fluch, (o) => { alleinZiel = o; });
  assert.strictEqual(alleinZiel.id, a.id);
}

// --- HEIMSE DIE LORBEEREN EIN: nur nach einem FREMDEN Sieg -----------------
{
  const p = makePlayer({ id: 'p1' });
  const q = makePlayer({ id: 'p2', name: 'B' });
  const spec = TREASURE_POWER_OVERRIDES['HEIMSE DIE LORBEEREN EIN'];
  assert.strictEqual(spec(p, makeRoom([p, q])), null, 'ohne Kampf nicht spielbar');
  assert.strictEqual(spec(p, makeRoom([p, q], { lastCombatWinnerId: p.id })), null, 'der eigene Sieg zaehlt nicht');
  assert.deepStrictEqual(spec(p, makeRoom([p, q], { lastCombatWinnerId: q.id })), { type: 'levelUp', amount: 1 });
}

// --- NIMM MICH! NIMM MICH!: Hilfe erzwingen --------------------------------
{
  const a = makePlayer({ id: 'p1', name: 'A' });
  const b = makePlayer({ id: 'p2', name: 'B' });
  const combat = {
    actorId: a.id, helperId: null, helperPending: null,
    monsterIds: [findCard('MEDUSA', 'monster').id], enhancers: [],
    actorModifier: 0, monsterModifier: 0, treasureDelta: 0, backstabs: {},
    mustFlee: false, classDiscards: {}, ready: {}, readySignature: null,
  };
  const room = makeRoom([a, b], { combat });
  const spec = COMBAT_POTION_OVERRIDES['NIMM MICH! NIMM MICH!'];
  assert.strictEqual(spec(a, room), null, 'die kaempfende Person kann sich nicht selbst helfen');
  assert.deepStrictEqual(spec(b, room), { type: 'forceSelfAsHelper' });

  applyCombatPotionAction(room, b, spec(b, room), findCard('NIMM MICH! NIMM MICH!'));
  assert.strictEqual(room.combat.helperId, b.id, 'B hilft jetzt, ob A will oder nicht');
  assert.strictEqual(spec(b, room), null, 'mit Helfer:in ist die Karte nicht mehr spielbar');
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-clerical-reactions: ok');
