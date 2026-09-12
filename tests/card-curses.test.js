// Task 7: Tracker fuer anhaltende Flueche (M1). Bis hierher kannte der
// Server nur Sofort-Effekte - MIESER SPIEGEL, GESCHLECHTSUMWANDLUNG, HUHN AUF
// DEINEM KOPF und WINZIGE HÄNDE wirkten nach dem Ziehen nicht mehr weiter.
// Dieser Test prueft den Tracker (player.activeCurses), seine Auswirkung auf
// combatTotals (der EINZIGE Ort, an dem Kampfstaerke berechnet werden darf -
// sonst bleibt "bereit" fuer andere Spieler:innen unbemerkt veraltet), das
// Ablaufen der "naechster Kampf"-Flueche bei Sieg/Flucht und WUNSCHRING.
const assert = require('assert');
const {
  ALL_CARDS, combatTotals, addActiveCurse, clearActiveCurse, clearNextCombatCurses,
  curseCombatModifier, curseSuppressesItemBonuses, newEquipped, handleEquipItem,
  handleDrawDoor, resolveCombatWin, applyPrimitiveAction, TREASURE_POWER_OVERRIDES,
  CONSEQUENCE_OVERRIDES, LINGERING_CURSES, refreshCombatReady, combatAllReady,
  handleSetCombatReady,
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
    isBot: false, connected: true,
  }, overrides || {});
}

const treasureFiller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 20).map((c) => c.id);

function makeRoom(extra) {
  return Object.assign({
    code: 'TEST',
    players: [makePlayer({ id: 'p1', name: 'A' }), makePlayer({ id: 'p2', name: 'B' })],
    turnIndex: 0, turnPhase: 'tuer', combatHappenedThisTurn: false,
    doorDeck: [], doorDiscard: [], treasureDeck: treasureFiller.slice(), treasureDiscard: [],
    revealedDoorCard: null, doorReveal: null, dieRoll: null,
    combat: null, pendingConsequence: null, pendingCardAction: null, pendingRoll: null,
    winner: null, phase: 'playing', logs: [], lastActivity: Date.now(),
    cleanupTimer: null, botTimer: null, settings: { sets: {} },
  }, extra || {});
}

function combatRoom(monsterName, actorOverrides, combatOverrides) {
  const m = findCard(monsterName, 'monster');
  const room = makeRoom({
    turnPhase: 'kampf', combatHappenedThisTurn: true,
    combat: Object.assign({
      actorId: 'p1', helperId: null, helperPending: null, monsterIds: [m.id],
      actorModifier: 0, monsterModifier: 0, mustFlee: false, fromHand: false, ready: {},
    }, combatOverrides || {}),
  });
  Object.assign(room.players[0], actorOverrides || {});
  return { room, m };
}

function done(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  if (room.botTimer) clearTimeout(room.botTimer);
  return room;
}

function run() {
  // -------------------------------------------------------------------
  // combatTotals: MIESER SPIEGEL, Ruestungs-Ausnahme, GESCHLECHTSUMWANDLUNG
  // -------------------------------------------------------------------
  {
    const streitkolben = findCard('SCHARFER STREITKOLBEN'); // +4, keine Ruestung
    const { room, m } = combatRoom('LAHMER GOBLIN', { hand: [streitkolben.id] });
    handleEquipItem(room, 'p1', streitkolben.id);
    assert.strictEqual(combatTotals(room).playerStrength, 5 + 4, 'Stufe 5 plus Gegenstand +4 ohne Fluch');

    addActiveCurse(room, room.players[0], 'MIESER SPIEGEL', findCard('MIESER SPIEGEL').id);
    assert.strictEqual(room.players[0].activeCurses.length, 1, 'Fluch wird eingetragen');
    assert.strictEqual(combatTotals(room).playerStrength, 5,
      'Mieser Spiegel: keine Gegenstandsboni ausser Ruestung');
    void m;
    done(room);
  }

  {
    const mithril = findCard('MITHRIL-RÜSTUNG'); // +3, Ruestung
    const { room } = combatRoom('LAHMER GOBLIN', { hand: [mithril.id] });
    handleEquipItem(room, 'p1', mithril.id);
    addActiveCurse(room, room.players[0], 'MIESER SPIEGEL', findCard('MIESER SPIEGEL').id);
    assert.strictEqual(combatTotals(room).playerStrength, 5 + 3,
      'Ruestungsbonus ist die ausdrueckliche Ausnahme');
    done(room);
  }

  {
    const { room } = combatRoom('LAHMER GOBLIN');
    addActiveCurse(room, room.players[0], 'GESCHLECHTSUMWANDLUNG', findCard('GESCHLECHTSUMWANDLUNG').id);
    assert.strictEqual(curseCombatModifier(room.players[0]), -5);
    assert.strictEqual(combatTotals(room).playerStrength, 0, 'Stufe 5 minus 5 wegen Ablenkung');
  }

  // HUHN AUF DEINEM KOPF / WINZIGE HÄNDE sind nicht 'combatMalus' bzw.
  // 'noItemBonusExceptArmor' - sie duerfen combatTotals nicht beeinflussen.
  {
    const p = makePlayer();
    addActiveCurse({ logs: [] }, p, 'HUHN AUF DEINEM KOPF', findCard('HUHN AUF DEINEM KOPF').id);
    addActiveCurse({ logs: [] }, p, 'WINZIGE HÄNDE', findCard('WINZIGE HÄNDE').id);
    assert.strictEqual(curseCombatModifier(p), 0, 'kein Kampfmalus durch diese beiden Flueche');
    assert.strictEqual(curseSuppressesItemBonuses(p), false, 'keine Item-Unterdrueckung durch diese beiden');
  }

  // -------------------------------------------------------------------
  // Das eigentliche Ziel des Tasks: combatTotals ist der EINZIGE Pfad.
  // Ein Fluch, der die Staerke mitten im Kampf aendert, muss "bereit" fuer
  // die anderen zuruecksetzen (wie jede andere staerkeaendernde Aktion).
  // -------------------------------------------------------------------
  {
    const { room } = combatRoom('LAHMER GOBLIN', { level: 30, connected: true });
    room.players[1].connected = true;
    refreshCombatReady(room);
    handleSetCombatReady(room, 'p2', true);
    assert.strictEqual(combatAllReady(room), true, 'Testvoraussetzung: alle bereit');
    addActiveCurse(room, room.players[0], 'GESCHLECHTSUMWANDLUNG', findCard('GESCHLECHTSUMWANDLUNG').id);
    refreshCombatReady(room); // laeuft im Betrieb in broadcastState
    assert.strictEqual(combatAllReady(room), false,
      'ein neu gesetzter Fluch aendert die Kampfstaerke ueber combatTotals und macht "bereit" ungueltig');
    done(room);
  }

  // -------------------------------------------------------------------
  // Fluch wird beim Ziehen tatsaechlich getrackt (autoApplyLossConsequence),
  // und SCHUTZSANDALEN verhindert das wie jeden anderen Fluch auch.
  // -------------------------------------------------------------------
  {
    const spiegel = findCard('MIESER SPIEGEL');
    const room = makeRoom({ doorDeck: [spiegel.id] });
    handleDrawDoor(room, 'p1');
    assert.strictEqual(room.players[0].activeCurses.length, 1, 'Fluch wird beim Ziehen eingetragen');
    assert.strictEqual(room.players[0].activeCurses[0].kind, 'noItemBonusExceptArmor');
    assert.strictEqual(room.players[0].activeCurses[0].cardId, spiegel.id);
    done(room);
  }

  {
    const sandalen = findCard('SCHUTZSANDALEN', 'item');
    const spiegel = findCard('MIESER SPIEGEL');
    const room = makeRoom({ doorDeck: [spiegel.id], players: [makePlayer({ id: 'p1', name: 'A', hand: [sandalen.id] }), makePlayer({ id: 'p2', name: 'B' })] });
    handleEquipItem(room, 'p1', sandalen.id);
    handleDrawDoor(room, 'p1');
    assert.strictEqual(room.players[0].activeCurses.length, 0, 'Schutzsandalen verhindern auch den Tracker');
    done(room);
  }

  // -------------------------------------------------------------------
  // CONSEQUENCE_OVERRIDES bleibt fuer die vier Karten "bewusst manuell" -
  // der Tracker kommt zusaetzlich, nicht als Ersatz.
  // -------------------------------------------------------------------
  ['MIESER SPIEGEL', 'GESCHLECHTSUMWANDLUNG', 'HUHN AUF DEINEM KOPF'].forEach((name) => {
    const spec = CONSEQUENCE_OVERRIDES[name](makePlayer(), makeRoom());
    assert.strictEqual(spec, null, `${name}: weiterhin kein Sofort-Effekt`);
  });
  assert.ok(LINGERING_CURSES['WINZIGE HÄNDE'], 'WINZIGE HÄNDE steht im Fluch-Tracker');

  // -------------------------------------------------------------------
  // "naechster Kampf"-Flueche laufen beim Sieg ab, "dauerhafte" bleiben.
  // -------------------------------------------------------------------
  {
    const { room, m } = combatRoom('LAHMER GOBLIN');
    const p = room.players[0];
    addActiveCurse(room, p, 'MIESER SPIEGEL', findCard('MIESER SPIEGEL').id);
    addActiveCurse(room, p, 'HUHN AUF DEINEM KOPF', findCard('HUHN AUF DEINEM KOPF').id);
    resolveCombatWin(room);
    assert.strictEqual(p.activeCurses.length, 1, 'nur der dauerhafte Fluch bleibt nach dem Sieg');
    assert.strictEqual(p.activeCurses[0].name, 'HUHN AUF DEINEM KOPF');
    void m;
    done(room);
  }

  // clearNextCombatCurses direkt (deckt den Weglaufen-Pfad ab, ohne echten
  // Wuerfelwurf simulieren zu muessen - resolveCombatWin oben deckt den
  // Sieg-Pfad bereits end-to-end ab).
  {
    const p = makePlayer();
    addActiveCurse({ logs: [] }, p, 'GESCHLECHTSUMWANDLUNG', findCard('GESCHLECHTSUMWANDLUNG').id);
    addActiveCurse({ logs: [] }, p, 'WINZIGE HÄNDE', findCard('WINZIGE HÄNDE').id);
    clearNextCombatCurses([p]);
    assert.strictEqual(p.activeCurses.length, 1, 'nach Flucht/Sieg nur der dauerhafte Fluch uebrig');
    assert.strictEqual(p.activeCurses[0].name, 'WINZIGE HÄNDE');
  }

  // -------------------------------------------------------------------
  // WUNSCHRING: nichts zu beenden -> null; genau einer -> sofort ohne Wahl;
  // mehrere -> Wahldialog mit einer Option je Fluch.
  // -------------------------------------------------------------------
  {
    const p = makePlayer();
    assert.strictEqual(TREASURE_POWER_OVERRIDES['WUNSCHRING'](p), null, 'ohne Fluch nicht spielbar');

    addActiveCurse({ logs: [] }, p, 'HUHN AUF DEINEM KOPF', findCard('HUHN AUF DEINEM KOPF').id);
    const spec1 = TREASURE_POWER_OVERRIDES['WUNSCHRING'](p);
    assert.deepStrictEqual(spec1, { type: 'clearCurse', index: 0 }, 'genau ein Fluch: kein Wahldialog');
    applyPrimitiveAction({}, p, spec1);
    assert.strictEqual(p.activeCurses.length, 0, 'der einzige Fluch ist beendet');

    addActiveCurse({ logs: [] }, p, 'HUHN AUF DEINEM KOPF', findCard('HUHN AUF DEINEM KOPF').id);
    addActiveCurse({ logs: [] }, p, 'WINZIGE HÄNDE', findCard('WINZIGE HÄNDE').id);
    const spec2 = TREASURE_POWER_OVERRIDES['WUNSCHRING'](p);
    assert.strictEqual(spec2.type, 'choice');
    assert.strictEqual(spec2.options.length, 2, 'ein Wahldialog-Eintrag je aktivem Fluch');
    // Die zweite Option beenden, die erste muss bestehen bleiben.
    applyPrimitiveAction({}, p, spec2.options[1].action);
    assert.strictEqual(p.activeCurses.length, 1);
    assert.strictEqual(p.activeCurses[0].name, 'HUHN AUF DEINEM KOPF', 'nur der gewaehlte Fluch wurde beendet');
  }

  // clearActiveCurse direkt: unbekannter Index raeumt nichts weg.
  {
    const p = makePlayer();
    addActiveCurse({ logs: [] }, p, 'HUHN AUF DEINEM KOPF', findCard('HUHN AUF DEINEM KOPF').id);
    assert.strictEqual(clearActiveCurse({}, p, 5), null, 'Index ausserhalb der Liste -> nichts entfernt');
    assert.strictEqual(p.activeCurses.length, 1);
    assert.ok(clearActiveCurse({}, p, 0), 'gueltiger Index entfernt den Fluch');
    assert.strictEqual(p.activeCurses.length, 0);
  }

  console.log('OK - Anhaltende Flueche: Tracker, Mieser-Spiegel/Ruestungs-Ausnahme, Geschlechtsumwandlung, Bereit-Invalidierung, Ablauf bei Sieg/Flucht, Wunschring.');
}

run();
