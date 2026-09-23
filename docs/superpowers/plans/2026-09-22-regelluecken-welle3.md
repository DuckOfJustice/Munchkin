# Regellücken Welle 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monster-Verstärker hängen am Monster statt am Kampf, und die Klasse BARDE bekommt ihre beiden Kräfte („Verzaubern" neu, „Bardenglück" vervollständigt).

**Architecture:** Der Kampf bekommt eine Liste `room.combat.enhancers` (`{ cardId, monsterId }`) und verliert `enhancerIds`/`enhancerBonus`/`enhancerTreasure`; alle Leser rechnen aus der Liste. Die Barden-Kräfte nutzen vorhandene Bausteine: Wurf-Fenster (`wurfMitFenster`/`rollWithWindow`), erzwungene Hilfe (`helperPending.compelled`) und den Kartenwähler (`openCardChoice`).

**Tech Stack:** Node.js (CommonJS), Express + Socket.IO; Tests mit `assert` über `node tests/<datei>.test.js` bzw. `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-22-regelluecken-welle3-design.md`

## Global Constraints

- Code, Kommentare, Commit-Messages, Log- und UI-Texte auf Deutsch (Kommentare im Umfeld schreiben Umlaute als ae/oe/ue, Logtexte mit Umlauten).
- Kartennamen exakt wie in `data/cards.json`.
- TDD: erst der Test, Test schlägt fehl, dann der Code.
- `npm test` grün am Ende jeder Task. `tests/basic-game-flow.test.js` ist zufallsabhängig und scheitert selten mit „kein einziger Kampf" – einzeln wiederholen, bevor ein Fehler vermutet wird.
- Dateien haben teils CRLF-Zeilenenden: mehrzeilige Ersetzungen per Skript schlagen fehl – Edit-Werkzeug benutzen.
- Zeilennummern sind Näherungen; Funktionen über ihren Namen suchen.
- Commits enden mit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WxCuD1KsFNquy8741xvETq
  ```
- Branch: `fix/welle3-barde-verstaerker` (existiert, basiert auf `origin/main` = 1915291).
- `combatSignature` (server.js, liest u. a. `monsterModifier`) muss jede neue Kampfzahl mitlesen, sonst bleibt ein veralteter „Bereit"-Status stehen.

---

### Task 1: Verstärker hängen am Monster

**Files:**
- Create: `tests/card-regelluecken-welle3.test.js`
- Modify: `server.js` – `startCombat` (Kampfobjekt), `handlePlayCombatCard` (Zweig `isMonsterEnhancerCard`), `combatTotals`, `combatSignature`, `combatHasUndead`, `monsterTraitBonusSum`-Umfeld nur wo nötig, `applyCombatReaction` (`duplicateMonster`, `replaceMonsterFromHand`), `applyPrimitiveAction` (`removeOneMonster`, `endCombatNoLevel`, MAMI/BABY-Zweige), `resolveCombatWin`/`finishCombatWin` (Schatzzuschlag)

**Interfaces:**
- Produces: `room.combat.enhancers: Array<{ cardId, monsterId }>`; Hilfsfunktionen `enhancerBonusFuer(room, monsterId)`, `enhancerBonusSumme(room)`, `enhancerTreasureSumme(room)`, `enhancerKartenIds(room)`.
- Entfällt: `room.combat.enhancerIds`, `enhancerBonus`, `enhancerTreasure`.

- [ ] **Step 1: Testdatei mit den Verstärker-Tests anlegen**

```js
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

fertig();
console.log('card-regelluecken-welle3: alle Checks gruen');
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle3.test.js`
Expected: FAIL bei `bei zwei Monstern wird das Zielmonster gewaehlt` (heute wird der Verstärker ohne Rückfrage kampfweit gutgeschrieben).

- [ ] **Step 3: Kampfobjekt und Hilfsfunktionen**

In `startCombat` die drei Felder `enhancerIds: []`, `enhancerBonus: 0`, `enhancerTreasure: 0` durch ein Feld ersetzen:

```js
    // Gespielte Monster-Verstaerker mit ihrem Zielmonster: { cardId, monsterId }.
    // Verschwindet ein Monster, verschwinden seine Verstaerker mit ihm - die
    // ILLUSION sagt das ausdruecklich ("zusammen mit allen Karten, die
    // gespielt wurden, um es zu veraendern").
    enhancers: [],
```

Neben `combatHasUndead` (server.js ~3570) die Hilfsfunktionen ergänzen:

```js
// Verstaerker-Eintraege, deren Monster noch im Kampf steht.
function aktiveEnhancers(room) {
  const c = room.combat;
  if (!c) return [];
  return (c.enhancers || []).filter((e) => c.monsterIds.includes(e.monsterId));
}
// Kartenbonus eines Verstaerkers - GIGANTISCH auf dem FUNGUS ("+25 statt +10")
// und der RAPIER-TROTTEL ("doppelter Effekt") haengen am Zielmonster.
function enhancerBonusEintrag(room, eintrag) {
  const karte = card(eintrag.cardId);
  const ziel = card(eintrag.monsterId);
  if (!karte || !ziel) return 0;
  if (karte.name === 'GIGANTISCH' && ziel.name === 'FUNGUS') return 25;
  if (ziel.name === 'RAPIER-TROTTEL') return (karte.bonus || 0) * 2;
  return karte.bonus || 0;
}
// Summe der Verstaerker eines Monsters. monsterIds kann dieselbe Id zweimal
// enthalten (KUMPEL: "ein weiteres Monster mit den gleichen Verstaerkern") -
// die Summe wird deshalb je Vorkommen gezaehlt, nicht je Eintrag.
function enhancerBonusSumme(room) {
  const c = room.combat;
  if (!c) return 0;
  return (c.monsterIds || []).reduce((sum, mid) => sum
    + (c.enhancers || []).filter((e) => e.monsterId === mid)
      .reduce((teil, e) => teil + enhancerBonusEintrag(room, e), 0), 0);
}
// Schatzzuschlag der Verstaerker (GIGANTISCH/URALT +2, BABY -1), ebenfalls je
// Vorkommen des Monsters.
function enhancerTreasureSumme(room) {
  const c = room.combat;
  if (!c) return 0;
  return (c.monsterIds || []).reduce((sum, mid) => sum
    + (c.enhancers || []).filter((e) => e.monsterId === mid)
      .reduce((teil, e) => teil + (typeof card(e.cardId).treasureCount === 'number' ? card(e.cardId).treasureCount : 0), 0), 0);
}
// Karten-Ids der noch wirksamen Verstaerker (UNTOT-Pruefung, BABY/MAMI).
function enhancerKartenIds(room) {
  return aktiveEnhancers(room).map((e) => e.cardId);
}
```

- [ ] **Step 4: Verstärker mit Zielwahl spielen**

Im Zweig `if (isMonsterEnhancerCard(c))` in `handlePlayCombatCard` den Block ab `const trottel = ...` bis vor `room.doorDiscard.push(cardId);` ersetzen. Neuer Ablauf: bei mehreren Monstern erst wählen, dann anwenden.

```js
  if (isMonsterEnhancerCard(c)) {
    removeFromHand(player, cardId);
    // Bei mehreren Monstern muss gesagt werden, welches verstaerkt wird
    // (gleiche Bauform wie die Monster-Wahl der MAGISCHEN LAMPE).
    if (room.combat.monsterIds.length > 1) {
      room.doorDiscard.push(cardId);
      openCardChoice(room, player, c.name, [...new Set(room.combat.monsterIds)].map((mId) => ({
        id: `verstaerker-${mId}`,
        label: `Auf "${card(mId).name}" spielen`,
        action: { type: 'verstaerkerAufMonster', cardId, monsterId: mId },
      })));
      room.pendingCardAction.sourceCardId = cardId;
      log(room, `${player.name} spielt "${c.name}" im Kampf - Zielmonster nötig.`, [cardId]);
      announceCardPlay(room, player, cardId, 'Zielmonster wird noch gewählt');
      touchRoom(room);
      return;
    }
    room.doorDiscard.push(cardId);
    applyPrimitiveAction(room, player, { type: 'verstaerkerAufMonster', cardId, monsterId: room.combat.monsterIds[0] });
    touchRoom(room);
    return;
  }
```

Neues Primitiv in `applyPrimitiveAction` (neben den übrigen Kampf-Primitiven):

```js
    case 'verstaerkerAufMonster': {
      const c = room.combat;
      if (!c || !c.monsterIds.includes(action.monsterId)) return 'das Monster ist nicht mehr im Kampf';
      c.enhancers = (c.enhancers || []).concat({ cardId: action.cardId, monsterId: action.monsterId });
      const karte = card(action.cardId);
      const eintrag = { cardId: action.cardId, monsterId: action.monsterId };
      const bonus = enhancerBonusEintrag(room, eintrag);
      const ziel = card(action.monsterId);
      const zusatz = (karte.name === 'GIGANTISCH' && ziel.name === 'FUNGUS') ? ' - der Fungus erhält 25 statt 10'
        : (ziel.name === 'RAPIER-TROTTEL' ? ' - der Rapier-Trottel verdoppelt' : '');
      const delta = typeof karte.treasureCount === 'number' ? karte.treasureCount : 0;
      log(room, `${player.name} spielt "${karte.name}" auf "${ziel.name}" (${bonus >= 0 ? '+' : ''}${bonus}${zusatz}${delta ? `, ${delta >= 0 ? '+' : ''}${delta} Schatz` : ''}).`, [action.cardId]);
      announceCardPlay(room, player, action.cardId, `${bonus >= 0 ? '+' : ''}${bonus} für "${ziel.name}"`);
      // Ein Verstaerker kann Kampfstaerke UND (durch UNTOT) den Untot-Status
      // aendern - beides muss den Bereit-Status zuruecksetzen.
      refreshCombatReady(room);
      return `${bonus >= 0 ? '+' : ''}${bonus} für "${ziel.name}"`;
    }
```

- [ ] **Step 5: Leser umstellen**

Alle Stellen, die `enhancerBonus`, `enhancerTreasure` oder `enhancerIds` lesen, auf die neuen Funktionen umstellen (mit `grep -n "enhancer" server.js` finden):

- `combatTotals`: `monsterStrength` addiert `enhancerBonusSumme(room)` zusätzlich zu `monsterModifier` (der Verstärker-Anteil steckt nicht mehr in `monsterModifier`).
- `combatSignature`: `enhancerBonusSumme(room)` mit in die Signatur aufnehmen, damit ein neuer Verstärker den Bereit-Status zurücksetzt.
- `combatHasUndead` und der BABY-Zweig: `enhancerKartenIds(room)` statt `c.enhancerIds`.
- MAMI (`mamiBonus`): `enhancerBonusSumme(room)` statt der eigenen Reduce-Schleife über `enhancerIds`.
- KUMPEL (`duplicateMonster`): die Zeilen, die `c.monsterModifier += (c.enhancerBonus || 0)` und `c.treasureDelta += c.enhancerTreasure` nachziehen, ersatzlos streichen – die Verdopplung ergibt sich jetzt aus dem zweiten Vorkommen der Monster-Id.
- Schatzzuschlag beim Sieg: `treasureDelta` speist sich für Verstärker aus `enhancerTreasureSumme(room)`; andere Quellen von `treasureDelta` (z. B. Karten ohne Monsterbezug) bleiben wie sie sind.
- `removeOneMonster` / `replaceMonsterFromHand` / `endCombatNoLevel`: die heutigen `ponytail:`-Kommentare über den kampfweiten Anteil streichen und stattdessen einen Satz schreiben, dass die Verstärker des entfernten Monsters mit ihm wegfallen. Code muss dort nichts tun – die Summen rechnen über `monsterIds`.

- [ ] **Step 6: Tests grün, volle Suite, Commit**

Run: `node tests/card-regelluecken-welle3.test.js` → grün; `npm test` → alle erfolgreich. Bestehende Tests, die `enhancerIds`/`enhancerBonus` setzen oder lesen (mit `grep -rn "enhancer" tests/` finden), auf die neue Liste umstellen – die geprüfte Wirkung muss dieselbe bleiben.

```bash
git add server.js tests/card-regelluecken-welle3.test.js
git commit -m "fix: Monster-Verstaerker haengen am Monster statt am Kampf"
```

---

### Task 2: Kartenwirkungen am Zielmonster schärfen

**Files:**
- Modify: `server.js` (FUNGUS/GIGANTISCH-Prüfung in `src/cards/consequences.js`-Aufrufkette, `combatHasUndead`-Nutzung), `src/cards/consequences.js` (Eintrag `'FUNGUS'`)
- Test: `tests/card-regelluecken-welle3.test.js`

**Interfaces:**
- Consumes: `aktiveEnhancers`, `enhancerKartenIds` aus Task 1.

- [ ] **Step 1: Tests anhängen (vor `fertig();`)**

```js
// --- GIGANTISCH zaehlt nur fuer sein eigenes Monster -------------------------
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
  const bones = findCard('MR. BONES', 'monster');
  const p = makePlayer({ hand: [untot.id] });
  const room = makeRoom([p]);
  S.startCombat(room, 'p1', [goblin.id, bones.id], { fromHand: false });
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
// --- Gigantischer FUNGUS verdoppelt die Schlimmen Dinge nur als sein Verstaerker
{
  const fungus = findCard('FUNGUS', 'monster');
  const quelle = (verstaerker) => ({ name: 'FUNGUS', text: fungus.badstuff, verstaerker });
  const p = makePlayer();
  const spec = (v) => S.resolveConsequenceSpec('FUNGUS', fungus.badstuff, p, makeRoom([p]), quelle(v));
  assert.strictEqual(spec(['GIGANTISCH']).amount, 2, 'mit GIGANTISCH doppelt');
  assert.strictEqual(spec([]).amount, 1, 'ohne GIGANTISCH einfach');
}
```

Hinweis: Der letzte Block prüft den Stand von PR #16 (`quelle.verstaerker`); ist die Signatur im Branch anders, den Block an die vorhandene Form anpassen und im Report nennen.

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle3.test.js`
Expected: FAIL bei `GIGANTISCH auf einem anderen Monster: gedruckter Bonus` oder beim UNTOT-Block (je nachdem, was Task 1 schon abdeckt). Deckt Task 1 alles ab, Step 3 überspringen und das im Report festhalten.

- [ ] **Step 3: Restliche Prüfungen umstellen**

`combatHasUndead`: nur noch `enhancerKartenIds(room)` (und die Monster selbst) prüfen – kein `c.enhancerIds` mehr.

Die Quelle der Schlimmen Dinge (`oeffneVerlustKonsequenz`, Feld `verstaerker`) liefert künftig nur die Verstärker des jeweiligen Monsters:

```js
  const sources = monsters.map((m) => ({
    name: m.name, text: m.badstuff,
    // Nur die Verstaerker DIESES Monsters - GIGANTISCH auf einem anderen
    // Monster verdoppelt den Fungus nicht.
    verstaerker: (c.enhancers || []).filter((e) => e.monsterId === m.id).map((e) => (card(e.cardId) || {}).name).filter(Boolean),
  }));
```

- [ ] **Step 4: Tests grün, volle Suite, Commit**

Run: `node tests/card-regelluecken-welle3.test.js` → grün; `npm test` → alle erfolgreich.

```bash
git add server.js src/cards/consequences.js tests/card-regelluecken-welle3.test.js
git commit -m "fix: GIGANTISCH, UNTOT und der Rapier-Trottel wirken nur auf ihrem Zielmonster"
```

---

### Task 3: BARDE „Verzaubern"

**Files:**
- Modify: `server.js` – neue Funktionen `bardenVerzauberInfo`, `handleBardeVerzaubern`; Socket-Handler; `finishCombatWin` (kein Spielsieg); `yourInfo`-Zusammenstellung (dort, wo `classCombatPowerInfo` eingehängt ist); `module.exports`
- Modify: `public/client.js` – Knopf im Kampf-Panel
- Test: `tests/card-regelluecken-welle3.test.js`

**Interfaces:**
- Produces: `handleBardeVerzaubern(room, playerId, cardId, targetId)`; Socket-Event `bardeVerzaubern` mit `{ cardId, targetId }`; `room.combat.bardenZwang` (boolean).

- [ ] **Step 1: Tests anhängen (vor `fertig();`)**

```js
// --- BARDE "Verzaubern": Karte abwerfen, beide wuerfeln, hoeherer Wurf zwingt
// zur Hilfe ("kann keine Belohnung verlangen").
{
  const barde = findCard('BARDE');
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const karte = ALL_CARDS.find((c) => c.type === 'treasure').id;
  const versuch = (wuerfe) => {
    const a = makePlayer({ id: 'p1', name: 'A', classes: [barde.id], hand: [karte] });
    const b = makePlayer({ id: 'p2', name: 'B' });
    const room = makeRoom([a, b]);
    S.startCombat(room, 'p1', [monster.id], { fromHand: false });
    const zufall = Math.random;
    let i = 0;
    Math.random = () => (wuerfe[i++] - 1) / 6 + 0.01;
    try { S.handleBardeVerzaubern(room, 'p1', karte, 'p2'); } finally { Math.random = zufall; }
    return { a, b, room };
  };
  const erfolg = versuch([6, 1]);
  assert.strictEqual(erfolg.room.combat.helperId, 'p2', 'hoeherer Wurf: der Rivale hilft');
  assert.strictEqual(erfolg.room.combat.helperReward, 0, 'ohne Belohnung');
  assert.ok(!erfolg.a.hand.includes(karte), 'die abgeworfene Karte ist weg');

  const misserfolg = versuch([2, 5]);
  assert.strictEqual(misserfolg.room.combat.helperId, null, 'niedrigerer Wurf: keine Hilfe');
  assert.ok(!misserfolg.a.hand.includes(karte), 'die Karte ist trotzdem weg');

  const gleichstand = versuch([4, 4]);
  assert.strictEqual(gleichstand.room.combat.helperId, null, 'Gleichstand reicht nicht ("besser als seiner")');
}
// Nicht-Barden bekommen die Kraft nicht.
{
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const karte = ALL_CARDS.find((c) => c.type === 'treasure').id;
  const a = makePlayer({ id: 'p1', name: 'A', hand: [karte] });
  const room = makeRoom([a, makePlayer({ id: 'p2', name: 'B' })]);
  S.startCombat(room, 'p1', [monster.id], { fromHand: false });
  S.handleBardeVerzaubern(room, 'p1', karte, 'p2');
  assert.strictEqual(room.combat.helperId, null, 'ohne Barden-Klasse passiert nichts');
  assert.ok(a.hand.includes(karte), 'die Karte bleibt auf der Hand');
}
// "Du kannst das Spiel mit dieser Faehigkeit nicht gewinnen."
{
  const barde = findCard('BARDE');
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const karte = ALL_CARDS.find((c) => c.type === 'treasure').id;
  const a = makePlayer({ id: 'p1', name: 'A', level: 9, classes: [barde.id], hand: [karte] });
  const b = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([a, b]);
  S.startCombat(room, 'p1', [monster.id], { fromHand: false });
  const zufall = Math.random;
  let i = 0;
  Math.random = () => ([6, 1][i++] - 1) / 6 + 0.01;
  try { S.handleBardeVerzaubern(room, 'p1', karte, 'p2'); } finally { Math.random = zufall; }
  S.resolveCombatWin(room);
  assert.strictEqual(a.level, 10, 'die Stufe steigt trotzdem');
  assert.strictEqual(room.winner, null, 'aber der Sieg zaehlt nicht als Spielsieg');
}
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle3.test.js`
Expected: FAIL mit `S.handleBardeVerzaubern is not a function`.

- [ ] **Step 3: Implementieren**

In `server.js` neben `classCombatPowerInfo`:

```js
// BARDE "Verzaubern": "Im Kampf kannst du in deinem Zug eine Karte abwerfen
// und einen Rivalen waehlen. Ihr wuerfelt beide, wenn dein Wurf besser ist als
// seiner, muss er dir helfen und kann keine Belohnung verlangen." Ein Versuch
// pro Aufruf - "bis du Erfolg hast, aufgibst oder dir die Karten oder Gegner
// ausgehen" ergibt sich daraus, dass man erneut klicken darf.
function bardenVerzauberInfo(room, player) {
  const c = room.combat;
  if (!c || !player || c.actorId !== player.id) return null;
  const dran = currentPlayer(room);
  if (!dran || dran.id !== player.id) return null;       // "in deinem Zug"
  if (!hasClass(player, 'BARDE') || c.helperId || c.helperPending) return null;
  if (!player.hand.length) return null;
  const rivalen = room.players.filter((p) => p.id !== player.id && p.connected)
    .map((p) => ({ id: p.id, name: p.name }));
  return rivalen.length ? { rivalen } : null;
}

function handleBardeVerzaubern(room, playerId, cardId, targetId) {
  const player = findPlayer(room, playerId);
  const ziel = findPlayer(room, targetId);
  if (!player || !ziel || !bardenVerzauberInfo(room, player)) return;
  if (!player.hand.includes(cardId) || ziel.id === player.id) return;
  if (room.pendingRoll || room.pendingCardAction) return; // keine offene Wahl ueberschreiben
  removeFromHand(player, cardId);
  discardCard(room, cardId);
  log(room, `${player.name} (Barde) wirft "${card(cardId).name}" ab und versucht, ${ziel.name} zu verzaubern.`, [cardId]);
  rollWithWindow(room, player, 'verzaubern', (wurfBarde) => {
    rollWithWindow(room, ziel, 'verzaubern', (wurfZiel) => {
      if (wurfBarde > wurfZiel) {
        const c = room.combat;
        if (!c) return;
        c.helperId = ziel.id;
        c.helperReward = 0;
        c.bardenZwang = true; // "Du kannst das Spiel mit dieser Faehigkeit nicht gewinnen."
        log(room, `Verzaubert: ${wurfBarde} gegen ${wurfZiel} - ${ziel.name} muss ${player.name} helfen (ohne Belohnung).`);
        zaubercouchFragenFallsVorhanden(room, ziel);
        refreshCombatReady(room);
      } else {
        log(room, `Der Zauber misslingt: ${wurfBarde} gegen ${wurfZiel}. ${player.name} darf es erneut versuchen.`);
      }
      touchRoom(room);
    });
  });
  touchRoom(room);
}
```

Hinweis zu `zaubercouchFragenFallsVorhanden`: Diese Funktion gibt es auf diesem Branch NICHT (sie kommt aus PR #17). Die Zeile deshalb weglassen; falls PR #17 vorher gemergt wird, im Report vermerken, dass dort `zaubercouchFragen(ziel)` ergänzt werden muss.

`finishCombatWin`: die Stelle, an der der Sieg geprüft wird (`let won = checkWin(room, actor);`), um den Merker erweitern:

```js
  // BARDE "Verzaubern": "Du kannst das Spiel mit dieser Faehigkeit nicht
  // gewinnen." Die Stufe steigt, der Spielsieg faellt aus.
  let won = c.bardenZwang ? false : checkWin(room, actor);
  if (c.bardenZwang && actor.level >= MAX_LEVEL) {
    log(room, `${actor.name} erreicht Stufe 10 - aber mit erzwungener Hilfe des Barden zählt das nicht als Sieg.`);
  }
```

(Der Variablenname des Kampfes an dieser Stelle heißt `c`; vor dem Schreiben prüfen und übernehmen.)

Socket-Handler neben den übrigen:

```js
  onSafe(socket, 'bardeVerzaubern', ({ cardId, targetId }) => act(socket, (room, pid) => handleBardeVerzaubern(room, pid, cardId, targetId)));
```

`bardenVerzauberInfo` dort in `yourInfo` eintragen, wo `classCombatPowerInfo` steht (Feldname `bardeVerzaubern`), und `handleBardeVerzaubern` in `module.exports` aufnehmen.

- [ ] **Step 4: Client**

`public/client.js`, im Kampf-Panel bei den übrigen Klassenkraft-Knöpfen: wenn `myInfo.bardeVerzaubern` gesetzt ist, je Rivale ein Knopf „Verzaubern: <Name> (1 Karte abwerfen)". Die abzuwerfende Karte ist die zuerst ausgewählte Handkarte – gibt es dafür kein Muster im Client, stattdessen einen Knopf je Rivale anzeigen und die erste Handkarte verwenden, und das im Report festhalten. Text auf Deutsch, Namen mit `escapeHtml()`.

- [ ] **Step 5: Tests grün, volle Suite, Commit**

Run: `node tests/card-regelluecken-welle3.test.js` → grün; `npm test` → alle erfolgreich (inkl. `malformed-input.test.js` – der neue Handler muss Müll überstehen).

```bash
git add server.js public/client.js tests/card-regelluecken-welle3.test.js
git commit -m "feat: BARDE 'Verzaubern' - Karte abwerfen, wuerfeln, Hilfe erzwingen"
```

---

### Task 4: BARDE „Bardenglück" – Abwerfen

**Files:**
- Modify: `server.js` – die Stelle in `finishCombatWin`, die heute nur `log(room, 'Bardenglück: ... wirft dafür sofort 1 beliebige Karte ab.')` schreibt
- Test: `tests/card-regelluecken-welle3.test.js`

- [ ] **Step 1: Tests anhängen (vor `fertig();`)**

```js
// --- BARDE "Bardenglueck": Extraschatz, dann sofort eine beliebige Karte
// abwerfen ("Sieh sie dir alle an und wirf sofort einen ab").
{
  const barde = findCard('BARDE');
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const a = makePlayer({ id: 'p1', name: 'A', level: 9, classes: [barde.id] });
  const room = makeRoom([a]);
  S.startCombat(room, 'p1', [monster.id], { fromHand: false });
  S.resolveCombatWin(room);
  assert.ok(room.pendingCardAction, 'die Abwurf-Wahl oeffnet sich');
  assert.strictEqual(room.pendingCardAction.playerId, 'p1');
  const vorher = a.hand.length;
  const wahl = room.pendingCardAction.candidateIds ? room.pendingCardAction.candidateIds[0]
    : room.pendingCardAction.options[0].id;
  if (room.pendingCardAction.candidateIds) S.handleResolveCardCardChoice(room, 'p1', wahl);
  else S.handleResolveCardChoice(room, 'p1', wahl);
  assert.strictEqual(a.hand.length, vorher - 1, 'genau eine Karte ist abgeworfen');
  assert.strictEqual(room.pendingCardAction, null, 'die Wahl ist geschlossen');
}
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle3.test.js`
Expected: FAIL bei `die Abwurf-Wahl oeffnet sich` (heute nur eine Logzeile).

- [ ] **Step 3: Implementieren**

In `finishCombatWin` die Logzeile für „Bardenglück" um einen Kartenwähler über die ganze Hand ergänzen (nachdem die Beute auf der Hand liegt):

```js
  if (hasClass(actor, 'BARDE') && actor.hand.length) {
    // "Sieh sie dir alle an und wirf sofort einen ab (beliebig)" - die Wahl
    // geht ueber die GANZE Hand, nicht nur ueber die frische Beute.
    openQueuedCardAction(room, 'BARDENGLÜCK', [actor.id], () => ({
      kind: 'chooseCard', prompt: 'Bardenglück: eine Karte abwerfen',
      candidateIds: actor.hand.slice(), discardOwn: true,
    }));
  }
```

Vor dem Schreiben prüfen, ob an dieser Stelle schon ein `pendingCardAction` offen sein kann (Beute-Animation, TROJANISCHER PFERD); `openQueuedCardAction` reiht sich in dem Fall ein – das ist gewollt. Die bisherige reine Logzeile bleibt als Ankündigung stehen oder entfällt, je nachdem, was im Verlauf lesbarer ist.

- [ ] **Step 4: Tests grün, volle Suite, Commit**

Run: `node tests/card-regelluecken-welle3.test.js` → grün; `npm test` → alle erfolgreich.

```bash
git add server.js tests/card-regelluecken-welle3.test.js
git commit -m "fix: BARDENGLUECK - der Extraschatz kostet sofort eine Karte"
```

---

### Task 5: Abschluss – Abdeckungs-Scan, Review, PR

- [ ] **Step 1: Abdeckungs-Scan prüfen**

Run: `node tools/coverage-scan.js clericalerrors`
Erwartet: unverändert gegenüber dem Stand vor dieser Welle (die Klassenkarte BARDE galt schon vorher als abgedeckt). Die Ausgabe in den Report schreiben.

- [ ] **Step 2: Code-Review** (superpowers:requesting-code-review, Basis `origin/main`), Befunde prüfen und beheben.

- [ ] **Step 3: Push + PR** auf `DuckOfJustice` pushen, PR gegen `Marmelade1357/Munchkin` `main`. Im PR-Text erwähnen: PR #17 und #18 sind offen; diese Welle berührt sie nicht inhaltlich, beim Mergen aber auf `combatTotals`/`finishCombatWin` achten.
