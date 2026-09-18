// Unnatural Axe, Tuerkarten Welle A (Plan 2026-09-18, Spec gleichen Datums).
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, combatTotals, handleEquipItem, equippedItemIds,
  istGrosserGegenstand, addActiveCurse, DOOR_OTHER_AS_CURSE,
  startCombat, handleRequestHelp, handleRespondHelp,
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
  handleRequestHelp(room, p.id, helfer.id, 0);
  assert.ok(!room.combat.helperPending, 'unter dem Stinker wird gar nicht erst gefragt');
  assert.ok(room.logs.some((l) => /Stinker/i.test(l.text || l)), 'der Verlauf nennt den Grund');

  // Auch der direkte Weg ueber die Zusage ist dicht.
  room.combat.helperPending = { targetId: helfer.id, compelled: false, reward: 0 };
  handleRespondHelp(room, helfer.id, true);
  assert.strictEqual(room.combat.helperId, null, 'die Zusage kommt nicht zustande');
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-unnatural-doors: ok');
