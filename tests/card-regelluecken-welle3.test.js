// Regellücken Welle 3 (Spec 2026-09-22-regelluecken-welle3-design.md):
// Verstärker pro Monster, Barde "Verzaubern" und "Bardenglück".
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
    code: 'TEST', players, turnIndex: 0, turnPhase: 'kampf', combatHappenedThisTurn: true,
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

// --- Verstärker haengen am Monster ------------------------------------------
// URALT: "+10 fuer das Monster", dazu 2 zusaetzliche Schaetze.
{
  const uralt = findCard('URALT');
  const m1 = findCard('LAHMER GOBLIN', 'monster');
  const m2 = findCard('MR. BONES', 'monster');
  const p = makePlayer({ hand: [uralt.id] });
  const room = makeRoom([p]);
  S.startCombat(room, 'p1', [m1.id, m2.id], { fromHand: false });
  const vorher = S.combatTotals(room).monsterStrength;
  S.handlePlayCombatCard(room, 'p1', uralt.id);
  // Zwei Monster im Kampf: erst das Ziel waehlen.
  assert.ok(room.pendingCardAction, 'bei zwei Monstern wird das Zielmonster gewaehlt');
  const option = room.pendingCardAction.options.find((o) => o.label.includes(m1.name));
  assert.ok(option, `Wahl nennt "${m1.name}"`);
  S.handleResolveCardChoice(room, 'p1', option.id);
  assert.strictEqual(S.combatTotals(room).monsterStrength, vorher + uralt.bonus, 'der Bonus zaehlt');
  assert.deepStrictEqual(room.combat.enhancers.map((e) => e.monsterId), [m1.id], 'der Verstaerker haengt am gewaehlten Monster');

  // Das verstaerkte Monster verschwindet -> sein Bonus geht mit.
  const polly = findCard('POLLYVERWANDLUNGSTRANK');
  p.hand.push(polly.id);
  S.handlePlayCombatCard(room, 'p1', polly.id);
  const monsterWahl = room.pendingCardAction.options.find((o) => o.label.includes(m1.name));
  S.handleResolveCardChoice(room, 'p1', monsterWahl.id);
  assert.ok(!room.combat.monsterIds.includes(m1.id), 'das Monster ist weg');
  assert.strictEqual(S.combatTotals(room).monsterStrength, m2.level, 'mit dem Monster ist auch sein Verstaerker weg');
}
// Gegenprobe: bei genau einem Monster keine Zielabfrage.
{
  const uralt = findCard('URALT');
  const m1 = findCard('LAHMER GOBLIN', 'monster');
  const p = makePlayer({ hand: [uralt.id] });
  const room = makeRoom([p]);
  S.startCombat(room, 'p1', [m1.id], { fromHand: false });
  S.handlePlayCombatCard(room, 'p1', uralt.id);
  assert.strictEqual(room.pendingCardAction, null, 'ein Monster: keine Rueckfrage');
  assert.strictEqual(S.combatTotals(room).monsterStrength, m1.level + uralt.bonus, 'der Bonus zaehlt trotzdem');
}

// --- GIGANTISCH zaehlt nur fuer sein eigenes Monster ------------------------
{
  const gigantisch = findCard('GIGANTISCH');
  const fungus = findCard('FUNGUS', 'monster');
  const goblin = findCard('LAHMER GOBLIN', 'monster');
  const spiele = (zielName) => {
    const p = makePlayer({ hand: [gigantisch.id] });
    const room = makeRoom([p]);
    S.startCombat(room, 'p1', [fungus.id, goblin.id], { fromHand: false });
    const vorher = S.combatTotals(room).monsterStrength;
    S.handlePlayCombatCard(room, 'p1', gigantisch.id);
    const wahl = room.pendingCardAction.options.find((o) => o.label.includes(zielName));
    S.handleResolveCardChoice(room, 'p1', wahl.id);
    return S.combatTotals(room).monsterStrength - vorher;
  };
  assert.strictEqual(spiele(fungus.name), 25, 'GIGANTISCH auf dem FUNGUS: +25');
  assert.strictEqual(spiele(goblin.name), gigantisch.bonus, 'GIGANTISCH auf einem anderen Monster: gedruckter Bonus');
}
// --- UNTOT macht nur sein Zielmonster untot ---------------------------------
{
  const untot = findCard('UNTOT');
  const goblin = findCard('LAHMER GOBLIN', 'monster');
  // Nicht MR. BONES: der ist selbst in UNDEAD_MONSTERS (src/cards/passives.js)
  // und wuerde combatHasUndead unabhaengig vom Verstaerker wahr halten - das
  // wuerde den Per-Monster-Test verdecken.
  const drache = findCard('PLUTONIUMDRACHE', 'monster');
  const p = makePlayer({ hand: [untot.id] });
  const room = makeRoom([p]);
  S.startCombat(room, 'p1', [goblin.id, drache.id], { fromHand: false });
  S.handlePlayCombatCard(room, 'p1', untot.id);
  const wahl = room.pendingCardAction.options.find((o) => o.label.includes(goblin.name));
  S.handleResolveCardChoice(room, 'p1', wahl.id);
  assert.ok(S.combatHasUndead(room), 'mit UNTOT gilt der Kampf als untot');
  // Das verstaerkte Monster verschwindet -> der Untot-Status geht mit.
  const polly = findCard('POLLYVERWANDLUNGSTRANK');
  p.hand.push(polly.id);
  S.handlePlayCombatCard(room, 'p1', polly.id);
  const monsterWahl = room.pendingCardAction.options.find((o) => o.label.includes(goblin.name));
  S.handleResolveCardChoice(room, 'p1', monsterWahl.id);
  assert.ok(!S.combatHasUndead(room), 'ohne das Monster ist auch sein UNTOT weg');
}
// --- oeffneVerlustKonsequenz: GIGANTISCH verdoppelt das Miese Zeug nur, wenn
// es tatsaechlich auf dem FUNGUS liegt (nicht kampfweit) -----------------------
{
  const fungus = findCard('FUNGUS', 'monster');
  const goblin = findCard('LAHMER GOBLIN', 'monster');
  const gigantisch = findCard('GIGANTISCH');
  // Levelverlust ueber eine erzwungene, misslungene Flucht: LAHMER GOBLIN
  // kostet immer 1 Stufe, FUNGUS 1 (oder 2 mit GIGANTISCH auf ihm) - macht
  // den Effekt des Verstaerker-Filters direkt am Levelverlust sichtbar.
  const verlust = (gigantischZielId) => {
    const p = makePlayer({ level: 10 });
    const room = makeRoom([p]);
    room.combat = {
      actorId: 'p1', helperId: null, monsterIds: [fungus.id, goblin.id],
      enhancers: [{ cardId: gigantisch.id, monsterId: gigantischZielId }],
      actorModifier: 0, monsterModifier: 0, mustFlee: true, backstabs: {}, treasureDelta: 0,
    };
    S.handleAttemptFlee(room, 'p1', -9); // Modifier -9, Wurf max. 6: immer < 5, Flucht scheitert sicher.
    return 10 - p.level;
  };
  assert.strictEqual(verlust(goblin.id), 2, 'GIGANTISCH auf dem GOBLIN: Fungus bleibt einfach (1) + Goblin (1)');
  assert.strictEqual(verlust(fungus.id), 3, 'GIGANTISCH auf dem FUNGUS: Fungus verdoppelt (2) + Goblin (1)');
}
// --- Gigantischer FUNGUS verdoppelt die Schlimmen Dinge nur als sein Verstaerker
{
  const fungus = findCard('FUNGUS', 'monster');
  const quelle = (verstaerker) => ({ name: 'FUNGUS', text: fungus.badstuff, verstaerker });
  const p = makePlayer();
  const spec = (v) => S.resolveConsequenceSpec('FUNGUS', fungus.badstuff, p, makeRoom([p]), quelle(v));
  assert.strictEqual(spec(['GIGANTISCH']).amount, 2, 'mit GIGANTISCH doppelt');
  assert.strictEqual(spec([]).amount, 1, 'ohne GIGANTISCH einfach');
}

fertig();
console.log('card-regelluecken-welle3: alle Checks gruen');
