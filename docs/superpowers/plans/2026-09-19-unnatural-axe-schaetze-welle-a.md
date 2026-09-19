# Unnatural Axe Schatzkarten Welle A – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 10 Unnatural Axe treasure cards fully functional by adding entries to existing data tables and one small logic change in `resolveCombat`.

**Architecture:** All changes are additive table entries in `src/cards/passives.js` plus one guard clause in `server.js`. No new UI, no new socket events. Tests go in `tests/card-unnatural-doors.test.js` (which already covers Unnatural Axe cards).

**Tech Stack:** Node.js, plain `assert` test harness via `node tests/run.js`.

**Spec:** `docs/superpowers/specs/2026-09-19-unnatural-axe-schaetze-welle-a-design.md`

## Global Constraints

- No new dependencies.
- Card names must match `cards.json` exactly (case-sensitive).
- Every table entry follows the existing pattern in `src/cards/passives.js` verbatim.
- Tests use the `makeRoom` / `makePlayer` / `findCard` helpers already present in the test file.
- Run full suite via `node tests/run.js`; all 28+ tests must pass.

## Review Focus

1. **Equipping a `treasure_other` card not in `SPECIAL_SLOT_ITEMS`** should still be rejected – verify `handleEquipItem` only permits cards listed in the table.
2. **Stacking `mitSlot`-linked items** (e.g. KRONLEUCHTER in Welle B) is out of scope but the new entries must not break existing `mitSlot` items (GNOMEX-ANZUG, SCHRECKLICHE SOCKEN).
3. **KRAKZILLA-SCHWERT flee-force applies only to the actor**, not the helper – the `equippedItemIds` check must use the actor, not all combat participants.
4. **ATTACHMENT `… DER VERDAMMNIS` on an item with 0 bonus** should be rejected (`bedingung: 'kampfbonus'` requires `bonus > 0`).
5. **FALSCHER BART trait does NOT grant dwarf big-item carrying** – `nurMonster: true` must not make `canCarryAnotherBigItem` return true.

---

### Task 1: Platzlose Gegenstände ausrüstbar machen (7 Karten)

**Files:**
- Modify: `src/cards/passives.js` (SPECIAL_SLOT_ITEMS table, around line 611)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `handleEquipItem`, `equippedItemIds`, `newEquipped` from `server.js`
- Produces: 7 new entries in `SPECIAL_SLOT_ITEMS` that later tasks depend on (conditional bonus, flee bonus, trait all require the card to be equippable first)

- [ ] **Step 1: Write failing tests**

Add to `tests/card-unnatural-doors.test.js` (before the final `raeume.forEach` cleanup):

```javascript
// --- WELLE A SCHÄTZE: Platzlose Gegenstände ---
{
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);

  // Alle 7 platzlosen Gegenstände müssen anlegbar sein
  const namen = [
    'BEGLEITER', 'FÜRCHTERLICHE FALSCHE ZÄHNE', 'GANZ HEILIGES BUCH',
    'TASCHE MIT KRÄHENFÜSSEN', 'SÜSSER SCHULTERDRACHE',
    'STACHELIGER GENITALSCHONER', 'FALSCHER BART',
  ];
  for (const name of namen) {
    const c = findCard(name);
    p1.hand.push(c.id);
    handleEquipItem(room, p1.id, c.id);
    assert.ok(
      equippedItemIds(p1).includes(c.id),
      `${name} muss anlegbar sein`,
    );
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL – `BEGLEITER muss anlegbar sein` (handleEquipItem rejects treasure_other without SPECIAL_SLOT_ITEMS entry)

- [ ] **Step 3: Add SPECIAL_SLOT_ITEMS entries**

In `src/cards/passives.js`, add after the last existing entry in `SPECIAL_SLOT_ITEMS` (after `'EISKALTES HÄNDCHEN (KLEINE FREUNDIN)': { slot: 'special' },`):

```javascript
    // --- Unnatural Axe: platzlose Gegenstände ---
    'BEGLEITER': { slot: 'special' },
    'FÜRCHTERLICHE FALSCHE ZÄHNE': { slot: 'special' },
    'GANZ HEILIGES BUCH': { slot: 'special' },
    'TASCHE MIT KRÄHENFÜSSEN': { slot: 'special' },
    'SÜSSER SCHULTERDRACHE': { slot: 'special' },
    'STACHELIGER GENITALSCHONER': { slot: 'special' },
    'FALSCHER BART': { slot: 'special' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cards/passives.js tests/card-unnatural-doors.test.js
git commit -m "feat: make 7 unnatural axe treasure_other cards equippable"
```

---

### Task 2: Bedingte Kampfboni (Schulterdrache, Genitalschoner) + PSYCHO-EICHHÖRNCHEN

**Files:**
- Modify: `src/cards/passives.js` (ITEM_CONDITIONAL_BONUS table, around line 568; MONSTER_REFUSES entry for PSYCHO-EICHHÖRNCHEN, around line 42)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `conditionalItemBonusSum` from `server.js`, `ITEM_CONDITIONAL_BONUS` from `passives.js`, `combatTotals` from `server.js`, `monsterRefusesTarget` from `server.js`
- Produces: 2 new entries in `ITEM_CONDITIONAL_BONUS`, 1 updated entry in `MONSTER_REFUSES`

- [ ] **Step 1: Write failing tests**

```javascript
// --- WELLE A SCHÄTZE: Bedingte Kampfboni ---
{
  const p1 = makePlayer({ id: 'p1', name: 'Frau', gender: 'w' });
  const p2 = makePlayer({ id: 'p2', name: 'Mann', gender: 'm' });
  const room = makeRoom([p1, p2]);

  // SÜSSER SCHULTERDRACHE: +2 Basis, +2 extra für Frauen
  const drache = findCard('SÜSSER SCHULTERDRACHE');
  p1.hand.push(drache.id);
  handleEquipItem(room, p1.id, drache.id);
  p2.hand.push(drache.id);  // Zweites Exemplar suchen
  const drache2 = ALL_CARDS.find(c => c.name === 'SÜSSER SCHULTERDRACHE' && c.id !== drache.id);
  if (drache2) {
    p2.hand.push(drache2.id);
    handleEquipItem(room, p2.id, drache2.id);
  }

  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  const t1 = combatTotals(room);
  // Frau: Stufe 5 + Drache Basis 2 + Drache Frauen-Bonus 2 = 9
  assert.strictEqual(t1.playerStrength, 9, 'Schulterdrache +4 für Frauen');

  room.combat = null;
  startCombat(room, p2.id, [monster.id], { fromHand: false });
  const t2 = combatTotals(room);
  // Mann: Stufe 5 + Drache Basis 2 + kein Geschlechterbonus = 7
  if (drache2) {
    assert.strictEqual(t2.playerStrength, 7, 'Schulterdrache +2 für Männer (kein Extra)');
  }
  room.combat = null;
}

// STACHELIGER GENITALSCHONER: +2 Basis, +2 extra für Männer
{
  const p1 = makePlayer({ id: 'p1', name: 'Mann', gender: 'm' });
  const room = makeRoom([p1]);
  const genital = findCard('STACHELIGER GENITALSCHONER');
  p1.hand.push(genital.id);
  handleEquipItem(room, p1.id, genital.id);

  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  const t = combatTotals(room);
  // Mann: Stufe 5 + Genitalschoner Basis 2 + Männer-Bonus 2 = 9
  assert.strictEqual(t.playerStrength, 9, 'Genitalschoner +4 für Männer');
  room.combat = null;
}

// PSYCHO-EICHHÖRNCHEN: greift Träger des Genitalschoners nicht an
{
  const p1 = makePlayer({ id: 'p1', name: 'Mann', gender: 'm' });
  const room = makeRoom([p1]);
  const genital = findCard('STACHELIGER GENITALSCHONER');
  p1.hand.push(genital.id);
  handleEquipItem(room, p1.id, genital.id);

  const eichhoernchen = findCard('PSYCHO-EICHHÖRNCHEN');
  assert.ok(
    monsterRefusesTarget(eichhoernchen.id, p1),
    'Psycho-Eichhörnchen greift Genitalschoner-Träger nicht an',
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL – conditional bonus not applied (Schulterdrache gives only +2 instead of +4 for women)

- [ ] **Step 3: Add ITEM_CONDITIONAL_BONUS entries and update MONSTER_REFUSES**

In `src/cards/passives.js`, add to `ITEM_CONDITIONAL_BONUS` (after `'GHOULPEITSCHE'` entry):

```javascript
    // "+2 Bonus für Frauen" - Zusatz zum Grundbonus (+2), Frauen also +4.
    'SÜSSER SCHULTERDRACHE': (player) => (istGeschlecht(player, 'w') ? 2 : 0),
    // "+2 Bonus für Männer" - Zusatz zum Grundbonus (+2), Männer also +4.
    'STACHELIGER GENITALSCHONER': (player) => (istGeschlecht(player, 'm') ? 2 : 0),
```

Update `MONSTER_REFUSES['PSYCHO-EICHHÖRNCHEN']` (around line 42–46):

```javascript
    // "Greift keine Frauen an oder Träger des Stacheligen Genitalschoners."
    'PSYCHO-EICHHÖRNCHEN': (p) => istGeschlecht(p, 'w')
      || equippedItemIds(p).some((id) => (card(id) || {}).name === 'STACHELIGER GENITALSCHONER'),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cards/passives.js tests/card-unnatural-doors.test.js
git commit -m "feat: conditional combat bonuses for Schulterdrache/Genitalschoner + Psycho-Eichhörnchen"
```

---

### Task 3: Flucht-Boni, Rassen-Trait, Anhang

**Files:**
- Modify: `src/cards/passives.js` (FLEE_ITEM_BONUS, ITEM_GRANTS_TRAIT, ATTACHMENT_CARDS tables)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `fleeModifierParts` from `server.js`, `FLEE_ITEM_BONUS` / `ITEM_GRANTS_TRAIT` / `ATTACHMENT_CARDS` from `passives.js`, `monsterSeesRace` / `handleAttachCard` / `attachmentBonusSum` from `server.js`
- Produces: 2 entries in `FLEE_ITEM_BONUS`, 1 entry in `ITEM_GRANTS_TRAIT`, 1 entry in `ATTACHMENT_CARDS`

- [ ] **Step 1: Write failing tests**

```javascript
// --- WELLE A SCHÄTZE: Flucht-Boni ---
{
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);

  // TASCHE MIT KRÄHENFÜSSEN: +1 auf Weglaufen
  const tasche = findCard('TASCHE MIT KRÄHENFÜSSEN');
  p1.hand.push(tasche.id);
  handleEquipItem(room, p1.id, tasche.id);

  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  const parts = fleeModifierParts(room, p1);
  const taschenBonus = parts.find(p => p.label === 'TASCHE MIT KRÄHENFÜSSEN');
  assert.ok(taschenBonus, 'Tasche erscheint in Flucht-Modifikatoren');
  assert.strictEqual(taschenBonus.amount, 1, 'Tasche gibt +1 auf Weglaufen');
  room.combat = null;
}

// BELAGERUNGSMASCHINE: -1 auf Weglaufen
{
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);
  const maschine = findCard('BELAGERUNGSMASCHINE');
  p1.hand.push(maschine.id);
  handleEquipItem(room, p1.id, maschine.id);

  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  const parts = fleeModifierParts(room, p1);
  const maschinenMalus = parts.find(p => p.label === 'BELAGERUNGSMASCHINE');
  assert.ok(maschinenMalus, 'Belagerungsmaschine erscheint in Flucht-Modifikatoren');
  assert.strictEqual(maschinenMalus.amount, -1, 'Belagerungsmaschine gibt -1 auf Weglaufen');
  room.combat = null;
}

// FALSCHER BART: Monster sehen Träger als Zwerg
{
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);
  const bart = findCard('FALSCHER BART');
  p1.hand.push(bart.id);
  handleEquipItem(room, p1.id, bart.id);

  assert.ok(monsterSeesRace(p1, 'ZWERG'), 'Falscher Bart: Monster sehen Zwerg');
  // Kein echtes Zwergen-Tragen:
  assert.ok(!hasRace(p1, 'ZWERG'), 'Falscher Bart gibt keine echte Zwergen-Rasse');
}

// … DER VERDAMMNIS: Anhang an Kampfbonus-Gegenstand
{
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);
  const schwert = findCard('LUSTIGES SCHWERT');
  p1.hand.push(schwert.id);
  handleEquipItem(room, p1.id, schwert.id);

  const verdammnis = findCard('… DER VERDAMMNIS');
  p1.hand.push(verdammnis.id);
  handleAttachCard(room, p1.id, verdammnis.id, schwert.id);

  const bonus = attachmentBonusSum(room, schwert.id);
  assert.strictEqual(bonus, 2, '… DER VERDAMMNIS gibt +2 Anhang-Bonus');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL – flee modifier not found for TASCHE MIT KRÄHENFÜSSEN

- [ ] **Step 3: Add table entries**

In `src/cards/passives.js`:

Add to `FLEE_ITEM_BONUS` (after `'ZAUBERCOUCH': -1`):

```javascript
    'TASCHE MIT KRÄHENFÜSSEN': 1,  // "+1 für Weglaufen."
    'BELAGERUNGSMASCHINE': -1,     // "Bist du in der Belagerungsmaschine, hast du -1 auf Weglaufen."
```

Add to `ITEM_GRANTS_TRAIT` (after `'ZAUBERCOUCH': { class: 'ZAUBERER' }`):

```javascript
    'FALSCHER BART': { race: 'ZWERG', nurMonster: true },
```

Add to `ATTACHMENT_CARDS` (after `'NÜTZLICHE GRIFFE': { bedingung: 'gross', label: 'Nützliche Griffe' }`):

```javascript
    '… DER VERDAMMNIS': { bedingung: 'kampfbonus', label: 'der Verdammnis' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cards/passives.js tests/card-unnatural-doors.test.js
git commit -m "feat: flee bonuses, FALSCHER BART trait, … DER VERDAMMNIS attachment"
```

---

### Task 4: Krakzilla-Schwert Flucht-Zwang

**Files:**
- Modify: `server.js` (in `resolveCombat`, around lines 4958–5001)
- Test: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `resolveCombat`, `equippedItemIds`, `card` from `server.js`
- Produces: Krakzilla flee-force guard clause in `resolveCombat`

- [ ] **Step 1: Write failing test**

```javascript
// --- WELLE A SCHÄTZE: Krakzilla-Schwert Flucht-Zwang ---
{
  const p1 = makePlayer({ id: 'p1', name: 'Held', level: 9 });
  const room = makeRoom([p1]);
  const schwert = findCard('ALLES AUSSER KRAKZILLA ABSCHLACHTENDES SCHWERT');
  p1.hand.push(schwert.id);
  handleEquipItem(room, p1.id, schwert.id);

  const krakzilla = findCard('KRAKZILLA');
  startCombat(room, p1.id, [krakzilla.id], { fromHand: false });
  resolveCombat(room);

  // Trotz ausreichender Kampfstärke muss geflohen werden
  assert.ok(room.combat.mustFlee, 'Krakzilla-Schwert erzwingt Flucht gegen Krakzilla');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL – `room.combat.mustFlee` is undefined (combat was won instead of forcing flee)

- [ ] **Step 3: Add Krakzilla flee-force to resolveCombat**

In `server.js`, find `resolveCombat`. Locate the line:
```javascript
  const kampfVerloren = lustOhneHilfe || angstVorUntoten;
```

Replace with:
```javascript
  // ALLES AUSSER KRAKZILLA ABSCHLACHTENDES SCHWERT: "Hast du dieses Schwert
  // ausgespielt und triffst auf Krakzilla, musst du versuchen, Wegzulaufen!"
  const krakzillaSchwertZwang = room.combat.monsterIds.some(
    (id) => (card(id) || {}).name === 'KRAKZILLA'
  ) && equippedItemIds(findPlayer(room, c.actorId)).some(
    (id) => (card(id) || {}).name === 'ALLES AUSSER KRAKZILLA ABSCHLACHTENDES SCHWERT'
  );
  const kampfVerloren = lustOhneHilfe || angstVorUntoten || krakzillaSchwertZwang;
```

Also add an appropriate log message in the existing log block (around the `angstVorUntoten` / `lustOhneHilfe` ternary):

```javascript
    : (krakzillaSchwertZwang
      ? `Das Schwert zwingt ${findPlayer(room, c.actorId).name} zur Flucht vor Krakzilla!${wer}`
      : `Kampfstärke reicht nicht (${playerStrength} vs. ${monsterStrength}). Fliehen nötig!${wer}`));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `node tests/run.js`
Expected: All tests pass (28+/28+)

- [ ] **Step 6: Commit**

```bash
git add server.js tests/card-unnatural-doors.test.js
git commit -m "feat: Krakzilla sword forces flee when Krakzilla is in combat"
```

---

### Task 5: Zusätzliche Importe und finale Verifizierung

**Files:**
- Modify: `tests/card-unnatural-doors.test.js` (imports at top)

**Interfaces:**
- Consumes: All exports from tasks 1–4

Note: The test file already imports `handleEquipItem`, `equippedItemIds`, `startCombat`, `resolveCombat`, `combatTotals`. The following imports may need to be added if not already present: `fleeModifierParts`, `monsterRefusesTarget`, `monsterSeesRace`, `hasRace`, `handleAttachCard`, `attachmentBonusSum`, `ALL_CARDS`.

- [ ] **Step 1: Verify and add missing imports**

Check the `require('../server.js')` destructuring at the top of `tests/card-unnatural-doors.test.js`. Add any missing names:

```javascript
const {
  ALL_CARDS, newEquipped, combatTotals, handleEquipItem, equippedItemIds,
  istGrosserGegenstand, addActiveCurse, DOOR_OTHER_AS_CURSE,
  startCombat, handleRequestHelp, handleRespondHelp, resolveCombatWin, resolveCombat,
  UNDEAD_MONSTERS, handlePlayCombatCard,
  resolveConsequenceSpec, applyPrimitiveAction, cursedItemIds, unequipSlotCard,
  handleUnequipItem, handleSellItems, ownTradeIds, clearActiveCurseByKind,
  handleResolveCardCardChoice, TREASURE_POWER_OVERRIDES, handleUseCardPower,
  handleResolveMultiCardSelection, handleResolveCardChoice,
  // Welle A Schätze:
  fleeModifierParts, monsterRefusesTarget, monsterSeesRace, hasRace,
  handleAttachCard, attachmentBonusSum,
} = require('../server.js');
```

- [ ] **Step 2: Run full test suite**

Run: `node tests/run.js`
Expected: All tests pass

- [ ] **Step 3: Final commit**

```bash
git add tests/card-unnatural-doors.test.js
git commit -m "feat: complete unnatural axe treasure cards wave A"
```
