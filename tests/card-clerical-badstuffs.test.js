// Clerical Errors, Task 3 (Plan 2026-09-13): Schlimme Dinge und das
// Geschlechtsmerkmal.
//
// Neu sind drei Primitive:
//   queuedDiscardOwn      - N eigene Karten/Gegenstaende selbst aussuchen
//                           (TEQUILA-LIEDCHEN, RÜSSELKÄFER, DOPPELGANGSTER)
//   queuedDiscardEachOther - jede andere Person legt 1 Gegenstand ab
//                           (KAMIKAZE-KOBOLDE)
//   setGender             - GESCHLECHTSUMWANDLUNG ("permanent") und
//                           STRICHMÄNNCHEN ("weder maennlich noch weiblich")
//
// Alle starten maennlich (newPlayer), niemand waehlt etwas aus.
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, resolveConsequenceSpec, applyPrimitiveAction,
  handleResolveCardCardChoice, istGeschlecht, pruefeSlipperVerlust,
  handleEquipItem, combatTotals, DOOR_OTHER_AS_CURSE,
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
    code: 'TEST', players, turnIndex: 0, turnPhase: 'kampf',
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
    logs: [], combat: null, combatHappenedThisTurn: false,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  };
  raeume.push(room);
  return room;
}

const spec = (name, player, room) => {
  const c = findCard(name);
  return resolveConsequenceSpec(c.name, c.badstuff, player, room);
};

// --- TEQUILA-LIEDCHEN: "Lege zwei Karten (deiner Wahl) aus deiner Hand ab." -
{
  const karten = [findCard('WUNSCHRING').id, findCard('VORPALE KLINGE').id, findCard('SCHLITTENGLOCKE').id];
  const p = makePlayer({ hand: karten.slice() });
  const room = makeRoom([p]);
  applyPrimitiveAction(room, p, spec('TEQUILA-LIEDCHEN', p, room));

  // Erste Wahl steht an - der Server legt nichts von selbst ab.
  assert.strictEqual(p.hand.length, 3, 'vor der Wahl bleibt die Hand unangetastet');
  assert.ok(room.pendingCardAction, 'eine Wahl ist offen');
  assert.strictEqual(room.pendingCardAction.playerId, p.id);
  handleResolveCardCardChoice(room, p.id, karten[0]);
  assert.strictEqual(p.hand.length, 2, 'erste Karte abgelegt');
  assert.ok(room.pendingCardAction, 'zweite Wahl steht an');
  handleResolveCardCardChoice(room, p.id, karten[1]);
  assert.strictEqual(p.hand.length, 1, 'zweite Karte abgelegt');
  assert.strictEqual(room.pendingCardAction, null, 'danach ist die Warteschlange leer');
  assert.deepStrictEqual(room.doorDiscard.concat(room.treasureDiscard).sort(), [karten[0], karten[1]].sort());
}

// --- RÜSSELKÄFER: "Opfere eine Karte deiner Wahl." -------------------------
{
  const p = makePlayer({ hand: [findCard('WUNSCHRING').id] });
  const room = makeRoom([p]);
  applyPrimitiveAction(room, p, spec('RÜSSELKÄFER', p, room));
  handleResolveCardCardChoice(room, p.id, p.hand[0]);
  assert.strictEqual(p.hand.length, 0, 'eine Karte geopfert');
}

// --- DOPPELGANGSTER: "Verliere 2 kleine Gegenstaende deiner Wahl." ---------
{
  const klein1 = findCard('VORPALE KLINGE');
  const klein2 = findCard('SCHLITTENGLOCKE');
  const gross = findCard('GROSSE, FIESE LEIER'); // Grosser Gegenstand
  const p = makePlayer({});
  p.equipped.hands = [klein1.id, klein2.id];
  p.equipped.head = findCard('PRÄCHTIGER HUT').id;
  p.equipped.special = [gross.id]; // getragen, aber gross -> nicht waehlbar
  const room = makeRoom([p]);
  applyPrimitiveAction(room, p, spec('DOPPELGANGSTER', p, room));
  assert.ok(room.pendingCardAction.candidateIds.includes(klein1.id), 'kleine Gegenstaende stehen zur Wahl');
  assert.ok(!room.pendingCardAction.candidateIds.includes(gross.id), 'Grosse Gegenstaende stehen nicht zur Wahl');
  handleResolveCardCardChoice(room, p.id, klein1.id);
  handleResolveCardCardChoice(room, p.id, klein2.id);
  assert.deepStrictEqual(p.equipped.hands, [null, null], 'beide kleinen Gegenstaende weg');
  assert.ok(p.equipped.head, 'der Hut blieb, weil nur zwei Stueck faellig waren');
}

// --- KAMIKAZE-KOBOLDE: 2 eigene, dann je 1 bei allen anderen ---------------
{
  const a = makePlayer({ id: 'p1', name: 'A' });
  const b = makePlayer({ id: 'p2', name: 'B' });
  a.equipped.hands = [findCard('VORPALE KLINGE').id, findCard('SCHLITTENGLOCKE').id];
  b.equipped.head = findCard('PRÄCHTIGER HUT').id;
  const room = makeRoom([a, b]);
  applyPrimitiveAction(room, a, spec('KAMIKAZE-KOBOLDE', a, room));
  handleResolveCardCardChoice(room, a.id, a.equipped.hands[0]);
  handleResolveCardCardChoice(room, a.id, a.equipped.hands.find(Boolean));
  assert.deepStrictEqual(a.equipped.hands, [null, null], 'die eigenen zwei sind weg');
  assert.strictEqual(room.pendingCardAction.playerId, b.id, 'jetzt ist B dran');
  handleResolveCardCardChoice(room, b.id, b.equipped.head);
  assert.strictEqual(b.equipped.head, null, 'B hat auch einen Gegenstand verloren');
}

// --- GOTHYANKI: Niedrigere steigen auf, man selbst verliert diese Anzahl ---
{
  const a = makePlayer({ id: 'p1', name: 'A', level: 6 });
  const b = makePlayer({ id: 'p2', name: 'B', level: 3 });
  const c = makePlayer({ id: 'p3', name: 'C', level: 4 });
  const d = makePlayer({ id: 'p4', name: 'D', level: 6 });
  const room = makeRoom([a, b, c, d]);
  applyPrimitiveAction(room, a, spec('GOTHYANKI', a, room));
  assert.strictEqual(b.level, 4);
  assert.strictEqual(c.level, 5);
  assert.strictEqual(d.level, 6, 'gleiche Stufe steigt nicht auf');
  assert.strictEqual(a.level, 4, '6 minus 2 niedrigere');
}

// --- BOBBELKOPF: nur Orks ziehen eine Karte --------------------------------
{
  const ORK = findCard('ORK', 'door_other');
  const a = makePlayer({ id: 'p1', name: 'A', hand: [findCard('WUNSCHRING').id] });
  const b = makePlayer({ id: 'p2', name: 'B' });                    // kein Ork
  const c = makePlayer({ id: 'p3', name: 'C', races: [ORK.id] });   // Ork
  const room = makeRoom([a, b, c]);
  applyPrimitiveAction(room, a, spec('BOBBELKOPF', a, room));
  assert.ok(room.pendingCardAction, 'der Ork ist dran');
  assert.strictEqual(room.pendingCardAction.playerId, c.id, 'nur der Ork zieht, B wird uebersprungen');
  handleResolveCardCardChoice(room, c.id, a.hand[0]);
  assert.strictEqual(a.hand.length, 0);
  assert.strictEqual(c.hand.length, 1, 'der Ork hat die Karte');
}

// --- Geschlecht ------------------------------------------------------------
{
  const p = makePlayer({});
  assert.strictEqual(p.gender, 'm', 'alle starten maennlich');
  assert.ok(istGeschlecht(p, 'm'));
  assert.ok(!istGeschlecht(p, 'w'));

  const room = makeRoom([p]);
  // GESCHLECHTSUMWANDLUNG: "Die Umwandlung ist jedoch permanent."
  const umwandlung = findCard('GESCHLECHTSUMWANDLUNG', 'door_other');
  applyPrimitiveAction(room, p, resolveConsequenceSpec(umwandlung.name, umwandlung.text, p, room));
  assert.strictEqual(p.gender, 'w', 'nach der Umwandlung weiblich');

  // STRICHMÄNNCHEN macht geschlechtslos ...
  applyPrimitiveAction(room, p, spec('STRICHMÄNNCHEN', p, room));
  assert.strictEqual(p.gender, null);
  assert.ok(!istGeschlecht(p, 'm') && !istGeschlecht(p, 'w'), 'geschlechtslos passt auf keine Regel');

  // ... bis jemand anderes wechselt: dann uebernimmt man dessen Geschlecht.
  const q = makePlayer({ id: 'p2', name: 'B' });
  room.players.push(q);
  applyPrimitiveAction(room, q, resolveConsequenceSpec(umwandlung.name, umwandlung.text, q, room));
  assert.strictEqual(q.gender, 'w');
  assert.strictEqual(p.gender, 'w', 'die geschlechtslose Person nimmt das neue Geschlecht an');
}

// CHAUVINISTENSCHWEIN: Frauen verlieren die Ruestung, Maenner 1 Stufe.
{
  const frau = makePlayer({ gender: 'w' });
  frau.equipped.armor = findCard('KETTEN-BIKINI').id;
  const room = makeRoom([frau]);
  applyPrimitiveAction(room, frau, spec('CHAUVINISTENSCHWEIN', frau, room));
  assert.strictEqual(frau.equipped.armor, null, 'Frauen verlieren die Ruestung');

  const mann = makePlayer({ gender: 'm', level: 5 });
  applyPrimitiveAction(room, mann, spec('CHAUVINISTENSCHWEIN', mann, room));
  assert.strictEqual(mann.level, 4, 'Maenner verlieren 1 Stufe');
}

// Monsterboni nach Geschlecht: CHAUVINISTENSCHWEIN +5 gegen Frauen,
// TANTE PALADIN +5 gegen maennliche Charaktere.
{
  const schwein = findCard('CHAUVINISTENSCHWEIN', 'monster');
  const staerke = (p) => {
    const room = makeRoom([p]);
    room.combat = { actorId: p.id, helperId: null, monsterIds: [schwein.id], actorModifier: 0, monsterModifier: 0, backstabbed: {} };
    return combatTotals(room).monsterStrength;
  };
  assert.strictEqual(staerke(makePlayer({ gender: 'w' })) - staerke(makePlayer({ gender: 'm' })), 5,
    'das Schwein hat +5 gegen Frauen');

  const tante = findCard('TANTE PALADIN', 'monster');
  const tanteStaerke = (p) => {
    const room = makeRoom([p]);
    room.combat = { actorId: p.id, helperId: null, monsterIds: [tante.id], actorModifier: 0, monsterModifier: 0, backstabbed: {} };
    return combatTotals(room).monsterStrength;
  };
  assert.strictEqual(tanteStaerke(makePlayer({ gender: 'm' })) - tanteStaerke(makePlayer({ gender: null })), 5,
    'die Tante hat +5 gegen maennliche Charaktere');
}

// FREUD'SCHEN SLIPPER: waehrend des Tragens keine Geschlechter-Strafe,
// danach -5, wenn sich das Geschlecht in der Zwischenzeit geaendert hat.
{
  const slipper = findCard("FREUD'SCHEN SLIPPER", 'item');
  const p = makePlayer({ gender: 'w', hand: [slipper.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, slipper.id);
  assert.strictEqual(p.equipped.feet, slipper.id, 'Slipper liegen an');
  assert.strictEqual(p.genderBeiSlippern, 'w', 'Geschlecht beim Anlegen gemerkt');
  assert.ok(!istGeschlecht(p, 'w') && !istGeschlecht(p, 'm'), 'mit Slippern greift keine Geschlechtsregel');

  // Slipper verloren, Geschlecht unveraendert -> keine Strafe.
  p.equipped.feet = null;
  pruefeSlipperVerlust(room, p);
  assert.strictEqual(p.activeCurses.length, 0, 'gleiches Geschlecht: keine Strafe');

  // Noch einmal, diesmal mit Wechsel dazwischen.
  p.hand.push(slipper.id);
  handleEquipItem(room, p.id, slipper.id);
  p.gender = 'm';
  p.equipped.feet = null;
  pruefeSlipperVerlust(room, p);
  assert.strictEqual(p.activeCurses.length, 1, 'anderes Geschlecht: -5 im naechsten Kampf');
  assert.strictEqual(p.activeCurses[0].amount, -5);
}

// --- Nachtraege aus dem Review (2026-09-14) ---------------------------------
// PACKRATTE: "Erzwungener Tausch! Wirf den Gegenstand mit dem hoechsten Wert
// ab, den du im Spiel hast, UND ziehe einen offenen Schatz." Der Schatz war
// nicht implementiert - die Schlimmen Dinge waren ein reiner Verlust.
{
  const helm = findCard('GEILER HELM');
  const beute = findCard('WUNSCHRING');
  const p = makePlayer({});
  p.equipped.head = helm.id;
  const room = makeRoom([p]);
  room.treasureDeck = [beute.id];
  applyPrimitiveAction(room, p, spec('PACKRATTE', p, room));
  assert.strictEqual(p.equipped.head, null, 'der teuerste Gegenstand ist weg');
  assert.deepStrictEqual(p.hand, [beute.id], 'dafuer kommt der offene Schatz auf die Hand');
}

// --- ROTZ-ELEMENTAR: "Du verlierst alle Gegenstaende, die einen Bonus fuer
// deine aktuelle(n) Rasse(n) gewaehren." Fuer ORK gab es kein Adjektiv in
// RACE_ADJECTIVE_DE, also behielt ein Ork den SCHÄDELHELM ("+2 Bonus fuer
// Orks") einfach. ---------------------------------------------------------
{
  const ork = findCard('ORK', 'door_other');
  const helm = findCard('SCHÄDELHELM');
  const p = makePlayer({ races: [ork.id] });
  p.equipped.head = helm.id;
  const room = makeRoom([p]);
  const desc = applyPrimitiveAction(room, p, spec('ROTZ-ELEMENTAR', p, room));
  assert.strictEqual(p.equipped.head, null, `der Ork-Helm haette weg gemusst: ${desc}`);
}

// --- SIEBENJÄHRIGER LICH: Tod UND eine Stufe -------------------------------
// "Wenn er dich erwischt, stirbst du nicht nur, sondern verlierst auch eine
// Stufe." Der Tod selbst kostet keine Stufe mehr (gedruckte Regel), also
// zaehlt dieser Zusatz wirklich.
{
  const opfer = makePlayer({ id: 'p1', level: 6, hand: [findCard('MONSTERFUTTER').id] });
  const raeuber = makePlayer({ id: 'p2', name: 'B', level: 3 });
  const room = makeRoom([opfer, raeuber]);
  const futter = findCard('MONSTERFUTTER').id;
  applyPrimitiveAction(room, opfer, resolveConsequenceSpec('SIEBENJÄHRIGER LICH', 'x', opfer, room));
  assert.strictEqual(opfer.level, 5, 'Tod kostet keine Stufe, die Karte aber schon eine');
  // Der Tod oeffnet das Pluendern der Leiche - danach ist die Hand leer.
  assert.ok(room.pendingCardAction, 'die Leiche wird gepluendert');
  handleResolveCardCardChoice(room, 'p2', futter);
  assert.strictEqual(opfer.hand.length, 0, 'und alle Karten sind weg');
  assert.ok(raeuber.hand.includes(futter), 'die Karte hat den Besitzer gewechselt');
}
{
  // Unter Stufe 1 geht es nie.
  const p = makePlayer({ id: 'p1', level: 1 });
  const room = makeRoom([p]);
  applyPrimitiveAction(room, p, resolveConsequenceSpec('SIEBENJÄHRIGER LICH', 'x', p, room));
  assert.strictEqual(p.level, 1, 'Stufe 1 bleibt Stufe 1');
}

// --- DU STOLPERST ÜBER DEINE EIGENE TRUHE ----------------------------------
// "Du verlierst deinen wertvollsten Gegenstand, den du im Spiel ausliegen
// hast" - wertvoll = Goldwert, wie bei PACKRATTE.
{
  const truhe = findCard('DU STOLPERST ÜBER DEINE EIGENE TRUHE');
  assert.ok(DOOR_OTHER_AS_CURSE.has(truhe.name), 'sie gilt als Fluch');

  const nachGold = (k) => ALL_CARDS.filter((c) => c.slotKind === k && c.gold)
    .sort((a, b) => a.gold - b.gold);
  const billig = nachGold('armor')[0];
  const teuer = nachGold('head').slice(-1)[0];
  assert.ok(billig && teuer && teuer.gold > billig.gold, 'Testkarten mit klarem Goldunterschied');

  const p = makePlayer({ equipped: Object.assign(newEquipped(), { armor: billig.id, head: teuer.id }) });
  const room = makeRoom([p]);
  applyPrimitiveAction(room, p, resolveConsequenceSpec(truhe.name, truhe.text, p, room));
  assert.ok(room.doorDiscard.concat(room.treasureDiscard).includes(teuer.id),
    'der teuerste Gegenstand ist weg');
  assert.strictEqual(p.equipped.armor, billig.id, 'der billigere bleibt angelegt');
  assert.strictEqual(p.equipped.head, null, 'und der teure nicht mehr');
}
{
  // Wer nichts traegt, verliert nichts - und die Auflösung bleibt nicht haengen.
  const truhe = findCard('DU STOLPERST ÜBER DEINE EIGENE TRUHE');
  const p = makePlayer({ hand: ['egal'] });
  const room = makeRoom([p]);
  const desc = applyPrimitiveAction(room, p, resolveConsequenceSpec(truhe.name, truhe.text, p, room));
  assert.ok(/keinen Gegenstand/.test(desc), desc);
  assert.deepStrictEqual(p.hand, ['egal'], 'Handkarten bleiben unangetastet');
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-clerical-badstuffs: ok');
