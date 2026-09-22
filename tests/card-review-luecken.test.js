// Luecken aus der Review-Liste (2026-09-22): Stoererliste auf allen
// Schatz-Wegen, FUNGUS gigantisch, GRASGNOLL-Traenke, WUNSCHRING je Eintrag.
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, addActiveCurse, handleUseCardPower, handleResolveCardChoice,
  beendeFluchtphase, handleAckConsequence, handleResolveConsequenceChoice,
  thiefPowerInfo, handleThiefSteal, handleResolveCardCardChoice, priestResurrectPiles, applyPrimitiveAction,
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

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); });
console.log('card-review-luecken: alle Checks gruen');
