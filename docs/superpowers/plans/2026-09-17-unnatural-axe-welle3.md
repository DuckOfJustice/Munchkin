# Unnatural Axe Welle 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die vier zurückgestellten Unnatural-Axe-Monster (RIESENSTINKTIER, LUSTMONSTER, WEIHNACHTSMANN, EISKALTES HÄNDCHEN) vollständig verdrahten — Kampftexte und Schlimme Dinge.

**Architecture:** Kein neues Zustandssystem. Der vorhandene Tracker `player.activeCurses` wird über ein neues Primitiv `lingeringCurse` für Monster-Schlimme-Dinge geöffnet; darauf setzen drei neue `kind`s auf. Die Kampfsperre des Stinktiers folgt der Bauform von `kartenSperreAktiv` (EINSTWEILIGE VERFÜGUNG), das Händchen der Tabelle `COMBAT_START_OPTIONS`.

**Tech Stack:** Node.js (>=14), kein Framework im Kern. Express + Socket.IO nur als Transport. Tests sind reine `assert`-Skripte ohne Test-Runner, gesammelt über `tests/run.js` (`npm test`).

**Spec:** `docs/superpowers/specs/2026-09-17-unnatural-axe-welle3-design.md`

## Global Constraints

- **Sprache:** Alle Kommentare, Logzeilen und Commit-Messages auf Deutsch. Umlaute in Kommentaren und Commit-Messages werden umschrieben (`ae`, `oe`, `ue`, `ss`), in Logzeilen und Kartennamen für Spieler:innen dagegen ausgeschrieben — so wie es die bestehende Datei jeweils schon hält.
- **Kartennamen:** exakt wie in `data/cards.json`, Großschreibung inklusive. `EISKALTES HÄNDCHEN` mit Umlaut, `GOTTLICHE INTERVENTION` ohne — die Rohdaten sind hier uneinheitlich und maßgeblich.
- **Tabellen gehören nach `src/cards/`**, Mechanik nach `server.js`. Jede neue Tabelle wird im `return`-Block ihres Moduls exportiert und in `server.js` aus dem `ctx`-Destructuring gelesen.
- **`ponytail:`-Kommentare** markieren jede bewusste Teilabdeckung und nennen den Aufrüstweg.
- **Tests laufen echte Pfade**, nicht Tabellen. `assert.ok(TABELLE.has('X'))` ist in diesem Plan kein gültiger Test — er beweist nur, dass ein Eintrag existiert. Maßgeblich ist der Commit `b246e64`, der genau diese Umstellung für zwei ältere Tests gemacht hat.
- **`levelDelta` zieht ab:** `{ type: 'levelDelta', amount: 1 }` kostet eine Stufe (server.js:1355-1357). Eine negative Zahl würde eine schenken.
- **Verifikation je Task:** `npm test` muss grün sein (aktuell 27/27), bevor committet wird.

---

## File Structure

| Datei | Verantwortung | Änderung |
|---|---|---|
| `src/cards/passives.js` | Dauerwirkungs-Tabellen | `MONSTER_LOCKS_OTHERS`, `MONSTER_REQUIRES_OTHER_GENDER`, `hatWunschring`, Einträge in `COMBAT_START_OPTIONS` und `SPECIAL_SLOT_ITEMS` |
| `src/cards/consequences.js` | Schlimme Dinge | drei neue `CONSEQUENCE_OVERRIDES`-Einträge, Abbau des Sammelkommentars |
| `server.js` | Mechanik | Primitiv `lingeringCurse`, `applyLingeringRule`, `clearActiveCurseByKind`, `stinktierSperre`, `stinktierStrafeAktiv`, `curseHidesHandItems`, `passendeHilfe`, `hatSchatzSperre`, Primitiv `haendchenBesaenftigen`, Gates in sechs Handlern |
| `tests/card-unnatural-monsters.test.js` | Tests der vier Karten | neue Blöcke je Karte |
| `tests/auto-consequence.test.js` | Wächter gegen zu gierigen Textparser | Neubegründung (Task 8) |
| `HANDOVER.md` | Übergabe | §11.3 ersetzen (Task 9) |

---

### Task 1: Primitiv `lingeringCurse` — activeCurses für Monster öffnen

**Files:**
- Modify: `server.js:2651-2684` (`addActiveCurse` aufteilen), `server.js:1355` (neues `case` daneben), `server.js:2690` (`clearActiveCurseByKind` daneben)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: nichts (erste Task)
- Produces:
  - `applyLingeringRule(room, player, name, cardId, regel)` — trägt einen Eintrag in `player.activeCurses` ein. `regel` = `{ kind, amount?, dauer, hinweis?, amountFuerRasse? }`.
  - `clearActiveCurseByKind(player, kind)` → `boolean` (ob etwas entfernt wurde)
  - Action-Spec `{ type: 'lingeringCurse', name, kind, dauer, hinweis }`, verwendbar in `CONSEQUENCE_OVERRIDES`

- [ ] **Step 1: Write the failing test**

Ans Ende von `tests/card-unnatural-monsters.test.js`, vor einem eventuellen Abschluss-`console.log`:

```js
// --- Primitiv lingeringCurse: Monster-Schlimme-Dinge im Fluch-Tracker -------
// Der Tracker activeCurses hing bisher nur am Fluch-Ziehpfad (handleDrawDoor
// -> addActiveCurse -> LINGERING_CURSES). Das Primitiv oeffnet ihn fuer
// Konsequenzen, ohne eine zweite Tabelle danebenzustellen.
{
  const { applyPrimitiveAction, clearActiveCurseByKind } = require('../server.js');
  const p = makePlayer({});
  const room = makeRoom([p]);
  applyPrimitiveAction(room, p, {
    type: 'lingeringCurse', name: 'TESTMONSTER', kind: 'noHandItemBonus',
    dauer: 'naechsterKampf', hinweis: 'Testwirkung.',
  });
  assert.strictEqual(p.activeCurses.length, 1, 'das Primitiv traegt genau einen Eintrag ein');
  assert.strictEqual(p.activeCurses[0].kind, 'noHandItemBonus');
  assert.strictEqual(p.activeCurses[0].dauer, 'naechsterKampf');
  assert.strictEqual(p.activeCurses[0].name, 'TESTMONSTER', 'der Name steht fuer die Anzeige mit drin');
  assert.strictEqual(p.activeCurses[0].hinweis, 'Testwirkung.');
  // Der WUNSCHRING loescht ueber clearActiveCurse nach INDEX - der Eintrag
  // muss also ein ganz normaler Tracker-Eintrag sein, kein Sonderfall.
  assert.strictEqual(clearActiveCurseByKind(p, 'noHandItemBonus'), true, 'gezieltes Loeschen meldet Erfolg');
  assert.strictEqual(p.activeCurses.length, 0, 'und raeumt den Eintrag weg');
  assert.strictEqual(clearActiveCurseByKind(p, 'noHandItemBonus'), false, 'ein zweiter Aufruf findet nichts mehr');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL mit `TypeError: clearActiveCurseByKind is not a function`

- [ ] **Step 3: Split `addActiveCurse`**

In `server.js` `addActiveCurse` (ab Zeile 2651) ersetzen durch zwei Funktionen. Der bisherige Rumpf wandert unverändert nach `applyLingeringRule`, nur der Tabellen-Nachschlag bleibt oben:

```js
function addActiveCurse(room, player, cardName, cardId) {
  const regel = LINGERING_CURSES[cardName];
  if (!regel) return;
  applyLingeringRule(room, player, cardName, cardId, regel);
}

// Das Eintragen selbst - getrennt vom Nachschlag in LINGERING_CURSES, damit
// auch Monster-Schlimme-Dinge (Primitiv 'lingeringCurse') denselben Tracker
// benutzen koennen, ohne eine zweite Tabelle danebenzustellen.
function applyLingeringRule(room, player, cardName, cardId, regel) {
  // ponytail: defensiv statt eine Invariante vorauszusetzen - ältere
  // Test-Helper/Spielstände ohne activeCurses sollen nicht abstürzen.
  if (!player.activeCurses) player.activeCurses = [];
  // ZWERGENBIER: "-4 ... ausser du bist ein Zwerg ... dann stattdessen +4".
  // Einmal beim Eintragen aufgeloest, damit der Eintrag reine Daten bleibt.
  let amount = regel.amount || 0;
  if (regel.amountFuerRasse) {
    const treffer = Object.keys(regel.amountFuerRasse).find((r) => hasRace(player, r));
    if (treffer) amount = regel.amountFuerRasse[treffer];
  }
  player.activeCurses.push({
    cardId, name: cardName, kind: regel.kind, amount, dauer: regel.dauer,
    // Klartext fuer die Anzeige - steht bei der Regel selbst (src/cards/
    // reactions.js), damit der Client die Wirkung nicht nachbauen muss.
    hinweis: regel.hinweis || '',
  });
  log(room, `${player.name} steht unter dem Fluch "${cardName}".`);
  // WINZIGE HÄNDE: "Du kannst keine Gegenstaende tragen, die mehr als eine
  // Hand benoetigen." Der haeufige Fall ist, dass der Zweihaender schon
  // getragen wird - sonst wirkte der Fluch nur auf kuenftige Gegenstaende.
  // Die Karte wandert zurueck auf die Hand (nicht auf den Ablagestapel): der
  // Text nimmt sie einem nicht weg, man kann sie nur nicht mehr benutzen.
  if (regel.kind === 'noTwoHandedItems') {
    equippedItemIds(player).forEach((id) => {
      const g = card(id);
      if (!g || (g.handsCost || 0) < 2) return;
      unequipSlotCard(player, id);
      player.hand.push(id);
      log(room, `"${g.name}" braucht zwei Haende - ${player.name} legt ihn zurueck auf die Hand.`, [id]);
    });
  }
}
```

- [ ] **Step 4: Add `clearActiveCurseByKind`**

Direkt unter `clearActiveCurse` (server.js:2690) einfügen:

```js
// Gezieltes Loeschen nach Wirkungsart statt nach Index. Gebraucht von den
// Eintraegen, die nicht nach fester Dauer enden, sondern wenn eine Bedingung
// eintritt (Stinktier: alle Kleidung abgelegt; Weihnachtsmann: ein Monster
// ohne Hilfe getoetet). Rueckgabewert sagt, ob wirklich etwas weg ist - die
// aufrufende Stelle loggt nur dann.
function clearActiveCurseByKind(player, kind) {
  const vorher = (player.activeCurses || []).length;
  if (!vorher) return false;
  player.activeCurses = player.activeCurses.filter((f) => f.kind !== kind);
  return player.activeCurses.length < vorher;
}
```

- [ ] **Step 5: Add the primitive**

In `applyPrimitiveAction` direkt nach `case 'levelUp':`-Block (server.js ~1361) einfügen:

```js
    // Monster-Schlimme-Dinge, die ueber diese eine Konsequenz hinaus
    // weiterwirken. Landen im selben Tracker wie die anhaltenden Flueche
    // (activeCurses) - deshalb beendet der WUNSCHRING sie mit, was gewollt
    // ist: im Spielgefuehl sind es Flueche, und der Ring sagt "beendet jeden
    // Fluch". Der Name kommt aus der Action, weil die Konsequenz-Funktionen
    // nur (player, room) sehen und die Monsterkarte selbst nicht kennen.
    case 'lingeringCurse':
      applyLingeringRule(room, player, action.name, action.cardId || null, action);
      return action.hinweis || 'anhaltende Wirkung';
```

- [ ] **Step 6: Export both helpers**

Im `module.exports` von `server.js` (ab Zeile ~5755) `clearActiveCurseByKind` und `applyLingeringRule` in die Liste aufnehmen, neben dem schon exportierten `applyPrimitiveAction`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: `card-unnatural-monsters: ok`

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: `27/27 Tests erfolgreich.` — insbesondere `card-curses.test.js` muss grün bleiben, es deckt den aufgeteilten Fluchpfad ab.

- [ ] **Step 9: Commit**

```bash
git add server.js tests/card-unnatural-monsters.test.js
git commit -m "Primitiv lingeringCurse: Monster-Schlimme-Dinge im Fluch-Tracker

Der Tracker activeCurses konnte anhaltende Wirkungen schon (kind, dauer,
Anzeige, WUNSCHRING-Aufloesung), hing aber allein am Fluch-Ziehpfad und
schlug seine Regeln nach Fluchkartennamen nach. addActiveCurse ist jetzt
in Nachschlag und Eintragen geteilt; das neue Primitiv reicht die Regel
direkt durch, sodass CONSEQUENCE_OVERRIDES denselben Tracker benutzt
statt einer zweiten Tabelle danebenzustellen."
```

---

### Task 2: RIESENSTINKTIER — die Kampfsperre als weiße Liste

**Files:**
- Modify: `src/cards/passives.js` (neue Tabelle + Export, ersetzt den `ponytail:`-Block ab Zeile 426)
- Modify: `server.js` — `stinktierSperre` neben `kartenSperreAktiv` (~2247), Gates in `handleRequestHelp` (4168), `handleThiefBackstab` (3189), `handlePlayCurseFromHand` (985), `handlePlayCombatCard` (3897)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: nichts aus Task 1
- Produces: `stinktierSperre(room, playerId)` → `boolean`; `MONSTER_LOCKS_OTHERS` (Set)

- [ ] **Step 1: Write the failing test**

```js
// --- RIESENSTINKTIER, Kampftext ---------------------------------------------
// "Sie können dir nicht helfen, dich hintergehen, oder beliebige Karten für
// oder gegen dich verwenden - außer Wandernde Monster und Monsterverstärker."
// Weisse Liste: gesperrt ist alles, erlaubt sind genau die zwei Ausnahmen.
{
  const { handleRequestHelp, handleThiefBackstab, handlePlayCombatCard,
    backstabMalus } = require('../server.js');
  const stinktier = findCard('RIESENSTINKTIER', 'monster');
  const verstaerker = ALL_CARDS.find((c) => c.category === 'door_other'
    && typeof c.bonus === 'number' && c.bonus !== 0 && /für\s+(das\s+)?Monster/i.test(c.text || ''));
  assert.ok(verstaerker, 'Testvoraussetzung: es gibt einen Monsterverstaerker');
  const trank = ALL_CARDS.find((c) => c.category === 'treasure_other'
    && typeof c.bonus === 'number' && c.bonus > 0 && /einmal|trank/i.test(c.text || ''));

  function stinktierKampf() {
    const kaempfer = makePlayer({ id: 'p1', name: 'A' });
    const dritter = makePlayer({ id: 'p2', name: 'B', classes: [findCard('DIEB', 'class').id] });
    const room = makeRoom([kaempfer, dritter]);
    room.combat = { actorId: 'p1', helperId: null, monsterIds: [stinktier.id],
      actorModifier: 0, monsterModifier: 0, backstabs: {}, mustFlee: false };
    return { room, kaempfer, dritter };
  }

  // 1. Keine Hilfe.
  {
    const { room, dritter } = stinktierKampf();
    handleRequestHelp(room, 'p1', dritter.id, 0);
    assert.ok(!room.combat.helperPending, 'gegen das Stinktier wird niemand um Hilfe gebeten');
  }
  // 2. Kein Hintergehen.
  {
    const { room, dritter } = stinktierKampf();
    const ablage = ALL_CARDS[0].id;
    dritter.hand.push(ablage);
    handleThiefBackstab(room, dritter.id, ablage, 'p1');
    assert.strictEqual(backstabMalus(room), 0, 'der Rueckenfall greift nicht');
    assert.ok(dritter.hand.includes(ablage), 'und kostet auch keine Karte');
  }
  // 3. Eine dritte Person spielt eine beliebige Kampfkarte: gesperrt.
  if (trank) {
    const { room, dritter } = stinktierKampf();
    dritter.hand.push(trank.id);
    const vorher = room.combat.actorModifier + room.combat.monsterModifier;
    handlePlayCombatCard(room, dritter.id, trank.id);
    assert.strictEqual(room.combat.actorModifier + room.combat.monsterModifier, vorher,
      'eine fremde Kampfkarte bleibt wirkungslos');
    assert.ok(dritter.hand.includes(trank.id), 'und bleibt auf der Hand');
  }
  // 4. Gegenprobe - die weisse Liste ist wirklich weiss: derselbe Weg mit
  //    einem Monsterverstaerker MUSS durchgehen, sonst prueft Fall 3 nur,
  //    dass handlePlayCombatCard ueberhaupt nichts tut.
  {
    const { room, dritter } = stinktierKampf();
    dritter.hand.push(verstaerker.id);
    handlePlayCombatCard(room, dritter.id, verstaerker.id);
    assert.ok(room.combat.monsterModifier !== 0,
      'ein Monsterverstaerker ist ausdruecklich erlaubt und wirkt');
  }
  // 5. Die kaempfende Person selbst ist NICHT gesperrt - der Text richtet
  //    sich an "deine Freunde".
  if (trank) {
    const { room, kaempfer } = stinktierKampf();
    kaempfer.hand.push(trank.id);
    handlePlayCombatCard(room, kaempfer.id, trank.id);
    assert.ok(!kaempfer.hand.includes(trank.id),
      'wer gegen das Stinktier kaempft, spielt seine eigenen Karten weiter');
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL bei Fall 1 — `gegen das Stinktier wird niemand um Hilfe gebeten`

- [ ] **Step 3: Add the table**

In `src/cards/passives.js` den `ponytail:`-Block zu RIESENSTINKTIER (ab Zeile 426, beginnend `// ponytail: RIESENSTINKTIER bewusst NICHT in MONSTER_FORBIDS_HELP.`) **ersetzen** durch:

```js
  // RIESENSTINKTIER: "Deine 'Freunde' kommen nicht dichter als 20 Meter ...
  // Sie können dir nicht helfen, dich hintergehen, oder beliebige Karten für
  // oder gegen dich verwenden - außer Wandernde Monster und
  // Monsterverstärker." Bewusst NICHT in MONSTER_FORBIDS_HELP: das Set sperrt
  // nur die Hilfe, hier ist alles gesperrt ausser zwei Ausnahmen. Umgesetzt
  // als weisse Liste in stinktierSperre/handlePlayCombatCard (server.js) -
  // gesperrt ist, wer nicht selbst kaempft.
  const MONSTER_LOCKS_OTHERS = new Set(['RIESENSTINKTIER']);
```

Im `return`-Block (Zeile ~602) `MONSTER_LOCKS_OTHERS` neben `MONSTER_FORBIDS_HELP` ergänzen.

- [ ] **Step 4: Read the table in server.js**

In `server.js` im `ctx`-Destructuring der passives (Zeile ~2621) `MONSTER_LOCKS_OTHERS` neben `MONSTER_FORBIDS_HELP` aufnehmen.

- [ ] **Step 5: Add the gate function**

In `server.js` direkt unter `kartenSperreAktiv` (~2249) einfügen:

```js
// RIESENSTINKTIER: gesperrt ist, wer NICHT selbst kaempft. Der Kartentext
// richtet sich an "deine Freunde" ("SIE können dir nicht helfen, dich
// hintergehen, oder ..."), nicht an die kaempfende Person - die spielt ihre
// eigenen Waffen und Traenke weiter. Eine Helfer:in kann es nicht geben, weil
// schon die Anfrage gesperrt ist.
function stinktierSperre(room, playerId) {
  if (!room.combat || !combatHasMonster(room, MONSTER_LOCKS_OTHERS)) return false;
  return !combatParticipants(room).some((p) => p.id === playerId);
}
```

- [ ] **Step 6: Gate the three simple paths**

`handleRequestHelp` (server.js:4176) — direkt **vor** dem bestehenden `MONSTER_FORBIDS_HELP`-Block:

```js
  if (stinktierSperre(room, targetId)) {
    log(room, 'Das Riesenstinktier haelt alle anderen auf 20 Meter Abstand - niemand hilft.');
    touchRoom(room);
    return;
  }
```

`handleThiefBackstab` (server.js, direkt nach `if (dieb.id === opfer.id) return;`):

```js
  if (stinktierSperre(room, playerId)) {
    log(room, `${dieb.name} kommt am Riesenstinktier nicht vorbei - kein Rueckenfall.`);
    touchRoom(room);
    return;
  }
```

`handlePlayCurseFromHand` (server.js:997) — direkt **nach** dem bestehenden `kartenSperreAktiv`-Block:

```js
  if (stinktierSperre(room, playerId) && combatParticipants(room).some((p) => p.id === targetId)) {
    log(room, `${player.name} kommt am Riesenstinktier nicht vorbei - kein Fluch gegen ${target.name}.`);
    touchRoom(room);
    return;
  }
```

- [ ] **Step 7: Gate `handlePlayCombatCard` with the whitelist**

In `handlePlayCombatCard` direkt **nach** dem `gesperrtGegen`-Block und **vor** `const c = card(cardId);` — die Reihenfolge ist wichtig, sonst greift die Sperre für KUMPEL und ÜBERFALLTRANK zu spät, weil `COMBAT_REACTION_CARDS` vorher abzweigt:

```js
  // RIESENSTINKTIER, weisse Liste: erlaubt sind genau die zwei Ausnahmen, die
  // der Kartentext nennt. Alles andere ist gesperrt - ausdruecklich auch
  // KUMPEL, ILLUSION, HILF MIR und ÜBERFALLTRANK: es sind Karten, die "fuer
  // oder gegen dich" wirken, und die Karte nimmt sie nicht aus.
  if (stinktierSperre(room, playerId)) {
    const stinktierKarte = card(cardId);
    const erlaubt = stinktierKarte
      && (stinktierKarte.name === 'WANDERNDES MONSTER' || isMonsterEnhancerCard(stinktierKarte));
    if (!erlaubt) {
      log(room, `${player.name} kommt am Riesenstinktier nicht vorbei - nur Wandernde Monster und Monsterverstaerker gehen durch.`);
      touchRoom(room);
      return;
    }
  }
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: `card-unnatural-monsters: ok`

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: `27/27 Tests erfolgreich.`

- [ ] **Step 10: Commit**

```bash
git add src/cards/passives.js server.js tests/card-unnatural-monsters.test.js
git commit -m "Riesenstinktier: niemand ausser der kaempfenden Person greift ein

Weisse Liste statt Aufzaehlung gesperrter Pfade: gesperrt ist alles,
erlaubt sind genau die zwei Ausnahmen, die der Kartentext nennt
(Wanderndes Monster, Monsterverstaerker). Gesperrt ist dabei, wer NICHT
selbst kaempft - der Text richtet sich an 'deine Freunde', die
kaempfende Person spielt ihre eigenen Karten weiter.

Die Bauform ist die der Einstweiligen Verfuegung (kartenSperreAktiv),
nur mit anderem Ausloeser."
```

---

### Task 3: RIESENSTINKTIER — die Schlimmen Dinge

**Files:**
- Modify: `src/cards/consequences.js` (neuer Override, Sammelkommentar kürzen)
- Modify: `server.js` — `stinktierStrafeAktiv` neben `stinktierSperre`, Gate in `handleRequestHelp`, Halbierung in `handleSellItems` (5033)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `applyLingeringRule`, `clearActiveCurseByKind` (Task 1); `stinktierSperre` (Task 2)
- Produces: `stinktierStrafeAktiv(player)` → `boolean`; `kind: 'noHelpHalfGold'`

- [ ] **Step 1: Write the failing test**

```js
// --- RIESENSTINKTIER, Schlimme Dinge ----------------------------------------
// "Besprüht! Niemand wird dir im Kampf helfen, bevor du nicht alle getragene
// Kleidung und Rüstung ablegst. Der Goldwert ist halbiert."
{
  const { resolveConsequenceSpec, applyPrimitiveAction, handleSellItems,
    handleUnequipItem, handleRequestHelp } = require('../server.js');
  const stinktier = findCard('RIESENSTINKTIER', 'monster');
  // Eine Ruestung und ein Gegenstand von zusammen mindestens 2000 GS, damit
  // die Halbierung den Stufenaufstieg messbar von 2 auf 1 drueckt.
  const ruestung = ALL_CARDS.find((c) => c.slotKind === 'armor' && (c.gold || 0) > 0);
  const teuer = ALL_CARDS.filter((c) => c.category === 'item' && (c.gold || 0) >= 600)
    .sort((a, b) => b.gold - a.gold)[0];
  assert.ok(ruestung && teuer, 'Testvoraussetzung: Ruestung und teurer Gegenstand vorhanden');

  function besprueht() {
    const p = makePlayer({ level: 3 });
    const room = makeRoom([p]);
    p.equipped.armor = ruestung.id;
    const spec = resolveConsequenceSpec(stinktier.name, stinktier.badstuff, p, room);
    assert.ok(spec, 'das Stinktier hat jetzt eine kuratierte Konsequenz');
    applyPrimitiveAction(room, p, spec);
    return { p, room };
  }

  // 1. Die Strafe steht im Tracker.
  {
    const { p } = besprueht();
    assert.ok(p.activeCurses.some((f) => f.kind === 'noHelpHalfGold'),
      'nach dem Besprühen steht die Strafe im Tracker');
  }
  // 2. Niemand hilft.
  {
    const { p, room } = besprueht();
    const helfer = makePlayer({ id: 'p2', name: 'B' });
    room.players.push(helfer);
    room.combat = { actorId: p.id, helperId: null, monsterIds: [findCard('PESTRATTEN', 'monster').id],
      actorModifier: 0, monsterModifier: 0, backstabs: {}, mustFlee: false };
    handleRequestHelp(room, p.id, helfer.id, 0);
    assert.ok(!room.combat.helperPending, 'wer besprueht ist, bekommt keine Hilfe');
  }
  // 3. Halber Goldwert: 2 Stufen werden zu 1.
  {
    const { p, room } = besprueht();
    room.turnPhase = 'kampf';
    room.combat = null;
    room.turnIndex = 0;
    p.hand.push(teuer.id);
    const gesamt = (ruestung.gold || 0) + (teuer.gold || 0);
    const vorher = p.level;
    handleSellItems(room, p.id, [ruestung.id, teuer.id]);
    const erwartet = Math.floor(Math.floor(gesamt / 2) / 1000);
    assert.strictEqual(p.level - vorher, erwartet,
      `halbierter Goldwert: ${gesamt} GS bringen nur ${erwartet} Stufe(n)`);
    assert.ok(erwartet < Math.floor(gesamt / 1000),
      'Gegenprobe: ohne Halbierung waeren es mehr Stufen gewesen');
  }
  // 4. Die Strafe endet, sobald keine Kleidung/Ruestung mehr anliegt.
  {
    const { p, room } = besprueht();
    room.turnPhase = 'kampf';
    room.combat = null;
    handleUnequipItem(room, p.id, ruestung.id);
    assert.ok(!p.activeCurses.some((f) => f.kind === 'noHelpHalfGold'),
      'nach dem Ablegen der letzten Ruestung ist die Strafe weg');
  }
  // 5. Hand-Gegenstaende zaehlen NICHT als Kleidung - eine Waffe allein
  //    beendet die Strafe nicht.
  {
    const p = makePlayer({ level: 3 });
    const room = makeRoom([p]);
    const waffe = ALL_CARDS.find((c) => c.slotKind === 'hand' && c.handsCost === 1);
    p.equipped.hands = [waffe.id, null];
    const spec = resolveConsequenceSpec(stinktier.name, stinktier.badstuff, p, room);
    applyPrimitiveAction(room, p, spec);
    assert.ok(p.activeCurses.some((f) => f.kind === 'noHelpHalfGold'),
      'eine Waffe ist keine Kleidung - die Strafe bleibt');
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL mit `das Stinktier hat jetzt eine kuratierte Konsequenz`

- [ ] **Step 3: Add the consequence override**

In `src/cards/consequences.js` in `CONSEQUENCE_OVERRIDES` einfügen (alphabetisch bei den anderen Unnatural-Axe-Einträgen):

```js
    // "Besprüht! Niemand wird dir im Kampf helfen, bevor du nicht alle
    // getragene Kleidung und Rüstung ablegst. Der Goldwert ist halbiert."
    // Beide Wirkungen haengen an EINEM Tracker-Eintrag, weil sie dieselbe
    // Löschbedingung teilen (siehe stinktierStrafeAktiv in server.js).
    'RIESENSTINKTIER': () => ({
      type: 'lingeringCurse', name: 'RIESENSTINKTIER', kind: 'noHelpHalfGold',
      dauer: 'dauerhaft',
      hinweis: 'Besprüht: niemand hilft dir, und dein Goldwert ist halbiert - bis du alle Kleidung und Rüstung abgelegt hast.',
    }),
```

- [ ] **Step 4: Add the read-and-clear helper**

In `server.js` direkt unter `stinktierSperre` einfügen:

```js
// Kleidung und Ruestung im Sinne des Stinktiers: Kopf, Ruestung, Schuhe.
// Hand-Gegenstaende (Waffen, Schilde) sind keine Kleidung.
const KLEIDUNG_SLOTS = ['head', 'armor', 'feet'];

// "... bevor du nicht alle getragene Kleidung und Rüstung ablegst."
// ponytail: geprueft beim LESEN, nicht aufgeraeumt an jeder Stelle, an der
// Ausruestung verschwinden kann (Ablegen, Verkaufen, Fluch, Schlimme Dinge) -
// eine Pruefstelle statt fuenf, und sie kann nicht vergessen werden, wenn
// spaeter ein sechster Weg dazukommt.
function stinktierStrafeAktiv(player) {
  if (!player || !(player.activeCurses || []).some((f) => f.kind === 'noHelpHalfGold')) return false;
  if (KLEIDUNG_SLOTS.some((s) => player.equipped[s])) return true;
  clearActiveCurseByKind(player, 'noHelpHalfGold');
  return false;
}
```

- [ ] **Step 5: Gate the help request**

In `handleRequestHelp`, direkt nach dem `stinktierSperre`-Block aus Task 2:

```js
  if (stinktierStrafeAktiv(actor)) {
    log(room, `${actor.name} stinkt noch aus dem Riesenstinktier-Kampf - niemand hilft, solange Kleidung und Ruestung anliegen.`);
    touchRoom(room);
    return;
  }
```

- [ ] **Step 6: Halve the gold**

In `handleSellItems`, direkt **vor** `if (total < 1000) return;`:

```js
  // RIESENSTINKTIER: "Der Goldwert ist halbiert." Halbiert wird die Endsumme
  // (nach Alchemisten-Mindestwert und Halbling-Bonus), nicht der einzelne
  // Gegenstand: der Kartentext nennt eine Eigenschaft der Person, keine der
  // Gegenstaende - und die Endsumme ist ohnehin die Stelle, an der gerundet
  // wird.
  if (stinktierStrafeAktiv(player)) {
    const voll = total;
    total = Math.floor(total / 2);
    log(room, `${player.name} stinkt noch - der Goldwert ist halbiert: ${voll} GS zaehlen nur ${total} GS.`);
  }
```

Dafür muss `total` als `let` deklariert sein — ist es (server.js:5045).

- [ ] **Step 7: Shorten the collected comment**

In `src/cards/consequences.js` im Sammelkommentar (Zeile ~20-42) den RIESENSTINKTIER-Absatz entfernen — er beschreibt jetzt umgesetzten Code. LUSTMONSTER und WEIHNACHTSMANN bleiben vorerst stehen (Tasks 5 und 6).

- [ ] **Step 8: Run the tests**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: `card-unnatural-monsters: ok`, danach `27/27 Tests erfolgreich.`

- [ ] **Step 9: Commit**

```bash
git add src/cards/consequences.js server.js tests/card-unnatural-monsters.test.js
git commit -m "Besprueht: keine Hilfe und halber Goldwert, bis die Kleidung faellt

Beide Wirkungen haengen an einem Tracker-Eintrag, weil sie dieselbe
Loeschbedingung teilen. Die Bedingung wird beim Lesen geprueft statt an
jeder Stelle aufgeraeumt, an der Ausruestung verschwinden kann - eine
Pruefstelle statt fuenf.

Halbiert wird die Endsumme beim Verkaufen, nach Alchemisten-Mindestwert
und Halbling-Bonus: der Kartentext nennt eine Eigenschaft der Person,
keine der einzelnen Gegenstaende."
```

---

### Task 4: LUSTMONSTER — Hilfe-Pflicht und Flucht-Zwang

**Files:**
- Modify: `src/cards/passives.js` (Tabelle + Export, ersetzt den `ponytail:`-Block ab Zeile 439)
- Modify: `server.js` — `passendeHilfe` neben `combatHasMonster` (~2612), Gate in `handleRespondHelp` (4195), Zweig in `resolveCombat` (~4303)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: nichts
- Produces: `passendeHilfe(room)` → `boolean`; `MONSTER_REQUIRES_OTHER_GENDER` (Set)

- [ ] **Step 1: Write the failing test**

```js
// --- LUSTMONSTER, Kampftext -------------------------------------------------
// "Du musst dir von einem Charakter des anderen Geschlechts helfen lassen ...
// Findest du keinen passenden Charakter, musst du leider flüchten."
{
  const { handleRespondHelp, resolveCombat } = require('../server.js');
  const lust = findCard('LUSTMONSTER', 'monster');

  function lustKampf(helferGender) {
    const kaempfer = makePlayer({ id: 'p1', name: 'A', gender: 'm', level: 9 });
    const helfer = makePlayer({ id: 'p2', name: 'B', gender: helferGender, level: 9 });
    const room = makeRoom([kaempfer, helfer]);
    room.combat = { actorId: 'p1', helperId: null, monsterIds: [lust.id],
      actorModifier: 0, monsterModifier: 0, backstabs: {}, mustFlee: false,
      helperPending: { targetId: 'p2', compelled: false, reward: 0 } };
    return { room, kaempfer, helfer };
  }

  // 1. Gleiches Geschlecht: die Hilfe kommt nicht zustande.
  {
    const { room } = lustKampf('m');
    handleRespondHelp(room, 'p2', true);
    assert.strictEqual(room.combat.helperId, null,
      'das Lustmonster verlangt das andere Geschlecht - gleiches zaehlt nicht');
  }
  // 2. Anderes Geschlecht: die Hilfe kommt zustande. (Gegenprobe zu 1 - ohne
  //    sie wuerde Fall 1 auch gruen sein, wenn handleRespondHelp gar nichts
  //    mehr taete.)
  {
    const { room } = lustKampf('w');
    handleRespondHelp(room, 'p2', true);
    assert.strictEqual(room.combat.helperId, 'p2', 'das andere Geschlecht darf helfen');
  }
  // 3. Geschlechtslos (STRICHMÄNNCHEN) ist fuer eine Regel, die ein
  //    Geschlecht NENNT, keins von beiden.
  {
    const { room } = lustKampf(null);
    handleRespondHelp(room, 'p2', true);
    assert.strictEqual(room.combat.helperId, null,
      'geschlechtslos erfuellt "anderes Geschlecht" nicht');
  }
  // 4. Ohne passende Hilfe ist der Kampf verloren - auch bei erdrueckender
  //    Uebermacht.
  {
    const kaempfer = makePlayer({ id: 'p1', name: 'A', gender: 'm', level: 99 });
    const room = makeRoom([kaempfer]);
    room.combat = { actorId: 'p1', helperId: null, monsterIds: [lust.id],
      actorModifier: 0, monsterModifier: 0, backstabs: {}, mustFlee: false };
    resolveCombat(room);
    assert.strictEqual(room.combat && room.combat.mustFlee, true,
      'ohne passende Hilfe hilft auch Stufe 99 nicht - fliehen');
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL bei Fall 1 — `das Lustmonster verlangt das andere Geschlecht`

- [ ] **Step 3: Add the table**

In `src/cards/passives.js` den `ponytail:`-Block zu LUSTMONSTER (ab Zeile ~439, beginnend `// ponytail: LUSTMONSTER ebenfalls nicht hier verdrahtet.`) **ersetzen** durch:

```js
  // LUSTMONSTER: "Du musst dir von einem Charakter des anderen Geschlechts
  // helfen lassen ... sonst kannst du das Lustmonster nicht besiegen. Findest
  // du keinen passenden Charakter, musst du leider flüchten." Bewusst NICHT
  // in FLEE_AUTOMATIC: das Set laesst eine Flucht GELINGEN, hier geht es
  // darum, dass der Kampf nicht GEWONNEN werden kann (siehe resolveCombat).
  const MONSTER_REQUIRES_OTHER_GENDER = new Set(['LUSTMONSTER']);
```

Im `return`-Block `MONSTER_REQUIRES_OTHER_GENDER` ergänzen, und in `server.js` im `ctx`-Destructuring der passives aufnehmen.

- [ ] **Step 4: Add `passendeHilfe`**

In `server.js` direkt unter `combatHasMonster` (~2614):

```js
// LUSTMONSTER: "ein Charakter des anderen Geschlechts". istGeschlecht liefert
// fuer das geschlechtslose STRICHMÄNNCHEN ueberall false - fuer eine Regel,
// die ein Geschlecht NENNT, ist es keins von beiden, und zwar auf beiden
// Seiten der Bedingung.
function passendeHilfe(room) {
  const c = room.combat;
  if (!c || !c.helperId) return false;
  const actor = findPlayer(room, c.actorId);
  const helfer = findPlayer(room, c.helperId);
  return istAnderesGeschlecht(actor, helfer);
}

function istAnderesGeschlecht(a, b) {
  if (!a || !b || !a.gender || !b.gender) return false;
  return (istGeschlecht(a, 'm') && istGeschlecht(b, 'w'))
    || (istGeschlecht(a, 'w') && istGeschlecht(b, 'm'));
}
```

- [ ] **Step 5: Gate `handleRespondHelp`**

In `handleRespondHelp`, im `if (accept) {`-Zweig als erste Prüfung **vor** `c.helperId = playerId;`:

```js
    // LUSTMONSTER: die Zusage kommt nicht zustande, wenn das Geschlecht nicht
    // passt. Bewusst hier und nicht in handleRequestHelp: das Fragen bleibt
    // erlaubt, nur das Zustandekommen nicht - so sieht der Tisch im Verlauf,
    // dass es versucht wurde.
    if (combatHasMonster(room, MONSTER_REQUIRES_OTHER_GENDER)
      && !istAnderesGeschlecht(findPlayer(room, c.actorId), target)) {
      log(room, `${target.name} kann hier nicht helfen - das Lustmonster verlangt einen Charakter des anderen Geschlechts.`);
      c.helperPending = null;
      touchRoom(room);
      return;
    }
```

- [ ] **Step 6: Force the flight in `resolveCombat`**

In `resolveCombat`, direkt **vor** `const tie = playerStrength === monsterStrength ? findTieBreaker(room) : null;`:

```js
  // LUSTMONSTER: "sonst kannst du das Lustmonster nicht besiegen". Ohne
  // passende Hilfe ist der Kampf unabhaengig von der Kampfstaerke verloren -
  // deshalb VOR dem Staerkevergleich.
  const lustOhneHilfe = combatHasMonster(room, MONSTER_REQUIRES_OTHER_GENDER) && !passendeHilfe(room);
```

Und die anschließende Verzweigung von

```js
  if (playerStrength > monsterStrength || tie) {
```

ändern zu

```js
  if (!lustOhneHilfe && (playerStrength > monsterStrength || tie)) {
```

Im `else`-Zweig die Logzeile um die Begründung ergänzen: statt der bestehenden Zeile

```js
    log(room, `Kampfstärke reicht nicht (${playerStrength} vs. ${monsterStrength}). Fliehen nötig!${wer}`);
```

schreiben:

```js
    log(room, lustOhneHilfe
      ? `Ohne Hilfe eines Charakters des anderen Geschlechts ist das Lustmonster nicht zu besiegen. Fliehen nötig!${wer}`
      : `Kampfstärke reicht nicht (${playerStrength} vs. ${monsterStrength}). Fliehen nötig!${wer}`);
```

Der restliche `else`-Zweig (`c.mustFlee = true`, `c.fleeQueue`, `c.fleeingId`, `c.fleeFailed`) bleibt unverändert — es entsteht kein zweiter Fluchtweg.

- [ ] **Step 7: Export `resolveCombat` if needed**

Prüfen, ob `resolveCombat` schon im `module.exports` von `server.js` steht. Falls nicht, ergänzen — der Test ruft es direkt.

Run: `node -e "console.log(typeof require('./server.js').resolveCombat)"`
Expected: `function` (sonst Export ergänzen und erneut prüfen)

- [ ] **Step 8: Run the tests**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: `card-unnatural-monsters: ok`, danach `27/27 Tests erfolgreich.`

- [ ] **Step 9: Commit**

```bash
git add src/cards/passives.js server.js tests/card-unnatural-monsters.test.js
git commit -m "Lustmonster: Hilfe des anderen Geschlechts oder Flucht

Die Zusage wird in handleRespondHelp abgewiesen, nicht schon die
Anfrage - so sieht der Tisch im Verlauf, dass es versucht wurde. Der
Flucht-Zwang steht vor dem Staerkevergleich in resolveCombat, weil der
Kampf ohne passende Hilfe unabhaengig von der Kampfstaerke verloren ist;
die Flucht selbst laeuft ueber den bestehenden Pfad.

Bewusst nicht ueber FLEE_AUTOMATIC: das Set laesst eine Flucht gelingen,
hier geht es darum, dass der Kampf nicht gewonnen werden kann. Das
geschlechtslose Strichmaennchen erfuellt die Bedingung nie."
```

---

### Task 5: LUSTMONSTER — die Schlimmen Dinge

**Files:**
- Modify: `src/cards/consequences.js` (Override + Sammelkommentar kürzen)
- Modify: `server.js` — `curseHidesHandItems` neben `curseSuppressesItemBonuses` (~2711), `excludeIds` in `combatTotals` (3499)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `applyLingeringRule` (Task 1)
- Produces: `curseHidesHandItems(player)` → `boolean`; `kind: 'noHandItemBonus'`

- [ ] **Step 1: Write the failing test**

```js
// --- LUSTMONSTER, Schlimme Dinge --------------------------------------------
// "Verliere eine Stufe … in deinem nächsten Kampf werden deine
// Hand-Gegenstände nutzlos."
{
  const { resolveConsequenceSpec, applyPrimitiveAction, combatTotals } = require('../server.js');
  const lust = findCard('LUSTMONSTER', 'monster');
  const waffe = ALL_CARDS.find((c) => c.slotKind === 'hand' && c.handsCost === 1 && (c.bonus || 0) > 0);
  assert.ok(waffe, 'Testvoraussetzung: einhaendige Waffe mit Bonus vorhanden');

  function mitWaffe() {
    const p = makePlayer({ level: 5 });
    const room = makeRoom([p]);
    p.equipped.hands = [waffe.id, null];
    room.combat = { actorId: p.id, helperId: null, monsterIds: [findCard('PESTRATTEN', 'monster').id],
      actorModifier: 0, monsterModifier: 0, backstabs: {}, mustFlee: false };
    return { p, room };
  }

  // 1. Stufenverlust und Tracker-Eintrag.
  {
    const p = makePlayer({ level: 5 });
    const room = makeRoom([p]);
    const spec = resolveConsequenceSpec(lust.name, lust.badstuff, p, room);
    assert.ok(spec, 'das Lustmonster hat jetzt eine kuratierte Konsequenz');
    applyPrimitiveAction(room, p, spec);
    assert.strictEqual(p.level, 4, 'eine Stufe weniger (levelDelta zieht ab)');
    assert.ok(p.activeCurses.some((f) => f.kind === 'noHandItemBonus'),
      'und die anhaltende Wirkung steht im Tracker');
    assert.strictEqual(p.activeCurses[0].dauer, 'naechsterKampf',
      'sie gilt genau fuer den naechsten Kampf');
  }
  // 2. Differenzmessung: derselbe Kampf mit und ohne den Eintrag.
  {
    const ohne = mitWaffe();
    const basis = combatTotals(ohne.room).playerStrength;
    const mit = mitWaffe();
    mit.p.activeCurses.push({ cardId: null, name: 'LUSTMONSTER', kind: 'noHandItemBonus',
      amount: 0, dauer: 'naechsterKampf', hinweis: '' });
    const gemindert = combatTotals(mit.room).playerStrength;
    assert.strictEqual(basis - gemindert, waffe.bonus,
      `die Hand-Waffe (+${waffe.bonus}) zaehlt mit der Wirkung nicht mehr`);
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL mit `das Lustmonster hat jetzt eine kuratierte Konsequenz`

- [ ] **Step 3: Add the consequence override**

In `src/cards/consequences.js`:

```js
    // "Verliere eine Stufe … in deinem nächsten Kampf werden deine
    // Hand-Gegenstände nutzlos." levelDelta ZIEHT AB - amount: 1 ist der
    // Stufenverlust.
    'LUSTMONSTER': () => ({ type: 'combo', actions: [
      { type: 'levelDelta', amount: 1 },
      { type: 'lingeringCurse', name: 'LUSTMONSTER', kind: 'noHandItemBonus',
        dauer: 'naechsterKampf',
        hinweis: 'Im nächsten Kampf zählen deine Hand-Gegenstände nicht.' },
    ] }),
```

- [ ] **Step 4: Add the read helper**

In `server.js` direkt unter `curseSuppressesItemBonuses` (~2713):

```js
// LUSTMONSTER: "in deinem naechsten Kampf werden deine Hand-Gegenstaende
// nutzlos" - dieselbe Ausblendung, die MONDJUNGFERN im Kampf macht, nur an
// der Person statt am Monster.
function curseHidesHandItems(player) {
  return (player.activeCurses || []).some((f) => f.kind === 'noHandItemBonus');
}
```

- [ ] **Step 5: Read it in `combatTotals`**

In `combatTotals` die Zeile

```js
      const excludeIds = ignoreWeapons ? handItemIds(p) : null;
```

ersetzen durch

```js
      // ignoreWeapons haengt am Monster und gilt fuer beide Seiten gleich,
      // curseHidesHandItems an der Person - deshalb steht der Ausdruck hier
      // in der sides-Schleife, wo p bekannt ist.
      const excludeIds = (ignoreWeapons || curseHidesHandItems(p)) ? handItemIds(p) : null;
```

Damit erbt die Regel die Feinheiten, die der MONDJUNGFERN-Kommentar direkt darüber aufzählt: Kartenanhänge an der Waffe, konditionale und rassenabhängige Item-Boni fallen mit weg.

- [ ] **Step 6: Shorten the collected comment**

In `src/cards/consequences.js` den LUSTMONSTER-Absatz aus dem Sammelkommentar entfernen.

- [ ] **Step 7: Run the tests**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: `card-unnatural-monsters: ok`, danach `27/27 Tests erfolgreich.`

- [ ] **Step 8: Commit**

```bash
git add src/cards/consequences.js server.js tests/card-unnatural-monsters.test.js
git commit -m "Lustmonster-Strafe: Hand-Gegenstaende im naechsten Kampf nutzlos

Nutzt den excludeIds-Pfad, den MONDJUNGFERN schon gebaut hat - damit
fallen Kartenanhaenge an der Waffe sowie konditionale und
rassenabhaengige Item-Boni automatisch mit weg, statt hinterher als
zweite Summe abgezogen zu werden. Der Ausdruck steht in der
sides-Schleife, weil die Wirkung an der Person haengt und nicht wie bei
den Mondjungfern am Monster."
```

---

### Task 6: WEIHNACHTSMANN — keine Schätze bis zum Alleingang

**Files:**
- Modify: `src/cards/consequences.js` (Override + Sammelkommentar-Rest entfernen)
- Modify: `server.js` — `hatSchatzSperre` neben `curseHidesHandItems`, Löschung und Sperre in `resolveCombatWin` (4324), Filter in `finishTrade` (5293)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `applyLingeringRule`, `clearActiveCurseByKind` (Task 1)
- Produces: `hatSchatzSperre(player)` → `boolean`; `kind: 'noTreasure'`

- [ ] **Step 1: Write the failing test**

```js
// --- WEIHNACHTSMANN, Schlimme Dinge -----------------------------------------
// "Du kommst auf die Störerliste. Du erhältst keine Schatzkarten … auch nicht
// von anderen Spielern … bis du ein Monster ohne Hilfe tötest."
{
  const { resolveConsequenceSpec, applyPrimitiveAction, resolveCombatWin } = require('../server.js');
  const mann = findCard('WEIHNACHTSMANN', 'monster');
  const ratte = findCard('PESTRATTEN', 'monster');
  const schaetze = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 8).map((c) => c.id);

  function aufDerListe(extra) {
    const p = makePlayer(Object.assign({ level: 5 }, extra || {}));
    const room = makeRoom([p]);
    const spec = resolveConsequenceSpec(mann.name, mann.badstuff, p, room);
    assert.ok(spec, 'der Weihnachtsmann hat jetzt eine kuratierte Konsequenz');
    applyPrimitiveAction(room, p, spec);
    room.treasureDeck = schaetze.slice();
    return { p, room };
  }

  // 1. Sieg MIT Hilfe: kein Schatz, und die Sperre bleibt stehen.
  {
    const { p, room } = aufDerListe();
    const helfer = makePlayer({ id: 'p2', name: 'B' });
    room.players.push(helfer);
    room.combat = { actorId: p.id, helperId: helfer.id, monsterIds: [ratte.id],
      actorModifier: 0, monsterModifier: 0, backstabs: {}, helperReward: 0, mustFlee: false };
    resolveCombatWin(room);
    assert.strictEqual(p.hand.length, 0, 'auf der Stoererliste gibt es keinen Schatz');
    assert.ok(p.activeCurses.some((f) => f.kind === 'noTreasure'),
      'ein Sieg mit Hilfe loest die Sperre nicht');
  }
  // 2. Sieg OHNE Hilfe: die Sperre faellt, und der befreiende Kampf zahlt
  //    schon aus.
  {
    const { p, room } = aufDerListe();
    room.combat = { actorId: p.id, helperId: null, monsterIds: [ratte.id],
      actorModifier: 0, monsterModifier: 0, backstabs: {}, helperReward: 0, mustFlee: false };
    resolveCombatWin(room);
    assert.ok(!p.activeCurses.some((f) => f.kind === 'noTreasure'),
      'ein Monster ohne Hilfe getoetet - die Sperre ist weg');
    assert.strictEqual(p.hand.length, ratte.treasureCount,
      'und der befreiende Kampf zahlt schon aus');
  }
  // 3. Gegenprobe: ohne Sperre zahlt derselbe Kampf mit Hilfe normal aus.
  {
    const p = makePlayer({ level: 5 });
    const helfer = makePlayer({ id: 'p2', name: 'B' });
    const room = makeRoom([p, helfer]);
    room.treasureDeck = schaetze.slice();
    room.combat = { actorId: p.id, helperId: helfer.id, monsterIds: [ratte.id],
      actorModifier: 0, monsterModifier: 0, backstabs: {}, helperReward: 0, mustFlee: false };
    resolveCombatWin(room);
    assert.strictEqual(p.hand.length, ratte.treasureCount,
      'ohne Sperre gibt es die Schaetze wie immer');
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL mit `der Weihnachtsmann hat jetzt eine kuratierte Konsequenz`

- [ ] **Step 3: Add the consequence override**

```js
    // "Du kommst auf die Störerliste. Du erhältst keine Schatzkarten … auch
    // nicht von anderen Spielern … bis du ein Monster ohne Hilfe tötest."
    'WEIHNACHTSMANN': () => ({
      type: 'lingeringCurse', name: 'WEIHNACHTSMANN', kind: 'noTreasure',
      dauer: 'dauerhaft',
      hinweis: 'Störerliste: keine Schatzkarten (auch nicht von anderen), bis du ein Monster ohne Hilfe tötest.',
    }),
```

- [ ] **Step 4: Add the read helper**

In `server.js` unter `curseHidesHandItems`:

```js
// WEIHNACHTSMANN: "Du erhaeltst keine Schatzkarten ... auch nicht von anderen
// Spielern." Betroffene Karten werden gar nicht erst GEZOGEN statt gezogen
// und weggeworfen - der Text sagt "du erhaeltst keine", der Stapel soll
// dadurch nicht schrumpfen.
function hatSchatzSperre(player) {
  return !!player && (player.activeCurses || []).some((f) => f.kind === 'noTreasure');
}
```

- [ ] **Step 5: Clear and block in `resolveCombatWin`**

In `resolveCombatWin` direkt nach `const helper = c.helperId ? findPlayer(room, c.helperId) : null;`:

```js
  // "... bis du ein Monster ohne Hilfe tötest." Die Loeschung steht VOR der
  // Schatzvergabe: wer die Strafe mit einem hilfsfreien Sieg abschuettelt,
  // bekommt den Schatz dieses Kampfes schon wieder. Das ist die
  // spielerfreundliche Lesart und erspart die Erklaerung, warum ausgerechnet
  // der befreiende Sieg leer ausgeht.
  if (!c.helperId && clearActiveCurseByKind(actor, 'noTreasure')) {
    log(room, `${actor.name} hat ein Monster ohne Hilfe getoetet und ist von der Stoererliste runter.`);
  }
```

Dann die drei Stellen, an denen Schätze tatsächlich übergeben werden, durch die Sperre führen. Die Piñata-Schleife (server.js:4351-4360): vor `const t = drawTreasure(room);` einfügen

```js
      if (hatSchatzSperre(p)) return;
```

Und bei der Hauptvergabe die Ziehschleife

```js
  for (let i = 0; i < treasureCount; i++) { const t = drawTreasure(room); if (t) drawn.push(t); }
```

ersetzen durch

```js
  // Gezogen wird nur, was auch ankommt. Steht die kaempfende Person auf der
  // Stoererliste und gibt es keine Helfer:in, die den zugesagten Teil
  // bekaeme, bleibt der Stapel unberuehrt.
  const maxEmpfang = hatSchatzSperre(actor)
    ? (helper && !hatSchatzSperre(helper) ? Math.min(treasureCount, c.helperReward || 0) : 0)
    : treasureCount;
  for (let i = 0; i < maxEmpfang; i++) { const t = drawTreasure(room); if (t) drawn.push(t); }
```

Danach greift die bestehende Aufteilung (`zusage`/`fuerHelfer`/`fuerActor`) unverändert: steht die kämpfende Person auf der Liste, sind nur noch die zugesagten Karten gezogen, `drawn.slice(zusage)` ist leer, und `fuerActor` bleibt leer. Zusätzlich vor `fuerHelfer.forEach` absichern:

```js
  if (helper && hatSchatzSperre(helper)) fuerHelfer.length = 0;
```

- [ ] **Step 6: Filter the trade**

In `finishTrade` die beiden `forEach`-Zeilen ersetzen durch:

```js
  // WEIHNACHTSMANN: "auch nicht von anderen Spielern". Schatzkarten, die an
  // eine gesperrte Person gingen, bleiben schlicht bei der gebenden Person -
  // der Handel kommt sonst normal zustande.
  const ohneGesperrteSchaetze = (ids, empfaenger) => (hatSchatzSperre(empfaenger)
    ? ids.filter((id) => (card(id) || {}).type !== 'treasure') : ids);
  const anEmpfaenger = ohneGesperrteSchaetze(offerIds, to);
  const anGeber = ohneGesperrteSchaetze(counterIds, from);
  anEmpfaenger.forEach((id) => { takeTradedCard(from, id); clearCheatIfLost(from, id); to.hand.push(id); });
  anGeber.forEach((id) => { takeTradedCard(to, id); clearCheatIfLost(to, id); from.hand.push(id); });
```

Und in den beiden Log-Textzeilen darunter `offerIds` durch `anEmpfaenger` und `counterIds` durch `anGeber` ersetzen, damit der Verlauf nicht behauptet, etwas sei übergeben worden, das liegen blieb.

- [ ] **Step 7: Remove the rest of the collected comment**

In `src/cards/consequences.js` den WEIHNACHTSMANN-Absatz und damit den gesamten Sammelkommentar-Block zu Welle 3 (Zeilen ~20-42) entfernen — alle drei Karten sind jetzt verdrahtet.

- [ ] **Step 8: Run the tests**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: `card-unnatural-monsters: ok`, danach `27/27 Tests erfolgreich.` — insbesondere `trade.test.js` muss grün bleiben.

- [ ] **Step 9: Commit**

```bash
git add src/cards/consequences.js server.js tests/card-unnatural-monsters.test.js
git commit -m "Stoererliste: keine Schaetze bis zum Alleingang

Betroffene Karten werden gar nicht erst gezogen statt gezogen und
weggeworfen - der Text sagt 'du erhaeltst keine', der Stapel soll
dadurch nicht schrumpfen. Der Handel filtert Schatzkarten an eine
gesperrte Person heraus und nennt im Verlauf nur, was wirklich den
Besitzer gewechselt hat.

Die Sperre faellt VOR der Schatzvergabe des befreienden Kampfes: wer
ein Monster ohne Hilfe toetet, bekommt dessen Schatz schon wieder."
```

---

### Task 7: EISKALTES HÄNDCHEN — Wunschring statt Kampf

**Files:**
- Modify: `src/cards/passives.js` — `hatWunschring` neben `hatStab`/`hatGegenstandAbGold` (~90-100), Eintrag in `COMBAT_START_OPTIONS` (ersetzt den `ponytail:`-Block am Tabellenende), Eintrag in `SPECIAL_SLOT_ITEMS`
- Modify: `server.js` — Primitiv `haendchenBesaenftigen` in `applyPrimitiveAction`, Bonus-Rückfall in `equippedBonusSum` (408)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: nichts
- Produces: Action-Spec `{ type: 'haendchenBesaenftigen', cardId }`; `hatWunschring(player)` → `boolean`

- [ ] **Step 1: Write the failing test**

```js
// --- EISKALTES HÄNDCHEN: Wunschring statt Kampf -----------------------------
// "Wenn du Eiskaltes Händchen einen Wunschring gibst, anstatt sie zu
// bekämpfen, wird sie deine kleine Freundin. Lege den Ring ab; behalte diese
// Karte und zähle die Hand als einen kleinen Gegenstand, der einen Bonus von
// +3 im Kampf gibt."
{
  const { handleDrawDoor, handleResolveCardChoice, applyPrimitiveAction,
    combatTotals, istGrosserGegenstand } = require('../server.js');
  const haendchen = findCard('EISKALTES HÄNDCHEN', 'monster');
  const ring = findCard('WUNSCHRING');

  // 1. Ohne Ring gibt es keine Wahl - es wird gekaempft wie bisher.
  {
    const p = makePlayer({});
    const room = makeRoom([p]);
    room.turnPhase = 'tuer';
    room.doorDeck = [haendchen.id];
    handleDrawDoor(room, p.id);
    assert.ok(!room.pendingCardAction, 'ohne Wunschring keine Wahl');
    assert.ok(room.combat, 'stattdessen der normale Kampf');
  }
  // 2. Mit Ring auf der Hand erscheint die Wahl.
  {
    const p = makePlayer({ hand: [ring.id] });
    const room = makeRoom([p]);
    room.turnPhase = 'tuer';
    room.doorDeck = [haendchen.id];
    handleDrawDoor(room, p.id);
    assert.ok(room.pendingCardAction, 'mit Wunschring gibt es die Wahl');
    assert.strictEqual(room.pendingCardAction.options.length, 2, 'kaempfen oder den Ring geben');
  }
  // 3. Nach der Zusage: kein Kampf, Ring weg, Karte angelegt, +3 im Kampf.
  {
    const p = makePlayer({ hand: [ring.id] });
    const room = makeRoom([p]);
    room.turnPhase = 'tuer';
    room.doorDeck = [haendchen.id];
    handleDrawDoor(room, p.id);
    const altOption = room.pendingCardAction.options.find((o) => o.id === 'alt');
    assert.ok(altOption, 'die Alternative steht zur Wahl');
    handleResolveCardChoice(room, p.id, altOption.id);
    assert.ok(!room.combat, 'es findet kein Kampf statt');
    assert.ok(!p.hand.includes(ring.id), 'der Ring ist abgegeben');
    assert.ok(room.treasureDiscard.includes(ring.id) || room.doorDiscard.includes(ring.id),
      'und liegt im Ablagestapel');
    assert.ok((p.equipped.special || []).includes(haendchen.id),
      'die Hand liegt als Spezialausruestung an');
    assert.ok(!istGrosserGegenstand(room, haendchen.id), 'sie ist ein KLEINER Gegenstand');

    // Der +3-Bonus zaehlt in einem spaeteren Kampf.
    const ohne = makePlayer({ id: 'p9', name: 'C', level: p.level });
    const raumOhne = makeRoom([ohne]);
    raumOhne.combat = { actorId: ohne.id, helperId: null,
      monsterIds: [findCard('PESTRATTEN', 'monster').id],
      actorModifier: 0, monsterModifier: 0, backstabs: {}, mustFlee: false };
    room.combat = { actorId: p.id, helperId: null,
      monsterIds: [findCard('PESTRATTEN', 'monster').id],
      actorModifier: 0, monsterModifier: 0, backstabs: {}, mustFlee: false };
    assert.strictEqual(combatTotals(room).playerStrength - combatTotals(raumOhne).playerStrength, 3,
      'die besaenftigte Hand gibt +3 im Kampf');
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL bei Fall 2 — `mit Wunschring gibt es die Wahl`

- [ ] **Step 3: Add `hatWunschring`**

In `src/cards/passives.js` direkt unter `hatGegenstandAbGold` (~Zeile 100):

```js
  // EISKALTES HÄNDCHEN: "Wenn du Eiskaltes Händchen einen Wunschring gibst".
  // Geben heisst hergeben, nicht tragen - deshalb Hand UND Ausruestung, wie
  // bei hatGegenstandAbGold.
  function hatWunschring(player) {
    return equippedItemIds(player).concat(player.hand)
      .some((id) => (card(id) || {}).name === 'WUNSCHRING');
  }
```

- [ ] **Step 4: Add the combat-start option**

In `COMBAT_START_OPTIONS` den abschließenden `ponytail:`-Block zu EISKALTES HÄNDCHEN **ersetzen** durch:

```js
    // "Wenn du Eiskaltes Händchen einen Wunschring gibst, anstatt sie zu
    // bekämpfen, wird sie deine kleine Freundin. Lege den Ring ab; behalte
    // diese Karte und zähle die Hand als einen kleinen Gegenstand, der einen
    // Bonus von +3 im Kampf gibt." Wie die vier Optionen darueber ein eigenes
    // Primitiv - dass es die Karte aus dem Monster- in den Ausruestungs-
    // Zustand bringt, ist kein Bruch der Bauform: wegjagenMitSchatz verschiebt
    // die Monsterkarte ebenfalls selbst.
    'EISKALTES HÄNDCHEN': {
      wennErfuellt: (p) => hatWunschring(p),
      label: 'Einen Wunschring geben (kein Kampf, die Hand wird ein +3-Gegenstand)',
      action: { type: 'haendchenBesaenftigen' },
    },
```

- [ ] **Step 5: Add the special slot entry**

In `SPECIAL_SLOT_ITEMS`:

```js
    // Keine Ausruestungskarte, sondern die besaenftigte Monsterkarte selbst -
    // sie hat in den Rohdaten weder slotKind noch bonus, deshalb steht der
    // Bonus hier an der Regel (siehe equippedBonusSum).
    'EISKALTES HÄNDCHEN': { slot: 'special', bonus: 3 },
```

- [ ] **Step 6: Bonus fallback in `equippedBonusSum`**

`server.js:408` ersetzen durch:

```js
function equippedBonusSum(player, room, excludeIds) {
  return equippedItemIds(player).reduce((sum, id) => {
    if (excludeIds && excludeIds.has(id)) return sum;
    const c = card(id);
    // Rueckfall auf den Bonus der Spezialplatz-Regel: das EISKALTE HÄNDCHEN
    // ist eine Monsterkarte und nennt in den Rohdaten selbst keinen Bonus.
    const regelBonus = (specialSlotRule(c) || {}).bonus || 0;
    return sum + (c && c.bonus ? c.bonus : regelBonus) + attachmentBonusSum(room, id);
  }, 0);
}
```

- [ ] **Step 7: Add the primitive**

In `applyPrimitiveAction` neben den anderen Kampfstart-Alternativen (bei `wegjagenMitSchatz`):

```js
    // EISKALTES HÄNDCHEN: kein Kampf, der Ring geht weg, die Monsterkarte
    // wird zur Ausruestung. Der Ring wird aus der Hand ODER der Ausruestung
    // genommen - "geben" heisst hergeben.
    case 'haendchenBesaenftigen': {
      const m = card(action.cardId);
      const ringId = player.hand.find((id) => (card(id) || {}).name === 'WUNSCHRING')
        || equippedItemIds(player).find((id) => (card(id) || {}).name === 'WUNSCHRING');
      if (!ringId) return 'kein Wunschring da';
      if (player.hand.includes(ringId)) removeFromHand(player, ringId); else unequipSlotCard(player, ringId);
      discardCard(room, ringId);
      player.equipped.special = [...specialSlotCards(player, 'special'), action.cardId];
      room.turnPhase = 'aerger';
      return `gibt den Wunschring - "${m.name}" wird die kleine Freundin (+3 im Kampf)`;
    }
```

- [ ] **Step 8: Run the tests**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: `card-unnatural-monsters: ok`, danach `27/27 Tests erfolgreich.`

Falls `card-abilities.test.js` rot wird: es prüft, dass jeder Name in jeder Tabelle eine echte Karte ist. `EISKALTES HÄNDCHEN` existiert mit genau dieser Schreibweise in `data/cards.json` — bei einem Treffer die Schreibweise gegen die Rohdaten prüfen, nicht den Test aufweichen.

- [ ] **Step 9: Commit**

```bash
git add src/cards/passives.js server.js tests/card-unnatural-monsters.test.js
git commit -m "Eiskaltes Haendchen: Wunschring statt Kampf

Laeuft ueber die vorhandene Tabelle COMBAT_START_OPTIONS - der Platz
fuer 'Statt zu kaempfen ...', den Moechtegern-Vampir, Laufende Nase,
Pit Bull und Packratte schon nutzen. Die dortige ponytail-Notiz, das
sprenge die Aktions-Bauform, stimmte nicht: alle vier Optionen bestehen
ebenfalls je aus einem eigenen Primitiv, und wegjagenMitSchatz
verschiebt die Monsterkarte schon selbst.

Der +3-Bonus steht an der Spezialplatz-Regel, weil die Monsterkarte in
den Rohdaten keinen bonus hat; equippedBonusSum faellt darauf zurueck."
```

---

### Task 8: Den Konsequenz-Wächter neu begründen

**Files:**
- Modify: `tests/auto-consequence.test.js:118-138`

**Interfaces:**
- Consumes: die drei Overrides aus Tasks 3, 5, 6
- Produces: nichts

**Warum:** Der Wächter zählt Karten **ohne** Override, die durch `parseAutoConsequence` fallen (`assert.ok(manualOhneOverride >= 3)`), und die drei, die er zählt, sind namentlich RIESENSTINKTIER, LUSTMONSTER und WEIHNACHTSMANN — genau die, die hier Overrides bekommen. Nach Task 6 ist der Zählwert 0. Ein Nachziehen auf `>= 0` wäre eine Assertion, die nie fehlschlagen kann; der Wächter verliert seinen Gegenstand.

- [ ] **Step 1: Confirm the guard is now red**

Run: `node tests/auto-consequence.test.js`
Expected: FAIL mit `Der generische Textparser loest zu viel automatisch (0 statt mindestens 3 ...)`

Falls es **nicht** rot ist, sind nicht alle drei Overrides da — dann zuerst Tasks 3, 5 und 6 prüfen, statt hier weiterzumachen.

- [ ] **Step 2: Replace the guard**

Den Block von `// Waechter gegen eine zu grosszuegige generische TEXTREGEL` bis einschließlich der `assert.ok(manualOhneOverride >= 3, ...)`-Zeile ersetzen durch:

```js
  // Waechter gegen eine zu grosszuegige generische TEXTREGEL
  // (parseAutoConsequence) - NICHT gegen kuratierte Fortschritte in
  // CONSEQUENCE_OVERRIDES.
  //
  // Frueher war das eine Untergrenze auf der ANZAHL manuell gebliebener
  // Karten. Diese Zahl ist zweimal an ihrem eigenen Erfolg gescheitert:
  // erst zaehlte sie kuratierte Karten mit und musste nach jeder Runde
  // nachgezogen werden; dann zaehlte sie nur noch Karten ohne Override -
  // aber das waren genau RIESENSTINKTIER, LUSTMONSTER und WEIHNACHTSMANN,
  // und als die Overrides bekamen, fiel sie auf 0. Eine Untergrenze, deren
  // Gegenstand verschwinden kann, ist kein Waechter.
  //
  // Gemessen wird deshalb direkt die Eigenschaft, um die es geht: diese
  // Kartentexte DUERFEN vom generischen Parser nicht aufgeloest werden. Sie
  // nennen Bedingungen, Zeitpunkte oder Zustaende, die eine Textregel nicht
  // sehen kann - wer sie einfaengt, hat eine zu gierige Regex gebaut.
  // Kuratierte Overrides sind hier egal: geprueft wird parseAutoConsequence
  // selbst, nicht der Weg, den die Karte im Spiel nimmt.
  const PARSER_TABU = [
    // "bis du ein Monster ohne Hilfe toetest" - ein Zeitpunkt in der Zukunft.
    'WEIHNACHTSMANN',
    // "in deinem naechsten Kampf" - eine Wirkung ueber diese Konsequenz hinaus.
    'LUSTMONSTER',
    // "bevor du nicht alle getragene Kleidung und Ruestung ablegst" - eine
    // Bedingung, die an einem Zustand haengt.
    'RIESENSTINKTIER',
    // "Wuerfle. Bei 1-3 ..." - ein Wurf, kein fester Effekt.
    'SCHNECKEN AUF SPEED',
  ];
  PARSER_TABU.forEach((name) => {
    const karte = ALL_CARDS.find((c) => c.name === name);
    assert.ok(karte, `Testvoraussetzung: Karte "${name}" existiert`);
    assert.strictEqual(parseAutoConsequence(karte.badstuff || ''), null,
      `Der generische Textparser loest "${name}" auf, obwohl der Text eine Bedingung/einen Zeitpunkt nennt, die er nicht sehen kann - vermutlich eine zu großzügige Regex-Regel`);
  });
```

- [ ] **Step 3: Check the helper names actually used in that file**

Der Block oben setzt voraus, dass `ALL_CARDS` und `parseAutoConsequence` in `tests/auto-consequence.test.js` bereits im Scope sind, und dass `parseAutoConsequence` für einen nicht auflösbaren Text `null` liefert.

Run: `head -20 tests/auto-consequence.test.js`
Prüfen: Beide Namen stehen im `require`-Block. Falls `parseAutoConsequence` einen anderen Rückgabewert für "nicht auflösbar" hat (z.B. `undefined`), die Assertion daran anpassen — dann `assert.ok(!parseAutoConsequence(...), ...)` statt `strictEqual(..., null)`.

Run: `node -e "const s=require('./server.js'); console.log(JSON.stringify(s.parseAutoConsequence('Ein Text, den nichts aufloest.')))"`
Expected: `null` (oder der Wert, an den die Assertion angepasst wird)

- [ ] **Step 4: Verify the guard actually guards**

Gegenprobe: die Assertion muss rot werden, wenn der Parser gieriger wird. Vorübergehend im `PARSER_TABU` einen Namen eintragen, dessen Text der Parser auflöst (z.B. eine Karte mit schlichtem "Verliere eine Stufe"), Test laufen lassen, Rot sehen, wieder entfernen.

Run: `node tests/auto-consequence.test.js`
Expected: zuerst FAIL mit dem eingefügten Namen, nach dem Zurücknehmen `1/1 Tests erfolgreich (auto-consequence.test.js).`

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: `27/27 Tests erfolgreich.`

- [ ] **Step 6: Commit**

```bash
git add tests/auto-consequence.test.js
git commit -m "Konsequenz-Waechter misst den Parser statt die Restmenge

Die Untergrenze auf der Anzahl manuell gebliebener Karten ist zweimal
an ihrem eigenen Erfolg gescheitert - zuletzt zaehlte sie genau die drei
Karten, die diese Runde kuratiert, und faellt damit auf 0. Eine
Untergrenze, deren Gegenstand verschwinden kann, ist kein Waechter.

Geprueft wird jetzt direkt, dass parseAutoConsequence eine feste Liste
von Kartentexten NICHT aufloest - Texte, die Bedingungen, Zeitpunkte
oder Wuerfe nennen, die eine Textregel nicht sehen kann. Das haelt
unabhaengig davon, wie viele Karten sonst kuratiert sind."
```

---

### Task 9: Verifikation und Übergabe

**Files:**
- Modify: `HANDOVER.md` (§11.3 ersetzen, §11.4 richtigstellen)
- Test: keiner (reine Verifikation und Dokumentation)

**Interfaces:**
- Consumes: alles aus Tasks 1-8
- Produces: nichts

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: `27/27 Tests erfolgreich.`

- [ ] **Step 2: Coverage scan**

Run: `node tools/coverage-scan.js unnaturalaxe`
Expected: Im Abschnitt MONSTER taucht keine der vier Karten mehr auf. Falls doch, die Ausgabe gegen den jeweiligen Task prüfen — nicht den Scan anpassen.

- [ ] **Step 3: Counter-check each new rule**

Für jede der sechs neuen Tabellen/Overrides einmal den Eintrag auskommentieren, `node tests/card-unnatural-monsters.test.js` laufen lassen, Rot sehen, wieder herstellen:

`MONSTER_LOCKS_OTHERS`, `MONSTER_REQUIRES_OTHER_GENDER`, `CONSEQUENCE_OVERRIDES['RIESENSTINKTIER']`, `CONSEQUENCE_OVERRIDES['LUSTMONSTER']`, `CONSEQUENCE_OVERRIDES['WEIHNACHTSMANN']`, `COMBAT_START_OPTIONS['EISKALTES HÄNDCHEN']`.

Ein Eintrag, dessen Entfernen den Test **nicht** rot färbt, hat keinen Test — dann fehlt eine Prüfung, nicht ein Eintrag.

- [ ] **Step 4: Rewrite HANDOVER §11.3**

Den Abschnitt "### 11.3 Was zurückgestellt ist (Welle 3, eigener Plan nach Rücksprache)" ersetzen durch einen Abschnitt "### 11.3 Welle 3 (Runde vom 2026-09-17)", der beschreibt:

- Die vier Karten laufen jetzt vollständig; Spec und Plan sind
  `docs/superpowers/specs/2026-09-17-unnatural-axe-welle3-design.md` und
  `docs/superpowers/plans/2026-09-17-unnatural-axe-welle3.md`.
- Der Befund, der die Runde klein gehalten hat: der zugübergreifende Zustand
  war schon da (`activeCurses`), es fehlte nur der Zugang. Neu sind ein
  Primitiv (`lingeringCurse`), drei `kind`s (`noHelpHalfGold`,
  `noHandItemBonus`, `noTreasure`) und eine Sperre nach dem Vorbild der
  Einstweiligen Verfügung.
- Die Auslegungen, die nicht aus dem Kartentext folgen und die jemand später
  anders entscheiden könnte: das Stinktier sperrt die *anderen*, nicht die
  kämpfende Person; der Weihnachtsmann-Sieg ohne Hilfe zahlt schon aus; der
  halbierte Goldwert trifft die Endsumme, nicht den einzelnen Gegenstand.
- Der WUNSCHRING beendet die drei Monsterstrafen mit — bewusst so entschieden.

- [ ] **Step 5: Correct HANDOVER §11.4**

§11.4 beschreibt die Manuell-Schranke und schlägt einen Umbau vor, der inzwischen zweimal überholt ist (Commit `166a138` und Task 8). Den Abschnitt durch zwei Sätze ersetzen: der Wächter misst seit dieser Runde direkt, dass `parseAutoConsequence` eine feste Liste von Kartentexten nicht auflöst, und muss deshalb nicht mehr je Runde nachgezogen werden.

- [ ] **Step 6: Commit**

```bash
git add HANDOVER.md
git commit -m "Uebergabe: Welle 3 laeuft, Abschnitt 11.3 und 11.4 nachgezogen

11.3 beschrieb vier zurueckgestellte Karten - sie laufen jetzt. Neu
festgehalten sind die drei Auslegungen, die nicht aus dem Kartentext
folgen und die jemand spaeter anders entscheiden koennte.

11.4 schlug einen Umbau der Manuell-Schranke vor, der inzwischen
zweimal ueberholt ist."
```

---

## Self-Review

**Spec coverage:**

| Spec-Abschnitt | Task |
|---|---|
| §3.1 Zugang, Primitiv `lingeringCurse` | Task 1 |
| §3.2 drei `kind`s | Tasks 3, 5, 6 |
| §3.3 selbstlöschende Einträge, `clearActiveCurseByKind` | Task 1 (Helfer), 3 + 6 (Bedingungen) |
| §4.1 Kampfsperre, weiße Liste, vier Aufrufstellen | Task 2 |
| §4.2 Schlimme Dinge, halber Goldwert, Löschbedingung | Task 3 |
| §5.1 Hilfe-Pflicht | Task 4 |
| §5.2 Flucht-Zwang | Task 4 |
| §5.3 Schlimme Dinge, `excludeIds` | Task 5 |
| §6 WEIHNACHTSMANN inkl. Handel und Löschbedingung | Task 6 |
| §7 EISKALTES HÄNDCHEN inkl. Bonus-Rückfall | Task 7 |
| §8 Tests | in jeder Task Schritt 1 |
| §9 Verifikation, Wächter, HANDOVER | Tasks 8 und 9 |

Keine Lücke.

**Placeholder scan:** Jeder Code-Schritt enthält den tatsächlichen Code. Die
einzigen freitextlichen Schritte sind Task 9 Schritte 4 und 5 (HANDOVER-Prosa)
— dort ist der Inhalt als Stichpunktliste vorgegeben, weil der Text die
Ergebnisse der vorangegangenen Tasks zusammenfasst und erst dann feststeht.

**Type consistency:** `applyLingeringRule(room, player, cardName, cardId, regel)`
wird in Task 1 definiert und in Task 1 Schritt 5 mit genau dieser Signatur
gerufen. `clearActiveCurseByKind(player, kind)` gibt in Task 1 `boolean` zurück
und wird in Task 3 (`stinktierStrafeAktiv`) und Task 6 (`resolveCombatWin`) als
`boolean` gelesen. `stinktierSperre(room, playerId)` und
`stinktierStrafeAktiv(player)` haben bewusst verschiedene Signaturen: die erste
fragt einen Kampfzustand, die zweite eine Person — beide werden durchgängig so
gerufen. `hatSchatzSperre(player)`, `curseHidesHandItems(player)` und
`hatWunschring(player)` nehmen alle nur die Person.
