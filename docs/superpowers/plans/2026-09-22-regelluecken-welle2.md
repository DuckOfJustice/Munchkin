# Regellücken Welle 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vier heute wirkungslose Karten (HUNGRIGER RUCKSACK, TEMPORÄRE ANMNESIE, TOURISTENFALLE, GUMMI-GOLEM) bekommen ihre Wirkung als anhaltende Flüche, dazu zwei Nachträge (RIESENKAKERLAKE gegen Halb-Blut, Fehlalarm im Abdeckungs-Scan).

**Architecture:** Alle vier Karten hängen am vorhandenen Fluch-Tracker `player.activeCurses`: Eintrag über `LINGERING_CURSES` (src/cards/reactions.js) + `{ type: 'lingeringCurse', ... }` in `CONSEQUENCE_OVERRIDES` (src/cards/consequences.js), Wirkung über neue `kind`-Abfragen in server.js, Ende je Karte an der passenden Stelle (Phasenwechsel, `resolveCombatWin`, Lesen der Sperre). Der WUNSCHRING beendet dadurch automatisch jeden der vier.

**Tech Stack:** Node.js (CommonJS), Express + Socket.IO; Tests mit `assert` über `node tests/<datei>.test.js` bzw. `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-22-regelluecken-welle2-design.md`

## Global Constraints

- Code, Kommentare, Commit-Messages, Log- und UI-Texte auf Deutsch (Kommentare im Umfeld schreiben Umlaute als ae/oe/ue, Logtexte mit Umlauten).
- Kartennamen exakt wie in `data/cards.json`.
- TDD: erst der Test, Test schlägt fehl, dann der Code.
- `npm test` grün am Ende jeder Task. `tests/basic-game-flow.test.js` ist zufallsabhängig und scheitert selten mit „kein einziger Kampf" – einzeln wiederholen, bevor ein Fehler vermutet wird.
- Dateien haben teils CRLF-Zeilenenden: mehrzeilige Ersetzungen per Skript schlagen fehl – Edit-Werkzeug benutzen.
- Zeilennummern in diesem Plan sind Näherungen; Funktionen über ihren Namen suchen.
- Commits enden mit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WxCuD1KsFNquy8741xvETq
  ```
- Branch: `fix/welle2-anhaltende-flueche` (existiert, basiert auf `origin/main` = 1915291).
- Alle vier Karten stehen schon in `DOOR_OTHER_AS_CURSE` (src/cards/consequences.js) und laufen damit als Fluch auf – das muss nicht ergänzt werden. Ihr Eintrag in `CONSEQUENCE_OVERRIDES` ist heute `() => null` und wird ersetzt.
- `PARSER_TABU` in `tests/auto-consequence.test.js` prüft, dass bestimmte Kartentexte NICHT vom generischen Parser aufgelöst werden. Stehen betroffene Karten dort, den Eintrag anpassen statt den Test zu umgehen – im Zweifel im Report melden.

---

### Task 1: Testdatei + TOURISTENFALLE

**Files:**
- Create: `tests/card-regelluecken-welle2.test.js`
- Modify: `src/cards/reactions.js` (`LINGERING_CURSES`), `src/cards/consequences.js` (Eintrag `'TOURISTENFALLE'`), `server.js` (`handlePlayMonsterFromHand`, `resolveCombatWin`)

**Interfaces:**
- Produces: Testdatei mit `findCard`, `makePlayer`, `makeRoom`, `fertig` – spätere Tasks hängen ihre Blöcke vor der Schlusszeile an.
- Produces: Fluch-Wirkungsart `keinAergerSuchen`; Hilfsfunktion `hatFluchArt(player, kind)` in server.js.

- [ ] **Step 1: Testdatei mit dem Touristenfallen-Test anlegen**

```js
// Regellücken Welle 2 (Spec 2026-09-22-regelluecken-welle2-design.md):
// Touristenfalle, Hungriger Rucksack, Temporäre Anmnesie, Gummi-Golem.
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
    code: 'TEST', players, turnIndex: 0, turnPhase: 'aerger', combatHappenedThisTurn: false,
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

// --- TOURISTENFALLE: "Du darfst nicht 'Auf Ärger aus sein'. Dieser Fluch
// bleibt bestehen, bis du einem anderen Spieler geholfen hast, einen Kampf zu
// gewinnen."
{
  const falle = findCard('TOURISTENFALLE').id;
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const p = makePlayer({ hand: [monster.id] });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  S.addActiveCurse(room, p, 'TOURISTENFALLE', falle);
  assert.ok(p.activeCurses.some((f) => f.kind === 'keinAergerSuchen'), 'Fluch ist eingetragen');
  S.handlePlayMonsterFromHand(room, 'p1', monster.id);
  assert.strictEqual(room.combat, null, 'kein Kampf: "Auf Ärger aus sein" ist gesperrt');
  assert.ok(p.hand.includes(monster.id), 'das Monster bleibt auf der Hand');
  assert.ok(room.logs.some((l) => /Touristenfalle/i.test(l.text)), 'der Verlauf nennt den Grund');
}
// Gegenprobe: ohne Fluch startet der Kampf.
{
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const p = makePlayer({ hand: [monster.id] });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  S.handlePlayMonsterFromHand(room, 'p1', monster.id);
  assert.ok(room.combat, 'ohne Fluch beginnt der Kampf');
}
// Ende: nur ein Sieg als HELFENDE Person beendet den Fluch.
{
  const falle = findCard('TOURISTENFALLE').id;
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const a = makePlayer({ id: 'p1', name: 'A', level: 9 });
  const h = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([a, h]);
  S.addActiveCurse(room, h, 'TOURISTENFALLE', falle);
  S.startCombat(room, 'p1', [monster.id], { fromHand: false });
  room.combat.helperId = 'p2';
  S.resolveCombatWin(room);
  assert.ok(!h.activeCurses.some((f) => f.kind === 'keinAergerSuchen'), 'Sieg als Hilfe beendet den Fluch');
}
{
  const falle = findCard('TOURISTENFALLE').id;
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const a = makePlayer({ id: 'p1', name: 'A', level: 9 });
  const room = makeRoom([a, makePlayer({ id: 'p2', name: 'B' })]);
  S.addActiveCurse(room, a, 'TOURISTENFALLE', falle);
  S.startCombat(room, 'p1', [monster.id], { fromHand: false });
  S.resolveCombatWin(room);
  assert.ok(a.activeCurses.some((f) => f.kind === 'keinAergerSuchen'), 'der eigene Sieg beendet den Fluch nicht');
}

fertig();
console.log('card-regelluecken-welle2: alle Checks gruen');
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle2.test.js`
Expected: FAIL bei `Fluch ist eingetragen` (die Karte steht noch nicht in `LINGERING_CURSES`).

- [ ] **Step 3: Fluch-Eintrag anlegen**

`src/cards/reactions.js`, in `LINGERING_CURSES` ergänzen:

```js
    // "Du darfst nicht 'Auf Ärger aus sein'. Dieser Fluch bleibt bestehen, bis
    // du einem anderen Spieler geholfen hast, einen Kampf zu gewinnen."
    'TOURISTENFALLE': { kind: 'keinAergerSuchen', dauer: 'dauerhaft',
      hinweis: 'Kein "Auf Ärger aus sein", bis du jemandem zum Sieg verhilfst.' },
```

`src/cards/consequences.js`: den Eintrag `'TOURISTENFALLE': () => null,` ersetzen durch

```js
    // Wirkung und Ende: siehe keinAergerSuchen in server.js.
    'TOURISTENFALLE': (player, room, cardId) => ({ type: 'lingeringCurse', name: 'TOURISTENFALLE', cardId: cardId || null }),
```

Vor dem Schreiben prüfen, wie ein vorhandener `lingeringCurse`-Eintrag in derselben Datei aussieht (z. B. `'WEIHNACHTSMANN'`), und dieselbe Feldform benutzen.

- [ ] **Step 4: Wirkung und Ende in server.js**

Neben `curseRollModifier` (~Zeile 3424) eine gemeinsame Abfrage ergänzen:

```js
// Gibt es einen Tracker-Eintrag dieser Wirkungsart? (TOURISTENFALLE,
// TEMPORÄRE ANMNESIE, HUNGRIGER RUCKSACK - siehe LINGERING_CURSES.)
function hatFluchArt(player, kind) {
  return !!player && (player.activeCurses || []).some((f) => f.kind === kind);
}
```

In `handlePlayMonsterFromHand` nach `if (!c || c.category !== 'monster') return;`:

```js
  // TOURISTENFALLE: "Du darfst nicht 'Auf Ärger aus sein'."
  if (hatFluchArt(player, 'keinAergerSuchen')) {
    log(room, `${player.name} sitzt in der Touristenfalle und darf nicht auf Ärger aus sein.`);
    touchRoom(room);
    return;
  }
```

In `resolveCombatWin` an der Stelle, an der der Sieg feststeht (vor der Belohnung, dort wo `c.helperId` noch gesetzt ist), ergänzen:

```js
  // TOURISTENFALLE endet, sobald die verfluchte Person als HILFE einen Kampf
  // gewinnt - der eigene Sieg zaehlt laut Karte nicht.
  const helferBeiSieg = c.helperId ? findPlayer(room, c.helperId) : null;
  if (helferBeiSieg && clearActiveCurseByKind(helferBeiSieg, 'keinAergerSuchen')) {
    log(room, `${helferBeiSieg.name} hat jemandem zum Sieg verholfen - die Touristenfalle ist vorbei.`);
  }
```

- [ ] **Step 5: Tests grün, volle Suite, Commit**

Run: `node tests/card-regelluecken-welle2.test.js` → grün; `npm test` → alle erfolgreich.

```bash
git add tests/card-regelluecken-welle2.test.js server.js src/cards/reactions.js src/cards/consequences.js
git commit -m "fix: TOURISTENFALLE sperrt 'Auf Aerger aus sein' bis zu einem Sieg als Hilfe"
```

---

### Task 2: TEMPORÄRE ANMNESIE

**Files:**
- Modify: `src/cards/reactions.js` (`LINGERING_CURSES`), `src/cards/consequences.js` (Eintrag `'TEMPORÄRE ANMNESIE'`), `server.js` (`hasRace`, `hasClass`, `itemGrantsTrait`, `resolveCombatWin`)
- Test: `tests/card-regelluecken-welle2.test.js`

**Interfaces:**
- Consumes: `hatFluchArt(player, kind)` aus Task 1.
- Produces: Wirkungsart `traitsVergessen`.

- [ ] **Step 1: Tests anhängen (vor `fertig();`)**

```js
// --- TEMPORÄRE ANMNESIE: "Bis dahin wirst du überall als klassenloser Mensch
// gezählt." Ende: ein gewonnener Kampf, an dem die Person beteiligt war.
{
  const anmnesie = findCard('TEMPORÄRE ANMNESIE').id;
  const elf = findCard('ELF', 'race').id;
  const krieger = findCard('KRIEGER', 'class').id;
  const p = makePlayer({ races: [elf], classes: [krieger] });
  const room = makeRoom([p]);
  assert.ok(S.hasRace(p, 'ELF') && S.hasClass(p, 'KRIEGER'), 'Testvoraussetzung');
  S.addActiveCurse(room, p, 'TEMPORÄRE ANMNESIE', anmnesie);
  assert.ok(!S.hasRace(p, 'ELF'), 'Rasse vergessen');
  assert.ok(!S.hasClass(p, 'KRIEGER'), 'Klasse vergessen');
  assert.deepStrictEqual([p.races.length, p.classes.length], [1, 1], 'die Karten bleiben ausliegen');
  // Monsterbonus gegen Elfen greift nicht mehr.
  const sauger = findCard('GESICHTSSAUGER', 'monster');
  S.startCombat(room, 'p1', [sauger.id], { fromHand: false });
  assert.strictEqual(S.combatTotals(room).monsterStrength, sauger.level, '"+6 gegen Elfen" zaehlt nicht mehr');
  room.combat = null;
}
// Gegenstand, der eine Klasse verleiht, zaehlt ebenfalls nicht.
{
  const anmnesie = findCard('TEMPORÄRE ANMNESIE').id;
  const couch = findCard('ZAUBERCOUCH').id;
  const p = makePlayer();
  p.equipped.special = [couch];
  const room = makeRoom([p]);
  const vorher = S.hasClass(p, 'ZAUBERER');
  S.addActiveCurse(room, p, 'TEMPORÄRE ANMNESIE', anmnesie);
  assert.ok(!S.hasClass(p, 'ZAUBERER'), `Zaubercouch zaehlt nicht mehr (vorher: ${vorher})`);
}
// Ende: gewonnener Kampf, kaempfend ODER helfend.
{
  const anmnesie = findCard('TEMPORÄRE ANMNESIE').id;
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const ende = (alsHelfer) => {
    const a = makePlayer({ id: 'p1', name: 'A', level: 9 });
    const h = makePlayer({ id: 'p2', name: 'B' });
    const room = makeRoom([a, h]);
    const opfer = alsHelfer ? h : a;
    S.addActiveCurse(room, opfer, 'TEMPORÄRE ANMNESIE', anmnesie);
    S.startCombat(room, 'p1', [monster.id], { fromHand: false });
    if (alsHelfer) room.combat.helperId = 'p2';
    S.resolveCombatWin(room);
    return !opfer.activeCurses.some((f) => f.kind === 'traitsVergessen');
  };
  assert.ok(ende(false), 'eigener Sieg beendet die Anmnesie');
  assert.ok(ende(true), 'Sieg als Hilfe beendet die Anmnesie');
}
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle2.test.js`
Expected: FAIL bei `Rasse vergessen`.

- [ ] **Step 3: Implementieren**

`src/cards/reactions.js`, `LINGERING_CURSES`:

```js
    // "Eine Beule am Kopf laesst dich deine Klasse(n) und Rasse(n) vergessen
    // ... Bis dahin wirst du ueberall als klassenloser Mensch gezaehlt."
    'TEMPORÄRE ANMNESIE': { kind: 'traitsVergessen', dauer: 'dauerhaft',
      hinweis: 'Rasse und Klasse zählen nicht, bis du einen Kampf gewinnst.' },
```

`src/cards/consequences.js`: `'TEMPORÄRE ANMNESIE': () => null,` ersetzen durch denselben `lingeringCurse`-Aufbau wie in Task 1, mit `name: 'TEMPORÄRE ANMNESIE'`.

`server.js`, `hasRace` und `hasClass` als erste Zeile im Funktionskörper:

```js
  // TEMPORÄRE ANMNESIE: "ueberall als klassenloser Mensch gezaehlt" - die
  // Karten bleiben ausliegen, zaehlen aber nirgends.
  if (hatFluchArt(player, 'traitsVergessen')) return false;
```

`server.js`, `itemGrantsTrait` als erste Zeile:

```js
  if (hatFluchArt(player, 'traitsVergessen')) return false;
```

`server.js`, `resolveCombatWin`, direkt neben der TOURISTENFALLE-Prüfung aus Task 1:

```js
  // TEMPORÄRE ANMNESIE endet mit einem gewonnenen Kampf - kaempfend oder helfend.
  combatParticipants(room).forEach((p) => {
    if (clearActiveCurseByKind(p, 'traitsVergessen')) {
      log(room, `${p.name} erinnert sich wieder an Rasse und Klasse.`);
    }
  });
```

Achtung Reihenfolge: `combatParticipants(room)` liest `room.combat`; die Prüfung muss laufen, solange der Kampf noch steht (dieselbe Stelle wie in Task 1).

- [ ] **Step 4: Tests grün, volle Suite, Commit**

Run: `node tests/card-regelluecken-welle2.test.js` → grün; `npm test` → alle erfolgreich. Schlägt ein bestehender Test fehl, weil er `hasRace`/`hasClass` mit einer verfluchten Person aufruft, im Report melden statt den Test aufzuweichen.

```bash
git add server.js src/cards/reactions.js src/cards/consequences.js tests/card-regelluecken-welle2.test.js
git commit -m "fix: TEMPORAERE ANMNESIE - Rasse und Klasse zaehlen bis zum naechsten Sieg nicht"
```

---

### Task 3: HUNGRIGER RUCKSACK

**Files:**
- Modify: `src/cards/reactions.js` (`LINGERING_CURSES`), `src/cards/consequences.js` (Eintrag `'HUNGRIGER RUCKSACK'`), `server.js` (neue Funktionen `setzeZugphase`, `rucksackWurf`; die fünf Stellen, die `turnPhase` auf `'gabe'`/`combatEndPhase(...)` setzen; `endTurn`)
- Test: `tests/card-regelluecken-welle2.test.js`

**Interfaces:**
- Consumes: `hatFluchArt`, `wurfMitFenster` (in server.js vorhanden, Bauform siehe `case 'diceDiscardHand'`).
- Produces: `setzeZugphase(room, phase)`; Wirkungsart `hungrigerRucksack`.

- [ ] **Step 1: Tests anhängen (vor `fertig();`)**

```js
// --- HUNGRIGER RUCKSACK: "Am Ende jedes deiner Zuege wuerfelst du, bevor
// 'Milde Gabe' verteilt oder abgelegt wird ... Bei einer gewuerfelten 6
// verschluckt der Rucksack sich selbst und verschwindet."
{
  const rucksack = findCard('HUNGRIGER RUCKSACK').id;
  const handKarten = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 4).map((c) => c.id);
  const wurf = (zahl) => {
    const p = makePlayer({ hand: handKarten.slice() });
    const room = makeRoom([p], { turnPhase: 'pluendern' });
    S.addActiveCurse(room, p, 'HUNGRIGER RUCKSACK', rucksack);
    const zufall = Math.random;
    Math.random = () => (zahl - 1) / 6 + 0.01; // rollDie() -> zahl
    try { S.setzeZugphase(room, 'gabe'); } finally { Math.random = zufall; }
    return { p, room };
  };
  const zwei = wurf(2);
  assert.strictEqual(zwei.p.hand.length, 2, 'Wurf 2: zwei Handkarten gefressen');
  assert.strictEqual(zwei.room.treasureDiscard.length, 2, 'die Karten liegen auf dem Ablagestapel');
  assert.ok(zwei.p.activeCurses.some((f) => f.kind === 'hungrigerRucksack'), 'der Fluch bleibt');

  const sechs = wurf(6);
  assert.strictEqual(sechs.p.hand.length, 4, 'Wurf 6: die Hand bleibt unversehrt');
  assert.ok(!sechs.p.activeCurses.some((f) => f.kind === 'hungrigerRucksack'), 'Wurf 6: der Fluch endet');
}
// Nur einmal pro Zug, und nur im Zug der verfluchten Person.
{
  const rucksack = findCard('HUNGRIGER RUCKSACK').id;
  const handKarten = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 4).map((c) => c.id);
  const p = makePlayer({ hand: handKarten.slice() });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })], { turnPhase: 'pluendern' });
  S.addActiveCurse(room, p, 'HUNGRIGER RUCKSACK', rucksack);
  const zufall = Math.random;
  Math.random = () => 0.01; // rollDie() -> 1
  try {
    S.setzeZugphase(room, 'gabe');
    S.setzeZugphase(room, 'gabe'); // zweiter Uebergang im selben Zug
  } finally { Math.random = zufall; }
  assert.strictEqual(p.hand.length, 3, 'der Wurf faellt pro Zug nur einmal');

  const fremd = makePlayer({ id: 'p2', name: 'B', hand: handKarten.slice() });
  const room2 = makeRoom([makePlayer({ id: 'p1', name: 'A' }), fremd], { turnPhase: 'pluendern', turnIndex: 0 });
  S.addActiveCurse(room2, fremd, 'HUNGRIGER RUCKSACK', rucksack);
  Math.random = () => 0.01;
  try { S.setzeZugphase(room2, 'gabe'); } finally { Math.random = zufall; }
  assert.strictEqual(fremd.hand.length, 4, 'im fremden Zug frisst der Rucksack nicht');
}
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle2.test.js`
Expected: FAIL mit `S.setzeZugphase is not a function`.

- [ ] **Step 3: Implementieren**

`src/cards/reactions.js`, `LINGERING_CURSES`:

```js
    // "Am Ende jedes deiner Zuege wuerfelst du, bevor 'Milde Gabe' verteilt
    // oder abgelegt wird ... Bei einer 6 verschluckt der Rucksack sich selbst."
    'HUNGRIGER RUCKSACK': { kind: 'hungrigerRucksack', dauer: 'dauerhaft',
      hinweis: 'Am Ende jedes deiner Züge frisst der Rucksack gewürfelt viele Handkarten (bei einer 6 ist er weg).' },
```

`src/cards/consequences.js`: `'HUNGRIGER RUCKSACK': () => null,` ersetzen durch denselben `lingeringCurse`-Aufbau, `name: 'HUNGRIGER RUCKSACK'`.

`server.js`, neben den übrigen Zugphasen-Hilfen:

```js
// Eine Stelle fuer den Phasenwechsel, damit Effekte, die an einer Phase
// haengen, nicht an jedem der Uebergaenge einzeln stehen muessen.
function setzeZugphase(room, phase) {
  room.turnPhase = phase;
  if (phase === 'gabe') rucksackWurf(room);
}

// HUNGRIGER RUCKSACK: der Wurf faellt beim Uebergang in die Milde Gabe -
// "bevor Milde Gabe verteilt oder abgelegt wird". Pro Zug nur einmal
// (room.rucksackWurfZug), und nur fuer die Person, die gerade am Zug ist.
function rucksackWurf(room) {
  const p = currentPlayer(room);
  if (!p || !hatFluchArt(p, 'hungrigerRucksack')) return;
  if (room.rucksackWurfZug === room.turnIndex) return;
  room.rucksackWurfZug = room.turnIndex;
  wurfMitFenster(room, p, 'hungrigerRucksack', (roll) => {
    if (roll === 6) {
      clearActiveCurseByKind(p, 'hungrigerRucksack');
      log(room, `Würfelwurf ${roll}: der Hungrige Rucksack verschluckt sich selbst - ${p.name} ist ihn los.`);
      return `Würfelwurf ${roll} -> der Rucksack verschwindet`;
    }
    const anzahl = Math.min(roll, p.hand.length);
    for (let i = 0; i < anzahl; i++) {
      const id = p.hand[Math.floor(Math.random() * p.hand.length)];
      removeFromHand(p, id);
      clearCheatIfLost(p, id);
      discardCard(room, id);
    }
    log(room, `Würfelwurf ${roll}: der Hungrige Rucksack frisst ${anzahl} Handkarte(n) von ${p.name}.`);
    return `Würfelwurf ${roll} -> ${anzahl} Handkarte(n) gefressen`;
  });
}
```

Vor dem Schreiben `wurfMitFenster` in server.js lesen (Bauform und Rückgabewert, siehe `case 'diceDiscardHand'`) und die Signatur genau so benutzen; liegt der Wurf hinter einem Reaktionsfenster, läuft der Rumpf erst später – das ist gewollt.

Alle Stellen, die die Phase auf `'gabe'` setzen, auf `setzeZugphase` umstellen (mit `grep -n "turnPhase = " server.js` finden; betroffen sind heute fünf: der direkte `'gabe'`-Übergang nach dem Plündern und die vier über `combatEndPhase(...)`), zum Beispiel:

```js
  setzeZugphase(room, combatEndPhase(c, thenLoot));
```

In `endTurn` die Zugmarkierung zurücksetzen, damit der nächste Zug wieder würfelt – direkt nach der Zeile, die `room.turnIndex` weiterschaltet:

```js
  room.rucksackWurfZug = null;
```

`setzeZugphase` in `module.exports` aufnehmen.

- [ ] **Step 4: Tests grün, volle Suite, Commit**

Run: `node tests/card-regelluecken-welle2.test.js` → grün; `npm test` → alle erfolgreich.

```bash
git add server.js src/cards/reactions.js src/cards/consequences.js tests/card-regelluecken-welle2.test.js
git commit -m "fix: HUNGRIGER RUCKSACK frisst am Zugende gewuerfelt viele Handkarten"
```

---

### Task 4: GUMMI-GOLEM (Zuckerschock)

**Files:**
- Modify: `src/cards/reactions.js` (`LINGERING_CURSES`), `src/cards/consequences.js` (Eintrag `'GUMMI-GOLEM'`), `server.js` (`hatSchatzSperre`, neue Funktion `zuckerschockAktiv`, `startCombat`, `handleRespondHelp`)
- Test: `tests/card-regelluecken-welle2.test.js`

**Interfaces:**
- Produces: Wirkungsart `zuckerschock` mit Feld `schatzStand` (Zahl der besessenen Schatzkarten beim Eintragen); `zuckerschockAktiv(player)`.

- [ ] **Step 1: Tests anhängen (vor `fertig();`)**

```js
// --- GUMMI-GOLEM: "Du musst in jedem Kampf deine Hilfe anbieten, darfst
// keinen Schatz annehmen, bis du einen verlierst."
{
  const golem = findCard('GUMMI-GOLEM', 'monster');
  const schatz = findCard('FLAMMENDER GIFTTRANK').id;
  const p = makePlayer({ hand: [schatz] });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  S.addActiveCurse(room, p, 'GUMMI-GOLEM', golem.id);
  const eintrag = p.activeCurses.find((f) => f.kind === 'zuckerschock');
  assert.ok(eintrag, 'Zuckerschock ist eingetragen');
  assert.strictEqual(eintrag.schatzStand, 1, 'der Schatzstand beim Eintragen ist festgehalten');
  assert.ok(S.hatSchatzSperre(p), 'kein Schatz, solange der Fluch laeuft');
  assert.deepStrictEqual(S.zieheSchaetzeFuer(room, p, 2), [], 'es wird kein Schatz gezogen');

  // Ende: eine Schatzkarte verlieren.
  p.hand = [];
  assert.ok(!S.hatSchatzSperre(p), 'nach dem Verlust endet die Sperre');
  assert.ok(!p.activeCurses.some((f) => f.kind === 'zuckerschock'), 'der Fluch ist beendet');
}
// Hilfe anbieten: Logzeile bei Kampfbeginn, und die Zusage kann nicht abgelehnt werden.
{
  const golem = findCard('GUMMI-GOLEM', 'monster');
  const monster = findCard('LAHMER GOBLIN', 'monster');
  const a = makePlayer({ id: 'p1', name: 'A' });
  const h = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([a, h]);
  S.addActiveCurse(room, h, 'GUMMI-GOLEM', golem.id);
  S.startCombat(room, 'p1', [monster.id], { fromHand: false });
  assert.ok(room.logs.some((l) => /Zuckerschock|bietet .*Hilfe an/i.test(l.text)), 'das Angebot steht im Verlauf');
  S.handleRequestHelp(room, 'p1', 'p2', 0);
  S.handleRespondHelp(room, 'p2', false); // Ablehnen versucht
  assert.strictEqual(room.combat.helperId, 'p2', 'wer im Zuckerschock ist, darf nicht ablehnen');
}
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle2.test.js`
Expected: FAIL bei `Zuckerschock ist eingetragen`.

- [ ] **Step 3: Implementieren**

`src/cards/reactions.js`, `LINGERING_CURSES`:

```js
    // "Zuckerschock! Du musst in JEDEM Kampf deine Hilfe anbieten, darfst
    // keinen Schatz annehmen, bis du einen verlierst."
    'GUMMI-GOLEM': { kind: 'zuckerschock', dauer: 'dauerhaft',
      hinweis: 'Du musst in jedem Kampf Hilfe anbieten und bekommst keinen Schatz, bis du einen verlierst.' },
```

`src/cards/consequences.js`: `'GUMMI-GOLEM': () => null,` ersetzen durch denselben `lingeringCurse`-Aufbau, `name: 'GUMMI-GOLEM'`.

`server.js`, in `applyLingeringRule` (dort entsteht der Eintrag) den Startwert festhalten – direkt vor `player.activeCurses.push({...})`:

```js
  // GUMMI-GOLEM: "bis du einen verlierst" - der Stand beim Eintragen ist der
  // Vergleichswert (siehe zuckerschockAktiv).
  const schatzStand = regel.kind === 'zuckerschock' ? besesseneSchaetze(player).length : undefined;
```

und im `push({...})` das Feld `schatzStand,` ergänzen. Dazu neben `hatSchatzSperre`:

```js
// Alle Schatzkarten im Besitz: Hand und Angelegtes.
function besesseneSchaetze(player) {
  return [...player.hand, ...equippedItemIds(player)].filter((id) => (card(id) || {}).type === 'treasure');
}

// GUMMI-GOLEM: die Sperre endet, sobald die Person eine Schatzkarte verliert -
// gemessen am Stand beim Eintragen. Geprueft beim LESEN (wie
// stinktierStrafeAktiv), damit kein Verlustweg vergessen werden kann.
function zuckerschockAktiv(player) {
  const eintrag = (player && player.activeCurses || []).find((f) => f.kind === 'zuckerschock');
  if (!eintrag) return false;
  if (besesseneSchaetze(player).length < (eintrag.schatzStand || 0)) {
    player.activeCurses = player.activeCurses.filter((f) => f !== eintrag);
    return false;
  }
  return true;
}
```

`hatSchatzSperre` erweitern:

```js
function hatSchatzSperre(player) {
  return !!player && ((player.activeCurses || []).some((f) => f.kind === 'noTreasure') || zuckerschockAktiv(player));
}
```

`startCombat`, nachdem `room.combat` steht:

```js
  // GUMMI-GOLEM: "Du musst in jedem Kampf deine Hilfe anbieten." Der Server
  // meldet das Angebot an - annehmen muss es niemand (siehe Karte).
  room.players.forEach((p) => {
    if (p.id !== actorId && zuckerschockAktiv(p)) {
      log(room, `${p.name} steht unter Zuckerschock und bietet ${findPlayer(room, actorId).name} seine Hilfe an.`);
    }
  });
```

`handleRespondHelp`: eine Ablehnung der verfluchten Person wird zur Zusage. Vor der Stelle, an der `accept === false` ausgewertet wird:

```js
  // Zuckerschock: die Hilfe ist Pflicht - eine Ablehnung zaehlt als Zusage.
  if (!accept && zuckerschockAktiv(findPlayer(room, playerId))) {
    log(room, `${findPlayer(room, playerId).name} muss unter Zuckerschock helfen und kann nicht ablehnen.`);
    accept = true;
  }
```

(`accept` ist ein Parameter; falls er `const` gebunden ist, eine lokale Variable einführen statt ihn zu überschreiben.)

`besesseneSchaetze`, `zuckerschockAktiv` und – falls noch nicht exportiert – `hatSchatzSperre`, `zieheSchaetzeFuer`, `handleRequestHelp`, `handleRespondHelp` in `module.exports` aufnehmen.

- [ ] **Step 4: Tests grün, volle Suite, Commit**

Run: `node tests/card-regelluecken-welle2.test.js` → grün; `npm test` → alle erfolgreich.

```bash
git add server.js src/cards/reactions.js src/cards/consequences.js tests/card-regelluecken-welle2.test.js
git commit -m "fix: GUMMI-GOLEM - Zuckerschock (Hilfe anbieten, kein Schatz bis zum Verlust)"
```

---

### Task 5: Nachträge – RIESENKAKERLAKE und Abdeckungs-Scan

**Files:**
- Modify: `src/cards/passives.js` (`MONSTER_TRAIT_BONUS`-Eintrag `'RIESENKAKERLAKE'`), `server.js` (`monsterTraitBonusSum`), `tools/coverage-scan.js`
- Test: `tests/card-regelluecken-welle2.test.js`

- [ ] **Step 1: Tests anhängen (vor `fertig();`)**

```js
// --- RIESENKAKERLAKE "+5 gegen Elfen oder Menschen": ein Halb-Blut-Elf hat
// laut Karte keine Nachteile seiner Rasse - und ist auch kein Mensch.
{
  const kakerlake = findCard('RIESENKAKERLAKE', 'monster');
  const elf = findCard('ELF', 'race').id;
  const halbBlut = findCard('HALB-BLUT').id;
  const staerke = (p) => { const room = makeRoom([p]); S.startCombat(room, p.id, [kakerlake.id], { fromHand: false }); return S.combatTotals(room).monsterStrength; };
  assert.strictEqual(staerke(makePlayer({ races: [elf] })), kakerlake.level + 5, 'Gegenprobe: echter Elf bekommt +5 ab');
  assert.strictEqual(staerke(makePlayer({ races: [elf], raceCapCard: halbBlut })), kakerlake.level, 'Halb-Blut-Elf: kein Bonus');
  assert.strictEqual(staerke(makePlayer({})), kakerlake.level + 5, 'Mensch bekommt weiter +5 ab');
}
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle2.test.js`
Expected: FAIL bei `Halb-Blut-Elf: kein Bonus`.

- [ ] **Step 3: Implementieren**

`src/cards/passives.js`:

```js
    // "+5 gegen Elfen oder Menschen." - eine Regel, nicht zwei: ein Elf ist
    // kein Mensch, die Faelle schliessen sich aus. nachteilFuer: HALB-BLUT
    // schuetzt auch hier (ein Halb-Elf ist weder Elf mit Nachteil noch Mensch).
    'RIESENKAKERLAKE': { wennErfuellt: (p) => monsterSeesRace(p, 'ELF') || istMensch(p), bonus: 5, nachteilFuer: 'races' },
```

`server.js`, `monsterTraitBonusSum`: in der Zeile, die `rule.wennErfuellt` auswertet, den Schutz mitprüfen:

```js
        || (rule.wennErfuellt && !(immun && rule.nachteilFuer && traitImmun(p, rule.nachteilFuer))
            ? rule.wennErfuellt(p, room) : false));
```

Vor dem Schreiben die vorhandene Zeile lesen und die Klammerung übernehmen – die Bedingung steht in einem `some(...)` über die Kampfteilnehmenden.

`tools/coverage-scan.js`, in `abgedeckt()` ergänzen:

```js
  || S.TREASURE_REACTION_CARDS.has(c.name)
```

(`TREASURE_REACTION_CARDS` ist in `module.exports` von server.js vorhanden – sonst dort ergänzen.)

- [ ] **Step 4: Scan prüfen**

Run: `node tools/coverage-scan.js unnaturalaxe`
Expected: keine Zeile mit ` - ` mehr (TROJANISCHER PFERD verschwindet).
Run: `node tools/coverage-scan.js clericalerrors`
Expected: die vier Karten aus den Tasks 1-4 sind verschwunden; übrig bleibt höchstens, was diese Welle nicht anfasst – die Ausgabe in den Report schreiben.

- [ ] **Step 5: Tests grün, volle Suite, Commit**

Run: `node tests/card-regelluecken-welle2.test.js` → grün; `npm test` → alle erfolgreich.

```bash
git add server.js src/cards/passives.js tools/coverage-scan.js tests/card-regelluecken-welle2.test.js
git commit -m "fix: RIESENKAKERLAKE schont Halb-Blut-Elfen, Abdeckungs-Scan kennt TREASURE_REACTION_CARDS"
```

---

### Task 6: Abschluss – WUNSCHRING-Probe, Review, PR

- [ ] **Step 1: Gemeinsamer Test, dass der WUNSCHRING jeden der vier Flüche beendet**

Test anhängen (vor `fertig();`):

```js
// --- Der WUNSCHRING beendet jeden der vier neuen Fluechen.
{
  const ring = findCard('WUNSCHRING');
  [['TOURISTENFALLE', 'keinAergerSuchen'], ['TEMPORÄRE ANMNESIE', 'traitsVergessen'],
   ['HUNGRIGER RUCKSACK', 'hungrigerRucksack'], ['GUMMI-GOLEM', 'zuckerschock']].forEach(([name, kind]) => {
    const quelle = findCard(name);
    const p = makePlayer({ hand: [ring.id] });
    const room = makeRoom([p]);
    S.addActiveCurse(room, p, name, quelle.id);
    assert.ok(p.activeCurses.some((f) => f.kind === kind), `${name}: Fluch eingetragen`);
    S.handleUseCardPower(room, 'p1', ring.id);
    if (room.pendingCardAction && room.pendingCardAction.options) {
      S.handleResolveCardChoice(room, 'p1', room.pendingCardAction.options[0].id);
    }
    assert.ok(!p.activeCurses.some((f) => f.kind === kind), `${name}: der Wunschring beendet ihn`);
  });
}
```

Run: `node tests/card-regelluecken-welle2.test.js` → grün (der Ring arbeitet über `fluchBeendenSpec`, die Flüche brauchen dafür keinen Zusatzcode; schlägt ein Fall fehl, ist das ein echter Befund – im Report melden).
Run: `npm test` → alle erfolgreich.

```bash
git add tests/card-regelluecken-welle2.test.js
git commit -m "test: WUNSCHRING beendet die vier neuen Flueche"
```

- [ ] **Step 2: Code-Review** (superpowers:requesting-code-review, Basis `origin/main`), Befunde prüfen und beheben.

- [ ] **Step 3: Push + PR** auf `DuckOfJustice` pushen, PR gegen `Marmelade1357/Munchkin` `main`. Im PR-Text erwähnen: PR #17 (Welle 1) ist noch offen und berührt `hasRace`/`hasClass` ebenfalls – beim Mergen auf die Reihenfolge achten.
