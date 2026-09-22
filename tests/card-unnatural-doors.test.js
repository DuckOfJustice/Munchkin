// Unnatural Axe, Tuerkarten Welle A (Plan 2026-09-18, Spec gleichen Datums).
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, combatTotals, handleEquipItem, equippedItemIds,
  istGrosserGegenstand, addActiveCurse, DOOR_OTHER_AS_CURSE,
  startCombat, handleRequestHelp, handleRespondHelp, resolveCombatWin, resolveCombat,
  UNDEAD_MONSTERS, handlePlayCombatCard,
  resolveConsequenceSpec, applyPrimitiveAction, cursedItemIds, unequipSlotCard,
  handleUnequipItem, handleSellItems, ownTradeIds, clearActiveCurseByKind,
  handleResolveCardCardChoice, TREASURE_POWER_OVERRIDES, handleUseCardPower,
  handleResolveMultiCardSelection, handleResolveCardChoice,
  // Welle A Schätze:
  fleeModifierParts, monsterRefusesTarget, monsterSeesRace, hasRace,
  handleAttachCard, attachmentBonusSum,
  handleThiefSteal, handleThiefBackstab, handlePlayCurseFromHand,
  handleUseClassCombatDiscard, baseStrength, handItemIds
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
function makeRoom(players) {
  const room = {
    code: 'TEST', players, turnIndex: 0, turnPhase: 'ausruesten',
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
    itemAttachments: {}, logs: [], combat: null, combatHappenedThisTurn: false,
    pendingConsequence: null, pendingCardAction: null, pendingRoll: null,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  };
  raeume.push(room);
  return room;
}

// --- EISKALTES HÄNDCHEN (KLEINE FREUNDIN) -----------------------------------
// Eigene Deckkarte neben der Monsterkarte: "Gegenstand, der +3 Bonus um Kampf
// gibt". In den Rohdaten ohne slotKind, deshalb ueber SPECIAL_SLOT_ITEMS.
{
  const haendchen = findCard('EISKALTES HÄNDCHEN (KLEINE FREUNDIN)');
  const monster = ALL_CARDS.find((x) => x.category === 'monster');
  const p = makePlayer({ hand: [haendchen.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, haendchen.id);
  assert.ok(equippedItemIds(p).includes(haendchen.id), 'die kleine Freundin ist anlegbar');
  assert.ok(!istGrosserGegenstand(room, haendchen.id), 'sie ist ein kleiner Gegenstand');

  const ohne = makePlayer({ id: 'p9', name: 'B', level: p.level });
  const raumOhne = makeRoom([ohne]);
  const kampf = (r, wer) => {
    r.combat = { actorId: wer.id, helperId: null, monsterIds: [monster.id],
      actorModifier: 0, monsterModifier: 0, backstabs: {}, mustFlee: false };
    return combatTotals(r).playerStrength;
  };
  assert.strictEqual(kampf(room, p) - kampf(raumOhne, ohne), 3, 'sie gibt +3 im Kampf');
}

// --- Tracker-Eintraege ------------------------------------------------------
{
  const faelle = [
    { name: 'STINKER', kind: 'noHelp', dauer: 'naechsterKampf' },
    { name: 'NARRENGOLD', kind: 'noCombatTreasure', dauer: 'naechsterKampf' },
    { name: 'TODESANGST', kind: 'fearUndead', dauer: 'dauerhaft' },
  ];
  faelle.forEach(({ name, kind, dauer }) => {
    const karte = findCard(name);
    const p = makePlayer({});
    const room = makeRoom([p]);
    addActiveCurse(room, p, name, karte.id);
    const eintrag = p.activeCurses.find((f) => f.kind === kind);
    assert.ok(eintrag, `${name} traegt ${kind} ein`);
    assert.strictEqual(eintrag.dauer, dauer, `${name}: Dauer ${dauer}`);
    assert.ok(eintrag.hinweis, `${name}: Hinweistext fuer die Anzeige`);
  });
  // TODESANGST wirkt beim Ziehen und ist aus der Hand spielbar - beides haengt
  // an derselben Mitgliedschaft (siehe handlePlayCurseFromHand).
  assert.ok(DOOR_OTHER_AS_CURSE.has('TODESANGST'), 'TODESANGST gilt als Fluch');
}

// --- STINKER: niemand hilft -------------------------------------------------
{
  const monster = ALL_CARDS.find((x) => x.category === 'monster');
  const stinker = findCard('STINKER');
  const p = makePlayer({});
  const helfer = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([p, helfer]);
  addActiveCurse(room, p, 'STINKER', stinker.id);
  startCombat(room, p.id, [monster.id], {});
  const logCountBefore = room.logs.length;
  handleRequestHelp(room, p.id, helfer.id, 0);
  assert.ok(!room.combat.helperPending, 'unter dem Stinker wird gar nicht erst gefragt');
  const newLogs = room.logs.slice(logCountBefore);
  assert.ok(newLogs.some((l) => /hilft niemand/i.test(l.text || l)), 'der Verlauf nennt den Grund (neue Logzeile von der Sperre)');

  // Auch der direkte Weg ueber die Zusage ist dicht.
  room.combat.helperPending = { targetId: helfer.id, compelled: false, reward: 0 };
  handleRespondHelp(room, helfer.id, true);
  assert.strictEqual(room.combat.helperId, null, 'die Zusage kommt nicht zustande');
}

// --- STINKER mitten im Kampf ------------------------------------------------
{
  const monster = ALL_CARDS.find((x) => x.category === 'monster' && x.name !== 'LAUFENDE NASE');
  const nase = findCard('LAUFENDE NASE', 'monster');
  const stinker = findCard('STINKER');
  const p = makePlayer({});
  const helfer = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([p, helfer]);
  room.treasureDeck = ALL_CARDS.filter((x) => x.type === 'treasure').slice(0, 5).map((x) => x.id);
  startCombat(room, p.id, [monster.id, nase.id], {});
  room.combat.helperId = helfer.id;
  const stapelVorher = room.treasureDeck.length;

  addActiveCurse(room, p, 'STINKER', stinker.id);

  assert.strictEqual(room.combat.helperId, null, 'die Helfer:in zieht sich straffrei zurueck');
  assert.ok(!room.combat.monsterIds.includes(nase.id), 'die Laufende Nase fluechtet sofort');
  assert.ok(room.treasureDeck.length < stapelVorher, 'und laesst ihren Schatz da');
}

// --- NARRENGOLD -------------------------------------------------------------
{
  const monster = ALL_CARDS.find((x) => x.category === 'monster' && (x.treasureCount || 0) > 0);
  const narrengold = findCard('NARRENGOLD');
  const p = makePlayer({});
  const room = makeRoom([p]);
  room.treasureDeck = ALL_CARDS.filter((x) => x.type === 'treasure').slice(0, 5).map((x) => x.id);
  const stapelVorher = room.treasureDeck.length;
  addActiveCurse(room, p, 'NARRENGOLD', narrengold.id);
  startCombat(room, p.id, [monster.id], {});
  resolveCombatWin(room);
  assert.strictEqual(p.hand.length, 0, 'kein Schatz aus diesem Kampf');
  assert.strictEqual(room.treasureDeck.length, stapelVorher, 'der Stapel schrumpft nicht');
  assert.ok(p.level > 5, 'die Stufe gibt es trotzdem');
}

// Die Zusage an die Helfer:in bleibt bestehen - der Fluch haengt an der
// kaempfenden Person, der Anspruch der Helfer:in ist ihr eigener.
{
  const monster = ALL_CARDS.find((x) => x.category === 'monster' && (x.treasureCount || 0) > 0);
  const narrengold = findCard('NARRENGOLD');
  const p = makePlayer({});
  const helfer = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([p, helfer]);
  room.treasureDeck = ALL_CARDS.filter((x) => x.type === 'treasure').slice(0, 5).map((x) => x.id);
  addActiveCurse(room, p, 'NARRENGOLD', narrengold.id);
  startCombat(room, p.id, [monster.id], {});
  room.combat.helperId = helfer.id;
  room.combat.helperReward = 1;
  resolveCombatWin(room);
  assert.strictEqual(p.hand.length, 0, 'die kaempfende Person bekommt nichts');
  assert.strictEqual(helfer.hand.length, 1, 'die zugesagte Karte bekommt die Helfer:in trotzdem');
}

// NARRENGOLDs Text ist rollenunabhaengig: "Du erhaeltst keinen Schatz im
// naechsten Kampf" trifft die Person, nicht nur die Rolle "kaempfend". Traegt
// die Helfer:in den Fluch selbst, bekommt sie ihre Zusage nicht - und wenn
// die kaempfende Person zusaetzlich gesperrt ist, darf fuer die Zusage auch
// gar nicht erst gezogen werden (sonst schrumpft der Stapel fuer niemanden).
{
  const monster = ALL_CARDS.find((x) => x.category === 'monster' && (x.treasureCount || 0) > 0);
  const narrengold = findCard('NARRENGOLD');
  const p = makePlayer({});
  const helfer = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([p, helfer]);
  room.treasureDeck = ALL_CARDS.filter((x) => x.type === 'treasure').slice(0, 5).map((x) => x.id);
  const stapelVorher = room.treasureDeck.length;
  addActiveCurse(room, p, 'NARRENGOLD', narrengold.id);
  addActiveCurse(room, helfer, 'NARRENGOLD', narrengold.id);
  startCombat(room, p.id, [monster.id], {});
  room.combat.helperId = helfer.id;
  room.combat.helperReward = 1;
  resolveCombatWin(room);
  assert.strictEqual(p.hand.length, 0, 'die kaempfende Person bleibt gesperrt');
  assert.strictEqual(helfer.hand.length, 0, 'die eigens verfluchte Helfer:in bekommt die Zusage nicht');
  assert.strictEqual(room.treasureDeck.length, stapelVorher, 'der Stapel schrumpft nicht um ihren Anteil');
}

// Die Sieges-Logzeile darf keine Schatzkarten behaupten, die real niemand
// bekommen hat - ein gesperrter Solo-Sieg zieht 0, nicht treasureCount.
{
  const monster = ALL_CARDS.find((x) => x.category === 'monster' && (x.treasureCount || 0) > 0);
  const narrengold = findCard('NARRENGOLD');
  const p = makePlayer({});
  const room = makeRoom([p]);
  room.treasureDeck = ALL_CARDS.filter((x) => x.type === 'treasure').slice(0, 5).map((x) => x.id);
  addActiveCurse(room, p, 'NARRENGOLD', narrengold.id);
  startCombat(room, p.id, [monster.id], {});
  const logCountBefore = room.logs.length;
  resolveCombatWin(room);
  const neueLogs = room.logs.slice(logCountBefore);
  const siegLog = neueLogs.find((l) => /besiegt/.test(l.text || l));
  assert.ok(siegLog, 'die Sieges-Logzeile existiert (neue Logzeile vom Aufruf)');
  assert.ok(/\b0 Schatzkarte\(n\) gezogen/.test(siegLog.text || siegLog), `Logzeile nennt die tatsaechliche (Null-)Anzahl statt treasureCount: "${siegLog.text}"`);
}

// --- TODESANGST: Hilfe gegen Untote -----------------------------------------
{
  // Eng ueber UNDEAD_MONSTERS gesucht statt per Namens-Regex - die Reihenfolge
  // in ALL_CARDS soll nicht ueber den Testfall entscheiden.
  const untot = ALL_CARDS.find((x) => x.category === 'monster' && UNDEAD_MONSTERS.has(x.name));
  const angst = findCard('TODESANGST');
  const kaempfer = makePlayer({});
  const aengstlich = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([kaempfer, aengstlich]);
  addActiveCurse(room, aengstlich, 'TODESANGST', angst.id);
  startCombat(room, kaempfer.id, [untot.id], {});
  room.combat.helperPending = { targetId: aengstlich.id, compelled: false, reward: 0 };
  handleRespondHelp(room, aengstlich.id, true);
  assert.strictEqual(room.combat.helperId, null, 'gegen Untote sagt die Angst nicht zu');

  // Andersherum: wer selbst Angst hat, bekommt gegen Untote keine Hilfe.
  const room2 = makeRoom([aengstlich, kaempfer]);
  startCombat(room2, aengstlich.id, [untot.id], {});
  handleRequestHelp(room2, aengstlich.id, kaempfer.id, 0);
  assert.ok(!room2.combat.helperPending, 'gegen Untote hilft der aengstlichen Person niemand');
}

// --- TODESANGST: der eigene Kampf gegen Untote ------------------------------
{
  // Eng ueber UNDEAD_MONSTERS gesucht statt per Namens-Regex - die Reihenfolge
  // in ALL_CARDS soll nicht ueber den Testfall entscheiden.
  const untot = ALL_CARDS.find((x) => x.category === 'monster' && UNDEAD_MONSTERS.has(x.name));
  const angst = findCard('TODESANGST');
  const p = makePlayer({ level: 10 }); // klar staerker als das Monster
  const room = makeRoom([p]);
  addActiveCurse(room, p, 'TODESANGST', angst.id);
  startCombat(room, p.id, [untot.id], {});
  // addActiveCurse schreibt beim Verfluchen selbst eine Logzeile mit dem
  // Kartennamen ("... steht unter dem Fluch \"TODESANGST\"."), die ein
  // Regex-Check auf /Todesangst/i schon vor der eigentlichen Pruefung
  // treffen wuerde. Deshalb nur die ab hier neu hinzugekommenen Zeilen
  // pruefen, und zwar auf den Wortlaut der Fluchtzeile statt auf den
  // Kartennamen.
  const logCountBefore = room.logs.length;
  resolveCombat(room);
  const neueLogs = room.logs.slice(logCountBefore);
  assert.ok(room.combat && room.combat.mustFlee,
    'trotz hoeherer Kampfstaerke muss die aengstliche Person fliehen');
  assert.ok(neueLogs.some((l) => /Todesangst vor den Untoten ist st.rker als jede Waffe/i.test(l.text || l)),
    'der Verlauf nennt den Grund (neue Logzeile vom Aufruf)');
}

// --- TODESANGST: Untote treten nachtraeglich in den Kampf -------------------
{
  // Ein harmloses (nicht-untotes) Monster startet den Kampf - erst die Karte
  // UNTOT macht ihn nachtraeglich zu einem gegen Untote.
  const harmlos = ALL_CARDS.find((x) => x.category === 'monster' && !UNDEAD_MONSTERS.has(x.name));
  const untotKarte = findCard('UNTOT', 'door_other');
  const angst = findCard('TODESANGST');
  const kaempfer = makePlayer({ hand: [untotKarte.id] });
  const aengstlich = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([kaempfer, aengstlich]);
  addActiveCurse(room, aengstlich, 'TODESANGST', angst.id);
  startCombat(room, kaempfer.id, [harmlos.id], {});
  room.combat.helperId = aengstlich.id;
  // addActiveCurse hat oben schon eine Logzeile mit dem Kartennamen
  // geschrieben ("... steht unter dem Fluch \"TODESANGST\"."); ein
  // Regex-Check auf /Todesangst/i wuerde die treffen statt die eigentliche
  // Fluchtzeile. Deshalb nur die ab hier neu hinzugekommenen Zeilen pruefen.
  const logCountBefore = room.logs.length;
  handlePlayCombatCard(room, kaempfer.id, untotKarte.id);
  const neueLogs = room.logs.slice(logCountBefore);
  assert.strictEqual(room.combat.helperId, null,
    'die aengstliche Helfer:in verlaesst den Kampf, sobald er untot wird');
  assert.ok(neueLogs.some((l) => /Todesangst vor Untoten und verl.sst den Kampf/i.test(l.text || l)),
    'der Verlauf nennt den Grund (neue Logzeile vom Aufruf)');
}

// --- VERFLUCHTER GEGENSTAND: Auswahl ----------------------------------------
{
  const mitBonus = ALL_CARDS.filter((x) => x.category === 'item' && (x.bonus || 0) > 0 && x.slotKind);
  const a = mitBonus.find((x) => x.slotKind === 'head');
  const b = mitBonus.find((x) => x.slotKind === 'armor');
  const p = makePlayer({ hand: [a.id, b.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, a.id);
  handleEquipItem(room, p.id, b.id);

  const spec = resolveConsequenceSpec('VERFLUCHTER GEGENSTAND', '', p, room);
  assert.strictEqual(spec.type, 'choice', 'das Opfer waehlt selbst');
  assert.strictEqual(spec.options.length, 2, 'beide Gegenstaende stehen zur Wahl');

  applyPrimitiveAction(room, p, spec.options[0].action);
  const eintrag = p.activeCurses.find((f) => f.kind === 'cursedItem');
  assert.ok(eintrag, 'der Fluch steht im Tracker');
  assert.strictEqual(eintrag.itemId, spec.options[0].action.itemId, 'und merkt sich den Gegenstand');
  assert.ok(cursedItemIds(p).has(eintrag.itemId), 'cursedItemIds liest ihn zurueck');

  // Ist der Gegenstand auf anderem Weg weg (anderer Fluch), raeumt der Leser auf.
  unequipSlotCard(p, eintrag.itemId);
  assert.strictEqual(cursedItemIds(p).size, 0, 'ohne den Gegenstand endet der Fluch');
  assert.strictEqual(p.activeCurses.length, 0, 'und der Eintrag verschwindet');
}

// --- VERFLUCHTER GEGENSTAND: Sonderkraft zaehlt als Fluchziel ---------------
// "Ein Gegenstand, der dir einen Kampfbonus ODER eine besondere Kraft
// verleiht." Die SCHUTZSANDALEN geben keinen Bonus, stehen aber in
// CURSE_PROOF_ITEMS - sie sind also ein gueltiges Ziel.
{
  const sandalen = findCard('SCHUTZSANDALEN');
  assert.strictEqual(sandalen.bonus || 0, 0, 'Testannahme: die Sandalen geben keinen Kampfbonus');
  const p = makePlayer({ hand: [sandalen.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, sandalen.id);
  const spec = resolveConsequenceSpec('VERFLUCHTER GEGENSTAND', '', p, room);
  assert.strictEqual(spec.type, 'curseItem', 'ein Gegenstand mit Sonderkraft ist ein Fluchziel');
  assert.strictEqual(spec.itemId, sandalen.id, 'und zwar genau dieser');
}

// --- VERFLUCHTER GEGENSTAND: zwei Fluechen nebeneinander --------------------
{
  const kopf = ALL_CARDS.find((x) => x.category === 'item' && x.slotKind === 'head' && (x.bonus || 0) > 0);
  const ruestung = ALL_CARDS.find((x) => x.category === 'item' && x.slotKind === 'armor' && (x.bonus || 0) > 0);
  const p = makePlayer({ hand: [kopf.id, ruestung.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, kopf.id);
  handleEquipItem(room, p.id, ruestung.id);

  applyPrimitiveAction(room, p, { type: 'curseItem', itemId: kopf.id, cardId: null });
  const zweite = resolveConsequenceSpec('VERFLUCHTER GEGENSTAND', '', p, room);
  assert.strictEqual(zweite.type, 'curseItem', 'der schon verfluchte Gegenstand faellt aus der Wahl');
  assert.strictEqual(zweite.itemId, ruestung.id, 'uebrig bleibt der andere');
  applyPrimitiveAction(room, p, zweite);

  const ids = cursedItemIds(p);
  assert.strictEqual(ids.size, 2, 'beide Fluechen sind sichtbar');
  assert.ok(ids.has(kopf.id) && ids.has(ruestung.id), 'und zwar fuer beide Gegenstaende');

  // "Der Gegenstand kann durch einen anderen Fluch zerstoert werden" - dann
  // endet NUR sein Fluch, der andere bleibt.
  unequipSlotCard(p, kopf.id);
  assert.deepStrictEqual([...cursedItemIds(p)], [ruestung.id], 'der zerstoerte nimmt nur seinen eigenen Fluch mit');
}

// --- VERFLUCHTER GEGENSTAND: die Kraefte zaehlen nicht mehr ------------------
// "Er verliert seine Kraefte." Geprueft wird die DIFFERENZ der Kampfstaerke,
// inklusive eines Anhangs am selben Gegenstand: der faellt mit weg, weil der
// Gegenstand komplett aus der Rechnung fliegt (dieselbe Ausschlussmenge wie
// bei den MONDJUNGFERN).
{
  const monster = findCard('PESTRATTEN', 'monster');
  const waffe = ALL_CARDS.find((x) => x.category === 'item' && x.slotKind === 'hand'
    && x.handsCost === 1 && (x.bonus || 0) > 0);
  const vergiftet = findCard('VERGIFTET');
  const p = makePlayer({ hand: [waffe.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, waffe.id);
  room.combat = { actorId: p.id, helperId: null, monsterIds: [monster.id],
    actorModifier: 0, monsterModifier: 0, backstabs: {}, mustFlee: false };
  const nurWaffe = combatTotals(room).playerStrength;

  room.itemAttachments[waffe.id] = [vergiftet.id];
  const mitAnhang = combatTotals(room).playerStrength;
  assert.ok(mitAnhang > nurWaffe, 'Testannahme: der Anhang zaehlt zunaechst mit');

  applyPrimitiveAction(room, p, { type: 'curseItem', itemId: waffe.id, cardId: null });
  assert.strictEqual(combatTotals(room).playerStrength, nurWaffe - (waffe.bonus || 0),
    'verflucht zaehlen weder der Gegenstand noch sein Anhang');
}

// --- VERFLUCHTER GEGENSTAND: auch AUSSERHALB des Kampfes keine Kraft mehr --
// Bugreport 2026-09-19: der verfluchte Gegenstand gab weiterhin seinen Bonus
// - nicht im Kampf (das prueft der Test oben bereits korrekt), sondern in der
// staendig sichtbaren Kampfstaerke (Spielerliste/"Meine Figur"), die
// baseStrength() liefert und die frueher keine Flueche ausschloss.
{
  const waffe = ALL_CARDS.find((x) => x.category === 'item' && x.slotKind === 'hand'
    && x.handsCost === 1 && (x.bonus || 0) > 0);
  const p = makePlayer({ hand: [waffe.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, waffe.id);
  const vorher = baseStrength(p, room);
  applyPrimitiveAction(room, p, { type: 'curseItem', itemId: waffe.id, cardId: null });
  assert.strictEqual(baseStrength(p, room), vorher - (waffe.bonus || 0),
    'verfluchter Gegenstand zaehlt auch ausserhalb des Kampfes nicht mehr zur Kampfstaerke');
}

// --- VERFLUCHTER GEGENSTAND: man wird ihn nicht los ------------------------
// "Du kannst ihn nicht ablegen oder loswerden, bis der Fluch aufgehoben wird."
// Drei Wege: ablegen, verkaufen, verschenken/tauschen.
{
  const hammer = findCard('GESEGNETER HAMMER VON ST. UUUAAAAH'); // 1200 Gold, Hand
  const p = makePlayer({ hand: [hammer.id] });
  const room = makeRoom([p]);
  room.turnPhase = 'aerger';
  handleEquipItem(room, p.id, hammer.id);
  applyPrimitiveAction(room, p, { type: 'curseItem', itemId: hammer.id, cardId: null });

  handleUnequipItem(room, p.id, hammer.id);
  assert.ok(equippedItemIds(p).includes(hammer.id), 'ablegen geht nicht');

  const stufeVorher = p.level;
  handleSellItems(room, p.id, [hammer.id]);
  assert.strictEqual(p.level, stufeVorher, 'verkaufen geht nicht');
  assert.ok(equippedItemIds(p).includes(hammer.id), 'und der Hammer liegt noch da');

  assert.deepStrictEqual(ownTradeIds(p, [hammer.id]), [], 'handeln geht auch nicht');

  // Gegenprobe: ohne den Fluch geht derselbe Verkauf durch - sonst waere der
  // Test auch dann gruen, wenn er aus einem anderen Grund scheitert.
  clearActiveCurseByKind(p, 'cursedItem');
  handleSellItems(room, p.id, [hammer.id]);
  assert.ok(p.level > stufeVorher, 'ohne Fluch wird derselbe Gegenstand verkauft');
}

// --- VERFLUCHTER GEGENSTAND: Uebertragung beim Pluendern --------------------
// "Wenn du stirbst, wird der Fluch auf den uebertragen, der ihn von deinem
// Koerper entfernt. Eine grosse Hilfe."
{
  const waffe = ALL_CARDS.find((x) => x.category === 'item' && x.slotKind === 'hand' && (x.bonus || 0) > 0);
  const opfer = makePlayer({ hand: [waffe.id] });
  const erbe = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([opfer, erbe]);
  handleEquipItem(room, opfer.id, waffe.id);
  applyPrimitiveAction(room, opfer, { type: 'curseItem', itemId: waffe.id, cardId: null });

  room.pendingCardAction = { playerId: erbe.id, cardName: 'Leiche plündern', kind: 'chooseCard',
    prompt: 'Eine Karte nehmen', candidateIds: [waffe.id], takeFrom: opfer.id };
  handleResolveCardCardChoice(room, erbe.id, waffe.id);

  assert.ok(erbe.hand.includes(waffe.id), 'die Karte ist beim Erben');
  assert.strictEqual(opfer.activeCurses.length, 0, 'das Opfer ist den Fluch los');
  const uebernommen = (erbe.activeCurses || []).find((f) => f.kind === 'cursedItem');
  assert.ok(uebernommen, 'der Erbe hat ihn jetzt');
  assert.strictEqual(uebernommen.itemId, waffe.id, 'und zwar fuer dieselbe Karte');
  // Der Erbe haelt die Karte auf der HAND - der Fluch darf dabei nicht als
  // verwaist weggeraeumt werden, sonst waere die Uebertragung wirkungslos.
  assert.ok(cursedItemIds(erbe).has(waffe.id), 'und er ueberlebt das naechste Lesen');
}

// --- WUNSCHRING gegen zwei Gegenstandsfluechen ------------------------------
// Mit zwei verfluchten Gegenstaenden muss der Ring unterscheidbare Optionen
// anbieten ("VERFLUCHTER GEGENSTAND beenden" zweimal waere Raten) und darf nur
// den GEWAEHLTEN Fluch beenden - nicht beide auf einmal.
{
  const kopf = ALL_CARDS.find((x) => x.category === 'item' && x.slotKind === 'head' && (x.bonus || 0) > 0);
  const ruestung = ALL_CARDS.find((x) => x.category === 'item' && x.slotKind === 'armor' && (x.bonus || 0) > 0);
  const p = makePlayer({ hand: [kopf.id, ruestung.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, kopf.id);
  handleEquipItem(room, p.id, ruestung.id);
  applyPrimitiveAction(room, p, { type: 'curseItem', itemId: kopf.id, cardId: null });
  applyPrimitiveAction(room, p, { type: 'curseItem', itemId: ruestung.id, cardId: null });

  const spec = TREASURE_POWER_OVERRIDES['WUNSCHRING'](p, room);
  assert.strictEqual(spec.type, 'choice', 'zwei Fluechen, also eine Wahl');
  const labels = spec.options.map((o) => o.label);
  assert.strictEqual(new Set(labels).size, 2, 'die Optionen sind unterscheidbar');
  assert.ok(labels.some((l) => l.includes(kopf.name)), 'und nennen den betroffenen Gegenstand');

  const fuerKopf = spec.options.find((o) => o.label.includes(kopf.name));
  applyPrimitiveAction(room, p, fuerKopf.action);
  assert.deepStrictEqual([...cursedItemIds(p)], [ruestung.id],
    'nur der gewaehlte Fluch endet, der andere bleibt');
}

// --- EDELMUT (Fluch, Verteilung) --------------------------------------------
{
  const { handleKickOpenDoor } = require('../server.js');
  const p1 = makePlayer({ id: 'p1', name: 'Opfer' });
  const p2 = makePlayer({ id: 'p2', name: 'Empfaenger 1' });
  const p3 = makePlayer({ id: 'p3', name: 'Empfaenger 2' });
  const room = makeRoom([p1, p2, p3]);
  raeume.push(room); // For cleanup

  const helm = findCard('GEILER HELM').id;
  p1.equipped.head = helm;
  p1.hand = [findCard('1.000 GOLDSTÜCKE').id, findCard('AMEISENHÜGEL AUFKOCHEN').id];
  p2.hand = [];
  p3.hand = [];

  room.doorDeck.unshift(findCard('EDELMUT').id);
  applyPrimitiveAction(room, p1, { type: 'curseEdelmut', victim: p1.id, cardId: findCard('EDELMUT').id });

  assert.strictEqual(room.pendingCardAction.playerId, p1.id, 'Opfer muss Gegenstand fuer p2 waehlen');
  assert.strictEqual(room.pendingCardAction.kind, 'chooseCard');
  assert.ok(room.pendingCardAction.candidateIds.includes(helm));

  handleResolveCardCardChoice(room, p1.id, helm);

  assert.ok(p2.hand.includes(helm), 'Helm landet in p2s Hand');
  assert.ok(!p1.equipped.head, 'Helm ist abgelegt');

  // Fuer p3 hat p1 keine angelegten Gegenstaende mehr, also automatische Handkarten-Zuteilung
  assert.strictEqual(room.pendingCardAction, null, 'Warteschlange ist durch');
  assert.strictEqual(p3.hand.length, 2, 'p3 hat 2 Karten gezogen');
  assert.strictEqual(p1.hand.length, 0, 'p1 hat alle Handkarten verloren');
}

﻿
// --- Welle B: Targeting System fuer Tuerkarten ------------------------------
{
  const p1 = makePlayer({ id: 'p1', name: 'Spieler 1' });
  const room = makeRoom([p1]);
  raeume.push(room);
  
  room.doorDiscard.push(findCard('TOD').id); // Vorbereiten, da nicht im Deck
  room.doorDiscard.push(findCard('ABGEBRANNT').id);
  
  startCombat(room, p1.id, [findCard('TOPFPFLANZE').id, findCard('LAHMER GOBLIN').id], { fromHand: true });
  

  
  const tod = findCard('TOD').id;
  p1.hand.push(tod);
  handlePlayCombatCard(room, p1.id, tod);
  
  assert.ok(room.pendingCardAction, 'Monster-Auswahl sollte offen sein');
  assert.strictEqual(room.pendingCardAction.kind, 'choice');
  assert.strictEqual(room.pendingCardAction.options.length, 2);
}

﻿
// --- Welle B: TOD & ABGEBRANNT ----------------------------------------------
{
  const { startCombat, handlePlayCombatCard, resolveCombatWin } = require('../server.js');
  const p1 = makePlayer({ id: 'p1', name: 'Spieler 1' });
  const p2 = makePlayer({ id: 'p2', name: 'Helfer 1' });
  const room = makeRoom([p1, p2]);
  raeume.push(room);
  room.treasureDeck = [findCard('1.000 GOLDSTÜCKE').id, findCard('AMEISENHÜGEL AUFKOCHEN').id];

  // TOD
  startCombat(room, p1.id, [findCard('LAHMER GOBLIN').id], { fromHand: true });
  const tod = findCard('TOD').id;
  const startHand = p1.hand.length;
  p1.hand.push(tod);
  handlePlayCombatCard(room, p1.id, tod);

  assert.ok(!room.combat, 'TOD beendet den Kampf, da letztes Monster');
  assert.strictEqual(p1.hand.length, startHand + 1, '1 Schatz gezogen (TOD entfernt das Monster mit leavesTreasure)');

  // ABGEBRANNT
  startCombat(room, p1.id, [findCard('TOPFPFLANZE').id], { fromHand: true }); // 2 Schaetze
  const abg = findCard('ABGEBRANNT').id;
  p1.hand.push(abg);
  handlePlayCombatCard(room, p1.id, abg);

  assert.ok(room.combat.zeroTreasureMonsterIds);
  resolveCombatWin(room); // Win
  const rewards = p1.lastReward;
  assert.strictEqual(rewards.cardIds.length, 0, 'ABGEBRANNT entfernt alle Basis-Schaetze');
}

﻿
// --- Welle B: FREUNDLICH ----------------------------------------------------
{
  const { startCombat, handlePlayCombatCard, handleResolveCardChoice } = require('../server.js');
  const p1 = makePlayer({ id: 'p1', name: 'Spieler 1' });
  const room = makeRoom([p1]);
  raeume.push(room);
  room.treasureDeck = [findCard('1.000 GOLDSTÜCKE').id, findCard('AMEISENHÜGEL AUFKOCHEN').id];

  startCombat(room, p1.id, [findCard('LAUFENDE NASE').id], { fromHand: true });
  
  
  
  const fr = findCard('FREUNDLICH').id;
  p1.hand.push(fr);
  handlePlayCombatCard(room, p1.id, fr);
  
  assert.ok(room.pendingCardAction, 'FREUNDLICH oeffnet Wahl-Dialog');
  assert.strictEqual(room.pendingCardAction.kind, 'choice');
  assert.strictEqual(room.pendingCardAction.options.length, 2);
  
  // Waehle weiterkaempfen
  handleResolveCardChoice(room, p1.id, room.pendingCardAction.options[1].id);
  assert.ok(room.combat, 'Kampf geht weiter');
  assert.ok(room.combat.monsterModifier > 0, 'FREUNDLICH würfelt 2d6 auf monsterModifier');
  assert.strictEqual(room.pendingCardAction, null, 'Wahl beendet');
}

﻿
// --- Welle B: MAMI ----------------------------------------------------------
{
  const { startCombat, handlePlayCombatCard, handlePassCombat, monsterVictoryExtras } = require('../server.js');
  const p1 = makePlayer({ id: 'p1', name: 'Spieler 1' });
  const room = makeRoom([p1]);
  raeume.push(room);

  // Basis-Monster
  const nase = findCard('LAHMER GOBLIN').id; // Lvl 1
  startCombat(room, p1.id, [nase], { fromHand: true });
  room.combat.enhancerIds = room.combat.enhancerIds || [];
  room.combat.enhancerIds.push(findCard('BABY').id);
  room.combat.monsterModifier -= 5;
  
  // MAMI + BABY spielen! Wait, we don't have BABY yet but we can test MAMI.
  const mami = findCard('MAMI').id;
  p1.hand.push(mami);
  handlePlayCombatCard(room, p1.id, mami);
  
  // MAMI fügt eine weitere Kopie der LAUFENDE NASE hinzu (als 'mommyMonsterId')
  assert.strictEqual(room.combat.monsterIds.length, 2);
  assert.ok(room.combat.mommyMonsterId);
  assert.strictEqual(room.combat.mommyMonsterId, nase);
  
  // Mami gibt +10 auf den Modifikator, und das verdoppelte Monster 
  // wurde hinzugefügt (Lvl +2 = 12 total bonus vom Duplikat).
  assert.strictEqual(room.combat.monsterModifier, 5);
  
  const extras = monsterVictoryExtras(room, p1, null, [findCard('LAHMER GOBLIN'), findCard('LAHMER GOBLIN')]);
  assert.strictEqual(extras.levels, 1, 'Mami gibt 1 Extra-Stufe');
  assert.strictEqual(extras.treasures, 2, 'Mami gibt 1 Extra-Schatz + 1 Ausgleich für Baby');
}




{
  // Test: SCHICKSALHAFTE KARTEN
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);
  const cardId = findCard('SCHICKSALHAFTE KARTEN').id;
  p1.hand.push(cardId);
  const discard1 = findCard('GEMEINE GHOULE').id;
  const discard2 = findCard('WUNSCHRING').id;
  p1.hand.push(discard1);
  p1.hand.push(discard2);
  
  room.doorDeck = [findCard('TOD').id, findCard('TOD').id];
  room.treasureDeck = [findCard('TOD').id, findCard('TOD').id];
  
  handleUseCardPower(room, p1.id, cardId);
  assert.strictEqual(room.pendingCardAction.kind, 'multiCardSelection');
  
  // Waehle beide Karten abwerfen und vom doorDeck ziehen
  handleResolveMultiCardSelection(room, p1.id, [discard1, discard2], 'door');
  assert.strictEqual(room.pendingCardAction, null, 'Aktion beendet');
  assert.ok(!p1.hand.includes(discard1), 'Abgeworfene Karte 1 ist weg');
  assert.ok(!p1.hand.includes(discard2), 'Abgeworfene Karte 2 ist weg');
  assert.strictEqual(p1.hand.length, 2, '2 neue Karten auf der Hand');
  assert.strictEqual(room.doorDiscard.includes(discard1), true, 'In Ablagestapel');
}

{
  // Test: FINDE EINE KARTE
  // "Schau dir die drei NAECHSTEN Tuerkarten an" = die als naechstes gezogen
  // werden. drawDoor() zieht per pop() vom ENDE des doorDeck-Arrays - das
  // Ende ist also "oben". Bugreport 2026-09-19: die Karte griff bisher die
  // UNTERSTEN drei Karten ab (splice(0,3)) statt der obersten, und legte sie
  // per unshift() auch wieder unten an.
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);
  const cardId = findCard('FINDE EINE KARTE').id;
  p1.hand.push(cardId);

  const c1 = findCard('GEMEINE GHOULE').id;
  const c2 = findCard('WUNSCHRING').id;
  const c3 = findCard('TOD').id;
  const bottomFiller = findCard('TOD').id;
  // bottomFiller liegt UNTER den drei zur Wahl stehenden Karten (vorn im
  // Array) und darf von der Aktion nicht angefasst werden.
  room.doorDeck = [bottomFiller, c1, c2, c3];

  handleUseCardPower(room, p1.id, cardId);
  assert.strictEqual(room.pendingCardAction.kind, 'choice');
  assert.strictEqual(room.pendingCardAction.options.length, 3);

  // Waehle c2 fuer ganz oben
  const opt1 = room.pendingCardAction.options.find(o => o.id === c2).id;
  handleResolveCardChoice(room, p1.id, opt1);
  assert.strictEqual(room.pendingCardAction.kind, 'choice', 'Noch nicht fertig, zweite Wahl');
  assert.strictEqual(room.pendingCardAction.options.length, 2);

  // Waehle c3 fuer als zweites
  const opt2 = room.pendingCardAction.options.find(o => o.id === c3).id;
  handleResolveCardChoice(room, p1.id, opt2);

  // Fertig! Von oben (=Ende des Arrays, wird zuerst gezogen) nach unten muss
  // jetzt gelten: c2, c3, c1 (c1 blieb uebrig) - und bottomFiller bleibt ganz
  // unten (vorn im Array) unangetastet liegen.
  assert.strictEqual(room.pendingCardAction, null, 'Aktion beendet');
  assert.strictEqual(room.doorDeck.length, 4, 'kein Kartenverlust');
  assert.strictEqual(room.doorDeck[0], bottomFiller, 'die unberuehrte Karte bleibt ganz unten liegen');
  assert.strictEqual(room.doorDeck[room.doorDeck.length - 1], c2, 'ganz oben (wird als naechstes gezogen)');
  assert.strictEqual(room.doorDeck[room.doorDeck.length - 2], c3, 'als zweites');
  assert.strictEqual(room.doorDeck[room.doorDeck.length - 3], c1, 'als drittes (automatisch uebrig geblieben)');
}

// --- WELLE A SCHÄTZE: Platzlose Gegenstände ---
{
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);
  const namen = [
    'BEGLEITER', 'FÜRCHTERLICHE FALSCHE ZÄHNE', 'GANZ HEILIGES BUCH',
    'TASCHE MIT KRÄHENFÜSSEN', 'SÜSSER SCHULTERDRACHE',
    'STACHELIGER GENITALSCHONER', 'FALSCHER BART', 'LUSTIGES SCHWERT',
  ];
  for (const name of namen) {
    const c = findCard(name);
    p1.hand.push(c.id);
    handleEquipItem(room, p1.id, c.id);
    assert.ok(equippedItemIds(p1).includes(c.id), `${name} muss anlegbar sein`);
  }
}

// LUSTIGES SCHWERT: in den Rohdaten eine normale 1-Hand-Waffe, soll aber wie
// SINGENDES & TANZENDES SCHWERT als Spezialausruestung angelegt werden und
// blockiert damit KEINE Hand (Ruling 2026-09-19, Bugreport: liess sich mit
// beiden Haenden belegt nicht mehr anlegen).
{
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);
  const hammer = findCard('GESEGNETER HAMMER VON ST. UUUAAAAH');
  const schwert = findCard('LUSTIGES SCHWERT');
  p1.hand.push(hammer.id, schwert.id);
  handleEquipItem(room, p1.id, hammer.id);
  assert.ok(p1.equipped.hands.every((h) => h === hammer.id), 'Testannahme: beide Haende sind vom Hammer belegt');
  handleEquipItem(room, p1.id, schwert.id); // OHNE Schummeln!
  assert.ok(equippedItemIds(p1).includes(schwert.id), 'Lustiges Schwert ist trotz voller Hände anlegbar');
  assert.ok(p1.equipped.special.includes(schwert.id), 'liegt auf dem Spezialplatz');
  assert.ok(p1.equipped.hands.every((h) => h === hammer.id), 'der Hammer bleibt unangetastet in beiden Händen');
  assert.ok(handItemIds(p1).has(schwert.id), 'zaehlt trotzdem als Waffe (slotKind bleibt hand)');
}

// --- WELLE A SCHÄTZE: Bedingte Kampfboni ---
// SÜSSER SCHULTERDRACHE: additiv wie GEILER HELM/SCHÄDELHELM - Grundbonus
// (+2) gilt fuer alle, Frauen bekommen den Frauen-Bonus (+2) obendrauf, also
// insgesamt +4. Bestaetigt korrekt am 2026-09-19 (nicht aendern!).
{
  const p1 = makePlayer({ id: 'p1', name: 'Frau', gender: 'w' });
  const room = makeRoom([p1]);
  const drache = findCard('SÜSSER SCHULTERDRACHE');
  p1.hand.push(drache.id);
  handleEquipItem(room, p1.id, drache.id);
  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  const t1 = combatTotals(room);
  // Frau: Stufe 5 + Drache Basis 2 + Frauen-Bonus 2 = 9
  assert.strictEqual(t1.playerStrength, 9, 'Schulterdrache +4 für Frauen');
  room.combat = null;
}
{
  const p1 = makePlayer({ id: 'p1', name: 'Mann', gender: 'm' });
  const room = makeRoom([p1]);
  const drache = findCard('SÜSSER SCHULTERDRACHE');
  p1.hand.push(drache.id);
  handleEquipItem(room, p1.id, drache.id);
  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  const t1 = combatTotals(room);
  // Mann: Stufe 5 + Drache Basis 2 (gilt fuer alle) = 7
  assert.strictEqual(t1.playerStrength, 7, 'Schulterdrache gibt Männern den Grundbonus +2');
  room.combat = null;
}
// STACHELIGER GENITALSCHONER: gleiche Bauform wie der Schulterdrache -
// Grundbonus +2 fuer alle, Maenner +2 obendrauf (vom Nutzer festgelegt).
{
  const p1 = makePlayer({ id: 'p1', name: 'Mann', gender: 'm' });
  const room = makeRoom([p1]);
  const genital = findCard('STACHELIGER GENITALSCHONER');
  p1.hand.push(genital.id);
  handleEquipItem(room, p1.id, genital.id);
  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  const t = combatTotals(room);
  // Mann: Stufe 5 + Grundbonus 2 + Männer-Bonus 2 = 9
  assert.strictEqual(t.playerStrength, 9, 'Genitalschoner gibt Männern +4');
  room.combat = null;
}
{
  const p1 = makePlayer({ id: 'p1', name: 'Frau', gender: 'w' });
  const room = makeRoom([p1]);
  const genital = findCard('STACHELIGER GENITALSCHONER');
  p1.hand.push(genital.id);
  handleEquipItem(room, p1.id, genital.id);
  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  const t = combatTotals(room);
  // Frau: Stufe 5 + Grundbonus 2 = 7.
  assert.strictEqual(t.playerStrength, 7, 'Genitalschoner gibt Frauen den Grundbonus +2');
  room.combat = null;
}
// Der Geschlechtsbonus haengt nur an der Person, nicht am Monster - er gehoert
// deshalb auch in die dauerhaft angezeigte Staerke (⚔), nicht erst in den Kampf.
{
  const genital = findCard('STACHELIGER GENITALSCHONER');
  const mann = makePlayer({ id: 'p1', name: 'Mann', gender: 'm' });
  const room = makeRoom([mann]);
  mann.hand.push(genital.id);
  handleEquipItem(room, mann.id, genital.id);
  assert.strictEqual(baseStrength(mann, room), 5 + 4, 'Mann: +4 auch ausserhalb des Kampfs');
  mann.gender = 'w';
  assert.strictEqual(baseStrength(mann, room), 5 + 2, 'Frau: nur der Grundbonus +2');
}

// PSYCHO-EICHHÖRNCHEN: greift Träger des Genitalschoners nicht an
{
  const p1 = makePlayer({ id: 'p1', name: 'Mann', gender: 'm' });
  const room = makeRoom([p1]);
  const genital = findCard('STACHELIGER GENITALSCHONER');
  p1.hand.push(genital.id);
  handleEquipItem(room, p1.id, genital.id);
  const eichhoernchen = findCard('PSYCHO-EICHHÖRNCHEN');
  assert.ok(monsterRefusesTarget(eichhoernchen.id, p1), 'Psycho-Eichhörnchen greift Genitalschoner-Träger nicht an');
}

// --- WELLE A SCHÄTZE: Flucht-Boni ---
{
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);
  const tasche = findCard('TASCHE MIT KRÄHENFÜSSEN');
  p1.hand.push(tasche.id);
  handleEquipItem(room, p1.id, tasche.id);
  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  const parts = fleeModifierParts(room, p1);
  const taschenBonus = parts.find(p => p.label === 'TASCHE MIT KRÄHENFÜSSEN');
  assert.ok(taschenBonus, 'Tasche erscheint in Flucht-Modifikatoren');
  assert.strictEqual(taschenBonus.amount, 1, 'Tasche gibt +1 auf Weglaufen');
  room.combat = null;
}
{
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);
  const maschine = findCard('BELAGERUNGSMASCHINE');
  p1.hand.push(maschine.id);
  handleEquipItem(room, p1.id, maschine.id);
  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  const parts = fleeModifierParts(room, p1);
  const maschinenMalus = parts.find(p => p.label === 'BELAGERUNGSMASCHINE');
  assert.ok(maschinenMalus, 'Belagerungsmaschine erscheint in Flucht-Modifikatoren');
  assert.strictEqual(maschinenMalus.amount, -1, 'Belagerungsmaschine gibt -1 auf Weglaufen');
  room.combat = null;
}

// FALSCHER BART: Monster sehen Träger als Zwerg
{
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);
  const bart = findCard('FALSCHER BART');
  p1.hand.push(bart.id);
  handleEquipItem(room, p1.id, bart.id);
  assert.ok(monsterSeesRace(p1, 'ZWERG'), 'Falscher Bart: Monster sehen Zwerg');
  assert.ok(!hasRace(p1, 'ZWERG'), 'Falscher Bart gibt keine echte Zwergen-Rasse');
}

// … DER VERDAMMNIS: Anhang an Kampfbonus-Gegenstand
{
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);
  const schwert = findCard('LUSTIGES SCHWERT');
  p1.hand.push(schwert.id);
  handleEquipItem(room, p1.id, schwert.id);
  const verdammnis = findCard('… DER VERDAMMNIS');
  p1.hand.push(verdammnis.id);
  handleAttachCard(room, p1.id, verdammnis.id, schwert.id);
  const bonus = attachmentBonusSum(room, schwert.id);
  assert.strictEqual(bonus, 2, '… DER VERDAMMNIS gibt +2 Anhang-Bonus');
}

// Krakzilla-Schwert: Flucht-Zwang gegen Krakzilla
{
  const p1 = makePlayer({ id: 'p1', name: 'Held', level: 20 });
  const room = makeRoom([p1]);
  const schwert = findCard('ALLES AUSSER KRAKZILLA ABSCHLACHTENDES SCHWERT');
  p1.hand.push(schwert.id);
  handleEquipItem(room, p1.id, schwert.id);
  const krakzilla = findCard('KRAKZILLA');
  startCombat(room, p1.id, [krakzilla.id], { fromHand: false });
  resolveCombat(room);
}
// --- WELLE B SCHÄTZE: KRONLEUCHTER & REGENMANTEL ---
{
  const p1 = makePlayer({ id: 'P1', name: 'P1' });
  const room = makeRoom([p1]);
  const kronleuchter = findCard('KRONLEUCHTER');
  p1.hand.push(kronleuchter.id);
  handleEquipItem(room, p1.id, kronleuchter.id);
  assert.ok(equippedItemIds(p1).includes(kronleuchter.id), 'KRONLEUCHTER kann angelegt werden');
}

{
  const p1 = makePlayer({ id: 'P1', name: 'P1' });
  const p2 = makePlayer({ id: 'P2', name: 'P2' });
  const room = makeRoom([p1, p2]);
  const mantel = findCard('REGENMANTEL');
  p1.hand.push(mantel.id);
  handleEquipItem(room, p1.id, mantel.id);

  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });

  // P2 versucht, einen Trank zu spielen
  const trank = findCard('MONSTERFUTTER'); // Ein Kampf-Trank
  p2.hand.push(trank.id);
  handlePlayCombatCard(room, p2.id, trank.id);
  assert.ok(p2.hand.includes(trank.id), 'REGENMANTEL blockiert Tränke von Fremden ohne Helfer');

  // Mit Helfer: P2 darf werfen
  room.combat.helperId = p2.id;
  handlePlayCombatCard(room, p2.id, trank.id);
  assert.ok(!p2.hand.includes(trank.id), 'Tränke erlaubt, sobald ein Helfer dabei ist');
  room.combat = null;
}

// --- WELLE B SCHÄTZE: FEIGHEITSTRANK ---
{
  const p1 = makePlayer({ id: 'P1', name: 'P1', level: 9 });
  const room = makeRoom([p1]);
  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  
  const feigling = findCard('FEIGHEITSTRANK');
  p1.hand.push(feigling.id);
  handlePlayCombatCard(room, p1.id, feigling.id);
  assert.ok(room.combat.mustFlee, 'FEIGHEITSTRANK erzwingt Flucht');
  resolveCombat(room);
}

// --- WELLE B SCHÄTZE: UNGLÄUBIGKEITSTRANK ---
{
  const p1 = makePlayer({ id: 'P1', name: 'P1', level: 9 });
  const room = makeRoom([p1]);
  room.treasureDeck.push(findCard('KNIESCHÜTZER DER VERLOCKUNG').id); // Dummy Schatz
  const m1 = findCard('LAHMER GOBLIN'); // 1 Schatz
  startCombat(room, p1.id, [m1.id], { fromHand: false });
  
  const ungl = findCard('UNGLÄUBIGKEITSTRANK');
  p1.hand.push(ungl.id);
  const handVorher = p1.hand.length;
  handlePlayCombatCard(room, p1.id, ungl.id);
  assert.ok(!room.combat, 'Kampf endet sofort (keine Monster mehr)');
  assert.strictEqual(p1.hand.length, handVorher - 1 + 1, 'Schatz für Lahmer Goblin erhalten (1 Trank weg, 1 Schatz gezogen)');
}

// --- WELLE B SCHÄTZE: WAPPEN (2 Extra-Hände) ---
{
  const p1 = makePlayer({ id: 'P1', name: 'P1' });
  const room = makeRoom([p1]);
  const wappen = findCard('WAPPEN');
  const s1 = findCard('FLOTTER BUCKLER'); // 1 Hand
  const s2 = findCard('GEILER HELM'); // Kopf (Dummy)
  const w1 = findCard('RIESIGER FELS'); // 2 Hände
  const w2 = findCard('DOLCH DES VERRATS'); // 1 Hand

  p1.hand.push(wappen.id, s1.id, w1.id, w2.id);
  handleEquipItem(room, p1.id, wappen.id);
  assert.strictEqual(p1.equipped.hands.length, 4, 'WAPPEN erweitert Hände auf 4');
  
  handleEquipItem(room, p1.id, w1.id);
  handleEquipItem(room, p1.id, s1.id);
  handleEquipItem(room, p1.id, w2.id);
  assert.strictEqual(p1.equipped.hands.filter(Boolean).length, 4, '4 Hände belegt');

  // Wappen ablegen: muss die Hände auf 2 schrumpfen und 2 Items in die Hand zurücklegen
  unequipSlotCard(p1, wappen.id);
  assert.strictEqual(p1.equipped.hands.length, 2, 'Hände wieder auf 2 geschrumpft');
  assert.strictEqual(p1.equipped.hands.filter(Boolean).length, 2, '2 Hände weiterhin belegt');
  assert.ok(p1.hand.includes(s1.id) || p1.hand.includes(w2.id) || p1.hand.includes(w1.id), 'Überzählige Gegenstände sind auf der Hand');
}

// --- WELLE C SCHÄTZE: HELM FÜR PERIPHERES SEHEN ---
{
  const p1 = makePlayer({ id: 'P1', name: 'P1' });
  const p2 = makePlayer({ id: 'P2', name: 'P2' });
  p2.classes.push('DIEB'); // P2 ist Dieb
  const room = makeRoom([p1, p2]);
  
  const helm = findCard('HELM FÜR PERIPHERES SEHEN');
  p1.hand.push(helm.id);
  handleEquipItem(room, p1.id, helm.id);
  
  const dummy = findCard('KLEBERFLÄSCHCHEN'); // Zum Abwerfen
  p2.hand.push(dummy.id);
  
  // Diebstahl versuchen
  handleThiefSteal(room, p2.id, dummy.id, p1.id);
  assert.ok(p2.hand.includes(dummy.id), 'Bestehlen wurde geblockt (Kosten nicht abgezogen)');
  
  // Rücken fallen versuchen
  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  handleThiefBackstab(room, p2.id, dummy.id, p1.id);
  assert.ok(p2.hand.includes(dummy.id), 'Rücken fallen wurde geblockt');
}

// --- WELLE C SCHÄTZE: ALUFOLIEN-HUT ---
{
  const p1 = makePlayer({ id: 'P1', name: 'P1' });
  const p2 = makePlayer({ id: 'P2', name: 'P2' });
  const room = makeRoom([p1, p2]);
  
  const hut = findCard('ALUFOLIEN-HUT');
  p1.hand.push(hut.id);
  handleEquipItem(room, p1.id, hut.id);
  
  const fluch = findCard('VERLIERE 1 STUFE');
  p2.hand.push(fluch.id);
  
  // P2 spielt Fluch auf P1
  handlePlayCurseFromHand(room, p2.id, fluch.id, p1.id);
  assert.ok(!room.pendingConsequence, 'Fluch verpufft an Alufolien-Hut');
}

// --- WELLE C SCHÄTZE: GESEGNETER HAMMER VON ST. UUUAAAAH ---
{
  const p1 = makePlayer({ id: 'P1', name: 'P1' });
  const room = makeRoom([p1]);
  
  const hammer = findCard('GESEGNETER HAMMER VON ST. UUUAAAAH');
  p1.hand.push(hammer.id);
  handleEquipItem(room, p1.id, hammer.id);
  
  // Kampf gegen WIGHT BROTHERS (Untot)
  const monster = findCard('MR. BONES');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  
  const dummy1 = findCard('KLEBERFLÄSCHCHEN');
  const dummy2 = findCard('WUNSCHRING');
  p1.hand.push(dummy1.id, dummy2.id);
  
  const bVorher = combatTotals(room).playerStrength;
  handleUseClassCombatDiscard(room, p1.id, dummy1.id);
  assert.strictEqual(combatTotals(room).playerStrength, bVorher + 3, 'GESEGNETER HAMMER gibt Priester-Bonus gegen Untote (+3)');
  handleUseClassCombatDiscard(room, p1.id, dummy2.id);
  assert.strictEqual(combatTotals(room).playerStrength, bVorher + 6, 'GESEGNETER HAMMER gibt Priester-Bonus für zweite Karte (+6)');
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-unnatural-doors: ok');
