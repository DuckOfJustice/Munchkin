// Regellücken Welle 3 (Spec 2026-09-22-regelluecken-welle3-design.md):
// Verstärker pro Monster, Barde "Verzaubern" und "Bardenglück".
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

// --- Verstärker haengen am Monster ------------------------------------------
// URALT: "+10 fuer das Monster", dazu 2 zusaetzliche Schaetze.
{
  const uralt = findCard('URALT');
  const m1 = findCard('LAHMER GOBLIN', 'monster');
  const m2 = findCard('MR. BONES', 'monster');
  const p = makePlayer({ hand: [uralt.id] });
  const room = makeRoom([p]);
  S.startCombat(room, 'p1', [m1.id, m2.id], { fromHand: false });
  const vorher = S.combatTotals(room).monsterStrength;
  S.handlePlayCombatCard(room, 'p1', uralt.id);
  // Zwei Monster im Kampf: erst das Ziel waehlen.
  assert.ok(room.pendingCardAction, 'bei zwei Monstern wird das Zielmonster gewaehlt');
  const option = room.pendingCardAction.options.find((o) => o.label.includes(m1.name));
  assert.ok(option, `Wahl nennt "${m1.name}"`);
  S.handleResolveCardChoice(room, 'p1', option.id);
  assert.strictEqual(S.combatTotals(room).monsterStrength, vorher + uralt.bonus, 'der Bonus zaehlt');
  assert.deepStrictEqual(room.combat.enhancers.map((e) => e.monsterId), [m1.id], 'der Verstaerker haengt am gewaehlten Monster');

  // Das verstaerkte Monster verschwindet -> sein Bonus geht mit.
  const polly = findCard('POLLYVERWANDLUNGSTRANK');
  p.hand.push(polly.id);
  S.handlePlayCombatCard(room, 'p1', polly.id);
  const monsterWahl = room.pendingCardAction.options.find((o) => o.label.includes(m1.name));
  S.handleResolveCardChoice(room, 'p1', monsterWahl.id);
  assert.ok(!room.combat.monsterIds.includes(m1.id), 'das Monster ist weg');
  assert.strictEqual(S.combatTotals(room).monsterStrength, m2.level, 'mit dem Monster ist auch sein Verstaerker weg');
}
// Gegenprobe: bei genau einem Monster keine Zielabfrage.
{
  const uralt = findCard('URALT');
  const m1 = findCard('LAHMER GOBLIN', 'monster');
  const p = makePlayer({ hand: [uralt.id] });
  const room = makeRoom([p]);
  S.startCombat(room, 'p1', [m1.id], { fromHand: false });
  S.handlePlayCombatCard(room, 'p1', uralt.id);
  assert.strictEqual(room.pendingCardAction, null, 'ein Monster: keine Rueckfrage');
  assert.strictEqual(S.combatTotals(room).monsterStrength, m1.level + uralt.bonus, 'der Bonus zaehlt trotzdem');
}

fertig();
console.log('card-regelluecken-welle3: alle Checks gruen');
