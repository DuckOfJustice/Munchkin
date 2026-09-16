// Unnatural Axe, Monsterkarten (Plan 2026-09-16, Spec gleichen Datums).
//
// Gemessen wird jeweils die DIFFERENZ der Monsterstaerke mit und ohne das
// genannte Merkmal - ein absoluter Wert waere auch dann gruen, wenn das
// Monster aus einem anderen Grund staerker ist.
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, combatTotals, monsterRefusesTarget, fleeModifierParts,
  resolveConsequenceSpec, applyPrimitiveAction, handleResolveCardCardChoice,
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
    itemAttachments: {}, logs: [], combat: null, combatHappenedThisTurn: false,
    pendingConsequence: null, pendingCardAction: null, pendingRoll: null,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  };
  raeume.push(room);
  return room;
}

// Monsterstaerke gegen genau eine Person.
function monsterStaerke(monsterName, player, mitMonstern) {
  const m = findCard(monsterName, 'monster');
  const room = makeRoom([player]);
  room.combat = {
    actorId: player.id, helperId: null,
    monsterIds: [m.id].concat(mitMonstern || []),
    actorModifier: 0, monsterModifier: 0, backstabs: {},
  };
  return combatTotals(room).monsterStrength;
}

const ORK = findCard('ORK', 'door_other');
const ELF = findCard('ELF', 'race');
const ZWERG = findCard('ZWERG', 'race');
const DIEB = findCard('DIEB', 'class');
const ZAUBERER = findCard('ZAUBERER', 'class');
const KRIEGER = findCard('KRIEGER', 'class');
const PRIESTER = findCard('PRIESTER', 'class');

// --- Einfache Monsterboni ---------------------------------------------------
[
  ['KATZENMÄDCHEN', { races: [ORK.id] }, 5],
  ['TEDDYBÄR', { races: [ORK.id] }, 5],
  ['JUDGE FREDD', { classes: [DIEB.id] }, 5],
  ['M.T.-ANZUG', { classes: [ZAUBERER.id] }, 5],
  ['M.T.-ANZUG', { classes: [DIEB.id] }, 5],
  ['DING MIT EINEM ÜBERLANGEN NAMEN, DESSEN BILD NICHT AUF DIE KARTE PASST', { classes: [KRIEGER.id] }, 5],
  ['TENTAKELDÄMON', { classes: [PRIESTER.id] }, 5],
  ['ROTZ-ELEMENTAR', { races: [ELF.id] }, 4],
  ['JABBERWOCK', { races: [ZWERG.id] }, 3],
  ['JABBERWOCK', { classes: [ZAUBERER.id] }, 3],
  ['WEIHNACHTSMANN', { races: [ELF.id] }, -5],
].forEach(([monster, merkmal, erwartet]) => {
  const ohne = monsterStaerke(monster, makePlayer({}));
  const mit = monsterStaerke(monster, makePlayer(merkmal));
  assert.strictEqual(mit - ohne, erwartet,
    `${monster}: erwartet ${erwartet}, gemessen ${mit - ohne}`);
});

// "+3 gegen Zwerge oder Zauberer. Ja, das macht +6 gegen Zwergenzauberer."
{
  const ohne = monsterStaerke('JABBERWOCK', makePlayer({}));
  const beides = monsterStaerke('JABBERWOCK', makePlayer({ races: [ZWERG.id], classes: [ZAUBERER.id] }));
  assert.strictEqual(beides - ohne, 6, 'Zwergenzauberer bekommen beide Boni');
}

// "+5 gegen Zauberer oder Diebe" nennt KEINE Addition - ein Zauberer-Dieb
// bekommt den Bonus genau einmal.
{
  const ohne = monsterStaerke('M.T.-ANZUG', makePlayer({}));
  const beides = monsterStaerke('M.T.-ANZUG', makePlayer({ classes: [ZAUBERER.id, DIEB.id] }));
  assert.strictEqual(beides - ohne, 5, 'der Anzug addiert nicht');
}

// --- "Mensch" = keine Rassenkarte -------------------------------------------
[
  ['RIESENKAKERLAKE', 5],  // "+5 gegen Elfen oder Menschen."
  ['GRASGNOLL', 5],        // "+5 gegen Menschen."
].forEach(([monster, erwartet]) => {
  const mitRasse = monsterStaerke(monster, makePlayer({ races: [ZWERG.id] }));
  const ohneRasse = monsterStaerke(monster, makePlayer({}));
  assert.strictEqual(ohneRasse - mitRasse, erwartet,
    `${monster}: Menschen bekommen ${erwartet}`);
});

// Die Kakerlake trifft Elfen ebenso - aber nur einmal, nicht zusaetzlich.
{
  const zwerg = monsterStaerke('RIESENKAKERLAKE', makePlayer({ races: [ZWERG.id] }));
  const elf = monsterStaerke('RIESENKAKERLAKE', makePlayer({ races: [ELF.id] }));
  assert.strictEqual(elf - zwerg, 5, 'Elfen bekommen denselben Bonus');
}

// --- FEUERLÖSCHER: "Erhaelt +5, wenn dir niemand hilft." --------------------
{
  const m = findCard('FEUERLÖSCHER', 'monster');
  const a = makePlayer({ level: 9 });
  const b = makePlayer({ id: 'p2', name: 'B', level: 9 });
  const room = makeRoom([a, b]);
  room.combat = { actorId: a.id, helperId: null, monsterIds: [m.id], actorModifier: 0, monsterModifier: 0, backstabs: {} };
  const allein = combatTotals(room).monsterStrength;
  room.combat.helperId = b.id;
  const mitHilfe = combatTotals(room).monsterStrength;
  assert.strictEqual(allein - mitHilfe, 5, 'ohne Hilfe ist der Loescher 5 staerker');
}

// --- "Greift niemanden mit Stufe N oder niedriger an" -----------------------
[
  ['FEUERLÖSCHER', 2],
  ['TENTAKELDÄMON', 2],
  ['JABBERWOCK', 4],
].forEach(([monster, grenze]) => {
  const m = findCard(monster, 'monster');
  assert.ok(monsterRefusesTarget(m.id, makePlayer({ level: grenze })),
    `${monster} darf Stufe ${grenze} nicht angreifen`);
  assert.ok(!monsterRefusesTarget(m.id, makePlayer({ level: grenze + 1 })),
    `${monster} greift Stufe ${grenze + 1} an`);
});

// --- Weglauf-Modifikatoren --------------------------------------------------
[
  ['WERSCHILDKRÖTE', 2],   // "Greift seeehr langsam an. +2 fuer Weglaufen."
  ['PESTRATTEN', -1],      // "Alle anderen muessen kaempfen und erhalten -1 fuer Weglaufen."
].forEach(([monster, erwartet]) => {
  const m = findCard(monster, 'monster');
  const p = makePlayer({});
  const room = makeRoom([p]);
  room.combat = { actorId: p.id, helperId: null, monsterIds: [m.id], actorModifier: 0, monsterModifier: 0 };
  const summe = fleeModifierParts(room, p).reduce((s, t) => s + t.amount, 0);
  assert.strictEqual(summe, erwartet, `${monster}: Weglauf-Modifikator ${erwartet}`);
});

// --- MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT -------------------------
// "+4 gegen Zwerge, +2 gegen Frauen, -3 gegen Zauberer, -2 am Samstag."
{
  const NAME = 'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT';
  const basis = monsterStaerke(NAME, makePlayer({}));
  assert.strictEqual(monsterStaerke(NAME, makePlayer({ races: [ZWERG.id] })) - basis, 4, 'Zwerge +4');
  assert.strictEqual(monsterStaerke(NAME, makePlayer({ gender: 'w' })) - basis, 2, 'Frauen +2');
  assert.strictEqual(monsterStaerke(NAME, makePlayer({ classes: [ZAUBERER.id] })) - basis, -3, 'Zauberer -3');
  // Alle vier Klauseln greifen unabhaengig voneinander.
  assert.strictEqual(
    monsterStaerke(NAME, makePlayer({ races: [ZWERG.id], gender: 'w', classes: [ZAUBERER.id] })) - basis,
    3, 'Zwergin mit Zaubererklasse: +4 +2 -3');
}
{
  // Der Samstags-Malus haengt am echten Wochentag - geprueft mit gestelltem
  // Date, damit der Test nicht vom Kalender abhaengt.
  const NAME = 'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT';
  const echtesDate = global.Date;
  const stelle = (wochentag) => {
    class FakeDate extends echtesDate {
      constructor(...args) { super(...(args.length ? args : [2026, 8, 12 + wochentag])); }
      getDay() { return wochentag; }
    }
    global.Date = FakeDate;
  };
  try {
    stelle(3); // Mittwoch
    const mittwoch = monsterStaerke(NAME, makePlayer({}));
    stelle(6); // Samstag
    const samstag = monsterStaerke(NAME, makePlayer({}));
    assert.strictEqual(samstag - mittwoch, -2, 'am Samstag ist es 2 schwaecher');
  } finally {
    global.Date = echtesDate;
  }
}

// --- Schlimme Dinge: GEWALTIGER BAZILLUS ------------------------------------
// "Du niest unaufhoerlich ... Lege zwei Karten (deiner Wahl) aus deiner Hand ab."
{
  const bazillus = findCard('GEWALTIGER BAZILLUS', 'monster');
  const fueller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 4).map((c) => c.id);
  const p = makePlayer({ hand: fueller.slice() });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  const spec = resolveConsequenceSpec(bazillus.name, bazillus.badstuff, p, room);
  assert.ok(spec, 'der Bazillus braucht eine Automatik');
  applyPrimitiveAction(room, p, spec);
  for (let i = 0; i < 2; i++) {
    assert.ok(room.pendingCardAction, `Wahl ${i + 1} von 2 muss offen sein`);
    handleResolveCardCardChoice(room, p.id, room.pendingCardAction.candidateIds[0]);
  }
  assert.strictEqual(p.hand.length, 2, 'genau zwei Karten abgelegt');
  assert.strictEqual(room.pendingCardAction, null, 'danach haengt nichts');
}

// --- Schlimme Dinge: MONDJUNGFERN -------------------------------------------
// "Decke deine Hand auf und jeder andere Spieler darf eine Karte waehlen."
{
  const jungfern = findCard('MONDJUNGFERN', 'monster');
  const fueller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 3).map((c) => c.id);
  const opfer = makePlayer({ hand: fueller.slice() });
  const b = makePlayer({ id: 'p2', name: 'B' });
  const c2 = makePlayer({ id: 'p3', name: 'C' });
  const room = makeRoom([opfer, b, c2]);
  applyPrimitiveAction(room, opfer, resolveConsequenceSpec(jungfern.name, jungfern.badstuff, opfer, room));
  const nehmer = [];
  while (room.pendingCardAction) {
    nehmer.push(room.pendingCardAction.playerId);
    handleResolveCardCardChoice(room, room.pendingCardAction.playerId, room.pendingCardAction.candidateIds[0]);
  }
  assert.deepStrictEqual(nehmer.sort(), ['p2', 'p3'], 'beide anderen duerfen je eine Karte nehmen');
  assert.strictEqual(opfer.hand.length, 1, 'zwei Karten sind weg');
  assert.strictEqual(b.hand.length + c2.hand.length, 2, 'und liegen bei den anderen');
}

// --- Monster, die bestimmte Leute gar nicht angreifen -----------------------
{
  // "Greift keine Frauen an oder Traeger des Stacheligen Genitalschoners."
  const m = findCard('PSYCHO-EICHHÖRNCHEN', 'monster');
  assert.ok(monsterRefusesTarget(m.id, makePlayer({ gender: 'w' })), 'Frauen werden nicht angegriffen');
  assert.ok(!monsterRefusesTarget(m.id, makePlayer({ gender: 'm' })), 'Maenner schon');
}
{
  // "Fluechtet vor Orks, statt anzugreifen und hinterlaesst den Schatz."
  const m = findCard('PESTRATTEN', 'monster');
  assert.ok(monsterRefusesTarget(m.id, makePlayer({ races: [ORK.id] })), 'vor Orks fluechten sie');
  assert.ok(!monsterRefusesTarget(m.id, makePlayer({})), 'alle anderen muessen kaempfen');
  const { MONSTER_REFUSES_TREASURE } = require('../server.js');
  assert.strictEqual(MONSTER_REFUSES_TREASURE['PESTRATTEN'], m.treasureCount,
    'der hinterlassene Schatz entspricht dem Schatzwert der Karte');
}

// --- PTERODAKTYL: "Lege deine ganze Hand ODER alle kleinen Gegenstaende ab" -
{
  const ptero = findCard('PTERODAKTYL', 'monster');
  const p = makePlayer({});
  const room = makeRoom([p]);
  const spec = resolveConsequenceSpec(ptero.name, ptero.badstuff, p, room);
  assert.ok(spec, 'der PTERODAKTYL braucht eine Automatik');
  assert.strictEqual(spec.type, 'choice', 'die Karte laesst waehlen');
  assert.strictEqual(spec.options.length, 2, 'genau zwei Moeglichkeiten');
  const ids = spec.options.map((o) => o.action.type).sort();
  assert.deepStrictEqual(ids, ['discardWholeHand', 'queuedDiscardOwn'].sort(),
    'ganze Hand oder alle kleinen Gegenstaende');
}
{
  // Die Hand-Variante wirkt auch wirklich.
  const ptero = findCard('PTERODAKTYL', 'monster');
  const fueller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 3).map((c) => c.id);
  const p = makePlayer({ hand: fueller.slice() });
  const room = makeRoom([p]);
  const spec = resolveConsequenceSpec(ptero.name, ptero.badstuff, p, room);
  assert.ok(spec, 'der PTERODAKTYL braucht eine Automatik');
  const handOption = spec.options.find((o) => o.action.type === 'discardWholeHand');
  applyPrimitiveAction(room, p, handOption.action);
  assert.strictEqual(p.hand.length, 0, 'die Hand ist weg');
}
{
  // Der kleine Gegenstände-Zweig wird geprüft - ein großer und zwei kleine
  // Gegenstände. Der count muss exakt 2 sein (nur die kleinen zählen).
  // Mit vertauschtem Filter-Vorzeichen würde count = 1 sein (nur der große).
  // Damit wird sichergestellt dass istGrosserGegenstand korrekt filtert.
  const ptero = findCard('PTERODAKTYL', 'monster');
  const bigCard = findCard('STANGE, 11-FUSS');  // bekanntermaßen groß
  const smallCards = ALL_CARDS.filter((c) => c.type === 'treasure' && c.name !== 'STANGE, 11-FUSS').slice(0, 2);
  assert.ok(bigCard, 'STANGE, 11-FUSS existiert');
  assert.strictEqual(smallCards.length, 2, 'es gibt zwei kleine Gegenstände zum Testen');
  const e = newEquipped();
  e.head = bigCard.id;        // großer Gegenstand
  e.armor = smallCards[0].id; // erster kleiner Gegenstand
  e.feet = smallCards[1].id;  // zweiter kleiner Gegenstand
  const p = makePlayer({ equipped: e });
  const room = makeRoom([p]);
  const spec = resolveConsequenceSpec(ptero.name, ptero.badstuff, p, room);
  assert.ok(spec, 'der PTERODAKTYL braucht eine Automatik');
  const kleinOption = spec.options.find((o) => o.action.type === 'queuedDiscardOwn');
  assert.ok(kleinOption, 'kleine Gegenstände-Option existiert');
  assert.strictEqual(kleinOption.action.count, 2,
    'count ist 2: nur die zwei kleinen zählen, der große nicht');
}

// --- SL-Monster, Schlimme Dinge ---------------------------------------------
// "Halblinge verlieren eine Stufe. Elfen verlieren zwei Stufen. Maenner
// verlieren eine zusaetzliche Stufe und muessen eine Karte ablegen.
// Diejenigen, die nicht unter die Kriterien oben fallen, muessen zwei Karten
// ablegen."
{
  const NAME = 'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT';
  const sl = findCard(NAME, 'monster');
  const HALBLING = findCard('HALBLING', 'race');
  const stufenVerlust = (spieler) => {
    const p = makePlayer(spieler);
    const room = makeRoom([p]);
    const vorher = p.level;
    const spec = resolveConsequenceSpec(NAME, sl.badstuff, p, room);
    assert.ok(spec, 'das SL-Monster braucht eine Automatik');
    applyPrimitiveAction(room, p, spec);
    return vorher - p.level;
  };
  assert.strictEqual(stufenVerlust({ races: [HALBLING.id], gender: 'w' }), 1, 'Halbling-Frau: 1 Stufe');
  assert.strictEqual(stufenVerlust({ races: [ELF.id], gender: 'w' }), 2, 'Elfen-Frau: 2 Stufen');
  assert.strictEqual(stufenVerlust({ races: [ELF.id], gender: 'm' }), 3, 'Elfen-Mann: 2 + 1 zusaetzlich');
  assert.strictEqual(stufenVerlust({ gender: 'w' }), 0, 'Frau ohne Rasse: keine Stufe, dafuer Karten');
}

// --- KATZENMÄDCHEN: "Wirf den Wuerfel und lege so viele Karten ab." ---------
{
  const katze = findCard('KATZENMÄDCHEN', 'monster');
  const fueller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 6).map((c) => c.id);
  const p = makePlayer({ hand: fueller.slice() });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  const echtesRandom = Math.random;
  Math.random = () => 0.5; // 6 * 0.5 = 3 -> Wurf 4
  try {
    const spec = resolveConsequenceSpec(katze.name, katze.badstuff, p, room);
    assert.ok(spec, 'das KATZENMÄDCHEN braucht eine Automatik');
    applyPrimitiveAction(room, p, spec);
  } finally {
    Math.random = echtesRandom;
  }
  let gewaehlt = 0;
  while (room.pendingCardAction && gewaehlt < 10) {
    handleResolveCardCardChoice(room, p.id, room.pendingCardAction.candidateIds[0]);
    gewaehlt++;
  }
  assert.strictEqual(gewaehlt, 4, 'bei einer 4 werden vier Karten abgelegt');
  assert.strictEqual(p.hand.length, 2, 'von sechs bleiben zwei');
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-unnatural-monsters: ok');
