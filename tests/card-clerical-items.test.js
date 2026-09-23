// Clerical Errors, Task 5 (Plan 2026-09-13): Gegenstands-Anhaenge und die
// uebrigen Gegenstands-Sonderfaelle.
//
// Kartenanhaenge haengen am GEGENSTAND, nicht an der Person ("Diese Karte
// bleibt beim Gegenstand, egal ob er verloren, gestohlen oder abgelegt wird")
// - deshalb liegt die Tabelle am Raum (room.itemAttachments).
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, handleAttachCard, attachmentIds, istGrosserGegenstand,
  equippedBonusSum, canCarryAnotherBigItem, handleEquipItem, applyPrimitiveAction,
  handleThiefBackstab, backstabMalus, combatTotals, isBigItem,
  applyCombatPotionAction, COMBAT_POTION_OVERRIDES,
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
function makeRoom(players, monsterIds) {
  const room = {
    code: 'TEST', players, turnIndex: 0, turnPhase: 'kampf',
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
    itemAttachments: {}, logs: [], combatHappenedThisTurn: false,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
    combat: monsterIds ? {
      actorId: players[0].id, helperId: null, monsterIds, enhancers: [],
      actorModifier: 0, monsterModifier: 0, treasureDelta: 0, backstabs: {},
      mustFlee: false, classDiscards: {}, ready: {}, readySignature: null,
    } : null,
  };
  raeume.push(room);
  return room;
}

// --- VERGIFTET: +2 an einem Gegenstand mit Kampfbonus ----------------------
{
  const gift = findCard('VERGIFTET');
  const klinge = findCard('VORPALE KLINGE'); // +3
  const p = makePlayer({ hand: [gift.id] });
  p.equipped.hands = [klinge.id, null];
  const room = makeRoom([p]);

  assert.strictEqual(equippedBonusSum(p, room), 3, 'vorher nur der gedruckte Bonus');
  handleAttachCard(room, p.id, gift.id, klinge.id);
  assert.deepStrictEqual(attachmentIds(room, klinge.id), [gift.id]);
  assert.deepStrictEqual(p.hand, [], 'die Anhangkarte verlaesst die Hand');
  assert.strictEqual(equippedBonusSum(p, room), 5, '+2 durch den Anhang');

  // Der Anhang bleibt am Gegenstand, auch wenn er den Besitzer wechselt.
  const q = makePlayer({ id: 'p2', name: 'B' });
  room.players.push(q);
  p.equipped.hands = [null, null];
  q.equipped.hands = [klinge.id, null];
  assert.strictEqual(equippedBonusSum(q, room), 5, 'der Anhang wandert mit dem Gegenstand');
}

// Ohne Kampfbonus laesst der Server den Anhang nicht zu.
{
  const segen = findCard('GESEGNET');
  const ohneBonus = findCard('WUNSCHRING'); // kein bonus
  const p = makePlayer({ hand: [segen.id, ohneBonus.id] });
  const room = makeRoom([p]);
  handleAttachCard(room, p.id, segen.id, ohneBonus.id);
  assert.deepStrictEqual(attachmentIds(room, ohneBonus.id), [], 'abgelehnt');
  assert.ok(p.hand.includes(segen.id), 'die Karte bleibt auf der Hand');
}

// --- NÜTZLICHE GRIFFE: Grosser Gegenstand zaehlt als klein -----------------
{
  const griffe = findCard('NÜTZLICHE GRIFFE');
  const leier = findCard('GROSSE, FIESE LEIER');
  assert.ok(isBigItem(leier), 'die Leier ist ein Grosser Gegenstand');
  const p = makePlayer({ hand: [griffe.id] });
  p.equipped.hands = [leier.id, null];
  const room = makeRoom([p]);

  assert.ok(istGrosserGegenstand(room, leier.id));
  assert.ok(!canCarryAnotherBigItem(p, room), 'mit einem Grossen ist Schluss');
  handleAttachCard(room, p.id, griffe.id, leier.id);
  assert.ok(!istGrosserGegenstand(room, leier.id), 'mit Griffen nicht mehr gross');
  assert.ok(canCarryAnotherBigItem(p, room), 'also passt wieder einer dazu');
}

// --- ZWEIHÄNDIGES SCHWERT kostet netto keine Hand --------------------------
{
  const schwert = findCard('ZWEIHÄNDIGES SCHWERT');
  const a = findCard('VORPALE KLINGE');
  const b = findCard('SCHLITTENGLOCKE');
  const p = makePlayer({ hand: [schwert.id] });
  p.equipped.hands = [a.id, b.id]; // beide Haende belegt
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, schwert.id);
  assert.ok(!p.hand.includes(schwert.id), 'das Schwert liegt trotz voller Haende an');
  assert.ok(p.equipped.special.includes(schwert.id), 'es belegt keinen Handplatz');
  assert.strictEqual(equippedBonusSum(p, room), a.bonus + b.bonus + schwert.bonus);
}

// --- SPASSBREMSE: toedlich in Gnomenhand -----------------------------------
{
  const bremse = findCard('SPASSBREMSE');
  const gnom = findCard('GNOM', 'door_other');
  const p = makePlayer({ races: [gnom.id], level: 7, hand: [bremse.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, bremse.id);
  // Tod kostet alle Karten, aber keine Stufe (gedruckte Regel).
  assert.strictEqual(p.level, 7, 'der Gnom stirbt, behaelt aber seine Stufe');
  assert.strictEqual(p.hand.length, 0, 'der Tod kostet alle Handkarten');
  assert.deepStrictEqual(p.equipped.hands, [null, null], 'angelegt wurde sie nicht');

  // Alle anderen legen sie ganz normal an.
  const q = makePlayer({ id: 'p2', name: 'B', hand: [bremse.id] });
  const room2 = makeRoom([q]);
  handleEquipItem(room2, q.id, bremse.id);
  assert.ok(q.equipped.hands.includes(bremse.id));
}

// --- GNOMEX-ANZUG faellt mit der Ruestung ----------------------------------
{
  const anzug = findCard('GNOMEX-ANZUG');
  const bikini = findCard('KETTEN-BIKINI');
  const p = makePlayer({ hand: [anzug.id] });
  p.equipped.armor = bikini.id;
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, anzug.id);
  assert.ok(p.equipped.special.includes(anzug.id), 'liegt ueber der Ruestung an');
  applyPrimitiveAction(room, p, { type: 'discardSlot', slot: 'armor' });
  assert.strictEqual(p.equipped.armor, null);
  assert.ok(!p.equipped.special.includes(anzug.id), 'die GESAMTE Ruestung ist weg');
}

// --- STICH-O-MAT: Rueckenfall fuer Nicht-Diebe, +1 fuer Diebe --------------
{
  const stich = findCard('STICH-O-MAT');
  const dieb = findCard('DIEB', 'class');
  const monster = findCard('MEDUSA', 'monster');

  // Nicht-Dieb mit Stich-o-Mat: darf ueberhaupt, fuer -2.
  const a = makePlayer({ id: 'p1', name: 'A', hand: [findCard('WUNSCHRING').id] });
  a.equipped.hands = [stich.id, null];
  const opfer = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([opfer, a], [monster.id]);
  room.combat.actorId = opfer.id;
  handleThiefBackstab(room, a.id, a.hand[0], opfer.id);
  assert.strictEqual(backstabMalus(room), -2, 'Nicht-Dieb mit Stich-o-Mat: -2');

  // Dieb mit Stich-o-Mat: -3 statt -2.
  const d = makePlayer({ id: 'p3', name: 'C', classes: [dieb.id], hand: [findCard('WUNSCHRING').id] });
  d.equipped.hands = [stich.id, null];
  const opfer2 = makePlayer({ id: 'p4', name: 'D' });
  const room2 = makeRoom([opfer2, d], [monster.id]);
  room2.combat.actorId = opfer2.id;
  handleThiefBackstab(room2, d.id, d.hand[0], opfer2.id);
  assert.strictEqual(backstabMalus(room2), -3, 'Dieb mit Stich-o-Mat: -3');

  // Ohne beides geht gar nichts.
  const e = makePlayer({ id: 'p5', name: 'E', hand: [findCard('WUNSCHRING').id] });
  const opfer3 = makePlayer({ id: 'p6', name: 'F' });
  const room3 = makeRoom([opfer3, e], [monster.id]);
  room3.combat.actorId = opfer3.id;
  handleThiefBackstab(room3, e.id, e.hand[0], opfer3.id);
  assert.strictEqual(backstabMalus(room3), 0, 'ohne Dieb und ohne Stich-o-Mat kein Rueckenfall');
}

// --- HALBFINAL-SCHLAG: dreifacher Bonus fuer einen Kampf -------------------
{
  const klinge = findCard('VORPALE KLINGE'); // +3
  const p = makePlayer({});
  p.equipped.hands = [klinge.id, null];
  const room = makeRoom([p], [findCard('MEDUSA', 'monster').id]);
  const spec = COMBAT_POTION_OVERRIDES['HALBFINAL-SCHLAG'](p, room);
  assert.strictEqual(spec.type, 'choice');
  assert.strictEqual(spec.options.length, 1, 'nur der eine Gegenstand steht zur Wahl');

  const vorher = combatTotals(room).playerStrength;
  applyCombatPotionAction(room, p, spec.options[0].action, findCard('HALBFINAL-SCHLAG'));
  assert.strictEqual(combatTotals(room).playerStrength - vorher, klinge.bonus * 2,
    'aus einfach wird dreifach - egal ob der Wuerfel den Gegenstand kostet');

  // Ohne passenden Gegenstand ist die Karte nicht spielbar.
  assert.strictEqual(COMBAT_POTION_OVERRIDES['HALBFINAL-SCHLAG'](makePlayer({}), room), null);
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-clerical-items: ok');
