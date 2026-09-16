// Weglaufen betrifft JEDE beteiligte Person, nicht nur die kaempfende.
//
// Vorher lief nur `actor` weg und nur `actor` bekam die Schlimmen Dinge - wer
// geholfen hatte, kam ohne Wurf und ohne Folgen davon. Jetzt gibt es eine
// Fluchtreihe (combat.fleeQueue/fleeingId): erst die kaempfende Person, dann
// die Helfer:in, jede mit eigenem Wurf und eigenen Modifikatoren. Das Miese
// Zeug wird erst verteilt, wenn alle gewuerfelt haben (beendeFluchtphase).
//
// Damit die Wuerfel nichts verwaschen, laufen die Tests gegen Monster mit
// festem Fluchtausgang: FILZLAUSE ("Denen kannst du nicht entkommen!") und
// TOPFPFLANZE ("Keine. Automatische Flucht.").
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, handleAttemptFlee, handleAckConsequence,
  handleUseGuaranteedFlee, fluechtenderId, handleRequestHelp, handleRespondHelp,
  resolveCombatWin,
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

const treasureFiller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 20).map((c) => c.id);
const raeume = [];

// Verlorener Kampf mit Helfer:in - genau die Lage, um die es geht.
function fluchtRaum(monsterName, extra) {
  const a = makePlayer({ id: 'p1', name: 'A' });
  const b = makePlayer({ id: 'p2', name: 'B' });
  const room = Object.assign({
    code: 'TEST', players: [a, b], turnIndex: 0, turnPhase: 'kampf',
    doorDeck: [], doorDiscard: [], treasureDeck: treasureFiller.slice(), treasureDiscard: [],
    itemAttachments: {}, kartenSperren: [], logs: [], dieRoll: null,
    combatHappenedThisTurn: true, lastCombatWinnerId: null,
    pendingConsequence: null, pendingCardAction: null, pendingRoll: null,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
    combat: {
      actorId: a.id, helperId: b.id, helperPending: null,
      monsterIds: [findCard(monsterName, 'monster').id], enhancerIds: [],
      actorModifier: 0, monsterModifier: 0, treasureDelta: 0, backstabs: {},
      mustFlee: true, fleeQueue: null, fleeingId: null, fleeFailed: [],
      classDiscards: {}, ready: {}, readySignature: null,
    },
  }, extra || {});
  raeume.push(room);
  return { room, a, b };
}

// --- Beide scheitern: beide bekommen das Miese Zeug ------------------------
{
  const { room, a, b } = fluchtRaum('FILZLAUSE');

  // Die kaempfende Person ist zuerst dran.
  assert.strictEqual(fluechtenderId(room), a.id, 'A laeuft zuerst weg');

  // Die Helfer:in darf noch nicht - sonst wuerde die Reihenfolge egal.
  handleAttemptFlee(room, b.id, 0);
  assert.strictEqual(fluechtenderId(room), a.id, 'B kommt nicht vor A dran');

  handleAttemptFlee(room, a.id, 0);
  assert.ok(room.combat, 'der Kampf laeuft weiter - B muss noch');
  assert.strictEqual(fluechtenderId(room), b.id, 'jetzt ist B dran');
  assert.deepStrictEqual(room.combat.fleeFailed, [a.id], 'A ist vorgemerkt');
  assert.strictEqual(room.pendingConsequence, null, 'das Miese Zeug kommt erst am Ende');

  handleAttemptFlee(room, b.id, 0);
  assert.strictEqual(room.combat, null, 'jetzt ist der Kampf vorbei');

  // Helfer:in zuerst - ihre Bestaetigung darf die Zugphase NICHT bewegen.
  assert.ok(room.pendingConsequence, 'eine Konsequenz steht an');
  assert.strictEqual(room.pendingConsequence.playerId, b.id, 'die Helfer:in zuerst');
  assert.strictEqual(room.turnPhase, 'kampf', 'die Phase haengt noch an A');
  handleAckConsequence(room, b.id);

  assert.ok(room.pendingConsequence, 'danach kommt A');
  assert.strictEqual(room.pendingConsequence.playerId, a.id);
  handleAckConsequence(room, a.id);
  assert.strictEqual(room.pendingConsequence, null, 'alles abgehakt');
  assert.strictEqual(room.turnPhase, 'gabe', 'erst A gibt den Zug wieder frei');
}

// --- Beide entkommen: kein Miesen Zeug, Phase laeuft weiter ----------------
{
  const { room, a, b } = fluchtRaum('TOPFPFLANZE');
  handleAttemptFlee(room, a.id, 0);
  assert.ok(room.combat, 'B muss auch noch weglaufen');
  assert.strictEqual(fluechtenderId(room), b.id);
  handleAttemptFlee(room, b.id, 0);
  assert.strictEqual(room.combat, null);
  assert.strictEqual(room.pendingConsequence, null, 'niemand bekommt Schlimme Dinge');
  assert.strictEqual(room.turnPhase, 'gabe');
}

// --- Nur die Helfer:in scheitert ------------------------------------------
{
  const ring = findCard('DER ANDERE RING');
  const { room, a, b } = fluchtRaum('FILZLAUSE');
  a.hand.push(ring.id);
  const stufeVorher = a.level;

  // A entkommt garantiert per Karte - die Reihe geht danach an B.
  handleUseGuaranteedFlee(room, a.id, ring.id);
  assert.ok(room.combat, 'der Kampf laeuft weiter, B ist noch drin');
  assert.strictEqual(fluechtenderId(room), b.id);
  assert.strictEqual(a.level, stufeVorher - 1, 'der Ring kostet A eine Stufe');

  handleAttemptFlee(room, b.id, 0);
  assert.strictEqual(room.combat, null);
  assert.ok(room.pendingConsequence, 'B bekommt das Miese Zeug');
  assert.strictEqual(room.pendingConsequence.playerId, b.id);
  // A ist entkommen, also darf die Phase sofort weiterlaufen.
  assert.strictEqual(room.turnPhase, 'gabe', 'die Phase wartet nicht auf B');
  handleAckConsequence(room, b.id);
  assert.strictEqual(room.turnPhase, 'gabe', 'und B verstellt sie auch nicht');
}

// --- Ohne Helfer:in bleibt alles wie vorher --------------------------------
{
  const { room, a } = fluchtRaum('FILZLAUSE');
  room.combat.helperId = null;
  assert.strictEqual(fluechtenderId(room), a.id);
  handleAttemptFlee(room, a.id, 0);
  assert.strictEqual(room.combat, null, 'eine Person, ein Wurf, fertig');
  assert.strictEqual(room.pendingConsequence.playerId, a.id);
  assert.strictEqual(room.turnPhase, 'kampf', 'die Phase wechselt erst mit der Bestaetigung');
  handleAckConsequence(room, a.id);
  assert.strictEqual(room.turnPhase, 'gabe');
}

// --- Getrennte Helfer:in wird uebersprungen --------------------------------
{
  const { room, a, b } = fluchtRaum('FILZLAUSE');
  b.connected = false;
  handleAttemptFlee(room, a.id, 0);
  assert.strictEqual(room.combat, null, 'auf jemanden, der nicht da ist, wird nicht gewartet');
  assert.strictEqual(room.pendingConsequence.playerId, a.id, 'nur A bekommt das Miese Zeug');
}

// --- Zusage beim Hilfe-Anfragen: die ersten N Schaetze gehen an die Hilfe ---
// "Wer hilft, handelt seinen Anteil aus" ist am Tisch eine Absprache - hier
// wird sie mit der Anfrage festgeschrieben und beim Sieg eingeloest.
{
  // KRAKZILLA: Stufe 18, 4 Schaetze - genug zum Aufteilen.
  const { room, a, b } = fluchtRaum('KRAKZILLA');
  Object.assign(room.combat, { helperId: null, mustFlee: false });

  handleRequestHelp(room, a.id, b.id, 2);
  assert.strictEqual(room.combat.helperPending.reward, 2, 'die Zusage haengt an der Anfrage');
  handleRespondHelp(room, b.id, true);
  assert.strictEqual(room.combat.helperReward, 2, 'und gilt, sobald angenommen wurde');

  resolveCombatWin(room);
  assert.strictEqual(b.hand.length, 2, 'die Helfer:in bekommt genau die zugesagten 2');
  assert.strictEqual(a.hand.length, 2, 'der Rest bleibt bei der kaempfenden Person');
  assert.strictEqual(b.lastReward.cardIds.length, 2, 'und sieht die Belohnung auch angezeigt');
  // Welche Schaetze das sind, geht nur die Helfer:in etwas an: im oeffentlichen
  // Verlauf steht die ANZAHL, aber kein Kartenverweis auf die Beute.
  const verraten = room.logs.filter((l) => (l.cardIds || []).some((id) => b.hand.includes(id)));
  assert.deepStrictEqual(verraten, [], 'keine Helferbeute im Verlauf');
  assert.ok(room.logs.some((l) => l.text.includes(`${b.name} bekommt die zugesagten 2`)),
    'die Anzahl steht weiterhin im Verlauf');
}
{
  // Mehr zusagen, als der Kampf hergibt, geht nicht: LAHMER GOBLIN hat 1.
  const { room, a, b } = fluchtRaum('LAHMER GOBLIN');
  Object.assign(room.combat, { helperId: null, mustFlee: false });
  handleRequestHelp(room, a.id, b.id, 99);
  assert.strictEqual(room.combat.helperPending.reward, 1, 'auf die Schatzzahl des Kampfes geklemmt');
  handleRespondHelp(room, b.id, true);
  resolveCombatWin(room);
  assert.strictEqual(b.hand.length, 1);
  assert.strictEqual(a.hand.length, 0, 'dann bleibt fuer die kaempfende Person nichts uebrig');
}
{
  // Ohne Zusage bleibt alles beim Alten.
  const { room, a, b } = fluchtRaum('KRAKZILLA');
  Object.assign(room.combat, { helperId: null, mustFlee: false });
  handleRequestHelp(room, a.id, b.id);
  handleRespondHelp(room, b.id, true);
  resolveCombatWin(room);
  assert.strictEqual(a.hand.length, 4, 'alle Schaetze an die kaempfende Person');
  assert.strictEqual(b.hand.length, 0);
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('flee-helper: ok');
