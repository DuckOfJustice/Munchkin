# Basis-Set-Kartenkräfte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die im Audit gefundenen, im Server nicht nutzbaren Kartenkräfte des Basis-Sets tatsächlich spielbar machen, ohne funktionierende Karten zu beschädigen.

**Architecture:** Sieben kleine Mechanismen (Modul-Auslagerung, Fluch-Tracker, bedingtes Reaktionsfenster, Aktions-Warteschlange, Kampfreaktionen, Kartenanhänge, Siegregel, Große Gegenstände) statt einer generischen Reaktions-Engine. Kartenspezifisches bleibt in kuratierten, per exaktem Kartennamen indizierten Tabellen - dem Muster, das das Projekt seit Beginn nutzt.

**Tech Stack:** Node.js (>=14), Express, Socket.IO. Keine Datenbank, `rooms` liegt im Arbeitsspeicher. Tests: reines `assert` aus der Standardbibliothek, Runner `tests/run.js`, kein Framework.

**Spec:** `docs/superpowers/specs/2026-09-12-basis-set-kartenkraefte-design.md`

## Global Constraints

- **Sprache:** Alle Kommentare, Log-Ausgaben und Spieltexte auf Deutsch. Bezeichner im bestehenden Stil (`handleXyz`, `MONSTER_TRAIT_BONUS`).
- **Kartennamen exakt wie in `data/cards.json`**, inklusive Eigenheiten: `GOTTLICHE INTERVENTION` (ohne Umlaut), `UNSICHTSBARKEITSTRANK` (mit S), `STRUMPFHOSE DER RIESENSTÄRK` (ohne E am Ende).
- **Jede Tabellenzeile trägt den Original-Kartentext als Kommentar.** Das ist im ganzen Projekt so und ist die einzige Stelle, an der der Text nachlesbar ist.
- **`module.exports` von `server.js` behält jede heutige Zeile.** Ergänzen ist erlaubt, entfernen oder umbenennen nicht. Die sechs bestehenden Testdateien dürfen nicht angefasst werden.
- **Neue Kampfwerte müssen durch `combatTotals` (`server.js:2041`) fließen**, nicht daran vorbei. `combatSignature` (`server.js:2012`) enthält bereits `t.playerStrength` und `t.monsterStrength`; wer durch `combatTotals` rechnet, ist automatisch korrekt. Wer direkt in `handleEvaluateCombat` rechnet, lässt den Bereit-Status der Mitspielenden veralten.
- **Jede neue Interaktion braucht einen Bot-Pfad.** Ein Bot, der auf einen Dialog warten muss, lässt die Partie stehen. `combatReadyRequired` (`server.js:1993`) schließt Bots bereits aus; für `pendingCardAction` liefert Task 3 den generischen Auflöser.
- **Bewusste Vereinfachungen mit `// ponytail:` markieren**, inklusive der Obergrenze und des Aufrüstwegs.
- **Testbefehl immer `npm test`** (läuft alle Dateien). Einzelne Datei: `node tests/<name>.test.js`.

### Bekannte Stolperfalle: die Abdeckungs-Schranke

`tests/auto-consequence.test.js:113` behauptet:

```js
assert.ok(manual >= 20, `Zu viele Karten automatisch erkannt (${manual} manuell) ...`);
```

Der Wert steht heute bei **28**. Die Schranke ist eine Absicherung gegen eine
zu großzügige Regex-Regel, die versehentlich Karten einfängt - sie ist **kein**
Ziel, das erhalten bleiben muss, wenn Karten durch **kuratierte** Einträge
automatisiert werden.

Verlauf über diesen Plan: Task 2 automatisiert 3 Karten (→ 25, bleibt grün),
Task 9 weitere 7 (→ **18, der Test schlägt fehl**).

**Regel dafür:** Diese eine Zahl darf gesenkt werden, und **nur** sie, und nur
in der Task, die sie tatsächlich reißt (Task 9), mit einem Kommentar, der sagt
welche Karten dazugekommen sind. Wer sie vorsorglich in einer früheren Task
senkt, nimmt der Schranke ihren Zweck. Wer irgendeinen *anderen* Test anpasst,
um ihn grün zu bekommen, hat einen echten Fehler versteckt - dann abbrechen
und melden.

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `src/cards/consequences.js` | **neu** - `CONSEQUENCE_OVERRIDES`, `DOOR_OTHER_AS_CURSE` (verschoben) |
| `src/cards/treasures.js` | **neu** - Schatzkarten-Tabellen (verschoben) |
| `src/cards/passives.js` | **neu** - Dauerwirkungstabellen (verschoben) |
| `src/cards/bigitems.js` | **neu** - `BIG_ITEMS` + `isBigItem` |
| `src/cards/reactions.js` | **neu** - alle Tabellen dieser Runde |
| `server.js` | Handler, Zustand, Sockets. Tabellen nur noch `require`n |
| `public/client.js` | Neue Knöpfe in `renderHand`, neue Arten in `renderCardAction` |
| `tests/card-*.test.js` | Je Task eine neue Datei |

## Task-Abhängigkeiten

```
Task 1 (M0)  ─┬─> Task 2 (M7)  ─┬─> Task 6 (M5)
              ├─> Task 3 (M3)  ─┼─> Task 9 (Schlimme Dinge)
              ├─> Task 4 (M2)  ─┼─> Task 12 (Klassenkräfte)
              ├─> Task 5 (M6)  ─┘
              ├─> Task 11 (Kleinkram)
              └─> Task 7 (M1) ──> Task 8 (M4) ──> Task 10 (Kampf-Alternativen)
                                                       │
                                              Task 13 (Abnahme)
```

Task 7 und Task 8 rechnen beide in `combatTotals` und laufen deshalb **nacheinander**, nicht parallel.

---

### Task 1: Kartentabellen nach `src/cards/` auslagern

Verhaltensneutral. Beweis ist, dass die bestehenden Tests **unverändert** grün bleiben.

**Files:**
- Create: `src/cards/consequences.js`, `src/cards/treasures.js`, `src/cards/passives.js`
- Modify: `server.js` (Tabellendefinitionen entfernen, `require` einsetzen)
- Test: keine neue Datei - die sechs bestehenden sind der Test

**Interfaces:**
- Produces: Jedes Modul exportiert `(ctx) => tabellenObjekt`. `ctx` ist
  `{ card, hasRace, hasClass, hasPowerGroup, resolveConsequenceSpec, isMonsterEnhancerCard, applyDeathConsequence }`.
  Die Tabellen selbst behalten exakt ihre heutigen Namen und Formen.

- [ ] **Step 1: Grünen Ausgangszustand festhalten**

Run: `npm test`
Expected: `6/6 Tests erfolgreich.` Wenn nicht, hier abbrechen und melden - alles Weitere baut darauf auf.

- [ ] **Step 2: `src/cards/passives.js` anlegen**

Die Tabellen aus `server.js:1650-1866` wortgleich verschieben, inklusive aller Kommentare. Gerüst:

```js
// Dauerwirkungen von Karten: Regeln, die ohne Zutun gelten, sobald die Karte
// im Spiel ist. Kuratiert statt per Regex - die Formulierungen auf den Karten
// sind zu uneinheitlich ("Elfen haben -4!" gegenüber "+6 gegen Elfen").
module.exports = (ctx) => {
  const { hasRace, hasClass } = ctx;

  const CURSE_PROOF_ITEMS = new Set(['SCHUTZSANDALEN']);

  const MONSTER_REFUSES = {
    // "Greift niemanden mit Stufe 5 oder niedriger an."
    'PLUTONIUMDRACHE': (p) => p.level <= 5,
    // ... alle weiteren Zeilen wortgleich aus server.js übernehmen
    'ANWALT': (p) => hasClass(p, 'DIEB'),
  };

  // ... MONSTER_AUTO_KILL_BY_RACE, MONSTER_PASS_OPTION, MONSTER_TRAIT_BONUS,
  // MONSTER_IGNORES_LEVEL, MONSTER_IGNORES_BONUSES, MONSTER_FORBIDS_HELP,
  // FLEE_ITEM_BONUS, FLEE_MONSTER_MOD, FLEE_IMPOSSIBLE, FLEE_AUTOMATIC,
  // FLEE_PENALTY, FLEE_TREASURE_ITEMS, MONSTER_EXTRA_LEVEL, FIRE_ITEMS,
  // CLASS_COMBAT_DISCARD, UNDEAD_MONSTERS, CLASS_FLEE_DISCARD,
  // ITEM_CONDITIONAL_BONUS, SPECIAL_SLOT_ITEMS, SPECIAL_SLOTS

  return {
    CURSE_PROOF_ITEMS, MONSTER_REFUSES, MONSTER_AUTO_KILL_BY_RACE,
    MONSTER_PASS_OPTION, MONSTER_TRAIT_BONUS, MONSTER_IGNORES_LEVEL,
    MONSTER_IGNORES_BONUSES, MONSTER_FORBIDS_HELP, FLEE_ITEM_BONUS,
    FLEE_MONSTER_MOD, FLEE_IMPOSSIBLE, FLEE_AUTOMATIC, FLEE_PENALTY,
    FLEE_TREASURE_ITEMS, MONSTER_EXTRA_LEVEL, FIRE_ITEMS,
    CLASS_COMBAT_DISCARD, UNDEAD_MONSTERS, CLASS_FLEE_DISCARD,
    ITEM_CONDITIONAL_BONUS, SPECIAL_SLOT_ITEMS, SPECIAL_SLOTS,
  };
};
```

**Wichtig:** `ITEM_CONDITIONAL_BONUS` und `SPECIAL_SLOT_ITEMS` stehen in `server.js` weit oben (Zeile 246 bzw. 313), nicht im Dauerwirkungs-Block. Trotzdem hierher.

- [ ] **Step 3: In `server.js` einsetzen und sofort prüfen**

```js
const passivesFactory = require('./src/cards/passives.js');
```

Der Aufruf muss **nach** der Definition von `hasRace`/`hasClass`/`card` stehen, aber **vor** der ersten Benutzung der Tabellen. Praktisch: direkt vor der Stelle, an der heute `CURSE_PROOF_ITEMS` steht.

```js
const {
  CURSE_PROOF_ITEMS, MONSTER_REFUSES, MONSTER_AUTO_KILL_BY_RACE,
  MONSTER_PASS_OPTION, MONSTER_TRAIT_BONUS, MONSTER_IGNORES_LEVEL,
  MONSTER_IGNORES_BONUSES, MONSTER_FORBIDS_HELP, FLEE_ITEM_BONUS,
  FLEE_MONSTER_MOD, FLEE_IMPOSSIBLE, FLEE_AUTOMATIC, FLEE_PENALTY,
  FLEE_TREASURE_ITEMS, MONSTER_EXTRA_LEVEL, FIRE_ITEMS,
  CLASS_COMBAT_DISCARD, UNDEAD_MONSTERS, CLASS_FLEE_DISCARD,
  ITEM_CONDITIONAL_BONUS, SPECIAL_SLOT_ITEMS, SPECIAL_SLOTS,
} = passivesFactory({ card, hasRace, hasClass });
```

`SPECIAL_SLOT_KEYS` bleibt in `server.js` (wird aus `SPECIAL_SLOTS` abgeleitet).

Run: `npm test`
Expected: `6/6 Tests erfolgreich.` Bei `ReferenceError: Cannot access 'hasRace' before initialization` steht der Factory-Aufruf zu früh - nach oben/unten schieben, nicht die Reihenfolge der Funktionen ändern.

- [ ] **Step 4: Commit**

```bash
git add src/cards/passives.js server.js
git commit -m "Dauerwirkungstabellen nach src/cards/passives.js ausgelagert"
```

- [ ] **Step 5: `src/cards/consequences.js` genauso**

`CONSEQUENCE_OVERRIDES` (`server.js:983-1196`) und `DOOR_OTHER_AS_CURSE` (`server.js:1198`). Benötigt zusätzlich `resolveConsequenceSpec` (für `STERBENDER FLUCH`), `card`, `hasRace`, `hasPowerGroup`, `isMonsterEnhancerCard`.

`STERBENDER FLUCH` ruft `resolveConsequenceSpec` auf, das seinerseits `CONSEQUENCE_OVERRIDES` liest - ein Zyklus. Er löst sich auf, weil der Aufruf erst zur Laufzeit passiert: `ctx.resolveConsequenceSpec` als Funktionsreferenz durchreichen, nicht das Ergebnis.

Run: `npm test` → 6/6. Commit.

- [ ] **Step 6: `src/cards/treasures.js` genauso**

`TREASURE_POWER_OVERRIDES` (`:1339`), `COMBAT_POTION_OVERRIDES` (`:2137`), `DOOR_COMBAT_CARDS` (`:2206`), `POST_FLEE_ESCAPE_CARDS` (`:2595`), `GUARANTEED_FLEE_CARDS` (`:2663`), `GUARANTEED_FLEE_MAX_MONSTER_LEVEL` (`:2668`).

Run: `npm test` → 6/6. Commit.

- [ ] **Step 7: Abnahme**

Run: `git diff --stat HEAD~3 -- tests/`
Expected: **leer.** Wurde eine Testdatei angefasst, war der Umzug nicht verhaltensneutral - zurückrollen und die echte Ursache suchen.

Run: `npm test`
Expected: `6/6 Tests erfolgreich.`

---

### Task 2: Große Gegenstände (M7)

**Files:**
- Create: `src/cards/bigitems.js`, `tests/card-bigitems.test.js`
- Modify: `server.js` (`handleEquipItem` ~`:2706`, `applyPrimitiveAction` ~`:653`, `CONSEQUENCE_OVERRIDES`-Einträge in `src/cards/consequences.js`, `module.exports`)
- Modify: `public/client.js` (`renderHand`, Hinweis warum "Anlegen" fehlt)

**Interfaces:**
- Consumes: Task 1 (`src/cards/` existiert)
- Produces:
  - `BIG_ITEMS: Set<string>` - Kartennamen
  - `isBigItem(c): boolean` - `c` ist ein Kartenobjekt oder `null`
  - `bigItemCount(player): number` - angelegte **und** in der Hand befindliche zählen **nicht**; nur angelegte
  - `canCarryAnotherBigItem(player): boolean`
  - Aktion `{ type: 'discardBigItem' }` in `applyPrimitiveAction`

- [ ] **Step 1: Test schreiben**

`tests/card-bigitems.test.js`:

```js
// Grosse Gegenstaende: Nicht-Zwerge duerfen nur einen tragen, Zwerge beliebig
// viele. Verhaltenstest - baut einen echten Raum und ruft die Handler auf.
const assert = require('assert');
const {
  ALL_CARDS, isBigItem, handleEquipItem, equippedItemIds, newEquipped, hasRace,
} = require('../server.js');

function byName(name) {
  const c = ALL_CARDS.find((x) => x.name === name);
  assert.ok(c, `Karte "${name}" nicht in den Kartendaten gefunden`);
  return c;
}

function makePlayer(overrides) {
  return Object.assign({
    id: 'p1', name: 'Test', level: 5, hand: [], races: [], classes: [], powerGroups: [],
    raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), isBot: false, connected: true,
  }, overrides || {});
}

function makeRoom(players) {
  return { code: 'TEST', players, doorDiscard: [], treasureDiscard: [], log: [], combat: null };
}

// 1) Die kuratierte Liste trifft die abgestimmten acht Karten
const erwartet = [
  'KETTENSÄGE DER BLUTIGEN ZERSTÜCKELUNG', 'STANGE, 11-FUSS', 'RIESIGER FELS',
  'MITHRIL-RÜSTUNG', 'SCHWEIZER ARMEEHELLEBARDE', 'GANZKÖRPER-SCHILD',
  'TUBA DER VERZAUBERUNG', 'TRITTLEITER',
];
erwartet.forEach((n) => assert.ok(isBigItem(byName(n)), `${n} muesste gross sein`));
['BOGEN MIT BUNTEN BÄNDERN', 'NAPALMSTAB', 'KURZE, BREITE RÜSTUNG',
 'STRUMPFHOSE DER RIESENSTÄRK'].forEach((n) => {
  assert.ok(!isBigItem(byName(n)), `${n} darf NICHT gross sein`);
});

// 2) Nicht-Zwerg: zweiter Grosser Gegenstand wird abgelehnt
{
  const fels = byName('RIESIGER FELS');          // 2 Haende, gross
  const mithril = byName('MITHRIL-RÜSTUNG');     // Ruestung, gross
  const p = makePlayer({ hand: [fels.id, mithril.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, mithril.id);
  assert.ok(equippedItemIds(p).includes(mithril.id), 'erster Grosser Gegenstand muss anlegbar sein');
  handleEquipItem(room, p.id, fels.id);
  assert.ok(!equippedItemIds(p).includes(fels.id), 'zweiter Grosser Gegenstand muss abgelehnt werden');
  assert.ok(p.hand.includes(fels.id), 'abgelehnte Karte bleibt auf der Hand');
}

// 3) Zwerg: beliebig viele
{
  const zwerg = ALL_CARDS.find((x) => x.name === 'ZWERG');
  const fels = byName('RIESIGER FELS');
  const mithril = byName('MITHRIL-RÜSTUNG');
  const p = makePlayer({ hand: [fels.id, mithril.id], races: [zwerg.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, mithril.id);
  handleEquipItem(room, p.id, fels.id);
  assert.ok(equippedItemIds(p).includes(mithril.id) && equippedItemIds(p).includes(fels.id),
    'Zwerg muss beide Grossen Gegenstaende tragen duerfen');
}

// 4) Ein kleiner Gegenstand bleibt unbeschraenkt
{
  const leder = byName('LEDERRÜSTUNG');
  const p = makePlayer({ hand: [leder.id] });
  const room = makeRoom([p]);
  handleEquipItem(room, p.id, leder.id);
  assert.ok(equippedItemIds(p).includes(leder.id), 'kleine Gegenstaende bleiben unbeschraenkt');
}

console.log('OK - Grosse Gegenstaende: Liste, Zwergen-Ausnahme, Ablehnung des zweiten.');
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/card-bigitems.test.js`
Expected: FAIL, `TypeError: isBigItem is not a function`

- [ ] **Step 3: `src/cards/bigitems.js` anlegen**

```js
// "Grosser Gegenstand": Nicht-Zwerge duerfen nur EINEN tragen.
//
// ponytail: kuratierte Namensliste statt eines Feldes in data/cards.json -
// dieselbe Bauform wie UNDEAD_MONSTERS, damit die Liste an genau einer Stelle
// korrigierbar bleibt. Die Rohdaten kennen kein "gross"-Merkmal, und die
// Kartenbilder unter public/images/ enthalten nur Artwork, keinen Text.
//
// Diese acht wurden am 2026-09-12 mit dem Nutzer gegen die echten Karten
// abgeglichen. Ausdruecklich NICHT gross, obwohl zunaechst vermutet:
// BOGEN MIT BUNTEN BAENDERN, STRUMPFHOSE DER RIESENSTAERK, NAPALMSTAB,
// KURZE BREITE RUESTUNG. Stimmt etwas nicht mit euren Karten ueberein, hier
// korrigieren - sonst nirgends.
const BIG_ITEMS = new Set([
  'KETTENSÄGE DER BLUTIGEN ZERSTÜCKELUNG',
  'STANGE, 11-FUSS',
  'RIESIGER FELS',
  'MITHRIL-RÜSTUNG',
  'SCHWEIZER ARMEEHELLEBARDE',
  'GANZKÖRPER-SCHILD',
  'TUBA DER VERZAUBERUNG',
  'TRITTLEITER',
]);

function isBigItem(c) {
  return !!c && BIG_ITEMS.has(c.name);
}

module.exports = { BIG_ITEMS, isBigItem };
```

- [ ] **Step 4: In `server.js` einhängen**

Direkt nach `equippedItemIds` (~`:278`):

```js
const { BIG_ITEMS, isBigItem } = require('./src/cards/bigitems.js');

// ZWERG: "Du kannst eine beliebige Anzahl Grosser Gegenstaende tragen und
// ausruesten." Alle anderen duerfen genau einen tragen.
function bigItemCount(player) {
  return equippedItemIds(player).filter((id) => isBigItem(card(id))).length;
}

function canCarryAnotherBigItem(player) {
  return hasRace(player, 'ZWERG') || bigItemCount(player) < 1;
}
```

`hasRace` steht erst bei `:708` - `canCarryAnotherBigItem` wird aber erst zur Laufzeit aufgerufen, Funktionsdeklarationen werden gehoistet, das geht. `bigItemCount` braucht `card` (`:52`) und `equippedItemIds` - beide davor.

In `handleEquipItem` (`:2706`), direkt nach `if (!c) return;`:

```js
  if (isBigItem(c) && !canCarryAnotherBigItem(player)) {
    log(room, `${player.name} kann "${c.name}" nicht anlegen - Grosser Gegenstand, und es wird bereits einer getragen (nur Zwerge duerfen mehrere).`);
    touchRoom(room);
    return;
  }
```

Das muss **vor** dem `specialSlotRule`-Zweig stehen, weil TRITTLEITER und TUBA gross sind und TRITTLEITER auf einem Spezialplatz liegt.

- [ ] **Step 5: Test laufen lassen**

Run: `node tests/card-bigitems.test.js`
Expected: PASS

Run: `npm test`
Expected: `7/7 Tests erfolgreich.`

- [ ] **Step 6: Aktion `discardBigItem` ergänzen**

In `applyPrimitiveAction`, neben `discardSlot`:

```js
    case 'discardBigItem': {
      const ids = equippedItemIds(player).filter((id) => isBigItem(card(id)));
      if (!ids.length) return 'kein Grosser Gegenstand getragen';
      ids.forEach((id) => { unequipSlotCard(player, id); discardCard(room, id); });
      return `Grosse Gegenstaende abgelegt: ${ids.map((id) => card(id).name).join(', ')}`;
    }
```

`GALLERT-OKTAEDER` sagt "Lass **alle** deine Grossen Gegenstaende fallen" - deshalb alle, nicht einer.

- [ ] **Step 7: Die drei freigeschalteten Karten eintragen**

In `src/cards/consequences.js`:

```js
  // "Lass alle deine Grossen Gegenstaende fallen."
  'GALLERT-OKTAEDER': () => ({ type: 'discardBigItem' }),
  // "Waehle einen Grossen Gegenstand aus, den du ablegst."
  'VERLIERE 1 GROSSEN GEGENSTAND': () => ({ type: 'discardBigItem' }),
```

`GRÜNSCHLEIM` steht heute als `() => null` in der Tabelle (bewusst manuell wegen des fehlenden Gross-Flags). Den Eintrag durch den echten Effekt ersetzen und den veralteten Kommentar darüber entfernen.

- [ ] **Step 8: `module.exports` ergänzen**

```js
  BIG_ITEMS, isBigItem, bigItemCount, canCarryAnotherBigItem,
```

- [ ] **Step 9: Tests und Commit**

Run: `npm test`
Expected: `7/7 Tests erfolgreich.`

`auto-consequence.test.js` meldet jetzt `25 bleiben manuell` statt 28 - die drei
neu automatisierten Karten. Die Schranke steht bei `>= 20`, bleibt also grün.
**Hier nichts an der Testdatei ändern** (siehe "Bekannte Stolperfalle" oben).

```bash
git add src/cards/bigitems.js src/cards/consequences.js server.js tests/card-bigitems.test.js
git commit -m "Grosse Gegenstaende: Traglimit, Zwergen-Ausnahme, drei freigeschaltete Fluch-Karten"
```

---

### Task 3: Aktions-Warteschlange + Bot-Auflöser (M3)

Ohne den Bot-Auflöser ist diese Task ein Deadlock-Generator. Beides gehört in einen Commit.

**Files:**
- Modify: `server.js` (`openCardChoice`/`openCardTarget`/`openCardCardChoice` ~`:1401-1425`, die drei `handleResolveCard*`-Handler, `scheduleBotActionsIfNeeded` `:3017`)
- Test: `tests/card-crossplayer.test.js`

**Interfaces:**
- Consumes: Task 1
- Produces:
  - `playerQueueFrom(room, player, mode): string[]` - `mode` ist `'after' | 'before' | 'neighbours' | 'topLevel' | 'allOthers'`. Liefert Spieler-IDs **ohne** `player` selbst, in der Reihenfolge, in der sie handeln sollen.
  - `openQueuedCardAction(room, cardName, queue, specFor)` - `specFor(playerId)` liefert den Inhalt je Person.
  - `advanceCardActionQueue(room)` - rückt vor oder räumt ab.
  - `resolveBotCardAction(room)` - beantwortet eine an einen Bot gerichtete Aktion.

- [ ] **Step 1: Test schreiben**

`tests/card-crossplayer.test.js`:

```js
// Warteschlange fuer Aktionen, die MEHRERE Spieler nacheinander betreffen,
// plus der generische Bot-Aufloeser. Ohne den bliebe die Partie stehen,
// sobald ein Bot an der Reihe ist.
const assert = require('assert');
const {
  playerQueueFrom, openQueuedCardAction, handleResolveCardChoice, newEquipped,
} = require('../server.js');

function makePlayer(id, extra) {
  return Object.assign({
    id, name: id.toUpperCase(), level: 5, hand: [], races: [], classes: [],
    powerGroups: [], raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), isBot: false, connected: true,
  }, extra || {});
}

function makeRoom(players, turnIndex) {
  return {
    code: 'TEST', players, turnIndex: turnIndex || 0, doorDiscard: [],
    treasureDiscard: [], log: [], combat: null, pendingCardAction: null,
  };
}

// 1) Reihenfolgen - jede Karte sagt etwas anderes
{
  const ps = ['a', 'b', 'c', 'd'].map((x, i) => makePlayer(x, { level: i + 1 }));
  const room = makeRoom(ps, 1); // B ist am Zug
  const b = ps[1];

  assert.deepStrictEqual(playerQueueFrom(room, b, 'after'), ['c', 'd', 'a'],
    'ANWALT: "beginnend mit dem Spieler NACH dir"');
  assert.deepStrictEqual(playerQueueFrom(room, b, 'before'), ['a', 'd', 'c'],
    'HIPPOGREIF: "beginnend mit dem Spieler VOR dir"');
  assert.deepStrictEqual(playerQueueFrom(room, b, 'neighbours'), ['a', 'c'],
    'LEPRACHAUN: nur die beiden Nachbarn');
  assert.deepStrictEqual(playerQueueFrom(room, b, 'topLevel'), ['d'],
    'NETZ-TROLL: nur die hoechststufigen, unabhaengig von der Sitzordnung');
  assert.deepStrictEqual(playerQueueFrom(room, b, 'allOthers'), ['a', 'c', 'd'],
    'EINKOMMENSSTEUER: alle anderen');
}

// 2) Gleichstand bei topLevel trifft alle Betroffenen
{
  const ps = [makePlayer('a', { level: 9 }), makePlayer('b', { level: 3 }),
              makePlayer('c', { level: 9 })];
  const room = makeRoom(ps, 1);
  assert.deepStrictEqual(playerQueueFrom(room, ps[1], 'topLevel').slice().sort(), ['a', 'c'],
    'bei Stufengleichstand nehmen beide je einen Gegenstand');
}

// 3) Die Warteschlange rueckt vor und raeumt am Ende ab
{
  const ps = ['a', 'b', 'c'].map((x) => makePlayer(x));
  const room = makeRoom(ps, 0);
  const gesehen = [];
  openQueuedCardAction(room, 'TESTKARTE', ['b', 'c'], (pid) => {
    gesehen.push(pid);
    return { kind: 'choice', options: [{ id: 'ok', label: 'Ok', action: { type: 'noEffect' } }] };
  });
  assert.strictEqual(room.pendingCardAction.playerId, 'b', 'erst B');
  handleResolveCardChoice(room, 'b', 'ok');
  assert.strictEqual(room.pendingCardAction.playerId, 'c', 'dann C');
  handleResolveCardChoice(room, 'c', 'ok');
  assert.strictEqual(room.pendingCardAction, null, 'danach abgeraeumt');
  assert.deepStrictEqual(gesehen, ['b', 'c']);
}

// 4) Eine fremde Person kann die Aktion nicht wegklicken
{
  const ps = ['a', 'b'].map((x) => makePlayer(x));
  const room = makeRoom(ps, 0);
  openQueuedCardAction(room, 'TESTKARTE', ['b'], () => ({
    kind: 'choice', options: [{ id: 'ok', label: 'Ok', action: { type: 'noEffect' } }],
  }));
  handleResolveCardChoice(room, 'a', 'ok');
  assert.strictEqual(room.pendingCardAction.playerId, 'b',
    'nur die adressierte Person darf aufloesen');
}

// 5) Getrennte werden uebersprungen statt die Partie anzuhalten
{
  const ps = [makePlayer('a'), makePlayer('b', { connected: false }), makePlayer('c')];
  const room = makeRoom(ps, 0);
  openQueuedCardAction(room, 'TESTKARTE', ['b', 'c'], () => ({
    kind: 'choice', options: [{ id: 'ok', label: 'Ok', action: { type: 'noEffect' } }],
  }));
  assert.strictEqual(room.pendingCardAction.playerId, 'c',
    'die getrennte Person B wird uebersprungen');
}

console.log('OK - Aktions-Warteschlange: fuenf Reihenfolgen, Vorruecken, Abraeumen, Getrennte.');
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/card-crossplayer.test.js`
Expected: FAIL, `TypeError: playerQueueFrom is not a function`

- [ ] **Step 3: `playerQueueFrom` implementieren**

Neben `currentPlayer` (`server.js:198`) einsetzen:

```js
// Reihenfolge, in der Mitspielende von einer Karte betroffen werden. Die
// Karten sagen Unterschiedliches ("beginnend mit dem Spieler VOR dir" gegen
// "NACH dir"), deshalb ein Modus je Formulierung statt einer festen Regel.
function playerQueueFrom(room, player, mode) {
  const n = room.players.length;
  const self = room.players.findIndex((p) => p.id === player.id);
  if (self < 0 || n < 2) return [];
  if (mode === 'after') {
    return Array.from({ length: n - 1 }, (_, i) => room.players[(self + 1 + i) % n].id);
  }
  if (mode === 'before') {
    return Array.from({ length: n - 1 }, (_, i) => room.players[((self - 1 - i) % n + n) % n].id);
  }
  if (mode === 'neighbours') {
    const vor = room.players[((self - 1) % n + n) % n].id;
    const danach = room.players[(self + 1) % n].id;
    return vor === danach ? [vor] : [vor, danach];
  }
  if (mode === 'topLevel') {
    const others = room.players.filter((p) => p.id !== player.id);
    if (!others.length) return [];
    const max = Math.max.apply(null, others.map((p) => p.level));
    return others.filter((p) => p.level === max).map((p) => p.id);
  }
  return room.players.filter((p) => p.id !== player.id).map((p) => p.id); // 'allOthers'
}
```

- [ ] **Step 4: Warteschlange in `pendingCardAction`**

```js
// Eine Aktion, die mehrere Personen NACHEINANDER betrifft. specFor(playerId)
// liefert je Person den Inhalt (kind/options/prompt/candidateIds) - so kann
// jede Person aus ihrer eigenen Hand waehlen.
function openQueuedCardAction(room, cardName, queue, specFor) {
  room._queuedCardAction = { cardName, queue: queue.slice(), specFor };
  advanceCardActionQueue(room);
}

function advanceCardActionQueue(room) {
  const q = room._queuedCardAction;
  if (!q) {
    room.pendingCardAction = null;
    room._pendingCardActionResolvers = null;
    return;
  }
  const nextId = q.queue.shift();
  if (!nextId) {
    room._queuedCardAction = null;
    room.pendingCardAction = null;
    room._pendingCardActionResolvers = null;
    return;
  }
  const p = findPlayer(room, nextId);
  // Getrennte werden uebersprungen - sonst haengt die Partie an jemandem, der
  // gerade nicht am Geraet ist (gleiche Regel wie bei combatReadyRequired).
  if (!p || !p.connected) return advanceCardActionQueue(room);
  const spec = q.specFor(nextId);
  if (!spec) return advanceCardActionQueue(room);
  room.pendingCardAction = Object.assign({ playerId: nextId, cardName: q.cardName }, spec);
  room._pendingCardActionResolvers = {};
  (spec.options || []).forEach((o) => { room._pendingCardActionResolvers[o.id] = o.action; });
}
```

In allen drei `handleResolveCard*`-Handlern die Zeile, die
`room.pendingCardAction = null` setzt, ersetzen durch:

```js
  if (room._queuedCardAction) advanceCardActionQueue(room);
  else { room.pendingCardAction = null; room._pendingCardActionResolvers = null; }
```

- [ ] **Step 5: Test laufen lassen**

Run: `node tests/card-crossplayer.test.js`
Expected: PASS

- [ ] **Step 6: Generischer Bot-Auflöser**

In `scheduleBotActionsIfNeeded`, **vor** dem `if (room.pendingConsequence)`-Block:

```js
  // Eine an einen Bot gerichtete Kartenaktion muss der Server selbst
  // beantworten - sonst wartet die Partie ewig auf einen Dialog, den niemand
  // sieht. Bots waehlen bewusst simpel (erste Option / erstes Ziel); eine
  // kluegere Auswahl waere ein eigenes Thema.
  if (room.pendingCardAction) {
    const p = findPlayer(room, room.pendingCardAction.playerId);
    if (p && p.isBot) {
      const snapshot = room.pendingCardAction;
      room.botTimer = setTimeout(() => {
        room.botTimer = null;
        if (!rooms.has(room.code) || room.pendingCardAction !== snapshot) return;
        resolveBotCardAction(room);
        broadcastState(room);
      }, randomDelay());
    }
    return;
  }
```

Dazu die Funktion selbst, neben `resolveBotCardAction`s Nachbarn:

```js
function resolveBotCardAction(room) {
  const pa = room.pendingCardAction;
  if (!pa) return;
  const bot = findPlayer(room, pa.playerId);
  if (!bot || !bot.isBot) return;
  if (pa.kind === 'choice' && (pa.options || []).length) {
    handleResolveCardChoice(room, bot.id, pa.options[0].id);
  } else if (pa.kind === 'targetPlayer' && (pa.candidateIds || []).length) {
    handleResolveCardTarget(room, bot.id, pa.candidateIds[0]);
  } else if (pa.kind === 'chooseCard' && (pa.candidateIds || []).length) {
    handleResolveCardCardChoice(room, bot.id, pa.candidateIds[0]);
  } else {
    // Nichts Waehlbares oder unbekannte Art: ueberspringen statt haengen.
    advanceCardActionQueue(room);
  }
}
```

- [ ] **Step 7: `module.exports` ergänzen und testen**

```js
  playerQueueFrom, openQueuedCardAction, advanceCardActionQueue, resolveBotCardAction,
  handleResolveCardTarget, handleResolveCardCardChoice,
```

Run: `npm test`
Expected: `8/8 Tests erfolgreich.` `basic-game-flow.test.js` ist hier der wichtige - er spielt mit echten Bots und würde einen Deadlock als Timeout melden.

- [ ] **Step 8: Commit**

```bash
git add server.js tests/card-crossplayer.test.js
git commit -m "Aktions-Warteschlange fuer Karten, die mehrere Spieler betreffen, plus Bot-Aufloeser"
```

---

### Task 4: Bedingtes Reaktionsfenster (M2)

**Files:**
- Create: `src/cards/reactions.js`, `tests/card-reactions.test.js`
- Modify: `server.js` (`handleAttemptFlee` `:2515`, `applyFleeSuccess` `:2573`, Socket-Registrierung ~`:3280`), `public/client.js` (`renderHand`)

**Interfaces:**
- Consumes: Task 1
- Produces:
  - `ROLL_REACTION_CARDS: Set<string>`, `ESCAPE_REACTION_CARDS: Set<string>`
  - `reactionHolders(room, cardSet): string[]`
  - `rollWithWindow(room, player, purpose, onResolve)` - ruft `onResolve(roll)` **sofort** auf, wenn niemand reagieren kann
  - `handlePlayReactionCard(room, playerId, cardId, value)`, `handlePassReaction(room, playerId)`

- [ ] **Step 1: Test schreiben**

`tests/card-reactions.test.js`:

```js
// Bedingtes Reaktionsfenster: haelt NIEMAND eine passende Karte, muss alles
// exakt so ablaufen wie bisher (synchron, ohne Fenster). Genau das schuetzt
// die bestehenden Wuerfel- und Fluchtpfade.
const assert = require('assert');
const {
  ALL_CARDS, reactionHolders, rollWithWindow, ROLL_REACTION_CARDS,
  ESCAPE_REACTION_CARDS, newEquipped,
} = require('../server.js');

function byName(name) {
  const c = ALL_CARDS.find((x) => x.name === name);
  assert.ok(c, `Karte "${name}" nicht in den Kartendaten gefunden`);
  return c;
}
function makePlayer(id, extra) {
  return Object.assign({
    id, name: id.toUpperCase(), level: 5, hand: [], races: [], classes: [],
    powerGroups: [], raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), isBot: false, connected: true,
  }, extra || {});
}
function makeRoom(players) {
  return { code: 'TEST', players, turnIndex: 0, doorDiscard: [], treasureDiscard: [],
    log: [], combat: null, pendingCardAction: null, pendingRoll: null };
}

// 1) Die Kartennamen stimmen mit den Rohdaten ueberein
assert.ok(byName('GEZINKTER WÜRFEL') && ROLL_REACTION_CARDS.has('GEZINKTER WÜRFEL'));
assert.ok(byName('KLEBERFLÄSCHCHEN') && ESCAPE_REACTION_CARDS.has('KLEBERFLÄSCHCHEN'));

// 2) Niemand haelt eine Karte -> synchron, kein Fenster
{
  const p = makePlayer('a');
  const room = makeRoom([p]);
  let gesehen = null;
  rollWithWindow(room, p, 'test', (roll) => { gesehen = roll; });
  assert.ok(gesehen !== null, 'ohne Reaktionskarte muss sofort aufgeloest werden');
  assert.ok(gesehen >= 1 && gesehen <= 6, 'Wurf muss 1..6 sein');
  assert.ok(!room.pendingRoll, 'es darf kein Fenster offen bleiben');
}

// 3) Jemand haelt den Gezinkten Wuerfel -> Fenster oeffnet sich
{
  const wuerfel = byName('GEZINKTER WÜRFEL');
  const a = makePlayer('a');
  const b = makePlayer('b', { hand: [wuerfel.id] });
  const room = makeRoom([a, b]);
  let gesehen = null;
  rollWithWindow(room, a, 'test', (roll) => { gesehen = roll; });
  assert.strictEqual(gesehen, null, 'mit Reaktionskarte darf noch nicht aufgeloest werden');
  assert.ok(room.pendingRoll, 'Fenster muss offen sein');
  assert.deepStrictEqual(reactionHolders(room, ROLL_REACTION_CARDS), ['b']);
}

// 4) Ein Bot haelt die Karte -> zaehlt nicht, Fenster bleibt zu
{
  const wuerfel = byName('GEZINKTER WÜRFEL');
  const a = makePlayer('a');
  const bot = makePlayer('bot', { hand: [wuerfel.id], isBot: true });
  const room = makeRoom([a, bot]);
  let gesehen = null;
  rollWithWindow(room, a, 'test', (roll) => { gesehen = roll; });
  assert.ok(gesehen !== null, 'Bots spielen keine Reaktionskarten - kein Fenster');
  assert.ok(!room.pendingRoll);
}

// 5) Getrennte Personen zaehlen ebenfalls nicht
{
  const wuerfel = byName('GEZINKTER WÜRFEL');
  const a = makePlayer('a');
  const weg = makePlayer('weg', { hand: [wuerfel.id], connected: false });
  const room = makeRoom([a, weg]);
  let gesehen = null;
  rollWithWindow(room, a, 'test', (roll) => { gesehen = roll; });
  assert.ok(gesehen !== null, 'Getrennte oeffnen kein Fenster');
}

console.log('OK - Reaktionsfenster: synchron ohne Karte, Fenster mit Karte, Bots/Getrennte aus.');
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `node tests/card-reactions.test.js`
Expected: FAIL, `TypeError: rollWithWindow is not a function`

- [ ] **Step 3: `src/cards/reactions.js` anlegen**

```js
// Karten, die auf ein Ereignis REAGIEREN statt aktiv ausgespielt zu werden.
// Sie brauchen ein Zeitfenster, das der Server sonst nirgends hat.
module.exports = () => {
  // "Spiel ihn, nachdem du aus einem beliebigen Grund wuerfeln musstest.
  // Aendere das Wuerfelergebnis so wie du willst. Nur einmal einsetzbar."
  const ROLL_REACTION_CARDS = new Set(['GEZINKTER WÜRFEL']);

  // "Einsetzbar, wenn jemand erfolgreich (egal warum) einem Kampf entkommt.
  // Er muss seine Flucht noch einmal wuerfeln, sogar wenn sie das erste Mal
  // automatisch gelungen war. Nur einmal einsetzbar."
  const ESCAPE_REACTION_CARDS = new Set(['KLEBERFLÄSCHCHEN']);

  return { ROLL_REACTION_CARDS, ESCAPE_REACTION_CARDS };
};
```

- [ ] **Step 4: Fenster implementieren**

Direkt nach `rollDie` (`server.js:96`) kann die Factory noch nicht geladen
werden (`card` fehlt) - die Funktionen deshalb neben `fleeModifierParts`
einsetzen, den `require` oben zu den anderen:

```js
const reactionsFactory = require('./src/cards/reactions.js');
const { ROLL_REACTION_CARDS, ESCAPE_REACTION_CARDS } = reactionsFactory();

// Wer koennte auf dieses Ereignis reagieren? Bots spielen keine
// Reaktionskarten, Getrennte koennen nicht - beide oeffnen deshalb kein
// Fenster, sonst haengt die Partie an niemandem.
function reactionHolders(room, cardSet) {
  return room.players
    .filter((p) => p.connected && !p.isBot
      && p.hand.some((id) => cardSet.has((card(id) || {}).name)))
    .map((p) => p.id);
}

// ponytail: kein generischer Reaktions-Stack. Haelt niemand eine passende
// Karte, laeuft alles synchron weiter - bitgleich zum Verhalten vorher. Ein
// Fenster entsteht nur, wenn es wirklich jemanden gibt, der es nutzen
// koennte. Obergrenze: genau zwei Ausloeser (Wurf, gelungene Flucht). Kommen
// mehr dazu, lohnt sich ein echter Stack.
function rollWithWindow(room, player, purpose, onResolve) {
  const roll = rollDie();
  const holders = reactionHolders(room, ROLL_REACTION_CARDS);
  if (!holders.length) { onResolve(roll); return; }
  room.pendingRoll = { playerId: player.id, purpose, roll, holders, onResolve };
  log(room, `${player.name} wuerfelt ${roll} - es darf noch auf den Wurf reagiert werden.`);
}

function resolvePendingRoll(room, finalRoll) {
  const pr = room.pendingRoll;
  if (!pr) return;
  room.pendingRoll = null;
  pr.onResolve(typeof finalRoll === 'number' ? finalRoll : pr.roll);
}

function handlePlayReactionCard(room, playerId, cardId, value) {
  const pr = room.pendingRoll;
  if (!pr || !pr.holders.includes(playerId)) return;
  const p = findPlayer(room, playerId);
  const c = card(cardId);
  if (!p || !c || !p.hand.includes(cardId) || !ROLL_REACTION_CARDS.has(c.name)) return;
  const neu = Math.max(1, Math.min(6, Math.round(Number(value) || pr.roll)));
  removeFromHand(p, cardId);
  discardCard(room, cardId);
  log(room, `${p.name} spielt "${c.name}": Wurf ${pr.roll} wird zu ${neu}.`, [cardId]);
  resolvePendingRoll(room, neu);
  touchRoom(room);
}

function handlePassReaction(room, playerId) {
  const pr = room.pendingRoll;
  if (!pr || !pr.holders.includes(playerId)) return;
  pr.holders = pr.holders.filter((id) => id !== playerId);
  if (!pr.holders.length) resolvePendingRoll(room, pr.roll);
  touchRoom(room);
}
```

- [ ] **Step 5: Test laufen lassen**

Run: `node tests/card-reactions.test.js`
Expected: PASS

- [ ] **Step 6: Den Weglaufwurf durch das Fenster schicken**

In `handleAttemptFlee` (`:2515`) alles ab `const roll = rollDie();` bis zum
Ende der Funktion in eine innere Funktion verschieben und über das Fenster
aufrufen. Der Rest der Funktion (Vorprüfungen, `manual`, `parts`, `mod`)
bleibt unverändert **vor** dem Aufruf stehen:

```js
  rollWithWindow(room, actor, 'flee', function mitWurf(roll) {
    const total = roll + mod;
    const impossible = combatHasMonster(room, FLEE_IMPOSSIBLE);
    // ... der bisherige Rumpf ab hier unveraendert ...
  });
```

Die Konsequenz-Würfel (`applyPrimitiveAction`, `:770-783`) bleiben bewusst
synchron - die Funktion liefert einen Beschreibungstext zurück und kann nicht
auf ein Fenster warten. Dort diesen Kommentar setzen:

```js
      // ponytail: Konsequenz-Wuerfe bleiben synchron - applyPrimitiveAction
      // liefert einen Text zurueck und kann nicht warten. GEZINKTER WUERFEL
      // wirkt deshalb vorerst nur auf den Weglaufwurf. Aufruestweg:
      // applyPrimitiveAction auf Callbacks umstellen.
```

- [ ] **Step 7: `KLEBERFLÄSCHCHEN` an die gelungene Flucht hängen**

In `applyFleeSuccess` (`:2573`) ganz am Anfang:

```js
  // "Einsetzbar, wenn jemand erfolgreich einem Kampf entkommt." Wirkt auch
  // bei automatisch gelungener Flucht, deshalb hier und nicht am Wurf.
  if (!c.escapeReactionDone && reactionHolders(room, ESCAPE_REACTION_CARDS).length) {
    c.escapeReactionOffer = reactionHolders(room, ESCAPE_REACTION_CARDS);
    log(room, `${actor.name} entkommt - es darf noch ein Kleberflaeschchen gespielt werden.`);
    return;
  }
```

`c.escapeReactionDone` verhindert eine Endlosschleife, wenn nach dem
erzwungenen Neuwurf wieder erfolgreich geflohen wird.

- [ ] **Step 8: Socket-Events und Client-Knopf**

`server.js`, bei den anderen `onSafe`-Zeilen:

```js
  onSafe(socket, 'playReactionCard', ({ cardId, value }) => act(socket, (room, pid) => handlePlayReactionCard(room, pid, cardId, value)));
  onSafe(socket, 'passReaction', () => act(socket, (room, pid) => handlePassReaction(room, pid)));
```

`pendingRoll` in `publicState` aufnehmen (nur `playerId`, `roll`, `holders` -
`onResolve` ist eine Funktion und darf nicht serialisiert werden):

```js
    pendingRoll: room.pendingRoll
      ? { playerId: room.pendingRoll.playerId, roll: room.pendingRoll.roll, holders: room.pendingRoll.holders }
      : null,
```

`public/client.js`, in `renderHand` neben den Kampfknöpfen:

```js
    if (state.pendingRoll && state.pendingRoll.holders.includes(myInfo.playerId)
        && c.name === 'GEZINKTER WÜRFEL') {
      const btn = mkBtn('🎲 Wurf aendern', () => {
        const v = Number(window.prompt('Neues Wuerfelergebnis (1-6)?', String(state.pendingRoll.roll)));
        if (v >= 1 && v <= 6) socket.emit('playReactionCard', { cardId: id, value: v });
      });
      wrap.appendChild(btn);
    }
```

Dazu ein "Passen"-Knopf im `#cardActionArea`, wenn `state.pendingRoll` offen
ist und man selbst in `holders` steht.

- [ ] **Step 9: MAGISCHE LAMPE an das bestehende Fluchtfenster hängen**

Die Karte braucht **kein** neues Fenster - `combat.fleeRerollOffer` (aus der
Halbling-Runde) ist genau der Moment, den sie beschreibt: "selbst wenn dein
Weglaufenwurf verpatzt wurde und es dich fangen wuerde".

In `server.js` neben `POST_FLEE_ESCAPE_CARDS`:

```js
// "Nur in deiner Runde spielbar. Sie beschwoert einen Geist, der ein Monster
// verschwinden laesst, selbst wenn dein Weglaufenwurf verpatzt wurde und es
// dich fangen wuerde. War es das einzige Monster, erhaeltst du seinen Schatz,
// aber keine Stufe."
const LAMP_CARDS = new Set(['MAGISCHE LAMPE']);

function lampCardIds(actor) {
  return actor.hand.filter((id) => LAMP_CARDS.has((card(id) || {}).name));
}

function handleUseLamp(room, playerId, cardId, monsterId) {
  const c = room.combat;
  if (!c || c.actorId !== playerId) return;
  const actor = findPlayer(room, playerId);
  if (!actor || !actor.hand.includes(cardId)) return;
  const lampe = card(cardId);
  if (!lampe || !LAMP_CARDS.has(lampe.name)) return;
  const idx = c.monsterIds.indexOf(monsterId);
  if (idx < 0) return;
  removeFromHand(actor, cardId);
  discardCard(room, cardId);
  const weg = c.monsterIds.splice(idx, 1)[0];
  room.doorDiscard.push(weg);
  log(room, `${actor.name} spielt "${lampe.name}": "${card(weg).name}" verschwindet.`, [cardId, weg]);
  if (!c.monsterIds.length) {
    // "War es das einzige Monster, erhaeltst du seinen Schatz, aber keine
    // Stufe." - derselbe Pfad wie Verzauberarmband/Verzauberung.
    endCombatNoLevel(room, { leavesTreasure: true });
  } else {
    c.fleeRerollOffer = false;
    refreshCombatReady(room);
  }
  touchRoom(room);
}
```

In `handleAttemptFlee` die Bedingung für das Entscheidungsfenster um
`|| lampCardIds(actor).length` erweitern, damit das Fenster auch dann
aufgeht, wenn nur die Lampe vorhanden ist. Socket-Event `useLamp`
registrieren und in `renderCardAction` einen Knopf je Monster anbieten.

- [ ] **Step 10: Tests und Commit**

Run: `npm test`
Expected: `9/9 Tests erfolgreich.` `card-passives.test.js` prüft den Weglaufpfad - schlägt er fehl, wurde `handleAttemptFlee` beim Umbau inhaltlich verändert und nicht nur umgeklammert.

```bash
git add src/cards/reactions.js server.js public/client.js tests/card-reactions.test.js
git commit -m "Bedingtes Reaktionsfenster plus Magische Lampe am bestehenden Fluchtfenster"
```

---

### Task 5: Siegregel (M6)

**Files:**
- Create: `tests/card-winrule.test.js`
- Modify: `server.js` (`handleSellItems` `:2791`, `applyPrimitiveAction`, `handleUseCardPower` `:1452`), `src/cards/reactions.js`, `public/client.js`

**Interfaces:**
- Consumes: Task 1
- Produces:
  - `DOOR_POWER_CARDS` in `src/cards/reactions.js` - Türkarten mit aktiver Sonderkraft
  - Aktion `{ type: 'levelUpAllPriests' }`

- [ ] **Step 1: Test schreiben**

`tests/card-winrule.test.js`:

```js
// Die Siegesstufe ist nur durch ein besiegtes Monster erreichbar. Verkaufen
// darf auf Stufe 10 bringen, aber nicht gewinnen lassen - GOTTLICHE
// INTERVENTION ist die einzige gedruckte Ausnahme.
const assert = require('assert');
const { ALL_CARDS, handleSellItems, MAX_LEVEL, newEquipped } = require('../server.js');

function makePlayer(id, extra) {
  return Object.assign({
    id, name: id.toUpperCase(), level: 9, hand: [], races: [], classes: [],
    powerGroups: [], raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), isBot: false, connected: true, halblingSaleUsed: false,
  }, extra || {});
}

{
  const teuer = ALL_CARDS.filter((c) => c.set === 'base' && c.gold >= 400).slice(0, 4);
  assert.ok(teuer.length >= 3, 'genug teure Karten fuer den Test noetig');
  const p = makePlayer('a', { hand: teuer.map((c) => c.id) });
  const room = { code: 'T', players: [p], turnIndex: 0, doorDiscard: [], treasureDiscard: [],
    log: [], phase: 'playing', winner: null, combat: null };
  handleSellItems(room, 'a', teuer.map((c) => c.id));
  assert.strictEqual(p.level, MAX_LEVEL, 'Verkaufen muss auf Stufe 10 bringen duerfen');
  assert.strictEqual(room.winner, null, 'Verkaufen darf das Spiel NICHT gewinnen');
  assert.strictEqual(room.phase, 'playing', 'die Partie laeuft weiter');
}

console.log('OK - Siegregel: Verkaufen bringt auf Stufe 10, gewinnt aber nicht.');
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `node tests/card-winrule.test.js`
Expected: FAIL - `room.winner` ist `'a'` statt `null`

- [ ] **Step 3: `checkWin` aus `handleSellItems` entfernen**

`server.js:2791`, `checkWin(room, player);` ersetzen durch:

```js
  // Die Siegesstufe ist laut Regelwerk nur durch ein besiegtes Monster
  // erreichbar - Verkaufen bringt auf Stufe 10, gewinnt aber nicht. Der Sieg
  // faellt beim naechsten gewonnenen Kampf (resolveCombatWin ruft checkWin
  // ohnehin auf). Einzige gedruckte Ausnahme: GOTTLICHE INTERVENTION.
```

- [ ] **Step 4: Test laufen lassen**

Run: `node tests/card-winrule.test.js`
Expected: PASS

- [ ] **Step 5: GOTTLICHE INTERVENTION spielbar machen**

Die Karte ist `door_other`, läuft also **nicht** über `TREASURE_POWER_OVERRIDES`.
In `src/cards/reactions.js` ergänzen:

```js
  // Tuerkarten mit aktiver Sonderkraft. handleUseCardPower kennt bisher nur
  // Schatzkarten - diese Tabelle oeffnet denselben Weg fuer Tuerkarten.
  const DOOR_POWER_CARDS = {
    // "Alle Priester steigen sofort 1 Stufe auf. Dies darf die Siegesstufe
    // sein." Kartenname in den Rohdaten ohne Umlaut.
    'GOTTLICHE INTERVENTION': () => ({ type: 'levelUpAllPriests' }),
  };
```

und im `return` mit aufnehmen.

In `handleUseCardPower` (`:1459`) den Zweig davorsetzen:

```js
  if (DOOR_POWER_CARDS[c.name] !== undefined) {
    spec = DOOR_POWER_CARDS[c.name](player, room);
  } else if (TREASURE_POWER_OVERRIDES[c.name] !== undefined) {
```

In `applyPrimitiveAction`:

```js
    case 'levelUpAllPriests': {
      const priester = room.players.filter((p) => hasClass(p, 'PRIESTER'));
      if (!priester.length) return 'niemand ist Priester - keine Wirkung';
      priester.forEach((p) => setLevel(p, p.level + 1));
      // Ausdruecklich erlaubt: "Dies darf die Siegesstufe sein."
      priester.forEach((p) => { if (!room.winner) checkWin(room, p); });
      return `Priester steigen 1 Stufe auf: ${priester.map((p) => p.name).join(', ')}`;
    }
```

- [ ] **Step 6: Client-Knopf**

In `public/client.js` die Namensliste, die `hasTreasurePower(c)` nutzt, um die
`DOOR_POWER_CARDS`-Namen erweitern (sie kommen wie die übrigen Tabellennamen
über `publicState` mit), damit der "✨ Sonderkraft nutzen"-Knopf auch an
dieser Türkarte erscheint.

- [ ] **Step 7: Tests und Commit**

Run: `npm test`
Expected: `10/10 Tests erfolgreich.`

```bash
git add server.js src/cards/reactions.js public/client.js tests/card-winrule.test.js
git commit -m "Siegregel: Verkaufen gewinnt nicht mehr, Gottliche Intervention wird die Ausnahme"
```

---

### Task 6: Kartenanhänge (M5)

**Files:**
- Create: `tests/card-attachments.test.js`
- Modify: `server.js` (`newPlayer` `:132`, `handleEquipItem` `:2706`, `handleRequestHelp`, `resolveCombatWin` `:2468`, `publicState` `:362`), `src/cards/reactions.js`, `public/client.js`

**Interfaces:**
- Consumes: Task 2 (`isBigItem`, `canCarryAnotherBigItem`), Task 5 (`checkWin`-Pfad)
- Produces:
  - `player.attachments: { cheatedItemId: string|null }`
  - `player.helpCompelled: boolean` auf dem Kampf, `combat.noWinLevel: boolean`
  - `handlePlayCheat(room, playerId, cheatCardId, targetItemId)`

- [ ] **Step 1: Test schreiben**

`tests/card-attachments.test.js`:

```js
// SCHUMMELN! hebt fuer GENAU EINEN Gegenstand die Anlege-Regeln auf und geht
// mit ihm verloren. KNIESCHUETZER DER VERLOCKUNG erzwingt Hilfe, sperrt dafuer
// aber die Siegesstufe.
const assert = require('assert');
const {
  ALL_CARDS, handleEquipItem, handlePlayCheat, equippedItemIds, newEquipped,
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
function makeRoom(players) {
  return { code: 'T', players, turnIndex: 0, doorDiscard: [], treasureDiscard: [],
    log: [], combat: null, pendingCardAction: null };
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
}

// 2) Mit SCHUMMELN! auf dem Fels geht es
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
}

console.log('OK - Kartenanhaenge: Schummeln hebt genau eine Regel fuer genau einen Gegenstand auf.');
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `node tests/card-attachments.test.js`
Expected: FAIL, `TypeError: handlePlayCheat is not a function`

- [ ] **Step 3: `attachments` am Spieler anlegen**

In `newPlayer` (`:132`) ergänzen:

```js
    // SCHUMMELN!: hebt fuer genau einen Gegenstand die Anlege-Regeln auf.
    attachments: { cheatedItemId: null },
```

In `publicState` (`:362`) mit ausgeben, damit der Client den Gegenstand
markieren kann.

- [ ] **Step 4: `handlePlayCheat` implementieren**

```js
// "Spiele diese Karte auf einen Gegenstand, den du im Spiel hast, oder dann,
// wenn du einen Gegenstand aus deiner Hand ausspielst. Diesen Gegenstand
// kannst du nun legal einsetzen, auch wenn das normalerweise nicht erlaubt
// waere. Lege diese Karte ab, wenn du den geschummelten Gegenstand verlierst."
function handlePlayCheat(room, playerId, cheatCardId, targetItemId) {
  const player = findPlayer(room, playerId);
  if (!player || !player.hand.includes(cheatCardId)) return;
  const cheat = card(cheatCardId);
  if (!cheat || cheat.name !== 'SCHUMMELN!') return;
  const ziel = card(targetItemId);
  if (!ziel) return;
  const besitzt = player.hand.includes(targetItemId) || equippedItemIds(player).includes(targetItemId);
  if (!besitzt) return;
  if (player.attachments.cheatedItemId) {
    log(room, `${player.name} hat bereits einen geschummelten Gegenstand.`);
    touchRoom(room);
    return;
  }
  removeFromHand(player, cheatCardId);
  discardCard(room, cheatCardId);
  player.attachments.cheatedItemId = targetItemId;
  log(room, `${player.name} schummelt bei "${ziel.name}" - die Anlege-Regeln gelten dafuer nicht mehr.`, [cheatCardId, targetItemId]);
  touchRoom(room);
}
```

- [ ] **Step 5: `handleEquipItem` die Ausnahme beibringen**

Ganz am Anfang der Funktion, nach `if (!c) return;`:

```js
  const geschummelt = player.attachments && player.attachments.cheatedItemId === cardId;
```

Dann jede Ablehnung mit `if (!geschummelt && ...)` absichern: die
Gross-Prüfung aus Task 2, die `special.races`-Prüfung, die Slot-Belegung und
die Handzahl.

In `unequipSlotCard` bzw. `discardCard` den Anhang mit lösen:

```js
  // "Lege diese Karte ab, wenn du den geschummelten Gegenstand verlierst."
  if (player.attachments && player.attachments.cheatedItemId === cardId) {
    player.attachments.cheatedItemId = null;
  }
```

- [ ] **Step 6: Test laufen lassen**

Run: `node tests/card-attachments.test.js`
Expected: PASS

- [ ] **Step 7: KNIESCHÜTZER DER VERLOCKUNG**

In `handleRequestHelp`: hält die bittende Person die Karte, darf eine
höherstufige Person nicht ablehnen. In `handleRespondHelp` das Ablehnen dann
zurückweisen und `room.combat.noWinLevel = true` setzen.

In `resolveCombatWin` (`:2468`) vor dem `checkWin`:

```js
  // "In einem Kampf, bei dem der Helfer durch die Knieschuetzer zur Hilfe
  // genoetigt wurde, kannst du nicht die Siegesstufe erreichen."
  if (c.noWinLevel && actor.level >= MAX_LEVEL) {
    setLevel(actor, MAX_LEVEL - 1);
    log(room, `${actor.name} hat die Hilfe mit den Knieschuetzern erzwungen und kann in diesem Kampf nicht gewinnen.`);
  }
```

- [ ] **Step 8: Client-Knopf für SCHUMMELN!**

In `renderHand`: bei einer Karte namens `SCHUMMELN!` einen Knopf
"🃏 Auf Gegenstand spielen", der ein `select` mit allen eigenen Gegenständen
(Hand + angelegt) zeigt und `playCheat` sendet. Socket-Event registrieren.

- [ ] **Step 9: Tests und Commit**

Run: `npm test`
Expected: `11/11 Tests erfolgreich.`

```bash
git add server.js src/cards/reactions.js public/client.js tests/card-attachments.test.js
git commit -m "Kartenanhaenge: Schummeln und Knieschuetzer der Verlockung"
```

---

### Task 7: Tracker für aktive Flüche (M1)

**Files:**
- Create: `tests/card-curses.test.js`
- Modify: `server.js` (`newPlayer` `:132`, `combatTotals` `:2041`, `handleUseCardPower`, `autoApplyLossConsequence` `:1267`, `endTurn` `:509`), `src/cards/reactions.js`, `public/client.js`

**Interfaces:**
- Consumes: Task 1
- Produces:
  - `player.activeCurses: Array<{cardId, name, kind}>`
  - `LINGERING_CURSES` in `src/cards/reactions.js` - Kartenname → `{ kind }`
  - `addActiveCurse(room, player, cardName, cardId)`, `clearActiveCurse(room, player, index)`
  - `curseCombatModifier(player): number`, `curseSuppressesItemBonuses(player): boolean`

- [ ] **Step 1: Test schreiben**

`tests/card-curses.test.js`:

```js
// Anhaltende Fluche: MIESER SPIEGEL unterdrueckt Gegenstandsboni (ausser
// Ruestung) im naechsten Kampf, GESCHLECHTSUMWANDLUNG gibt -5, WUNSCHRING
// beendet beides. Verhaltenstest ueber combatTotals.
const assert = require('assert');
const {
  ALL_CARDS, combatTotals, addActiveCurse, newEquipped, handleEquipItem,
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
    activeCurses: [], isBot: false, connected: true,
  }, extra || {});
}
function makeRoomMitKampf(p, monsterName) {
  const m = byName(monsterName);
  return {
    code: 'T', players: [p], turnIndex: 0, doorDiscard: [], treasureDiscard: [], log: [],
    combat: { actorId: p.id, helperId: null, monsterIds: [m.id], actorModifier: 0,
      monsterModifier: 0, mustFlee: false, ready: {} },
  };
}

// 1) Ohne Fluch zaehlt der Gegenstandsbonus normal
{
  const streitkolben = byName('SCHARFER STREITKOLBEN'); // +4, 1 Hand, keine Ruestung
  const p = makePlayer('a', { hand: [streitkolben.id] });
  const room = makeRoomMitKampf(p, 'LAHMER GOBLIN');
  handleEquipItem(room, p.id, streitkolben.id);
  const ohne = combatTotals(room).playerStrength;
  assert.strictEqual(ohne, 5 + 4, 'Stufe 5 plus Gegenstand +4');

  // 2) MIESER SPIEGEL unterdrueckt ihn - Ruestung waere die Ausnahme
  addActiveCurse(room, p, 'MIESER SPIEGEL', byName('MIESER SPIEGEL').id);
  assert.strictEqual(combatTotals(room).playerStrength, 5,
    'Mieser Spiegel: keine Gegenstandsboni ausser Ruestung');
}

// 3) Ruestungsbonus bleibt trotz Mieser Spiegel
{
  const mithril = byName('MITHRIL-RÜSTUNG'); // +3, Ruestung
  const p = makePlayer('a', { hand: [mithril.id] });
  const room = makeRoomMitKampf(p, 'LAHMER GOBLIN');
  handleEquipItem(room, p.id, mithril.id);
  addActiveCurse(room, p, 'MIESER SPIEGEL', byName('MIESER SPIEGEL').id);
  assert.strictEqual(combatTotals(room).playerStrength, 5 + 3,
    'Ruestungsbonus ist die ausdrueckliche Ausnahme');
}

// 4) GESCHLECHTSUMWANDLUNG gibt -5
{
  const p = makePlayer('a');
  const room = makeRoomMitKampf(p, 'LAHMER GOBLIN');
  addActiveCurse(room, p, 'GESCHLECHTSUMWANDLUNG', byName('GESCHLECHTSUMWANDLUNG').id);
  assert.strictEqual(combatTotals(room).playerStrength, 0,
    'Stufe 5 minus 5 wegen Ablenkung');
}

console.log('OK - Anhaltende Fluche: Mieser Spiegel, Ruestungs-Ausnahme, Geschlechtsumwandlung.');
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `node tests/card-curses.test.js`
Expected: FAIL, `TypeError: addActiveCurse is not a function`

- [ ] **Step 3: Tabelle und Zustand anlegen**

`src/cards/reactions.js`:

```js
  // Fluche, die NACH dem Ziehen weiterwirken. Bis hierher kannte der Server
  // nur Sofort-Effekte; diese vier brauchen einen laufenden Zustand.
  const LINGERING_CURSES = {
    // "(Nur) In deinem naechsten Kampf erhaeltst du keine Boni durch
    // Gegenstaende, die einzige Ausnahme sind Ruestungsboni."
    'MIESER SPIEGEL': { kind: 'noItemBonusExceptArmor', dauer: 'naechsterKampf' },
    // "-5 auf deinen naechsten Kampf, weil du abgelenkt bist."
    'GESCHLECHTSUMWANDLUNG': { kind: 'combatMalus', amount: -5, dauer: 'naechsterKampf' },
    // "-1 auf alle Wuerfe."
    'HUHN AUF DEINEM KOPF': { kind: 'rollMalus', amount: -1, dauer: 'dauerhaft' },
    // "Du kannst keine Gegenstaende tragen, die mehr als eine Hand benoetigen."
    'WINZIGE HÄNDE': { kind: 'noTwoHandedItems', dauer: 'dauerhaft' },
  };
```

In `newPlayer`: `activeCurses: [],`. In `publicState` mit ausgeben.

```js
function addActiveCurse(room, player, cardName, cardId) {
  const regel = LINGERING_CURSES[cardName];
  if (!regel) return;
  player.activeCurses.push({ cardId, name: cardName, kind: regel.kind,
    amount: regel.amount || 0, dauer: regel.dauer });
  log(room, `${player.name} steht unter dem Fluch "${cardName}".`);
}

function curseCombatModifier(player) {
  return (player.activeCurses || [])
    .filter((f) => f.kind === 'combatMalus')
    .reduce((sum, f) => sum + f.amount, 0);
}

function curseSuppressesItemBonuses(player) {
  return (player.activeCurses || []).some((f) => f.kind === 'noItemBonusExceptArmor');
}
```

- [ ] **Step 4: In `combatTotals` einhängen**

**Nur hier**, nicht in `handleEvaluateCombat` - `combatSignature` liest
`combatTotals` und bleibt dadurch automatisch korrekt.

Im `else`-Zweig von `combatTotals` (`:2058`) die Summe je Person ersetzen:

```js
    playerStrength = sides.reduce((sum, p) => {
      const items = curseSuppressesItemBonuses(p)
        // "keine Boni durch Gegenstaende, die einzige Ausnahme sind Ruestungsboni"
        ? ((card(p.equipped.armor) || {}).bonus || 0)
        : equippedBonusSum(p) + conditionalItemBonusSum(p, monsters);
      return sum + p.level + items + hellknightArmorBonus(p)
        + curseCombatModifier(p) - (ignoreLevel ? p.level : 0);
    }, 0) + c.actorModifier;
```

`baseStrength` bleibt unverändert - es wird an anderen Stellen benutzt.

- [ ] **Step 5: Test laufen lassen**

Run: `node tests/card-curses.test.js`
Expected: PASS

- [ ] **Step 6: Flüche setzen und ablaufen lassen**

In `autoApplyLossConsequence` (`:1267`): steht der Kartenname in
`LINGERING_CURSES`, `addActiveCurse` aufrufen. Die vier stehen heute als
`() => null` in `CONSEQUENCE_OVERRIDES` - diese Einträge bleiben, weil es
keinen Sofort-Effekt gibt; der Tracker kommt zusätzlich.

In `resolveCombatWin` und `applyFleeSuccess` alle Flüche mit
`dauer === 'naechsterKampf'` der beteiligten Personen entfernen.

- [ ] **Step 7: WUNSCHRING**

In `src/cards/treasures.js`, `TREASURE_POWER_OVERRIDES`:

```js
  // "Beendet jeden Fluch. Jederzeit spielbar. Nur einmal einsetzbar."
  'WUNSCHRING': (player) => {
    if (!player.activeCurses.length) return null; // nichts zu beenden
    if (player.activeCurses.length === 1) {
      return { type: 'clearCurse', index: 0 };
    }
    return { type: 'choice', options: player.activeCurses.map((f, i) => ({
      id: `fluch-${i}`, label: `"${f.name}" beenden`, action: { type: 'clearCurse', index: i },
    })) };
  },
```

Dazu `case 'clearCurse'` in `applyPrimitiveAction`.

- [ ] **Step 8: Tests und Commit**

Run: `npm test`
Expected: `12/12 Tests erfolgreich.` `card-passives.test.js` prüft den
Bereit-Check - schlägt er fehl, wurde am `combatTotals`-Pfad vorbeigerechnet.

```bash
git add server.js src/cards/reactions.js src/cards/treasures.js public/client.js tests/card-curses.test.js
git commit -m "Tracker fuer anhaltende Fluche plus Wunschring"
```

---

### Task 8: Kampfreaktionskarten (M4)

Läuft **nach** Task 7 - beide rechnen in `combatTotals`.

**Files:**
- Create: `tests/card-combat-reactions.test.js`
- Modify: `server.js` (`handlePlayCombatCard` `:2316`, `combatTotals` `:2041`, `startCombat`), `src/cards/reactions.js`, `public/client.js`

**Interfaces:**
- Consumes: Task 3 (`openQueuedCardAction`), Task 7 (`combatTotals`-Form)
- Produces: `COMBAT_REACTION_CARDS` - Kartenname → `{ kind, needs }`

- [ ] **Step 1: Test schreiben**

`tests/card-combat-reactions.test.js`:

```js
// Karten, die einen LAUFENDEN Kampf veraendern: Kumpel verdoppelt das
// Monster, Wanderndes Monster haengt eines an, Illusion tauscht eines aus.
const assert = require('assert');
const {
  ALL_CARDS, combatTotals, handlePlayCombatCard, newEquipped,
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
    equipped: newEquipped(), attachments: { cheatedItemId: null }, activeCurses: [],
    isBot: false, connected: true,
  }, extra || {});
}

// 1) KUMPEL verdoppelt Stufe UND Schatzzahl des Monsters
{
  const goblin = byName('LAHMER GOBLIN'); // Stufe 1, 1 Schatz
  const kumpel = byName('KUMPEL');
  const p = makePlayer('a', { hand: [kumpel.id] });
  const room = {
    code: 'T', players: [p], turnIndex: 0, doorDiscard: [], treasureDiscard: [], log: [],
    combat: { actorId: p.id, helperId: null, monsterIds: [goblin.id], actorModifier: 0,
      monsterModifier: 0, mustFlee: false, ready: {} },
  };
  const vorher = combatTotals(room).monsterStrength;
  handlePlayCombatCard(room, p.id, kumpel.id);
  assert.strictEqual(room.combat.monsterIds.length, 2, 'ein zweites Monster muss dazukommen');
  assert.strictEqual(combatTotals(room).monsterStrength, vorher * 2,
    'gleiche Stufe noch einmal');
  assert.ok(!p.hand.includes(kumpel.id), 'die Karte ist verbraucht');
}

console.log('OK - Kampfreaktionen: Kumpel verdoppelt das Monster im laufenden Kampf.');
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `node tests/card-combat-reactions.test.js`
Expected: FAIL - `monsterIds.length` bleibt 1, weil `handlePlayCombatCard` die Karte nicht kennt

- [ ] **Step 3: Tabelle anlegen**

`src/cards/reactions.js`:

```js
  // Karten, die einen LAUFENDEN Kampf veraendern. Sie reiten auf der
  // bestehenden combatAllReady-Schranke: solange nicht alle bereit sind, darf
  // eingegriffen werden, und jede Aenderung setzt den Bereit-Status
  // automatisch zurueck (combatSignature).
  const COMBAT_REACTION_CARDS = {
    // "Ein weiteres Monster mit der gleichen Stufe und mit den gleichen
    // Monsterverstaerker-Karten taucht auf. Werden die Monster besiegt, ziehst
    // du fuer beide Monster Schaetze und steigst fuer beide Stufen auf."
    'KUMPEL': { kind: 'duplicateMonster' },
    // "Spiele diese Karte mit einem Monster von deiner Hand, wenn jemand im
    // Kampf ist. Dein Monster schliesst sich dem schon kaempfenden an."
    'WANDERNDES MONSTER': { kind: 'addMonsterFromHand' },
    // "Lege ein beliebiges Monster in diesem Kampf ab ... und ersetze es durch
    // eine Monsterkarte von deiner Hand."
    'ILLUSION': { kind: 'replaceMonsterFromHand' },
    // "Nimm einen Gegenstand von einem beliebigen Spieler."
    'HILF MIR': { kind: 'takeItemFromPlayer' },
    // "Ein anderer Spieler (deiner Wahl) kaempft gegen das/die Monster."
    'ÜBERFALLTRANK': { kind: 'handOverCombat' },
  };
```

- [ ] **Step 4: `duplicateMonster` implementieren**

In `handlePlayCombatCard` einen Zweig vor der bestehenden Verstärker-Logik:

```js
  const reaktion = COMBAT_REACTION_CARDS[c.name];
  if (reaktion) {
    applyCombatReaction(room, player, cardId, reaktion);
    return;
  }
```

```js
function applyCombatReaction(room, player, cardId, regel) {
  const c = room.combat;
  const karte = card(cardId);
  if (regel.kind === 'duplicateMonster') {
    // Dieselbe Karten-ID ein zweites Mal in den Kampf: Stufe, Schatzzahl und
    // alle Dauerwirkungen gelten damit automatisch doppelt.
    const erstes = c.monsterIds[0];
    if (!erstes) return;
    c.monsterIds.push(erstes);
    removeFromHand(player, cardId);
    discardCard(room, cardId);
    log(room, `${player.name} spielt "${karte.name}": "${card(erstes).name}" taucht ein zweites Mal auf.`, [cardId]);
  }
  // MARKER: hier setzt Step 6 die vier restlichen Arten ein
  // (addMonsterFromHand, replaceMonsterFromHand, takeItemFromPlayer,
  // handOverCombat). Der Code dafuer steht vollstaendig in Step 6.
  refreshCombatReady(room);
  touchRoom(room);
}
```

**Achtung bei `duplicateMonster`:** dieselbe ID zweimal in `monsterIds` heißt,
dass sie beim Ablegen auch zweimal auf den Ablagestapel wandert. In
`resolveCombatWin` und `applyFleeSuccess` deshalb mit
`[...new Set(c.monsterIds)]` ablegen.

- [ ] **Step 5: Test laufen lassen**

Run: `node tests/card-combat-reactions.test.js`
Expected: PASS

- [ ] **Step 6: Die übrigen vier Arten**

In `applyCombatReaction` die restlichen Zweige, an der Stelle des
Platzhalter-Kommentars aus Step 4:

```js
  if (regel.kind === 'addMonsterFromHand' || regel.kind === 'replaceMonsterFromHand') {
    const eigene = player.hand.filter((id) => (card(id) || {}).category === 'monster');
    if (!eigene.length) {
      log(room, `${player.name} hat kein Monster auf der Hand - "${karte.name}" bleibt liegen.`);
      touchRoom(room);
      return;
    }
    removeFromHand(player, cardId);
    discardCard(room, cardId);
    openCardChoice(room, player, karte.name, eigene.map((id) => ({
      id: `mon-${id}`,
      label: card(id).name,
      action: regel.kind === 'addMonsterFromHand'
        ? { type: 'combatAddMonster', cardId: id }
        : { type: 'combatReplaceMonster', cardId: id },
    })));
    touchRoom(room);
    return;
  }
  if (regel.kind === 'takeItemFromPlayer') {
    removeFromHand(player, cardId);
    discardCard(room, cardId);
    openCardTarget(room, player, karte.name, 'Von wem einen Gegenstand nehmen?',
      { type: 'takeAnyItem' });
    touchRoom(room);
    return;
  }
  if (regel.kind === 'handOverCombat') {
    removeFromHand(player, cardId);
    discardCard(room, cardId);
    openCardTarget(room, player, karte.name, 'Wer soll stattdessen kaempfen?',
      { type: 'handOverCombat' });
    touchRoom(room);
    return;
  }
```

Die zugehörigen Aktionen:

```js
    case 'combatAddMonster': {
      // "Dein Monster schliesst sich dem schon kaempfenden an - addiere ihre
      // Kampfstaerken."
      room.combat.monsterIds.push(action.cardId);
      refreshCombatReady(room);
      return `"${card(action.cardId).name}" schliesst sich dem Kampf an`;
    }
    case 'combatReplaceMonster': {
      // "Lege ein beliebiges Monster in diesem Kampf ab, zusammen mit allen
      // Karten, die gespielt wurden, um es zu veraendern, und ersetze es."
      const c = room.combat;
      const alt = c.monsterIds.shift();
      if (alt) room.doorDiscard.push(alt);
      c.monsterIds.unshift(action.cardId);
      // Verstaerker galten dem alten Monster und verfallen mit ihm.
      c.monsterModifier = 0;
      refreshCombatReady(room);
      return `"${card(alt).name}" wird durch "${card(action.cardId).name}" ersetzt`;
    }
```

Und in `applyTargetAction` (die Funktion für Aktionen mit Ziel, `:1430`):

```js
    case 'takeAnyItem': {
      // "Nimm einen Gegenstand von einem beliebigen Spieler. In diesem
      // Augenblick muss der Gegenstand den Unterschied zwischen Gewinnen und
      // Verlieren ausmachen." ponytail: die zweite Haelfte pruefen wir nicht -
      // sie ist eine Tischabsprache, keine berechenbare Bedingung.
      const ids = equippedItemIds(target);
      if (!ids.length) return `${target.name} traegt keinen Gegenstand`;
      let best = ids[0];
      ids.forEach((id) => { if ((card(id).bonus || 0) > (card(best).bonus || 0)) best = id; });
      unequipSlotCard(target, best);
      actor.hand.push(best);
      refreshCombatReady(room);
      return `${actor.name} nimmt "${card(best).name}" von ${target.name}`;
    }
    case 'handOverCombat': {
      // "Ein anderer Spieler (deiner Wahl) kaempft gegen das/die Monster ...
      // Der urspruengliche Spieler ist dann wieder am Zug und darf den Raum
      // pluendern, unabhaengig davon, ob der Kampf gewonnen oder verloren
      // wurde."
      const c = room.combat;
      if (!c) return 'kein Kampf im Gange';
      c.originalActorId = c.actorId;
      c.actorId = target.id;
      c.helperId = null;
      c.ready = {};
      refreshCombatReady(room);
      return `${target.name} kaempft jetzt anstelle von ${actor.name}`;
    }
```

In `resolveCombatWin` und im Verlier-Pfad nach dem Kampf: steht
`c.originalActorId`, gehört die Plünderphase wieder dieser Person -
`room.turnPhase = 'pluendern'` statt `'gabe'`, und `room.turnIndex` bleibt
unverändert (der Zug hat nie gewechselt).

- [ ] **Step 7: Client-Knöpfe**

In `renderHand`: bei laufendem Kampf und `!state.combat.mustFlee` für jede
Karte aus `COMBAT_REACTION_CARDS` einen Knopf "⚔️ Im Kampf spielen", der
`playCombatCard` sendet - dasselbe Event wie die Verstärker.

- [ ] **Step 8: Tests und Commit**

Run: `npm test`
Expected: `13/13 Tests erfolgreich.`

```bash
git add server.js src/cards/reactions.js public/client.js tests/card-combat-reactions.test.js
git commit -m "Kampfreaktionskarten: Kumpel, Wanderndes Monster, Illusion, Hilf mir, Ueberfalltrank"
```

---

### Task 9: Schlimme Dinge mit Fremdbeteiligung

**Files:**
- Create: `tests/card-badstuffs.test.js`
- Modify: `src/cards/consequences.js`, `server.js` (`applyPrimitiveAction`), `tests/auto-consequence.test.js` (**nur die Schranke**)

**Interfaces:**
- Consumes: Task 3 (`playerQueueFrom`, `openQueuedCardAction`), Task 2 (`isBigItem`)
- Produces: Aktionen `queuedTakeFromHand`, `queuedTakeItem`, `discardItemsWorthGold`

- [ ] **Step 1: Test schreiben**

`tests/card-badstuffs.test.js` - je ein Fall für HIPPOGREIF (Reihenfolge
`before`), ANWALT (`after`), LEPRACHAUN (`neighbours`), NETZ-TROLL
(`topLevel`), VERSICHERUNGSVERTRETER (Goldwert). Aufbau wie in
`tests/card-crossplayer.test.js`: echten Raum bauen, `resolveConsequenceSpec`
aufrufen, Ergebnis gegen den erwarteten Aktionstyp und die erwartete
Warteschlange prüfen.

```js
const assert = require('assert');
const { resolveConsequenceSpec, newEquipped } = require('../server.js');

function makePlayer(id, extra) {
  return Object.assign({
    id, name: id.toUpperCase(), level: 5, hand: [], races: [], classes: [],
    powerGroups: [], raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), attachments: { cheatedItemId: null }, activeCurses: [],
    isBot: false, connected: true,
  }, extra || {});
}

{
  const ps = ['a', 'b', 'c'].map((x) => makePlayer(x));
  const room = { code: 'T', players: ps, turnIndex: 0, doorDiscard: [],
    treasureDiscard: [], log: [], combat: null };
  const spec = resolveConsequenceSpec('HIPPOGREIF', 'x', ps[0], room);
  assert.strictEqual(spec.type, 'queuedTakeFromHand');
  assert.strictEqual(spec.mode, 'before', 'HIPPOGREIF: beginnend mit dem Spieler VOR dir');
}

{
  const ps = ['a', 'b', 'c'].map((x) => makePlayer(x));
  const room = { code: 'T', players: ps, turnIndex: 0, doorDiscard: [],
    treasureDiscard: [], log: [], combat: null };
  const spec = resolveConsequenceSpec('ANWALT', 'x', ps[0], room);
  assert.strictEqual(spec.mode, 'after', 'ANWALT: beginnend mit dem Spieler NACH dir');
}

console.log('OK - Schlimme Dinge mit Fremdbeteiligung: Reihenfolgen stimmen mit den Karten ueberein.');
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `node tests/card-badstuffs.test.js`
Expected: FAIL - `spec` ist `null`, weil HIPPOGREIF keinen Override hat

- [ ] **Step 3: Einträge in `src/cards/consequences.js`**

```js
  // "Beginnend mit dem Spieler VOR dir in Zugreihenfolge darf jeder Spieler
  // eine Schatzkarte vor dir oder (ohne hinzusehen) aus deiner Hand nehmen."
  'HIPPOGREIF': () => ({ type: 'queuedTakeFromHand', mode: 'before' }),
  // "Jeder Spieler darf eine Karte aus deiner Hand ziehen, beginnend mit dem
  // Spieler NACH dir in Zugreihenfolge. Lege alle uebrigen Karten ab."
  'ANWALT': () => ({ type: 'queuedTakeFromHand', mode: 'after', discardRest: true }),
  // "Er nimmt dir zwei Gegenstaende weg - ausgewaehlt von den Spielern vor und
  // nach dir in Zugreihenfolge."
  'LEPRACHAUN': () => ({ type: 'queuedTakeItem', mode: 'neighbours' }),
  // "... indem er dich dazu zwingt, den (die) Spieler mit der hoechsten Stufe
  // (jeweils) 1 Gegenstand von dir nehmen zu lassen."
  'NETZ-TROLL': () => ({ type: 'queuedTakeItem', mode: 'topLevel' }),
  // "Verliere Gegenstaende im Wert von 1.000 Goldstuecken. Hast du nicht
  // genug, verlierst du alles, was du hast."
  'VERSICHERUNGSVERTRETER': () => ({ type: 'discardItemsWorthGold', gold: 1000 }),
  // "Wuerfle und verliere entsprechend viele Gegenstaende oder Karten von
  // deiner Hand - deine Wahl."
  'SCHNECKEN AUF SPEED': () => ({ type: 'diceItemOrHandLoss' }),
```

`FLUCH! EINKOMMENSSTEUER` genauso mit `mode: 'allOthers'`.

- [ ] **Step 4: Aktionen implementieren**

In `applyPrimitiveAction`:

```js
    case 'queuedTakeFromHand': {
      // Jede betroffene Person zieht EINE Karte aus der Hand des Opfers.
      // "ohne hinzusehen" laesst sich hier nicht abbilden - die waehlende
      // Person sieht die Karten. ponytail: bewusst offen gelassen, ein
      // verdecktes Ziehen braeuchte eine eigene Anzeigeart im Client.
      const opfer = player;
      const queue = playerQueueFrom(room, opfer, action.mode);
      if (!queue.length) return 'niemand sonst am Tisch';
      openQueuedCardAction(room, 'Schlimme Dinge', queue, (pid) => {
        if (!opfer.hand.length) return null; // nichts mehr zu holen: ueberspringen
        return { kind: 'chooseCard', prompt: `Eine Karte von ${opfer.name} nehmen`,
          candidateIds: opfer.hand.slice(), takeFrom: opfer.id };
      });
      if (action.discardRest) room._discardRestAfterQueue = opfer.id;
      return `${queue.length} Mitspieler nehmen je 1 Handkarte`;
    }
    case 'queuedTakeItem': {
      const opfer = player;
      const queue = playerQueueFrom(room, opfer, action.mode);
      if (!queue.length) return 'niemand sonst am Tisch';
      openQueuedCardAction(room, 'Schlimme Dinge', queue, (pid) => {
        const ids = equippedItemIds(opfer);
        if (!ids.length) return null;
        return { kind: 'chooseCard', prompt: `Einen Gegenstand von ${opfer.name} nehmen`,
          candidateIds: ids, takeFrom: opfer.id };
      });
      return `${queue.length} Mitspieler nehmen je 1 Gegenstand`;
    }
    case 'discardItemsWorthGold': {
      // "Verliere Gegenstaende im Wert von 1.000 Goldstuecken. Hast du nicht
      // genug, verlierst du alles, was du hast."
      const ids = equippedItemIds(player).concat(player.hand)
        .filter((id) => (card(id) || {}).gold > 0)
        .sort((a, b) => (card(b).gold || 0) - (card(a).gold || 0));
      let summe = 0;
      const weg = [];
      for (const id of ids) {
        if (summe >= action.gold) break;
        summe += card(id).gold || 0;
        weg.push(id);
      }
      weg.forEach((id) => {
        if (player.hand.includes(id)) removeFromHand(player, id); else unequipSlotCard(player, id);
        discardCard(room, id);
      });
      return weg.length
        ? `Gegenstaende im Wert von ${summe} GS abgelegt: ${weg.map((id) => card(id).name).join(', ')}`
        : 'nichts Verkaufbares vorhanden';
    }
    case 'diceItemOrHandLoss': {
      const roll = rollDie();
      // "Wuerfle und verliere entsprechend viele Gegenstaende ODER Karten von
      // deiner Hand - deine Wahl." Die Wahl laeuft ueber die Warteschlange an
      // die eigene Person, damit sie die Karten selbst aussucht.
      openQueuedCardAction(room, 'SCHNECKEN AUF SPEED', Array(roll).fill(player.id), () => {
        const ids = equippedItemIds(player).concat(player.hand);
        if (!ids.length) return null;
        return { kind: 'chooseCard', prompt: 'Eine Karte oder einen Gegenstand ablegen',
          candidateIds: ids, discardOwn: true };
      });
      return `Wuerfelwurf ${roll} -> ${roll} Karte(n)/Gegenstand/Gegenstaende ablegen`;
    }
```

`handleResolveCardCardChoice` muss die neuen Felder `takeFrom` und
`discardOwn` auswerten: bei `takeFrom` die Karte vom Opfer zur wählenden
Person schieben, bei `discardOwn` sie auf den Ablagestapel legen.

- [ ] **Step 5: Die Abdeckungs-Schranke senken**

`tests/auto-consequence.test.js:113` - **die einzige erlaubte Teständerung im
ganzen Plan**:

```js
  // Nach der Runde vom 2026-09-12 sind sieben weitere Schlimme Dinge
  // kuratiert automatisiert (HIPPOGREIF, ANWALT, LEPRACHAUN, NETZ-TROLL,
  // VERSICHERUNGSVERTRETER, SCHNECKEN AUF SPEED, GALLERT-OKTAEDER), deshalb
  // von 20 auf 12 gesenkt. Die Schranke schuetzt weiter davor, dass eine zu
  // grosszuegige REGEX-Regel Karten einfaengt - kuratierte Eintraege sind
  // davon nicht betroffen.
  assert.ok(manual >= 12, `Zu viele Karten automatisch erkannt (${manual} manuell) ...`);
```

- [ ] **Step 6: Tests und Commit**

Run: `npm test`
Expected: `14/14 Tests erfolgreich.`

```bash
git add src/cards/consequences.js server.js tests/card-badstuffs.test.js tests/auto-consequence.test.js
git commit -m "Schlimme Dinge mit Fremdbeteiligung ueber die Aktions-Warteschlange"
```

---

### Task 10: Kampf-Alternativen und Sofort-Effekte bei Kampfbeginn

**Files:**
- Create: `tests/card-alternatives.test.js`
- Modify: `src/cards/passives.js`, `server.js` (`startCombat`, `handleDrawDoor` `:532`)

**Interfaces:**
- Consumes: Task 8 (`applyCombatReaction`-Nachbarschaft), bestehendes `openCardChoice`
- Produces: `COMBAT_START_OPTIONS`, `COMBAT_START_COST` in `src/cards/passives.js`

- [ ] **Step 1: Test schreiben**

`tests/card-alternatives.test.js` mit je einem Fall:
- MÖCHTEGERN-VAMPIR: Priester bekommt eine Wahl, alle anderen nicht
- LAUFENDE NASE: Wahl nur, wenn ein Gegenstand mit >= 200 Gold getragen wird
- PIT BULL: Wahl nur, wenn ein Stab getragen wird
- ZUNGENDÄMON: erzwungenes Ablegen ohne Wahl

```js
// Monster, die statt des Kampfes eine Alternative anbieten - aber nur, wenn
// die Bedingung auf der Karte erfuellt ist.
const assert = require('assert');
const { ALL_CARDS, handleDrawDoor, newEquipped } = require('../server.js');

function byName(n) { const c = ALL_CARDS.find((x) => x.name === n); assert.ok(c, n); return c; }
function makePlayer(id, extra) {
  return Object.assign({
    id, name: id.toUpperCase(), level: 5, hand: [], races: [], classes: [],
    powerGroups: [], raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), attachments: { cheatedItemId: null }, activeCurses: [],
    isBot: false, connected: true,
  }, extra || {});
}
function raumMitTuerkarte(p, monsterName) {
  const m = byName(monsterName);
  return {
    code: 'T', players: [p], turnIndex: 0, turnPhase: 'tuer',
    doorDeck: [m.id], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
    log: [], combat: null, pendingCardAction: null, pendingConsequence: null,
    revealedDoorCard: null, doorReveal: null,
  };
}

// 1) MOECHTEGERN-VAMPIR: nur Priester bekommen die Wahl
{
  const priester = byName('PRIESTER');
  const p = makePlayer('a', { classes: [priester.id] });
  const room = raumMitTuerkarte(p, 'MÖCHTEGERN-VAMPIR');
  handleDrawDoor(room, p.id);
  assert.ok(room.pendingCardAction, 'Priester muss die Wahl bekommen');
}
{
  const p = makePlayer('a'); // klassenlos
  const room = raumMitTuerkarte(p, 'MÖCHTEGERN-VAMPIR');
  handleDrawDoor(room, p.id);
  assert.ok(!room.pendingCardAction, 'ohne Priesterklasse keine Wahl');
  assert.ok(room.combat, 'stattdessen ein normaler Kampf');
}

// 2) PIT BULL: nur mit Stab
{
  const stab = byName('NAPALMSTAB');
  const p = makePlayer('a', { hand: [stab.id] });
  p.equipped.hands[0] = stab.id;
  const room = raumMitTuerkarte(p, 'PIT BULL');
  handleDrawDoor(room, p.id);
  assert.ok(room.pendingCardAction, 'mit Stab gibt es die Ablenk-Option');
}
{
  const p = makePlayer('a');
  const room = raumMitTuerkarte(p, 'PIT BULL');
  handleDrawDoor(room, p.id);
  assert.ok(!room.pendingCardAction, 'ohne Stab keine Option');
}

console.log('OK - Kampf-Alternativen: Bedingungen der Karten werden geprueft.');
```

**Hinweis:** `raumMitTuerkarte` setzt `doorDeck` direkt. Wie der Türstapel im
Raumobjekt wirklich heißt, in `server.js` bei `drawDoor` (`:~220`)
nachsehen und hier angleichen - der Name muss exakt stimmen, sonst zieht
`handleDrawDoor` aus einem leeren Stapel und der Test schlägt aus dem
falschen Grund fehl.

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `node tests/card-alternatives.test.js`
Expected: FAIL - `room.pendingCardAction` ist `null`

- [ ] **Step 3: Tabelle anlegen**

`src/cards/passives.js`:

```js
  // Monster, die statt des Kampfes eine Alternative anbieten. Gleiche Bauform
  // wie MONSTER_PASS_OPTION (BEKIFFTER GOLEM), nur mit einer Bedingung.
  const COMBAT_START_OPTIONS = {
    // "Statt zu kaempfen kann ein Priester den Moechtegern-Vampir wegjagen,
    // indem er 'Booga Booga' ruft und seinen Schatz nimmt. Steige keine Stufe
    // auf dafuer!"
    'MÖCHTEGERN-VAMPIR': {
      wennErfuellt: (p) => hasClass(p, 'PRIESTER'),
      label: 'Als Priester wegjagen (Schatz, keine Stufe)',
      action: { type: 'endCombatNoLevel', leavesTreasure: true },
    },
    // "Willst du die Laufende Nase nicht bekaempfen, so bestich sie mit einem
    // Gegenstand im Wert von wenigstens 200 Goldstuecken."
    'LAUFENDE NASE': {
      wennErfuellt: (p, ctx) => ctx.hatGegenstandAbGold(p, 200),
      label: 'Mit einem Gegenstand (mind. 200 GS) bestechen',
      action: { type: 'bribeMonster', minGold: 200 },
    },
    // "Kannst du ihn nicht besiegen, darfst du ihn ablenken (automatische
    // Flucht), indem du einen Stab oder Aehnliches fallen laesst."
    'PIT BULL': {
      wennErfuellt: (p, ctx) => ctx.hatStab(p),
      label: 'Mit einem Stab ablenken (automatische Flucht)',
      action: { type: 'dropStaffEscape' },
    },
  };

  // ponytail: feste Liste statt Textsuche - "ein Stab oder Aehnliches" laesst
  // sich aus den Rohdaten nicht ableiten. Neue Staebe hier ergaenzen.
  const STAFF_ITEMS = new Set(['NAPALMSTAB', 'STANGE, 11-FUSS']);

  // Monster, die VOR dem Kampf etwas kosten.
  const COMBAT_START_COST = {
    // "Lege einen Gegenstand deiner Wahl VOR dem Kampf ab."
    'ZUNGENDÄMON': { type: 'discardChosenItem' },
  };
```

- [ ] **Step 4: In `handleDrawDoor` einhängen**

Neben dem bestehenden `monsterPassOption`-Zweig (`:555`), mit demselben
Bot-Zweig - sonst wartet die Partie auf einen Dialog, den ein Bot nie sieht.

- [ ] **Step 5: Tests und Commit**

Run: `npm test`
Expected: `15/15 Tests erfolgreich.`

```bash
git add src/cards/passives.js server.js tests/card-alternatives.test.js
git commit -m "Kampf-Alternativen: Moechtegern-Vampir, Laufende Nase, Pit Bull, Zungendaemon"
```

---

### Task 11: Kleinkram (Super Munchkin, Halb-Blut, Verstümmle)

Unabhängig von allen anderen Tasks außer Task 1. Kann jederzeit laufen.

**Files:**
- Create: `tests/card-kleinkram.test.js`
- Modify: `server.js` (`monsterTraitBonusSum` `:1735`, `isInstantLevelUpCard` `:1333`)

**Interfaces:**
- Consumes: Task 1
- Produces: keine neuen Signaturen

- [ ] **Step 1: Test schreiben**

```js
// SUPER MUNCHKIN / HALB-BLUT, zweite Haelfte: "Oder du darfst 1 Klassenkarte
// haben und hast alle Vorteile aber KEINE Nachteile der Klasse (z.B. Monster,
// die Priester hassen, werden diesen Bonus nicht gegen einen Super Priester
// haben)." Bisher wirkte nur die Obergrenzen-Haelfte.
const assert = require('assert');
const { ALL_CARDS, combatTotals, newEquipped } = require('../server.js');

function byName(n) { const c = ALL_CARDS.find((x) => x.name === n); assert.ok(c, n); return c; }
function makePlayer(id, extra) {
  return Object.assign({
    id, name: id.toUpperCase(), level: 5, hand: [], races: [], classes: [],
    powerGroups: [], raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), attachments: { cheatedItemId: null }, activeCurses: [],
    isBot: false, connected: true,
  }, extra || {});
}
function raumMit(p, monsterName) {
  const m = byName(monsterName);
  return { code: 'T', players: [p], turnIndex: 0, doorDiscard: [], treasureDiscard: [], log: [],
    combat: { actorId: p.id, helperId: null, monsterIds: [m.id], actorModifier: 0,
      monsterModifier: 0, mustFlee: false, ready: {} } };
}

const priester = byName('PRIESTER');
const superM = byName('SUPER MUNCHKIN');

// 1) Normaler Priester kassiert den Malus von ZUNGENDAEMON (+4 gegen Priester)
{
  const p = makePlayer('a', { classes: [priester.id] });
  assert.strictEqual(combatTotals(raumMit(p, 'ZUNGENDÄMON')).monsterStrength, 12 + 4);
}

// 2) Super-Priester (1 Klasse + Cap-Karte) bekommt den Malus nicht
{
  const p = makePlayer('a', { classes: [priester.id], classCapCard: superM.id });
  assert.strictEqual(combatTotals(raumMit(p, 'ZUNGENDÄMON')).monsterStrength, 12,
    'Super-Priester hat alle Vorteile, aber keine Nachteile');
}

// 3) Zwei Klassen + Cap-Karte: normal, mit allen Nachteilen
{
  const krieger = byName('KRIEGER');
  const p = makePlayer('a', { classes: [priester.id, krieger.id], classCapCard: superM.id });
  assert.strictEqual(combatTotals(raumMit(p, 'ZUNGENDÄMON')).monsterStrength, 12 + 4,
    'zwei Klassen heisst alle Vor- UND Nachteile');
}

console.log('OK - Super Munchkin / Halb-Blut: zweite Kartenhaelfte wirkt.');
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `node tests/card-kleinkram.test.js`
Expected: FAIL bei Fall 2 - `monsterStrength` ist 16 statt 12

- [ ] **Step 3: `monsterTraitBonusSum` erweitern**

```js
// SUPER MUNCHKIN / HALB-BLUT: "Oder du darfst 1 Klassenkarte haben und hast
// alle Vorteile aber keine Nachteile der Klasse." Der Kartentext leitet den
// Modus selbst ab - eine Wahl braucht es nicht: genau 1 Merkmal plus
// Cap-Karte heisst "ohne Nachteile", 2 Merkmale heissen "normal".
function traitImmun(player, welches) {
  if (welches === 'classes') return !!player.classCapCard && player.classes.length === 1;
  if (welches === 'races') return !!player.raceCapCard && player.races.length === 1;
  return false;
}
```

In `monsterTraitBonusSum` die `hit`-Bedingung ersetzen:

```js
    const hit = parts.some((p) =>
      (!traitImmun(p, 'races') && (rule.races || []).some((r) => hasRace(p, r)))
      || (!traitImmun(p, 'classes') && (rule.classes || []).some((k) => hasClass(p, k))));
```

- [ ] **Step 4: VERSTÜMMLE DIE LEICHEN zeitlich binden**

In `handleUseCardPower`, vor der Auflösung:

```js
  // "Diese Karte darf nur nach einem Kampf ausgespielt werden, aber es muss
  // nicht dein Kampf gewesen sein."
  if (c.name === 'VERSTÜMMLE DIE LEICHEN' && !room.combatHappenedThisTurn) {
    log(room, `${player.name} kann "${c.name}" nur nach einem Kampf ausspielen.`);
    touchRoom(room);
    return;
  }
```

- [ ] **Step 5: Tests und Commit**

Run: `npm test`
Expected: `16/16 Tests erfolgreich.`

```bash
git add server.js tests/card-kleinkram.test.js
git commit -m "Super Munchkin und Halb-Blut ohne Nachteile, Verstuemmle nur nach einem Kampf"
```

---

### Task 12: Klassenkräfte DIEB und PRIESTER

**Files:**
- Create: `tests/card-classpowers.test.js`
- Modify: `src/cards/passives.js`, `server.js` (neue Handler, Socket-Events), `public/client.js`

**Interfaces:**
- Consumes: Task 3 (`openCardTarget`), Task 4 (`rollWithWindow`)
- Produces: `handleThiefBackstab`, `handleThiefSteal`, `handlePriestResurrect`

- [ ] **Step 1: Test schreiben**

`tests/card-classpowers.test.js`:
- DIEB "In den Rücken fallen": -2 für eine **andere** Person im Kampf, kostet eine Handkarte, nur einmal pro Opfer pro Kampf
- DIEB "Diebstahl": Wurf ab 4 gelingt, sonst -1 Stufe
- PRIESTER "Auferstehung": zieht vom Ablagestapel statt vom Stapel und legt je Karte eine ab

```js
const assert = require('assert');
const { ALL_CARDS, handleThiefBackstab, combatTotals, newEquipped } = require('../server.js');
// Aufbau wie card-curses.test.js.
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `node tests/card-classpowers.test.js`
Expected: FAIL, `TypeError: handleThiefBackstab is not a function`

- [ ] **Step 3: "In den Rücken fallen"**

```js
// DIEB: "Lege eine Karte ab, um einem Spieler in den Ruecken zu fallen (-2 im
// Kampf). Das darfst du nur einmal pro Opfer pro Kampf tun, aber falls zwei
// Spieler zusammen gegen ein Monster kaempfen, darfst du beiden in den
// Ruecken fallen."
function handleThiefBackstab(room, playerId, discardCardId, targetId) {
  const c = room.combat;
  if (!c) return;
  const dieb = findPlayer(room, playerId);
  const opfer = findPlayer(room, targetId);
  if (!dieb || !opfer || !hasClass(dieb, 'DIEB')) return;
  if (dieb.id === opfer.id) return;                       // nicht sich selbst
  if (!combatParticipants(room).some((p) => p.id === opfer.id)) return; // nur Kaempfende
  if (!dieb.hand.includes(discardCardId)) return;
  c.backstabs = c.backstabs || {};
  const schluessel = `${dieb.id}:${opfer.id}`;
  if (c.backstabs[schluessel]) {
    log(room, `${dieb.name} ist ${opfer.name} in diesem Kampf schon in den Ruecken gefallen.`);
    touchRoom(room);
    return;
  }
  c.backstabs[schluessel] = true;
  removeFromHand(dieb, discardCardId);
  discardCard(room, discardCardId);
  log(room, `${dieb.name} faellt ${opfer.name} in den Ruecken: -2 im Kampf.`, [discardCardId]);
  refreshCombatReady(room);   // der Bereit-Status muss verfallen
  touchRoom(room);
}

// Summe aller Rueckenfall-Mali der aktuell Kaempfenden.
function backstabMalus(room) {
  const c = room.combat;
  if (!c || !c.backstabs) return 0;
  return Object.keys(c.backstabs).length * -2;
}
```

In `combatTotals` (`server.js:2041`) `+ backstabMalus(room)` an
`playerStrength` anhängen - **dort**, damit `combatSignature` es mitbekommt.

- [ ] **Step 4: "Diebstahl"**

```js
// DIEB: "Lege eine Karte ab, um einem anderen Spieler einen kleinen
// Gegenstand zu stehlen. Wuerfle. Bei einer 4 oder mehr gelingt es. Ansonsten
// wirst du verhauen und verlierst eine Stufe."
function handleThiefSteal(room, playerId, discardCardId, targetId) {
  const dieb = findPlayer(room, playerId);
  const opfer = findPlayer(room, targetId);
  if (!dieb || !opfer || dieb.id === opfer.id) return;
  if (!hasClass(dieb, 'DIEB') || !dieb.hand.includes(discardCardId)) return;
  removeFromHand(dieb, discardCardId);
  discardCard(room, discardCardId);
  rollWithWindow(room, dieb, 'diebstahl', (roll) => {
    if (roll >= 4) {
      // "kleiner Gegenstand" = alles, was nicht gross ist (siehe Task 2).
      const klein = equippedItemIds(opfer).filter((id) => !isBigItem(card(id)));
      if (!klein.length) {
        log(room, `${dieb.name} wuerfelt ${roll} - aber ${opfer.name} traegt keinen kleinen Gegenstand.`);
      } else {
        openCardChoice(room, dieb, 'DIEBSTAHL', klein.map((id) => ({
          id: `steal-${id}`,
          label: card(id).name,
          action: { type: 'stealItemFrom', targetId: opfer.id, cardId: id },
        })));
        log(room, `${dieb.name} wuerfelt ${roll}: der Diebstahl gelingt.`);
      }
    } else {
      setLevel(dieb, dieb.level - 1);
      log(room, `${dieb.name} wuerfelt ${roll}: erwischt! -1 Stufe (jetzt Stufe ${dieb.level}).`);
    }
    touchRoom(room);
  });
}
```

Dazu `case 'stealItemFrom'` in `applyPrimitiveAction`, das
`unequipSlotCard(opfer, cardId)` aufruft und die Karte in `dieb.hand` legt.

- [ ] **Step 5: "Auferstehung"**

```js
// PRIESTER: "Wenn du eine oder mehrere Karten offen ziehen sollst, darfst du
// stattdessen eine, mehrere oder alle Karten vom entsprechenden Ablegestapel
// ziehen. Du musst danach fuer jede so gezogene Karte eine Karte von deiner
// Hand ablegen."
function handlePriestResurrect(room, playerId, stapel) {
  const p = findPlayer(room, playerId);
  if (!p || !hasClass(p, 'PRIESTER')) return;
  const discard = stapel === 'door' ? room.doorDiscard : room.treasureDiscard;
  if (!discard.length) { log(room, `${p.name}: der Ablagestapel ist leer.`); touchRoom(room); return; }
  if (!p.hand.length) { log(room, `${p.name} hat keine Karte zum Ablegen - Auferstehung nicht moeglich.`); touchRoom(room); return; }
  const geholt = discard.pop();
  p.hand.push(geholt);
  log(room, `${p.name} nutzt "Auferstehung" und nimmt "${card(geholt).name}" vom Ablagestapel.`, [geholt]);
  // Preis: genau eine Karte ablegen, selbst gewaehlt.
  openCardChoice(room, p, 'AUFERSTEHUNG', p.hand
    .filter((id) => id !== geholt)
    .map((id) => ({ id: `ab-${id}`, label: `"${card(id).name}" ablegen`,
      action: { type: 'discardSpecificHandCard', cardId: id } })));
  touchRoom(room);
}
```

Dazu `case 'discardSpecificHandCard'` in `applyPrimitiveAction`. Der Knopf
erscheint in `renderHand` nur, wenn `hasClass(me, 'PRIESTER')` und der
passende Ablagestapel nicht leer ist.

- [ ] **Step 6: Tests und Commit**

Run: `npm test`
Expected: `17/17 Tests erfolgreich.`

```bash
git add src/cards/passives.js server.js public/client.js tests/card-classpowers.test.js
git commit -m "Klassenkraefte: Dieb (Ruecken/Diebstahl) und Priester (Auferstehung)"
```

---

### Task 13: Abnahme und Übergabe

**Files:**
- Modify: `HANDOVER.md` (neuer Abschnitt 8), `README.md` (Abschnitt "Was automatisiert ist")

- [ ] **Step 1: Volle Testsuite**

Run: `npm test`
Expected: alle Dateien grün, keine übersprungen.

- [ ] **Step 2: Abdeckung neu messen**

Run: `node /c/Users/AmirE/AppData/Local/Temp/claude/scan2.js`

Die Listen unter "### treasure_other ohne jede Automatik" und "### door_other
... kein DOOR_COMBAT_CARDS" müssen deutlich kürzer sein. Was übrig bleibt,
muss in Abschnitt 5 der Spec stehen - alles andere ist eine Lücke.

- [ ] **Step 3: Browser-Durchlauf**

Run: `npm start`, Solo-Raum mit drei Bots, mindestens 15 Runden durchklicken.
Worauf zu achten ist: kein hängender Dialog, kein Kampf, der nicht
auswertbar wird, keine Karte ohne Knopf, die einen haben müsste.

- [ ] **Step 4: HANDOVER §8 schreiben**

Inhalt: die sieben Mechanismen mit Fundstellen, die Liste der bewusst nicht
umgesetzten Karten aus Spec §5, und der Hinweis auf `BIG_ITEMS` als
kuratierte, vom Nutzer bestätigte Liste.

- [ ] **Step 5: Commit**

```bash
git add HANDOVER.md README.md
git commit -m "HANDOVER Abschnitt 8: Stand nach der Basis-Set-Kartenkraefte-Runde"
```
