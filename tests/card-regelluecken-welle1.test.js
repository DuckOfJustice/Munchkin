// Regellücken Welle 1 (Spec 2026-09-22-regelluecken-welle1-design.md):
// Hase, Halb-Blut, Schilde, Huhn, Zaubercouch.
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
    code: 'TEST', players, turnIndex: 0, turnPhase: 'aerger', combatHappenedThisTurn: false,
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [], itemAttachments: {},
    revealedDoorCard: null, pendingConsequence: null, pendingCardAction: null, pendingRoll: null,
    combat: null, winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
    settings: { sets: {} },
  }, extra || {});
  raeume.push(room);
  return room;
}
const fertig = () => raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });

// --- 1. DER GANZ NORMALE HASE: "Bei einer 6 ... kann der Helfer nicht mehr
// entkommen". Beide wuerfeln eine 6 zum Weglaufen: nur die kaempfende Person
// entkommt, die helfende scheitert.
{
  const hase = findCard('DER GANZ NORMALE HASE', 'monster').id;
  const a = makePlayer({ level: 3 });
  const h = makePlayer({ id: 'p2', name: 'B', level: 3 });
  const room = makeRoom([a, h]);
  S.startCombat(room, 'p1', [hase], { fromHand: false });
  room.combat.helperId = 'p2';
  const zufall = Math.random;
  Math.random = () => 0.99; // jeder Wurf eine 6
  try {
    S.hasenWurf(room, null);            // Hase wird zum Film-Hasen (Stufe 15)
    assert.strictEqual(room.combat.helferGefangen, true, 'bei einer 6 ist der Helfer gefangen');
    room.combat.mustFlee = true;
    S.handleAttemptFlee(room, 'p1', 0);
    S.handleAttemptFlee(room, 'p2', 0);
  } finally { Math.random = zufall; }
  assert.ok(room.pendingConsequence, 'es gibt Schlimme Dinge');
  assert.strictEqual(room.pendingConsequence.playerId, 'p2', 'die helfende Person ist gescheitert');
  assert.ok(room.logs.some((l) => /kann nicht mehr entkommen/.test(l.text)), 'der Verlauf nennt den Grund');
}
// Gegenprobe: ohne 6 entkommt die helfende Person normal.
{
  const hase = findCard('DER GANZ NORMALE HASE', 'monster').id;
  const room = makeRoom([makePlayer({ level: 3 }), makePlayer({ id: 'p2', name: 'B', level: 3 })]);
  S.startCombat(room, 'p1', [hase], { fromHand: false });
  room.combat.helperId = 'p2';
  const zufall = Math.random;
  try {
    Math.random = () => 0; // Hase: Wurf 1
    S.hasenWurf(room, null);
    assert.ok(!room.combat.helferGefangen);
    room.combat.mustFlee = true;
    Math.random = () => 0.99; // Flucht: 6
    S.handleAttemptFlee(room, 'p1', 0);
    S.handleAttemptFlee(room, 'p2', 0);
  } finally { Math.random = zufall; }
  assert.strictEqual(room.pendingConsequence, null, 'beide entkommen');
}
// Ein Halbling-Helfer, vom Hase gefangen: kein Wiederholungswurf-Angebot -
// der wuerde nichts aendern (helferGefangen erzwingt Scheitern so wie
// FLEE_IMPOSSIBLE), die Karte waere umsonst weg. Siehe halblingRerollPossible.
{
  const hase = findCard('DER GANZ NORMALE HASE', 'monster').id;
  const karte = findCard('GEILER HELM', 'item').id;
  const halbling = findCard('HALBLING', 'race').id;
  const a = makePlayer({ level: 3 });
  const h = makePlayer({ id: 'p2', name: 'B', level: 3, races: [halbling], hand: [karte] });
  const room = makeRoom([a, h]);
  S.startCombat(room, 'p1', [hase], { fromHand: false });
  room.combat.helperId = 'p2';
  const zufall = Math.random;
  Math.random = () => 0.99; // jeder Wurf eine 6 - ohne die Sperre waere die Flucht sogar geschafft
  try {
    S.hasenWurf(room, null);
    room.combat.mustFlee = true;
    S.handleAttemptFlee(room, 'p1', 0);
    S.handleAttemptFlee(room, 'p2', 0);
  } finally { Math.random = zufall; }
  assert.ok(!room.combat || !room.combat.fleeRerollOffer, 'kein Wiederholungsangebot fuer den gefangenen Helfer');
  assert.ok(room.pendingConsequence, 'der gefangene Halbling-Helfer bekommt trotzdem das Miese Zeug');
  assert.strictEqual(room.pendingConsequence.playerId, 'p2');
  assert.ok(h.hand.includes(karte), 'die Handkarte bleibt, da kein Angebot verbraucht wurde');
}
// Kam die helfende Person erst NACH dem Hasenwurf dazu, gilt die Sperre
// trotzdem - der Check in handleAttemptFlee liest c.helperId zum
// Flucht-Zeitpunkt, nicht zum Wurf-Zeitpunkt.
{
  const hase = findCard('DER GANZ NORMALE HASE', 'monster').id;
  const a = makePlayer({ level: 3 });
  const h = makePlayer({ id: 'p2', name: 'B', level: 3 });
  const room = makeRoom([a, h]);
  S.startCombat(room, 'p1', [hase], { fromHand: false });
  // noch kein Helfer beim Wurf.
  const zufall = Math.random;
  Math.random = () => 0.99; // jeder Wurf eine 6
  try {
    S.hasenWurf(room, null);
    assert.strictEqual(room.combat.helferGefangen, true);
    room.combat.helperId = 'p2'; // erst jetzt kommt die Hilfe dazu
    room.combat.mustFlee = true;
    S.handleAttemptFlee(room, 'p1', 0);
    S.handleAttemptFlee(room, 'p2', 0);
  } finally { Math.random = zufall; }
  assert.ok(room.pendingConsequence, 'die spaet dazugekommene Hilfe ist trotzdem gefangen');
  assert.strictEqual(room.pendingConsequence.playerId, 'p2', 'die spaet dazugekommene Hilfe scheitert');
}

// --- 2. HALB-BLUT: "eine Rassenkarte ... alle Vorteile aber keine Nachteile"
{
  const elf = findCard('ELF', 'race').id;
  const halbling = findCard('HALBLING', 'race').id;
  const gnom = ALL_CARDS.find((c) => c.name === 'GNOM').id;
  const halbBlut = findCard('HALB-BLUT').id;
  const zunge = findCard('ZUNGENDÄMON', 'monster');
  const spec = (p, name) => S.resolveConsequenceSpec(name, findCard(name, 'monster').badstuff, p, makeRoom([p]));

  const halbElf = makePlayer({ races: [elf], raceCapCard: halbBlut });
  assert.strictEqual(spec(halbElf, 'ZUNGENDÄMON').amount, 2, 'Halb-Elf: ZUNGENDÄMON wie Nicht-Elfen');
  assert.strictEqual(spec(halbElf, 'FUNGUS').amount, 1, 'Halb-Elf: FUNGUS wie Nicht-Elfen');
  assert.strictEqual(spec(makePlayer({ races: [elf] }), 'ZUNGENDÄMON').amount, 3, 'Gegenprobe: echter Elf 3');
  // Halb-Blut mit ZWEI Rassen hat laut Karte alle Nachteile.
  const zweiRassen = makePlayer({ races: [elf, halbling], raceCapCard: halbBlut });
  assert.strictEqual(spec(zweiRassen, 'ZUNGENDÄMON').amount, 3, 'zwei Rassen: Nachteil bleibt');

  // MONSTER, DAS DER SL ...: Elf +2 Stufen - fuer Halb-Elfen (Frau, damit nur die Rasse zaehlt) nicht.
  const slName = 'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT';
  const sl = S.resolveConsequenceSpec(slName, findCard(slName, 'monster').badstuff, makePlayer({ races: [elf], raceCapCard: halbBlut, gender: 'w' }), makeRoom([]));
  const slStufen = [].concat(sl.type === 'combo' ? sl.actions : [sl]).filter((x) => x.type === 'levelDelta').reduce((s, x) => s + x.amount, 0);
  assert.strictEqual(slStufen, 0, 'Halb-Elfin: keine Elfen-Stufen beim SL-Monster');

  // BEKIFFTER GOLEM: Halb-Halbling darf vorbeigehen.
  const golem = findCard('BEKIFFTER GOLEM', 'monster').id;
  assert.ok(S.monsterPassOption(golem, makePlayer({ races: [halbling], raceCapCard: halbBlut })), 'Halb-Halbling darf vorbeigehen');
  assert.ok(!S.monsterPassOption(golem, makePlayer({ races: [halbling] })), 'Gegenprobe: Halbling muss kaempfen');

  // KRAKZILLA: "Greift niemanden mit Stufe 4 oder niedriger an, AUSSER Elfen."
  const krak = findCard('KRAKZILLA', 'monster').id;
  assert.ok(S.monsterRefusesTarget(krak, makePlayer({ level: 4, races: [elf], raceCapCard: halbBlut })), 'Halb-Elf auf Stufe 4 wird verschont');
  assert.ok(!S.monsterRefusesTarget(krak, makePlayer({ level: 4, races: [elf] })), 'Gegenprobe: Elf wird angegriffen');

  // SPASSBREMSE: toedlich fuer Gnome - nicht fuer Halb-Gnome.
  const bremse = findCard('SPASSBREMSE');
  const halbGnom = makePlayer({ races: [gnom], raceCapCard: halbBlut, hand: [bremse.id] });
  const room = makeRoom([halbGnom]);
  S.handleEquipItem(room, 'p1', bremse.id);
  assert.ok(S.equippedItemIds(halbGnom).includes(bremse.id), 'Halb-Gnom legt die Spassbremse an und lebt');
}

// --- 3. Schilde sind keine Waffen (MONDJUNGFERN, KALI)
{
  const schild = findCard('GANZKÖRPER-SCHILD'); // +4, eine Hand
  const mond = findCard('MONDJUNGFERN', 'monster').id;
  const p = makePlayer({ level: 5, hand: [schild.id] });
  const room = makeRoom([p]);
  S.handleEquipItem(room, 'p1', schild.id);
  S.startCombat(room, 'p1', [mond], { fromHand: false });
  assert.strictEqual(S.combatTotals(room).playerStrength, 9, 'Schild zaehlt gegen die Mondjungfern (5 + 4)');

  // Gegenprobe: eine echte Waffe faellt weiter weg.
  const waffe = ALL_CARDS.find((c) => c.category === 'item' && c.slotKind === 'hand' && c.bonus > 0 && !/SCHILD|BUCKLER/.test(c.name));
  const q = makePlayer({ level: 5, hand: [waffe.id] });
  const room2 = makeRoom([q]);
  S.handleEquipItem(room2, 'p1', waffe.id);
  S.startCombat(room2, 'p1', [mond], { fromHand: false });
  assert.strictEqual(S.combatTotals(room2).playerStrength, 5, `${waffe.name} zaehlt gegen die Mondjungfern nicht`);

  // KALI: "... es sei denn, du verteidigst dich mit 2 eigenen Waffen" -
  // Schwert + Schild sind nur EINE Waffe.
  assert.deepStrictEqual([...S.waffenIds(Object.assign(makePlayer(), {
    equipped: Object.assign(S.newEquipped(), { hands: [waffe.id, schild.id] }),
  }))], [waffe.id], 'waffenIds ohne Schild');
}

// --- 4. HUHN AUF DEINEM KOPF: "Jeder Fluch oder alle Schlimmen Dinge, die
// deine Kopfbedeckung entfernen, nehmen das Huhn mit."
{
  const helm = ALL_CARDS.find((c) => c.category === 'item' && c.slotKind === 'head').id;
  const huhn = findCard('HUHN AUF DEINEM KOPF').id;
  const bigfoot = findCard('BIGFOOT', 'monster'); // Schlimme Dinge: Kopfbedeckung verlieren
  const p = makePlayer();
  p.equipped.head = helm;
  const room = makeRoom([p]);
  S.addActiveCurse(room, p, 'HUHN AUF DEINEM KOPF', huhn);
  room.pendingConsequence = { playerId: 'p1', kind: 'loss', cardId: null, text: '', autoApplied: null, choice: null };
  S.autoApplyLossConsequence(room, p, [{ name: bigfoot.name, text: bigfoot.badstuff }]);
  assert.strictEqual(p.equipped.head, null, 'Testvoraussetzung: Kopfbedeckung ist weg');
  assert.ok(!p.activeCurses.some((f) => f.name === 'HUHN AUF DEINEM KOPF'), 'das Huhn ist mit weg');

  // Gegenprobe: freiwilliges Ablegen nimmt das Huhn nicht mit.
  const q = makePlayer();
  q.equipped.head = helm;
  const room2 = makeRoom([q]);
  S.addActiveCurse(room2, q, 'HUHN AUF DEINEM KOPF', huhn);
  S.handleUnequipItem(room2, 'p1', helm);
  assert.ok(q.activeCurses.some((f) => f.name === 'HUHN AUF DEINEM KOPF'), 'selbst abgelegt: Huhn bleibt');
}

// --- 5. ZAUBERCOUCH: "Du kannst zu Beginn eines jeden Kampfes entscheiden, ob
// du die Zaubercouch verwenden willst. Wenn du es tust, erhaeltst du -1 auf
// Weglaufen." Verwenden = Zauberer.
{
  const couch = findCard('ZAUBERCOUCH').id;
  const goblin = findCard('LAHMER GOBLIN', 'monster').id;
  const mitCouch = (o) => { const p = makePlayer(o); p.equipped.special = [couch]; return p; };
  const couchMalus = (room, p) => S.fleeModifierParts(room, p).some((x) => x.label === 'ZAUBERCOUCH');

  // Ausserhalb eines Kampfs: kein Zauberer.
  const p = mitCouch();
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  assert.ok(!S.hasClass(p, 'ZAUBERER'), 'ohne Kampf kein Zauberer');

  // Kampfbeginn: Frage offen, Kampf nicht auswertbar.
  S.startCombat(room, 'p1', [goblin], { fromHand: false });
  assert.strictEqual(p.zaubercouch, 'offen', 'Frage zu Kampfbeginn');
  assert.ok(!S.hasClass(p, 'ZAUBERER'), 'unbeantwortet: nicht benutzt');
  assert.ok(!couchMalus(room, p), 'unbeantwortet: kein Malus');
  S.handleEvaluateCombat(room, 'p1');
  // Stufe 5 gegen den LAHMEN GOBLIN: eine Auswertung wuerde den Kampf beenden.
  assert.ok(room.combat, 'mit offener Couch-Frage keine Auswertung');
  assert.ok(room.logs.some((l) => /Zaubercouch/.test(l.text)), 'der Verlauf nennt den Grund');

  // "Ja": Zauberer und -1 auf Weglaufen, Antwort danach fest.
  S.handleAnswerZaubercouch(room, 'p1', true);
  assert.strictEqual(p.zaubercouch, 'ja');
  assert.ok(S.hasClass(p, 'ZAUBERER'), 'mit Couch Zauberer');
  assert.ok(couchMalus(room, p), 'mit Couch -1 auf Weglaufen');
  S.handleAnswerZaubercouch(room, 'p1', false);
  assert.strictEqual(p.zaubercouch, 'ja', 'die Antwort gilt fuer diesen Kampf');

  // Naechster Kampf: neue Frage; "Nein" = kein Zauberer, kein Malus.
  S.startCombat(room, 'p1', [goblin], { fromHand: false });
  assert.strictEqual(p.zaubercouch, 'offen', 'neue Frage im naechsten Kampf');
  S.handleAnswerZaubercouch(room, 'p1', false);
  assert.ok(!S.hasClass(p, 'ZAUBERER') && !couchMalus(room, p), 'Nein: weder Zauberer noch Malus');

  // Helfer mit Couch: Frage beim Einstieg, bis dahin kein "Bereit".
  const k = makePlayer({ id: 'p1' });
  const h = mitCouch({ id: 'p2', name: 'B' });
  const room3 = makeRoom([k, h]);
  S.startCombat(room3, 'p1', [goblin], { fromHand: false });
  room3.combat.helperPending = { targetId: 'p2', compelled: false, reward: 0 };
  S.handleRespondHelp(room3, 'p2', true);
  assert.strictEqual(h.zaubercouch, 'offen', 'Frage beim Einstieg als Helfer');
  S.handleSetCombatReady(room3, 'p2', true);
  assert.ok(!(room3.combat.ready || {}).p2, 'mit offener Couch-Frage kein Bereit');

  // Bot: antwortet sofort "Nein".
  const bot = mitCouch({ id: 'p1', isBot: true });
  const room4 = makeRoom([bot]);
  S.startCombat(room4, 'p1', [goblin], { fromHand: false });
  assert.strictEqual(bot.zaubercouch, 'nein', 'Bots blockieren nicht');
}

fertig();
console.log('card-regelluecken-welle1: alle Checks gruen');
