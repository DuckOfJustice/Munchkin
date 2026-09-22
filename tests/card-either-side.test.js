// "+X fuer beide Seiten" war ein Uebersetzungsfehler von "+X to either side":
// gemeint ist wie bei den Grundspiel-Traenken EINE Seite nach Wahl.
const assert = require('assert');
const { ALL_CARDS, newEquipped, handlePlayCombatCard, handleResolveCardChoice, parseCombatPotion } = require('../server.js');

const findCard = (name, category) => {
  const c = ALL_CARDS.find((x) => x.name === name && (!category || x.category === category));
  if (!c) throw new Error(`Testkarte nicht gefunden: ${name}`);
  return c;
};

function makePlayer(o) {
  return Object.assign({
    id: 'p1', name: 'A', level: 3, hand: [], races: [], classes: [], powerGroups: [],
    raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), attachments: { cheatedItemId: null }, activeCurses: [],
    isBot: false, connected: true, gender: 'm', genderBeiSlippern: null,
  }, o || {});
}

const monster = findCard('LAHMER GOBLIN', 'monster');
// opts: p2/p3 (Overrides fuer die Mitspieler:innen), helperId, spielerId (wer die Karte spielt).
function spiele(name, actorOverrides, opts) {
  opts = opts || {};
  const karte = findCard(name, 'treasure_other');
  const room = {
    code: 'TEST',
    players: [makePlayer(Object.assign({}, actorOverrides)), makePlayer(Object.assign({ id: 'p2', name: 'B' }, opts.p2)),
      makePlayer(Object.assign({ id: 'p3', name: 'C' }, opts.p3))],
    turnIndex: 0, turnPhase: 'kampf', combatHappenedThisTurn: true,
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [], itemAttachments: {},
    revealedDoorCard: null, pendingConsequence: null, pendingCardAction: null,
    winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
    settings: { sets: {} },
    combat: { actorId: 'p1', helperId: opts.helperId || null, monsterIds: [monster.id], actorModifier: 0, monsterModifier: 0, mustFlee: false },
  };
  const spieler = room.players.find((p) => p.id === (opts.spielerId || 'p1'));
  spieler.hand.push(karte.id);
  handlePlayCombatCard(room, spieler.id, karte.id);
  return room;
}
const fertig = (room) => { if (room.cleanupTimer) clearTimeout(room.cleanupTimer); };

// Kartentext ist korrigiert.
const betroffen = ['DRUIDEN-FLÜSSIGKEIT', 'LEMMING-SAFT', 'FLUCHTTRANK', 'DEIN SCHUH IST OFFEN!', 'ÖL DES KOCHENS',
  'ZWERGENWURF', 'LECKERER KUCHEN', 'FLÜSSIGE MAID', 'SCHARFE PFEFFERSOSSE', 'MONSTERFUTTER', 'KÖNIGLICHES ÖL'];
ALL_CARDS.forEach((c) => assert.ok(!/(?<!der )beide[n]?\s+Seiten/i.test(c.text), `${c.name}: Text sagt noch "beide Seiten"`));
betroffen.forEach((n) => assert.ok(/für eine der beiden Seiten/.test(findCard(n).text), `${n}: neuer Wortlaut fehlt`));

assert.deepStrictEqual(parseCombatPotion('Während beliebigem Kampf spielen. +3 für eine der beiden Seiten.'), { side: 'either', amount: 3 });

// Jede betroffene Karte fragt nach der Seite und wirkt nur auf die gewaehlte.
const erwartet = { 'DRUIDEN-FLÜSSIGKEIT': 3, 'LEMMING-SAFT': 3, 'FLUCHTTRANK': 5, 'DEIN SCHUH IST OFFEN!': 3, 'ÖL DES KOCHENS': 3,
  'ZWERGENWURF': 6, 'LECKERER KUCHEN': 2, 'FLÜSSIGE MAID': 3, 'SCHARFE PFEFFERSOSSE': 3, 'MONSTERFUTTER': 5, 'KÖNIGLICHES ÖL': 3 };
// Ein Zwerg ausserhalb des Kampfs, damit auch der ZWERGENWURF spielbar ist
// (fuer die anderen Karten ohne Belang).
const zwergId = findCard('ZWERG', 'race').id;
for (const [name, bonus] of Object.entries(erwartet)) {
  for (const seite of ['munchkins', 'monster']) {
    const room = spiele(name, {}, { p2: { races: [zwergId] } });
    assert.ok(room.pendingCardAction, `${name}: Seitenwahl muss sich oeffnen`);
    assert.deepStrictEqual(room.pendingCardAction.options.map((o) => o.id), ['munchkins', 'monster'], `${name}: zwei Seiten`);
    handleResolveCardChoice(room, 'p1', seite);
    assert.deepStrictEqual([room.combat.actorModifier, room.combat.monsterModifier],
      seite === 'munchkins' ? [bonus, 0] : [0, bonus], `${name} fuer ${seite}`);
    fertig(room);
  }
}

// LECKERER KUCHEN: vom Ork geworfen +4 (eine Seite); Halbling darf zusaetzlich essen.
const orkId = ALL_CARDS.find((c) => c.name === 'ORK' && c.category === 'door_other').id;
const halblingId = findCard('HALBLING', 'race').id;
{
  const room = spiele('LECKERER KUCHEN', { races: [orkId] });
  handleResolveCardChoice(room, 'p1', 'monster');
  assert.deepStrictEqual([room.combat.actorModifier, room.combat.monsterModifier], [0, 4], 'Ork wirft: +4 fuer das Monster');
  fertig(room);
}
{
  const room = spiele('LECKERER KUCHEN', { races: [halblingId] });
  assert.deepStrictEqual(room.pendingCardAction.options.map((o) => o.id), ['munchkins', 'monster', 'essen'], 'Halbling: werfen (Seite) oder essen');
  handleResolveCardChoice(room, 'p1', 'munchkins');
  assert.deepStrictEqual([room.combat.actorModifier, room.combat.monsterModifier], [2, 0]);
  fertig(room);
}

// SCHARFE PFEFFERSOSSE: "+6, wenn es zur Hilfe von Halblingen eingesetzt wird" -
// die +6 gibt es nur auf der Munchkin-Seite, fuers Monster bleibt es +3.
for (const [seite, werte] of [['munchkins', [6, 0]], ['monster', [0, 3]]]) {
  const room = spiele('SCHARFE PFEFFERSOSSE', { races: [halblingId] });
  handleResolveCardChoice(room, 'p1', seite);
  assert.deepStrictEqual([room.combat.actorModifier, room.combat.monsterModifier], werte, `Pfeffersosse mit Halbling fuer ${seite}`);
  fertig(room);
}

// ZWERGENWURF: "Hebe einen Zwerg hoch, der sich nicht im Kampf befindet ...
// Dich selbst kannst du nicht werfen." Ohne werfbaren Zwerg bleibt die Karte
// auf der Hand, und es oeffnet sich keine Seitenwahl.
const nichtSpielbar = (room, wer, grund) => {
  const karte = findCard('ZWERGENWURF');
  assert.ok(!room.pendingCardAction, `ZWERGENWURF ${grund}: keine Seitenwahl`);
  assert.ok(room.players.find((p) => p.id === wer).hand.includes(karte.id), `ZWERGENWURF ${grund}: Karte bleibt auf der Hand`);
  assert.deepStrictEqual([room.combat.actorModifier, room.combat.monsterModifier], [0, 0], `ZWERGENWURF ${grund}: kein Bonus`);
  fertig(room);
};
nichtSpielbar(spiele('ZWERGENWURF'), 'p1', 'ohne Zwerg am Tisch');
nichtSpielbar(spiele('ZWERGENWURF', { races: [zwergId] }), 'p1', 'wenn nur die kaempfende Person Zwerg ist');
nichtSpielbar(spiele('ZWERGENWURF', {}, { p2: { races: [zwergId] }, helperId: 'p2' }), 'p1', 'wenn der Zwerg mitkaempft');
nichtSpielbar(spiele('ZWERGENWURF', {}, { p3: { races: [zwergId] }, spielerId: 'p3' }), 'p3', 'wenn man sich selbst werfen muesste');
{
  // Zuschauer:in wirft einen anderen Zwerg, der ebenfalls nicht mitkaempft.
  const room = spiele('ZWERGENWURF', {}, { p2: { races: [zwergId] }, spielerId: 'p3' });
  assert.ok(room.pendingCardAction, 'ZWERGENWURF mit fremdem Zwerg ausserhalb des Kampfs: Seitenwahl');
  handleResolveCardChoice(room, 'p3', 'monster');
  assert.deepStrictEqual([room.combat.actorModifier, room.combat.monsterModifier], [0, 6]);
  fertig(room);
}

console.log('card-either-side: alle Checks gruen');
