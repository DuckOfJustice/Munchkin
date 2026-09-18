// Unnatural Axe, Tuerkarten Welle A (Plan 2026-09-18, Spec gleichen Datums).
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, combatTotals, handleEquipItem, equippedItemIds,
  istGrosserGegenstand, addActiveCurse, DOOR_OTHER_AS_CURSE,
  startCombat, handleRequestHelp, handleRespondHelp, resolveCombatWin,
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

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-unnatural-doors: ok');
