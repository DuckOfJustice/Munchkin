// Grosse Gegenstaende: Nicht-Zwerge duerfen nur einen tragen, Zwerge beliebig
// viele. Verhaltenstest - baut einen echten Raum und ruft die Handler auf.
const assert = require('assert');
const {
  ALL_CARDS, isBigItem, handleEquipItem, equippedItemIds, newEquipped, hasRace, baseStrength,
} = require('../server.js');

function byName(name) {
  const c = ALL_CARDS.find((x) => x.name === name);
  assert.ok(c, `Karte "${name}" nicht in den Kartendaten gefunden`);
  return c;
}

function makePlayer(overrides) {
  return Object.assign({
    id: 'p1', name: 'Test', level: 5, hand: [], races: [], classes: [], powerGroups: [],
    raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), isBot: false, connected: true,
  }, overrides || {});
}

function makeRoom(players) {
  return {
    // turnIndex/turnPhase: Ausruestung darf nur im eigenen Zug geaendert
    // werden (siehe darfAusruesten in server.js).
    code: 'TEST', players, turnIndex: 0, turnPhase: 'tuer',
    doorDiscard: [], treasureDiscard: [], logs: [], combat: null, cleanupTimer: null,
  };
}

// 1) Die kuratierte Liste trifft die abgestimmten acht Karten
const erwartet = [
  'KETTENSÄGE DER BLUTIGEN ZERSTÜCKELUNG', 'STANGE, 11-FUSS', 'RIESIGER FELS',
  'MITHRIL-RÜSTUNG', 'SCHWEIZER ARMEEHELLEBARDE', 'GANZKÖRPER-SCHILD',
  'TUBA DER VERZAUBERUNG', 'TRITTLEITER',
];
erwartet.forEach((n) => assert.ok(isBigItem(byName(n)), `${n} muesste gross sein`));
['BOGEN MIT BUNTEN BÄNDERN', 'NAPALMSTAB', 'KURZE, BREITE RÜSTUNG',
 'STRUMPFHOSE DER RIESENSTÄRK'].forEach((n) => {
  assert.ok(!isBigItem(byName(n)), `${n} darf NICHT gross sein`);
});

// 2) Nicht-Zwerg: zweiter Grosser Gegenstand wird abgelehnt
{
  const fels = byName('RIESIGER FELS');          // 2 Haende, gross
  const mithril = byName('MITHRIL-RÜSTUNG');     // Ruestung, gross
  const p = makePlayer({ hand: [fels.id, mithril.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, mithril.id);
  assert.ok(equippedItemIds(p).includes(mithril.id), 'erster Grosser Gegenstand muss anlegbar sein');
  handleEquipItem(room, p.id, fels.id);
  assert.ok(!equippedItemIds(p).includes(fels.id), 'zweiter Grosser Gegenstand muss abgelehnt werden');
  assert.ok(p.hand.includes(fels.id), 'abgelehnte Karte bleibt auf der Hand');
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer); // touchRoom-Timer aufräumen
}

// 3) Zwerg: beliebig viele
{
  const zwerg = ALL_CARDS.find((x) => x.name === 'ZWERG');
  const fels = byName('RIESIGER FELS');
  const mithril = byName('MITHRIL-RÜSTUNG');
  const p = makePlayer({ hand: [fels.id, mithril.id], races: [zwerg.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, mithril.id);
  handleEquipItem(room, p.id, fels.id);
  assert.ok(equippedItemIds(p).includes(mithril.id) && equippedItemIds(p).includes(fels.id),
    'Zwerg muss beide Grossen Gegenstaende tragen duerfen');
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
}

// 4) Ein kleiner Gegenstand bleibt unbeschraenkt
{
  const leder = byName('LEDERRÜSTUNG');
  const p = makePlayer({ hand: [leder.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, leder.id);
  assert.ok(equippedItemIds(p).includes(leder.id), 'kleine Gegenstaende bleiben unbeschraenkt');
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
}

// 5) Zweihaendige Gegenstaende zaehlen EINMAL. Sie belegen beide Handslots
// (equipped.hands = [id, id]) - wer die Slots einfach einsammelt, zaehlt die
// Karte doppelt: der Bogen mit bunten Baendern gab +8 statt +4, und ebenso
// verdoppelten sich Goldwert, Gegenstandszahl und Ablagestapel-Eintraege.
{
  const bogen = byName('BOGEN MIT BUNTEN BÄNDERN'); // 2 Haende, +4
  const p = makePlayer({ hand: [bogen.id] });
  const room = makeRoom([p]);
  const stufeVorher = p.level;
  handleEquipItem(room, p.id, bogen.id);
  assert.deepStrictEqual(p.equipped.hands, [bogen.id, bogen.id], 'er belegt weiterhin beide Haende');
  assert.deepStrictEqual(equippedItemIds(p), [bogen.id], 'aber er ist nur EIN getragener Gegenstand');
  assert.strictEqual(baseStrength(p), stufeVorher + bogen.bonus, 'Bonus zaehlt einfach, nicht doppelt');
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
}

console.log('OK - Grosse Gegenstaende: Liste, Zwergen-Ausnahme, Ablehnung des zweiten.');
