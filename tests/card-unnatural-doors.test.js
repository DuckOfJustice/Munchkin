// Unnatural Axe, Tuerkarten Welle A (Plan 2026-09-18, Spec gleichen Datums).
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, combatTotals, handleEquipItem, equippedItemIds,
  istGrosserGegenstand, addActiveCurse, DOOR_OTHER_AS_CURSE,
  startCombat, handleRequestHelp, handleRespondHelp, resolveCombatWin, resolveCombat,
  UNDEAD_MONSTERS, handlePlayCombatCard,
  resolveConsequenceSpec, applyPrimitiveAction, cursedItemIds, unequipSlotCard,
  handleUnequipItem, handleSellItems, ownTradeIds, clearActiveCurseByKind,
  handleResolveCardCardChoice, TREASURE_POWER_OVERRIDES,
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

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-unnatural-doors: ok');

