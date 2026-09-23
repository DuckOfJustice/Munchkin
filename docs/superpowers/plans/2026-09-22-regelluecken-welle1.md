# Regellücken Welle 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fünf Karten kartengetreu machen: DER GANZ NORMALE HASE (Helfer gefangen), HALB-BLUT/SUPER MUNCHKIN (keine Rassen-Nachteile), Schilde ≠ Waffen, HUHN AUF DEINEM KOPF (fällt mit der Kopfbedeckung), ZAUBERCOUCH (Wahl zu Beginn jedes Kampfs).

**Architecture:** Alles in bestehenden Mechanismen: `server.js` (Kampf, Konsequenzen, Flucht), `src/cards/passives.js` und `src/cards/consequences.js` (Kartentabellen als Factory mit `ctx`), `public/client.js` (Kampf-Panel). Keine neue Datei außer dem Test.

**Tech Stack:** Node.js (CommonJS), Express + Socket.IO, Tests mit `assert` über `node tests/<datei>.test.js` bzw. `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-22-regelluecken-welle1-design.md`

## Global Constraints

- Code, Kommentare, Commit-Messages, Logzeilen auf Deutsch; Kommentare im Stil des Umfelds (ASCII-Umschreibung ae/oe/ue in Kommentaren ist üblich, Logtexte mit Umlauten).
- Kartennamen exakt wie in `data/cards.json` (Großbuchstaben, Umlaute).
- Jede Verhaltensänderung: erst Test, Test schlägt fehl, dann Code (TDD).
- `npm test` muss am Ende jeder Task grün sein. `tests/basic-game-flow.test.js` ist zufallsabhängig und scheitert selten mit „kein einziger Kampf“ – einzeln wiederholen, bevor ein Fehler vermutet wird.
- Dateien haben teils CRLF-Zeilenenden: mehrzeilige Ersetzungen per Skript schlagen dann fehl – Edit-Werkzeug benutzen.
- Commits enden mit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WxCuD1KsFNquy8741xvETq
  ```
- Branch: `fix/welle1-regelluecken` (existiert, basiert auf `origin/main`).

---

### Task 1: DER GANZ NORMALE HASE – Helfer kann nicht entkommen

**Files:**
- Create: `tests/card-regelluecken-welle1.test.js`
- Modify: `server.js` – `haseAnwenden` (~Zeile 5280) und `handleAttemptFlee` (~Zeile 5575, im Callback `mitWurf`)

**Interfaces:**
- Produces: Testdatei mit Helfern `findCard`, `makePlayer`, `makeRoom`, `fertig` – spätere Tasks hängen ihre Blöcke vor der Schlusszeile an.
- Produces: Kampffeld `room.combat.helferGefangen` (boolean).

- [ ] **Step 1: Testdatei mit dem Hase-Test anlegen**

```js
// Regellücken Welle 1 (Spec 2026-09-22-regelluecken-welle1-design.md):
// Hase, Halb-Blut, Schilde, Huhn, Zaubercouch.
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
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [], itemAttachments: {},
    revealedDoorCard: null, pendingConsequence: null, pendingCardAction: null, pendingRoll: null,
    combat: null, winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
    settings: { sets: {} },
  }, extra || {});
  raeume.push(room);
  return room;
}
const fertig = () => raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });

// --- 1. DER GANZ NORMALE HASE: "Bei einer 6 ... kann der Helfer nicht mehr
// entkommen". Beide wuerfeln eine 6 zum Weglaufen: nur die kaempfende Person
// entkommt, die helfende scheitert.
{
  const hase = findCard('DER GANZ NORMALE HASE', 'monster').id;
  const a = makePlayer({ level: 3 });
  const h = makePlayer({ id: 'p2', name: 'B', level: 3 });
  const room = makeRoom([a, h]);
  S.startCombat(room, 'p1', [hase], { fromHand: false });
  room.combat.helperId = 'p2';
  const zufall = Math.random;
  Math.random = () => 0.99; // jeder Wurf eine 6
  try {
    S.hasenWurf(room, null);            // Hase wird zum Film-Hasen (Stufe 15)
    assert.strictEqual(room.combat.helferGefangen, true, 'bei einer 6 ist der Helfer gefangen');
    room.combat.mustFlee = true;
    S.handleAttemptFlee(room, 'p1', 0);
    S.handleAttemptFlee(room, 'p2', 0);
  } finally { Math.random = zufall; }
  assert.ok(room.pendingConsequence, 'es gibt Schlimme Dinge');
  assert.strictEqual(room.pendingConsequence.playerId, 'p2', 'die helfende Person ist gescheitert');
  assert.ok(room.logs.some((l) => /kann nicht mehr entkommen/.test(l.text)), 'der Verlauf nennt den Grund');
}
// Gegenprobe: ohne 6 entkommt die helfende Person normal.
{
  const hase = findCard('DER GANZ NORMALE HASE', 'monster').id;
  const room = makeRoom([makePlayer({ level: 3 }), makePlayer({ id: 'p2', name: 'B', level: 3 })]);
  S.startCombat(room, 'p1', [hase], { fromHand: false });
  room.combat.helperId = 'p2';
  const zufall = Math.random;
  try {
    Math.random = () => 0; // Hase: Wurf 1
    S.hasenWurf(room, null);
    assert.ok(!room.combat.helferGefangen);
    room.combat.mustFlee = true;
    Math.random = () => 0.99; // Flucht: 6
    S.handleAttemptFlee(room, 'p1', 0);
    S.handleAttemptFlee(room, 'p2', 0);
  } finally { Math.random = zufall; }
  assert.strictEqual(room.pendingConsequence, null, 'beide entkommen');
}

fertig();
console.log('card-regelluecken-welle1: alle Checks gruen');
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle1.test.js`
Expected: FAIL mit `bei einer 6 ist der Helfer gefangen` (Feld existiert nicht). Falls `S.hasenWurf` nicht exportiert wäre: es steht in `module.exports` (Zeile ~7095), also kein Exportfehler erwartet.

- [ ] **Step 3: Implementieren**

In `haseAnwenden` nach `c.levelOverrides[hase] = 15;`:

```js
  // "... und der Helfer kann nicht mehr entkommen" - gilt fuer die helfende
  // Person dieses Kampfs, auch wenn sie erst nach dem Wurf dazukommt
  // (siehe handleAttemptFlee).
  c.helferGefangen = true;
```

In `handleAttemptFlee`, Callback `mitWurf`, die Zeile `const impossible = combatHasMonster(room, FLEE_IMPOSSIBLE);` ersetzen durch:

```js
    const helferGefangen = !!c.helferGefangen && actor.id === c.helperId;
    const impossible = helferGefangen || combatHasMonster(room, FLEE_IMPOSSIBLE);
```

und die Zeile `if (impossible) note = 'Vor diesem Monster gibt es kein Entkommen.';` ersetzen durch:

```js
    if (helferGefangen) note = 'Der Hase aus dem Film: der Helfer kann nicht mehr entkommen.';
    else if (impossible) note = 'Vor diesem Monster gibt es kein Entkommen.';
```

- [ ] **Step 4: Test laufen lassen – muss grün sein**

Run: `node tests/card-regelluecken-welle1.test.js`
Expected: `card-regelluecken-welle1: alle Checks gruen`

- [ ] **Step 5: Volle Suite, dann Commit**

Run: `npm test` → Expected: alle Tests erfolgreich.

```bash
git add tests/card-regelluecken-welle1.test.js server.js
git commit -m "fix: DER GANZ NORMALE HASE - Helfer kann nach einer 6 nicht mehr entkommen"
```

---

### Task 2: HALB-BLUT / SUPER MUNCHKIN – keine Rassen-Nachteile

**Files:**
- Modify: `server.js` – neue Funktion `hatRasseMitNachteil` direkt nach `traitImmun` (~Zeile 3501); `consequencesFactory({...})`-Aufruf (~Zeile 2320) und `passivesFactory({...})`-Aufruf (~Zeile 3108) um `hatRasseMitNachteil` erweitern; `monsterPassOption` (~Zeile 3466); SPASSBREMSE in `handleEquipItem` (~Zeile 5932)
- Modify: `src/cards/consequences.js` – ctx-Destrukturierung, ZUNGENDÄMON (Z. 85), FUNGUS (Z. 89), MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT (Z. 276)
- Modify: `src/cards/passives.js` – ctx-Destrukturierung (Z. 5-7), KRAKZILLA (Z. 24)
- Test: `tests/card-regelluecken-welle1.test.js`

**Interfaces:**
- Produces: `hatRasseMitNachteil(player, rasse) -> boolean` = `hasRace(player, rasse) && !traitImmun(player, 'races')`.

`traitImmun` und `hasRace` sind `function`-Deklarationen, also beim Factory-Aufruf schon verfügbar (Hoisting).

- [ ] **Step 1: Tests anhängen (vor `fertig();`)**

```js
// --- 2. HALB-BLUT: "eine Rassenkarte ... alle Vorteile aber keine Nachteile"
{
  const elf = findCard('ELF', 'race').id;
  const halbling = findCard('HALBLING', 'race').id;
  const gnom = ALL_CARDS.find((c) => c.name === 'GNOM').id;
  const halbBlut = findCard('HALB-BLUT').id;
  const zunge = findCard('ZUNGENDÄMON', 'monster');
  const spec = (p, name) => S.resolveConsequenceSpec(name, findCard(name, 'monster').badstuff, p, makeRoom([p]));

  const halbElf = makePlayer({ races: [elf], raceCapCard: halbBlut });
  assert.strictEqual(spec(halbElf, 'ZUNGENDÄMON').amount, 2, 'Halb-Elf: ZUNGENDÄMON wie Nicht-Elfen');
  assert.strictEqual(spec(halbElf, 'FUNGUS').amount, 1, 'Halb-Elf: FUNGUS wie Nicht-Elfen');
  assert.strictEqual(spec(makePlayer({ races: [elf] }), 'ZUNGENDÄMON').amount, 3, 'Gegenprobe: echter Elf 3');
  // Halb-Blut mit ZWEI Rassen hat laut Karte alle Nachteile.
  const zweiRassen = makePlayer({ races: [elf, halbling], raceCapCard: halbBlut });
  assert.strictEqual(spec(zweiRassen, 'ZUNGENDÄMON').amount, 3, 'zwei Rassen: Nachteil bleibt');

  // MONSTER, DAS DER SL ...: Elf +2 Stufen - fuer Halb-Elfen (Frau, damit nur die Rasse zaehlt) nicht.
  const slName = 'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT';
  const sl = S.resolveConsequenceSpec(slName, findCard(slName, 'monster').badstuff, makePlayer({ races: [elf], raceCapCard: halbBlut, gender: 'w' }), makeRoom([]));
  const slStufen = [].concat(sl.type === 'combo' ? sl.actions : [sl]).filter((x) => x.type === 'levelDelta').reduce((s, x) => s + x.amount, 0);
  assert.strictEqual(slStufen, 0, 'Halb-Elfin: keine Elfen-Stufen beim SL-Monster');

  // BEKIFFTER GOLEM: Halb-Halbling darf vorbeigehen.
  const golem = findCard('BEKIFFTER GOLEM', 'monster').id;
  assert.ok(S.monsterPassOption(golem, makePlayer({ races: [halbling], raceCapCard: halbBlut })), 'Halb-Halbling darf vorbeigehen');
  assert.ok(!S.monsterPassOption(golem, makePlayer({ races: [halbling] })), 'Gegenprobe: Halbling muss kaempfen');

  // KRAKZILLA: "Greift niemanden mit Stufe 4 oder niedriger an, AUSSER Elfen."
  const krak = findCard('KRAKZILLA', 'monster').id;
  assert.ok(S.monsterRefusesTarget(krak, makePlayer({ level: 4, races: [elf], raceCapCard: halbBlut })), 'Halb-Elf auf Stufe 4 wird verschont');
  assert.ok(!S.monsterRefusesTarget(krak, makePlayer({ level: 4, races: [elf] })), 'Gegenprobe: Elf wird angegriffen');

  // SPASSBREMSE: toedlich fuer Gnome - nicht fuer Halb-Gnome.
  const bremse = findCard('SPASSBREMSE');
  const halbGnom = makePlayer({ races: [gnom], raceCapCard: halbBlut, hand: [bremse.id] });
  const room = makeRoom([halbGnom]);
  S.handleEquipItem(room, 'p1', bremse.id);
  assert.ok(S.equippedItemIds(halbGnom).includes(bremse.id), 'Halb-Gnom legt die Spassbremse an und lebt');
}
```

Hinweis zum Aufbau: `monsterRefusesTarget` und `monsterPassOption` sind exportiert (`module.exports`). Falls der Test an einem fehlenden Export scheitert (`is not a function`), den Namen in `module.exports` am Dateiende von `server.js` ergänzen – das ist Teil dieses Steps, nicht die erwartete Fehlerursache.

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle1.test.js`
Expected: FAIL mit `Halb-Elf: ZUNGENDÄMON wie Nicht-Elfen` (3 statt 2).

- [ ] **Step 3: Implementieren**

`server.js`, direkt nach der Funktion `traitImmun`:

```js
// HALB-BLUT, zweite Kartenhaelfte: "eine Rassenkarte ... alle Vorteile aber
// keine Nachteile". Fuer jede Stelle, an der eine Rasse ein NACHTEIL ist
// (Schlimme Dinge, Kampfzwang, toedliche Gegenstaende) statt hasRace.
// Vorteile (Elf +1 auf Weglaufen, ...) fragen weiter hasRace.
function hatRasseMitNachteil(player, rasse) {
  return hasRace(player, rasse) && !traitImmun(player, 'races');
}
```

`server.js`, im `consequencesFactory({ ... })`-Aufruf nach `card, hasRace,` einfügen: `hatRasseMitNachteil,`. Im `passivesFactory({ ... })`-Aufruf ebenso `hatRasseMitNachteil` in das Objekt aufnehmen:

```js
} = passivesFactory({ card, hasRace, hasClass, equippedItemIds, istGeschlecht, monsterSeesRace, handItemIds, hatRasseMitNachteil });
```

`server.js`, `monsterPassOption`:

```js
  if ((rule.forcedFightRaces || []).some((r) => hatRasseMitNachteil(player, r))) return null;
```

`server.js`, SPASSBREMSE in `handleEquipItem`:

```js
  if (toedlichFuer && hatRasseMitNachteil(player, toedlichFuer)) {
```

`src/cards/consequences.js`: `hatRasseMitNachteil` in die ctx-Destrukturierung aufnehmen (Zeile 9, nach `hasRace,`), dann:

```js
    'ZUNGENDÄMON': (player) => ({ type: 'levelDelta', amount: hatRasseMitNachteil(player, 'ELF') ? 3 : 2 }),
```

FUNGUS: `hasRace(player, 'ELF')` → `hatRasseMitNachteil(player, 'ELF')`. MONSTER, DAS DER SL …:

```js
      const stufen = (hatRasseMitNachteil(player, 'ELF') ? 2 : 0) + (hatRasseMitNachteil(player, 'HALBLING') ? 1 : 0)
        + (istGeschlecht(player, 'm') ? 1 : 0);
```

`src/cards/passives.js`: ctx-Destrukturierung um `hatRasseMitNachteil` erweitern, dann:

```js
    'KRAKZILLA': (p) => p.level <= 4 && !hatRasseMitNachteil(p, 'ELF'),
```

- [ ] **Step 4: Klassen-Nachteile prüfen**

Run: `grep -n "hasClass(" src/cards/consequences.js src/cards/passives.js server.js | grep -v "MONSTER_TRAIT_BONUS"`
Jeden Treffer lesen: ist die Klasse dort ein Nachteil (Strafe, Kampfzwang)? Erwartet: keiner (ANWALT und LAUFENDE NASE sind Vorteile). Findet sich doch einer, analog `hatKlasseMitNachteil(player, klasse) = hasClass(player, klasse) && !traitImmun(player, 'classes')` einführen, dort einsetzen und einen Test ergänzen.

- [ ] **Step 5: Tests grün, volle Suite, Commit**

Run: `node tests/card-regelluecken-welle1.test.js` → grün. `npm test` → alle erfolgreich.

```bash
git add server.js src/cards/consequences.js src/cards/passives.js tests/card-regelluecken-welle1.test.js
git commit -m "fix: HALB-BLUT - keine Rassen-Nachteile (Zungendaemon, Fungus, SL-Monster, Golem, Krakzilla, Spassbremse)"
```

---

### Task 3: Schilde sind keine Waffen

**Files:**
- Modify: `src/cards/passives.js` – `SHIELD_ITEMS`, `waffenIds`, `waffenAnzahl` (~Zeile 266-270), Export
- Modify: `server.js` – Kommentar über `handItemIds` (~Zeile 433), Destrukturierung des `passivesFactory`-Ergebnisses (~Zeile 3095-3107) um `waffenIds`, `combatTotals` (~Zeile 4218)
- Test: `tests/card-regelluecken-welle1.test.js`

**Interfaces:**
- Produces: `waffenIds(player) -> Set<cardId>` aus `passives.js` (Hand-Gegenstände ohne `SHIELD_ITEMS`).

- [ ] **Step 1: Tests anhängen (vor `fertig();`)**

```js
// --- 3. Schilde sind keine Waffen (MONDJUNGFERN, KALI)
{
  const schild = findCard('GANZKÖRPER-SCHILD'); // +4, eine Hand
  const mond = findCard('MONDJUNGFERN', 'monster').id;
  const p = makePlayer({ level: 5, hand: [schild.id] });
  const room = makeRoom([p]);
  S.handleEquipItem(room, 'p1', schild.id);
  S.startCombat(room, 'p1', [mond], { fromHand: false });
  assert.strictEqual(S.combatTotals(room).playerStrength, 9, 'Schild zaehlt gegen die Mondjungfern (5 + 4)');

  // Gegenprobe: eine echte Waffe faellt weiter weg.
  const waffe = ALL_CARDS.find((c) => c.category === 'item' && c.slotKind === 'hand' && c.bonus > 0 && !/SCHILD|BUCKLER/.test(c.name));
  const q = makePlayer({ level: 5, hand: [waffe.id] });
  const room2 = makeRoom([q]);
  S.handleEquipItem(room2, 'p1', waffe.id);
  S.startCombat(room2, 'p1', [mond], { fromHand: false });
  assert.strictEqual(S.combatTotals(room2).playerStrength, 5, `${waffe.name} zaehlt gegen die Mondjungfern nicht`);

  // KALI: "... es sei denn, du verteidigst dich mit 2 eigenen Waffen" -
  // Schwert + Schild sind nur EINE Waffe.
  assert.deepStrictEqual([...S.waffenIds(Object.assign(makePlayer(), {
    equipped: Object.assign(S.newEquipped(), { hands: [waffe.id, schild.id] }),
  }))], [waffe.id], 'waffenIds ohne Schild');
}
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle1.test.js`
Expected: FAIL mit `Schild zaehlt gegen die Mondjungfern (5 + 4)` (5 statt 9).

- [ ] **Step 3: Implementieren**

`src/cards/passives.js`, die Zeile `const waffenAnzahl = (p) => handItemIds(p).size;` ersetzen und den ponytail-Kommentar darüber anpassen:

```js
  // Schilde belegen eine Hand, sind aber keine Waffe (MONDJUNGFERN "keine
  // Vorteile durch Waffen", KALI "2 eigene Waffen"). Die einzigen Schilde in
  // data/cards.json - neue hier ergaenzen.
  const SHIELD_ITEMS = new Set(['FLOTTER BUCKLER', 'GANZKÖRPER-SCHILD']);
  const waffenIds = (p) => new Set([...handItemIds(p)].filter((id) => !SHIELD_ITEMS.has((card(id) || {}).name)));
  const waffenAnzahl = (p) => waffenIds(p).size;
```

(Den bisherigen Satz „ponytail: "Waffe" gegen "Schild" kennen die Kartendaten nicht - ein Schild in der Hand zaehlt hier mit. Kuratierte Ausnahmeliste waere der Aufruestweg.“ streichen.)

Im `return { ... }` von `passives.js` `waffenIds` ergänzen (neben den übrigen Exporten, z. B. nach `MONSTER_REQUIRES_OTHER_GENDER,`).

Den ponytail-Kommentar bei `MONSTER_IGNORES_WEAPONS` (~Zeile 428, „"Waffe" heisst hier wie in waffenAnzahl "belegt eine Hand"“) auf „"Waffe" heisst hier wie in waffenAnzahl: belegt eine Hand und ist kein Schild“ ändern.

`server.js`: in der Destrukturierung des `passivesFactory`-Ergebnisses `waffenIds,` ergänzen. In `combatTotals` die Zeile

```js
      if (ignoreWeapons || curseHidesHandItems(p)) handItemIds(p).forEach((id) => excludeIds.add(id));
```

ersetzen durch

```js
      // MONDJUNGFERN nimmt nur Waffen (ohne Schilde), der LUSTMONSTER-Fluch
      // alle Hand-Gegenstaende.
      if (ignoreWeapons) waffenIds(p).forEach((id) => excludeIds.add(id));
      if (curseHidesHandItems(p)) handItemIds(p).forEach((id) => excludeIds.add(id));
```

Kommentar über `handItemIds` (~Zeile 433): „benutzt von KALI (waffenAnzahl …“ auf „Grundlage fuer waffenIds (src/cards/passives.js, ohne Schilde) und den LUSTMONSTER-Fluch“ anpassen. `waffenIds` in `module.exports` von `server.js` aufnehmen.

- [ ] **Step 4: Tests grün, volle Suite, Commit**

Run: `node tests/card-regelluecken-welle1.test.js` → grün. `npm test` → alle erfolgreich.

```bash
git add server.js src/cards/passives.js tests/card-regelluecken-welle1.test.js
git commit -m "fix: Schilde sind keine Waffen (MONDJUNGFERN, KALI)"
```

---

### Task 4: HUHN AUF DEINEM KOPF fällt mit der Kopfbedeckung

**Files:**
- Modify: `server.js` – neue Funktion `huhnMitKopfbedeckung` vor `autoApplyLossConsequence` (~Zeile 2378); Aufrufe in `autoApplyLossConsequence` und `handleResolveConsequenceChoice`
- Test: `tests/card-regelluecken-welle1.test.js`

**Interfaces:**
- Consumes: `getrageneSlotKarte(player, 'head')` (server.js).
- Produces: `huhnMitKopfbedeckung(room, player, hatteKopf)` – intern.

- [ ] **Step 1: Tests anhängen (vor `fertig();`)**

```js
// --- 4. HUHN AUF DEINEM KOPF: "Jeder Fluch oder alle Schlimmen Dinge, die
// deine Kopfbedeckung entfernen, nehmen das Huhn mit."
{
  const helm = ALL_CARDS.find((c) => c.category === 'item' && c.slotKind === 'head').id;
  const huhn = findCard('HUHN AUF DEINEM KOPF').id;
  const bigfoot = findCard('BIGFOOT', 'monster'); // Schlimme Dinge: Kopfbedeckung verlieren
  const p = makePlayer();
  p.equipped.head = helm;
  const room = makeRoom([p]);
  S.addActiveCurse(room, p, 'HUHN AUF DEINEM KOPF', huhn);
  room.pendingConsequence = { playerId: 'p1', kind: 'loss', cardId: null, text: '', autoApplied: null, choice: null };
  S.autoApplyLossConsequence(room, p, [{ name: bigfoot.name, text: bigfoot.badstuff }]);
  assert.strictEqual(p.equipped.head, null, 'Testvoraussetzung: Kopfbedeckung ist weg');
  assert.ok(!p.activeCurses.some((f) => f.name === 'HUHN AUF DEINEM KOPF'), 'das Huhn ist mit weg');

  // Gegenprobe: freiwilliges Ablegen nimmt das Huhn nicht mit.
  const q = makePlayer();
  q.equipped.head = helm;
  const room2 = makeRoom([q]);
  S.addActiveCurse(room2, q, 'HUHN AUF DEINEM KOPF', huhn);
  S.handleUnequipItem(room2, 'p1', helm);
  assert.ok(q.activeCurses.some((f) => f.name === 'HUHN AUF DEINEM KOPF'), 'selbst abgelegt: Huhn bleibt');
}
```

(`autoApplyLossConsequence` und `handleUnequipItem` sind exportiert; sonst in `module.exports` ergänzen.)

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle1.test.js`
Expected: FAIL mit `das Huhn ist mit weg`.

- [ ] **Step 3: Implementieren**

`server.js`, direkt vor `function autoApplyLossConsequence`:

```js
// HUHN AUF DEINEM KOPF: "Jeder Fluch oder alle Schlimmen Dinge, die deine
// Kopfbedeckung entfernen, nehmen das Huhn mit." Geprueft an den zwei
// Stellen, ueber die JEDER Fluch und jedes Miese Zeug laeuft - so zaehlt
// jede Karte, die den Kopf-Slot leert, auch kuenftige. Freiwilliges Ablegen
// laeuft hier nicht durch und nimmt das Huhn deshalb nicht mit.
function huhnMitKopfbedeckung(room, player, hatteKopf) {
  if (!hatteKopf || getrageneSlotKarte(player, 'head')) return;
  const vorher = (player.activeCurses || []).length;
  player.activeCurses = (player.activeCurses || []).filter((f) => f.name !== 'HUHN AUF DEINEM KOPF');
  if (player.activeCurses.length < vorher) log(room, `Mit der Kopfbedeckung ist auch das Huhn von ${player.name} weg.`);
}
```

In `autoApplyLossConsequence` als erste Zeile nach `if (!pc) return;`:

```js
  const hatteKopf = !!getrageneSlotKarte(player, 'head');
```

und am Funktionsende (nach dem `if (parts.length) { ... }`-Block) sowie **vor** dem frühen `return;` im Einzel-Wahl-Zweig (`if (spec && spec.type === 'choice') { ... return; }` – dort wird noch nichts angewendet, also dort nichts einfügen) die Zeile

```js
  huhnMitKopfbedeckung(room, player, hatteKopf);
```

In `handleResolveConsequenceChoice` vor `const desc = applyPrimitiveAction(room, player, stored[optionId]);`:

```js
  const hatteKopf = !!getrageneSlotKarte(player, 'head');
```

und direkt nach dieser `applyPrimitiveAction`-Zeile:

```js
  huhnMitKopfbedeckung(room, player, hatteKopf);
```

Den ponytail-Kommentar bei HUHN AUF DEINEM KOPF in `src/cards/reactions.js` (~Zeile 51, „der zweite Satz ... ist nicht verdrahtet ...“) ersetzen durch: „Der zweite Satz (Huhn faellt mit der Kopfbedeckung) steht in huhnMitKopfbedeckung (server.js).“

- [ ] **Step 4: Tests grün, volle Suite, Commit**

Run: `node tests/card-regelluecken-welle1.test.js` → grün. `npm test` → alle erfolgreich.

```bash
git add server.js src/cards/reactions.js tests/card-regelluecken-welle1.test.js
git commit -m "fix: HUHN AUF DEINEM KOPF faellt mit der Kopfbedeckung (Fluch/Schlimme Dinge)"
```

---

### Task 5: ZAUBERCOUCH – Wahl zu Beginn jedes Kampfs

**Files:**
- Modify: `src/cards/passives.js` – `ITEM_GRANTS_TRAIT['ZAUBERCOUCH']` (~Zeile 214)
- Modify: `server.js` – `itemGrantsTrait` (~Zeile 1363), `fleeModifierParts` (~Zeile 3524), `startCombat` (~Zeile 4060), `handleRespondHelp` (Stelle `c.helperId = playerId`), `handleEvaluateCombat`, `handleSetCombatReady`, neue Funktionen `zaubercouchFragen`, `zaubercouchZuruecksetzen`, `handleAnswerZaubercouch`, die 5 Stellen `room.combat = null` (Zeilen ~802, ~4368, ~5477, ~5656, ~6881), `publicPlayer` (~Zeile 551-580), Socket-Handler (~Zeile 6912), `module.exports`
- Modify: `public/client.js` – `renderCombat` (~Zeile 1033)
- Test: `tests/card-regelluecken-welle1.test.js`

**Interfaces:**
- Produces: `player.zaubercouch` ∈ `undefined | 'offen' | 'ja' | 'nein'` (öffentlich über `publicPlayer`).
- Produces: `handleAnswerZaubercouch(room, playerId, benutzen: boolean)`; Socket-Event `answerZaubercouch` mit Payload `{ benutzen }`.

- [ ] **Step 1: Tests anhängen (vor `fertig();`)**

```js
// --- 5. ZAUBERCOUCH: "Du kannst zu Beginn eines jeden Kampfes entscheiden, ob
// du die Zaubercouch verwenden willst. Wenn du es tust, erhaeltst du -1 auf
// Weglaufen." Verwenden = Zauberer.
{
  const couch = findCard('ZAUBERCOUCH').id;
  const goblin = findCard('LAHMER GOBLIN', 'monster').id;
  const mitCouch = (o) => { const p = makePlayer(o); p.equipped.special = [couch]; return p; };
  const couchMalus = (room, p) => S.fleeModifierParts(room, p).some((x) => x.label === 'ZAUBERCOUCH');

  // Ausserhalb eines Kampfs: kein Zauberer.
  const p = mitCouch();
  const room = makeRoom([p, makePlayer({ id: 'p2', name: 'B' })]);
  assert.ok(!S.hasClass(p, 'ZAUBERER'), 'ohne Kampf kein Zauberer');

  // Kampfbeginn: Frage offen, Kampf nicht auswertbar.
  S.startCombat(room, 'p1', [goblin], { fromHand: false });
  assert.strictEqual(p.zaubercouch, 'offen', 'Frage zu Kampfbeginn');
  assert.ok(!S.hasClass(p, 'ZAUBERER'), 'unbeantwortet: nicht benutzt');
  assert.ok(!couchMalus(room, p), 'unbeantwortet: kein Malus');
  S.handleEvaluateCombat(room, 'p1');
  // Stufe 5 gegen den LAHMEN GOBLIN: eine Auswertung wuerde den Kampf beenden.
  assert.ok(room.combat, 'mit offener Couch-Frage keine Auswertung');
  assert.ok(room.logs.some((l) => /Zaubercouch/.test(l.text)), 'der Verlauf nennt den Grund');

  // "Ja": Zauberer und -1 auf Weglaufen, Antwort danach fest.
  S.handleAnswerZaubercouch(room, 'p1', true);
  assert.strictEqual(p.zaubercouch, 'ja');
  assert.ok(S.hasClass(p, 'ZAUBERER'), 'mit Couch Zauberer');
  assert.ok(couchMalus(room, p), 'mit Couch -1 auf Weglaufen');
  S.handleAnswerZaubercouch(room, 'p1', false);
  assert.strictEqual(p.zaubercouch, 'ja', 'die Antwort gilt fuer diesen Kampf');

  // Naechster Kampf: neue Frage; "Nein" = kein Zauberer, kein Malus.
  S.startCombat(room, 'p1', [goblin], { fromHand: false });
  assert.strictEqual(p.zaubercouch, 'offen', 'neue Frage im naechsten Kampf');
  S.handleAnswerZaubercouch(room, 'p1', false);
  assert.ok(!S.hasClass(p, 'ZAUBERER') && !couchMalus(room, p), 'Nein: weder Zauberer noch Malus');

  // Helfer mit Couch: Frage beim Einstieg, bis dahin kein "Bereit".
  const k = makePlayer({ id: 'p1' });
  const h = mitCouch({ id: 'p2', name: 'B' });
  const room3 = makeRoom([k, h]);
  S.startCombat(room3, 'p1', [goblin], { fromHand: false });
  room3.combat.helperPending = { targetId: 'p2', compelled: false, reward: 0 };
  S.handleRespondHelp(room3, 'p2', true);
  assert.strictEqual(h.zaubercouch, 'offen', 'Frage beim Einstieg als Helfer');
  S.handleSetCombatReady(room3, 'p2', true);
  assert.ok(!(room3.combat.ready || {}).p2, 'mit offener Couch-Frage kein Bereit');

  // Bot: antwortet sofort "Nein".
  const bot = mitCouch({ id: 'p1', isBot: true });
  const room4 = makeRoom([bot]);
  S.startCombat(room4, 'p1', [goblin], { fromHand: false });
  assert.strictEqual(bot.zaubercouch, 'nein', 'Bots blockieren nicht');
}
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-regelluecken-welle1.test.js`
Expected: FAIL mit `unbeantwortet: nicht benutzt` bzw. `Frage zu Kampfbeginn` (bzw. `hasClass`/`handleAnswerZaubercouch is not a function` – dann Exporte zuerst ergänzen: `hasClass`, `handleAnswerZaubercouch`, `handleRespondHelp`, `handleSetCombatReady` in `module.exports`).

- [ ] **Step 3: Regel an der Karte markieren**

`src/cards/passives.js`, `ITEM_GRANTS_TRAIT`:

```js
    'ZAUBERCOUCH': { class: 'ZAUBERER', nurWennBenutzt: true },
```

und den ponytail-Kommentar darüber („die Couch ist hier immer "in Benutzung" …“) ersetzen durch: „Nur wenn zu Beginn des Kampfs gewaehlt (player.zaubercouch === 'ja', siehe zaubercouchFragen in server.js) - dann auch -1 auf Weglaufen.“

- [ ] **Step 4: Server – Zustand, Wirkung, Sperren**

`server.js`, `itemGrantsTrait`, nach `if (regel.nurMonster && !auchNurMonster) return false;`:

```js
    if (regel.nurWennBenutzt && player.zaubercouch !== 'ja') return false;
```

`fleeModifierParts`, in der Schleife über die Ausrüstung die Zeile mit `FLEE_ITEM_BONUS` ersetzen durch:

```js
    if (c && FLEE_ITEM_BONUS[c.name] && !(c.name === 'ZAUBERCOUCH' && player.zaubercouch !== 'ja')) {
      parts.push({ label: c.name, amount: FLEE_ITEM_BONUS[c.name] });
    }
```

Neue Funktionen vor `function startCombat`:

```js
// ZAUBERCOUCH: "Du kannst zu Beginn eines jeden Kampfes entscheiden, ob du
// die Zaubercouch verwenden willst." Wer mit angelegter Couch in einen Kampf
// kommt (kaempfend bei Kampfbeginn, helfend beim Einstieg), bekommt die
// Frage. Solange sie offen ist, wird nicht ausgewertet. Bots sagen Nein.
// Der Zustand haengt am Spieler, weil hasClass keinen Raum kennt; er wird bei
// jedem Kampfbeginn und jedem Kampfende zurueckgesetzt.
function zaubercouchFragen(player) {
  if (!player || !equippedItemIds(player).some((id) => (card(id) || {}).name === 'ZAUBERCOUCH')) return;
  player.zaubercouch = player.isBot ? 'nein' : 'offen';
}
function zaubercouchZuruecksetzen(room) {
  room.players.forEach((p) => { delete p.zaubercouch; });
}
function zaubercouchOffen(room) {
  return combatParticipants(room).filter((p) => p.zaubercouch === 'offen');
}
function handleAnswerZaubercouch(room, playerId, benutzen) {
  const p = findPlayer(room, playerId);
  if (!room.combat || !p || p.zaubercouch !== 'offen') return;
  p.zaubercouch = benutzen ? 'ja' : 'nein';
  log(room, `${p.name} ${benutzen ? 'ruht sich auf der Zaubercouch aus (Zauberer, -1 auf Weglaufen)' : 'verzichtet in diesem Kampf auf die Zaubercouch'}.`);
  refreshCombatReady(room); // Klasse und Staerke koennen sich geaendert haben
  touchRoom(room);
}
```

`startCombat`: als erste Zeile im Funktionskörper `zaubercouchZuruecksetzen(room);` und direkt nach dem `room.combat = { ... };`-Block `zaubercouchFragen(findPlayer(room, actorId));`.

`handleRespondHelp`: direkt nach `c.helperId = playerId;` die Zeile `zaubercouchFragen(findPlayer(room, playerId));`.

`handleEvaluateCombat`: nach `if (c.actorId !== playerId) return;`:

```js
  const couchOffen = zaubercouchOffen(room);
  if (couchOffen.length) {
    log(room, `Erst entscheiden, ob die Zaubercouch benutzt wird: ${couchOffen.map((p) => p.name).join(', ')}.`);
    touchRoom(room);
    return;
  }
```

`handleSetCombatReady`: nach `if (!combatReadyRequired(room).includes(playerId)) return;`:

```js
  if (ready && findPlayer(room, playerId) && findPlayer(room, playerId).zaubercouch === 'offen') return;
```

An allen 5 Stellen `room.combat = null;` (Zeilen ~802, ~4368, ~5477, ~5656, ~6881) direkt danach `zaubercouchZuruecksetzen(room);` einfügen. Vorher mit `grep -n "room.combat = null" server.js` die aktuellen Zeilen bestimmen.

`publicPlayer`: neben `gender: p.gender,` das Feld `zaubercouch: p.zaubercouch || null,` ergänzen.

Socket-Handler neben `setCombatReady`:

```js
  onSafe(socket, 'answerZaubercouch', ({ benutzen }) => act(socket, (room, pid) => handleAnswerZaubercouch(room, pid, benutzen === true)));
```

`module.exports`: `handleAnswerZaubercouch`, `hasClass` (falls noch nicht), `handleRespondHelp`, `handleSetCombatReady` (falls noch nicht) ergänzen.

- [ ] **Step 5: Client – Frage im Kampf-Panel**

`public/client.js`, in `renderCombat` direkt nach `div.appendChild(strengthRow);`:

```js
    // ZAUBERCOUCH: Frage zu Kampfbeginn (siehe zaubercouchFragen im Server).
    const ich = state.players.find((p) => p.id === myInfo.playerId);
    if (ich && ich.zaubercouch === 'offen') {
      const couchRow = document.createElement('div');
      couchRow.className = 'row gap wrap';
      couchRow.appendChild(textNode('Zaubercouch verwenden? (Zauberer in diesem Kampf, -1 auf Weglaufen)'));
      couchRow.appendChild(mkBtn('Ja', () => socket.emit('answerZaubercouch', { benutzen: true })));
      couchRow.appendChild(mkBtn('Nein', () => socket.emit('answerZaubercouch', { benutzen: false })));
      div.appendChild(couchRow);
    }
```

(`textNode`, `mkBtn`, `myInfo` und `state` existieren bereits in `client.js`; vor dem Einfügen per grep bestätigen.)

- [ ] **Step 6: Tests grün, volle Suite, Commit**

Run: `node tests/card-regelluecken-welle1.test.js` → grün. `npm test` → alle erfolgreich (inkl. `tests/malformed-input.test.js`, das jedes Socket-Event mit Müll beschießt – der neue Handler muss das überstehen).

```bash
git add server.js src/cards/passives.js public/client.js tests/card-regelluecken-welle1.test.js
git commit -m "fix: ZAUBERCOUCH - Wahl zu Beginn jedes Kampfs (Zauberer + -1 Weglaufen nur bei Ja)"
```

---

### Task 6: Abschluss – veraltete Kommentare, Review, PR

**Files:**
- Modify: `src/cards/passives.js` – WEIHNACHTSMANN-Kommentar (~Zeile 410: „nur der Kampfbonus oben ist verdrahtet. Die Schlimmen Dinge ... sind bewusst manuell“), EINHEITSGRÖSSE-Kommentar in `src/cards/treasures.js` (~Zeile 140), MAGISCHE-LAMPE-Kommentar in `server.js` (~Zeile 5807)

- [ ] **Step 1: Veraltete Kommentare korrigieren**

- `passives.js`, WEIHNACHTSMANN: ersetzen durch „Die Schlimmen Dinge (Stoererliste) stehen in CONSEQUENCE_OVERRIDES ('lingeringCurse', kind 'noTreasure').“
- `treasures.js`, EINHEITSGRÖSSE: den ponytail-Absatz „die Kartenwahl (openCardCardChoice) zeigt beide Ablagestapel …“ ersetzen durch „Genommen wird automatisch der oberste tragbare Gegenstand des Schatz-Ablagestapels (takeFirstWearableFromTreasureDiscard), wie die Karte es sagt.“
- `server.js`, MAGISCHE LAMPE (Kommentar über `const LAMP_CARDS`): „ponytail: kein eigenes Fenster …“ ersetzen durch „Spielbar im eigenen Kampf ueber handlePlayCombatCard und zusaetzlich im Fluchtentscheidungsfenster (c.fleeRerollOffer) nach einem verpatzten Wurf.“

Run: `npm test` → alle erfolgreich.

```bash
git add server.js src/cards/passives.js src/cards/treasures.js
git commit -m "docs: veraltete Kommentare (Weihnachtsmann, Einheitsgroesse, Magische Lampe)"
```

- [ ] **Step 2: Code-Review** (superpowers:requesting-code-review, Basis `origin/main`), Befunde prüfen und beheben.

- [ ] **Step 3: Push + PR** auf `DuckOfJustice` pushen, PR gegen `Marmelade1357/Munchkin` `main` (Ablauf siehe Obsidian-Notiz „Git- und PR-Ablauf“).
