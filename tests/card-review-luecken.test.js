// Luecken aus der Review-Liste (2026-09-22): Stoererliste auf allen
// Schatz-Wegen, FUNGUS gigantisch, GRASGNOLL-Traenke, WUNSCHRING je Eintrag.
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, addActiveCurse, handleUseCardPower, handleResolveCardChoice,
  beendeFluchtphase, handleAckConsequence, handleResolveConsequenceChoice,
  thiefPowerInfo, handleThiefSteal, handleResolveCardCardChoice, priestResurrectPiles, applyPrimitiveAction,
  applyCombatReaction, COMBAT_REACTION_CARDS, handleResolveMultiCardSelection,
} = require('../server.js');

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

// --- WUNSCHRING beendet genau den gewaehlten Fluch --------------------------
// GESCHLECHTSUMWANDLUNG und ZWERGENBIER haben dieselbe Wirkungsart
// (combatMalus). Bisher beendete der Ring beide auf einmal.
{
  const p = makePlayer();
  const room = makeRoom([p]);
  addActiveCurse(room, p, 'GESCHLECHTSUMWANDLUNG', findCard('GESCHLECHTSUMWANDLUNG').id);
  addActiveCurse(room, p, 'ZWERGENBIER', findCard('ZWERGENBIER').id);
  assert.strictEqual(p.activeCurses.length, 2);
  const ring = findCard('WUNSCHRING');
  p.hand.push(ring.id);
  handleUseCardPower(room, p.id, ring.id);
  const option = room.pendingCardAction.options.find((o) => /GESCHLECHTSUMWANDLUNG/.test(o.label));
  assert.ok(option, 'Wahl zwischen den beiden Fluechen');
  handleResolveCardChoice(room, p.id, option.id);
  assert.deepStrictEqual(p.activeCurses.map((f) => f.name), ['ZWERGENBIER'],
    'nur die Geschlechtsumwandlung endet, das Zwergenbier bleibt');
}

// --- FUNGUS: "Verdoppelt die Strafe, wenn der Fungus Gigantisch ist" --------
// Normal: Elfen -2, alle anderen -1. Mit GIGANTISCH: -4 / -2. Beide scheitern
// an der Flucht - die zweite Person laeuft ueber den Nachlauf
// (_pendingConsequenceBacklog), der Kampf ist dann schon weg.
{
  const fungus = findCard('FUNGUS', 'monster');
  const gigantisch = findCard('GIGANTISCH');
  const elfId = findCard('ELF', 'race').id;
  const verlust = (mitGigantisch) => {
    const kaempfer = makePlayer({ id: 'p1', name: 'A', level: 8 });
    const elfe = makePlayer({ id: 'p2', name: 'B', level: 8, races: [elfId] });
    const room = makeRoom([kaempfer, elfe], { turnPhase: 'kampf' });
    const c = { actorId: 'p1', helperId: 'p2', monsterIds: [fungus.id], actorModifier: 0, monsterModifier: 0,
      enhancerIds: mitGigantisch ? [gigantisch.id] : [], fleeFailed: ['p1', 'p2'], mustFlee: false };
    room.combat = c;
    beendeFluchtphase(room, c);
    // Helfer:in zuerst, dann die kaempfende Person aus dem Nachlauf.
    handleAckConsequence(room, 'p2');
    return [kaempfer.level, elfe.level];
  };
  assert.deepStrictEqual(verlust(false), [7, 6], 'ohne Gigantisch: -1 / Elfe -2');
  assert.deepStrictEqual(verlust(true), [6, 4], 'mit Gigantisch doppelt: -2 / Elfe -4');
}

// --- GRASGNOLL: "Du verlierst drei Stufen. Du erhaeltst eine Stufe zurueck
// fuer jeden Trank, den du sofort ablegst." Als Trank zaehlt jede
// Kampf-Einmalkarte (isCombatPotionCard). Hoechstens 3 zurueck.
{
  const gnoll = findCard('GRASGNOLL', 'monster');
  const traenke = ['FLAMMENDER GIFTTRANK', 'SCHLAFTRANK', 'YUPPIE-WASSER', 'JUCKPULVER'].map((n) => findCard(n).id);
  const keinTrank = findCard('ZWERG', 'race').id;
  const verliert = (hand) => {
    const p = makePlayer({ id: 'p1', level: 8, hand: hand.slice() });
    const room = makeRoom([p], { turnPhase: 'kampf' });
    const c = { actorId: 'p1', helperId: null, monsterIds: [gnoll.id], actorModifier: 0, monsterModifier: 0,
      fleeFailed: ['p1'], mustFlee: false };
    room.combat = c;
    beendeFluchtphase(room, c);
    return { p, room };
  };
  const optionen = (room) => (room.pendingConsequence.choice ? room.pendingConsequence.choice.options.map((o) => o.id) : []);

  // Ohne Trank: -3, keine Wahl.
  {
    const { p, room } = verliert([keinTrank]);
    assert.strictEqual(p.level, 5, 'GRASGNOLL kostet 3 Stufen');
    assert.strictEqual(room.pendingConsequence.choice, null, 'ohne Trank nichts zu waehlen');
  }
  // Zwei Traenke: je einer ablegen = +1, danach "fertig".
  {
    const { p, room } = verliert([traenke[0], traenke[1], keinTrank]);
    assert.strictEqual(p.level, 5);
    assert.deepStrictEqual(optionen(room).sort(), [`trank-${traenke[0]}`, `trank-${traenke[1]}`, 'fertig'].sort(),
      'nur Traenke werden angeboten, dazu "fertig"');
    handleResolveConsequenceChoice(room, 'p1', `trank-${traenke[0]}`);
    assert.strictEqual(p.level, 6, 'ein Trank abgelegt: +1');
    assert.ok(!p.hand.includes(traenke[0]) && room.treasureDiscard.includes(traenke[0]), 'der Trank liegt auf dem Ablagestapel');
    assert.deepStrictEqual(optionen(room).sort(), [`trank-${traenke[1]}`, 'fertig'].sort(), 'die Wahl geht weiter');
    handleResolveConsequenceChoice(room, 'p1', 'fertig');
    assert.strictEqual(room.pendingConsequence.choice, null, 'fertig schliesst die Wahl');
    assert.strictEqual(p.level, 6);
    assert.ok(p.hand.includes(traenke[1]), 'der zweite Trank bleibt auf der Hand');
    handleAckConsequence(room, 'p1');
    assert.strictEqual(room.pendingConsequence, null, 'danach laesst sich die Konsequenz normal bestaetigen');
  }
  // Vier Traenke: hoechstens 3 Stufen zurueck.
  {
    const { p, room } = verliert(traenke);
    for (let i = 0; i < 3; i++) handleResolveConsequenceChoice(room, 'p1', optionen(room).find((id) => id !== 'fertig'));
    assert.strictEqual(p.level, 8, 'alle 3 Stufen zurueck');
    assert.strictEqual(room.pendingConsequence.choice, null, 'nach 3 Traenken ist Schluss');
    assert.strictEqual(p.hand.length, 1, 'der vierte Trank bleibt');
  }
}

// --- WEIHNACHTSMANN / Stoererliste: "Du erhaeltst keine Schatzkarten ...
// auch nicht von anderen Spielern". Tuerkarten bleiben erlaubt. --------------
{
  const sperre = () => [{ name: 'WEIHNACHTSMANN', kind: 'noTreasure', dauer: 'dauerhaft', hinweis: '' }];
  const schatz = findCard('FLAMMENDER GIFTTRANK').id;       // Schatzkarte
  const schatz2 = findCard('SCHLAFTRANK').id;
  const tuer = findCard('ZWERG', 'race').id;                  // Tuerkarte
  const tuer2 = findCard('ELF', 'race').id;
  const dieb = findCard('DIEB', 'class').id;
  const priester = findCard('PRIESTER', 'class').id;
  const kleinerGegenstand = ALL_CARDS.find((c) => c.category === 'item' && c.slotKind === 'head').id;

  // DIEB "Diebstahl": gesperrt geht der Versuch gar nicht erst los.
  {
    const d = makePlayer({ id: 'p1', classes: [dieb], hand: [tuer], activeCurses: sperre() });
    const opfer = makePlayer({ id: 'p2', name: 'B' });
    opfer.equipped.head = kleinerGegenstand;
    const room = makeRoom([d, opfer]);
    assert.deepStrictEqual(thiefPowerInfo(room, d).stealTargets, [], 'kein Diebstahl-Ziel angeboten');
    handleThiefSteal(room, 'p1', tuer, 'p2');
    assert.ok(d.hand.includes(tuer), 'die Karte als Preis bleibt auf der Hand');
    assert.strictEqual(room.pendingRoll, null, 'es wird nicht gewuerfelt');
    assert.strictEqual(opfer.equipped.head, kleinerGegenstand);
  }

  // ENTE DER VIELEN SACHEN, gesperrte Person spielt sie.
  {
    const ente = findCard('ENTE DER VIELEN SACHEN').id;
    const p = makePlayer({ id: 'p1', hand: [ente, tuer2], activeCurses: sperre() });
    const naechster = makePlayer({ id: 'p2', name: 'B', hand: [schatz] });
    const room = makeRoom([p, naechster], { doorDiscard: [tuer], treasureDiscard: [schatz2] });
    handleUseCardPower(room, 'p1', ente);
    assert.ok(naechster.hand.includes(schatz), 'klauen: die Schatzkarte bleibt beim naechsten Spieler');
    assert.ok(!p.hand.includes(schatz));
    // Schritt "geben" (Empfaenger nicht gesperrt): normal.
    assert.strictEqual(room.pendingCardAction.kind, 'chooseCard');
    handleResolveCardCardChoice(room, 'p1', tuer2);
    // Schritt "ablagestapel": nur der Tuerstapel.
    assert.deepStrictEqual(room.pendingCardAction.candidateIds, [tuer], 'ablagestapel: nur die oberste Tuerkarte');
  }
  // ENTE, der naechste Spieler ist gesperrt: "geben" bietet keine Schatzkarten an.
  {
    const ente = findCard('ENTE DER VIELEN SACHEN').id;
    const p = makePlayer({ id: 'p1', hand: [ente, schatz, tuer2] });
    const naechster = makePlayer({ id: 'p2', name: 'B', hand: [], activeCurses: sperre() });
    const room = makeRoom([p, naechster]);
    handleUseCardPower(room, 'p1', ente);
    assert.deepStrictEqual(room.pendingCardAction.candidateIds, [tuer2], 'geben: nur Tuerkarten an die gesperrte Person');
  }

  // PRIESTER "Auferstehung": kein Schatz-Ablagestapel.
  {
    const p = makePlayer({ id: 'p1', classes: [priester], hand: [tuer], activeCurses: sperre() });
    const room = makeRoom([p], { turnPhase: 'tuer', doorDiscard: [tuer2], treasureDiscard: [schatz] });
    assert.deepStrictEqual(priestResurrectPiles(room, p), ['door'], 'nur der Tuer-Ablagestapel');
  }

  // WÜNSCHELSTAB: nur Tuerkarten waehlbar; ohne Tuerkarte nicht einsetzbar.
  {
    const stab = findCard('WÜNSCHELSTAB').id;
    const p = makePlayer({ id: 'p1', hand: [stab], activeCurses: sperre() });
    const room = makeRoom([p], { doorDiscard: [tuer], treasureDiscard: [schatz] });
    handleUseCardPower(room, 'p1', stab);
    assert.deepStrictEqual(room.pendingCardAction.candidateIds, [tuer], 'nur die Tuerkarte');

    const q = makePlayer({ id: 'p1', hand: [stab], activeCurses: sperre() });
    const leer = makeRoom([q], { doorDiscard: [], treasureDiscard: [schatz] });
    handleUseCardPower(leer, 'p1', stab);
    assert.ok(q.hand.includes(stab), 'ohne Tuerkarte bleibt der Stab auf der Hand');
    assert.strictEqual(leer.pendingCardAction, null);
  }

  // EINHEITSGRÖSSE: gesperrt nicht einsetzbar.
  {
    const einheit = findCard('EINHEITSGRÖSSE').id;
    const p = makePlayer({ id: 'p1', hand: [einheit], activeCurses: sperre() });
    const room = makeRoom([p], { treasureDiscard: [kleinerGegenstand] });
    room.combat = { actorId: 'p1', helperId: null, monsterIds: [findCard('LAHMER GOBLIN', 'monster').id],
      actorModifier: 0, monsterModifier: 0, mustFlee: false };
    handleUseCardPower(room, 'p1', einheit);
    assert.ok(p.hand.includes(einheit), 'EINHEITSGRÖSSE bleibt auf der Hand');
    assert.ok(room.treasureDiscard.includes(kleinerGegenstand), 'der Gegenstand bleibt im Ablagestapel');
  }

  // Leiche pluendern: die gesperrte Person darf nur Tuerkarten nehmen.
  {
    const tot = makePlayer({ id: 'p1', hand: [schatz, tuer] });
    const pluenderer = makePlayer({ id: 'p2', name: 'B', level: 9, activeCurses: sperre() });
    const room = makeRoom([tot, pluenderer]);
    applyPrimitiveAction(room, tot, { type: 'death' });
    assert.strictEqual(room.pendingCardAction.playerId, 'p2');
    assert.deepStrictEqual(room.pendingCardAction.candidateIds, [tuer], 'nur die Tuerkarte');
  }
}

// GRASGNOLL auf niedriger Stufe: setLevel stoppt bei 1, zurueck gibt es nur,
// was wirklich verloren wurde (Stufe 2 -> 1: hoechstens 1 zurueck).
{
  const gnoll = findCard('GRASGNOLL', 'monster');
  const traenke = ['FLAMMENDER GIFTTRANK', 'SCHLAFTRANK', 'YUPPIE-WASSER'].map((n) => findCard(n).id);
  const p = makePlayer({ id: 'p1', level: 2, hand: traenke.slice() });
  const room = makeRoom([p], { turnPhase: 'kampf' });
  const c = { actorId: 'p1', helperId: null, monsterIds: [gnoll.id], actorModifier: 0, monsterModifier: 0,
    fleeFailed: ['p1'], mustFlee: false };
  room.combat = c;
  beendeFluchtphase(room, c);
  assert.strictEqual(p.level, 1);
  handleResolveConsequenceChoice(room, 'p1', `trank-${traenke[0]}`);
  assert.strictEqual(p.level, 2, 'eine Stufe zurueck');
  assert.strictEqual(room.pendingConsequence.choice, null, 'mehr war nicht verloren - keine weitere Wahl');
}

// Stoererliste, weitere Wege (aus dem Code-Review).
{
  const sperre = () => [{ name: 'WEIHNACHTSMANN', kind: 'noTreasure', dauer: 'dauerhaft', hinweis: '' }];
  const schatz = findCard('FLAMMENDER GIFTTRANK').id;
  const schatz2 = findCard('SCHLAFTRANK').id;
  const tuer = findCard('ZWERG', 'race').id;
  const nurTuer = (p) => p.hand.every((id) => ALL_CARDS.find((x) => x.id === id).type !== 'treasure');

  // HIPPOGREIF: "... darf jeder Spieler eine Schatzkarte ... aus deiner Hand
  // nehmen" - die gesperrte Person geht leer aus, die Wahl zeigt ihr nichts an.
  {
    const hippo = findCard('HIPPOGREIF', 'monster');
    const opfer = makePlayer({ id: 'p1', level: 6, hand: [schatz, schatz2] });
    const gesperrt = makePlayer({ id: 'p2', name: 'B', activeCurses: sperre() });
    const room = makeRoom([opfer, gesperrt], { turnPhase: 'kampf' });
    const c = { actorId: 'p1', helperId: null, monsterIds: [hippo.id], actorModifier: 0, monsterModifier: 0,
      fleeFailed: ['p1'], mustFlee: false };
    room.combat = c;
    beendeFluchtphase(room, c);
    assert.ok(!room.pendingCardAction || room.pendingCardAction.playerId !== 'p2', 'kein Waehler fuer die gesperrte Person');
    assert.ok(nurTuer(gesperrt), 'HIPPOGREIF: keine Schatzkarte fuer die gesperrte Person');
  }

  // EDELMUT ohne Gegenstaende: gezogen werden nur Karten, die der Empfaenger bekommen darf.
  {
    const opfer = makePlayer({ id: 'p1', hand: [schatz, schatz2] });
    const gesperrt = makePlayer({ id: 'p2', name: 'B', activeCurses: sperre() });
    const room = makeRoom([opfer, gesperrt]);
    applyPrimitiveAction(room, opfer, { type: 'curseEdelmut', cardId: findCard('EDELMUT').id });
    assert.ok(nurTuer(gesperrt), 'EDELMUT: keine Schatzkarte fuer die gesperrte Person');
    assert.strictEqual(opfer.hand.length, 2, 'die Schatzkarten bleiben beim Opfer');
  }

  // VERLIERE ZWEI KARTEN (giveHandCardsToNeighbors).
  {
    const opfer = makePlayer({ id: 'p1', hand: [schatz] });
    const gesperrt = makePlayer({ id: 'p2', name: 'B', activeCurses: sperre() });
    const room = makeRoom([opfer, gesperrt]);
    applyPrimitiveAction(room, opfer, { type: 'giveHandCardsToNeighbors' });
    assert.ok(nurTuer(gesperrt), 'VERLIERE ZWEI KARTEN: keine Schatzkarte fuer die gesperrte Person');
    assert.ok(opfer.hand.includes(schatz));
  }

  // FLOHMARKT: gesperrt nicht einsetzbar (holt Schaetze aus dem Ablagestapel).
  {
    const floh = findCard('FLOHMARKT').id;
    const p = makePlayer({ id: 'p1', hand: [floh, schatz], activeCurses: sperre() });
    const room = makeRoom([p], { treasureDiscard: [schatz2] });
    handleUseCardPower(room, 'p1', floh);
    assert.ok(p.hand.includes(floh), 'FLOHMARKT bleibt auf der Hand');
  }

  // SINNLOSER AKT DER FREUNDLICHKEIT: nur noch "selbst 1 Stufe".
  {
    const akt = findCard('SINNLOSER AKT DER FREUNDLICHKEIT').id;
    const p = makePlayer({ id: 'p1', hand: [akt], activeCurses: sperre() });
    const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
    handleUseCardPower(room, 'p1', akt);
    const ids = room.pendingCardAction ? room.pendingCardAction.options.map((o) => o.id) : [];
    assert.ok(!ids.includes('target'), 'keine Option, einen Gegenstand zu bekommen');
  }

  // HILF MIR: gesperrt nicht einsetzbar.
  {
    const hilf = findCard('HILF MIR').id;
    const p = makePlayer({ id: 'p1', hand: [hilf], activeCurses: sperre() });
    const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })], { turnPhase: 'kampf' });
    room.combat = { actorId: 'p1', helperId: null, monsterIds: [findCard('LAHMER GOBLIN', 'monster').id],
      actorModifier: 0, monsterModifier: 0, mustFlee: false };
    applyCombatReaction(room, p, hilf, COMBAT_REACTION_CARDS['HILF MIR']);
    assert.ok(p.hand.includes(hilf), 'HILF MIR bleibt auf der Hand');
    assert.strictEqual(room.pendingCardAction, null);
  }

  // SCHICKSALHAFTE KARTEN: kein Nachziehen vom Schatzstapel.
  {
    const p = makePlayer({ id: 'p1', hand: [tuer], activeCurses: sperre() });
    const room = makeRoom([p], { treasureDeck: [schatz] });
    room.pendingCardAction = { kind: 'multiCardSelection', playerId: 'p1', cardName: 'SCHICKSALHAFTE KARTEN', actionType: 'schicksalhafteKarten' };
    handleResolveMultiCardSelection(room, 'p1', [tuer], 'treasure');
    assert.ok(p.hand.includes(tuer) && !p.hand.includes(schatz), 'nichts abgelegt, nichts gezogen');
    assert.ok(room.pendingCardAction, 'die Auswahl bleibt offen (Tuerstapel geht noch)');
  }
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); });
console.log('card-review-luecken: alle Checks gruen');
