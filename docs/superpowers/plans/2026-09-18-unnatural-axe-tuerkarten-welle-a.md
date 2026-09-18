# Unnatural Axe, Türkarten Welle A — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die fünf Unnatural-Axe-Türkarten VERFLUCHTER GEGENSTAND, STINKER, NARRENGOLD, TODESANGST und EISKALTES HÄNDCHEN (KLEINE FREUNDIN) laufen vollständig.

**Architecture:** Kein neues Zustandssystem. Drei Karten bekommen Einträge in der vorhandenen Tabelle `LINGERING_CURSES` (`src/cards/reactions.js`) und wirken über `player.activeCurses`; VERFLUCHTER GEGENSTAND bekommt ein eigenes Primitiv, das die Id des betroffenen Gegenstands am Tracker-Eintrag ablegt; die Händchen-Karte bekommt einen `SPECIAL_SLOT_ITEMS`-Eintrag.

**Tech Stack:** Node.js ohne Framework, `node:assert`, Tests als eigenständige Skripte unter `tests/*.test.js`, Runner `node tests/run.js`.

**Spec:** `docs/superpowers/specs/2026-09-18-unnatural-axe-tuerkarten-welle-a-design.md`

## Global Constraints

- Kommentare, Logzeilen und Commit-Nachrichten auf Deutsch, wie im ganzen Repo.
- Logzeilen im Spielverlauf nennen immer den echten Grund; ein stummes `return` ohne `log(...)` ist in dieser Runde nicht zulässig.
- Jede Sperre folgt der Bauform `log(room, ...); touchRoom(room); return;`.
- Kein neues npm-Paket.
- Nach jeder Implementierung läuft die **gesamte** Suite: `node tests/run.js`, erwartet `27/27` (ab Task 1: `28/28`).
- TDD ist Pflicht: Test schreiben, rot sehen, minimal implementieren, grün sehen, committen.
- Commit-Nachrichten enden mit den zwei Attributionszeilen, die das Repo seit `b381bc6` benutzt:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` und `Claude-Session: https://claude.ai/code/session_01FZTpsw8Cya9C5YcNeworLC`.

---

### Task 1: Testdatei anlegen und EISKALTES HÄNDCHEN (KLEINE FREUNDIN) anlegbar machen

**Files:**
- Create: `tests/card-unnatural-doors.test.js`
- Modify: `src/cards/passives.js` (Tabelle `SPECIAL_SLOT_ITEMS`, am Ende vor der schließenden Klammer)

**Interfaces:**
- Consumes: nichts.
- Produces: die Testdatei mit den Helfern `findCard(name, category)`, `makePlayer(overrides)`, `makeRoom(players)` und dem Array `raeume`, die alle späteren Tasks benutzen.

- [ ] **Step 1: Write the failing test**

Neue Datei `tests/card-unnatural-doors.test.js`:

```js
// Unnatural Axe, Tuerkarten Welle A (Plan 2026-09-18, Spec gleichen Datums).
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, combatTotals, handleEquipItem, equippedItemIds,
  istGrosserGegenstand,
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
    code: 'TEST', players, turnIndex: 0, turnPhase: 'ausruesten',
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
    itemAttachments: {}, logs: [], combat: null, combatHappenedThisTurn: false,
    pendingConsequence: null, pendingCardAction: null, pendingRoll: null,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  };
  raeume.push(room);
  return room;
}

// --- EISKALTES HÄNDCHEN (KLEINE FREUNDIN) -----------------------------------
// Eigene Deckkarte neben der Monsterkarte: "Gegenstand, der +3 Bonus um Kampf
// gibt". In den Rohdaten ohne slotKind, deshalb ueber SPECIAL_SLOT_ITEMS.
{
  const haendchen = findCard('EISKALTES HÄNDCHEN (KLEINE FREUNDIN)');
  const monster = ALL_CARDS.find((x) => x.category === 'monster');
  const p = makePlayer({ hand: [haendchen.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, haendchen.id);
  assert.ok(equippedItemIds(p).includes(haendchen.id), 'die kleine Freundin ist anlegbar');
  assert.ok(!istGrosserGegenstand(room, haendchen.id), 'sie ist ein kleiner Gegenstand');

  const ohne = makePlayer({ id: 'p9', name: 'B', level: p.level });
  const raumOhne = makeRoom([ohne]);
  const kampf = (r, wer) => {
    r.combat = { actorId: wer.id, helperId: null, monsterIds: [monster.id],
      actorModifier: 0, monsterModifier: 0, backstabs: {}, mustFlee: false };
    return combatTotals(r).playerStrength;
  };
  assert.strictEqual(kampf(room, p) - kampf(raumOhne, ohne), 3, 'sie gibt +3 im Kampf');
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-unnatural-doors: ok');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL mit `AssertionError: die kleine Freundin ist anlegbar` — `handleEquipItem` steigt bei einer `door_other`-Karte ohne `slotKind` und ohne Spezialslot-Regel wortlos aus.

- [ ] **Step 3: Write minimal implementation**

In `src/cards/passives.js`, in `SPECIAL_SLOT_ITEMS` direkt hinter dem Eintrag `'EISKALTES HÄNDCHEN'`:

```js
    // Die Deck-Karte zur besaenftigten Monsterseite: eigener Kartentext
    // ("Gegenstand, der +3 Bonus um Kampf gibt"), eigener Eintrag. Anders als
    // bei der Monsterkarte steht der Bonus hier im bonus-Feld der Rohdaten,
    // deshalb kein `bonus` an der Regel.
    'EISKALTES HÄNDCHEN (KLEINE FREUNDIN)': { slot: 'special' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js` → `card-unnatural-doors: ok`
Run: `node tests/run.js` → `28/28 Tests erfolgreich.`

- [ ] **Step 5: Commit**

```bash
git add tests/card-unnatural-doors.test.js src/cards/passives.js
git commit -m "Kleine Freundin ist anlegbar"
```

---

### Task 2: Tracker-Einträge für STINKER, NARRENGOLD, TODESANGST

**Files:**
- Modify: `src/cards/reactions.js` (Tabelle `LINGERING_CURSES`)
- Modify: `src/cards/consequences.js` (Set `DOOR_OTHER_AS_CURSE`)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: Testhelfer aus Task 1.
- Produces: die drei Wirkungsarten `noHelp`, `noCombatTreasure`, `fearUndead` in `player.activeCurses`. Alle späteren Tasks lesen genau diese Strings.

- [ ] **Step 1: Write the failing test**

In `tests/card-unnatural-doors.test.js` vor der `raeume.forEach`-Zeile einfügen; den Import oben um `addActiveCurse` und `DOOR_OTHER_AS_CURSE` erweitern:

```js
// --- Tracker-Eintraege ------------------------------------------------------
{
  const faelle = [
    { name: 'STINKER', kind: 'noHelp', dauer: 'naechsterKampf' },
    { name: 'NARRENGOLD', kind: 'noCombatTreasure', dauer: 'naechsterKampf' },
    { name: 'TODESANGST', kind: 'fearUndead', dauer: 'dauerhaft' },
  ];
  faelle.forEach(({ name, kind, dauer }) => {
    const karte = findCard(name);
    const p = makePlayer({});
    const room = makeRoom([p]);
    addActiveCurse(room, p, name, karte.id);
    const eintrag = p.activeCurses.find((f) => f.kind === kind);
    assert.ok(eintrag, `${name} traegt ${kind} ein`);
    assert.strictEqual(eintrag.dauer, dauer, `${name}: Dauer ${dauer}`);
    assert.ok(eintrag.hinweis, `${name}: Hinweistext fuer die Anzeige`);
  });
  // TODESANGST wirkt beim Ziehen und ist aus der Hand spielbar - beides haengt
  // an derselben Mitgliedschaft (siehe handlePlayCurseFromHand).
  assert.ok(DOOR_OTHER_AS_CURSE.has('TODESANGST'), 'TODESANGST gilt als Fluch');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL mit `AssertionError: STINKER traegt noHelp ein` — `addActiveCurse` findet keine Regel und tut nichts.

- [ ] **Step 3: Write minimal implementation**

In `src/cards/reactions.js`, in `LINGERING_CURSES` hinter dem `ZWERGENBIER`-Eintrag:

```js
    // "Niemand hilft dir in deinem naechsten Kampf." Wer waehrend eines
    // Kampfes verflucht wird, bekommt den Eintrag fuer DIESEN Kampf: die
    // Dauer 'naechsterKampf' laeuft am Ende des laufenden Kampfes ab
    // (clearNextCombatCurses), der Kartentext will genau das.
    'STINKER': { kind: 'noHelp', dauer: 'naechsterKampf',
      hinweis: 'Im nächsten Kampf hilft dir niemand.' },
    // "Du erhaeltst keinen Schatz im naechsten Kampf." Sperrt NUR die
    // Kampfbeute - nicht jede Schatzkarte (das ist die Stoererliste des
    // Weihnachtsmanns, kind 'noTreasure').
    'NARRENGOLD': { kind: 'noCombatTreasure', dauer: 'naechsterKampf',
      hinweis: 'Im nächsten Kampf gibt es für dich keinen Schatz.' },
    // "Du hast Angst vor den Untoten." Dauerhaft - der Kartentext nennt kein
    // Ende, nur der WUNSCHRING beendet ihn.
    'TODESANGST': { kind: 'fearUndead', dauer: 'dauerhaft',
      hinweis: 'Angst vor Untoten: du hilfst nicht gegen sie, und gegen Untote hilft dir niemand.' },
```

In `src/cards/consequences.js`, im Set `DOOR_OTHER_AS_CURSE` in der Zeile mit `'HUHN AUF DEINEM KOPF', 'NARRENGOLD',` das Wort `'TODESANGST',` ergänzen:

```js
    'HUHN AUF DEINEM KOPF', 'NARRENGOLD', 'TODESANGST',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js` → ok
Run: `node tests/run.js` → `28/28 Tests erfolgreich.`

- [ ] **Step 5: Commit**

```bash
git add src/cards/reactions.js src/cards/consequences.js tests/card-unnatural-doors.test.js
git commit -m "Stinker, Narrengold und Todesangst im Fluch-Tracker"
```

---

### Task 3: STINKER sperrt die Hilfe

**Files:**
- Modify: `server.js` (`handleRequestHelp`, `handleRespondHelp`)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: Wirkungsart `noHelp` aus Task 2.
- Produces: `function hatHilfeSperre(player)` → `boolean`, exportiert über `module.exports`.

- [ ] **Step 1: Write the failing test**

Import oben um `startCombat, handleRequestHelp, handleRespondHelp` erweitern, dann:

```js
// --- STINKER: niemand hilft -------------------------------------------------
{
  const monster = ALL_CARDS.find((x) => x.category === 'monster');
  const stinker = findCard('STINKER');
  const p = makePlayer({});
  const helfer = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([p, helfer]);
  addActiveCurse(room, p, 'STINKER', stinker.id);
  startCombat(room, p.id, [monster.id], {});
  handleRequestHelp(room, p.id, helfer.id, 0);
  assert.ok(!room.combat.helperPending, 'unter dem Stinker wird gar nicht erst gefragt');
  assert.ok(room.logs.some((l) => /Stinker/i.test(l.text || l)), 'der Verlauf nennt den Grund');

  // Auch der direkte Weg ueber die Zusage ist dicht.
  room.combat.helperPending = { targetId: helfer.id, compelled: false, reward: 0 };
  handleRespondHelp(room, helfer.id, true);
  assert.strictEqual(room.combat.helperId, null, 'die Zusage kommt nicht zustande');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL mit `AssertionError: unter dem Stinker wird gar nicht erst gefragt` — `helperPending` wird gesetzt.

- [ ] **Step 3: Write minimal implementation**

In `server.js` neben `curseHidesHandItems`:

```js
// STINKER: "Niemand hilft dir in deinem naechsten Kampf."
function hatHilfeSperre(player) {
  return (player.activeCurses || []).some((f) => f.kind === 'noHelp');
}
```

In `handleRequestHelp`, direkt hinter der `stinktierStrafeAktiv(actor)`-Sperre:

```js
  if (hatHilfeSperre(actor)) {
    log(room, `${actor.name} stinkt - in diesem Kampf hilft niemand.`);
    touchRoom(room);
    return;
  }
```

In `handleRespondHelp`, im `if (accept)`-Zweig vor der LUSTMONSTER-Prüfung:

```js
    const bittsteller = findPlayer(room, c.actorId);
    if (bittsteller && hatHilfeSperre(bittsteller)) {
      log(room, `${target.name} kann ${bittsteller.name} nicht helfen - der Stinker hält alle fern.`);
      c.helperPending = null;
      touchRoom(room);
      return;
    }
```

`hatHilfeSperre` in `module.exports` ergänzen (neben `curseHidesHandItems`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js` → ok
Run: `node tests/run.js` → `28/28`

- [ ] **Step 5: Commit**

```bash
git add server.js tests/card-unnatural-doors.test.js
git commit -m "Stinker: keine Hilfe im naechsten Kampf"
```

---

### Task 4: STINKER wirkt sofort — Helfer:in raus, Nasen fliehen

**Files:**
- Modify: `server.js` (`applyLingeringRule`)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `hatHilfeSperre` aus Task 3, `applyCombatPotionAction` (vorhanden), `beendeKampfOhneSieg` (vorhanden).
- Produces: nichts Neues.

- [ ] **Step 1: Write the failing test**

```js
// --- STINKER mitten im Kampf ------------------------------------------------
{
  const monster = ALL_CARDS.find((x) => x.category === 'monster' && x.name !== 'LAUFENDE NASE');
  const nase = findCard('LAUFENDE NASE', 'monster');
  const stinker = findCard('STINKER');
  const p = makePlayer({});
  const helfer = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([p, helfer]);
  room.treasureDeck = ALL_CARDS.filter((x) => x.type === 'treasure').slice(0, 5).map((x) => x.id);
  startCombat(room, p.id, [monster.id, nase.id], {});
  room.combat.helperId = helfer.id;
  const stapelVorher = room.treasureDeck.length;

  addActiveCurse(room, p, 'STINKER', stinker.id);

  assert.strictEqual(room.combat.helperId, null, 'die Helfer:in zieht sich straffrei zurueck');
  assert.ok(!room.combat.monsterIds.includes(nase.id), 'die Laufende Nase fluechtet sofort');
  assert.ok(room.treasureDeck.length < stapelVorher, 'und laesst ihren Schatz da');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL mit `AssertionError: die Helfer:in zieht sich straffrei zurueck` — `applyLingeringRule` kennt `noHelp` nicht.

- [ ] **Step 3: Write minimal implementation**

In `server.js`, in `applyLingeringRule` hinter dem `noTwoHandedItems`-Block:

```js
  // STINKER: "Wenn dir in dem Moment, in dem diese Karte ausgespielt wird,
  // jemand in einem Kampf hilft, zieht er sich straffrei zurueck ... (Aber
  // wenn Laufende Nase oder sein Schatten im Kampf sind, fluechten sie sofort
  // und hinterlassen ihren Schatz.)" Beides nur fuer den Kampf, in dem die
  // verfluchte Person gerade steckt - sonst waere es ein Angriff auf einen
  // fremden Kampf.
  if (regel.kind === 'noHelp' && room.combat
    && combatParticipants(room).some((p) => p.id === player.id)) {
    if (room.combat.helperId) {
      const weg = findPlayer(room, room.combat.helperId);
      room.combat.helperId = null;
      room.combat.helperReward = 0;
      log(room, `${weg ? weg.name : 'Die Helfer:in'} zieht sich straffrei zurück - niemand bleibt neben dem Gestank.`);
      refreshCombatReady(room);
    }
    const NASEN = new Set(['LAUFENDE NASE', 'DIE SCHATTENNASE']);
    [...room.combat.monsterIds].forEach((mid) => {
      const m = card(mid);
      if (!m || !NASEN.has(m.name)) return;
      log(room, `"${m.name}" hält den Gestank nicht aus, flüchtet und lässt den Schatz da.`, [mid]);
      applyCombatPotionAction(room, player, { type: 'removeOneMonster', leavesTreasure: true, name: m.name }, null);
    });
  }
```

Hinweis für die Umsetzung: `applyCombatPotionAction` mit `removeOneMonster` beendet den Kampf über `beendeKampfOhneSieg`, wenn es das letzte Monster war — der `room.combat`-Zugriff in der Schleife muss deshalb auf einer Kopie (`[...room.combat.monsterIds]`) laufen und darf danach `room.combat` nicht mehr voraussetzen.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js` → ok
Run: `node tests/run.js` → `28/28`

- [ ] **Step 5: Commit**

```bash
git add server.js tests/card-unnatural-doors.test.js
git commit -m "Stinker im laufenden Kampf: Helfer:in raus, Nasen fliehen"
```

---

### Task 5: NARRENGOLD — kein Schatz aus dem Kampf

**Files:**
- Modify: `server.js` (`resolveCombatWin`)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: Wirkungsart `noCombatTreasure` aus Task 2.
- Produces: `function hatKampfschatzSperre(player)` → `boolean`, exportiert.

- [ ] **Step 1: Write the failing test**

Import um `resolveCombatWin` erweitern:

```js
// --- NARRENGOLD -------------------------------------------------------------
{
  const monster = ALL_CARDS.find((x) => x.category === 'monster' && (x.treasureCount || 0) > 0);
  const narrengold = findCard('NARRENGOLD');
  const p = makePlayer({});
  const room = makeRoom([p]);
  room.treasureDeck = ALL_CARDS.filter((x) => x.type === 'treasure').slice(0, 5).map((x) => x.id);
  const stapelVorher = room.treasureDeck.length;
  addActiveCurse(room, p, 'NARRENGOLD', narrengold.id);
  startCombat(room, p.id, [monster.id], {});
  resolveCombatWin(room);
  assert.strictEqual(p.hand.length, 0, 'kein Schatz aus diesem Kampf');
  assert.strictEqual(room.treasureDeck.length, stapelVorher, 'der Stapel schrumpft nicht');
  assert.ok(p.level > 5, 'die Stufe gibt es trotzdem');
}

// Die Zusage an die Helfer:in bleibt bestehen - der Fluch haengt an der
// kaempfenden Person, der Anspruch der Helfer:in ist ihr eigener.
{
  const monster = ALL_CARDS.find((x) => x.category === 'monster' && (x.treasureCount || 0) > 0);
  const narrengold = findCard('NARRENGOLD');
  const p = makePlayer({});
  const helfer = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([p, helfer]);
  room.treasureDeck = ALL_CARDS.filter((x) => x.type === 'treasure').slice(0, 5).map((x) => x.id);
  addActiveCurse(room, p, 'NARRENGOLD', narrengold.id);
  startCombat(room, p.id, [monster.id], {});
  room.combat.helperId = helfer.id;
  room.combat.helperReward = 1;
  resolveCombatWin(room);
  assert.strictEqual(p.hand.length, 0, 'die kaempfende Person bekommt nichts');
  assert.strictEqual(helfer.hand.length, 1, 'die zugesagte Karte bekommt die Helfer:in trotzdem');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL mit `AssertionError: kein Schatz aus diesem Kampf` — die Hand enthält die gezogene Karte.

- [ ] **Step 3: Write minimal implementation**

In `server.js` neben `hatSchatzSperre`:

```js
// NARRENGOLD: "Du erhaeltst keinen Schatz im naechsten Kampf." Nur die
// Kampfbeute - anders als die Stoererliste (hatSchatzSperre), die JEDE
// Schatzkarte sperrt und deshalb in zieheSchaetzeFuer sitzt.
function hatKampfschatzSperre(player) {
  return !!player && (player.activeCurses || []).some((f) => f.kind === 'noCombatTreasure');
}
```

In `resolveCombatWin` die Zeile `const ziehendFuer = hatSchatzSperre(actor) ? helper : actor;` ersetzen durch:

```js
  const actorGesperrt = hatSchatzSperre(actor) || hatKampfschatzSperre(actor);
  const ziehendFuer = actorGesperrt ? helper : actor;
  const sollZiehen = actorGesperrt ? Math.min(treasureCount, c.helperReward || 0) : treasureCount;
```

und die darauffolgende `sollZiehen`-Zeile entfernen (sie wird durch die obige ersetzt).

`hatKampfschatzSperre` in `module.exports` ergänzen.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js` → ok
Run: `node tests/run.js` → `28/28`

- [ ] **Step 5: Commit**

```bash
git add server.js tests/card-unnatural-doors.test.js
git commit -m "Narrengold: kein Schatz aus dem naechsten Kampf"
```

---

### Task 6: TODESANGST — keine Hilfe, wenn Untote im Spiel sind

**Files:**
- Modify: `server.js` (`handleRespondHelp`, `handleRequestHelp`)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: Wirkungsart `fearUndead` aus Task 2, `combatHasUndead` (vorhanden).
- Produces: `function hatUntotenAngst(player)` → `boolean`, exportiert.

- [ ] **Step 1: Write the failing test**

```js
// --- TODESANGST: Hilfe gegen Untote -----------------------------------------
{
  const untot = ALL_CARDS.find((x) => x.category === 'monster' && /UNTOTE|VAMPIR|ZOMBIE|LICH|SKELETT/i.test(x.name));
  const angst = findCard('TODESANGST');
  const kaempfer = makePlayer({});
  const aengstlich = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([kaempfer, aengstlich]);
  addActiveCurse(room, aengstlich, 'TODESANGST', angst.id);
  startCombat(room, kaempfer.id, [untot.id], {});
  room.combat.helperPending = { targetId: aengstlich.id, compelled: false, reward: 0 };
  handleRespondHelp(room, aengstlich.id, true);
  assert.strictEqual(room.combat.helperId, null, 'gegen Untote sagt die Angst nicht zu');

  // Andersherum: wer selbst Angst hat, bekommt gegen Untote keine Hilfe.
  const room2 = makeRoom([aengstlich, kaempfer]);
  startCombat(room2, aengstlich.id, [untot.id], {});
  handleRequestHelp(room2, aengstlich.id, kaempfer.id, 0);
  assert.ok(!room2.combat.helperPending, 'gegen Untote hilft der aengstlichen Person niemand');
}
```

Hinweis: `UNDEAD_MONSTERS` ist exportiert — falls der Regex keine Karte findet, im Test stattdessen `ALL_CARDS.find((x) => x.category === 'monster' && UNDEAD_MONSTERS.has(x.name))` benutzen und `UNDEAD_MONSTERS` importieren.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL mit `AssertionError: gegen Untote sagt die Angst nicht zu` — `helperId` ist gesetzt.

- [ ] **Step 3: Write minimal implementation**

In `server.js` neben `hatHilfeSperre`:

```js
// TODESANGST: "Du hilfst niemandem, die Untoten zu bekaempfen ... Wenn du
// gegen Untote kaempfst, wird dir niemand helfen!"
function hatUntotenAngst(player) {
  return !!player && (player.activeCurses || []).some((f) => f.kind === 'fearUndead');
}
```

In `handleRespondHelp`, im `if (accept)`-Zweig hinter der STINKER-Sperre aus Task 3:

```js
    if (hatUntotenAngst(target) && combatHasUndead(room)) {
      log(room, `${target.name} hat Todesangst vor Untoten und hilft hier nicht.`);
      c.helperPending = null;
      touchRoom(room);
      return;
    }
```

In `handleRequestHelp`, hinter der STINKER-Sperre:

```js
  if (hatUntotenAngst(actor) && combatHasUndead(room)) {
    log(room, `${actor.name} kämpft gegen Untote - die Todesangst schreckt jede Hilfe ab.`);
    touchRoom(room);
    return;
  }
```

`hatUntotenAngst` in `module.exports` ergänzen.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js` → ok
Run: `node tests/run.js` → `28/28`

- [ ] **Step 5: Commit**

```bash
git add server.js tests/card-unnatural-doors.test.js
git commit -m "Todesangst: keine Hilfe, wo Untote im Kampf stehen"
```

---

### Task 7: TODESANGST — eigener Kampf gegen Untote ist verloren

**Files:**
- Modify: `server.js` (`resolveCombat`)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `hatUntotenAngst` aus Task 6.
- Produces: nichts Neues.

- [ ] **Step 1: Write the failing test**

Import um `resolveCombat` erweitern:

```js
// --- TODESANGST: der eigene Kampf gegen Untote ------------------------------
{
  const untot = ALL_CARDS.find((x) => x.category === 'monster' && UNDEAD_MONSTERS.has(x.name));
  const angst = findCard('TODESANGST');
  const p = makePlayer({ level: 10 }); // klar staerker als das Monster
  const room = makeRoom([p]);
  addActiveCurse(room, p, 'TODESANGST', angst.id);
  startCombat(room, p.id, [untot.id], {});
  resolveCombat(room);
  assert.ok(room.combat && room.combat.mustFlee,
    'trotz hoeherer Kampfstaerke muss die aengstliche Person fliehen');
  assert.ok(room.logs.some((l) => /Todesangst/i.test(l.text || l)), 'der Verlauf nennt den Grund');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL — der Kampf wurde gewonnen, `room.combat` ist bereits null.

- [ ] **Step 3: Write minimal implementation**

In `server.js`, in `resolveCombat` direkt hinter der `lustOhneHilfe`-Zeile:

```js
  // TODESANGST: "Du musst Weglaufen, selbst wenn du das Monster besiegen
  // koenntest." Gleiche Bauform wie lustOhneHilfe - die Kampfstaerke spielt
  // keine Rolle mehr, also vor Krieger-Gleichstand und ALUFOLIE.
  const angstVorUntoten = combatHasUndead(room) && hatUntotenAngst(findPlayer(room, c.actorId));
  const kampfVerloren = lustOhneHilfe || angstVorUntoten;
```

Danach in denselben drei Zeilen `lustOhneHilfe` durch `kampfVerloren` ersetzen (`const warrior = !kampfVerloren && ...`, `const tie = !kampfVerloren && ...`, `if (!kampfVerloren && (playerStrength > monsterStrength || tie))`) und die Logzeile am Ende um den neuen Grund erweitern:

```js
    log(room, angstVorUntoten
      ? `Die Todesangst vor den Untoten ist stärker als jede Waffe. Fliehen nötig!${wer}`
      : (lustOhneHilfe
        ? `Ohne Hilfe eines Charakters des anderen Geschlechts ist das Lustmonster nicht zu besiegen. Fliehen nötig!${wer}`
        : `Kampfstärke reicht nicht (${playerStrength} vs. ${monsterStrength}). Fliehen nötig!${wer}`));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js` → ok
Run: `node tests/run.js` → `28/28`

- [ ] **Step 5: Commit**

```bash
git add server.js tests/card-unnatural-doors.test.js
git commit -m "Todesangst: gegen Untote hilft keine Kampfstaerke"
```

---

### Task 8: TODESANGST — nachträglich auftauchende Untote werfen die Helfer:in raus

**Files:**
- Modify: `server.js` (`refreshCombatReady`)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `hatUntotenAngst` aus Task 6, `combatHasUndead` (vorhanden).
- Produces: nichts Neues.

- [ ] **Step 1: Write the failing test**

Import um `handlePlayCombatCard` erweitern:

```js
// --- TODESANGST: Untote treten nachtraeglich in den Kampf --------------------
{
  const harmlos = ALL_CARDS.find((x) => x.category === 'monster' && !UNDEAD_MONSTERS.has(x.name));
  const untotKarte = findCard('UNTOT');
  const angst = findCard('TODESANGST');
  const kaempfer = makePlayer({ hand: [untotKarte.id] });
  const aengstlich = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([kaempfer, aengstlich]);
  addActiveCurse(room, aengstlich, 'TODESANGST', angst.id);
  startCombat(room, kaempfer.id, [harmlos.id], {});
  room.combat.helperId = aengstlich.id;
  handlePlayCombatCard(room, kaempfer.id, untotKarte.id);
  assert.strictEqual(room.combat.helperId, null,
    'die aengstliche Helfer:in verlaesst den Kampf, sobald er untot wird');
  assert.ok(room.logs.some((l) => /Todesangst/i.test(l.text || l)), 'der Verlauf nennt den Grund');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL — `helperId` zeigt weiterhin auf die ängstliche Person.

- [ ] **Step 3: Write minimal implementation**

In `server.js`, am Anfang von `refreshCombatReady` (der Funktion, die nach jeder Kampfänderung läuft):

```js
  // TODESANGST: "Wenn Untote in einen Kampf treten, in dem du geholfen hast,
  // musst du diesen Kampf verlassen (keine Strafe)." Hier statt an jeder
  // einzelnen Stelle, an der ein Monster oder die Karte UNTOT dazukommt -
  // refreshCombatReady laeuft nach jeder dieser Aenderungen.
  if (room.combat && room.combat.helperId && combatHasUndead(room)) {
    const helfer = findPlayer(room, room.combat.helperId);
    if (hatUntotenAngst(helfer)) {
      room.combat.helperId = null;
      room.combat.helperReward = 0;
      log(room, `${helfer.name} hat Todesangst vor Untoten und verlässt den Kampf - ohne Strafe.`);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js` → ok
Run: `node tests/run.js` → `28/28`

Erwartete Nebenwirkung prüfen: `card-unnatural-monsters.test.js` und `card-combat-reactions.test.js` müssen grün bleiben — beide spielen UNTOT, aber ohne `fearUndead`-Eintrag.

- [ ] **Step 5: Commit**

```bash
git add server.js tests/card-unnatural-doors.test.js
git commit -m "Todesangst: wer hilft, verlaesst den Kampf, sobald Untote dazukommen"
```

---

### Task 9: VERFLUCHTER GEGENSTAND — Auswahl und Markierung

**Files:**
- Modify: `src/cards/consequences.js` (`CONSEQUENCE_OVERRIDES`)
- Modify: `server.js` (`applyPrimitiveAction`: neues `case 'curseItem'`; neue Funktion `cursedItemId`)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `openCardChoice`-Bauform über `autoApplyLossConsequence` (vorhanden), `clearActiveCurseByKind` (vorhanden).
- Produces:
  - Primitiv `{ type: 'curseItem', itemId, cardId }`
  - `function cursedItemId(player)` → `string|null`, exportiert. Räumt den Eintrag selbst auf, wenn der Gegenstand nicht mehr angelegt ist.

**Wichtig:** VERFLUCHTER GEGENSTAND kommt **nicht** in `LINGERING_CURSES`. `autoApplyLossConsequence` kehrt bei einer Einzelquelle mit `choice` zurück, *bevor* die Tracker-Zeile läuft — der Eintrag entsteht deshalb in der gewählten Aktion, wo auch die `itemId` bekannt ist.

- [ ] **Step 1: Write the failing test**

Import um `resolveConsequenceSpec, applyPrimitiveAction, handleEquipItem` erweitern:

```js
// --- VERFLUCHTER GEGENSTAND: Auswahl ----------------------------------------
{
  const mitBonus = ALL_CARDS.filter((x) => x.category === 'item' && (x.bonus || 0) > 0 && x.slotKind);
  const a = mitBonus.find((x) => x.slotKind === 'head');
  const b = mitBonus.find((x) => x.slotKind === 'armor');
  const p = makePlayer({ hand: [a.id, b.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, a.id);
  handleEquipItem(room, p.id, b.id);

  const spec = resolveConsequenceSpec('VERFLUCHTER GEGENSTAND', '', p, room);
  assert.strictEqual(spec.type, 'choice', 'das Opfer waehlt selbst');
  assert.strictEqual(spec.options.length, 2, 'beide Gegenstaende stehen zur Wahl');

  applyPrimitiveAction(room, p, spec.options[0].action);
  const eintrag = p.activeCurses.find((f) => f.kind === 'cursedItem');
  assert.ok(eintrag, 'der Fluch steht im Tracker');
  assert.strictEqual(eintrag.itemId, spec.options[0].action.itemId, 'und merkt sich den Gegenstand');
  assert.strictEqual(cursedItemId(p), eintrag.itemId, 'cursedItemId liest ihn zurueck');

  // Ist der Gegenstand auf anderem Weg weg (anderer Fluch), raeumt der Leser auf.
  unequipSlotCard(p, eintrag.itemId);
  assert.strictEqual(cursedItemId(p), null, 'ohne den Gegenstand endet der Fluch');
  assert.strictEqual(p.activeCurses.length, 0, 'und der Eintrag verschwindet');
}
```

Import zusätzlich um `cursedItemId, unequipSlotCard` erweitern.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL mit `TypeError: cursedItemId is not a function` bzw. davor `AssertionError: das Opfer waehlt selbst` — `CONSEQUENCE_OVERRIDES['VERFLUCHTER GEGENSTAND']` liefert heute `null`.

- [ ] **Step 3: Write minimal implementation**

In `src/cards/consequences.js` den bestehenden Eintrag

```js
    'VERFLUCHTER GEGENSTAND': () => null,
```

ersetzen durch:

```js
    // "Ein Gegenstand, der dir einen Kampfbonus oder eine besondere Kraft
    // verleiht, ist nun verflucht." Kandidat ist nur ANGELEGTE Ausruestung -
    // eine Karte auf der Hand verleiht keine Kraefte. Das Opfer waehlt selbst
    // (Ruling 2026-09-18), bei genau einem Kandidaten ohne Dialog.
    'VERFLUCHTER GEGENSTAND': (player, room, cardId) => {
      const kandidaten = equippedItemIds(player).filter((id) => {
        const c = card(id);
        if (!c) return false;
        return (c.bonus || 0) > 0 || treasurePowerName(c.name) || !!(specialSlotRule(c) || {}).bonus;
      });
      if (!kandidaten.length) return { type: 'noEffect' };
      const aktion = (id) => ({ type: 'curseItem', itemId: id, cardId: cardId || null });
      if (kandidaten.length === 1) return aktion(kandidaten[0]);
      return {
        type: 'choice',
        options: kandidaten.map((id) => ({
          id: `verflucht-${id}`, label: `"${card(id).name}" verfluchen`, action: aktion(id),
        })),
      };
    },
```

Dafür zwei Einträge in den ctx der Factory: in `src/cards/consequences.js` oben die Destrukturierung um `specialSlotRule, treasurePowerName` erweitern, in `server.js` beim Aufruf von `consequencesFactory({...})` ergänzen:

```js
  specialSlotRule,
  // TREASURE_POWER_OVERRIDES steht in server.js erst weiter unten - als
  // Funktion durchgereicht, damit die Tabelle zur Aufrufzeit gelesen wird.
  treasurePowerName: (name) => !!TREASURE_POWER_OVERRIDES[name],
```

In `server.js`, in `applyPrimitiveAction` neben `case 'lingeringCurse'`:

```js
    // VERFLUCHTER GEGENSTAND: die Id steht am Tracker-Eintrag, nicht in einem
    // zweiten Feld am Spieler - so verschwindet sie mit dem Eintrag, und der
    // WUNSCHRING braucht keine Sonderbehandlung.
    case 'curseItem': {
      const ziel = card(action.itemId);
      if (!ziel || !equippedItemIds(player).includes(action.itemId)) return 'der Gegenstand ist nicht mehr angelegt';
      player.activeCurses = player.activeCurses || [];
      player.activeCurses.push({
        cardId: action.cardId || null, name: 'VERFLUCHTER GEGENSTAND', kind: 'cursedItem',
        itemId: action.itemId, amount: 0, dauer: 'dauerhaft',
        hinweis: `"${ziel.name}" ist verflucht: keine Kräfte, und du wirst ihn nicht los.`,
      });
      return `"${ziel.name}" ist verflucht`;
    }
```

Und neben `cursedItem`-Lesern, bei `curseHidesHandItems`:

```js
// Der verfluchte Gegenstand - oder null. Geprueft wird beim LESEN, ob er
// ueberhaupt noch angelegt ist: "Der Gegenstand kann durch einen anderen Fluch
// zerstoert werden", und dann endet der Fluch mit ihm (gleiche Bauform wie
// stinktierStrafeAktiv).
function cursedItemId(player) {
  const eintrag = (player.activeCurses || []).find((f) => f.kind === 'cursedItem');
  if (!eintrag) return null;
  if (equippedItemIds(player).includes(eintrag.itemId)) return eintrag.itemId;
  clearActiveCurseByKind(player, 'cursedItem');
  return null;
}
```

`cursedItemId` und `unequipSlotCard` in `module.exports` ergänzen (`unequipSlotCard` steht dort noch nicht).

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js` → ok
Run: `node tests/run.js` → `28/28`

- [ ] **Step 5: Commit**

```bash
git add server.js src/cards/consequences.js tests/card-unnatural-doors.test.js
git commit -m "Verfluchter Gegenstand: das Opfer waehlt, der Tracker merkt sich die Karte"
```

---

### Task 10: VERFLUCHTER GEGENSTAND — die Kräfte zählen nicht mehr

**Files:**
- Modify: `server.js` (`combatTotals`)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `cursedItemId` aus Task 9.
- Produces: nichts Neues.

- [ ] **Step 1: Write the failing test**

```js
// --- VERFLUCHTER GEGENSTAND: Kraefte weg ------------------------------------
{
  const monster = ALL_CARDS.find((x) => x.category === 'monster');
  const waffe = ALL_CARDS.find((x) => x.category === 'item' && x.slotKind === 'hand'
    && x.handsCost === 1 && (x.bonus || 0) > 0);
  const p = makePlayer({ hand: [waffe.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, waffe.id);
  room.combat = { actorId: p.id, helperId: null, monsterIds: [monster.id],
    actorModifier: 0, monsterModifier: 0, backstabs: {}, mustFlee: false };
  const mitBonus = combatTotals(room).playerStrength;

  // Ein Anhang am selben Gegenstand faellt mit weg - genau dafuer gibt es die
  // gemeinsame Ausschlussmenge (siehe MONDJUNGFERN).
  const vergiftet = findCard('VERGIFTET');
  room.itemAttachments[waffe.id] = [vergiftet.id];
  const mitAnhang = combatTotals(room).playerStrength;
  assert.ok(mitAnhang > mitBonus, 'der Anhang zaehlt zunaechst mit');

  applyPrimitiveAction(room, p, { type: 'curseItem', itemId: waffe.id, cardId: null });
  assert.strictEqual(combatTotals(room).playerStrength, mitAnhang - (mitAnhang - mitBonus) - waffe.bonus,
    'verflucht zaehlen weder der Gegenstand noch sein Anhang');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL — die Kampfstärke ist unverändert.

- [ ] **Step 3: Write minimal implementation**

In `server.js`, in `combatTotals` die Zeile

```js
      const excludeIds = (ignoreWeapons || curseHidesHandItems(p)) ? handItemIds(p) : null;
```

ersetzen durch:

```js
      // Eine Ausschlussmenge für alle drei Gründe: Monster (MONDJUNGFERN),
      // Person (LUSTMONSTER) und einzelner Gegenstand (VERFLUCHTER
      // GEGENSTAND). Sie fliegt aus allen drei Item-Summanden, also samt
      // Kartenanhängen und Rassenbonus.
      const excludeIds = new Set();
      if (ignoreWeapons || curseHidesHandItems(p)) handItemIds(p).forEach((id) => excludeIds.add(id));
      const verflucht = cursedItemId(p);
      if (verflucht) excludeIds.add(verflucht);
```

und die drei Nutzungen unverändert lassen (`equippedBonusSum(p, room, excludeIds)` usw. vertragen eine leere Menge — `excludeIds.has(id)` ist dann schlicht immer falsch).

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js` → ok
Run: `node tests/run.js` → `28/28`

- [ ] **Step 5: Commit**

```bash
git add server.js tests/card-unnatural-doors.test.js
git commit -m "Verfluchter Gegenstand verliert seine Kraefte"
```

---

### Task 11: VERFLUCHTER GEGENSTAND — nicht ablegbar, nicht verkaufbar, nicht handelbar

**Files:**
- Modify: `server.js` (`handleUnequipItem`, `handleSellItems`, `ownTradeIds`)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `cursedItemId` aus Task 9.
- Produces: nichts Neues.

- [ ] **Step 1: Write the failing test**

Import um `handleUnequipItem, handleSellItems, clearActiveCurseByKind` erweitern (`teuer` muss mindestens 1000 Gold wert sein, damit der Verkauf ohne Fluch wirklich durchgeht):

```js
// --- VERFLUCHTER GEGENSTAND: man wird ihn nicht los -------------------------
{
  const teuer = ALL_CARDS.find((x) => x.category === 'item' && (x.gold || 0) >= 1000 && x.slotKind);
  const p = makePlayer({ hand: [teuer.id] });
  const room = makeRoom([p]);
  room.turnPhase = 'aerger';
  room.turnIndex = 0;
  handleEquipItem(room, p.id, teuer.id);
  applyPrimitiveAction(room, p, { type: 'curseItem', itemId: teuer.id, cardId: null });

  handleUnequipItem(room, p.id, teuer.id);
  assert.ok(equippedItemIds(p).includes(teuer.id), 'ablegen geht nicht');

  const stufeVorher = p.level;
  handleSellItems(room, p.id, [teuer.id]);
  assert.strictEqual(p.level, stufeVorher, 'verkaufen geht auch nicht');
  assert.ok(equippedItemIds(p).includes(teuer.id), 'und der Gegenstand liegt noch da');

  // Gegenprobe: ohne den Fluch geht derselbe Verkauf durch - sonst waere der
  // Test auch dann gruen, wenn der Verkauf aus einem anderen Grund scheitert.
  clearActiveCurseByKind(p, 'cursedItem');
  handleSellItems(room, p.id, [teuer.id]);
  assert.ok(p.level > stufeVorher, 'ohne Fluch wird derselbe Gegenstand verkauft');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL mit `AssertionError: ablegen geht nicht`.

- [ ] **Step 3: Write minimal implementation**

In `handleUnequipItem`, hinter der Monsterkarten-Sperre:

```js
  if (cursedItemId(player) === cardId) {
    log(room, `${player.name} wird "${unequipKarte ? unequipKarte.name : cardId}" nicht los - der Fluch hält ihn fest.`);
    touchRoom(room);
    return;
  }
```

In `handleSellItems`, direkt hinter der Kampf-/Zug-Sperre am Anfang:

```js
  // Der ganze Verkauf wird abgelehnt statt still gefiltert - dieselbe
  // Entscheidung wie bei der Stoererliste im Handel (finishTrade).
  const verfluchteId = cursedItemId(player);
  if (verfluchteId && [...new Set(cardIds)].includes(verfluchteId)) {
    log(room, `${player.name} kann "${card(verfluchteId).name}" nicht verkaufen - der Gegenstand ist verflucht.`);
    touchRoom(room);
    return;
  }
```

In `ownTradeIds` (Signatur bleibt `(player, ids)`):

```js
function ownTradeIds(player, ids) {
  const own = tradableCardIds(player);
  const verflucht = cursedItemId(player);
  return [...new Set(Array.isArray(ids) ? ids : [])]
    .filter((id) => own.includes(id) && id !== verflucht);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js` → ok
Run: `node tests/run.js` → `28/28`

- [ ] **Step 5: Commit**

```bash
git add server.js tests/card-unnatural-doors.test.js
git commit -m "Verfluchter Gegenstand: nicht ablegbar, nicht verkaufbar, nicht handelbar"
```

---

### Task 12: VERFLUCHTER GEGENSTAND — beim Tod wandert der Fluch mit

**Files:**
- Modify: `server.js` (`handleResolveCardCardChoice`, `takeFrom`-Zweig)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `cursedItemId` aus Task 9.
- Produces: nichts Neues.

- [ ] **Step 1: Write the failing test**

Import um `handleResolveCardCardChoice` erweitern:

```js
// --- VERFLUCHTER GEGENSTAND: Uebertragung beim Pluendern ---------------------
{
  const waffe = ALL_CARDS.find((x) => x.category === 'item' && x.slotKind === 'hand' && (x.bonus || 0) > 0);
  const opfer = makePlayer({ hand: [waffe.id] });
  const erbe = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([opfer, erbe]);
  handleEquipItem(room, opfer.id, waffe.id);
  applyPrimitiveAction(room, opfer, { type: 'curseItem', itemId: waffe.id, cardId: null });

  room.pendingCardAction = { playerId: erbe.id, cardName: 'Leiche plündern', kind: 'chooseCard',
    prompt: 'Eine Karte nehmen', candidateIds: [waffe.id], takeFrom: opfer.id };
  handleResolveCardCardChoice(room, erbe.id, waffe.id);

  assert.ok(erbe.hand.includes(waffe.id), 'die Karte ist beim Erben');
  assert.strictEqual(opfer.activeCurses.length, 0, 'das Opfer ist den Fluch los');
  const uebernommen = erbe.activeCurses.find((f) => f.kind === 'cursedItem');
  assert.ok(uebernommen, 'der Erbe hat ihn jetzt');
  assert.strictEqual(uebernommen.itemId, waffe.id, 'und zwar fuer dieselbe Karte');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL mit `AssertionError: das Opfer ist den Fluch los` — der Eintrag bleibt beim Opfer.

- [ ] **Step 3: Write minimal implementation**

In `server.js`, im `takeFrom`-Zweig von `handleResolveCardCardChoice`, direkt nach `clearCheatIfLost(opfer, chosenCardId);`:

```js
    // VERFLUCHTER GEGENSTAND: "wenn du stirbst, wird der Fluch auf den
    // uebertragen, der ihn von deinem Koerper entfernt."
    const verfluchtEintrag = (opfer.activeCurses || []).find((f) => f.kind === 'cursedItem' && f.itemId === chosenCardId);
    if (verfluchtEintrag) {
      clearActiveCurseByKind(opfer, 'cursedItem');
      player.activeCurses = player.activeCurses || [];
      player.activeCurses.push(Object.assign({}, verfluchtEintrag));
      log(room, `Der Fluch auf "${chosen ? chosen.name : chosenCardId}" geht auf ${player.name} über.`);
    }
```

Achtung auf die Reihenfolge: der Eintrag muss gelesen werden, **bevor** `cursedItemId(opfer)` ihn aufräumen könnte — deshalb direkt hier, nicht über den Leser.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js` → ok
Run: `node tests/run.js` → `28/28`

- [ ] **Step 5: Commit**

```bash
git add server.js tests/card-unnatural-doors.test.js
git commit -m "Verfluchter Gegenstand wechselt mit der Karte den Besitzer"
```

---

### Task 13: Abschluss — Gegenprobe und Übergabe

**Files:**
- Modify: `HANDOVER.md` (neuer Abschnitt 11.5)

**Interfaces:**
- Consumes: alles aus Task 1-12.
- Produces: nichts.

- [ ] **Step 1: Gegenprobe mit dem Deckungsscanner**

Run: `node tools/coverage-scan.js unnaturalaxe`
Expected: STINKER, NARRENGOLD, TODESANGST, VERFLUCHTER GEGENSTAND und EISKALTES HÄNDCHEN (KLEINE FREUNDIN) tauchen in keiner Lückenliste mehr auf. Übrig bleiben genau sieben Türkarten (EDELMUT, TOD, ABGEBRANNT, SCHICKSALHAFTE KARTEN, FINDE EINE KARTE, FREUNDLICH, MAMI) und die 14 Schatzkarten.

- [ ] **Step 2: Volle Suite**

Run: `node tests/run.js`
Expected: `28/28 Tests erfolgreich.`

- [ ] **Step 3: HANDOVER.md fortschreiben**

Neuer Abschnitt `### 11.5 Tuerkarten Welle A (Runde vom 2026-09-18)` mit: den fünf Karten und ihren Wirkungsarten (`noHelp`, `noCombatTreasure`, `fearUndead`, `cursedItem`), dem Verweis auf Spec und Plan, der Trennung `noTreasure` gegen `noCombatTreasure`, und den offenen Auslegungen aus §9 der Spec.

- [ ] **Step 4: Commit**

```bash
git add HANDOVER.md
git commit -m "Uebergabe: Tuerkarten Welle A abgeschlossen"
```

---

## Reihenfolge und Abhängigkeiten

Task 1 und 2 sind unabhängig voneinander; alles Weitere hängt an ihnen:

- Task 3 → Task 4 (beide `noHelp`)
- Task 5 steht allein (`noCombatTreasure`)
- Task 6 → Task 7, Task 8 (alle `fearUndead`)
- Task 9 → Task 10, 11, 12 (alle `cursedItem`)
- Task 13 zuletzt
