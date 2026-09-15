// Clerical Errors, Task 7 (Plan 2026-09-13): der Rest.
//
// ZAUBERCOUCH/FALSCHE OHREN (geliehene Klasse/Rasse), PACKRATTE (Geschenk
// statt Kampf), DER GANZ NORMALE HASE (Wuerfel nach der Helferfrage), DRYADE
// (Zauberer verliert die Klasse), RAPIER-TROTTEL (Verstaerker doppelt),
// DAS DUNGEON-CASINO, EINSTWEILIGE VERFÜGUNG, UNFASSBAR REICH und
// MONSTER SIND BESCHÄFTIGT.
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, hasClass, monsterSeesRace, combatTotals,
  startCombat, hasenWurf, handlePlayCombatCard, handlePlayCurseFromHand,
  applyTargetAction, TREASURE_POWER_OVERRIDES, DOOR_COMBAT_CARDS,
  monsterPassOption, FLEE_ITEM_BONUS, applyPrimitiveAction, handleResolveCardChoice,
  handleDrawDoor, handleResolveCardCardChoice, endTurn, CONSEQUENCE_OVERRIDES,
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
function makeRoom(players, extra) {
  const room = Object.assign({
    code: 'TEST', players, turnIndex: 0, turnPhase: 'kampf',
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
    itemAttachments: {}, kartenSperren: [], logs: [], combat: null,
    combatHappenedThisTurn: false, lastCombatWinnerId: null, pendingRoll: null,
    pendingConsequence: null, pendingCardAction: null,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  }, extra || {});
  raeume.push(room);
  return room;
}

function mitKampf(room, monsterIds, actorId) {
  room.combat = {
    actorId: actorId || room.players[0].id, helperId: null, helperPending: null,
    monsterIds, enhancerIds: [], actorModifier: 0, monsterModifier: 0,
    treasureDelta: 0, backstabs: {}, mustFlee: false, classDiscards: {},
    ready: {}, readySignature: null,
  };
  return room;
}

// --- ZAUBERCOUCH: gilt als Zauberer, -1 auf Weglaufen ----------------------
{
  const couch = findCard('ZAUBERCOUCH');
  const p = makePlayer({});
  assert.ok(!hasClass(p, 'ZAUBERER'), 'vorher kein Zauberer');
  p.equipped.special = [couch.id];
  assert.ok(hasClass(p, 'ZAUBERER'), '"in allen Belangen als Zauberer angesehen"');
  assert.strictEqual(FLEE_ITEM_BONUS['ZAUBERCOUCH'], -1, 'der Preis dafuer');
}

// --- FALSCHE OHREN: nur fuer Monster ein Elf -------------------------------
{
  const ohren = findCard('FALSCHE OHREN');
  const p = makePlayer({});
  p.equipped.special = [ohren.id];
  assert.ok(monsterSeesRace(p, 'ELF'), 'Monster reagieren, als waere er ein Elf');

  // GESICHTSSAUGER hat "+6 gegen Elfen".
  const sauger = findCard('GESICHTSSAUGER', 'monster');
  const staerke = (spieler) => {
    const room = mitKampf(makeRoom([spieler]), [sauger.id]);
    return combatTotals(room).monsterStrength;
  };
  assert.strictEqual(staerke(p) - staerke(makePlayer({})), 6, 'der Elfen-Malus trifft den Traeger');
}

// --- PACKRATTE: Geschenk statt Kampf ---------------------------------------
{
  const ratte = findCard('PACKRATTE', 'monster');
  const ohneZeug = makePlayer({});
  assert.ok(monsterPassOption(ratte.id, ohneZeug) === null, 'die Packratte ist keine Vorbeigeh-Karte');

  const room = makeRoom([ohneZeug], { treasureDeck: [findCard('WUNSCHRING').id, findCard('SCHLITTENGLOCKE').id] });
  const desc = applyPrimitiveAction(room, ohneZeug, { type: 'packratteGeschenk', cardId: ratte.id });
  assert.ok(/zwei offene Schaetze/.test(desc), desc);
  assert.ok(room.pendingCardAction, 'die Wahl zwischen beiden steht an');
  const wahl = room.pendingCardAction.options[0];
  handleResolveCardChoice(room, ohneZeug.id, wahl.id);
  assert.strictEqual(ohneZeug.hand.length, 1, 'genau eine Karte wird behalten');
  assert.strictEqual(room.treasureDiscard.length, 1, 'die andere geht auf den Ablagestapel');
}

// --- PACKRATTE ueber den echten Weg: Tuer ziehen -> "Geschenk annehmen" ----
// Die Schatzwahl wird aus einer laufenden Wahl heraus geoeffnet. Frueher
// raeumte die Abwicklung von handleResolveCardChoice sie sofort wieder weg -
// der Zug lief ohne Auswahl weiter (siehe finishCardAction in server.js).
{
  const ratte = findCard('PACKRATTE', 'monster');
  const p = makePlayer({});
  const room = makeRoom([p], {
    turnPhase: 'tuer',
    doorDeck: [ratte.id],
    treasureDeck: [findCard('WUNSCHRING').id, findCard('SCHLITTENGLOCKE').id],
  });
  handleDrawDoor(room, p.id);
  assert.ok(room.pendingCardAction, 'kaempfen oder Geschenk annehmen');
  const geschenk = room.pendingCardAction.options.find((o) => o.id === 'alt');
  handleResolveCardChoice(room, p.id, geschenk.id);
  assert.ok(room.pendingCardAction, 'die Wahl zwischen den zwei offenen Schaetzen steht an');
  assert.strictEqual(room.pendingCardAction.options.length, 2);
  handleResolveCardChoice(room, p.id, room.pendingCardAction.options[0].id);
  assert.strictEqual(p.hand.length, 1, 'genau eine Karte wird behalten');
  assert.strictEqual(room.treasureDiscard.length, 1, 'die andere geht auf den Ablagestapel');
  assert.strictEqual(room.pendingCardAction, null, 'danach ist kein Dialog mehr offen');
}

// --- DER GANZ NORMALE HASE -------------------------------------------------
{
  const hase = findCard('DER GANZ NORMALE HASE', 'monster'); // Stufe 2
  let verfilmt = 0; let normal = 0;
  for (let i = 0; i < 200; i++) {
    const p = makePlayer({});
    const room = mitKampf(makeRoom([p]), [hase.id]);
    hasenWurf(room);
    const stufe = combatTotals(room).monsterLevel;
    if (stufe === 15) verfilmt++; else if (stufe === hase.level) normal++;
    // Ein zweiter Aufruf darf nichts mehr aendern.
    hasenWurf(room);
    assert.strictEqual(combatTotals(room).monsterLevel, stufe, 'es wird nur einmal gewuerfelt');
  }
  assert.ok(verfilmt > 0 && normal > 0, `beide Ausgaenge kommen vor (${verfilmt} verfilmt, ${normal} normal)`);
}

// --- DRYADE: Zauberer verliert beim Kampfbeginn seine Klasse ---------------
{
  const dryade = findCard('DRYADE', 'monster');
  const zauberer = findCard('ZAUBERER', 'class');
  const p = makePlayer({ classes: [zauberer.id] });
  const room = makeRoom([p]);
  startCombat(room, p.id, [dryade.id], {});
  assert.deepStrictEqual(p.classes, [], 'die Zauberer-Klasse ist sofort weg');
  assert.ok(room.doorDiscard.includes(zauberer.id), 'und liegt auf dem Ablagestapel');
}

// --- RAPIER-TROTTEL verdoppelt Monsterverstaerker --------------------------
{
  const trottel = findCard('RAPIER-TROTTEL', 'monster');
  const medusa = findCard('MEDUSA', 'monster');
  const verstaerker = findCard('NICHT SCHICK GENUG', 'door_other'); // +5

  const mit = mitKampf(makeRoom([makePlayer({ hand: [verstaerker.id] })]), [trottel.id]);
  const vorherMit = combatTotals(mit).monsterStrength;
  handlePlayCombatCard(mit, mit.players[0].id, verstaerker.id);
  assert.strictEqual(combatTotals(mit).monsterStrength - vorherMit, 10, 'auf dem Trottel zaehlt +5 doppelt');

  const ohne = mitKampf(makeRoom([makePlayer({ hand: [verstaerker.id] })]), [medusa.id]);
  const vorherOhne = combatTotals(ohne).monsterStrength;
  handlePlayCombatCard(ohne, ohne.players[0].id, verstaerker.id);
  assert.strictEqual(combatTotals(ohne).monsterStrength - vorherOhne, 5, 'sonst wie gedruckt');
}

// --- DAS DUNGEON-CASINO ----------------------------------------------------
{
  const casino = TREASURE_POWER_OVERRIDES['DAS DUNGEON-CASINO'];
  const arm = makePlayer({});
  assert.strictEqual(casino(arm, makeRoom([arm])), null, 'ohne 500 GS kein Einsatz');

  const reich = makePlayer({ hand: [findCard('ZWEIHÄNDIGES SCHWERT').id] }); // 800 GS
  const room = makeRoom([reich]);
  assert.deepStrictEqual(casino(reich, room), { type: 'dungeonCasino' });
  assert.strictEqual(casino(reich, makeRoom([reich], { combat: {} })), null, 'im Kampf nicht spielbar');

  // Einsatz geht weg, dann passiert etwas Wuerfelabhaengiges.
  const vorher = reich.level;
  room.treasureDeck = [findCard('WUNSCHRING').id, findCard('SCHLITTENGLOCKE').id, findCard('KETTEN-BIKINI').id];
  const desc = applyPrimitiveAction(room, reich, { type: 'dungeonCasino' });
  assert.ok(!reich.hand.includes(findCard('ZWEIHÄNDIGES SCHWERT').id), 'der Einsatz ist abgeworfen');
  assert.ok(/Wuerfelwurf/.test(desc), desc);
  assert.ok(reich.level === vorher || reich.level === vorher - 1, 'hoechstens die eine Stufe aus der 1');
}

// --- EINSTWEILIGE VERFÜGUNG ------------------------------------------------
{
  const a = makePlayer({ id: 'p1', name: 'A' });
  const fluch = findCard('VERLIERE 1 STUFE', 'door_other');
  const b = makePlayer({ id: 'p2', name: 'B', hand: [fluch.id] });
  const room = makeRoom([a, b], { turnIndex: 0 });

  applyTargetAction(room, a, b, { type: 'kartenSperre' });
  assert.strictEqual(room.kartenSperren.length, 1);

  handlePlayCurseFromHand(room, b.id, fluch.id, a.id);
  assert.ok(b.hand.includes(fluch.id), 'der Fluch bleibt auf der Hand');
  assert.strictEqual(room.pendingConsequence, null, 'und trifft niemanden');

  // Gegen jemand anderen darf B weiterhin spielen.
  const c = makePlayer({ id: 'p3', name: 'C' });
  room.players.push(c);
  handlePlayCurseFromHand(room, b.id, fluch.id, c.id);
  assert.ok(!b.hand.includes(fluch.id), 'gegen C geht es');
}

// --- UNFASSBAR REICH / MONSTER SIND BESCHÄFTIGT ----------------------------
{
  assert.deepStrictEqual(DOOR_COMBAT_CARDS['UNFASSBAR REICH'](), { type: 'schatzUmtauschAnmelden' });
  assert.deepStrictEqual(DOOR_COMBAT_CARDS['MONSTER SIND BESCHÄFTIGT'](), { type: 'endCombatNoLevel' });

  // Der Tausch selbst: Karte raus, neue rein.
  const alt = findCard('WUNSCHRING');
  const neu = findCard('SCHLITTENGLOCKE');
  const p = makePlayer({ hand: [alt.id] });
  const room = makeRoom([p], { treasureDeck: [neu.id] });
  applyPrimitiveAction(room, p, { type: 'schatzTauschen', cardId: alt.id });
  assert.deepStrictEqual(p.hand, [neu.id], 'getauscht');
  assert.ok(room.treasureDiscard.includes(alt.id));
}

// --- Tod: Stufe bleibt, die anderen pluendern die Leiche -------------------
// Gedruckte Regel: "Du verlierst alle deine Karten - die anderen pluendern die
// Leiche. Stufe, Rasse und Klasse behaeltst du." Frueher setzte der Server auf
// Stufe 1 und warf alles direkt auf die Ablagestapel.
{
  const ruestung = findCard('KETTEN-BIKINI');
  const handkarte = findCard('MONSTERFUTTER');
  const toter = makePlayer({ id: 'p1', level: 7, hand: [handkarte.id] });
  toter.equipped.armor = ruestung.id;
  const raeuber = makePlayer({ id: 'p2', name: 'B', level: 3 });
  const room = makeRoom([toter, raeuber]);

  applyPrimitiveAction(room, toter, { type: 'death' });
  assert.strictEqual(toter.level, 7, 'der Tod kostet keine Stufe');
  assert.ok(room.pendingCardAction, 'die Leiche wird gepluendert');
  assert.strictEqual(room.pendingCardAction.playerId, 'p2');
  assert.deepStrictEqual([...room.pendingCardAction.candidateIds].sort(), [handkarte.id, ruestung.id].sort());

  handleResolveCardCardChoice(room, 'p2', ruestung.id);
  assert.ok(raeuber.hand.includes(ruestung.id), 'die angelegte Ruestung wechselt den Besitzer');
  assert.strictEqual(toter.equipped.armor, null);
  handleResolveCardCardChoice(room, 'p2', handkarte.id);
  assert.deepStrictEqual(raeuber.hand.sort(), [ruestung.id, handkarte.id].sort());
  assert.strictEqual(toter.hand.length, 0, 'die Leiche ist leer');
  assert.strictEqual(room.pendingCardAction, null, 'danach ist kein Dialog mehr offen');
}
{
  // Allein am Tisch: nichts zu pluendern, alles geht auf die Ablagestapel.
  const p = makePlayer({ id: 'p1', level: 5, hand: [findCard('MONSTERFUTTER').id] });
  const room = makeRoom([p]);
  applyPrimitiveAction(room, p, { type: 'death' });
  assert.strictEqual(p.level, 5);
  assert.strictEqual(p.hand.length, 0);
  assert.strictEqual(room.treasureDiscard.length, 1);
}

// --- KALI: "Stirb, stirb, stirb - und setze auch deinen naechsten Zug aus" --
{
  const a = makePlayer({ id: 'p1', level: 4 });
  const b = makePlayer({ id: 'p2', name: 'B' });
  const c = makePlayer({ id: 'p3', name: 'C' });
  const room = makeRoom([a, b, c], { turnIndex: 2, turnPhase: 'gabe' });
  const spec = CONSEQUENCE_OVERRIDES['KALI'](a, room);
  assert.deepStrictEqual(spec.actions.map((x) => x.type), ['death', 'skipNextTurn']);
  applyPrimitiveAction(room, a, spec);
  assert.strictEqual(a.level, 4, 'auch KALI kostet keine Stufe');
  assert.strictEqual(a.skipTurns, 1);
  endTurn(room); // p3 -> p1 (setzt aus) -> p2
  assert.strictEqual(room.players[room.turnIndex].id, 'p2', 'p1 wird uebersprungen');
  assert.strictEqual(a.skipTurns, 0, 'nur ein Zug faellt aus');
  endTurn(room);
  assert.strictEqual(room.players[room.turnIndex].id, 'p3');
  endTurn(room);
  assert.strictEqual(room.players[room.turnIndex].id, 'p1', 'danach ist p1 wieder normal dran');
}

// --- EINHEITSGRÖSSE: oberster TRAGBARER Gegenstand des Schatzstapels -------
// Frueher ein Waehler ueber BEIDE Ablagestapel und alle Kartentypen - man
// konnte ein Monster aus dem Tuerstapel ziehen oder die Karte selbst zurueck-
// holen.
{
  const p = makePlayer({ id: 'p1' });
  const room = makeRoom([p], {
    doorDiscard: [findCard('MEDUSA', 'monster').id],
    // alt -> neu: der SPASSBREMSE liegt oben, der KETTEN-BIKINI darunter.
    treasureDiscard: [findCard('KETTEN-BIKINI').id, findCard('MONSTERFUTTER').id, findCard('SPASSBREMSE').id],
  });
  room.combat = { actorId: 'p1', helperId: null, monsterIds: [], enhancerIds: [], actorModifier: 0, monsterModifier: 0, treasureDelta: 0, backstabs: {}, mustFlee: false, classDiscards: {}, ready: {}, readySignature: null };
  const spec = TREASURE_POWER_OVERRIDES['EINHEITSGRÖSSE'](p, room);
  applyPrimitiveAction(room, p, spec);
  assert.deepStrictEqual(p.hand, [findCard('SPASSBREMSE').id], 'der oberste tragbare Gegenstand');
  assert.ok(!room.treasureDiscard.includes(findCard('SPASSBREMSE').id), 'und liegt nicht mehr im Ablagestapel');
  assert.strictEqual(p.attachments.cheatedItemId, findCard('SPASSBREMSE').id, 'darf ohne die normalen Beschraenkungen angelegt werden');
  assert.ok(!room.pendingCardAction, 'es gibt nichts zu waehlen');
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-clerical-rest: ok');
