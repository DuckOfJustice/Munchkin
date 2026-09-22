// Clerical Errors, Task 4 (Plan 2026-09-13): Kampfkarten, Traenke und
// ZWERGENBIER.
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, combatTotals, addActiveCurse, curseCombatModifier,
  COMBAT_POTION_OVERRIDES, TREASURE_POWER_OVERRIDES, DOOR_COMBAT_CARDS,
  DOOR_OTHER_AS_CURSE, applyCombatPotionAction, combatHasUndead,
  ITEM_CONDITIONAL_BONUS, FLEE_ITEM_BONUS, SPECIAL_SLOT_ITEMS, isCombatPotionCard,
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
    logs: [], combatHappenedThisTurn: false,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
    combat: monsterIds ? {
      actorId: players[0].id, helperId: null, monsterIds, enhancerIds: [],
      actorModifier: 0, monsterModifier: 0, treasureDelta: 0, backstabbed: {},
      mustFlee: false, classDiscards: {}, ready: {}, readySignature: null,
    } : null,
  };
  raeume.push(room);
  return room;
}

// --- MONSTERFUTTER: "+5 fuer beide Seiten" ---------------------------------
{
  const futter = findCard('MONSTERFUTTER');
  assert.ok(isCombatPotionCard(futter), 'MONSTERFUTTER ist jetzt als Kampf-Trank spielbar');
  const p = makePlayer({});
  const room = makeRoom([p], [findCard('MEDUSA', 'monster').id]);
  const vorher = combatTotals(room);
  applyCombatPotionAction(room, p, COMBAT_POTION_OVERRIDES['MONSTERFUTTER'](p, room), futter);
  const nachher = combatTotals(room);
  assert.strictEqual(nachher.playerStrength - vorher.playerStrength, 5);
  assert.strictEqual(nachher.monsterStrength - vorher.monsterStrength, 5);
}

// --- SCHARFE PFEFFERSOSSE: +3, mit Halbling im Kampf +6 --------------------
{
  const p = makePlayer({});
  const room = makeRoom([p], [findCard('MEDUSA', 'monster').id]);
  assert.strictEqual(COMBAT_POTION_OVERRIDES['SCHARFE PFEFFERSOSSE'](p, room).amount, 3);
  p.races = [findCard('HALBLING', 'race').id];
  assert.strictEqual(COMBAT_POTION_OVERRIDES['SCHARFE PFEFFERSOSSE'](p, room).amount, 6,
    'zur Hilfe von Halblingen +6');
}

// --- DEUS EX MASCHINENGEWEHR: kein Schatz, keine Stufe, kein Pluendern -----
{
  const spec = COMBAT_POTION_OVERRIDES['DEUS EX MASCHINENGEWEHR']();
  assert.strictEqual(spec.type, 'endCombatNoLevel');
  assert.ok(!spec.leavesTreasure, 'die Goetter nehmen den Schatz mit');
  assert.ok(!spec.thenLoot, 'und pluendern darf man auch nicht');
}

// --- TRANK DER APATHIE: nur mit Helfer:in einsetzbar -----------------------
{
  const a = makePlayer({ id: 'p1' });
  const b = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([a, b], [findCard('MEDUSA', 'monster').id]);
  assert.strictEqual(COMBAT_POTION_OVERRIDES['TRANK DER APATHIE'](a, room), null, 'ohne Helfer nicht spielbar');
  room.combat.helperId = b.id;
  assert.deepStrictEqual(COMBAT_POTION_OVERRIDES['TRANK DER APATHIE'](a, room), { type: 'removeHelper' });
}

// --- EINHEITSGRÖSSE: nur im Kampf ------------------------------------------
{
  const p = makePlayer({});
  assert.strictEqual(TREASURE_POWER_OVERRIDES['EINHEITSGRÖSSE'](p, makeRoom([p])), null, 'ausserhalb des Kampfes nicht');
  const imKampf = makeRoom([p], [findCard('MEDUSA', 'monster').id]);
  assert.strictEqual(TREASURE_POWER_OVERRIDES['EINHEITSGRÖSSE'](p, imKampf).type, 'takeFirstWearableFromTreasureDiscard');
}

// --- DER ANDERE RING als Wunschring-Ersatz ---------------------------------
{
  const p = makePlayer({});
  assert.strictEqual(TREASURE_POWER_OVERRIDES['DER ANDERE RING'](p, makeRoom([p])), null, 'ohne Fluch nichts zu beenden');
  p.activeCurses = [{ name: 'HUHN AUF DEINEM KOPF', kind: 'rollMalus', amount: -1 }];
  // Die Aktion nennt die Id des Eintrags statt eines Listenindex - siehe
  // fluchBeendenSpec in src/cards/treasures.js.
  const ringSpec = TREASURE_POWER_OVERRIDES['DER ANDERE RING'](p, makeRoom([p]));
  assert.deepStrictEqual(ringSpec,
    { type: 'clearCurse', id: p.activeCurses[0].id, kind: 'rollMalus', name: 'HUHN AUF DEINEM KOPF', itemId: null });
}

// --- TYPOGRAFISCHER FEHLER: staerkstes Monster zaehlt als Stufe 1 ----------
{
  const medusa = findCard('MEDUSA', 'monster');      // Stufe 19
  const fisch = findCard('GOLDFISCH', 'monster');    // Stufe 1
  const p = makePlayer({});
  const room = makeRoom([p], [fisch.id, medusa.id]);
  const vorher = combatTotals(room).monsterStrength;
  const desc = applyCombatPotionAction(room, p, DOOR_COMBAT_CARDS['TYPOGRAFISCHER FEHLER'](p, room), findCard('TYPOGRAFISCHER FEHLER'));
  assert.ok(/MEDUSA/.test(desc), 'es trifft das staerkste Monster');
  assert.strictEqual(vorher - combatTotals(room).monsterStrength, 18, '19 -> 1');
}

// --- UNTOT-Verstaerker: Ghoulpeitsche und Priester-Vertreiben --------------
{
  const p = makePlayer({});
  const peitsche = findCard('GHOULPEITSCHE');
  p.equipped.hands = [peitsche.id, null];
  const room = makeRoom([p], [findCard('MEDUSA', 'monster').id]);
  assert.ok(!combatHasUndead(room), 'Medusa ist nicht untot');
  const ohne = combatTotals(room).playerStrength;

  room.combat.enhancerIds = [findCard('UNTOT', 'door_other').id];
  assert.ok(combatHasUndead(room), 'die Verstaerkerkarte UNTOT macht das Monster untot');
  assert.strictEqual(combatTotals(room).playerStrength - ohne, 3, 'Ghoulpeitsche gibt +3 gegen Untote');

  // Der Lich ist auch ohne Verstaerker untot.
  const lichRoom = makeRoom([makePlayer({})], [findCard('SIEBENJÄHRIGER LICH', 'monster').id]);
  assert.ok(combatHasUndead(lichRoom));
}

// --- "… aus der Hölle." gibt zusaetzlich +5 gegen Priester -----------------
{
  const priester = findCard('PRIESTER', 'class');
  const holle = findCard('… aus der Hölle.', 'door_other');
  const ohne = makePlayer({});
  const mit = makePlayer({ classes: [priester.id] });
  const staerke = (p) => {
    const room = makeRoom([p], [findCard('MEDUSA', 'monster').id]);
    room.combat.enhancerIds = [holle.id];
    return combatTotals(room).monsterStrength;
  };
  assert.strictEqual(staerke(mit) - staerke(ohne), 5, 'zusaetzliches +5 gegen Priester');
}

// --- AM FUSS BEFESTIGTER STREITKOLBEN --------------------------------------
{
  assert.ok(SPECIAL_SLOT_ITEMS['AM FUSS BEFESTIGTER STREITKOLBEN'], 'hat einen Platz zum Anlegen');
  assert.strictEqual(FLEE_ITEM_BONUS['AM FUSS BEFESTIGTER STREITKOLBEN'], -2, '-2 auf Weglaufen');
  const p = makePlayer({});
  p.equipped.special = [findCard('AM FUSS BEFESTIGTER STREITKOLBEN').id];
  const room = makeRoom([p], [findCard('MEDUSA', 'monster').id]);
  assert.strictEqual(combatTotals(room).playerStrength, p.level + 4, 'der gedruckte +4 zaehlt');
}

// --- ZWERGENBIER: -4, fuer Zwerge +4 ---------------------------------------
{
  assert.ok(DOOR_OTHER_AS_CURSE.has('ZWERGENBIER'), 'ZWERGENBIER wird als Fluch behandelt');
  const zwerg = findCard('ZWERG', 'race');
  const bier = findCard('ZWERGENBIER', 'door_other');

  const normal = makePlayer({});
  addActiveCurse(makeRoom([normal]), normal, 'ZWERGENBIER', bier.id);
  assert.strictEqual(curseCombatModifier(normal), -4);

  const derZwerg = makePlayer({ races: [zwerg.id] });
  addActiveCurse(makeRoom([derZwerg]), derZwerg, 'ZWERGENBIER', bier.id);
  assert.strictEqual(curseCombatModifier(derZwerg), 4, 'Zwerge bekommen stattdessen +4');
  assert.strictEqual(typeof derZwerg.activeCurses[0].amount, 'number',
    'der Eintrag bleibt reine Daten (geht so an den Client)');
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-clerical-combat: ok');
