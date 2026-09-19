# Unnatural Axe Schatzkarten Welle B – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 5 Unnatural Axe treasure cards fully functional: KRONLEUCHTER, REGENMANTEL, FEIGHEITSTRANK, UNGLÄUBIGKEITSTRANK, WAPPEN.

**Architecture:** 
- Table entries in `src/cards/passives.js` for equipment slots and potion overrides.
- Logic updates in `server.js` for combat potion mechanics (`forceFlee`, `keepTreasureForWin`) and potion-blocking (`REGENMANTEL`).
- Dynamic hand-slot capacity management in `server.js` for `WAPPEN`.

**Tech Stack:** Node.js, plain `assert` test harness via `node tests/run.js`.

**Spec:** `docs/superpowers/specs/2026-09-19-unnatural-axe-schaetze-welle-b-design.md`

## Global Constraints

- No new dependencies.
- Card names must match `cards.json` exactly.
- Run full suite via `node tests/run.js`; all tests must pass.
- Hand-capacity logic must remain backward-compatible (all existing two-handed weapons and curses like WINZIGE HÄNDE must keep working).

## Review Focus

1. **WAPPEN unequip safety:** When `WAPPEN` is removed, any items in the extra hand slots must be unequipped and returned to the player's hand safely.
2. **Two-handed items with WAPPEN:** Equipping a two-handed item when `WAPPEN` is active must not hard-reset the hands array to `[cardId, cardId]`. It must find two empty slots.
3. **REGENMANTEL potion block:** Must only block non-participants when there is NO helper. If there is a helper, anyone can play potions.

---

### Task 1: KRONLEUCHTER & REGENMANTEL (Ausrüstung)

**Files:**
- Modify: `src/cards/passives.js` (SPECIAL_SLOT_ITEMS table)
- Modify: `server.js` (in `handlePlayCombatCard`)
- Modify/Create: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `SPECIAL_SLOT_ITEMS` from `passives.js`, `handlePlayCombatCard` / `isCombatPotionCard` / `equippedItemIds` from `server.js`
- Produces: `SPECIAL_SLOT_ITEMS` entries for both items; potion-blocking logic for REGENMANTEL.

- [ ] **Step 1: Write failing tests**

In `tests/card-unnatural-doors.test.js`, add:

```javascript
// --- WELLE B SCHÄTZE: KRONLEUCHTER & REGENMANTEL ---
{
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);
  const kronleuchter = findCard('KRONLEUCHTER');
  p1.hand.push(kronleuchter.id);
  handleEquipItem(room, p1.id, kronleuchter.id);
  assert.ok(equippedItemIds(p1).includes(kronleuchter.id), 'KRONLEUCHTER kann angelegt werden');
}

{
  const p1 = makePlayer('P1');
  const p2 = makePlayer('P2');
  const room = makeRoom([p1, p2]);
  const mantel = findCard('REGENMANTEL');
  p1.hand.push(mantel.id);
  handleEquipItem(room, p1.id, mantel.id);

  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });

  // P2 versucht, einen Trank zu spielen
  const trank = findCard('TRANK DES HALBWEGS MUTIGEN'); // Ein Kampf-Trank
  p2.hand.push(trank.id);
  handlePlayCombatCard(room, p2.id, trank.id);
  assert.ok(p2.hand.includes(trank.id), 'REGENMANTEL blockiert Tränke von Fremden ohne Helfer');

  // Mit Helfer: P2 darf werfen
  room.combat.helperId = p2.id;
  handlePlayCombatCard(room, p2.id, trank.id);
  assert.ok(!p2.hand.includes(trank.id), 'Tränke erlaubt, sobald ein Helfer dabei ist');
  room.combat = null;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL - `KRONLEUCHTER kann angelegt werden` (or `REGENMANTEL blockiert Tränke...`)

- [ ] **Step 3: Add table entries**

In `src/cards/passives.js`, add to `SPECIAL_SLOT_ITEMS`:

```javascript
    'KRONLEUCHTER': { slot: 'special', mitSlot: 'head' },
    'REGENMANTEL': { slot: 'special', mitSlot: 'armor' },
```

- [ ] **Step 4: Add potion-blocking logic**

In `server.js`, inside `handlePlayCombatCard`, find:
```javascript
  const c = card(cardId);
  if (!c) return;
```
Immediately after that, add:

```javascript
  // REGENMANTEL: "Andere Spieler können deine Kämpfe nicht mit Tränken stören."
  // Gilt nicht, wenn jemand hilft.
  if (isCombatPotionCard(c) && !room.combat.helperId && playerId !== room.combat.actorId) {
    const actor = findPlayer(room, room.combat.actorId);
    if (equippedItemIds(actor).some((id) => (card(id) || {}).name === 'REGENMANTEL')) {
      log(room, `${player.name} kann keinen Trank spielen: ${actor.name} trägt einen Regenmantel und kämpft alleine.`);
      touchRoom(room);
      return;
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cards/passives.js server.js tests/card-unnatural-doors.test.js
git commit -m "feat: KRONLEUCHTER and REGENMANTEL equipment and effects"
```

---

### Task 2: FEIGHEITSTRANK & UNGLÄUBIGKEITSTRANK

**Files:**
- Modify: `src/cards/passives.js` (COMBAT_POTION_OVERRIDES)
- Modify: `server.js` (applyCombatPotionAction)
- Modify: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `applyCombatPotionAction` in `server.js`, `COMBAT_POTION_OVERRIDES` in `passives.js`
- Produces: `forceFlee` action type, `keepTreasureForWin` property handler.

- [ ] **Step 1: Write failing tests**

In `tests/card-unnatural-doors.test.js`, add:

```javascript
// --- WELLE B SCHÄTZE: FEIGHEITSTRANK ---
{
  const p1 = makePlayer({ id: 'p1', name: 'P1', level: 9 });
  const room = makeRoom([p1]);
  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  
  const feigling = findCard('FEIGHEITSTRANK');
  p1.hand.push(feigling.id);
  handlePlayCombatCard(room, p1.id, feigling.id);
  resolveCombat(room);
  assert.ok(room.combat.mustFlee, 'FEIGHEITSTRANK erzwingt Flucht');
}

// --- WELLE B SCHÄTZE: UNGLÄUBIGKEITSTRANK ---
{
  const p1 = makePlayer({ id: 'p1', name: 'P1', level: 9 });
  const room = makeRoom([p1]);
  const m1 = findCard('LAHMER GOBLIN');
  const m2 = findCard('KRAKZILLA'); // Gibt 4 Schätze
  startCombat(room, p1.id, [m1.id], { fromHand: false });
  room.combat.monsterIds.push(m2.id); // Krakzilla dazu
  
  const ungl = findCard('UNGLÄUBIGKEITSTRANK');
  p1.hand.push(ungl.id);
  handlePlayCombatCard(room, p1.id, ungl.id);
  // Krakzilla (höchste Stufe) ist Standard-Ziel für Tränke ohne Zielwahl (oder wir checken, ob treasureDelta steigt)
  const ziel = room.combat.monsterIds.length === 1;
  assert.ok(ziel, 'Monster wurde entfernt');
  assert.ok(room.combat.treasureDelta > 0, 'Schatz des entfernten Monsters bleibt für den Sieg erhalten');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/card-unnatural-doors.test.js`
Expected: FAIL - `FEIGHEITSTRANK erzwingt Flucht` (or `munchkinBonusWirkungslos` aborts play)

- [ ] **Step 3: Add table entries**

In `src/cards/passives.js`, inside `COMBAT_POTION_OVERRIDES`:

```javascript
    'FEIGHEITSTRANK': () => ({ type: 'forceFlee' }),
    'UNGLÄUBIGKEITSTRANK': () => ({ type: 'removeOneMonster', leavesTreasure: false, keepTreasureForWin: true }),
```

- [ ] **Step 4: Update applyCombatPotionAction**

In `server.js`, find `switch (action.type) {` inside `applyCombatPotionAction`.
Add the new case:

```javascript
    case 'forceFlee': {
      c.mustFlee = true;
      return 'die Munchkins müssen weglaufen';
    }
```

Find the `removeOneMonster` case block inside `applyCombatPotionAction`.
Find this block:
```javascript
      const drawn = [];
      let actorFuerSchatz = null;
      if (action.leavesTreasure) {
```
Insert before `const drawn = [];`:
```javascript
      if (action.keepTreasureForWin) {
        c.treasureDelta = (c.treasureDelta || 0) + (m.treasureCount || 0);
      }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cards/passives.js server.js tests/card-unnatural-doors.test.js
git commit -m "feat: FEIGHEITSTRANK and UNGLÄUBIGKEITSTRANK combat potions"
```

---

### Task 3: WAPPEN (2 Extra-Hände)

**Files:**
- Modify: `src/cards/passives.js` (SPECIAL_SLOT_ITEMS table)
- Modify: `server.js` (hand capacity logic)
- Modify: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `handleEquipItem`, `unequipSlotCard` from `server.js`
- Produces: `ensureHandsLength` helper, dynamic `player.equipped.hands` length

- [ ] **Step 1: Write failing tests**

In `tests/card-unnatural-doors.test.js`, add:

```javascript
// --- WELLE B SCHÄTZE: WAPPEN (2 Extra-Hände) ---
{
  const p1 = makePlayer('P1');
  const room = makeRoom([p1]);
  const wappen = findCard('WAPPEN');
  const s1 = findCard('SCHILD'); // 1 Hand
  const s2 = findCard('GEILER HELM'); // Kopf (Dummy)
  const w1 = findCard('SCHWEIZER ARMEE-HELEBARDE'); // 2 Hände
  const w2 = findCard('LUSTIGES SCHWERT'); // 1 Hand

  p1.hand.push(wappen.id, s1.id, w1.id, w2.id);
  handleEquipItem(room, p1.id, wappen.id);
  assert.strictEqual(p1.equipped.hands.length, 4, 'WAPPEN erweitert Hände auf 4');
  
  handleEquipItem(room, p1.id, w1.id);
  handleEquipItem(room, p1.id, s1.id);
  handleEquipItem(room, p1.id, w2.id);
  assert.strictEqual(p1.equipped.hands.filter(Boolean).length, 4, '4 Hände belegt');

  // Wappen ablegen: muss die Hände auf 2 schrumpfen und 2 Items in die Hand zurücklegen
  unequipSlotCard(p1, wappen.id);
  assert.strictEqual(p1.equipped.hands.length, 2, 'Hände wieder auf 2 geschrumpft');
  assert.strictEqual(p1.equipped.hands.filter(Boolean).length, 2, '2 Hände weiterhin belegt');
  assert.ok(p1.hand.includes(s1.id) || p1.hand.includes(w2.id) || p1.hand.includes(w1.id), 'Überzählige Gegenstände sind auf der Hand');
}
```

- [ ] **Step 2: Add WAPPEN to SPECIAL_SLOT_ITEMS**

In `src/cards/passives.js`, add to `SPECIAL_SLOT_ITEMS`:
```javascript
    'WAPPEN': { slot: 'special' },
```

- [ ] **Step 3: Refactor hand allocation in server.js**

In `server.js`, write a new helper right above `handleEquipItem`:

```javascript
function ensureHandsLength(player) {
  const wappenActive = equippedItemIds(player).some((id) => (card(id) || {}).name === 'WAPPEN');
  const targetLength = wappenActive ? 4 : 2;
  while (player.equipped.hands.length < targetLength) {
    player.equipped.hands.push(null);
  }
  while (player.equipped.hands.length > targetLength) {
    // Wenn am Ende noch Platz frei ist, einfach wegschneiden
    if (player.equipped.hands[player.equipped.hands.length - 1] === null) {
      player.equipped.hands.pop();
    } else {
      // Wenn belegt, Item auf die Hand zurücklegen
      const itemToDrop = player.equipped.hands.pop();
      // Nur falls das Item doppelt drin liegt (Zweihänder), den anderen Slot ebenfalls leeren
      player.equipped.hands = player.equipped.hands.map(h => h === itemToDrop ? null : h);
      player.hand.push(itemToDrop);
    }
  }
}
```

Inside `handleEquipItem`, find this block:
```javascript
  else if (c.slotKind === 'hand') {
    // ZWEIHÄNDIGES SCHWERT gibt eine Hand zurueck, kostet also netto keine.
    const kosten = FREE_HAND_ITEMS.has(c.name) ? 0 : c.handsCost;
    const freeSlots = player.equipped.hands.filter((h) => h === null).length;
    if (freeSlots < kosten) return;
    removeFromHand(player, cardId);
    if (kosten === 2) { player.equipped.hands = [cardId, cardId]; }
    else if (kosten === 1) { const idx = player.equipped.hands.indexOf(null); player.equipped.hands[idx] = cardId; }
```
Replace the `if (kosten === 2)` line with:
```javascript
    if (kosten === 2) {
      const idx1 = player.equipped.hands.indexOf(null);
      player.equipped.hands[idx1] = cardId;
      const idx2 = player.equipped.hands.indexOf(null);
      player.equipped.hands[idx2] = cardId;
    }
```

At the very end of `handleEquipItem` (before the final `touchRoom`), add:
```javascript
  ensureHandsLength(player);
```

At the very end of `unequipSlotCard`, add:
```javascript
  ensureHandsLength(player);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/card-unnatural-doors.test.js`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `node tests/run.js`
Expected: All tests pass (assuring we didn't break two-handed weapons for regular players).

- [ ] **Step 6: Commit**

```bash
git add src/cards/passives.js server.js tests/card-unnatural-doors.test.js
git commit -m "feat: WAPPEN enables 2 extra hands dynamically"
```
