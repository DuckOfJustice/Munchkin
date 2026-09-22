// Regellücken Welle 2 (Spec 2026-09-22-regelluecken-welle2-design.md):
// Touristenfalle, Hungriger Rucksack, Temporäre Anmnesie, Gummi-Golem.
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

// --- TOURISTENFALLE: "Du darfst nicht 'Auf Ärger aus sein'. Dieser Fluch
// bleibt bestehen, bis du einem anderen Spieler geholfen hast, einen Kampf zu
// gewinnen."
{
  const falle = findCard('TOURISTENFALLE').id;
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const p = makePlayer({ hand: [monster.id] });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  S.addActiveCurse(room, p, 'TOURISTENFALLE', falle);
  assert.ok(p.activeCurses.some((f) => f.kind === 'keinAergerSuchen'), 'Fluch ist eingetragen');
  S.handlePlayMonsterFromHand(room, 'p1', monster.id);
  assert.strictEqual(room.combat, null, 'kein Kampf: "Auf Ärger aus sein" ist gesperrt');
  assert.ok(p.hand.includes(monster.id), 'das Monster bleibt auf der Hand');
  assert.ok(room.logs.some((l) => /Touristenfalle/i.test(l.text)), 'der Verlauf nennt den Grund');
}
// Gegenprobe: ohne Fluch startet der Kampf.
{
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const p = makePlayer({ hand: [monster.id] });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  S.handlePlayMonsterFromHand(room, 'p1', monster.id);
  assert.ok(room.combat, 'ohne Fluch beginnt der Kampf');
}
// Ende: nur ein Sieg als HELFENDE Person beendet den Fluch.
{
  const falle = findCard('TOURISTENFALLE').id;
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const a = makePlayer({ id: 'p1', name: 'A', level: 9 });
  const h = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([a, h]);
  S.addActiveCurse(room, h, 'TOURISTENFALLE', falle);
  S.startCombat(room, 'p1', [monster.id], { fromHand: false });
  room.combat.helperId = 'p2';
  S.resolveCombatWin(room);
  assert.ok(!h.activeCurses.some((f) => f.kind === 'keinAergerSuchen'), 'Sieg als Hilfe beendet den Fluch');
}
{
  const falle = findCard('TOURISTENFALLE').id;
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const a = makePlayer({ id: 'p1', name: 'A', level: 9 });
  const room = makeRoom([a, makePlayer({ id: 'p2', name: 'B' })]);
  S.addActiveCurse(room, a, 'TOURISTENFALLE', falle);
  S.startCombat(room, 'p1', [monster.id], { fromHand: false });
  S.resolveCombatWin(room);
  assert.ok(a.activeCurses.some((f) => f.kind === 'keinAergerSuchen'), 'der eigene Sieg beendet den Fluch nicht');
}

// --- TEMPORÄRE ANMNESIE: "Bis dahin wirst du überall als klassenloser Mensch
// gezählt." Ende: ein gewonnener Kampf, an dem die Person beteiligt war.
{
  const anmnesie = findCard('TEMPORÄRE ANMNESIE').id;
  const elf = findCard('ELF', 'race').id;
  const krieger = findCard('KRIEGER', 'class').id;
  const p = makePlayer({ races: [elf], classes: [krieger] });
  const room = makeRoom([p]);
  assert.ok(S.hasRace(p, 'ELF') && S.hasClass(p, 'KRIEGER'), 'Testvoraussetzung');
  S.addActiveCurse(room, p, 'TEMPORÄRE ANMNESIE', anmnesie);
  assert.ok(!S.hasRace(p, 'ELF'), 'Rasse vergessen');
  assert.ok(!S.hasClass(p, 'KRIEGER'), 'Klasse vergessen');
  assert.deepStrictEqual([p.races.length, p.classes.length], [1, 1], 'die Karten bleiben ausliegen');
  // Monsterbonus gegen Elfen greift nicht mehr.
  const sauger = findCard('GESICHTSSAUGER', 'monster');
  S.startCombat(room, 'p1', [sauger.id], { fromHand: false });
  assert.strictEqual(S.combatTotals(room).monsterStrength, sauger.level, '"+6 gegen Elfen" zaehlt nicht mehr');
  room.combat = null;
}
// Ein Gegenstand, der eine Klasse verleiht, zaehlt ebenfalls nicht.
{
  const anmnesie = findCard('TEMPORÄRE ANMNESIE').id;
  const ohren = findCard('FALSCHE OHREN');
  const p = makePlayer();
  p.equipped.special = [ohren.id];
  const room = makeRoom([p]);
  assert.ok(S.monsterSeesRace(p, 'ELF'), 'Testvoraussetzung: Falsche Ohren machen zum Elfen');
  S.addActiveCurse(room, p, 'TEMPORÄRE ANMNESIE', anmnesie);
  assert.ok(!S.monsterSeesRace(p, 'ELF'), 'auch geliehene Rassen sind vergessen');
}
// Ende: gewonnener Kampf, kaempfend ODER helfend.
{
  const anmnesie = findCard('TEMPORÄRE ANMNESIE').id;
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const ende = (alsHelfer) => {
    const a = makePlayer({ id: 'p1', name: 'A', level: 9 });
    const h = makePlayer({ id: 'p2', name: 'B' });
    const room = makeRoom([a, h]);
    const opfer = alsHelfer ? h : a;
    S.addActiveCurse(room, opfer, 'TEMPORÄRE ANMNESIE', anmnesie);
    S.startCombat(room, 'p1', [monster.id], { fromHand: false });
    if (alsHelfer) room.combat.helperId = 'p2';
    S.resolveCombatWin(room);
    return !opfer.activeCurses.some((f) => f.kind === 'traitsVergessen');
  };
  assert.ok(ende(false), 'eigener Sieg beendet die Anmnesie');
  assert.ok(ende(true), 'Sieg als Hilfe beendet die Anmnesie');
}

// --- HUNGRIGER RUCKSACK: "Am Ende jedes deiner Zuege wuerfelst du, bevor
// 'Milde Gabe' verteilt oder abgelegt wird ... Bei einer gewuerfelten 6
// verschluckt der Rucksack sich selbst und verschwindet."
{
  const rucksack = findCard('HUNGRIGER RUCKSACK').id;
  const handKarten = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 4).map((c) => c.id);
  const wurf = (zahl) => {
    const p = makePlayer({ hand: handKarten.slice() });
    const room = makeRoom([p], { turnPhase: 'pluendern' });
    S.addActiveCurse(room, p, 'HUNGRIGER RUCKSACK', rucksack);
    const zufall = Math.random;
    Math.random = () => (zahl - 1) / 6 + 0.01; // rollDie() -> zahl
    try { S.setzeZugphase(room, 'gabe'); } finally { Math.random = zufall; }
    return { p, room };
  };
  const zwei = wurf(2);
  assert.strictEqual(zwei.p.hand.length, 2, 'Wurf 2: zwei Handkarten gefressen');
  assert.strictEqual(zwei.room.treasureDiscard.length, 2, 'die Karten liegen auf dem Ablagestapel');
  assert.ok(zwei.p.activeCurses.some((f) => f.kind === 'hungrigerRucksack'), 'der Fluch bleibt');

  const sechs = wurf(6);
  assert.strictEqual(sechs.p.hand.length, 4, 'Wurf 6: die Hand bleibt unversehrt');
  assert.ok(!sechs.p.activeCurses.some((f) => f.kind === 'hungrigerRucksack'), 'Wurf 6: der Fluch endet');
}
// Nur einmal pro Zug, und nur im Zug der verfluchten Person.
{
  const rucksack = findCard('HUNGRIGER RUCKSACK').id;
  const handKarten = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 4).map((c) => c.id);
  const zufall = Math.random;
  const p = makePlayer({ hand: handKarten.slice() });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })], { turnPhase: 'pluendern' });
  S.addActiveCurse(room, p, 'HUNGRIGER RUCKSACK', rucksack);
  Math.random = () => 0.01; // rollDie() -> 1
  try {
    S.setzeZugphase(room, 'gabe');
    S.setzeZugphase(room, 'gabe'); // zweiter Uebergang im selben Zug
  } finally { Math.random = zufall; }
  assert.strictEqual(p.hand.length, 3, 'der Wurf faellt pro Zug nur einmal');

  const fremd = makePlayer({ id: 'p2', name: 'B', hand: handKarten.slice() });
  const room2 = makeRoom([makePlayer({ id: 'p1', name: 'A' }), fremd], { turnPhase: 'pluendern', turnIndex: 0 });
  S.addActiveCurse(room2, fremd, 'HUNGRIGER RUCKSACK', rucksack);
  Math.random = () => 0.01;
  try { S.setzeZugphase(room2, 'gabe'); } finally { Math.random = zufall; }
  assert.strictEqual(fremd.hand.length, 4, 'im fremden Zug frisst der Rucksack nicht');
}

// --- GUMMI-GOLEM: "Du musst in jedem Kampf deine Hilfe anbieten, darfst
// keinen Schatz annehmen, bis du einen verlierst."
{
  const golem = findCard('GUMMI-GOLEM', 'monster');
  const schatz = findCard('FLAMMENDER GIFTTRANK').id;
  const p = makePlayer({ hand: [schatz] });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  S.addActiveCurse(room, p, 'GUMMI-GOLEM', golem.id);
  const eintrag = p.activeCurses.find((f) => f.kind === 'zuckerschock');
  assert.ok(eintrag, 'Zuckerschock ist eingetragen');
  assert.strictEqual(eintrag.schatzStand, 1, 'der Schatzstand beim Eintragen ist festgehalten');
  assert.ok(S.hatSchatzSperre(p), 'kein Schatz, solange der Fluch laeuft');
  assert.deepStrictEqual(S.zieheSchaetzeFuer(room, p, 2), [], 'es wird kein Schatz gezogen');

  // Ende: eine Schatzkarte verlieren.
  p.hand = [];
  assert.ok(!S.hatSchatzSperre(p), 'nach dem Verlust endet die Sperre');
  assert.ok(!p.activeCurses.some((f) => f.kind === 'zuckerschock'), 'der Fluch ist beendet');
}
// Hilfe anbieten: Logzeile bei Kampfbeginn, und die Zusage kann nicht
// abgelehnt werden ("Keiner muss deine Hilfe annehmen, aber du musst sie
// anbieten").
{
  const golem = findCard('GUMMI-GOLEM', 'monster');
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const a = makePlayer({ id: 'p1', name: 'A' });
  const h = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([a, h]);
  S.addActiveCurse(room, h, 'GUMMI-GOLEM', golem.id);
  S.startCombat(room, 'p1', [monster.id], { fromHand: false });
  assert.ok(room.logs.some((l) => /Zuckerschock/i.test(l.text) && /Hilfe/i.test(l.text)), 'das Angebot steht im Verlauf');
  S.handleRequestHelp(room, 'p1', 'p2', 0);
  S.handleRespondHelp(room, 'p2', false); // Ablehnen versucht
  assert.strictEqual(room.combat.helperId, 'p2', 'wer im Zuckerschock ist, darf nicht ablehnen');
}

// --- RIESENKAKERLAKE "+5 gegen Elfen oder Menschen": ein Halb-Blut-Elf hat
// laut Karte keine Nachteile seiner Rasse - und ist auch kein Mensch.
{
  const kakerlake = findCard('RIESENKAKERLAKE', 'monster');
  const elf = findCard('ELF', 'race').id;
  const halbBlut = findCard('HALB-BLUT').id;
  const staerke = (p) => {
    const room = makeRoom([p]);
    S.startCombat(room, p.id, [kakerlake.id], { fromHand: false });
    const wert = S.combatTotals(room).monsterStrength;
    room.combat = null;
    return wert;
  };
  assert.strictEqual(staerke(makePlayer({ races: [elf] })), kakerlake.level + 5, 'Gegenprobe: echter Elf bekommt +5 ab');
  assert.strictEqual(staerke(makePlayer({ races: [elf], raceCapCard: halbBlut })), kakerlake.level, 'Halb-Blut-Elf: kein Bonus');
  assert.strictEqual(staerke(makePlayer({})), kakerlake.level + 5, 'Mensch bekommt weiter +5 ab');
}

fertig();
console.log('card-regelluecken-welle2: alle Checks gruen');
