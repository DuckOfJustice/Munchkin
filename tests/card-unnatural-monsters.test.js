// Unnatural Axe, Monsterkarten (Plan 2026-09-16, Spec gleichen Datums).
//
// Gemessen wird jeweils die DIFFERENZ der Monsterstaerke mit und ohne das
// genannte Merkmal - ein absoluter Wert waere auch dann gruen, wenn das
// Monster aus einem anderen Grund staerker ist.
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, combatTotals, monsterRefusesTarget, fleeModifierParts,
  resolveConsequenceSpec, applyPrimitiveAction, handleResolveCardCardChoice, isBigItem,
  handlePlayCombatCard,
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
  // Verhaltensprüfung statt Tabellen-Check: MONSTER_REFUSES_TREASURE[...] ===
  // m.treasureCount beweist nicht, dass beim Aufdecken auch wirklich Schaetze
  // uebergeben werden - dafuer muss der echte Aufdeck-Pfad (handleDrawDoor)
  // laufen.
  const { handleDrawDoor } = require('../server.js');
  const schaetze = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 5).map((c) => c.id);
  const ork = makePlayer({ races: [ORK.id] });
  const room = makeRoom([ork]);
  room.turnPhase = 'tuer';
  room.doorDeck = [m.id];
  room.treasureDeck = schaetze.slice();
  handleDrawDoor(room, ork.id);
  assert.strictEqual(ork.hand.length, m.treasureCount,
    'die Pestratten hinterlassen beim Aufdecken tatsaechlich ihren Schatzwert');
  assert.strictEqual(room.turnPhase, 'aerger', 'der Zug laeuft trotzdem normal weiter');
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
  // Der kleine Gegenstände-Zweig wird geprüft - ein großer und mehrere kleine
  // Gegenstände. Der count muss die Anzahl der kleinen sein.
  // Mit vertauschtem Filter-Vorzeichen würde count = 1 sein (nur der große).
  // Damit wird sichergestellt dass isBigItem korrekt filtert.
  const ptero = findCard('PTERODAKTYL', 'monster');
  // Finde einen großen Gegenstand über isBigItem
  const bigCard = ALL_CARDS.find((c) => c.type === 'treasure' && isBigItem(c));
  assert.ok(bigCard, 'es gibt mindestens einen großen Gegenstand');
  // Finde kleine Gegenstände explizit über isBigItem-Filter
  const smallCards = ALL_CARDS.filter((c) => c.type === 'treasure' && !isBigItem(c)).slice(0, 2);
  assert.ok(smallCards.length >= 2, 'es gibt mindestens zwei kleine Gegenstände zum Testen');
  const e = newEquipped();
  e.head = bigCard.id;        // großer Gegenstand
  e.armor = smallCards[0].id; // erster kleiner Gegenstand
  e.feet = smallCards[1].id;  // zweiter kleiner Gegenstand
  const p = makePlayer({ equipped: e });
  const testRoom = makeRoom([p]);
  const expectedSmallCount = 2; // wir wählen genau 2 kleine
  const spec = resolveConsequenceSpec(ptero.name, ptero.badstuff, p, testRoom);
  assert.ok(spec, 'der PTERODAKTYL braucht eine Automatik');
  const kleinOption = spec.options.find((o) => o.action.type === 'queuedDiscardOwn');
  assert.ok(kleinOption, 'kleine Gegenstände-Option existiert');
  assert.strictEqual(kleinOption.action.count, expectedSmallCount,
    `count ist ${expectedSmallCount}: nur die kleinen zählen, der große nicht`);
}

// --- MONDJUNGFERN: "In diesem Kampf erhaeltst du keine Vorteile durch Waffen" ---
// Bug (Review I1): der alte Code zog nur den GEDRUCKTEN Bonus der Hand-
// gegenstaende ab. Kartenanhaenge, konditionale Item-Boni und rassen-
// abhaengige Item-Boni an derselben Waffe ueberlebten den Abzug, weil sie aus
// eigenen Summen kamen, die nie gefiltert wurden. Jeder Fall unten misst die
// Differenz "ohne Mondjungfern" minus "mit Mondjungfern" und verlangt, dass
// sie dem VOLLEN Waffenwert entspricht - nicht nur dem gedruckten Bonus.
{
  const waffe = ALL_CARDS.find((c) => c.category === 'item' && c.slotKind === 'hand' && c.bonus > 0);
  const ruestung = ALL_CARDS.find((c) => c.category === 'item' && c.slotKind === 'armor' && c.bonus > 0);
  assert.ok(waffe && ruestung, 'Testgegenstaende gefunden');

  const staerkeMit = (monsterNamen, equipped, attachments) => {
    const p = makePlayer({ equipped });
    const room = makeRoom([p]);
    if (attachments) room.itemAttachments = attachments;
    room.combat = {
      actorId: p.id, helperId: null,
      monsterIds: monsterNamen.map((n) => findCard(n, 'monster').id),
      actorModifier: 0, monsterModifier: 0, backstabs: {},
    };
    return combatTotals(room).playerStrength;
  };

  // Grundfall: gedruckter Waffenbonus faellt weg.
  {
    const eq = Object.assign(newEquipped(), { hands: [waffe.id, null], armor: ruestung.id });
    assert.strictEqual(staerkeMit(['PESTRATTEN'], eq) - staerkeMit(['MONDJUNGFERN'], eq), waffe.bonus,
      'gegen die Mondjungfern faellt genau der Waffenbonus weg');
  }

  // Ruestung und Stufe zaehlen weiter - echte Differenzmessung statt "> 0"
  // (die Testfigur liegt schon durch ihre Stufe ueber null).
  {
    const mitRuestung = staerkeMit(['MONDJUNGFERN'], Object.assign(newEquipped(), { armor: ruestung.id }));
    const ohneRuestung = staerkeMit(['MONDJUNGFERN'], newEquipped());
    assert.strictEqual(mitRuestung - ohneRuestung, ruestung.bonus,
      'Ruestungsbonus zaehlt trotz Mondjungfern unveraendert weiter');
  }

  // Leck 1: Feuer-Verdopplung (EISRIESE) an einer Waffe - die Verdopplung
  // wurde addiert, aber beim Mondjungfern-Abzug nicht mit abgezogen.
  {
    const napalm = findCard('NAPALMSTAB');
    const eq = Object.assign(newEquipped(), { hands: [napalm.id, null] });
    const diff = staerkeMit(['EISRIESE'], eq) - staerkeMit(['MONDJUNGFERN', 'EISRIESE'], eq);
    assert.strictEqual(diff, napalm.bonus * 2,
      'die Eisriesen-Verdopplung des Napalmstabs faellt mit der Waffe komplett weg');
  }

  // Leck 2: Kartenanhang (VERGIFTET) an einer Waffe.
  {
    const keule = findCard('GENTLEMAN-KEULE');
    const vergiftet = findCard('VERGIFTET');
    const eq = Object.assign(newEquipped(), { hands: [keule.id, null] });
    const attachments = { [keule.id]: [vergiftet.id] };
    const diff = staerkeMit(['PESTRATTEN'], eq, attachments) - staerkeMit(['MONDJUNGFERN'], eq, attachments);
    assert.strictEqual(diff, keule.bonus + vergiftet.bonus,
      'die Vergiftet-Karte an der Waffe faellt mit der Waffe komplett weg');
  }

  // Leck 3: konditionaler Item-Bonus (VORPALE KLINGE gegen Monster mit J).
  {
    const klinge = findCard('VORPALE KLINGE');
    const eq = Object.assign(newEquipped(), { hands: [klinge.id, null] });
    const diff = staerkeMit(['JABBERWOCK'], eq) - staerkeMit(['MONDJUNGFERN', 'JABBERWOCK'], eq);
    assert.strictEqual(diff, klinge.bonus + 10,
      'der Vorpale-Klinge-Zusatzbonus gegen J-Monster faellt mit der Waffe komplett weg');
  }

  // Leck 4: rassenabhaengiger Item-Bonus (GNOM zaehlt G/N-Gegenstaende).
  {
    const gnom = findCard('GNOM', 'door_other');
    const grillgabel = findCard('GRILLGABEL');
    const eq = Object.assign(newEquipped(), { hands: [grillgabel.id, null] });
    const staerkeAlsGnom = (monsterName) => {
      const p = makePlayer({ races: [gnom.id], equipped: eq });
      const room = makeRoom([p]);
      room.combat = { actorId: p.id, helperId: null, monsterIds: [findCard(monsterName, 'monster').id],
        actorModifier: 0, monsterModifier: 0, backstabs: {} };
      return combatTotals(room).playerStrength;
    };
    assert.strictEqual(staerkeAlsGnom('PESTRATTEN') - staerkeAlsGnom('MONDJUNGFERN'), grillgabel.bonus + 1,
      'der Gnom-Bonus fuer die Grillgabel faellt mit der Waffe komplett weg');
  }
}

// --- EISRIESE: "Jeder Feuer- oder Flammengegenstand verursacht doppelten
// Schaden." ------------------------------------------------------------------
{
  const feuer = findCard('FLAMMENDE RÜSTUNG');
  const staerke = (monsterName) => {
    const m = findCard(monsterName, 'monster');
    const p = makePlayer({ equipped: Object.assign(newEquipped(), { armor: feuer.id }) });
    const room = makeRoom([p]);
    room.combat = { actorId: p.id, helperId: null, monsterIds: [m.id], actorModifier: 0, monsterModifier: 0, backstabs: {} };
    return combatTotals(room).playerStrength;
  };
  assert.strictEqual(staerke('EISRIESE') - staerke('PESTRATTEN'), feuer.bonus,
    'gegen den Eisriesen zaehlt die Flammende Ruestung doppelt');
}

// --- FUNGUS: "Wenn der Fungus Gigantisch wird, erhaelt er +25 statt +10!" ---
{
  const fungus = findCard('FUNGUS', 'monster');
  const gigantisch = findCard('GIGANTISCH');
  const anderes = findCard('PESTRATTEN', 'monster');
  const zuschlag = (monsterKarte) => {
    const p = makePlayer({ hand: [gigantisch.id] });
    const room = makeRoom([p]);
    room.combat = { actorId: p.id, helperId: null, monsterIds: [monsterKarte.id],
      actorModifier: 0, monsterModifier: 0, enhancerIds: [], enhancerBonus: 0,
      treasureDelta: 0, enhancerTreasure: 0, mustFlee: false, backstabs: {} };
    const vorher = combatTotals(room).monsterStrength;
    handlePlayCombatCard(room, p.id, gigantisch.id);
    return combatTotals(room).monsterStrength - vorher;
  };
  assert.strictEqual(zuschlag(anderes), gigantisch.bonus, 'normal gibt GIGANTISCH seinen gedruckten Bonus');
  assert.strictEqual(zuschlag(fungus), 25, 'auf dem Fungus sind es 25');
}

// --- FUNGUS + RAPIER-TROTTEL: die Logzeile darf nur den Zusatz nennen, der
// tatsaechlich gegriffen hat (Review M3) --------------------------------------
// Der Fungus hat Vorrang (fester Ersatzwert 25 statt einer Verdopplung) -
// beide Zusaetze gleichzeitig zu nennen waere widerspruechlich, weil der
// Trottel dann gar nichts mehr beitraegt.
{
  const fungus = findCard('FUNGUS', 'monster');
  const trottel = findCard('RAPIER-TROTTEL', 'monster');
  const gigantisch = findCard('GIGANTISCH');
  const letzteLogzeile = (monsterIds) => {
    const p = makePlayer({ hand: [gigantisch.id] });
    const room = makeRoom([p]);
    room.combat = { actorId: p.id, helperId: null, monsterIds,
      actorModifier: 0, monsterModifier: 0, enhancerIds: [], enhancerBonus: 0,
      treasureDelta: 0, enhancerTreasure: 0, mustFlee: false, backstabs: {} };
    handlePlayCombatCard(room, p.id, gigantisch.id);
    return room.logs[room.logs.length - 1].text;
  };

  // Nur der Trottel: Verdopplung des gedruckten Bonus.
  const nurTrottel = letzteLogzeile([trottel.id]);
  assert.ok(nurTrottel.includes(`+${gigantisch.bonus * 2} für das Monster`), 'der Trottel verdoppelt den gedruckten Bonus');
  assert.ok(nurTrottel.includes('Rapier-Trottel verdoppelt'), 'nennt den Trottel-Zusatz');
  assert.ok(!nurTrottel.includes('Fungus'), 'nennt keinen Fungus-Zusatz');

  // Nur der Fungus: fester Ersatzwert +25.
  const nurFungus = letzteLogzeile([fungus.id]);
  assert.ok(nurFungus.includes('+25 für das Monster'), 'der Fungus ersetzt durch +25');
  assert.ok(nurFungus.includes('Fungus erhält 25 statt 10'), 'nennt den Fungus-Zusatz');
  assert.ok(!nurFungus.includes('Trottel'), 'nennt keinen Trottel-Zusatz');

  // Beide zusammen: Fungus gewinnt, +25 - die Zeile nennt nur diesen Zusatz.
  const beide = letzteLogzeile([fungus.id, trottel.id]);
  assert.ok(beide.includes('+25 für das Monster'), 'bei beiden Monstern gilt weiterhin +25');
  assert.ok(beide.includes('Fungus erhält 25 statt 10'), 'nennt den Fungus-Zusatz');
  assert.ok(!beide.includes('Trottel'), 'nennt NICHT zusaetzlich den Trottel-Zusatz - das waere widerspruechlich');
}

// --- Verlauf und Einblendung muessen denselben Bonus nennen -----------------
// Regressionstest: die Einblendung (room.cardPlay.hinweis) benutzte bisher
// c.bonus statt des tatsaechlich angewandten zuschlag - beim GIGANTISCHEN
// FUNGUS stand im Verlauf "+25", in der Einblendung "+10".
{
  const fungus = findCard('FUNGUS', 'monster');
  const gigantisch = findCard('GIGANTISCH');
  const p = makePlayer({ hand: [gigantisch.id] });
  const room = makeRoom([p]);
  room.combat = { actorId: p.id, helperId: null, monsterIds: [fungus.id],
    actorModifier: 0, monsterModifier: 0, enhancerIds: [], enhancerBonus: 0,
    treasureDelta: 0, enhancerTreasure: 0, mustFlee: false, backstabs: {} };
  handlePlayCombatCard(room, p.id, gigantisch.id);
  const letzterLogEintrag = room.logs[room.logs.length - 1].text;
  const zahlImLog = letzterLogEintrag.match(/([+-]\d+) für das Monster/)[1];
  const zahlInEinblendung = room.cardPlay.hinweis.match(/([+-]\d+) für das Monster/)[1];
  assert.strictEqual(zahlInEinblendung, zahlImLog,
    `Einblendung (${room.cardPlay.hinweis}) muss denselben Bonus nennen wie der Verlauf (${letzterLogEintrag})`);
  assert.strictEqual(zahlInEinblendung, '+25', 'auf dem Fungus muss auch die Einblendung +25 zeigen');
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

// --- KATZENMÄDCHEN Randfall: Wurf groesser als Handkartenzahl -----------
{
  const katze = findCard('KATZENMÄDCHEN', 'monster');
  const fueller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 2).map((c) => c.id);
  const p = makePlayer({ hand: fueller.slice() });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  const echtesRandom = Math.random;
  Math.random = () => 0.99; // 6 * 0.99 = 5.94 -> Wurf 6
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
  assert.strictEqual(gewaehlt, 2, 'bei Wurf 6 aber nur 2 Karten in Hand werden 2 abgelegt');
  assert.strictEqual(p.hand.length, 0, 'Hand ist leer');
  assert.strictEqual(room.pendingCardAction, null, 'danach haengt nichts offen');
}

// --- KATZENMÄDCHEN Randfall: leere Hand ---------------------------------
{
  const katze = findCard('KATZENMÄDCHEN', 'monster');
  const p = makePlayer({ hand: [] });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  const echtesRandom = Math.random;
  Math.random = () => 0.5; // beliebiger Wurf, Hand ist leer
  try {
    const spec = resolveConsequenceSpec(katze.name, katze.badstuff, p, room);
    assert.ok(spec, 'das KATZENMÄDCHEN braucht eine Automatik');
    applyPrimitiveAction(room, p, spec);
  } finally {
    Math.random = echtesRandom;
  }
  assert.strictEqual(room.pendingCardAction, null, 'bei leerer Hand oeffnet sich kein Dialog');
}

// --- ROTZ-ELEMENTAR mit Laufender Nase / Schattennase -----------------------
// "In Kombination mit der Laufenden Nase (oder dem Schatten), erhaelt JEDER
// einen Bonus von +10." Regelentscheidung (Review I2): "jeder" heisst jedes
// beteiligte Monster - mit einer Nase-Karte macht das +20 (Rotz und die Nase
// bekommen je +10), mit beiden Nase-Karten +30.
{
  const nase = findCard('LAUFENDE NASE', 'monster');
  const schatten = findCard('DIE SCHATTENNASE', 'monster');
  const allein = monsterStaerke('ROTZ-ELEMENTAR', makePlayer({}));
  const mitNase = monsterStaerke('ROTZ-ELEMENTAR', makePlayer({}), [nase.id]);
  const mitBeiden = monsterStaerke('ROTZ-ELEMENTAR', makePlayer({}), [nase.id, schatten.id]);
  assert.strictEqual(mitNase - allein - nase.level, 20,
    'mit einer Nase-Karte bekommen Rotz UND die Nase je +10, macht +20');
  assert.strictEqual(mitBeiden - allein - nase.level - schatten.level, 30,
    'mit beiden Nase-Karten bekommt jede beteiligte Karte ihre +10, macht +30');
}

// --- DIE SCHATTENNASE: "Du kannst nicht fluechten" --------------------------
// Verhaltensprüfung statt Tabellen-Check: FLEE_IMPOSSIBLE.has(...) allein
// beweist nicht, dass eine Flucht tatsaechlich verweigert wird - dafuer muss
// der echte Fluchtpfad (handleAttemptFlee) laufen. +9 macht den Wurf ohne die
// Sperre garantiert erfolgreich (siehe FILZLAUSE-Test in card-passives.test.js).
{
  const { handleAttemptFlee } = require('../server.js');
  const schatten = findCard('DIE SCHATTENNASE', 'monster');
  const p = makePlayer({});
  const room = makeRoom([p]);
  room.combat = { actorId: p.id, helperId: null, monsterIds: [schatten.id],
    actorModifier: 0, monsterModifier: 0, backstabs: {}, mustFlee: true };
  handleAttemptFlee(room, p.id, 9);
  assert.strictEqual(room.dieRoll.success, false,
    'vor dem Schatten gibt es kein Entkommen - auch mit +9 nicht');
}

// --- PIÑATA, Niederlage -----------------------------------------------------
// "Der Spieler, der nach dem Opfer an der Reihe ist, waehlt einen der
// Gegenstaende des Opfers, die im Spiel sind. Leg es ab."
{
  const pinata = findCard('PIÑATA', 'monster');
  const ruestung = ALL_CARDS.find((c) => c.category === 'item' && c.slotKind === 'armor' && c.bonus > 0);
  const opfer = makePlayer({ equipped: Object.assign(newEquipped(), { armor: ruestung.id }) });
  const b = makePlayer({ id: 'p2', name: 'B' });
  const c3 = makePlayer({ id: 'p3', name: 'C' });
  const room = makeRoom([opfer, b, c3]);
  const spec = resolveConsequenceSpec(pinata.name, pinata.badstuff, opfer, room);
  assert.ok(spec, 'die PIÑATA braucht eine Automatik');
  applyPrimitiveAction(room, opfer, spec);
  assert.ok(room.pendingCardAction, 'jemand muss waehlen');
  assert.strictEqual(room.pendingCardAction.playerId, 'p2', 'und zwar die naechste Person');
  handleResolveCardCardChoice(room, 'p2', room.pendingCardAction.candidateIds[0]);
  assert.strictEqual(opfer.equipped.armor, null, 'der Gegenstand ist weg');
  assert.ok(room.treasureDiscard.includes(ruestung.id), 'und liegt im Ablagestapel, nicht bei p2');
  assert.strictEqual(b.hand.length, 0, 'p2 bekommt ihn nicht');
}

// --- PIÑATA, Sieg -----------------------------------------------------------
// "Wenn Pinata besiegt wird, zieht jedes Gruppenmitglied einen Schatz
// aufgedeckt. Es spielt keine Rolle, wer am Kampf teilgenommen hat."
// Review I3: die kaempfende Person zog die Karte tatsaechlich (Handkarten
// stimmten), aber lastReward.cardIds war leer und der Verlauf meldete
// "0 Schatzkarte(n) gezogen" - die spaetere Zuweisung ueberschrieb die
// Piñata-Belohnung kommentarlos.
{
  const { resolveCombatWin } = require('../server.js');
  const pinata = findCard('PIÑATA', 'monster');
  const schaetze = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 10).map((c) => c.id);
  const a = makePlayer({});
  const b = makePlayer({ id: 'p2', name: 'B' });
  const c4 = makePlayer({ id: 'p3', name: 'C' });
  const room = makeRoom([a, b, c4]);
  room.treasureDeck = schaetze.slice();
  room.combat = { actorId: a.id, helperId: null, monsterIds: [pinata.id], actorModifier: 0,
    monsterModifier: 0, treasureDelta: 0, helperReward: 0, backstabs: {} };
  resolveCombatWin(room);
  assert.strictEqual(b.hand.length, 1, 'auch wer nicht mitgekaempft hat, bekommt einen Schatz');
  assert.strictEqual(c4.hand.length, 1, 'und zwar alle');
  assert.strictEqual(a.hand.length, 1, 'die kaempfende Person ebenfalls genau einen');
  assert.strictEqual(a.lastReward.cardIds.length, 1, 'lastReward der kaempfenden Person nennt die gezogene Karte');
  assert.strictEqual(a.lastReward.cardIds[0], a.hand[0], 'und zwar genau die, die in der Hand liegt');
  const siegZeile = room.logs.find((l) => l.text.includes('besiegt PIÑATA'));
  assert.ok(siegZeile, 'Siegzeile vorhanden');
  assert.ok(!siegZeile.text.includes('0 Schatzkarte'), 'die Siegzeile darf nicht 0 Schatzkarten behaupten');
  assert.ok(siegZeile.text.includes('1 Schatzkarte'), 'die Siegzeile nennt die tatsaechlich gezogene Piñata-Karte');
}

// --- PIÑATA, Sieg mit Helfer:in ----------------------------------------------
// Dieselbe Ueberschreib-Gefahr bestand fuer eine Helfer:in mit Zusage - auch
// ihre Piñata-Karte muss in lastReward auftauchen.
{
  const { resolveCombatWin } = require('../server.js');
  const pinata = findCard('PIÑATA', 'monster');
  const schaetze = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 10).map((c) => c.id);
  const a = makePlayer({});
  const b = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([a, b]);
  room.treasureDeck = schaetze.slice();
  room.combat = { actorId: a.id, helperId: b.id, monsterIds: [pinata.id], actorModifier: 0,
    monsterModifier: 0, treasureDelta: 0, helperReward: 1, backstabs: {} };
  resolveCombatWin(room);
  assert.strictEqual(b.hand.length, 1, 'die Helfer:in bekommt ihre Piñata-Karte');
  assert.strictEqual(b.lastReward.cardIds.length, 1, 'und lastReward nennt sie auch');
  assert.strictEqual(b.lastReward.cardIds[0], b.hand[0]);
}

// --- PIÑATA, Schatzstapel reicht nicht fuer alle -----------------------------
// Die Log-Zeile behauptete bisher immer "jede:r am Tisch zieht 1
// Schatzkarte", auch wenn der Stapel (und der leere Ablagestapel) das gar
// nicht hergaben.
{
  const { resolveCombatWin } = require('../server.js');
  const pinata = findCard('PIÑATA', 'monster');
  const zweiSchaetze = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 2).map((c) => c.id);
  const a = makePlayer({});
  const b = makePlayer({ id: 'p2', name: 'B' });
  const c5 = makePlayer({ id: 'p3', name: 'C' });
  const room = makeRoom([a, b, c5]);
  room.treasureDeck = zweiSchaetze.slice();
  room.treasureDiscard = [];
  room.combat = { actorId: a.id, helperId: null, monsterIds: [pinata.id], actorModifier: 0,
    monsterModifier: 0, treasureDelta: 0, helperReward: 0, backstabs: {} };
  resolveCombatWin(room);
  const pinataZeile = room.logs.find((l) => l.text.includes('Piñata platzt'));
  assert.ok(pinataZeile, 'Piñata-Zeile vorhanden');
  assert.ok(!pinataZeile.text.includes('jede:r am Tisch zieht 1 Schatzkarte.'),
    'die Zeile darf nicht mehr Karten behaupten als tatsaechlich gezogen wurden');
  assert.ok(pinataZeile.text.includes('2 von 3'), 'die Zeile nennt die tatsaechliche Zahl');
}

// --- Primitiv lingeringCurse: Monster-Schlimme-Dinge im Fluch-Tracker -------
// Der Tracker activeCurses hing bisher nur am Fluch-Ziehpfad (handleDrawDoor
// -> addActiveCurse -> LINGERING_CURSES). Das Primitiv oeffnet ihn fuer
// Konsequenzen, ohne eine zweite Tabelle danebenzustellen.
{
  const { applyPrimitiveAction, clearActiveCurseByKind } = require('../server.js');
  const p = makePlayer({});
  const room = makeRoom([p]);
  applyPrimitiveAction(room, p, {
    type: 'lingeringCurse', name: 'TESTMONSTER', kind: 'noHandItemBonus',
    dauer: 'naechsterKampf', hinweis: 'Testwirkung.',
  });
  assert.strictEqual(p.activeCurses.length, 1, 'das Primitiv traegt genau einen Eintrag ein');
  assert.strictEqual(p.activeCurses[0].kind, 'noHandItemBonus');
  assert.strictEqual(p.activeCurses[0].dauer, 'naechsterKampf');
  assert.strictEqual(p.activeCurses[0].name, 'TESTMONSTER', 'der Name steht fuer die Anzeige mit drin');
  assert.strictEqual(p.activeCurses[0].hinweis, 'Testwirkung.');
  // Der WUNSCHRING loescht ueber clearActiveCurse nach INDEX - der Eintrag
  // muss also ein ganz normaler Tracker-Eintrag sein, kein Sonderfall.
  assert.strictEqual(clearActiveCurseByKind(p, 'noHandItemBonus'), true, 'gezieltes Loeschen meldet Erfolg');
  assert.strictEqual(p.activeCurses.length, 0, 'und raeumt den Eintrag weg');
  assert.strictEqual(clearActiveCurseByKind(p, 'noHandItemBonus'), false, 'ein zweiter Aufruf findet nichts mehr');
}

// --- RIESENSTINKTIER, Kampftext ---------------------------------------------
// "Sie können dir nicht helfen, dich hintergehen, oder beliebige Karten für
// oder gegen dich verwenden - außer Wandernde Monster und Monsterverstärker."
// Weisse Liste: gesperrt ist alles, erlaubt sind genau die zwei Ausnahmen.
{
  const { handleRequestHelp, handleThiefBackstab, handlePlayCombatCard,
    backstabMalus } = require('../server.js');
  const stinktier = findCard('RIESENSTINKTIER', 'monster');
  const verstaerker = ALL_CARDS.find((c) => c.category === 'door_other'
    && typeof c.bonus === 'number' && c.bonus !== 0 && /für\s+(das\s+)?Monster/i.test(c.text || ''));
  assert.ok(verstaerker, 'Testvoraussetzung: es gibt einen Monsterverstaerker');
  // ponytail: die urspruengliche Suche ueber ein numerisches bonus-Feld
  // findet keinen Trank - echte Kampftraenke (FLAMMENDER GIFTTRANK & Co.)
  // tragen ihren Bonus nur im Fliesstext (parseCombatPotion), bonus bleibt
  // null. Deshalb hier eine konkrete, garantiert vorhandene Karte statt der
  // Regex-Suche.
  const trank = findCard('FLAMMENDER GIFTTRANK', 'treasure_other');

  function stinktierKampf() {
    const kaempfer = makePlayer({ id: 'p1', name: 'A' });
    const dritter = makePlayer({ id: 'p2', name: 'B', classes: [findCard('DIEB', 'class').id] });
    const room = makeRoom([kaempfer, dritter]);
    room.combat = { actorId: 'p1', helperId: null, monsterIds: [stinktier.id],
      actorModifier: 0, monsterModifier: 0, backstabs: {}, mustFlee: false };
    return { room, kaempfer, dritter };
  }

  // 1. Keine Hilfe.
  {
    const { room, dritter } = stinktierKampf();
    handleRequestHelp(room, 'p1', dritter.id, 0);
    assert.ok(!room.combat.helperPending, 'gegen das Stinktier wird niemand um Hilfe gebeten');
  }
  // 2. Kein Hintergehen.
  {
    const { room, dritter } = stinktierKampf();
    const ablage = ALL_CARDS[0].id;
    dritter.hand.push(ablage);
    handleThiefBackstab(room, dritter.id, ablage, 'p1');
    assert.strictEqual(backstabMalus(room), 0, 'der Rueckenfall greift nicht');
    assert.ok(dritter.hand.includes(ablage), 'und kostet auch keine Karte');
  }
  // 3. Eine dritte Person spielt eine beliebige Kampfkarte: gesperrt.
  {
    const { room, dritter } = stinktierKampf();
    dritter.hand.push(trank.id);
    const vorher = room.combat.actorModifier + room.combat.monsterModifier;
    handlePlayCombatCard(room, dritter.id, trank.id);
    assert.strictEqual(room.combat.actorModifier + room.combat.monsterModifier, vorher,
      'eine fremde Kampfkarte bleibt wirkungslos');
    assert.ok(dritter.hand.includes(trank.id), 'und bleibt auf der Hand');
  }
  // 4. Gegenprobe - die weisse Liste ist wirklich weiss: derselbe Weg mit
  //    einem Monsterverstaerker MUSS durchgehen, sonst prueft Fall 3 nur,
  //    dass handlePlayCombatCard ueberhaupt nichts tut.
  {
    const { room, dritter } = stinktierKampf();
    dritter.hand.push(verstaerker.id);
    handlePlayCombatCard(room, dritter.id, verstaerker.id);
    assert.ok(room.combat.monsterModifier !== 0,
      'ein Monsterverstaerker ist ausdruecklich erlaubt und wirkt');
  }
  // 5. Die kaempfende Person selbst ist NICHT gesperrt - der Text richtet
  //    sich an "deine Freunde".
  {
    const { room, kaempfer } = stinktierKampf();
    kaempfer.hand.push(trank.id);
    handlePlayCombatCard(room, kaempfer.id, trank.id);
    assert.ok(!kaempfer.hand.includes(trank.id),
      'wer gegen das Stinktier kaempft, spielt seine eigenen Karten weiter');
  }
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-unnatural-monsters: ok');
