# Regellücken Welle 4 (drei Flüche) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Clerical-Errors-Flüche TOURISTENFALLE, HUNGRIGER RUCKSACK und TEMPORÄRE ANMNESIE wirken automatisch statt nur manuell.

**Architecture:** Alle drei werden anhaltende Flüche in `LINGERING_CURSES` (`src/cards/reactions.js`) und landen damit über den vorhandenen Weg (`autoApplyLossConsequence` → `addActiveCurse`) in `player.activeCurses`. Die Wirkung hängt an drei Stellen: `handlePlayMonsterFromHand` (TOURISTENFALLE), einer neuen Phasenfunktion `setzeZugphase` (RUCKSACK), zwei neuen Filtern `aktiveKlassen`/`aktiveRassen` hinter `hasClass`/`hasRace` (ANMNESIE). Das Ende nach Bedingung läuft über `clearActiveCurseByKind` in `finishCombatWin`.

**Tech Stack:** Node.js (CommonJS), Express + Socket.IO; Tests mit `assert` über `node tests/<datei>.test.js` bzw. `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-23-drei-flueche-welle4-design.md`

## Global Constraints

- Code, Kommentare, Commit-Messages, Log- und UI-Texte auf Deutsch (Kommentare im Umfeld schreiben Umlaute als ae/oe/ue, Logtexte mit Umlauten).
- Kartennamen exakt wie in `data/cards.json`: `TEMPORÄRE ANMNESIE`, `HUNGRIGER RUCKSACK`, `TOURISTENFALLE`.
- TDD: erst der Test, Test schlägt fehl, dann der Code.
- `npm test` grün am Ende jeder Task. `tests/basic-game-flow.test.js` ist zufallsabhängig und scheitert selten mit „kein einziger Kampf" – einzeln wiederholen, bevor ein Fehler vermutet wird.
- Dateien haben teils CRLF-Zeilenenden: mehrzeilige Ersetzungen per Skript schlagen fehl – Edit-Werkzeug benutzen.
- Zeilennummern sind Näherungen (Stand bdae98f); Funktionen über ihren Namen suchen.
- Commits enden mit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018EZtVTS6ALSwNpNkhQkNza
  ```
- Branch: `fix/welle4-drei-flueche` (existiert, basiert auf `fix/welle3-barde-verstaerker`). Nicht pushen.
- Bewusste Vereinfachungen mit `// ponytail:` markieren (Grenze + Aufrüstweg). Namen im Client mit `escapeHtml()`.

---

### Task 1: TOURISTENFALLE

**Files:**
- Create: `tests/card-clerical-fluechewelle4.test.js`
- Modify: `src/cards/reactions.js` (`LINGERING_CURSES`), `server.js` (`handlePlayMonsterFromHand` ~3053, `finishCombatWin` ~5529), `public/client.js` (Knopf „Als Monster spielen" ~1829)

**Interfaces:**
- Produces: `activeCurses`-Art `'keinAerger'`; Testdatei mit `makePlayer`/`makeRoom`/`findCard`/`fertig` (Tasks 2–3 hängen an).

- [ ] **Step 1: Testdatei anlegen**

```js
// Regellücken Welle 4 (Spec 2026-09-23-drei-flueche-welle4-design.md):
// TOURISTENFALLE, HUNGRIGER RUCKSACK, TEMPORÄRE ANMNESIE.
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
const verfluche = (room, p, name) => S.addActiveCurse(room, p, name, findCard(name).id);
const hatFluch = (p, name) => (p.activeCurses || []).some((f) => f.name === name);

// --- TOURISTENFALLE: "Du darfst nicht 'Auf Aerger aus sein'. Dieser Fluch
// bleibt bestehen, bis du einem anderen Spieler geholfen hast, einen Kampf zu
// gewinnen."
{
  const goblin = findCard('LAHMER GOBLIN', 'monster');
  const p = makePlayer({ hand: [goblin.id] });
  const room = makeRoom([p], { turnPhase: 'aerger' });
  verfluche(room, p, 'TOURISTENFALLE');
  assert.ok(hatFluch(p, 'TOURISTENFALLE'), 'der Fluch steht im Tracker');
  S.handlePlayMonsterFromHand(room, 'p1', goblin.id);
  assert.strictEqual(room.combat, null, 'kein Kampf gegen ein Monster aus der Hand');
  assert.ok(p.hand.includes(goblin.id), 'das Monster bleibt auf der Hand');
}
// Gegenprobe ohne Fluch: das Monster aus der Hand startet einen Kampf.
{
  const goblin = findCard('LAHMER GOBLIN', 'monster');
  const p = makePlayer({ hand: [goblin.id] });
  const room = makeRoom([p], { turnPhase: 'aerger' });
  S.handlePlayMonsterFromHand(room, 'p1', goblin.id);
  assert.ok(room.combat, 'ohne Fluch geht es in den Kampf');
}
// Ein eigener Sieg beendet den Fluch nicht, ein Sieg als Helfer:in schon.
{
  const goblin = findCard('LAHMER GOBLIN', 'monster');
  const a = makePlayer({ id: 'p1', name: 'A' });
  const b = makePlayer({ id: 'p2', name: 'B' });
  const room = makeRoom([a, b]);
  verfluche(room, a, 'TOURISTENFALLE');
  verfluche(room, b, 'TOURISTENFALLE');
  S.startCombat(room, 'p1', [goblin.id], { fromHand: false });
  room.combat.helperId = 'p2';
  S.resolveCombatWin(room);
  assert.ok(hatFluch(a, 'TOURISTENFALLE'), 'eigener Sieg: der Fluch bleibt');
  assert.ok(!hatFluch(b, 'TOURISTENFALLE'), 'als Helfer:in gewonnen: der Fluch endet');
}

fertig();
console.log('card-clerical-fluechewelle4: alle Checks gruen');
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-clerical-fluechewelle4.test.js`
Expected: FAIL bei `der Fluch steht im Tracker` (heute kein `LINGERING_CURSES`-Eintrag).

- [ ] **Step 3: Implementieren**

`src/cards/reactions.js`, in `LINGERING_CURSES` nach `'TODESANGST'`:

```js
    // "Du darfst nicht 'Auf Aerger aus sein'. Dieser Fluch bleibt bestehen,
    // bis du einem anderen Spieler geholfen hast, einen Kampf zu gewinnen."
    // Ende: finishCombatWin (Helfer:in eines gewonnenen Kampfes).
    'TOURISTENFALLE': { kind: 'keinAerger', dauer: 'dauerhaft',
      hinweis: 'Kein "Auf Ärger aus sein", bis du jemandem geholfen hast, einen Kampf zu gewinnen.' },
```

`server.js`, `handlePlayMonsterFromHand` direkt nach `if (!c || c.category !== 'monster') return;`:

```js
  // TOURISTENFALLE: "Du darfst nicht 'Auf Aerger aus sein'."
  if ((player.activeCurses || []).some((f) => f.kind === 'keinAerger')) {
    log(room, `${player.name} sitzt in der Touristenfalle und darf nicht auf Ärger aus sein.`);
    return;
  }
```

`server.js`, `finishCombatWin`, direkt nach dem `noTreasure`-Block (`clearActiveCurseByKind(actor, 'noTreasure')`):

```js
  // TOURISTENFALLE endet, "bis du einem anderen Spieler geholfen hast, einen
  // Kampf zu gewinnen" - nur die Helfer:in, nicht die kaempfende Person.
  if (helper && clearActiveCurseByKind(helper, 'keinAerger')) {
    log(room, `${helper.name} hat geholfen, einen Kampf zu gewinnen - die Touristenfalle ist vorbei.`);
  }
```

`public/client.js`, beim Knopf „Als Monster spielen" (`c.category === 'monster' && myTurn && state.turnPhase === 'aerger'`): Bedingung um `&& !(me.activeCurses || []).some((f) => f.kind === 'keinAerger')` ergänzen. Vorher prüfen, wie die eigene Spielerin im Client heißt (`me`, `myPlayer` o. Ä.) und ob `activeCurses` im öffentlichen Zustand steht (`publicState`, Feld `activeCurses` bei ~server.js:577); den vorhandenen Namen übernehmen. Im Phasen-Kasten (`state.turnPhase === 'aerger'`, ~client.js:1584) den Satz „Du kannst stattdessen unten ... wählen." bei diesem Fluch durch „Touristenfalle: du darfst kein Monster aus der Hand spielen." ersetzen.

- [ ] **Step 4: Tests grün, volle Suite, Commit**

Run: `node tests/card-clerical-fluechewelle4.test.js` → grün; `npm test` → alle erfolgreich.

```bash
git add src/cards/reactions.js server.js public/client.js tests/card-clerical-fluechewelle4.test.js
git commit -m "fix: TOURISTENFALLE sperrt 'Auf Aerger aus sein' bis zur geleisteten Hilfe"
```

---

### Task 2: HUNGRIGER RUCKSACK

**Files:**
- Modify: `src/cards/reactions.js` (`LINGERING_CURSES`), `server.js` (neue Funktion `setzeZugphase` neben `combatEndPhase` ~4567; alle fünf Stellen, die `gabe` setzen: `handleLootRoom` ~3102, ~1204, `beendeKampfOhneSieg` ~4564, ~5738, ~5914; `module.exports`)
- Test: `tests/card-clerical-fluechewelle4.test.js`

**Interfaces:**
- Consumes: Testhelfer aus Task 1.
- Produces: `setzeZugphase(room, phase)`; `activeCurses`-Art `'rucksack'`; Export `handleLootRoom`.

- [ ] **Step 1: Tests anhängen (vor `fertig();`)**

```js
// --- HUNGRIGER RUCKSACK: am Ende des eigenen Zuges (vor der Milden Gabe)
// wuerfeln; der Rucksack frisst so viele zufaellige Handkarten; bei 6 endet
// der Fluch und die Hand bleibt unversehrt.
{
  const tuer = ALL_CARDS.filter((c) => c.type === 'door' && c.category === 'monster').slice(0, 1).map((c) => c.id);
  const schaetze = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 5).map((c) => c.id);
  const spiele = (wurf, fluch) => {
    const p = makePlayer({ hand: schaetze.slice() });
    const room = makeRoom([p], { turnPhase: 'pluendern', doorDeck: tuer.slice() });
    if (fluch) verfluche(room, p, 'HUNGRIGER RUCKSACK');
    const zufall = Math.random;
    let erster = true;
    // Erster Aufruf = Wuerfel, danach die Zufallsauswahl der Karten.
    Math.random = () => { if (erster) { erster = false; return (wurf - 1) / 6 + 0.01; } return 0; };
    try { S.handleLootRoom(room, 'p1'); } finally { Math.random = zufall; }
    return { p, room };
  };
  const drei = spiele(3, true);
  assert.strictEqual(drei.room.turnPhase, 'gabe');
  assert.strictEqual(drei.p.hand.length, 6 - 3, 'Wurf 3: drei Karten gefressen (5 + 1 geplündert - 3)');
  assert.ok(hatFluch(drei.p, 'HUNGRIGER RUCKSACK'), 'der Fluch bleibt');

  const sechs = spiele(6, true);
  assert.strictEqual(sechs.p.hand.length, 6, 'Wurf 6: die Hand bleibt unversehrt');
  assert.ok(!hatFluch(sechs.p, 'HUNGRIGER RUCKSACK'), 'Wurf 6: der Fluch endet');

  const ohne = spiele(3, false);
  assert.strictEqual(ohne.p.hand.length, 6, 'ohne Fluch frisst nichts');
}
// Kleine Hand: der Rucksack frisst hoechstens, was da ist.
{
  const tuer = ALL_CARDS.filter((c) => c.type === 'door' && c.category === 'monster').slice(0, 1).map((c) => c.id);
  const p = makePlayer({ hand: [] });
  const room = makeRoom([p], { turnPhase: 'pluendern', doorDeck: tuer.slice() });
  verfluche(room, p, 'HUNGRIGER RUCKSACK');
  const zufall = Math.random;
  let erster = true;
  Math.random = () => { if (erster) { erster = false; return 4 / 6 + 0.01; } return 0; };
  try { S.handleLootRoom(room, 'p1'); } finally { Math.random = zufall; }
  assert.strictEqual(p.hand.length, 0, 'Wurf 5 bei einer Karte: die eine Karte ist weg');
  assert.ok(room.doorDiscard.includes(tuer[0]), 'die gefressene Karte liegt auf dem Ablagestapel');
}
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-clerical-fluechewelle4.test.js`
Expected: FAIL mit `S.handleLootRoom is not a function`; nach dem Export (Step 3, erster Teil) FAIL bei `Wurf 3: drei Karten gefressen`.

- [ ] **Step 3: Implementieren**

`handleLootRoom` in `module.exports` aufnehmen.

`src/cards/reactions.js`, in `LINGERING_CURSES`:

```js
    // "Am Ende jedes deiner Zuege wuerfelst du, bevor 'Milde Gabe' verteilt
    // oder abgelegt wird. Dein Rucksack frisst entsprechend des Wurfs so viele
    // zufaellige Karten deiner Hand! Bei einer gewuerfelten 6 ... endet der
    // Fluch." Ausgeloest in setzeZugphase (server.js) beim Eintritt in 'gabe'.
    'HUNGRIGER RUCKSACK': { kind: 'rucksack', dauer: 'dauerhaft',
      hinweis: 'Am Ende jedes deiner Züge frisst der Rucksack Handkarten (Würfel); bei einer 6 endet der Fluch.' },
```

`server.js`, neben `combatEndPhase`:

```js
// Einzige Stelle, die die Zugphase wechselt, wenn Phase 4 (Milde Gabe)
// erreicht werden kann - HUNGRIGER RUCKSACK wuerfelt "am Ende jedes deiner
// Zuege ... bevor 'Milde Gabe' verteilt oder abgelegt wird".
function setzeZugphase(room, phase) {
  room.turnPhase = phase;
  if (phase !== 'gabe') return;
  const p = currentPlayer(room);
  if (!p || !(p.activeCurses || []).some((f) => f.kind === 'rucksack')) return;
  rollWithWindow(room, p, 'rucksack', (wurf) => {
    if (wurf >= 6) {
      clearActiveCurseByKind(p, 'rucksack');
      log(room, `${p.name} würfelt eine 6: der Hungrige Rucksack verschluckt sich selbst und verschwindet.`);
      return;
    }
    const gefressen = [];
    for (let i = 0; i < wurf && p.hand.length; i++) {
      const id = p.hand[Math.floor(Math.random() * p.hand.length)];
      removeFromHand(p, id);
      discardCard(room, id);
      gefressen.push(id);
    }
    // Karten aus der Hand sind geheim - der Verlauf nennt nur die Anzahl.
    log(room, `Der Hungrige Rucksack von ${p.name} frisst ${gefressen.length} Karte(n) (Wurf ${wurf}).`);
  });
}
```

Alle fünf Stellen umstellen:
- `handleLootRoom`: `room.turnPhase = 'gabe';` → `setzeZugphase(room, 'gabe');`
- ~1204: `room.turnPhase = combatEndPhase({ originalActorId: pc.originalActorId }, false);` → `setzeZugphase(room, combatEndPhase({ originalActorId: pc.originalActorId }, false));`
- `beendeKampfOhneSieg`: `room.turnPhase = combatEndPhase(c, thenLoot);` → `setzeZugphase(room, combatEndPhase(c, thenLoot));`
- ~5738: `if (!won) room.turnPhase = combatEndPhase(c, false);` → `if (!won) setzeZugphase(room, combatEndPhase(c, false));`
- ~5914: `if (!actorGescheitert) room.turnPhase = combatEndPhase(c, false);` → `if (!actorGescheitert) setzeZugphase(room, combatEndPhase(c, false));`

Danach `grep -n "turnPhase = 'gabe'\|turnPhase = combatEndPhase" server.js` → keine Treffer mehr.

Bots: Der Bot ruft in Phase `gabe` `handleEndTurnAction`; bei offenem Wurf-Fenster blockiert `zugAktionOffen`, der Bot versucht es beim nächsten Tick erneut. Prüfen, dass der Bot-Timer nach dem Schließen des Fensters neu anläuft (Suche nach `scheduleBot`/`botTimer` im Bot-Abschnitt); falls nicht, im Report vermerken.

- [ ] **Step 4: Tests grün, volle Suite, Commit**

Run: `node tests/card-clerical-fluechewelle4.test.js` → grün; `npm test` → alle erfolgreich.

```bash
git add src/cards/reactions.js server.js tests/card-clerical-fluechewelle4.test.js
git commit -m "fix: HUNGRIGER RUCKSACK frisst am Zugende Handkarten"
```

---

### Task 3: TEMPORÄRE ANMNESIE

**Files:**
- Modify: `src/cards/reactions.js` (`LINGERING_CURSES`), `server.js` (`hasRace` ~1348, `hasClass` ~3129, `raceItemBonusSum` ~497, `monsterSeesRace` ~3516, `fleeIsAutomatic` ~3621, `dryadeWirkung` ~4244, Factory-Aufrufe von `consequences.js` ~2346 und `passives.js` ~3165, `finishCombatWin`, `module.exports`), `src/cards/passives.js` (`istMensch` ~279, `RÜSSELKÄFER` ~336), `src/cards/consequences.js` (`AMAZONE` ~81, `VERLIERE DEINE KLASSE` ~311), `public/client.js` (Rassen-/Klassen-Abzeichen ~666, ~741, ~1649)
- Test: `tests/card-clerical-fluechewelle4.test.js`

**Interfaces:**
- Consumes: Testhelfer aus Task 1.
- Produces: `aktiveKlassen(player)`, `aktiveRassen(player)` (Arrays von Karten-Ids); `activeCurses`-Art `'amnesie'`.

**Regel für die Einordnung** (Spec §1): Wo `.classes`/`.races` eine **Bedingung oder Wirkung** ist („hast du eine Klasse?", „bist du ein Elf?", Rassen-/Klassenboni), gilt die aktive Liste. Wo es um die **Karten als Besitz** geht (Ablegen, Obergrenzen `traitCap`/`traitImmun`, Auslegen ~6541, Primitive `discardRaceCards`/`discardClassCards`/`discardSpecificClassCard`/`discardOneRaceCardIfAny`/`discardClassCardMatchingElseDeath`, `publicState`), bleibt die echte Liste.

- [ ] **Step 1: Tests anhängen (vor `fertig();`)**

```js
// --- TEMPORAERE ANMNESIE: "... wirst du ueberall als klassenloser Mensch
// gezaehlt", bis du ein Monster getoetet oder dabei geholfen hast.
{
  const elf = findCard('ELF');
  const krieger = findCard('KRIEGER');
  const p = makePlayer({ races: [elf.id], classes: [krieger.id] });
  const room = makeRoom([p]);
  assert.ok(S.hasRace(p, 'ELF') && S.hasClass(p, 'KRIEGER'), 'vor dem Fluch: Elf und Krieger');
  verfluche(room, p, 'TEMPORÄRE ANMNESIE');
  assert.ok(!S.hasRace(p, 'ELF'), 'mit Fluch: keine Rasse');
  assert.ok(!S.hasClass(p, 'KRIEGER'), 'mit Fluch: keine Klasse');
  assert.ok(!S.monsterSeesRace(p, 'ELF'), 'auch Monster sehen keinen Elfen');
  assert.deepStrictEqual(p.races, [elf.id], 'die Karten bleiben liegen');
  assert.deepStrictEqual(p.classes, [krieger.id]);
  // Eine waehrend des Fluchs ausgelegte Klasse wirkt ebenfalls noch nicht.
  const dieb = findCard('DIEB');
  p.classes.push(dieb.id);
  assert.ok(!S.hasClass(p, 'DIEB'), 'neue Klasse zaehlt erst nach dem Fluch');
  p.classes.pop();
  // AMAZONE: ohne (erinnerte) Klasse gibt es die Stufen statt des Klassenverlusts.
  const amazone = findCard('AMAZONE');
  const spec = S.resolveConsequenceSpec('AMAZONE', amazone.badstuff, p, room);
  assert.strictEqual(spec.type, 'levelDelta', 'AMAZONE sieht eine klassenlose Person');
}
// Ende: Sieg als kaempfende Person ...
{
  const krieger = findCard('KRIEGER');
  const goblin = findCard('LAHMER GOBLIN', 'monster');
  const p = makePlayer({ classes: [krieger.id] });
  const room = makeRoom([p]);
  verfluche(room, p, 'TEMPORÄRE ANMNESIE');
  S.startCombat(room, 'p1', [goblin.id], { fromHand: false });
  S.resolveCombatWin(room);
  assert.ok(!hatFluch(p, 'TEMPORÄRE ANMNESIE'), 'Monster getoetet: die Erinnerung kommt zurueck');
  assert.ok(S.hasClass(p, 'KRIEGER'), 'der Krieger zaehlt wieder');
}
// ... und als Helfer:in.
{
  const krieger = findCard('KRIEGER');
  const goblin = findCard('LAHMER GOBLIN', 'monster');
  const a = makePlayer({ id: 'p1', name: 'A' });
  const b = makePlayer({ id: 'p2', name: 'B', classes: [krieger.id] });
  const room = makeRoom([a, b]);
  verfluche(room, b, 'TEMPORÄRE ANMNESIE');
  S.startCombat(room, 'p1', [goblin.id], { fromHand: false });
  room.combat.helperId = 'p2';
  S.resolveCombatWin(room);
  assert.ok(!hatFluch(b, 'TEMPORÄRE ANMNESIE'), 'beim Toeten geholfen: der Fluch endet');
}
```

Vorher in `data/cards.json` prüfen: `ELF`, `KRIEGER`, `AMAZONE` existieren unter genau diesen Namen und `AMAZONE.badstuff` ist gesetzt; sonst eine gleichwertige Karte nehmen und im Report nennen.

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `node tests/card-clerical-fluechewelle4.test.js`
Expected: FAIL bei `mit Fluch: keine Rasse`.

- [ ] **Step 3: Implementieren**

`src/cards/reactions.js`, in `LINGERING_CURSES`:

```js
    // "Eine Beule am Kopf laesst dich deine Klasse(n) und Rasse(n) vergessen.
    // Du wirst dich erst an sie erinnern, wenn du ein Monster getoetet hast
    // oder dabei geholfen hast ... Bis dahin wirst du ueberall als
    // klassenloser Mensch gezaehlt." Die Karten bleiben liegen und zaehlen
    // nicht (aktiveKlassen/aktiveRassen in server.js); Ende in finishCombatWin.
    'TEMPORÄRE ANMNESIE': { kind: 'amnesie', dauer: 'dauerhaft',
      hinweis: 'Klassen und Rassen vergessen: du zählst als klassenloser Mensch, bis du ein Monster getötet oder dabei geholfen hast.' },
```

`server.js`, direkt vor `hasRace` (~1347), damit beide Funktionen vor ihrer ersten Nutzung stehen:

```js
// TEMPORAERE ANMNESIE: solange der Fluch wirkt, zaehlen die ausliegenden
// Klassen- und Rassenkarten nicht - "ueberall als klassenloser Mensch". Wer
// die Karten als BESITZ braucht (Ablegen, Obergrenzen, Anzeige), liest
// weiter player.classes/player.races direkt.
function hatAmnesie(player) {
  return !!player && (player.activeCurses || []).some((f) => f.kind === 'amnesie');
}
function aktiveKlassen(player) { return hatAmnesie(player) ? [] : player.classes; }
function aktiveRassen(player) { return hatAmnesie(player) ? [] : player.races; }
```

Umstellen auf `aktiveRassen(player)` bzw. `aktiveKlassen(player)`:
- `hasRace`: `player.races.some(` → `aktiveRassen(player).some(`
- `hasClass`: `player.classes.some(` → `aktiveKlassen(player).some(`. Die ZAUBERCOUCH-Zeile davor bleibt; darüber ein Kommentar:
  ```js
  // ponytail: die ZAUBERCOUCH wirkt auch unter TEMPORAERER ANMNESIE - sie ist
  // ein Gegenstand, keine Erinnerung. Aufruestweg: hier hatAmnesie pruefen.
  ```
- `raceItemBonusSum`: `player.races.reduce(` → `aktiveRassen(player).reduce(`
- `monsterSeesRace`: `player.races.some(` → `aktiveRassen(player).some(`
- `fleeIsAutomatic`: `player.races.map(` → `aktiveRassen(player).map(`
- `dryadeWirkung`: `player.classes.some(` → `aktiveKlassen(player).some(` (eine vergessene Zauberer-Klasse kann die Dryade nicht nehmen)

`aktiveKlassen` und `aktiveRassen` an beide Factories durchreichen: im `consequencesFactory({ ... })`-Aufruf und im `passivesFactory({ ... })`-Aufruf je `aktiveKlassen, aktiveRassen` ergänzen; in den Dateien in der Destrukturierung der Factory-Parameter ebenfalls ergänzen.

`src/cards/passives.js`:
- `istMensch`: `!p.races.length` → `!aktiveRassen(p).length`
- `RÜSSELKÄFER`: `!p.classes.length` → `!aktiveKlassen(p).length`

`src/cards/consequences.js`:
- `AMAZONE`: `player.classes.length ?` → `aktiveKlassen(player).length ?`
- `VERLIERE DEINE KLASSE`: die beiden Bedingungen `player.classes.length >= 2` und `player.classes.length === 1` → `aktiveKlassen(player).length`; die Optionen (`player.classes.map(`) ebenfalls über `aktiveKlassen(player)` – unter Amnesie greift damit der Stufen-Zweig.

`server.js`, `finishCombatWin`, nach dem TOURISTENFALLE-Block aus Task 1:

```js
  // TEMPORAERE ANMNESIE: "... erst an sie erinnern, wenn du ein Monster
  // getoetet hast oder dabei geholfen hast" - beide Beteiligten.
  [actor, helper].filter(Boolean).forEach((p) => {
    if (clearActiveCurseByKind(p, 'amnesie')) log(room, `${p.name} erinnert sich wieder an Klasse(n) und Rasse(n).`);
  });
```

`aktiveKlassen`, `aktiveRassen` in `module.exports` aufnehmen.

Danach `grep -n "\.classes\b\|\.races\b" server.js src/cards/*.js` durchgehen: jede verbleibende Stelle muss nach der Regel oben eine Besitz-Stelle sein. Stellen, die unklar sind, im Report auflisten.

- [ ] **Step 4: Client**

`public/client.js`, an den drei Stellen mit `p.races.forEach(...)`/`p.classes.forEach(...)` (~666, ~741, ~1649): Ist `(p.activeCurses || []).some((f) => f.kind === 'amnesie')`, bekommen die Abzeichen den Zusatz „(vergessen)" und eine gedämpfte Darstellung (vorhandene Farbe mit `opacity: 0.45` am erzeugten Element, keine neue CSS-Klasse nötig). Die Zeile „Mensch, ohne Klasse" erscheint in diesem Fall zusätzlich. Vorher prüfen, dass `activeCurses` für alle Spielenden im öffentlichen Zustand steht (server.js ~577); falls nur für die eigene Person, die Anzeige auf die eigenen Abzeichen beschränken und im Report vermerken.

- [ ] **Step 5: Tests grün, volle Suite, Commit**

Run: `node tests/card-clerical-fluechewelle4.test.js` → grün; `npm test` → alle erfolgreich.

```bash
git add src/cards/reactions.js src/cards/passives.js src/cards/consequences.js server.js public/client.js tests/card-clerical-fluechewelle4.test.js
git commit -m "fix: TEMPORAERE ANMNESIE - Klassen und Rassen zaehlen bis zum naechsten Sieg nicht"
```

---

### Task 4: Abschluss

- [ ] **Step 1: WUNSCHRING-Gegenprobe (vor `fertig();` anhängen)**

```js
// Alle drei Flueche beendet der WUNSCHRING wie jeden anhaltenden Fluch
// (gleicher Aufrufweg wie tests/card-curses.test.js).
{
  ['TOURISTENFALLE', 'HUNGRIGER RUCKSACK', 'TEMPORÄRE ANMNESIE'].forEach((name) => {
    const p = makePlayer();
    const room = makeRoom([p]);
    verfluche(room, p, name);
    const spec = S.TREASURE_POWER_OVERRIDES['WUNSCHRING'](p);
    assert.strictEqual(spec.type, 'clearCurse', `WUNSCHRING beendet "${name}" ohne Wahl`);
    S.applyPrimitiveAction(room, p, spec);
    assert.ok(!hatFluch(p, name), `"${name}" ist beendet`);
  });
}
```

Run: `node tests/card-clerical-fluechewelle4.test.js` → grün (ohne Codeänderung erwartet; schlägt er fehl, ist das ein Befund für den Report).

- [ ] **Step 2: Abdeckungs-Scan**

Run: `node tools/coverage-scan.js clericalerrors`
Expected: TEMPORÄRE ANMNESIE, HUNGRIGER RUCKSACK und TOURISTENFALLE stehen nicht mehr in der Liste.

- [ ] **Step 3: HANDOVER.md**

Neuen Abschnitt `## 13. Regellücken Welle 4: drei Flüche aus Clerical Errors` im Stil von §12 anhängen: je Fluch Wirkung, Ende, Code-Stelle (`setzeZugphase`, `aktiveKlassen`/`aktiveRassen`, `keinAerger`); die Einordnungsregel Wirkung vs. Besitz; bewusst offen (ZAUBERCOUCH unter Amnesie, Monster ohne Kampfsieg beenden die Amnesie nicht, gefressene Karten werden im Verlauf nicht genannt).

- [ ] **Step 4: volle Suite, Commit**

Run: `npm test` → alle erfolgreich.

```bash
git add tests/card-clerical-fluechewelle4.test.js HANDOVER.md
git commit -m "docs: HANDOVER Regelluecken Welle 4 (drei Flueche)"
```
