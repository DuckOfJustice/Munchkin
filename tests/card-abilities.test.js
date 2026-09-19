// Verifiziert die neuen Karten-Sonderkraft-Mechanismen aus der "lies alle
// Karten durch"-Runde: Sofort-Stufenaufstieg-Karten, Kampf-Tränke, die
// fehlkategorisierten Flüche (DOOR_OTHER_AS_CURSE), Machtgruppen (seit dem
// Entfernen des Pathfinder-Sets ohne Karten) sowie die bedingten
// Item-Kampfboni. Nach demselben Muster wie
// auto-consequence.test.js: gezielte Verhaltens-Checks plus ein
// Abdeckungs-Regressionscheck gegen den vollen Kartensatz.
const assert = require('assert');
const {
  ALL_CARDS, isInstantLevelUpCard, TREASURE_POWER_OVERRIDES,
  parseCombatPotion, isCombatPotionCard, COMBAT_POTION_OVERRIDES,
  DOOR_OTHER_AS_CURSE, resolveConsequenceSpec, POWER_GROUP_NAMES,
  GUARANTEED_FLEE_CARDS, ITEM_CONDITIONAL_BONUS, CONSEQUENCE_OVERRIDES,
  handleDrawDoor, handleTakeRevealedDoor, handleEvaluateCombat, handleAttemptFlee, baseStrength,
  handleApplyConsequenceAction, handleRequestHelp, handleUseGuaranteedFlee,
  CURSE_PROOF_ITEMS, MONSTER_REFUSES, MONSTER_TRAIT_BONUS, MONSTER_IGNORES_LEVEL,
  MONSTER_IGNORES_BONUSES, MONSTER_FORBIDS_HELP, FLEE_ITEM_BONUS, FLEE_MONSTER_MOD,
  FLEE_IMPOSSIBLE, FLEE_AUTOMATIC, FLEE_PENALTY, FLEE_TREASURE_ITEMS,
  MONSTER_EXTRA_LEVEL, FIRE_ITEMS, GUARANTEED_FLEE_MAX_MONSTER_LEVEL,
  combatTotals, handLimit, handlePlayCombatCard,
  handleEquipItem, handleUnequipItem, equippedItemIds, newEquipped,
  SPECIAL_SLOT_ITEMS, ITEM_GRANTS_TRAIT, SPECIAL_SLOTS,
  handleEnchantMonster, enchantInfo, handleFleeEscape, handleFleeReroll,
  DOOR_COMBAT_CARDS, POST_FLEE_ESCAPE_CARDS,
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
  assert.ok(isInstantLevelUpCard(findCard('AMEISENHÜGEL AUFKOCHEN')), 'einfache "Steige 1 Stufe auf"-Karte muss erkannt werden');
  assert.ok(isInstantLevelUpCard(findCard('1.000 GOLDSTÜCKE')), '"Steige eine Stufe Auf" (Großschreibung) muss erkannt werden');
  assert.ok(!isInstantLevelUpCard(findCard('STEAM-CODE')), 'Karten ohne "Steige...auf"-Text und ohne Level-Up-Override dürfen nicht als Level-Up erkannt werden');

  const room5v5 = { players: [makePlayer({ id: 'p1', level: 5 }), makePlayer({ id: 'p2', level: 5 })] };
  const room5v3 = { players: [makePlayer({ id: 'p1', level: 5 }), makePlayer({ id: 'p2', level: 3 })] };
  assert.strictEqual(TREASURE_POWER_OVERRIDES['JAMMER DEN SPIELLEITER AN'](makePlayer({ level: 5 }), room5v5), null, 'blockiert, wenn Spieler (mit)-höchste Stufe hat');
  assert.deepStrictEqual(TREASURE_POWER_OVERRIDES['JAMMER DEN SPIELLEITER AN'](makePlayer({ level: 3 }), room5v3), { type: 'levelUp', amount: 1 }, 'erlaubt, wenn Spieler nicht höchste Stufe hat');

  const sinnierenShort = TREASURE_POWER_OVERRIDES['SINNIEREN'](makePlayer({ hand: ['a', 'b'] }));
  assert.strictEqual(sinnierenShort.options.length, 1, 'SINNIEREN bietet die Hand-Ablege-Option nur bei >=3 Handkarten an');
  const sinnierenLong = TREASURE_POWER_OVERRIDES['SINNIEREN'](makePlayer({ hand: ['a', 'b', 'c'] }));
  assert.strictEqual(sinnierenLong.options.length, 2, 'SINNIEREN bietet bei >=3 Handkarten beide Optionen an');

  assert.deepStrictEqual(TREASURE_POWER_OVERRIDES['ENTE DER VIELEN SACHEN'](), { type: 'enteDerVielenSachen' },
    'ENTE DER VIELEN SACHEN startet ihre Schrittkette (Durchlauf: card-clerical-rest.test.js)');

  // -------------------------------------------------------------------
  // Kampf-Tränke
  // -------------------------------------------------------------------
  assert.deepStrictEqual(parseCombatPotion('Im Kampf spielen. +3 für eine der Parteien, egal für welche Seite. Nur einmal einsetzbar.'), { side: 'either', amount: 3 });
  assert.deepStrictEqual(parseCombatPotion('Während beliebigem Kampf spielen. +3 für beide Seiten.'), { side: 'both', amount: 3 });
  assert.deepStrictEqual(parseCombatPotion('Im Kampf spielen. +2 nur für Monster, und jeder kann Goblins ausspielen.'), { side: 'monster', amount: 2 });
  assert.ok(isCombatPotionCard(findCard('SCHLAFTRANK')));
  assert.ok(isCombatPotionCard(findCard('KÖNIGLICHES ÖL')), 'KÖNIGLICHES ÖL ("+3 für beide Seiten") muss ebenfalls erkannt werden');


  const elfId = findCard('ELF', 'race').id;
  // LECKERER KUCHEN: +2 fuer beide Seiten, +4 vom Ork geworfen, Halblinge
  // duerfen stattdessen essen (1 Stufe) - Halbling schlaegt Ork nicht, es
  // bleibt eine Wahl mit dem jeweils richtigen Wurf-Bonus.
  const halblingId = findCard('HALBLING', 'race').id;
  const orkRasseId = ALL_CARDS.find((c) => c.name === 'ORK' && c.category === 'door_other').id;
  assert.deepStrictEqual(COMBAT_POTION_OVERRIDES['LECKERER KUCHEN'](makePlayer()), { type: 'modifier', side: 'both', amount: 2 });
  assert.deepStrictEqual(COMBAT_POTION_OVERRIDES['LECKERER KUCHEN'](makePlayer({ races: [orkRasseId] })), { type: 'modifier', side: 'both', amount: 4 }, 'vom Ork geworfen -> +4');
  const kuchenHalbling = COMBAT_POTION_OVERRIDES['LECKERER KUCHEN'](makePlayer({ races: [halblingId] }));
  assert.strictEqual(kuchenHalbling.type, 'choice', 'Halbling bekommt die Wahl');
  assert.deepStrictEqual(kuchenHalbling.options.map((o) => o.action), [
    { type: 'modifier', side: 'both', amount: 2 },
    { type: 'levelUp', amount: 1 },
  ], 'werfen oder essen');

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
  // Fehlkategorisierte Flüche - DOOR_OTHER_AS_CURSE
  // -------------------------------------------------------------------
  assert.ok(DOOR_OTHER_AS_CURSE.has('EXPLODIERENDE KNIESCHÜTZER'));
  const curseRoom = { players: [makePlayer(), makePlayer({ id: 'p2' })], doorDiscard: [] };
  [...DOOR_OTHER_AS_CURSE].forEach((name) => {
    const c = findCard(name, 'door_other');
    // Muss entweder eine Aktion oder explizit `null` liefern, niemals werfen.
    resolveConsequenceSpec(name, c.text, makePlayer(), curseRoom);
  });

  // -------------------------------------------------------------------
  // Fehlkategorisierte Flüche (Basis-Set + Erweiterungen)
  // -------------------------------------------------------------------
  assert.ok(DOOR_OTHER_AS_CURSE.size >= 28, 'Basis-Set-Fluch-Nachtrag darf nicht verschwinden');
  ['Rüstung verlieren', 'VERLIERE DEINE RASSE', 'KLASSE WECHSELN', 'RASSE WECHSELN', 'MIESER SPIEGEL', 'STINKER'].forEach((n) => {
    assert.ok(DOOR_OTHER_AS_CURSE.has(n), `${n} muss als Fluch geroutet werden`);
  });

  assert.deepStrictEqual(resolveConsequenceSpec('Rüstung verlieren', '', makePlayer()), { type: 'discardSlot', slot: 'armor' });
  assert.deepStrictEqual(resolveConsequenceSpec('VERLIERE DEINE RASSE', '', makePlayer()), { type: 'discardRaceCards' });

  const c1 = 'c1'; const c2 = 'c2';
  const oneClassSpec = resolveConsequenceSpec('VERLIERE DEINE KLASSE', '', makePlayer({ classes: [c1] }));
  assert.deepStrictEqual(oneClassSpec, { type: 'discardClassCards' }, 'mit genau 1 Klasse: direkt ablegen, keine Wahl nötig');
  const noClassSpec = resolveConsequenceSpec('VERLIERE DEINE KLASSE', '', makePlayer({ classes: [] }));
  assert.deepStrictEqual(noClassSpec, { type: 'levelDelta', amount: 1 }, 'ohne Klasse: 1 Stufe verlieren');
  const twoClassSpec = resolveConsequenceSpec('VERLIERE DEINE KLASSE', '', makePlayer({ classes: [c1, c2] }));
  assert.strictEqual(twoClassSpec.type, 'choice', 'mit 2 Klassen (Super Munchkin): echte Wahl, welche abgelegt wird');
  assert.strictEqual(twoClassSpec.options.length, 2);

  // Echte Kartenid noetig: die Bedingung fragt inzwischen nach dem slotKind der
  // getragenen Karte (getrageneSlotKarte), nicht nur danach, ob der Platz
  // belegt ist - sonst uebersieht sie geschummelte Gegenstaende.
  const schuhe = findCard('ARSCHTRITT-STIEFEL');
  assert.deepStrictEqual(resolveConsequenceSpec('QUANTEN', '', makePlayer({ equipped: { head: null, armor: null, feet: schuhe.id, hands: [null, null] } })), { type: 'discardSlot', slot: 'feet' });
  assert.deepStrictEqual(resolveConsequenceSpec('QUANTEN', '', makePlayer()), { type: 'noEffect' }, 'ohne Schuhwerk: kein Effekt');

  // -------------------------------------------------------------------
  // Ende-zu-Ende: eine fehlkategorisierte Fluchkarte ziehen. Genau der
  // Fehlerfall, den die reinen resolveConsequenceSpec-Checks oben NICHT
  // sehen: greift der Namensabgleich in handleDrawDoor nicht, landet die
  // Karte stillschweigend auf der Hand statt als Fluch aufzulaufen.
  // -------------------------------------------------------------------
  function drawRoomWith(cardId) {
    const room = {
      code: 'TEST', players: [makePlayer({ id: 'p1', name: 'A' }), makePlayer({ id: 'p2', name: 'B' }), makePlayer({ id: 'p3', name: 'C' })],
      turnIndex: 0, turnPhase: 'tuer', combatHappenedThisTurn: false,
      doorDeck: [cardId], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
      revealedDoorCard: null, combat: null, pendingConsequence: null, pendingCardAction: null,
      winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
      settings: { sets: {} },
    };
    handleDrawDoor(room, 'p1');
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    return room;
  }

  [...DOOR_OTHER_AS_CURSE].forEach((name) => {
    const c = findCard(name, 'door_other');
    const room = drawRoomWith(c.id);
    assert.ok(room.pendingConsequence, `"${name}" muss beim Ziehen als Fluch auflaufen`);
    assert.strictEqual(room.pendingConsequence.kind, 'curse', `"${name}" muss als Fluch (nicht als Kampfverlust) auflaufen`);
    assert.ok(!room.players[0].hand.includes(c.id), `"${name}" darf nicht stillschweigend auf der Hand landen`);
    assert.ok(room.doorDiscard.includes(c.id), `"${name}" muss auf dem Türablagestapel landen`);
    assert.strictEqual(room.revealedDoorCard, null, `"${name}" darf nicht als offene Türkarte hängen bleiben`);
  });

  // Eine normale Türkarte muss weiterhin auf der Hand landen (Gegenprobe,
  // damit der Check oben nicht trivial durch "alles ist ein Fluch" besteht) -
  // seit der Aufdeck-Animation aber erst NACH dem Bestätigen: sie liegt
  // zuerst offen aus, die Phase darf solange nicht weiterspringen.
  const plainDoor = ALL_CARDS.find((c) => c.category === 'door_other' && !DOOR_OTHER_AS_CURSE.has(c.name));
  const plainRoom = drawRoomWith(plainDoor.id);
  assert.strictEqual(plainRoom.pendingConsequence, null, `"${plainDoor.name}" ist kein Fluch und darf keine Konsequenz auslösen`);
  assert.strictEqual(plainRoom.revealedDoorCard, plainDoor.id, `"${plainDoor.name}" muss offen ausliegen, bevor sie genommen wird`);
  assert.ok(!plainRoom.players[0].hand.includes(plainDoor.id), `"${plainDoor.name}" darf nicht ungefragt auf der Hand landen`);
  assert.strictEqual(plainRoom.turnPhase, 'tuer', 'solange die Karte offen ausliegt, bleibt Phase 1 aktiv');
  assert.ok(plainRoom.doorReveal && plainRoom.doorReveal.cardId === plainDoor.id, 'doorReveal muss die Animation im Client auslösen können');
  handleTakeRevealedDoor(plainRoom, 'p2'); // nicht am Zug -> darf nichts tun
  assert.strictEqual(plainRoom.revealedDoorCard, plainDoor.id, 'nur die aktive Spielerin darf die offene Karte nehmen');
  handleTakeRevealedDoor(plainRoom, 'p1');
  assert.ok(plainRoom.players[0].hand.includes(plainDoor.id), `"${plainDoor.name}" muss nach dem Nehmen auf der Hand landen`);
  assert.strictEqual(plainRoom.revealedDoorCard, null, 'genommene Karte darf nicht offen liegen bleiben');
  assert.strictEqual(plainRoom.turnPhase, 'aerger', 'nach dem Nehmen geht es in Phase 2');

  // -------------------------------------------------------------------
  // Kein Override-Eintrag darf ins Leere zeigen: ein Tippfehler im
  // Kartennamen wäre sonst ein still wirkungsloser Eintrag.
  // -------------------------------------------------------------------
  const cardNames = new Set(ALL_CARDS.map((c) => c.name));
  const nameSources = {
    CONSEQUENCE_OVERRIDES: Object.keys(CONSEQUENCE_OVERRIDES),
    TREASURE_POWER_OVERRIDES: Object.keys(TREASURE_POWER_OVERRIDES),
    COMBAT_POTION_OVERRIDES: Object.keys(COMBAT_POTION_OVERRIDES),
    ITEM_CONDITIONAL_BONUS: Object.keys(ITEM_CONDITIONAL_BONUS),
    DOOR_OTHER_AS_CURSE: [...DOOR_OTHER_AS_CURSE],
    POWER_GROUP_NAMES: [...POWER_GROUP_NAMES],
    GUARANTEED_FLEE_CARDS: [...GUARANTEED_FLEE_CARDS],
    CURSE_PROOF_ITEMS: [...CURSE_PROOF_ITEMS],
    MONSTER_REFUSES: Object.keys(MONSTER_REFUSES),
    MONSTER_TRAIT_BONUS: Object.keys(MONSTER_TRAIT_BONUS),
    MONSTER_IGNORES_LEVEL: [...MONSTER_IGNORES_LEVEL],
    MONSTER_IGNORES_BONUSES: [...MONSTER_IGNORES_BONUSES],
    MONSTER_FORBIDS_HELP: [...MONSTER_FORBIDS_HELP],
    FLEE_ITEM_BONUS: Object.keys(FLEE_ITEM_BONUS),
    FLEE_MONSTER_MOD: Object.keys(FLEE_MONSTER_MOD),
    FLEE_IMPOSSIBLE: [...FLEE_IMPOSSIBLE],
    FLEE_AUTOMATIC: [...FLEE_AUTOMATIC],
    FLEE_PENALTY: Object.keys(FLEE_PENALTY),
    FLEE_TREASURE_ITEMS: [...FLEE_TREASURE_ITEMS],
    MONSTER_EXTRA_LEVEL: [...MONSTER_EXTRA_LEVEL],
    FIRE_ITEMS: [...FIRE_ITEMS],
    GUARANTEED_FLEE_MAX_MONSTER_LEVEL: Object.keys(GUARANTEED_FLEE_MAX_MONSTER_LEVEL),
  };
  Object.entries(nameSources).forEach(([label, keys]) => {
    keys.forEach((k) => assert.ok(cardNames.has(k), `${label}: "${k}" passt zu keiner Karte in cards.json`));
  });

  // -------------------------------------------------------------------
  // Kampf-Gleichstand: das Monster gewinnt. (Die Gegenprobe mit der
  // Gleichstand-Karte ALUFOLIE ist mit dem Pathfinder-Set entfallen - sie war
  // die einzige Karte dieser Art, TIE_BREAKER_CARD zeigt weiterhin auf sie.)
  // -------------------------------------------------------------------
  const monster = ALL_CARDS.find((c) => c.category === 'monster' && c.level === 4);
  // Gefüllter Schatzstapel: sonst mischt drawTreasure den Ablagestapel neu.
  const filler = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 10).map((c) => c.id);
  function combatRoomTie(hand) {
    const actor = makePlayer({ id: 'p1', name: 'A', level: monster.level, hand: hand.slice() });
    return {
      code: 'TEST', players: [actor, makePlayer({ id: 'p2', name: 'B' })],
      turnIndex: 0, turnPhase: 'tuer', combatHappenedThisTurn: true,
      doorDeck: [], doorDiscard: [], treasureDeck: filler.slice(), treasureDiscard: [],
      revealedDoorCard: null, pendingConsequence: null, pendingCardAction: null,
      winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
      settings: { sets: {} },
      combat: { actorId: 'p1', helperId: null, monsterIds: [monster.id], actorModifier: 0, monsterModifier: 0, mustFlee: false },
    };
  }

  const tieNoCard = combatRoomTie([]);
  handleEvaluateCombat(tieNoCard, 'p1');
  if (tieNoCard.cleanupTimer) clearTimeout(tieNoCard.cleanupTimer);
  assert.ok(tieNoCard.combat && tieNoCard.combat.mustFlee, 'Gleichstand: Monster gewinnt, Flucht nötig');

  // Ein Punkt mehr als das Monster: der Kampf ist gewonnen und beendet.
  const tieWithCard = combatRoomTie([]);
  tieWithCard.players[0].level = monster.level + 1;
  handleEvaluateCombat(tieWithCard, 'p1');
  if (tieWithCard.cleanupTimer) clearTimeout(tieWithCard.cleanupTimer);
  assert.strictEqual(tieWithCard.combat, null, 'Übermacht: Kampf ist gewonnen und beendet');
  assert.strictEqual(tieWithCard.players[0].level, monster.level + 2, 'der Sieg bringt die Stufe fürs Monster');

  // Beute-Animation: der Sieg muss die gezogenen Schaetze fuer die Anzeige
  // festhalten - und zwar am Spieler (privat), nicht am Raum, denn gezogene
  // Schatzkarten sind Handkarten und damit geheim.
  const reward = tieWithCard.players[0].lastReward;
  assert.ok(reward, 'nach einem Kampfsieg muss lastReward fuer die Beute-Animation gesetzt sein');
  assert.strictEqual(reward.levelsGained, 1, 'ein besiegtes Monster = 1 Stufe');
  assert.strictEqual(reward.cardIds.length, monster.treasureCount || 0, 'Beute muss genau die Schaetze des Monsters enthalten');
  reward.cardIds.forEach((id) => assert.ok(tieWithCard.players[0].hand.includes(id), 'jede angezeigte Beutekarte muss auch wirklich auf der Hand liegen'));
  assert.deepStrictEqual(reward.monsterNames, [monster.name], 'Beute-Animation nennt das besiegte Monster');

  // -------------------------------------------------------------------
  // Kampf-Tränke, die den Kampf beenden: "lässt seinen Schatz zurück"
  // (POLLYVERWANDLUNGSTRANK) muss die Schätze des
  // Monsters bringen - aber keine Stufe, das Monster wird nicht besiegt.
  // Gegenprobe FREUNDSCHAFTSTRANK: "Du erhältst keinen Schatz".
  // -------------------------------------------------------------------
  const lootMonster = ALL_CARDS.find((c) => c.category === 'monster' && (c.treasureCount || 0) >= 2);
  function potionRoom(potionName) {
    const potion = findCard(potionName, 'treasure_other');
    const actor = makePlayer({ id: 'p1', name: 'A', level: 3, hand: [potion.id] });
    return {
      room: {
        code: 'TEST', players: [actor, makePlayer({ id: 'p2', name: 'B' })],
        turnIndex: 0, turnPhase: 'kampf', combatHappenedThisTurn: true,
        doorDeck: [], doorDiscard: [], treasureDeck: filler.slice(), treasureDiscard: [],
        revealedDoorCard: null, pendingConsequence: null, pendingCardAction: null,
        winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
        settings: { sets: {} },
        combat: { actorId: 'p1', helperId: null, monsterIds: [lootMonster.id], actorModifier: 0, monsterModifier: 0, mustFlee: false },
      },
      potionId: potion.id,
    };
  }

  const polly = potionRoom('POLLYVERWANDLUNGSTRANK');
  handlePlayCombatCard(polly.room, 'p1', polly.potionId);
  if (polly.room.cleanupTimer) clearTimeout(polly.room.cleanupTimer);
  const pollyActor = polly.room.players[0];
  assert.strictEqual(polly.room.combat, null, 'POLLYVERWANDLUNGSTRANK beendet den Kampf');
  assert.ok(polly.room.doorDiscard.includes(lootMonster.id), 'das weggeflogene Monster liegt im Ablagestapel');
  assert.ok(!pollyActor.hand.includes(polly.potionId), 'der Trank wird verbraucht');
  assert.strictEqual(pollyActor.hand.length, lootMonster.treasureCount, 'der zurückgelassene Schatz landet auf der Hand (Anzahl = treasureCount)');
  assert.strictEqual(pollyActor.level, 3, 'das Monster wurde nicht besiegt - keine Stufe');
  assert.ok(pollyActor.lastReward, 'zurückgelassener Schatz muss in der Beute-Animation auftauchen');
  assert.strictEqual(pollyActor.lastReward.levelsGained, 0, 'Beute-Animation zeigt 0 Stufen');
  assert.strictEqual(pollyActor.lastReward.cardIds.length, lootMonster.treasureCount, 'Beute-Animation zeigt genau die zurückgelassenen Schätze');
  pollyActor.lastReward.cardIds.forEach((id) => assert.ok(pollyActor.hand.includes(id), 'jede Beutekarte liegt auch wirklich auf der Hand'));
  assert.ok(
    polly.room.logs.some((l) => l.text.includes('Schatzkarte(n)') && l.text.includes('keine Stufe')),
    'der Verlauf muss Schatz ohne Stufe nennen'
  );
  // Auch der verbrauchte Trank muss auf dem Stapel seines eigenen Typs landen:
  // Kampf-Tränke sind Schatzkarten und wurden beim Neumischen des Türstapels
  // sonst zu Türkarten (siehe Tod-Test weiter unten).
  assert.ok(polly.room.treasureDiscard.includes(polly.potionId), 'der verbrauchte Kampf-Trank ist eine Schatzkarte und gehört auf den Schatz-Ablagestapel');
  assert.ok(!polly.room.doorDiscard.includes(polly.potionId), 'der verbrauchte Kampf-Trank darf nicht auf dem Tür-Ablagestapel landen');
  polly.room.doorDiscard.forEach((id) => assert.strictEqual(ALL_CARDS.find((c) => c.id === id).type, 'door', 'auf dem Tür-Ablagestapel darf nur type=door liegen'));
  polly.room.treasureDiscard.forEach((id) => assert.strictEqual(ALL_CARDS.find((c) => c.id === id).type, 'treasure', 'auf dem Schatz-Ablagestapel darf nur type=treasure liegen'));

  const freundschaft = potionRoom('FREUNDSCHAFTSTRANK');
  handlePlayCombatCard(freundschaft.room, 'p1', freundschaft.potionId);
  if (freundschaft.room.cleanupTimer) clearTimeout(freundschaft.room.cleanupTimer);
  assert.strictEqual(freundschaft.room.combat, null, 'FREUNDSCHAFTSTRANK beendet den Kampf');
  assert.strictEqual(freundschaft.room.players[0].hand.length, 0, '"Du erhältst keinen Schatz" - die Hand bleibt leer');
  assert.strictEqual(freundschaft.room.players[0].level, 3, 'FREUNDSCHAFTSTRANK bringt keine Stufe');
  assert.ok(!freundschaft.room.players[0].lastReward, 'ohne Schatz keine Beute-Animation');
  assert.strictEqual(freundschaft.room.turnPhase, 'pluendern', 'FREUNDSCHAFTSTRANK erlaubt danach das Plündern');

  // Das VERZAUBERARMBAND (Monster gegen 3 Karten entfernen, Schatz bleibt,
  // keine Stufe) kam aus dem Pathfinder-Set - mit ihm sind seine Tests
  // entfallen. Die ZAUBERER-"Verzauberung" weiter unten prüft dieselbe
  // Mechanik (endCombatNoLevel + leavesTreasure) weiterhin.

  // Kartennamen in den Sonderfall-Tabellen muessen es wirklich geben - ein
  // Tippfehler (die Karte heisst "UNSICHTSBARKEITSTRANK", mit S) macht den
  // Eintrag sonst stillschweigend wirkungslos.
  [
    ['POST_FLEE_ESCAPE_CARDS', [...POST_FLEE_ESCAPE_CARDS]],
    ['DOOR_COMBAT_CARDS', Object.keys(DOOR_COMBAT_CARDS)],
    ['COMBAT_POTION_OVERRIDES', Object.keys(COMBAT_POTION_OVERRIDES)],
    ['SPECIAL_SLOT_ITEMS', Object.keys(SPECIAL_SLOT_ITEMS)],
  ].forEach(([tabelle, namen]) => {
    namen.forEach((name) => {
      assert.ok(ALL_CARDS.some((c) => c.name === name), `${tabelle}: "${name}" ist kein Kartenname`);
    });
  });

  // -------------------------------------------------------------------
  // ZAUBERER "Verzauberung": ganze Hand (mind. 3 Karten) gegen Monster und
  // seinen Schatz, aber keine Stufe. Mechanisch dasselbe wie das
  // VERZAUBERARMBAND - hier zaehlt vor allem die Bedingungspruefung.
  // -------------------------------------------------------------------
  const ZAUBERER = findCard('ZAUBERER', 'class').id;
  // Eigener Nachziehstapel: filler (10 Karten) steckt hier in der Hand, der
  // Stapel muss davon unabhaengig genug Schaetze fuer den Monsterschatz haben.
  const enchantDeck = ALL_CARDS.filter((c) => c.type === 'treasure').slice(20, 40).map((c) => c.id);
  function enchantRoom(handSize, playerOverrides, monsterIds) {
    const hand = filler.slice(0, handSize);
    const actor = makePlayer(Object.assign({
      id: 'p1', name: 'A', level: 3, hand, classes: [ZAUBERER], equipped: newEquipped(),
    }, playerOverrides || {}));
    return {
      code: 'TEST', players: [actor, makePlayer({ id: 'p2', name: 'B', equipped: newEquipped() })],
      turnIndex: 0, turnPhase: 'kampf', combatHappenedThisTurn: true,
      doorDeck: [], doorDiscard: [], treasureDeck: enchantDeck.slice(), treasureDiscard: [],
      revealedDoorCard: null, pendingConsequence: null, pendingCardAction: null,
      winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
      settings: { sets: {} },
      combat: {
        actorId: 'p1', helperId: null, monsterIds: monsterIds || [lootMonster.id],
        actorModifier: 0, monsterModifier: 0, mustFlee: false,
      },
    };
  }

  const zaubern = enchantRoom(4);
  const zaubernActor = zaubern.players[0];
  assert.ok(enchantInfo(zaubern, zaubernActor), 'Zauberer mit 4 Handkarten gegen ein Monster darf verzaubern');
  handleEnchantMonster(zaubern, 'p1');
  if (zaubern.cleanupTimer) clearTimeout(zaubern.cleanupTimer);
  assert.strictEqual(zaubern.combat, null, 'die Verzauberung beendet den Kampf');
  assert.strictEqual(zaubernActor.level, 3, '"erhalte aber keine Stufe"');
  assert.strictEqual(zaubernActor.hand.length, lootMonster.treasureCount,
    'die ganze Hand ist weg, dafuer liegt der Schatz des Monsters da');
  assert.strictEqual(zaubernActor.lastReward.levelsGained, 0, 'Beute-Animation ohne Stufe');
  assert.ok(zaubern.doorDiscard.includes(lootMonster.id), 'das verzauberte Monster liegt im Tuer-Ablagestapel');

  assert.strictEqual(enchantInfo(enchantRoom(2), makePlayer({ id: 'p1', classes: [ZAUBERER], hand: ['a', 'b'] })), null,
    'unter 3 Handkarten keine Verzauberung');
  const zweiMonster = enchantRoom(4, null, [lootMonster.id, monster.id]);
  assert.strictEqual(enchantInfo(zweiMonster, zweiMonster.players[0]), null,
    'bei mehreren Monstern muss normal gekaempft werden');
  const keinZauberer = enchantRoom(4, { classes: [] });
  assert.strictEqual(enchantInfo(keinZauberer, keinZauberer.players[0]), null, 'nur Zauberer duerfen verzaubern');
  const zauberFlucht = enchantRoom(4);
  zauberFlucht.combat.mustFlee = true;
  assert.strictEqual(enchantInfo(zauberFlucht, zauberFlucht.players[0]), null,
    'wer schon fliehen muss, verzaubert nicht mehr');
  handleEnchantMonster(zauberFlucht, 'p1');
  if (zauberFlucht.cleanupTimer) clearTimeout(zauberFlucht.cleanupTimer);
  assert.ok(zauberFlucht.combat, 'und der Aufruf prallt dann wirkungslos ab');

  // -------------------------------------------------------------------
  // MAHLZEIT!: "Der kaempfende Spieler legt alle ihn angreifenden Monster ab
  // und zieht sofort 2 Schaetze." - feste 2 Schaetze, keine Stufe, und jede:r
  // am Tisch darf die Karte spielen.
  // -------------------------------------------------------------------
  const mahlzeit = findCard('MAHLZEIT!', 'door_other');
  assert.ok(DOOR_COMBAT_CARDS[mahlzeit.name], 'MAHLZEIT! muss als Kampf-Tuerkarte bekannt sein');
  const mzRoom = enchantRoom(0, { classes: [] });
  mzRoom.players[1].hand = [mahlzeit.id]; // nicht die kaempfende Person
  handlePlayCombatCard(mzRoom, 'p2', mahlzeit.id);
  if (mzRoom.cleanupTimer) clearTimeout(mzRoom.cleanupTimer);
  assert.strictEqual(mzRoom.combat, null, 'MAHLZEIT! beendet den Kampf');
  assert.strictEqual(mzRoom.players[0].hand.length, 2,
    'die kaempfende Person zieht genau 2 Schaetze - nicht den treasureCount des Monsters');
  assert.strictEqual(mzRoom.players[0].level, 3, 'kein Monster besiegt, also keine Stufe');
  assert.strictEqual(mzRoom.players[1].hand.length, 0, 'die gespielte Karte ist verbraucht');
  assert.ok(mzRoom.doorDiscard.includes(mahlzeit.id), 'MAHLZEIT! ist eine Tuerkarte und gehoert auf deren Ablagestapel');

  // -------------------------------------------------------------------
  // DOPPELGAENGER: "Verdopple deine Kampfstaerke" - nur allein im Kampf.
  // -------------------------------------------------------------------
  const doppel = potionRoom('DOPPELGÄNGER');
  const vorher = combatTotals(doppel.room).playerStrength;
  handlePlayCombatCard(doppel.room, 'p1', doppel.potionId);
  if (doppel.room.cleanupTimer) clearTimeout(doppel.room.cleanupTimer);
  assert.strictEqual(doppel.room.combat.doubleActor, true, 'der Doppelgaenger merkt sich die Verdopplung');
  assert.strictEqual(combatTotals(doppel.room).playerStrength, vorher * 2, 'die Kampfstaerke zaehlt doppelt');

  const doppelHelfer = potionRoom('DOPPELGÄNGER');
  doppelHelfer.room.combat.helperId = 'p2';
  handlePlayCombatCard(doppelHelfer.room, 'p1', doppelHelfer.potionId);
  if (doppelHelfer.room.cleanupTimer) clearTimeout(doppelHelfer.room.cleanupTimer);
  assert.ok(!doppelHelfer.room.combat.doubleActor, 'mit Helfer:in im Kampf wirkt der Doppelgaenger nicht');
  assert.ok(doppelHelfer.room.players[0].hand.includes(doppelHelfer.potionId),
    'und die Karte bleibt dann auf der Hand');

  // -------------------------------------------------------------------
  // Spezialausrüstung: Schatzkarten mit Kampfbonus, die auf keinen der
  // klassischen Plätze gehören (Kopf/Rüstung/Schuhe/Hände). Vorher waren
  // sie gar nicht anlegbar und ihr Bonus damit wirkungslos.
  // -------------------------------------------------------------------
  const HALBLING_ID = findCard('HALBLING', 'race').id;
  const schwert = findCard('SINGENDES & TANZENDES SCHWERT');
  const strumpfhose = findCard('STRUMPFHOSE DER RIESENSTÄRK');
  const sandwich = findCard('LIMBURGER UND SARDELLEN-SANDWICH');
  const knie = findCard('SPIESSIGE KNIE');

  function equipRoom(handIds, playerOverrides) {
    const actor = makePlayer(Object.assign({ id: 'p1', name: 'A', level: 1, hand: handIds.slice(), equipped: newEquipped() }, playerOverrides || {}));
    return {
      code: 'TEST', players: [actor, makePlayer({ id: 'p2', name: 'B', equipped: newEquipped() })],
      turnIndex: 0, turnPhase: 'tuer', doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
      revealedDoorCard: null, combat: null, pendingConsequence: null, pendingCardAction: null,
      winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null, settings: { sets: {} },
    };
  }

  const eqRoom = equipRoom([schwert.id, strumpfhose.id, knie.id]);
  [schwert.id, strumpfhose.id, knie.id].forEach((id) => handleEquipItem(eqRoom, 'p1', id));
  if (eqRoom.cleanupTimer) clearTimeout(eqRoom.cleanupTimer);
  const eqActor = eqRoom.players[0];
  assert.deepStrictEqual(eqActor.equipped.special, [schwert.id, strumpfhose.id, knie.id],
    'Spezialausrüstung ist ein Sammelplatz - alle drei Karten liegen gleichzeitig an');
  assert.strictEqual(eqActor.equipped.armor, null, 'Spießige Knie belegen ausdrücklich NICHT den Rüstungsplatz');
  assert.strictEqual(eqActor.equipped.legs, undefined, 'einen eigenen Beine-Platz gibt es nicht mehr');
  assert.strictEqual(eqActor.hand.length, 0, 'angelegte Karten sind von der Hand weg');
  assert.strictEqual(baseStrength(eqActor), 1 + schwert.bonus + strumpfhose.bonus + knie.bonus,
    'die Boni der Spezialausrüstung zählen in der Kampfstärke');
  [schwert.id, strumpfhose.id, knie.id].forEach((id) => assert.ok(equippedItemIds(eqActor).includes(id),
    'Spezialplätze müssen in equippedItemIds auftauchen (Verkauf, Handel, Tod, Flüche)'));

  // Wieder ablegen räumt den Sammelplatz korrekt auf.
  handleUnequipItem(eqRoom, 'p1', schwert.id);
  if (eqRoom.cleanupTimer) clearTimeout(eqRoom.cleanupTimer);
  assert.deepStrictEqual(eqActor.equipped.special, [strumpfhose.id, knie.id], 'abgelegte Karte verschwindet aus dem Sammelplatz');
  assert.ok(eqActor.hand.includes(schwert.id), 'und liegt wieder auf der Hand');
  assert.strictEqual(baseStrength(eqActor), 1 + strumpfhose.bonus + knie.bonus, 'der Bonus fällt mit weg');

  // "aber nur für Halblinge"
  const sandwichNein = equipRoom([sandwich.id]);
  handleEquipItem(sandwichNein, 'p1', sandwich.id);
  if (sandwichNein.cleanupTimer) clearTimeout(sandwichNein.cleanupTimer);
  assert.ok(sandwichNein.players[0].hand.includes(sandwich.id), 'ohne Halbling bleibt das Sandwich auf der Hand');
  assert.deepStrictEqual(sandwichNein.players[0].equipped.special, [], 'und liegt nicht an');

  const sandwichJa = equipRoom([sandwich.id], { races: [HALBLING_ID] });
  handleEquipItem(sandwichJa, 'p1', sandwich.id);
  if (sandwichJa.cleanupTimer) clearTimeout(sandwichJa.cleanupTimer);
  assert.deepStrictEqual(sandwichJa.players[0].equipped.special, [sandwich.id], 'Halblinge dürfen das Sandwich anlegen');

  // Jede Karte in der Tabelle muss es auch wirklich geben und etwas bringen -
  // entweder einen Kampfbonus (gedruckt ODER, seit EISKALTES HÄNDCHEN, an der
  // Regel selbst - siehe equippedBonusSum-Rueckfall) oder (seit Clerical
  // Errors) eine verliehene Rasse/Klasse wie bei FALSCHE OHREN und
  // ZAUBERCOUCH. Ohne alle drei waere der Platz sinnlos.
  Object.keys(SPECIAL_SLOT_ITEMS).forEach((name) => {
    const c = findCard(name);
    const regel = SPECIAL_SLOT_ITEMS[name];
    const bringtWas = (typeof c.bonus === 'number' && c.bonus !== 0)
      || (typeof regel.bonus === 'number' && regel.bonus !== 0)
      || !!ITEM_GRANTS_TRAIT[name];
    assert.ok(bringtWas, `${name}: Spezialausrüstung ohne Kampfbonus und ohne verliehene Rasse/Klasse`);
    assert.ok(SPECIAL_SLOTS[regel.slot], `${name}: verweist auf einen unbekannten Platz`);
  });

  // MIETLING wurde aus dem Spiel genommen.
  ['MIETLING', 'TÖTE DEN MIETLING'].forEach((name) => {
    assert.strictEqual(ALL_CARDS.filter((c) => c.name === name).length, 0,
      `${name} wurde aus dem Spiel genommen und darf in keinem Set mehr auftauchen`);
  });
  assert.strictEqual(TREASURE_POWER_OVERRIDES['TÖTE DEN MIETLING'], undefined,
    'und auch keinen Eintrag mehr in den Schatzkraft-Sonderfaellen haben');

  // -------------------------------------------------------------------
  // Monster-Verstärker verändern auch die Beute: "Wird das Monster besiegt,
  // ziehe 2 zusätzliche Schätze" (GIGANTISCH, URALT) bzw. "ziehe 1 Schatz
  // weniger (mindestens 1)" (BABY). Der Wert steht in treasureCount der
  // Verstärkerkarte und wurde vorher ignoriert - der Bonus/Malus auf die
  // Kampfstärke wirkte, die Beute blieb unverändert.
  // -------------------------------------------------------------------
  const tc1Monster = ALL_CARDS.find((c) => c.category === 'monster' && c.treasureCount === 1);
  function enhancerRoom(enhancerName, monsterId) {
    const r = potionRoom('POLLYVERWANDLUNGSTRANK'); // gleicher Testraum, der Trank bleibt ungespielt
    const enh = findCard(enhancerName, 'door_other');
    r.room.players[0].hand = [enh.id];
    r.room.players[0].level = 1;
    r.room.combat.actorModifier = 40; // Sieg garantieren, ohne an der Stufe zu drehen
    if (monsterId) r.room.combat.monsterIds = [monsterId];
    return { room: r.room, enhancerId: enh.id, enh };
  }

  const gigantisch = enhancerRoom('GIGANTISCH');
  handlePlayCombatCard(gigantisch.room, 'p1', gigantisch.enhancerId);
  assert.strictEqual(gigantisch.room.combat.monsterModifier, gigantisch.enh.bonus,
    'GIGANTISCH verstärkt das Monster wie bisher');
  assert.strictEqual(gigantisch.room.combat.treasureDelta, gigantisch.enh.treasureCount,
    'der Schatzbonus des Verstärkers wird für die Auswertung gemerkt');
  handleEvaluateCombat(gigantisch.room, 'p1');
  if (gigantisch.room.cleanupTimer) clearTimeout(gigantisch.room.cleanupTimer);
  assert.strictEqual(gigantisch.room.players[0].hand.length, lootMonster.treasureCount + gigantisch.enh.treasureCount,
    '"ziehe 2 zusätzliche Schätze" muss sich in der Beute niederschlagen');

  // BABY: "ziehe 1 Schatz weniger (mindestens 1)" - an einem Monster mit nur
  // einem Schatz greift ausdrücklich die Untergrenze.
  const baby = enhancerRoom('BABY', tc1Monster.id);
  handlePlayCombatCard(baby.room, 'p1', baby.enhancerId);
  assert.strictEqual(baby.room.combat.treasureDelta, -1, 'BABY merkt sich den Schatzmalus');
  handleEvaluateCombat(baby.room, 'p1');
  if (baby.room.cleanupTimer) clearTimeout(baby.room.cleanupTimer);
  assert.strictEqual(baby.room.players[0].hand.length, 1,
    'BABY zieht einen Schatz ab, aber "mindestens 1" bleibt');

  // -------------------------------------------------------------------
  // Kampf-Tränke, die der Textparser vorher nicht erkannt hat: "+5 für egal
  // welche Seite" (für VOR egal) und "+5, egal für welche Seite" (Komma),
  // dazu ein Spielbarkeits-Satz ohne "spielen"/"einsetzen".
  // -------------------------------------------------------------------
  ['ELEKTRISCHRADIOAKTIVER SAURETRANK', 'MAGISCHES GESCHOSS', 'HÜBSCHE LUFTBALLONS'].forEach((name) => {
    const c = findCard(name, 'treasure_other');
    assert.deepStrictEqual(parseCombatPotion(c.text), { side: 'either', amount: 5 },
      `${name}: +5 für eine frei wählbare Seite muss aus dem Text gelesen werden`);
    assert.ok(isCombatPotionCard(c), `${name} muss als Kampf-Trank spielbar sein`);
  });

  const geschoss = potionRoom('MAGISCHES GESCHOSS');
  handlePlayCombatCard(geschoss.room, 'p1', geschoss.potionId);
  if (geschoss.room.cleanupTimer) clearTimeout(geschoss.room.cleanupTimer);
  assert.ok(geschoss.room.pendingCardAction && geschoss.room.pendingCardAction.kind === 'choice',
    'bei "egal für welche Seite" muss die Seite abgefragt werden');
  assert.strictEqual(geschoss.room.pendingCardAction.options.length, 2,
    'genau zwei Seiten zur Wahl: Munchkins oder Monster');

  // Gegenprobe: ein echter Rückstand bleibt ein Rückstand.
  const behind = combatRoomTie([]);
  behind.players[0].level = monster.level - 1;
  handleEvaluateCombat(behind, 'p1');
  if (behind.cleanupTimer) clearTimeout(behind.cleanupTimer);
  assert.ok(behind.combat && behind.combat.mustFlee, 'schwächer als das Monster: Flucht nötig');

  // -------------------------------------------------------------------
  // Tod: jede abgelegte Karte muss auf dem Stapel ihres eigenen Typs landen.
  // Angelegte Gegenstände sind Schatzkarten - landen sie auf dem Tür-Stapel,
  // werden sie beim Neumischen zu Türkarten und beide Stapel sind dauerhaft
  // verunreinigt.
  // -------------------------------------------------------------------
  const deathItem = ALL_CARDS.find((c) => c.category === 'item' && c.slotKind === 'armor');
  const deathDoorCard = ALL_CARDS.find((c) => c.type === 'door');
  const deathTreasureCard = ALL_CARDS.find((c) => c.type === 'treasure' && c.category !== 'item');
  const deathRoom = {
    code: 'TEST', players: [makePlayer({ id: 'p1', name: 'A', level: 7, hand: [deathDoorCard.id, deathTreasureCard.id], equipped: { head: null, armor: deathItem.id, feet: null, hands: [null, null] } })],
    turnIndex: 0, turnPhase: 'tuer', combatHappenedThisTurn: false,
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
    revealedDoorCard: null, combat: null, pendingCardAction: null,
    pendingConsequence: { playerId: 'p1', kind: 'curse', cardId: null, text: '', autoApplied: null, choice: null },
    winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
    settings: { sets: {} },
  };
  handleApplyConsequenceAction(deathRoom, 'p1', { type: 'death' });
  if (deathRoom.cleanupTimer) clearTimeout(deathRoom.cleanupTimer);
  assert.ok(deathRoom.treasureDiscard.includes(deathItem.id), 'angelegte Rüstung ist eine Schatzkarte und gehört auf den Schatz-Ablagestapel');
  assert.ok(!deathRoom.doorDiscard.includes(deathItem.id), 'angelegte Rüstung darf nicht auf dem Tür-Ablagestapel landen');
  assert.ok(deathRoom.doorDiscard.includes(deathDoorCard.id), 'Türkarte aus der Hand gehört auf den Tür-Ablagestapel');
  assert.ok(deathRoom.treasureDiscard.includes(deathTreasureCard.id), 'Schatzkarte aus der Hand gehört auf den Schatz-Ablagestapel');
  deathRoom.doorDiscard.forEach((id) => assert.strictEqual(ALL_CARDS.find((c) => c.id === id).type, 'door', 'auf dem Tür-Ablagestapel darf nur type=door liegen'));
  deathRoom.treasureDiscard.forEach((id) => assert.strictEqual(ALL_CARDS.find((c) => c.id === id).type, 'treasure', 'auf dem Schatz-Ablagestapel darf nur type=treasure liegen'));
  // Gedruckte Regel: "Du behaeltst deine Stufe, Rasse und Klasse." Frueher
  // setzte der Tod hier auf Stufe 1 zurueck.
  assert.strictEqual(deathRoom.players[0].level, 7, 'Tod laesst die Stufe unveraendert');
  assert.strictEqual(deathRoom.players[0].hand.length, 0, 'Tod leert die Hand');

  // -------------------------------------------------------------------
  // Machtgruppen
  // -------------------------------------------------------------------
  // Alle acht Machtgruppen-Karten kamen aus dem Pathfinder-Set und sind mit
  // ihm entfallen; POWER_GROUP_NAMES ist deshalb leer und die Bonus-Tests
  // (Höllenritterrüstung +5, Assassinen-Heimlichkeit +1) haben keine Karte
  // mehr. Die Maschinerie bleibt stehen - der Weglauf-Test darunter prüft sie
  // weiterhin mit einer leeren Machtgruppenliste.
  assert.strictEqual(baseStrength(makePlayer({ level: 5 })), 5, 'ohne Machtgruppe kein Zusatzbonus');

  function fleeMod(powerGroups) {
    const actor = makePlayer({ id: 'p1', name: 'A', level: 1, powerGroups });
    const room = {
      code: 'TEST', players: [actor], turnIndex: 0, turnPhase: 'tuer', combatHappenedThisTurn: true,
      doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
      revealedDoorCard: null, pendingConsequence: null, pendingCardAction: null,
      winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
      settings: { sets: {} },
      combat: { actorId: 'p1', helperId: null, monsterIds: [monster.id], actorModifier: 0, monsterModifier: 0, mustFlee: true },
    };
    handleAttemptFlee(room, 'p1', 0);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    const entry = room.logs.find((l) => l.text.includes('zum Weglaufen'));
    // Feld fuer die Wuerfel-Animation muss gesetzt sein - auch wenn das
    // Test-Room-Objekt es vorher gar nicht kannte (defensives seq-Lesen).
    assert.ok(room.dieRoll, 'handleAttemptFlee muss room.dieRoll fuer die Wuerfel-Animation setzen');
    assert.ok(room.dieRoll.roll >= 1 && room.dieRoll.roll <= 6, 'gewuerfelte Augenzahl muss zwischen 1 und 6 liegen');
    assert.strictEqual(room.dieRoll.seq, 1, 'erster Wurf in diesem Raum bekommt seq 1');
    assert.strictEqual(room.dieRoll.total, room.dieRoll.roll + room.dieRoll.mod, 'total = roll + mod');
    assert.strictEqual(room.dieRoll.success, room.dieRoll.total >= 5, 'Weglaufen gelingt ab 5');
    return entry.text.match(/\(([+-]\d+) =/)[1];
  }
  assert.strictEqual(fleeMod([]), '+0', 'ohne Machtgruppe kein Weglaufen-Bonus');

  assert.strictEqual(POWER_GROUP_NAMES.size, 0, 'seit dem Entfernen von Pathfinder gibt es keine Machtgruppen-Karten mehr');

  // -------------------------------------------------------------------
  // Garantierte Flucht
  // -------------------------------------------------------------------
  assert.strictEqual(GUARANTEED_FLEE_CARDS.size, 4);
  ['FERTIGMAUER', 'BABY-ÖL', 'DER ANDERE RING', 'RATTE AM SPIESS'].forEach((n) => assert.ok(GUARANTEED_FLEE_CARDS.has(n)));

  // -------------------------------------------------------------------
  // Bedingte Item-Kampfboni
  // -------------------------------------------------------------------
  const krakzilla = { name: 'KRAKZILLA' };
  const jMonster = { name: 'JABBERWOCK' };
  assert.strictEqual(ITEM_CONDITIONAL_BONUS['GEILER HELM'](makePlayer(), [{ name: 'X' }]), 0, 'ohne Elf kein Zusatzbonus');
  assert.strictEqual(ITEM_CONDITIONAL_BONUS['GEILER HELM'](makePlayer({ races: [elfId] }), [{ name: 'X' }]), 2, 'Elf bekommt +2 Zusatzbonus (insgesamt +3)');
  // SCHÄDELHELM ("+2 Bonus für Orks", Grundbonus 2): dieselbe Bauform wie der
  // GEILER HELM - der Zusatz gilt nur fuer Orks, alle anderen bleiben bei 2.
  const orkId = ALL_CARDS.find((c) => c.name === 'ORK' && c.category === 'door_other').id;
  assert.strictEqual(ITEM_CONDITIONAL_BONUS['SCHÄDELHELM'](makePlayer(), [{ name: 'X' }]), 0, 'ohne Ork kein Zusatzbonus');
  assert.strictEqual(ITEM_CONDITIONAL_BONUS['SCHÄDELHELM'](makePlayer({ races: [orkId] }), [{ name: 'X' }]), 2, 'Ork bekommt +2 Zusatzbonus (insgesamt +4)');
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
