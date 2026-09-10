// Verifiziert die neuen Karten-Sonderkraft-Mechanismen aus der "lies alle
// Karten durch"-Runde: Sofort-Stufenaufstieg-Karten, Kampf-Tränke, die
// fehlkategorisierten Flüche aus dem Pathfinder-Set (DOOR_OTHER_AS_CURSE),
// Machtgruppen sowie die bedingten Item-Kampfboni. Nach demselben Muster wie
// auto-consequence.test.js: gezielte Verhaltens-Checks plus ein
// Abdeckungs-Regressionscheck gegen den vollen Kartensatz.
const assert = require('assert');
const {
  ALL_CARDS, isInstantLevelUpCard, TREASURE_POWER_OVERRIDES,
  parseCombatPotion, isCombatPotionCard, COMBAT_POTION_OVERRIDES,
  DOOR_OTHER_AS_CURSE, resolveConsequenceSpec, POWER_GROUP_NAMES,
  GUARANTEED_FLEE_CARDS, ITEM_CONDITIONAL_BONUS,
} = require('../server.js');

function makePlayer(overrides) {
  return Object.assign({
    id: 'p1', name: 'Test', level: 5, hand: [], races: [], classes: [], powerGroups: [],
    raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: { head: null, armor: null, feet: null, hands: [null, null] },
  }, overrides || {});
}

function findCard(name, category) {
  const c = ALL_CARDS.find((x) => x.name === name && (!category || x.category === category));
  if (!c) throw new Error(`Testkarte nicht gefunden: ${name}`);
  return c;
}

function run() {
  // -------------------------------------------------------------------
  // Sofort-Stufenaufstieg-Karten
  // -------------------------------------------------------------------
  assert.ok(isInstantLevelUpCard(findCard('FEUER MARSCH')), 'einfache "Steige 1 Stufe auf"-Karte muss erkannt werden');
  assert.ok(isInstantLevelUpCard(findCard('1.000 GOLDSTÜCKE')), '"Steige eine Stufe Auf" (Großschreibung) muss erkannt werden');
  assert.ok(!isInstantLevelUpCard(findCard('KISTE VOLLER LUFT')), 'Karten ohne "Steige...auf"-Text und ohne Level-Up-Override dürfen nicht als Level-Up erkannt werden');

  const room5v5 = { players: [makePlayer({ id: 'p1', level: 5 }), makePlayer({ id: 'p2', level: 5 })] };
  const room5v3 = { players: [makePlayer({ id: 'p1', level: 5 }), makePlayer({ id: 'p2', level: 3 })] };
  assert.strictEqual(TREASURE_POWER_OVERRIDES['JAMMER DEN SPIELLEITER AN'](makePlayer({ level: 5 }), room5v5), null, 'blockiert, wenn Spieler (mit)-höchste Stufe hat');
  assert.deepStrictEqual(TREASURE_POWER_OVERRIDES['JAMMER DEN SPIELLEITER AN'](makePlayer({ level: 3 }), room5v3), { type: 'levelUp', amount: 1 }, 'erlaubt, wenn Spieler nicht höchste Stufe hat');

  const sinnierenShort = TREASURE_POWER_OVERRIDES['SINNIEREN'](makePlayer({ hand: ['a', 'b'] }));
  assert.strictEqual(sinnierenShort.options.length, 1, 'SINNIEREN bietet die Hand-Ablege-Option nur bei >=3 Handkarten an');
  const sinnierenLong = TREASURE_POWER_OVERRIDES['SINNIEREN'](makePlayer({ hand: ['a', 'b', 'c'] }));
  assert.strictEqual(sinnierenLong.options.length, 2, 'SINNIEREN bietet bei >=3 Handkarten beide Optionen an');

  assert.strictEqual(TREASURE_POWER_OVERRIDES['TÖTE DEN MIETLING'](), null, 'TÖTE DEN MIETLING bleibt bewusst manuell (Mietling-in-Spiel wird nicht getrackt)');

  // -------------------------------------------------------------------
  // Kampf-Tränke
  // -------------------------------------------------------------------
  assert.deepStrictEqual(parseCombatPotion('Im Kampf spielen. +3 für eine der Parteien, egal für welche Seite. Nur einmal einsetzbar.'), { side: 'either', amount: 3 });
  assert.deepStrictEqual(parseCombatPotion('Während beliebigem Kampf spielen. +3 für beide Seiten.'), { side: 'both', amount: 3 });
  assert.deepStrictEqual(parseCombatPotion('Im Kampf spielen. +2 nur für Monster, und jeder kann Goblins ausspielen.'), { side: 'monster', amount: 2 });
  assert.ok(isCombatPotionCard(findCard('SCHLAFTRANK')));
  assert.ok(isCombatPotionCard(findCard('KÖNIGLICHES ÖL')), 'KÖNIGLICHES ÖL ("+3 für beide Seiten") muss ebenfalls erkannt werden');

  const combatRoom = (extra) => Object.assign({ combat: { actorId: 'p1', helperId: null, monsterIds: [] } }, extra);
  assert.strictEqual(COMBAT_POTION_OVERRIDES['CYTILLESH-TRANK'](makePlayer(), combatRoom()), null, 'ohne Helfer nicht einsetzbar');
  assert.deepStrictEqual(COMBAT_POTION_OVERRIDES['CYTILLESH-TRANK'](makePlayer(), combatRoom({ combat: { actorId: 'p1', helperId: 'p2', monsterIds: [] } })), { type: 'removeHelper' });
  assert.strictEqual(COMBAT_POTION_OVERRIDES['FLÜSSIGKLINGE'](makePlayer({ equipped: { head: null, armor: null, feet: null, hands: ['x', 'y'] } })), null, 'ohne freie Hand nicht einsetzbar');
  assert.deepStrictEqual(COMBAT_POTION_OVERRIDES['FLÜSSIGKLINGE'](makePlayer()), { type: 'modifier', side: 'actor', amount: 4 });

  const elfId = findCard('ELF', 'race').id;
  const yuppieRoom = { players: [makePlayer({ id: 'p1', races: [elfId] }), makePlayer({ id: 'p2' })], combat: { actorId: 'p1', helperId: 'p2', monsterIds: [] } };
  assert.deepStrictEqual(
    COMBAT_POTION_OVERRIDES['YUPPIE-WASSER'](makePlayer({ id: 'p1', races: [elfId] }), { players: yuppieRoom.players, combat: yuppieRoom.combat }),
    { type: 'modifier', side: 'actor', amount: 2 },
    'ein Elf im Kampf -> +2'
  );
  assert.strictEqual(
    COMBAT_POTION_OVERRIDES['YUPPIE-WASSER'](makePlayer({ id: 'p1' }), { players: [makePlayer({ id: 'p1' }), makePlayer({ id: 'p2' })], combat: { actorId: 'p1', helperId: 'p2', monsterIds: [] } }),
    null,
    'kein Elf im Kampf -> nicht einsetzbar'
  );

  // -------------------------------------------------------------------
  // Fehlkategorisierte Flüche (Pathfinder) - DOOR_OTHER_AS_CURSE
  // -------------------------------------------------------------------
  assert.ok(DOOR_OTHER_AS_CURSE.has('SCHUHSUPPE'));
  assert.ok(DOOR_OTHER_AS_CURSE.has('VERLIERE DEINE MACHTGRUPPE!'));
  const curseRoom = { players: [makePlayer(), makePlayer({ id: 'p2' })], doorDiscard: [] };
  [...DOOR_OTHER_AS_CURSE].forEach((name) => {
    const c = findCard(name, 'door_other');
    // Muss entweder eine Aktion oder explizit `null` liefern, niemals werfen.
    resolveConsequenceSpec(name, c.text, makePlayer(), curseRoom);
  });

  // -------------------------------------------------------------------
  // Machtgruppen
  // -------------------------------------------------------------------
  assert.strictEqual(POWER_GROUP_NAMES.size, 8);
  ['KUNDSCHAFTER', 'NEKROMANT', 'HEXE', 'HÖLLENRITTER', 'ADLERRITTER', 'PAKTMAGIER', 'ALCHEMIST', 'ASSASSINE DER ROTEN MANTIS'].forEach((n) => {
    assert.ok(POWER_GROUP_NAMES.has(n), `${n} muss als Machtgruppe erkannt werden`);
    assert.ok(findCard(n, 'door_other'), `${n} muss als door_other-Karte existieren`);
  });

  // -------------------------------------------------------------------
  // Garantierte Flucht
  // -------------------------------------------------------------------
  assert.strictEqual(GUARANTEED_FLEE_CARDS.size, 3);
  ['FERTIGMAUER', 'BABY-ÖL', 'DER ANDERE RING'].forEach((n) => assert.ok(GUARANTEED_FLEE_CARDS.has(n)));

  // -------------------------------------------------------------------
  // Bedingte Item-Kampfboni
  // -------------------------------------------------------------------
  const krakzilla = { name: 'KRAKZILLA' };
  const jMonster = { name: 'JABBERWOCK' };
  assert.strictEqual(ITEM_CONDITIONAL_BONUS['GEILER HELM'](makePlayer(), [{ name: 'X' }]), 0, 'ohne Elf kein Zusatzbonus');
  assert.strictEqual(ITEM_CONDITIONAL_BONUS['GEILER HELM'](makePlayer({ races: [elfId] }), [{ name: 'X' }]), 1, 'Elf bekommt +1 Zusatzbonus');
  assert.strictEqual(ITEM_CONDITIONAL_BONUS['VORPALE KLINGE'](makePlayer(), [jMonster]), 10, 'Monster mit J -> +10');
  assert.strictEqual(ITEM_CONDITIONAL_BONUS['VORPALE KLINGE'](makePlayer(), [krakzilla]), 0, 'Monster ohne J -> kein Zusatzbonus');
  assert.strictEqual(ITEM_CONDITIONAL_BONUS['ALLES AUSSER KRAKZILLA ABSCHLACHTENDES SCHWERT'](makePlayer(), [krakzilla]), -4, 'gegen Krakzilla wird der Grundbonus (+4) aufgehoben');

  // -------------------------------------------------------------------
  // Abdeckungs-Regressionscheck gegen den vollen Kartensatz (treasure_other)
  // -------------------------------------------------------------------
  const treasureOther = ALL_CARDS.filter((c) => c.category === 'treasure_other');
  const uniqueByName = {};
  treasureOther.forEach((c) => { uniqueByName[c.name] = c; });
  const uniq = Object.values(uniqueByName);
  let levelUp = 0, potion = 0;
  uniq.forEach((c) => {
    if (isInstantLevelUpCard(c)) levelUp++;
    else if (isCombatPotionCard(c)) potion++;
  });
  console.log(`OK - treasure_other-Abdeckung: ${levelUp} Sofort-Stufenaufstieg, ${potion} Kampf-Tränke automatisiert (von ${uniq.length} eindeutigen Kartennamen).`);
  assert.ok(levelUp >= 25, `Sofort-Stufenaufstieg-Abdeckung eingebrochen: nur ${levelUp}`);
  assert.ok(potion >= 15, `Kampf-Trank-Abdeckung eingebrochen: nur ${potion}`);
}

run();
console.log('1/1 Tests erfolgreich (card-abilities.test.js).');
