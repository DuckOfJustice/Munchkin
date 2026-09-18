// Kartenanhänge (Task 6): SCHUMMELN! hebt fuer GENAU EINEN Gegenstand die
// Anlege-Regeln auf und geht mit ihm verloren, wenn der Gegenstand die
// Besitzerin verliert. KNIESCHÜTZER DER VERLOCKUNG erzwingt Hilfe von
// höherstufigen Personen, sperrt dafür aber die Siegesstufe in genau diesem
// Kampf.
const assert = require('assert');
const {
  ALL_CARDS, handleEquipItem, handlePlayCheat, equippedItemIds, newEquipped,
  handleSellItems, handleUnequipItem, handleRequestHelp, handleRespondHelp,
  resolveCombatWin, MAX_LEVEL, applyPrimitiveAction, startCombat, combatTotals,
} = require('../server.js');

function byName(name) {
  const c = ALL_CARDS.find((x) => x.name === name);
  assert.ok(c, `Karte "${name}" nicht gefunden`);
  return c;
}
function makePlayer(id, extra) {
  return Object.assign({
    id, name: id.toUpperCase(), level: 5, hand: [], races: [], classes: [],
    powerGroups: [], raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), attachments: { cheatedItemId: null },
    isBot: false, connected: true,
  }, extra || {});
}
function makeRoom(players, extra) {
  return Object.assign({
    code: 'T', players, turnIndex: 0, doorDeck: [], doorDiscard: [],
    treasureDeck: [], treasureDiscard: [], revealedDoorCard: null, doorReveal: null,
    dieRoll: null, combat: null, pendingConsequence: null, pendingCardAction: null,
    pendingRoll: null, winner: null, phase: 'playing', logs: [],
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
    settings: { sets: {} },
  }, extra || {});
}
function done(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  if (room.botTimer) clearTimeout(room.botTimer);
  return room;
}

// 1) Ohne SCHUMMELN! bleibt der zweite Grosse Gegenstand verboten
{
  const fels = byName('RIESIGER FELS');
  const mithril = byName('MITHRIL-RÜSTUNG');
  const p = makePlayer('a', { hand: [fels.id, mithril.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, mithril.id);
  handleEquipItem(room, p.id, fels.id);
  assert.ok(!equippedItemIds(p).includes(fels.id), 'ohne Schummeln bleibt es verboten');
  done(room);
}

// 2) Mit SCHUMMELN! auf dem Fels geht es, und die Karte wird verbraucht
{
  const fels = byName('RIESIGER FELS');
  const mithril = byName('MITHRIL-RÜSTUNG');
  const schummeln = byName('SCHUMMELN!');
  const p = makePlayer('a', { hand: [fels.id, mithril.id, schummeln.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, mithril.id);
  handlePlayCheat(room, p.id, schummeln.id, fels.id);
  assert.strictEqual(p.attachments.cheatedItemId, fels.id, 'Anhang muss am Fels haengen');
  handleEquipItem(room, p.id, fels.id);
  assert.ok(equippedItemIds(p).includes(fels.id), 'geschummelter Gegenstand ist anlegbar');
  assert.ok(!p.hand.includes(schummeln.id), 'die Schummeln-Karte selbst ist verbraucht');
  done(room);
}

// 2b) Geschummelt geht auch bei belegtem Platz: beide Haende voll, trotzdem
// laesst sich eine zweihaendige Waffe anlegen - sie landet auf dem
// Spezialplatz und verdraengt nichts (Ruling 2026-09-18).
{
  const schwert = byName('KETTENSÄGE DER BLUTIGEN ZERSTÜCKELUNG'); // braucht zwei Haende
  const schummeln = byName('SCHUMMELN!');
  const hand1 = ALL_CARDS.find((x) => x.slotKind === 'hand' && x.handsCost === 1);
  const hand2 = ALL_CARDS.find((x) => x.slotKind === 'hand' && x.handsCost === 1 && x.id !== hand1.id);
  const p = makePlayer('a', { hand: [hand1.id, hand2.id, schwert.id, schummeln.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, hand1.id);
  handleEquipItem(room, p.id, hand2.id);
  assert.strictEqual(p.equipped.hands.filter(Boolean).length, 2, 'beide Haende sind belegt');

  // Ohne Schummeln bleibt die dritte Waffe liegen.
  handleEquipItem(room, p.id, schwert.id);
  assert.ok(p.hand.includes(schwert.id), 'ohne Schummeln passt nichts mehr in die Haende');

  handlePlayCheat(room, p.id, schummeln.id, schwert.id);
  handleEquipItem(room, p.id, schwert.id);
  assert.ok(equippedItemIds(p).includes(schwert.id), 'geschummelt geht es trotz voller Haende');
  assert.ok((p.equipped.special || []).includes(schwert.id), 'und zwar auf dem Spezialplatz');
  assert.deepStrictEqual(p.equipped.hands, [hand1.id, hand2.id], 'die belegten Haende bleiben unangetastet');
  done(room);
}

// 2c) Eine geschummelte Ruestung liegt auf dem Spezialplatz, ist aber
// weiterhin eine Ruestung: die drei Stellen, die sonst direkt in
// player.equipped.armor schauen, muessen sie finden.
// Hilfsfunktion: Ruestung geschummelt anlegen, obwohl schon eine liegt.
function mitGeschummelterRuestung(extra) {
  const echte = byName('MITHRIL-RÜSTUNG');
  const zweite = ALL_CARDS.find((x) => x.slotKind === 'armor' && x.id !== echte.id && (x.bonus || 0) > 0);
  const schummeln = byName('SCHUMMELN!');
  const p = makePlayer('a', Object.assign({ hand: [echte.id, zweite.id, schummeln.id] }, extra || {}));
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, echte.id);
  handlePlayCheat(room, p.id, schummeln.id, zweite.id);
  handleEquipItem(room, p.id, zweite.id);
  assert.ok((p.equipped.special || []).includes(zweite.id), 'die geschummelte Ruestung liegt im Spezialplatz');
  return { p, room, echte, zweite };
}

// MIESER SPIEGEL ("nur Ruestungsboni zaehlen"): der Bonus der geschummelten
// Ruestung zaehlt mit.
{
  const monster = ALL_CARDS.find((x) => x.category === 'monster');
  const spiegelFluch = { cardId: null, name: 'MIESER SPIEGEL', kind: 'noItemBonusExceptArmor', dauer: 'naechsterKampf' };
  const { p, room, echte, zweite } = mitGeschummelterRuestung({ activeCurses: [spiegelFluch] });
  startCombat(room, p.id, [monster.id], {});
  const erwartet = p.level + (echte.bonus || 0) + (zweite.bonus || 0);
  assert.strictEqual(combatTotals(room).playerStrength, erwartet,
    'unter dem Miesen Spiegel zaehlen beide Ruestungen, auch die geschummelte');
  done(room);
}

// RIESENSTINKTIER ("bis du alle Kleidung und Ruestung ablegst"): solange die
// geschummelte Ruestung anliegt, hilft niemand.
{
  const monster = ALL_CARDS.find((x) => x.category === 'monster');
  const stinktier = { cardId: null, name: 'RIESENSTINKTIER', kind: 'noHelpHalfGold', dauer: 'dauerhaft' };
  const { p, room } = mitGeschummelterRuestung({ activeCurses: [stinktier] });
  const helfer = makePlayer('b');
  room.players.push(helfer);
  // Nur die geschummelte Ruestung anlassen - die echte wandert in die Hand.
  handleUnequipItem(room, p.id, room.players[0].equipped.armor);
  startCombat(room, p.id, [monster.id], {});
  handleRequestHelp(room, p.id, helfer.id, 0);
  assert.ok(!room.combat.helperPending, 'mit geschummelter Ruestung am Leib hilft niemand');
  done(room);
}

// "Ruestung verlieren": die Konsequenz findet die geschummelte Ruestung.
{
  const { p, room, echte, zweite } = mitGeschummelterRuestung();
  handleUnequipItem(room, p.id, echte.id); // nur die geschummelte bleibt an
  applyPrimitiveAction(room, p, { type: 'discardSlot', slot: 'armor' });
  assert.ok(!equippedItemIds(p).includes(zweite.id), 'die geschummelte Ruestung ist abgelegt');
  assert.ok(room.treasureDiscard.includes(zweite.id), 'und liegt im Ablagestapel');
  done(room);
}

// 3) Der Anhang gilt nur fuer GENAU EINEN Gegenstand
{
  const fels = byName('RIESIGER FELS');
  const stange = byName('STANGE, 11-FUSS');
  const mithril = byName('MITHRIL-RÜSTUNG');
  const schummeln = byName('SCHUMMELN!');
  const p = makePlayer('a', { hand: [fels.id, stange.id, mithril.id, schummeln.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, mithril.id);
  handlePlayCheat(room, p.id, schummeln.id, fels.id);
  handleEquipItem(room, p.id, fels.id);
  handleEquipItem(room, p.id, stange.id);
  assert.ok(!equippedItemIds(p).includes(stange.id),
    'ein zweiter Grosser Gegenstand ohne eigenen Anhang bleibt verboten');
  done(room);
}

// 4) Der Anhang stirbt mit dem Gegenstand: verkauft, ist der Anhang weg
// (RIESIGER FELS ist 0 Goldstuecke wert - die Trittleiter fuellt den
// Verkauf auf die noetigen 1000 auf, damit ueberhaupt verkauft wird).
{
  const fels = byName('RIESIGER FELS');
  const mithril = byName('MITHRIL-RÜSTUNG');
  const leiter = byName('TRITTLEITER');
  const schummeln = byName('SCHUMMELN!');
  const p = makePlayer('a', { hand: [fels.id, mithril.id, leiter.id, schummeln.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, mithril.id);
  handlePlayCheat(room, p.id, schummeln.id, fels.id);
  handleEquipItem(room, p.id, fels.id);
  handleSellItems(room, p.id, [fels.id, mithril.id, leiter.id]);
  assert.strictEqual(p.attachments.cheatedItemId, null, 'Verkauf loest den Anhang');
  done(room);
}

// 5) Unequip zurueck in die Hand ist NICHT "verlieren" - der Anhang bleibt
{
  const fels = byName('RIESIGER FELS');
  const mithril = byName('MITHRIL-RÜSTUNG');
  const schummeln = byName('SCHUMMELN!');
  const p = makePlayer('a', { hand: [fels.id, mithril.id, schummeln.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, mithril.id);
  handlePlayCheat(room, p.id, schummeln.id, fels.id);
  handleEquipItem(room, p.id, fels.id);
  handleUnequipItem(room, p.id, fels.id);
  assert.strictEqual(p.attachments.cheatedItemId, fels.id, 'noch in der eigenen Hand - kein Verlust');
  // ...und danach wieder anlegbar, ohne erneut zu schummeln.
  handleEquipItem(room, p.id, fels.id);
  assert.ok(equippedItemIds(p).includes(fels.id), 'weiterhin geschummelt anlegbar');
  done(room);
}

// 6) Zweiter Schummel-Versuch wird abgelehnt, solange einer haengt
{
  const fels = byName('RIESIGER FELS');
  const stange = byName('STANGE, 11-FUSS');
  const mithril = byName('MITHRIL-RÜSTUNG');
  const schummeln = byName('SCHUMMELN!');
  const p = makePlayer('a', { hand: [fels.id, stange.id, mithril.id, schummeln.id] });
  const room = makeRoom([p]);
  handlePlayCheat(room, p.id, schummeln.id, fels.id);
  handlePlayCheat(room, p.id, schummeln.id, stange.id); // Karte ist schon verbraucht, greift eh nicht
  assert.strictEqual(p.attachments.cheatedItemId, fels.id, 'bleibt am Fels haengen');
  done(room);
}

// 7) KNIESCHÜTZER DER VERLOCKUNG: höherstufige Person darf nicht ablehnen,
//    kann dafür aber nicht selbst gewinnen (nur die Siegesstufe ist gesperrt).
// BULLROG gibt +1 Bonus-Stufe (MONSTER_EXTRA_LEVEL), damit a mit +2 von
// Stufe 8 auf die Siegesstufe 10 springen wuerde - so kann b (der Helfer)
// hoeherstufig sein (9), ohne selbst schon auf der Siegesstufe zu stehen,
// was das "kein Sieg fuer a"-Ergebnis eindeutig von b's eigenem Stand trennt.
{
  const knieschuetzer = byName('KNIESCHÜTZER DER VERLOCKUNG');
  const bullrog = ALL_CARDS.find((c) => c.name === 'BULLROG');
  assert.ok(bullrog, 'Testmonster BULLROG nicht gefunden');
  const a = makePlayer('a', { level: MAX_LEVEL - 2, hand: [knieschuetzer.id] });
  const b = makePlayer('b', { level: MAX_LEVEL - 1 }); // hoehere Stufe als a, aber nicht am Limit
  const room = makeRoom([a, b], {
    combat: {
      actorId: 'a', helperId: null, helperPending: null, mustFlee: false,
      actorModifier: 0, monsterModifier: 0, treasureDelta: 0, monsterIds: [bullrog.id],
    },
  });
  handleRequestHelp(room, 'a', 'b');
  assert.ok(room.combat.helperPending.compelled, 'a haelt die Karte, b ist hoeherstufig -> genoetigt');
  handleRespondHelp(room, 'b', false); // Ablehnen wird zurueckgewiesen
  assert.strictEqual(room.combat.helperId, 'b', 'b muss trotz Ablehnung helfen');
  assert.strictEqual(room.combat.noWinLevel, true, 'erzwungene Hilfe sperrt die Siegesstufe');
  resolveCombatWin(room);
  assert.strictEqual(a.level, MAX_LEVEL - 1, 'a bleibt unter der Siegesstufe trotz besiegtem Monster');
  assert.notStrictEqual(room.phase, 'gameend', 'kein Sieg fuer a in diesem Kampf');
  done(room);
}

// 8) Ohne Nötigung (Ziel ist nicht höherstufig) bleibt Ablehnen erlaubt, und
//    ein regulärer Sieg wird nicht durch die Karte blockiert.
{
  const knieschuetzer = byName('KNIESCHÜTZER DER VERLOCKUNG');
  const bullrog = ALL_CARDS.find((c) => c.name === 'BULLROG');
  const a = makePlayer('a', { level: MAX_LEVEL - 2, hand: [knieschuetzer.id] });
  const b = makePlayer('b', { level: 1 }); // niedriger als a -> keine Noetigung
  const room = makeRoom([a, b], {
    combat: {
      actorId: 'a', helperId: null, helperPending: null, mustFlee: false,
      actorModifier: 0, monsterModifier: 0, treasureDelta: 0, monsterIds: [bullrog.id],
    },
  });
  handleRequestHelp(room, 'a', 'b');
  assert.ok(!room.combat.helperPending.compelled, 'b ist nicht hoeherstufig -> keine Noetigung');
  handleRespondHelp(room, 'b', false);
  assert.strictEqual(room.combat.helperId, null, 'echtes Ablehnen bleibt moeglich');
  assert.strictEqual(room.combat.noWinLevel, undefined, 'keine Sperre ohne Noetigung');
  resolveCombatWin(room);
  assert.strictEqual(a.level, MAX_LEVEL, 'regulaerer Sieg bleibt moeglich');
  assert.strictEqual(room.winner, 'a', 'a gewinnt das Spiel');
  done(room);
}

// 9) Regression (Fix Round 1): "VERLIERE ZWEI KARTEN" (giveHandCardsToNeighbors)
// verschenkt eine zufaellige Handkarte an eine Nachbarperson, OHNE ueber
// discardCard() zu laufen - ein dritter Transferweg neben Diebstahl/Handel,
// der den Anhang zuvor nicht geloest hat. Deterministisch gemacht: genau
// EINE Handkarte (der Zufallsindex trifft also immer sie) und genau EINE
// Nachbarperson (zwei Spieler:innen am Tisch -> nur die (idx+1)-Richtung
// feuert).
{
  const fels = byName('RIESIGER FELS');
  const stange = byName('STANGE, 11-FUSS');
  const schummelnKarten = ALL_CARDS.filter((x) => x.name === 'SCHUMMELN!');
  assert.ok(schummelnKarten.length >= 2, 'braucht mindestens zwei SCHUMMELN!-Instanzen (versch. Sets)');
  const [schummeln, schummeln2] = schummelnKarten;
  const a = makePlayer('a', { hand: [fels.id, schummeln.id] });
  const b = makePlayer('b', { hand: [] });
  const room = makeRoom([a, b]);
  handlePlayCheat(room, a.id, schummeln.id, fels.id);
  assert.strictEqual(a.attachments.cheatedItemId, fels.id, 'Anhang haengt zunaechst am Fels');
  // Nur noch der Fels ist auf der Hand -> giveHandCardsToNeighbors muss
  // genau ihn verschenken.
  assert.deepStrictEqual(a.hand, [fels.id]);
  applyPrimitiveAction(room, a, { type: 'giveHandCardsToNeighbors' });
  assert.ok(b.hand.includes(fels.id), 'b hat den Fels jetzt (Nachbarin erhaelt die Karte)');
  assert.ok(!a.hand.includes(fels.id), 'a hat den Fels nicht mehr');
  assert.strictEqual(a.attachments.cheatedItemId, null,
    'Anhang muss geloest sein, sobald der geschummelte Gegenstand die Besitzerin verliert');
  // Ohne den Fix waere a hier dauerhaft gesperrt (der Guard in handlePlayCheat
  // haette weiterhin cheatedItemId gesetzt gesehen). Neuer Gegenstand
  // (STANGE statt FELS), damit keine Karten-ID gleichzeitig in zwei Haenden
  // steht.
  a.hand.push(schummeln2.id, stange.id);
  handlePlayCheat(room, a.id, schummeln2.id, stange.id);
  assert.strictEqual(a.attachments.cheatedItemId, stange.id,
    'nach dem Verlust kann erneut geschummelt werden');
  done(room);
}

console.log('OK - Kartenanhaenge: Schummeln hebt genau eine Regel fuer genau einen Gegenstand auf, Knieschuetzer erzwingt Hilfe ohne die eigene Siegesstufe.');
console.log('1/1 Tests erfolgreich (card-attachments.test.js).');
