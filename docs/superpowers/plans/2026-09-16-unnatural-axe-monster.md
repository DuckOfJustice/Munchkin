# Unnatural-Axe-Monster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die 27 Monsterkarten des Unnatural-Axe-Sets bekommen ihre Kampfregeln und ihre Schlimmen Dinge, soweit sie ohne zugübergreifenden Zustand auskommen.

**Architecture:** Fast alles sind Zeilen in den bestehenden Nachschlagetabellen in `src/cards/passives.js` und `src/cards/consequences.js`, die `server.js` beim Start über die Fabrikfunktion einliest. Nur sechs Stellen brauchen echten Code: ein Menschen-Begriff, eine additiv erweiterte `wennErfuellt`-Signatur, zwei neue Primitive, eine Waffen-Ausblendung in der Kampfrechnung und ein Sieg-Hook für den ganzen Tisch.

**Tech Stack:** Node.js ohne Framework, Tests sind einfache `node`-Skripte unter `tests/`, gestartet über `npm test` (`tests/run.js`).

**Spec:** `docs/superpowers/specs/2026-09-16-unnatural-axe-monster-design.md`

## Global Constraints

- Kommentare auf Deutsch, im Stil der Umgebung: über der Zeile, „warum" statt „was", mit dem zitierten Kartentext als Begründung. ASCII-Umschrift (`ae/oe/ue`) in Kommentaren ist üblich, Logtexte und Kartennamen nutzen echte Umlaute.
- Bewusste Vereinfachungen bekommen einen `ponytail:`-Kommentar, der die Grenze und den Aufrüstweg benennt.
- Jeder Name in jeder Nachschlagetabelle muss ein echter Kartenname sein — `tests/card-abilities.test.js` prüft das und wird sonst rot.
- Nach jedem Task: `npm test` muss grün sein. `tests/run.js` findet alle
  `*.test.js` selbst — mit der neuen Datei aus Task 1 sind es **27** statt 26.
- Zu jeder neuen Regel gehört eine Gegenprobe: Eintrag entfernen, der neue Test wird rot, Eintrag zurück.
- Welle 3 (RIESENSTINKTIER, WEIHNACHTSMANN-Schatzsperre, LUSTMONSTER, EISKALTES HÄNDCHEN) ist **nicht** Teil dieses Plans. Sie bekommt nach Rücksprache einen eigenen.

---

### Task 1: Testdatei und die einfachen Monsterboni

**Files:**
- Modify: `src/cards/passives.js` (Tabelle `MONSTER_TRAIT_BONUS`, ab Zeile 246)
- Test: `tests/card-unnatural-monsters.test.js` (neu)
- `tests/run.js` braucht **keine** Änderung: es liest `tests/` und nimmt jede `*.test.js`.

**Interfaces:**
- Consumes: `MONSTER_TRAIT_BONUS` mit den drei erlaubten Schreibweisen (`{races|classes, bonus}`, Regel-Array, `{wennErfuellt, bonus}`)
- Produces: die Testhelfer `findCard`, `makePlayer`, `makeRoom`, `monsterStaerke(monsterName, player)`, die alle folgenden Tasks weiterbenutzen

- [ ] **Step 1: Testdatei mit Helfern und den Bonus-Fällen anlegen**

`tests/card-unnatural-monsters.test.js`:

```js
// Unnatural Axe, Monsterkarten (Plan 2026-09-16, Spec gleichen Datums).
//
// Gemessen wird jeweils die DIFFERENZ der Monsterstaerke mit und ohne das
// genannte Merkmal - ein absoluter Wert waere auch dann gruen, wenn das
// Monster aus einem anderen Grund staerker ist.
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, combatTotals,
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
    code: 'TEST', players, turnIndex: 0, turnPhase: 'kampf',
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
    itemAttachments: {}, logs: [], combat: null, combatHappenedThisTurn: false,
    pendingConsequence: null, pendingCardAction: null, pendingRoll: null,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  };
  raeume.push(room);
  return room;
}

// Monsterstaerke gegen genau eine Person.
function monsterStaerke(monsterName, player, mitMonstern) {
  const m = findCard(monsterName, 'monster');
  const room = makeRoom([player]);
  room.combat = {
    actorId: player.id, helperId: null,
    monsterIds: [m.id].concat(mitMonstern || []),
    actorModifier: 0, monsterModifier: 0, backstabs: {},
  };
  return combatTotals(room).monsterStrength;
}

const ORK = findCard('ORK', 'door_other');
const ELF = findCard('ELF', 'race');
const ZWERG = findCard('ZWERG', 'race');
const DIEB = findCard('DIEB', 'class');
const ZAUBERER = findCard('ZAUBERER', 'class');
const KRIEGER = findCard('KRIEGER', 'class');
const PRIESTER = findCard('PRIESTER', 'class');

// --- Einfache Monsterboni ---------------------------------------------------
[
  ['KATZENMÄDCHEN', { races: [ORK.id] }, 5],
  ['TEDDYBÄR', { races: [ORK.id] }, 5],
  ['JUDGE FREDD', { classes: [DIEB.id] }, 5],
  ['M.T.-ANZUG', { classes: [ZAUBERER.id] }, 5],
  ['M.T.-ANZUG', { classes: [DIEB.id] }, 5],
  ['DING MIT EINEM ÜBERLANGEN NAMEN, DESSEN BILD NICHT AUF DIE KARTE PASST', { classes: [KRIEGER.id] }, 5],
  ['TENTAKELDÄMON', { classes: [PRIESTER.id] }, 5],
  ['ROTZ-ELEMENTAR', { races: [ELF.id] }, 4],
  ['JABBERWOCK', { races: [ZWERG.id] }, 3],
  ['JABBERWOCK', { classes: [ZAUBERER.id] }, 3],
  ['WEIHNACHTSMANN', { races: [ELF.id] }, -5],
].forEach(([monster, merkmal, erwartet]) => {
  const ohne = monsterStaerke(monster, makePlayer({}));
  const mit = monsterStaerke(monster, makePlayer(merkmal));
  assert.strictEqual(mit - ohne, erwartet,
    `${monster}: erwartet ${erwartet}, gemessen ${mit - ohne}`);
});

// "+3 gegen Zwerge oder Zauberer. Ja, das macht +6 gegen Zwergenzauberer."
{
  const ohne = monsterStaerke('JABBERWOCK', makePlayer({}));
  const beides = monsterStaerke('JABBERWOCK', makePlayer({ races: [ZWERG.id], classes: [ZAUBERER.id] }));
  assert.strictEqual(beides - ohne, 6, 'Zwergenzauberer bekommen beide Boni');
}

// "+5 gegen Zauberer oder Diebe" nennt KEINE Addition - ein Zauberer-Dieb
// bekommt den Bonus genau einmal.
{
  const ohne = monsterStaerke('M.T.-ANZUG', makePlayer({}));
  const beides = monsterStaerke('M.T.-ANZUG', makePlayer({ classes: [ZAUBERER.id, DIEB.id] }));
  assert.strictEqual(beides - ohne, 5, 'der Anzug addiert nicht');
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-unnatural-monsters: ok');
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — `KATZENMÄDCHEN: erwartet 5, gemessen 0`

- [ ] **Step 3: Die Tabellenzeilen ergänzen**

In `src/cards/passives.js`, in `MONSTER_TRAIT_BONUS` hinter dem Block der Clerical-Errors-Einträge:

```js
    // --- Unnatural Axe ------------------------------------------------------
    'KATZENMÄDCHEN': { races: ['ORK'], bonus: 5 },                                 // "Toedlich niedlich. +5 gegen Orks."
    'TEDDYBÄR': { races: ['ORK'], bonus: 5 },                                      // "Schrecklich niedlich. +5 gegen Orks."
    'JUDGE FREDD': { classes: ['DIEB'], bonus: 5 },                                // "+5 gegen Diebe."
    'M.T.-ANZUG': { classes: ['ZAUBERER', 'DIEB'], bonus: 5 },                     // "+5 gegen Zauberer oder Diebe." - "oder", also einmal.
    'DING MIT EINEM ÜBERLANGEN NAMEN, DESSEN BILD NICHT AUF DIE KARTE PASST': { classes: ['KRIEGER'], bonus: 5 }, // "+5 gegen Krieger."
    'TENTAKELDÄMON': { classes: ['PRIESTER'], bonus: 5 },                          // "Eine Hoellenkreatur. +5 gegen Priester."
    'ROTZ-ELEMENTAR': { races: ['ELF'], bonus: 4 },                                // "+4 gegen Elfen (uuuaaaah)."
    // "+3 gegen Zwerge oder Zauberer. Ja, das macht +6 gegen Zwergenzauberer."
    // Die Karte sagt die Addition ausdruecklich - deshalb zwei Regeln.
    'JABBERWOCK': [{ races: ['ZWERG'], bonus: 3 }, { classes: ['ZAUBERER'], bonus: 3 }],
    'WEIHNACHTSMANN': { races: ['ELF'], bonus: -5 },                               // "-5 gegen Elfen. Der Narr vertraut den Elfen."
```

- [ ] **Step 4: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: `card-unnatural-monsters: ok` und `27/27 Tests erfolgreich.`

- [ ] **Step 5: Gegenprobe**

Eine Zeile (z. B. `'JUDGE FREDD'`) auskommentieren, `node tests/card-unnatural-monsters.test.js` muss rot werden, Zeile zurück.

- [ ] **Step 6: Commit**

```bash
git add src/cards/passives.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: Monsterboni der Monsterkarten"
```

---

### Task 2: Stufengrenzen und Weglauf-Modifikatoren

**Files:**
- Modify: `src/cards/passives.js` (`MONSTER_REFUSES` ab Zeile 18, `FLEE_MONSTER_MOD` ab Zeile 334)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `MONSTER_REFUSES` als `{ [name]: (player) => boolean }`, `FLEE_MONSTER_MOD` als `{ [name]: number }`
- Produces: nichts Neues

- [ ] **Step 1: Test ergänzen**

Import-Zeile der Testdatei erweitern zu:

```js
const {
  ALL_CARDS, newEquipped, combatTotals, monsterRefusesTarget, fleeModifierParts,
} = require('../server.js');
```

Vor der Aufräumzeile am Dateiende einfügen:

```js
// --- "Greift niemanden mit Stufe N oder niedriger an" -----------------------
[
  ['FEUERLÖSCHER', 2],
  ['TENTAKELDÄMON', 2],
  ['JABBERWOCK', 4],
].forEach(([monster, grenze]) => {
  const m = findCard(monster, 'monster');
  assert.ok(monsterRefusesTarget(m.id, makePlayer({ level: grenze })),
    `${monster} darf Stufe ${grenze} nicht angreifen`);
  assert.ok(!monsterRefusesTarget(m.id, makePlayer({ level: grenze + 1 })),
    `${monster} greift Stufe ${grenze + 1} an`);
});

// --- Weglauf-Modifikatoren --------------------------------------------------
[
  ['WERSCHILDKRÖTE', 2],   // "Greift seeehr langsam an. +2 fuer Weglaufen."
  ['PESTRATTEN', -1],      // "Alle anderen muessen kaempfen und erhalten -1 fuer Weglaufen."
].forEach(([monster, erwartet]) => {
  const m = findCard(monster, 'monster');
  const p = makePlayer({});
  const room = makeRoom([p]);
  room.combat = { actorId: p.id, helperId: null, monsterIds: [m.id], actorModifier: 0, monsterModifier: 0 };
  const summe = fleeModifierParts(room, p).reduce((s, t) => s + t.amount, 0);
  assert.strictEqual(summe, erwartet, `${monster}: Weglauf-Modifikator ${erwartet}`);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — `FEUERLÖSCHER darf Stufe 2 nicht angreifen`

- [ ] **Step 3: Tabellenzeilen ergänzen**

In `MONSTER_REFUSES`:

```js
    // --- Unnatural Axe ---
    'FEUERLÖSCHER': (p) => p.level <= 2,   // "Greift niemanden mit Stufe 2 oder niedriger an."
    'TENTAKELDÄMON': (p) => p.level <= 2,  // "Greift niemanden mit Stufe 2 oder niedriger an."
    'JABBERWOCK': (p) => p.level <= 4,     // "Greift niemanden mit Stufe 4 oder niedriger an."
```

In `FLEE_MONSTER_MOD`:

```js
    'WERSCHILDKRÖTE': 2,  // "Greift seeehr langsam an. +2 fuer Weglaufen."
    'PESTRATTEN': -1,     // "Alle anderen muessen kaempfen und erhalten -1 fuer Weglaufen."
```

- [ ] **Step 4: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 5: Gegenprobe**

`'JABBERWOCK': (p) => p.level <= 4,` auskommentieren → Test rot. Zurück.

- [ ] **Step 6: Commit**

```bash
git add src/cards/passives.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: Stufengrenzen und Weglauf-Modifikatoren"
```

---

### Task 3: Die zwei einfachen Schlimmen Dinge

**Files:**
- Modify: `src/cards/consequences.js` (`CONSEQUENCE_OVERRIDES`)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: Primitive `queuedDiscardOwn` (`{ type, count, quelle: 'hand', cardName, prompt }`) und `queuedTakeFromHand` (`{ type, mode: 'allOthers' }`)
- Produces: nichts Neues

- [ ] **Step 1: Test ergänzen**

Import erweitern um `resolveConsequenceSpec, applyPrimitiveAction, handleResolveCardCardChoice`. Dann:

```js
// --- Schlimme Dinge: GEWALTIGER BAZILLUS ------------------------------------
// "Du niest unaufhoerlich ... Lege zwei Karten (deiner Wahl) aus deiner Hand ab."
{
  const bazillus = findCard('GEWALTIGER BAZILLUS', 'monster');
  const fueller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 4).map((c) => c.id);
  const p = makePlayer({ hand: fueller.slice() });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  const spec = resolveConsequenceSpec(bazillus.name, bazillus.badstuff, p, room);
  assert.ok(spec, 'der Bazillus braucht eine Automatik');
  applyPrimitiveAction(room, p, spec);
  for (let i = 0; i < 2; i++) {
    assert.ok(room.pendingCardAction, `Wahl ${i + 1} von 2 muss offen sein`);
    handleResolveCardCardChoice(room, p.id, room.pendingCardAction.candidateIds[0]);
  }
  assert.strictEqual(p.hand.length, 2, 'genau zwei Karten abgelegt');
  assert.strictEqual(room.pendingCardAction, null, 'danach haengt nichts');
}

// --- Schlimme Dinge: MONDJUNGFERN -------------------------------------------
// "Decke deine Hand auf und jeder andere Spieler darf eine Karte waehlen."
{
  const jungfern = findCard('MONDJUNGFERN', 'monster');
  const fueller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 3).map((c) => c.id);
  const opfer = makePlayer({ hand: fueller.slice() });
  const b = makePlayer({ id: 'p2', name: 'B' });
  const c2 = makePlayer({ id: 'p3', name: 'C' });
  const room = makeRoom([opfer, b, c2]);
  applyPrimitiveAction(room, opfer, resolveConsequenceSpec(jungfern.name, jungfern.badstuff, opfer, room));
  const nehmer = [];
  while (room.pendingCardAction) {
    nehmer.push(room.pendingCardAction.playerId);
    handleResolveCardCardChoice(room, room.pendingCardAction.playerId, room.pendingCardAction.candidateIds[0]);
  }
  assert.deepStrictEqual(nehmer.sort(), ['p2', 'p3'], 'beide anderen duerfen je eine Karte nehmen');
  assert.strictEqual(opfer.hand.length, 1, 'zwei Karten sind weg');
  assert.strictEqual(b.hand.length + c2.hand.length, 2, 'und liegen bei den anderen');
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — `der Bazillus braucht eine Automatik`

- [ ] **Step 3: Overrides ergänzen**

In `src/cards/consequences.js`, in `CONSEQUENCE_OVERRIDES` neben den anderen `queuedDiscardOwn`-Einträgen:

```js
    // "Du niest unaufhoerlich und laesst deine Karten fallen. Lege zwei Karten
    // (deiner Wahl) aus deiner Hand ab."
    'GEWALTIGER BAZILLUS': () => ({ type: 'queuedDiscardOwn', count: 2, quelle: 'hand',
      cardName: 'GEWALTIGER BAZILLUS', prompt: 'Eine Handkarte ablegen' }),
    // "Decke deine Hand auf und jeder andere Spieler darf eine Karte waehlen."
    // Gleiche Bauform wie HIPPOGREIF/ANWALT - das Aufdecken selbst braucht
    // keinen eigenen Schritt, der Waehler zeigt die Hand ohnehin.
    'MONDJUNGFERN': () => ({ type: 'queuedTakeFromHand', mode: 'allOthers' }),
```

- [ ] **Step 4: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 5: Gegenprobe**

`'MONDJUNGFERN'`-Zeile auskommentieren → Test rot. Zurück.

- [ ] **Step 6: Commit**

```bash
git add src/cards/consequences.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: Schlimme Dinge von Bazillus und Mondjungfern"
```

Damit ist Welle 1 fertig.

---

### Task 4: Menschen-Begriff und die zwei Menschen-Boni

**Files:**
- Modify: `src/cards/passives.js` (neue Hilfsfunktion, zwei Einträge in `MONSTER_TRAIT_BONUS`)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `monsterSeesRace` wird der Fabrik heute **nicht** übergeben — die Fabrik bekommt `{ card, hasRace, hasClass, equippedItemIds, istGeschlecht }` (server.js:2564). Dieser Task erweitert den Übergabesatz um `monsterSeesRace`.
- Produces: `istMensch(player)` innerhalb von `passives.js`

- [ ] **Step 1: Test ergänzen**

```js
// --- "Mensch" = keine Rassenkarte -------------------------------------------
[
  ['RIESENKAKERLAKE', 5],  // "+5 gegen Elfen oder Menschen."
  ['GRASGNOLL', 5],        // "+5 gegen Menschen."
].forEach(([monster, erwartet]) => {
  const mitRasse = monsterStaerke(monster, makePlayer({ races: [ZWERG.id] }));
  const ohneRasse = monsterStaerke(monster, makePlayer({}));
  assert.strictEqual(ohneRasse - mitRasse, erwartet,
    `${monster}: Menschen bekommen ${erwartet}`);
});

// Die Kakerlake trifft Elfen ebenso - aber nur einmal, nicht zusaetzlich.
{
  const zwerg = monsterStaerke('RIESENKAKERLAKE', makePlayer({ races: [ZWERG.id] }));
  const elf = monsterStaerke('RIESENKAKERLAKE', makePlayer({ races: [ELF.id] }));
  assert.strictEqual(elf - zwerg, 5, 'Elfen bekommen denselben Bonus');
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — `RIESENKAKERLAKE: Menschen bekommen 5`

- [ ] **Step 3: `monsterSeesRace` an die Fabrik durchreichen**

In `server.js` Zeile 2564 den Übergabesatz erweitern:

```js
} = passivesFactory({ card, hasRace, hasClass, equippedItemIds, istGeschlecht, monsterSeesRace });
```

`monsterSeesRace` ist eine `function`-Deklaration (server.js:2736) und damit gehoisted — der Aufruf oberhalb ihrer Definition ist zulässig.

In `src/cards/passives.js` die Signatur der Fabrik entsprechend erweitern und oberhalb von `MONSTER_TRAIT_BONUS` ergänzen:

```js
  // "Mensch" ist in Munchkin keine Karte, sondern ihr Fehlen: wer keine
  // Rassenkarte hat, ist Mensch. Geprueft wird durch dieselbe Brille wie alle
  // anderen Monsterboni - wer FALSCHE OHREN traegt, gilt fuer Monster als
  // Zwerg und damit nicht als Mensch.
  const istMensch = (p) => !['ELF', 'ZWERG', 'HALBLING', 'ORK', 'GNOM']
    .some((r) => monsterSeesRace(p, r));
```

- [ ] **Step 4: Die zwei Einträge ergänzen**

In `MONSTER_TRAIT_BONUS`, im Unnatural-Axe-Block:

```js
    // "+5 gegen Elfen oder Menschen." - eine Regel, nicht zwei: ein Elf ist
    // kein Mensch, die Faelle schliessen sich aus.
    'RIESENKAKERLAKE': { wennErfuellt: (p) => monsterSeesRace(p, 'ELF') || istMensch(p), bonus: 5 },
    'GRASGNOLL': { wennErfuellt: (p) => istMensch(p), bonus: 5 },   // "+5 gegen Menschen."
```

- [ ] **Step 5: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 6: Commit**

```bash
git add server.js src/cards/passives.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: Menschen-Begriff fuer Riesenkakerlake und Grasgnoll"
```

---

### Task 5: `wennErfuellt` bekommt den Raum, FEUERLÖSCHER

**Files:**
- Modify: `server.js` (`monsterTraitBonusSum`, Zeile 2757-2782)
- Modify: `src/cards/passives.js` (ein Eintrag)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `monsterTraitBonusSum(room)` ruft heute `rule.wennErfuellt(p)` auf
- Produces: erweiterte Signatur `wennErfuellt(player, room)` — alle bestehenden Regeln ignorieren das zweite Argument

- [ ] **Step 1: Test ergänzen**

```js
// --- FEUERLÖSCHER: "Erhaelt +5, wenn dir niemand hilft." --------------------
{
  const m = findCard('FEUERLÖSCHER', 'monster');
  const a = makePlayer({ level: 9 });
  const b = makePlayer({ id: 'p2', name: 'B', level: 9 });
  const room = makeRoom([a, b]);
  room.combat = { actorId: a.id, helperId: null, monsterIds: [m.id], actorModifier: 0, monsterModifier: 0, backstabs: {} };
  const allein = combatTotals(room).monsterStrength;
  room.combat.helperId = b.id;
  const mitHilfe = combatTotals(room).monsterStrength;
  assert.strictEqual(allein - mitHilfe, 5, 'ohne Hilfe ist der Loescher 5 staerker');
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — `ohne Hilfe ist der Loescher 5 staerker` (gemessen 0)

- [ ] **Step 3: Signatur erweitern**

In `server.js`, in `monsterTraitBonusSum`, die Zeile

```js
        || (rule.wennErfuellt ? rule.wennErfuellt(p) : false));
```

ersetzen durch

```js
        // Der Raum kommt als zweites Argument dazu, damit eine Regel den
        // Kampfzustand sehen kann (FEUERLÖSCHER: "+5, wenn dir niemand
        // hilft"). Alle aelteren Regeln ignorieren ihn.
        || (rule.wennErfuellt ? rule.wennErfuellt(p, room) : false));
```

- [ ] **Step 4: Eintrag ergänzen**

In `MONSTER_TRAIT_BONUS`, Unnatural-Axe-Block:

```js
    // "Greift mit zahlreichen Koepfen an. Erhaelt +5, wenn dir niemand hilft."
    // Haengt am Kampf, nicht an der Person - deshalb ueber den Raum.
    'FEUERLÖSCHER': { wennErfuellt: (p, room) => !(room.combat && room.combat.helperId), bonus: 5 },
```

- [ ] **Step 5: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün. Besonders `tests/card-clerical-monsters.test.js` muss grün bleiben — dort hängen die bestehenden `wennErfuellt`-Regeln.

- [ ] **Step 6: Commit**

```bash
git add server.js src/cards/passives.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: Feuerloescher-Bonus ohne Hilfe, wennErfuellt sieht den Raum"
```

---

### Task 6: MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT — Kampfbonus

**Files:**
- Modify: `src/cards/passives.js` (ein Regel-Array)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `istGeschlecht(player, 'w')` aus der Fabrik-Übergabe
- Produces: nichts Neues

- [ ] **Step 1: Test ergänzen**

```js
// --- MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT -------------------------
// "+4 gegen Zwerge, +2 gegen Frauen, -3 gegen Zauberer, -2 am Samstag."
{
  const NAME = 'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT';
  const basis = monsterStaerke(NAME, makePlayer({}));
  assert.strictEqual(monsterStaerke(NAME, makePlayer({ races: [ZWERG.id] })) - basis, 4, 'Zwerge +4');
  assert.strictEqual(monsterStaerke(NAME, makePlayer({ gender: 'w' })) - basis, 2, 'Frauen +2');
  assert.strictEqual(monsterStaerke(NAME, makePlayer({ classes: [ZAUBERER.id] })) - basis, -3, 'Zauberer -3');
  // Alle vier Klauseln greifen unabhaengig voneinander.
  assert.strictEqual(
    monsterStaerke(NAME, makePlayer({ races: [ZWERG.id], gender: 'w', classes: [ZAUBERER.id] })) - basis,
    3, 'Zwergin mit Zaubererklasse: +4 +2 -3');
}
{
  // Der Samstags-Malus haengt am echten Wochentag - geprueft mit gestelltem
  // Date, damit der Test nicht vom Kalender abhaengt.
  const NAME = 'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT';
  const echtesDate = global.Date;
  const stelle = (wochentag) => {
    class FakeDate extends echtesDate {
      constructor(...args) { super(...(args.length ? args : [2026, 8, 12 + wochentag])); }
      getDay() { return wochentag; }
    }
    global.Date = FakeDate;
  };
  try {
    stelle(3); // Mittwoch
    const mittwoch = monsterStaerke(NAME, makePlayer({}));
    stelle(6); // Samstag
    const samstag = monsterStaerke(NAME, makePlayer({}));
    assert.strictEqual(samstag - mittwoch, -2, 'am Samstag ist es 2 schwaecher');
  } finally {
    global.Date = echtesDate;
  }
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — `Zwerge +4`

- [ ] **Step 3: Eintrag ergänzen**

```js
    // "+4 gegen Zwerge, +2 gegen Frauen, -3 gegen Zauberer, -2 am Samstag."
    // Vier unabhaengige Klauseln, also vier Regeln. Der Samstag ist der echte
    // Wochentag - das ist der Gag der Karte.
    // ponytail: dadurch aendert sich die Monsterstaerke ueber Mitternacht
    // hinweg. Wer das nicht will, streicht die letzte Regel.
    'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT': [
      { races: ['ZWERG'], bonus: 4 },
      { wennErfuellt: (p) => istGeschlecht(p, 'w'), bonus: 2 },
      { classes: ['ZAUBERER'], bonus: -3 },
      { wennErfuellt: () => new Date().getDay() === 6, bonus: -2 },
    ],
```

- [ ] **Step 4: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 5: Commit**

```bash
git add src/cards/passives.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: der vierteilige Bonus des SL-Monsters"
```

---

### Task 7: PSYCHO-EICHHÖRNCHEN und PESTRATTEN verweigern den Kampf

**Files:**
- Modify: `src/cards/passives.js` (`MONSTER_REFUSES`, `MONSTER_REFUSES_TREASURE`)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `MONSTER_REFUSES_TREASURE` als `{ [name]: anzahlSchaetze }` (Vorbild AMAZONE)
- Produces: nichts Neues

- [ ] **Step 1: Test ergänzen**

```js
// --- Monster, die bestimmte Leute gar nicht angreifen -----------------------
{
  // "Greift keine Frauen an oder Traeger des Stacheligen Genitalschoners."
  const m = findCard('PSYCHO-EICHHÖRNCHEN', 'monster');
  assert.ok(monsterRefusesTarget(m.id, makePlayer({ gender: 'w' })), 'Frauen werden nicht angegriffen');
  assert.ok(!monsterRefusesTarget(m.id, makePlayer({ gender: 'm' })), 'Maenner schon');
}
{
  // "Fluechtet vor Orks, statt anzugreifen und hinterlaesst den Schatz."
  const m = findCard('PESTRATTEN', 'monster');
  assert.ok(monsterRefusesTarget(m.id, makePlayer({ races: [ORK.id] })), 'vor Orks fluechten sie');
  assert.ok(!monsterRefusesTarget(m.id, makePlayer({})), 'alle anderen muessen kaempfen');
  const { MONSTER_REFUSES_TREASURE } = require('../server.js');
  assert.strictEqual(MONSTER_REFUSES_TREASURE['PESTRATTEN'], m.treasureCount,
    'der hinterlassene Schatz entspricht dem Schatzwert der Karte');
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — `Frauen werden nicht angegriffen`

- [ ] **Step 3: `MONSTER_REFUSES_TREASURE` exportieren**

Die Konstante wird in server.js:2553 aus der Fabrik entnommen, steht aber **nicht** in `module.exports` — nachgeprüft: `require('./server.js').MONSTER_REFUSES_TREASURE` ist heute `undefined`. In `module.exports` neben `MONSTER_REFUSES` ergänzen:

```js
  CURSE_PROOF_ITEMS, MONSTER_REFUSES, MONSTER_REFUSES_TREASURE, MONSTER_TRAIT_BONUS, MONSTER_IGNORES_LEVEL,
```

(die bestehende Export-Zeile um `MONSTER_REFUSES_TREASURE` erweitern, Reihenfolge sonst unverändert lassen)

- [ ] **Step 4: Einträge ergänzen**

In `MONSTER_REFUSES`:

```js
    // "Greift keine Frauen an oder Traeger des Stacheligen Genitalschoners."
    // ponytail: nur die Geschlechts-Klausel. Der STACHELIGE GENITALSCHONER
    // liegt in den Rohdaten als treasure_other ohne slotKind und laesst sich
    // deshalb gar nicht tragen - die Klausel kommt in der Runde nach, in der
    // die Unnatural-Axe-Schatzkarten ihren Slot bekommen.
    'PSYCHO-EICHHÖRNCHEN': (p) => istGeschlecht(p, 'w'),
    // "Fluechtet vor Orks, statt anzugreifen und hinterlaesst den Schatz."
    'PESTRATTEN': (p) => hasRace(p, 'ORK'),
```

In `MONSTER_REFUSES_TREASURE`:

```js
    'PESTRATTEN': 2,  // "... und hinterlaesst den Schatz." - die Karte nennt 2 Schaetze.
```

- [ ] **Step 5: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 6: Commit**

```bash
git add server.js src/cards/passives.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: Eichhoernchen und Pestratten verweigern den Kampf"
```

---

### Task 8: Primitiv `diceDiscardHand` und das KATZENMÄDCHEN

**Files:**
- Modify: `server.js` (`applyPrimitiveAction`, neuer `case` neben `diceLevelLoss`)
- Modify: `src/cards/consequences.js` (ein Override)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `wurfMitFenster(room, player, zweck, (roll) => beschreibung)` — der zentrale Wurf inklusive Reaktionsfenster; `queuedDiscardOwn` als Folgeaktion
- Produces: Primitiv `{ type: 'diceDiscardHand', cardName }`

- [ ] **Step 1: Vorbild kennen**

Die Wurf-Hilfsfunktion heißt `wurfMitFenster(room, player, zweck, (roll) => beschreibung)` — sie öffnet bei Bedarf das Reaktionsfenster (GEZINKTER WÜRFEL) und ruft den Rückruf mit der Augenzahl auf; der Rückruf gibt den Beschreibungstext zurück. Vorbild ist `case 'diceLevelLoss'` (server.js:1410):

```js
    case 'diceLevelLoss':
      return wurfMitFenster(room, player, 'stufenverlust', (roll) => {
        setLevel(player, player.level - roll);
        return `Würfelwurf ${roll} -> -${roll} Stufe(n)`;
      });
```

- [ ] **Step 2: Test ergänzen**

```js
// --- KATZENMÄDCHEN: "Wirf den Wuerfel und lege so viele Karten ab." ---------
{
  const katze = findCard('KATZENMÄDCHEN', 'monster');
  const fueller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 6).map((c) => c.id);
  const p = makePlayer({ hand: fueller.slice() });
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  const echtesRandom = Math.random;
  Math.random = () => 0.5; // 6 * 0.5 = 3 -> Wurf 4
  try {
    applyPrimitiveAction(room, p, resolveConsequenceSpec(katze.name, katze.badstuff, p, room));
  } finally {
    Math.random = echtesRandom;
  }
  let gewaehlt = 0;
  while (room.pendingCardAction && gewaehlt < 10) {
    handleResolveCardCardChoice(room, p.id, room.pendingCardAction.candidateIds[0]);
    gewaehlt++;
  }
  assert.strictEqual(gewaehlt, 4, 'bei einer 4 werden vier Karten abgelegt');
  assert.strictEqual(p.hand.length, 2, 'von sechs bleiben zwei');
}
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — der Spec liefert `null`, `applyPrimitiveAction` bekommt `null`.

- [ ] **Step 4: Primitiv ergänzen**

In `server.js`, in `applyPrimitiveAction` direkt hinter `case 'diceLevelLoss':`:

```js
    // KATZENMÄDCHEN: "Wirf den Wuerfel und lege so viele Karten aus deiner
    // Hand ab." Gleiche Bauform wie diceLevelLoss, nur dass die Augenzahl die
    // Anzahl der Karten ist statt der Stufen.
    case 'diceDiscardHand':
      return wurfMitFenster(room, player, 'handkartenverlust', (roll) => {
        const anzahl = Math.min(roll, player.hand.length);
        if (!anzahl) return `Würfelwurf ${roll} -> keine Handkarten zum Ablegen`;
        applyPrimitiveAction(room, player, { type: 'queuedDiscardOwn', count: anzahl, quelle: 'hand',
          cardName: action.cardName || 'Schlimme Dinge', prompt: 'Eine Handkarte ablegen' });
        return `Würfelwurf ${roll} -> ${anzahl} Handkarte(n) ablegen`;
      });
```

- [ ] **Step 5: Override ergänzen**

In `src/cards/consequences.js`:

```js
    // "Kratzer und Allergien. Wirf den Wuerfel und lege so viele Karten aus
    // deiner Hand ab."
    'KATZENMÄDCHEN': () => ({ type: 'diceDiscardHand', cardName: 'KATZENMÄDCHEN' }),
```

- [ ] **Step 6: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 7: Commit**

```bash
git add server.js src/cards/consequences.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: Katzenmaedchen wuerfelt die Zahl der abgelegten Karten"
```

---

### Task 9: PTERODAKTYL — ganze Hand oder alle kleinen Gegenstände

**Files:**
- Modify: `src/cards/consequences.js`
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `choice`-Spec (`{ type: 'choice', options: [{ id, label, action }] }`), Primitive `discardWholeHand` und `queuedDiscardOwn` mit `quelle: 'kleineGegenstaende'`
- Produces: nichts Neues

- [ ] **Step 1: Test ergänzen**

```js
// --- PTERODAKTYL: "Lege deine ganze Hand ODER alle kleinen Gegenstaende ab" -
{
  const ptero = findCard('PTERODAKTYL', 'monster');
  const p = makePlayer({});
  const room = makeRoom([p]);
  const spec = resolveConsequenceSpec(ptero.name, ptero.badstuff, p, room);
  assert.strictEqual(spec.type, 'choice', 'die Karte laesst waehlen');
  assert.strictEqual(spec.options.length, 2, 'genau zwei Moeglichkeiten');
  const ids = spec.options.map((o) => o.action.type).sort();
  assert.deepStrictEqual(ids, ['discardWholeHand', 'queuedDiscardOwn'].sort(),
    'ganze Hand oder alle kleinen Gegenstaende');
}
{
  // Die Hand-Variante wirkt auch wirklich.
  const ptero = findCard('PTERODAKTYL', 'monster');
  const fueller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 3).map((c) => c.id);
  const p = makePlayer({ hand: fueller.slice() });
  const room = makeRoom([p]);
  const spec = resolveConsequenceSpec(ptero.name, ptero.badstuff, p, room);
  const handOption = spec.options.find((o) => o.action.type === 'discardWholeHand');
  applyPrimitiveAction(room, p, handOption.action);
  assert.strictEqual(p.hand.length, 0, 'die Hand ist weg');
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — `spec` ist `null`, Zugriff auf `.type` wirft.

- [ ] **Step 3: Override ergänzen**

```js
    // "Er hebt dich auf und laesst dich aus grosser Hoehe fallen. Lege deine
    // ganze Hand oder alle kleinen Gegenstaende ab ... Du hast die Wahl."
    // Die Zahl der kleinen Gegenstaende steht erst beim Ausspielen fest,
    // deshalb queuedDiscardOwn ueber die ganze Menge statt einer festen Zahl.
    'PTERODAKTYL': (player, room) => ({
      type: 'choice',
      options: [
        { id: 'hand', label: 'Die ganze Hand ablegen', action: { type: 'discardWholeHand' } },
        { id: 'klein', label: 'Alle kleinen Gegenstaende ablegen',
          action: { type: 'queuedDiscardOwn', count: kleineGegenstaendeAnzahl(player, room),
            quelle: 'kleineGegenstaende', cardName: 'PTERODAKTYL',
            prompt: 'Einen kleinen Gegenstand ablegen' } },
      ],
    }),
```

Dafür oberhalb der Tabelle eine Hilfszeile ergänzen — `istGrosserGegenstand` ist in `consequences.js` bereits im Fabrik-Umfang (wird von `bigItemCount` genutzt, siehe `GRÜNSCHLEIM`):

```js
  // "alle kleinen Gegenstaende": die Anzahl steht erst im Moment der
  // Konsequenz fest, weil Anhaenge (NÜTZLICHE GRIFFE) aus einem Grossen einen
  // kleinen machen koennen.
  const kleineGegenstaendeAnzahl = (player, room) =>
    equippedItemIds(player).filter((id) => !istGrosserGegenstand(room, id)).length;
```

`equippedItemIds` und `istGrosserGegenstand` stehen bereits im Übergabesatz der Fabrik (server.js:1913-1917) — hier ist nichts nachzureichen.

- [ ] **Step 4: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 5: Commit**

```bash
git add src/cards/consequences.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: Pterodaktyl laesst zwischen Hand und kleinen Gegenstaenden waehlen"
```

---

### Task 10: MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT — Schlimme Dinge

**Files:**
- Modify: `src/cards/consequences.js`
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `combo` (`{ type: 'combo', actions: [...] }`), `levelDelta`, `queuedDiscardOwn`
- Produces: nichts Neues

- [ ] **Step 1: Test ergänzen**

```js
// --- SL-Monster, Schlimme Dinge ---------------------------------------------
// "Halblinge verlieren eine Stufe. Elfen verlieren zwei Stufen. Maenner
// verlieren eine zusaetzliche Stufe und muessen eine Karte ablegen.
// Diejenigen, die nicht unter die Kriterien oben fallen, muessen zwei Karten
// ablegen."
{
  const NAME = 'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT';
  const sl = findCard(NAME, 'monster');
  const HALBLING = findCard('HALBLING', 'race');
  const stufenVerlust = (spieler) => {
    const p = makePlayer(spieler);
    const room = makeRoom([p]);
    const vorher = p.level;
    const spec = resolveConsequenceSpec(NAME, sl.badstuff, p, room);
    assert.ok(spec, 'das SL-Monster braucht eine Automatik');
    applyPrimitiveAction(room, p, spec);
    return vorher - p.level;
  };
  assert.strictEqual(stufenVerlust({ races: [HALBLING.id], gender: 'w' }), 1, 'Halbling-Frau: 1 Stufe');
  assert.strictEqual(stufenVerlust({ races: [ELF.id], gender: 'w' }), 2, 'Elfen-Frau: 2 Stufen');
  assert.strictEqual(stufenVerlust({ races: [ELF.id], gender: 'm' }), 3, 'Elfen-Mann: 2 + 1 zusaetzlich');
  assert.strictEqual(stufenVerlust({ gender: 'w' }), 0, 'Frau ohne Rasse: keine Stufe, dafuer Karten');
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — `das SL-Monster braucht eine Automatik`

- [ ] **Step 3: Override ergänzen**

```js
    // "Halblinge verlieren eine Stufe. Elfen verlieren zwei Stufen. Maenner
    // verlieren eine zusaetzliche Stufe und muessen eine Karte ablegen.
    // Diejenigen, die nicht unter die Kriterien oben fallen, muessen zwei
    // Karten ablegen."
    'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT': (player) => {
      const stufen = (hasRace(player, 'ELF') ? 2 : 0) + (hasRace(player, 'HALBLING') ? 1 : 0)
        + (istGeschlecht(player, 'm') ? 1 : 0);
      // "nicht unter die Kriterien oben" = weder Halbling noch Elf noch Mann.
      const karten = stufen === 0 ? 2 : (istGeschlecht(player, 'm') ? 1 : 0);
      const actions = [];
      if (stufen) actions.push({ type: 'levelDelta', amount: stufen });
      if (karten) actions.push({ type: 'queuedDiscardOwn', count: karten, quelle: 'hand',
        cardName: 'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT', prompt: 'Eine Handkarte ablegen' });
      if (!actions.length) return { type: 'noEffect' };
      return actions.length === 1 ? actions[0] : { type: 'combo', actions };
    },
```

- [ ] **Step 4: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 5: Commit**

```bash
git add src/cards/consequences.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: die vierteiligen Schlimmen Dinge des SL-Monsters"
```

---

### Task 11: MONDJUNGFERN — keine Vorteile durch Waffen

**Files:**
- Modify: `src/cards/passives.js` (neue Menge `MONSTER_IGNORES_WEAPONS`)
- Modify: `server.js` (Übernahme aus der Fabrik, `combatTotals` Zeile 3420-3431)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `combatTotals` berechnet `items` je Person; `curseSuppressesItemBonuses` ist das Vorbild für „Boni ausblenden, aber nicht alle"
- Produces: `MONSTER_IGNORES_WEAPONS` (Set von Monsternamen)

- [ ] **Step 1: Test ergänzen**

```js
// --- MONDJUNGFERN: "In diesem Kampf erhaeltst du keine Vorteile durch Waffen"
{
  const waffe = ALL_CARDS.find((c) => c.category === 'item' && c.slotKind === 'hand' && c.bonus > 0);
  const ruestung = ALL_CARDS.find((c) => c.category === 'item' && c.slotKind === 'armor' && c.bonus > 0);
  assert.ok(waffe && ruestung, 'Testgegenstaende gefunden');
  const staerke = (monsterName) => {
    const m = findCard(monsterName, 'monster');
    const p = makePlayer({ equipped: Object.assign(newEquipped(), { hands: [waffe.id, null], armor: ruestung.id }) });
    const room = makeRoom([p]);
    room.combat = { actorId: p.id, helperId: null, monsterIds: [m.id], actorModifier: 0, monsterModifier: 0, backstabs: {} };
    return combatTotals(room).playerStrength;
  };
  const gegenJungfern = staerke('MONDJUNGFERN');
  const gegenAnderes = staerke('PESTRATTEN');
  assert.strictEqual(gegenAnderes - gegenJungfern, waffe.bonus,
    'gegen die Mondjungfern faellt genau der Waffenbonus weg');
  assert.ok(gegenJungfern > 0, 'Ruestung und Stufe zaehlen weiter');
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — Differenz 0 statt `waffe.bonus`

- [ ] **Step 3: Tabelle anlegen**

In `src/cards/passives.js` neben `MONSTER_IGNORES_BONUSES`:

```js
  // --- Monster, gegen die Waffen nichts bringen ----------------------------
  // MONDJUNGFERN: "Du musst sie mit leeren Haenden bestrafen. In diesem Kampf
  // erhaeltst du keine Vorteile durch Waffen." Kleiner Bruder von
  // MONSTER_IGNORES_BONUSES, das ALLE Boni streicht.
  // ponytail: "Waffe" heisst hier wie in waffenAnzahl "belegt eine Hand" -
  // ein Schild zaehlt also mit. Kuratierte Ausnahmeliste waere der Aufruestweg.
  const MONSTER_IGNORES_WEAPONS = new Set(['MONDJUNGFERN']);
```

Am Ende der Fabrik im Rückgabeobjekt ergänzen (dort, wo auch `MONSTER_IGNORES_BONUSES` steht).

- [ ] **Step 4: In `server.js` übernehmen und anwenden**

Den Namen in die Destrukturierung bei server.js:2555 aufnehmen. Dann in `combatTotals` die Item-Berechnung erweitern:

```js
  const ignoreWeapons = combatHasMonster(room, MONSTER_IGNORES_WEAPONS);
```

(direkt neben `const ignoreBonuses = ...`), und im `else`-Zweig die `items`-Zeile:

```js
      const items = curseSuppressesItemBonuses(p)
        ? ((card(p.equipped.armor) || {}).bonus || 0)
        : equippedBonusSum(p, room) + raceItemBonusSum(p) + conditionalItemBonusSum(p, monsters, combatHasUndead(room))
          - (ignoreWeapons ? waffenBonusSum(p) : 0);
```

Dazu in `server.js` neben `equippedBonusSum` (Zeile 395):

```js
// MONDJUNGFERN: Summe der Boni, die an Hand-Gegenstaenden haengen - genau der
// Teil, der gegen sie nicht zaehlt. Gleiche Brille wie waffenAnzahl.
function waffenBonusSum(player) {
  const ids = new Set((player.equipped.hands || []).filter(Boolean));
  (player.equipped.special || []).forEach((id) => { if ((card(id) || {}).slotKind === 'hand') ids.add(id); });
  return [...ids].reduce((sum, id) => { const c = card(id); return sum + ((c && c.bonus) || 0); }, 0);
}
```

- [ ] **Step 5: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 6: Commit**

```bash
git add server.js src/cards/passives.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: gegen die Mondjungfern zaehlen Waffen nicht"
```

---

### Task 12: EISRIESE — Feuergegenstände doppelt

**Files:**
- Modify: `server.js` (`conditionalItemBonusSum`, Zeile 433-440)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `FIRE_ITEMS` (Set, heute `FLAMMENDE RÜSTUNG` und `NAPALMSTAB`)
- Produces: nichts Neues

- [ ] **Step 1: Test ergänzen**

```js
// --- EISRIESE: "Jeder Feuer- oder Flammengegenstand verursacht doppelten
// Schaden." ------------------------------------------------------------------
{
  const feuer = findCard('FLAMMENDE RÜSTUNG');
  const staerke = (monsterName) => {
    const m = findCard(monsterName, 'monster');
    const p = makePlayer({ equipped: Object.assign(newEquipped(), { armor: feuer.id }) });
    const room = makeRoom([p]);
    room.combat = { actorId: p.id, helperId: null, monsterIds: [m.id], actorModifier: 0, monsterModifier: 0, backstabs: {} };
    return combatTotals(room).playerStrength;
  };
  assert.strictEqual(staerke('EISRIESE') - staerke('PESTRATTEN'), feuer.bonus,
    'gegen den Eisriesen zaehlt die Flammende Ruestung doppelt');
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — Differenz 0

- [ ] **Step 3: Regel ergänzen**

In `server.js`, `conditionalItemBonusSum`:

```js
function conditionalItemBonusSum(player, monsters, untot) {
  if (!player || !monsters || !monsters.length) return 0;
  // EISRIESE: "Jeder Feuer- oder Flammengegenstand verursacht doppelten
  // Schaden." Verdoppeln heisst: den gedruckten Bonus ein zweites Mal
  // dazuzaehlen. Generisch ueber FIRE_ITEMS, damit neue Feuergegenstaende
  // automatisch mitzaehlen.
  const eisriese = monsters.some((m) => m && m.name === 'EISRIESE');
  return equippedItemIds(player).reduce((sum, id) => {
    const c = card(id);
    const fn = c && ITEM_CONDITIONAL_BONUS[c.name];
    const feuer = (eisriese && c && FIRE_ITEMS.has(c.name)) ? (c.bonus || 0) : 0;
    return sum + (fn ? fn(player, monsters, !!untot) : 0) + feuer;
  }, 0);
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 5: Commit**

```bash
git add server.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: Feuergegenstaende wirken doppelt gegen den Eisriesen"
```

---

### Task 13: FUNGUS als Gigantischer Fungus

**Files:**
- Modify: `server.js` (`handlePlayCombatCard`, Verstärker-Zweig, Zeile ~3762-3790)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: der Verstärker-Zweig, der heute schon den RAPIER-TROTTEL verdoppelt
- Produces: nichts Neues

- [ ] **Step 1: Vorbild lesen**

Run: `grep -n "RAPIER-TROTTEL" -A 8 server.js`
Dort steht das Muster: aus den Monstern im Kampf einen Sonderfall ableiten und den `zuschlag` ändern, bevor er in `monsterModifier` und `enhancerBonus` fließt.

- [ ] **Step 2: Test ergänzen**

Import erweitern um `handlePlayCombatCard`.

```js
// --- FUNGUS: "Wenn der Fungus Gigantisch wird, erhaelt er +25 statt +10!" ---
{
  const fungus = findCard('FUNGUS', 'monster');
  const gigantisch = findCard('GIGANTISCH');
  const anderes = findCard('PESTRATTEN', 'monster');
  const zuschlag = (monsterKarte) => {
    const p = makePlayer({ hand: [gigantisch.id] });
    const room = makeRoom([p]);
    room.combat = { actorId: p.id, helperId: null, monsterIds: [monsterKarte.id],
      actorModifier: 0, monsterModifier: 0, enhancerIds: [], enhancerBonus: 0,
      treasureDelta: 0, enhancerTreasure: 0, mustFlee: false, backstabs: {} };
    const vorher = combatTotals(room).monsterStrength;
    handlePlayCombatCard(room, p.id, gigantisch.id);
    return combatTotals(room).monsterStrength - vorher;
  };
  assert.strictEqual(zuschlag(anderes), gigantisch.bonus, 'normal gibt GIGANTISCH seinen gedruckten Bonus');
  assert.strictEqual(zuschlag(fungus), 25, 'auf dem Fungus sind es 25');
}
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — `auf dem Fungus sind es 25` (gemessen 10)

- [ ] **Step 4: Sonderfall ergänzen**

Im Verstärker-Zweig von `handlePlayCombatCard`, direkt neben der Trottel-Zeile:

```js
    // FUNGUS: "Wenn der Fungus Gigantisch wird, erhaelt er einen Bonus von
    // +25, statt +10!" Gleiche Bauform wie der RAPIER-TROTTEL, nur ein fester
    // Wert statt einer Verdopplung.
    const fungusGigantisch = c.name === 'GIGANTISCH'
      && room.combat.monsterIds.some((mid) => (card(mid) || {}).name === 'FUNGUS');
```

und die Zuschlagszeile erweitern:

```js
    const zuschlag = fungusGigantisch ? 25 : (trottel ? c.bonus * 2 : c.bonus);
```

Den Logtext gleich mitziehen, damit die Zahl im Verlauf stimmt — dort steht heute `${trottel ? c.bonus * 2 : c.bonus}`; daraus wird `${zuschlag}`.

- [ ] **Step 5: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 6: Commit**

```bash
git add server.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: Gigantischer Fungus gibt 25 statt 10"
```

---

### Task 14: ROTZ-ELEMENTAR mit der Laufenden Nase, SCHATTENNASE ohne Flucht

**Files:**
- Modify: `src/cards/passives.js` (`MONSTER_TRAIT_BONUS`-Eintrag erweitern, `FLEE_IMPOSSIBLE`)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `wennErfuellt(player, room)` aus Task 5 — die Kombi-Regel braucht die Monsterliste des Kampfes
- Produces: nichts Neues

- [ ] **Step 1: Test ergänzen**

```js
// --- ROTZ-ELEMENTAR mit Laufender Nase / Schattennase -----------------------
// "In Kombination mit der Laufenden Nase (oder dem Schatten), erhaelt jeder
// einen Bonus von +10."
{
  const nase = findCard('LAUFENDE NASE', 'monster');
  const allein = monsterStaerke('ROTZ-ELEMENTAR', makePlayer({}));
  const mitNase = monsterStaerke('ROTZ-ELEMENTAR', makePlayer({}), [nase.id]);
  assert.strictEqual(mitNase - allein - nase.level, 10,
    'ueber die Stufe der Nase hinaus kommen +10 dazu');
}

// --- DIE SCHATTENNASE: "Du kannst nicht fluechten" --------------------------
{
  const { FLEE_IMPOSSIBLE } = require('../server.js');
  assert.ok(FLEE_IMPOSSIBLE.has('DIE SCHATTENNASE'), 'vor dem Schatten gibt es kein Entkommen');
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — der Kombi-Bonus fehlt

- [ ] **Step 3: Einträge ergänzen**

Den ROTZ-ELEMENTAR-Eintrag aus Task 1 zu einem Regel-Array erweitern:

```js
    // "+4 gegen Elfen (uuuaaaah). In Kombination mit der Laufenden Nase (oder
    // dem Schatten), erhaelt jeder einen Bonus von +10." Die zweite Klausel
    // haengt am Kampf, nicht an der Person - siehe wennErfuellt mit Raum.
    'ROTZ-ELEMENTAR': [
      { races: ['ELF'], bonus: 4 },
      { wennErfuellt: (p, room) => !!room.combat && room.combat.monsterIds.some((id) => {
        const m = card(id);
        return !!m && (m.name === 'LAUFENDE NASE' || m.name === 'DIE SCHATTENNASE');
      }), bonus: 10 },
    ],
```

In `FLEE_IMPOSSIBLE`:

```js
    'DIE SCHATTENNASE',  // "Du kannst nicht fluechten und wirst automatisch gefangen."
```

- [ ] **Step 4: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 5: Commit**

```bash
git add src/cards/passives.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: Rotz-Elementar mit der Nase, Schattennase ohne Flucht"
```

---

### Task 15: PIÑATA — Sieg für alle, Niederlage kostet einen Gegenstand

**Files:**
- Modify: `server.js` (`resolveCombatWin`, Beuteverteilung; `applyPrimitiveAction`, neues Primitiv)
- Modify: `src/cards/consequences.js`
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `resolveCombatWin` verteilt heute nur an `actor` und `helper`; `playerQueueFrom(room, player, 'after')` liefert die Zugreihenfolge ab der nächsten Person; `openQueuedCardAction` für die Fremdauswahl
- Produces: Primitiv `{ type: 'queuedDiscardItemOfVictim' }`

- [ ] **Step 1: Test für die Schlimmen Dinge ergänzen**

```js
// --- PIÑATA, Niederlage -----------------------------------------------------
// "Der Spieler, der nach dem Opfer an der Reihe ist, waehlt einen der
// Gegenstaende des Opfers, die im Spiel sind. Leg es ab."
{
  const pinata = findCard('PIÑATA', 'monster');
  const ruestung = ALL_CARDS.find((c) => c.category === 'item' && c.slotKind === 'armor' && c.bonus > 0);
  const opfer = makePlayer({ equipped: Object.assign(newEquipped(), { armor: ruestung.id }) });
  const b = makePlayer({ id: 'p2', name: 'B' });
  const c3 = makePlayer({ id: 'p3', name: 'C' });
  const room = makeRoom([opfer, b, c3]);
  applyPrimitiveAction(room, opfer, resolveConsequenceSpec(pinata.name, pinata.badstuff, opfer, room));
  assert.ok(room.pendingCardAction, 'jemand muss waehlen');
  assert.strictEqual(room.pendingCardAction.playerId, 'p2', 'und zwar die naechste Person');
  handleResolveCardCardChoice(room, 'p2', room.pendingCardAction.candidateIds[0]);
  assert.strictEqual(opfer.equipped.armor, null, 'der Gegenstand ist weg');
  assert.ok(room.treasureDiscard.includes(ruestung.id), 'und liegt im Ablagestapel, nicht bei p2');
  assert.strictEqual(b.hand.length, 0, 'p2 bekommt ihn nicht');
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — `jemand muss waehlen`

- [ ] **Step 3: Primitiv ergänzen**

In `server.js`, in `applyPrimitiveAction` direkt hinter `case 'queuedTakeItem':`:

```js
    // PIÑATA: "Der Spieler, der nach dem Opfer an der Reihe ist, waehlt einen
    // der Gegenstaende des Opfers, die im Spiel sind. Leg es ab."
    // Spiegelbild zu queuedTakeItem: dieselbe Fremdauswahl, aber die Karte
    // geht auf den Ablagestapel statt in die Hand der waehlenden Person.
    case 'queuedDiscardItemOfVictim': {
      const opfer = player;
      const naechste = playerQueueFrom(room, opfer, 'after')[0];
      if (!naechste) return 'niemand sonst am Tisch';
      if (!equippedItemIds(opfer).length) return 'kein Gegenstand im Spiel';
      openQueuedCardAction(room, action.cardName || 'Schlimme Dinge', [naechste], () => {
        const ids = equippedItemIds(opfer);
        if (!ids.length) return null;
        return { kind: 'chooseCard', prompt: `Einen Gegenstand von ${opfer.name} ablegen`,
          candidateIds: ids, discardVictim: opfer.id };
      });
      return `${findPlayer(room, naechste).name} waehlt einen Gegenstand zum Ablegen`;
    }
```

In `handleResolveCardCardChoice` einen Zweig neben `pa.takeFrom` und `pa.giveTo` ergänzen:

```js
  } else if (pa.discardVictim) {
    // PIÑATA: die waehlende Person nimmt nichts - der Gegenstand geht weg.
    const opfer = findPlayer(room, pa.discardVictim);
    if (!opfer || !gehoert(opfer, chosenCardId)) {
      log(room, `"${chosen ? chosen.name : chosenCardId}" gehoert ${opfer ? opfer.name : '?'} nicht mehr - nichts abgelegt.`);
      finishCardAction(room, pa);
      touchRoom(room);
      return;
    }
    if (opfer.hand.includes(chosenCardId)) removeFromHand(opfer, chosenCardId);
    else unequipSlotCard(opfer, chosenCardId);
    clearCheatIfLost(opfer, chosenCardId);
    discardCard(room, chosenCardId);
    log(room, `${player.name}: "${pa.cardName}" -> "${chosen ? chosen.name : chosenCardId}" von ${opfer.name} abgelegt.`, [chosenCardId]);
```

- [ ] **Step 4: Override ergänzen**

In `src/cards/consequences.js`:

```js
    // "Der Spieler, der nach dem Opfer an der Reihe ist, waehlt einen der
    // Gegenstaende des Opfers, die im Spiel sind. Leg es ab."
    'PIÑATA': () => ({ type: 'queuedDiscardItemOfVictim', cardName: 'PIÑATA' }),
```

- [ ] **Step 5: Test für den Sieg ergänzen**

```js
// --- PIÑATA, Sieg -----------------------------------------------------------
// "Wenn Pinata besiegt wird, zieht jedes Gruppenmitglied einen Schatz
// aufgedeckt. Es spielt keine Rolle, wer am Kampf teilgenommen hat."
{
  const { resolveCombatWin } = require('../server.js');
  const pinata = findCard('PIÑATA', 'monster');
  const schaetze = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 10).map((c) => c.id);
  const a = makePlayer({});
  const b = makePlayer({ id: 'p2', name: 'B' });
  const c4 = makePlayer({ id: 'p3', name: 'C' });
  const room = makeRoom([a, b, c4]);
  room.treasureDeck = schaetze.slice();
  room.combat = { actorId: a.id, helperId: null, monsterIds: [pinata.id], actorModifier: 0,
    monsterModifier: 0, treasureDelta: 0, helperReward: 0, backstabs: {} };
  resolveCombatWin(room);
  assert.strictEqual(b.hand.length, 1, 'auch wer nicht mitgekaempft hat, bekommt einen Schatz');
  assert.strictEqual(c4.hand.length, 1, 'und zwar alle');
  assert.strictEqual(a.hand.length, 1, 'die kaempfende Person ebenfalls genau einen');
}
```

- [ ] **Step 6: Sieg-Hook ergänzen**

In `resolveCombatWin`, direkt vor der Zeile `const treasureCount = c.treasureDelta ? ... : baseTreasures;`:

```js
  // PIÑATA: "Wenn Pinata besiegt wird, zieht jedes Gruppenmitglied einen
  // Schatz aufgedeckt. Es spielt keine Rolle, wer am Kampf teilgenommen hat."
  // Ersetzt die normale Beute - die Karte nennt selbst 0 Schaetze.
  const pinata = monsters.some((m) => m && m.name === 'PIÑATA');
  if (pinata) {
    room.players.forEach((p) => {
      const t = drawTreasure(room);
      if (!t) return;
      p.hand.push(t);
      p.lastReward = {
        seq: (p.lastReward ? p.lastReward.seq : 0) + 1,
        cardIds: [t], levelsGained: p.id === actor.id ? levelsGained : 0,
        monsterNames: monsters.map((m) => m.name),
      };
    });
    log(room, `Die Piñata platzt - jede:r am Tisch zieht 1 Schatzkarte.`);
  }
```

Der reguläre Beutezug darunter zieht bei `treasureCount === 0` ohnehin nichts, weil die Karte `treasureCount: 0` hat — also keine doppelte Ausschüttung. Das im Test mit `a.hand.length === 1` absichern.

- [ ] **Step 7: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 8: Commit**

```bash
git add server.js src/cards/consequences.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: Pinata beschenkt den Tisch und kostet bei Niederlage einen Gegenstand"
```

---

### Task 16: Doku und Abschlussverifikation

**Files:**
- Modify: `HANDOVER.md`
- Modify: `docs/superpowers/plans/2026-09-16-unnatural-axe-monster.md` (Haken setzen)

- [ ] **Step 1: Abdeckung messen**

Run: `node tools/coverage-scan.js unnaturalaxe`
Erwartet: Im Abschnitt MONSTER stehen nur noch RIESENSTINKTIER, LUSTMONSTER und WEIHNACHTSMANN — die drei zurückgestellten Welle-3-Karten.

Steht dort etwas anderes, ist eine Regel aus diesem Plan nicht angekommen: den zugehörigen Task nachsehen.

- [ ] **Step 2: Die zwei Teilabdeckungen im Code markieren**

In `src/cards/consequences.js` über den bestehenden Einträgen:

```js
    // ponytail: "Verdoppelt die Strafe, wenn der Fungus Gigantisch ist" fehlt -
    // die Konsequenz weiss nicht, welche Verstaerker im Kampf lagen. Aufruestweg:
    // den Verstaerker-Zustand in die Konsequenz durchreichen.
    'FUNGUS': (player) => ({ type: 'levelDelta', amount: hasRace(player, 'ELF') ? 2 : 1 }),
```

```js
    // ponytail: "Du erhaeltst eine Stufe zurueck fuer jeden Trank, den du SOFORT
    // ablegst" fehlt - ein Zeitfenster fuer freiwilliges Ablegen gibt es nicht.
    'GRASGNOLL': () => ({ type: 'levelDelta', amount: 3 }),
```

- [ ] **Step 3: HANDOVER ergänzen**

Einen neuen Abschnitt „Unnatural Axe: Monsterkarten" mit: was jetzt läuft, die zwei Teilabdeckungen (FUNGUS-Verdopplung, GRASGNOLL-Trankrückgabe), die zurückgestellte Welle 3 und den Verweis auf Spec und Plan.

- [ ] **Step 4: Volle Prüfung**

Run: `npm test && node tools/coverage-scan.js unnaturalaxe`
Expected: `27/27 Tests erfolgreich.` plus die erwartete Restliste.

- [ ] **Step 5: Commit**

```bash
git add HANDOVER.md src/cards/consequences.js docs/superpowers/plans/2026-09-16-unnatural-axe-monster.md
git commit -m "Unnatural Axe: Monsterrunde dokumentiert"
```

---

## Offen für Welle 3 (eigener Plan nach Rücksprache)

- **RIESENSTINKTIER** — Kampftext (niemand darf helfen, hintergehen oder Karten für/gegen dich spielen) und Schlimme Dinge (keine Hilfe, bis alle Kleidung abgelegt ist; halber Goldwert).
- **WEIHNACHTSMANN** — Schlimme Dinge: kein Schatz, bis ein Monster allein getötet wird. Der Kampfbonus (-5 gegen Elfen) ist bereits in Task 1 erledigt.
- **LUSTMONSTER** — Kampftext (Hilfe des anderen Geschlechts zwingend) und Schlimme Dinge (Stufe plus anhaltender Fluch auf Hand-Gegenstände).
- **EISKALTES HÄNDCHEN** — Wunschring statt Kampf, die Monsterkarte wird ein +3-Gegenstand. Die Schlimmen Dinge laufen schon.
