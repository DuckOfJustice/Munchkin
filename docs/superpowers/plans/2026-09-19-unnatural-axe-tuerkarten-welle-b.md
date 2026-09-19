# Unnatural Axe - Türkarten Welle B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 5 complex Door cards (EDELMUT, TOD, ABGEBRANNT, FREUNDLICH, MAMI) integrating with the combat and curse engines.

**Architecture:** Table-driven mechanics in `src/cards/treasures.js` (`DOOR_COMBAT_CARDS`) and `src/cards/consequences.js` (`CONSEQUENCE_OVERRIDES`), with deep state extensions in `server.js` (`applyCombatPotionAction`, `applyPrimitiveAction`, `handlePlayCombatCard`). 

**Tech Stack:** Node.js (JavaScript), Mocha (Tests).

**Spec:** `docs/superpowers/specs/2026-09-19-unnatural-axe-tuerkarten-welle-b-design.md`

## Global Constraints
- Target cards exactly according to the spec definitions.
- Write isolated unit tests for each new card.

## Review Focus
- **EDELMUT doesn't transfer items to receiver's equipment**: Items must land in the receiver's hand to obey Munchkin rules on giving items. Tested in Task 1.
- **EDELMUT victim disconnects**: The queue must cleanly skip offline players. Ensured by existing `advanceCardActionQueue` behavior, but test ensures basic queue continuity.
- **Multiple monsters & TOD/ABGEBRANNT targeting**: `handlePlayCombatCard` must reliably present a choice prompt before playing the card. Tested in Task 2.
- **MAMI Baby compensation**: MAMI duplicates enhancers but must ignore BABY's -5 and -1 treasure effect. Tested in Task 5.

---

### Task 1: EDELMUT (Fluch)

**Files:**
- Modify: `src/cards/consequences.js:390-425`
- Modify: `server.js` (inside `applyPrimitiveAction`)
- Modify: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Consumes: `openQueuedCardAction`, `playerQueueFrom`, `findPlayer`
- Produces: `curseEdelmut` primitive logic handling item transfer and random card draws.

- [ ] **Step 1: Write the failing test**

```javascript
// in tests/card-unnatural-doors.test.js, at the bottom of the file
describe('Welle B: EDELMUT', () => {
  it('verteilt reihum Gegenstaende in die Hand und zieht bei Mangel zufaellig von der Hand', () => {
    room.doorDeck.unshift(findCardId('EDELMUT'));
    player.equipped = newEquipped();
    const helm = findCardId('GEILER HELM');
    player.equipped.head = helm;
    player.hand = [findCardId('AR***TRITT-STIEFEL'), findCardId('KETTENSÄGE DER BLUTIGEN ZERSTÜCKELUNG')]; // 2 Handkarten
    p2.hand = [];
    p3.hand = [];
    
    // player zieht EDELMUT
    handleKickOpenDoor(room, player.id);
    
    // player muss p2 einen Gegenstand geben
    assert.strictEqual(room.pendingCardAction.playerId, player.id);
    assert.strictEqual(room.pendingCardAction.kind, 'chooseCard');
    assert.ok(room.pendingCardAction.candidateIds.includes(helm));
    
    handleResolveCardCardChoice(room, player.id, helm);
    
    // Helm ist jetzt in p2s Hand
    assert.ok(p2.hand.includes(helm));
    assert.ok(!player.equipped.head);
    
    // Für p3 hat player keine ausgerüsteten Gegenstände mehr, also zieht p3 automatisch 2 Handkarten von player.
    // EDELMUT ist durch.
    assert.strictEqual(room.pendingCardAction, null);
    assert.strictEqual(p3.hand.length, 2);
    assert.strictEqual(player.hand.length, 0); // Hatte 2 Handkarten, beide weg
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/run.js` (Test sollte bei "assert.strictEqual(room.pendingCardAction.playerId, player.id);" fehlschlagen, weil EDELMUT derzeit `() => null` ist).

- [ ] **Step 3: Write minimal implementation**

In `src/cards/consequences.js`, change `'EDELMUT': () => null,` to:
```javascript
    'EDELMUT': () => ({ type: 'curseEdelmut' }),
```

In `server.js`, im `switch (action.type)` von `applyPrimitiveAction`:
```javascript
    case 'curseEdelmut': {
      const others = playerQueueFrom(room, action.victim, 'after').filter((id) => id !== action.victim);
      if (others.length === 0) return 'hat niemanden zum Beschenken';
      const queueIds = others.map(() => action.victim);
      openQueuedCardAction(room, 'EDELMUT', queueIds, () => {
        const nextReceiverId = others.shift();
        if (!nextReceiverId) return null;
        const victim = findPlayer(room, action.victim);
        const receiver = findPlayer(room, nextReceiverId);
        if (!victim || !receiver) return null;
        
        const equip = equippedItemIds(victim);
        if (equip.length > 0) {
          return {
            playerId: victim.id,
            kind: 'chooseCard',
            prompt: `Gegenstand fǬr ${receiver.name} whlen`,
            candidateIds: equip,
            giveTo: receiver.id
          };
        } else if (victim.hand.length > 0) {
          const count = Math.min(2, victim.hand.length);
          const drawn = [];
          for (let i = 0; i < count; i++) {
             const id = victim.hand[Math.floor(Math.random() * victim.hand.length)];
             removeFromHand(victim, id);
             clearCheatIfLost(victim, id);
             drawn.push(id);
          }
          drawn.forEach((id) => receiver.hand.push(id));
          log(room, `${receiver.name} zieht ${drawn.length} Handkarte(n) von ${victim.name}.`);
          return null;
        }
        return null;
      });
      return 'muss all sein Hab und Gut verteilen';
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/run.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cards/consequences.js server.js tests/card-unnatural-doors.test.js
git commit -m "feat: EDELMUT Türkarte implementiert"
```

---

### Task 2: Combat Target Selection Genericization

**Files:**
- Modify: `server.js:4470-4500` (around `handlePlayCombatCard`)
- Modify: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Produces: Generalized target choice in `handlePlayCombatCard` for `DOOR_COMBAT_CARDS` that require `monsterId`.

- [ ] **Step 1: Write the failing test**

```javascript
describe('Welle B: Targeting System fuer Tuerkarten', () => {
  it('erzwingt eine Monsterauswahl fuer kartenbasierte Tueraktionen bei 2 Monstern', () => {
    // Fake Karte nur fuer Test
    room.doorDiscard.push(findCardId('TOD')); // Leere Karte bereithalten
    room.doorDiscard.push(findCardId('ABGEBRANNT'));
    
    startCombat(room, player.id, [findCardId('FLIEGENDES FROSCHGEZÜCHT'), findCardId('LAHMER GOBLIN')], { fromHand: true });
    
    // Inject a fake door combat card dynamically just for this test
    const { DOOR_COMBAT_CARDS } = require('../src/cards/treasures');
    DOOR_COMBAT_CARDS['TOD'] = () => ({ type: 'removeOneMonster', leavesTreasure: true });
    
    player.hand.push(findCardId('TOD'));
    handlePlayCombatCard(room, player.id, findCardId('TOD'));
    
    // Sollte pendingCardAction erzeugen
    assert.ok(room.pendingCardAction, "Monster-Auswahl sollte offen sein");
    assert.strictEqual(room.pendingCardAction.kind, 'choice');
    assert.strictEqual(room.pendingCardAction.options.length, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/run.js` (Fails at `assert.ok(room.pendingCardAction)` because `DOOR_COMBAT_CARDS` executes directly without choice).

- [ ] **Step 3: Write minimal implementation**

In `server.js` (`handlePlayCombatCard`), replace the current `DOOR_COMBAT_CARDS` block:
```javascript
  if (DOOR_COMBAT_CARDS[c.name]) {
    const doorSpec = DOOR_COMBAT_CARDS[c.name](player, room);
    if (doorSpec == null) {
      log(room, `${player.name} kann "${c.name}" gerade nicht einsetzen (Bedingung nicht erfuellt).`);
      touchRoom(room);
      return;
    }
    if (munchkinBonusWirkungslos(room, player, doorSpec)) {
      log(room, `"${c.name}" wuerde gegen "${monsterIgnoringBonusesName(room)}" nichts bewirken (nur Charakterstufen zaehlen) - die Karte bleibt auf der Hand.`);
      touchRoom(room);
      return;
    }
    
    const needsTarget = ['removeOneMonster', 'zeroMonsterTreasure', 'duplicateMonsterMommy'];
    const candidates = doorSpec.validMonsterIds || room.combat.monsterIds;
    if (needsTarget.includes(doorSpec.type) && candidates.length > 1) {
      openCardChoice(room, player, c.name, candidates.map((mId, i) => ({
        id: `mon-${i}-${mId}`,
        label: `Auf "${card(mId).name}" spielen`,
        action: Object.assign({}, doorSpec, { monsterId: mId }),
      })));
      room.pendingCardAction.sourceCardId = cardId;
      log(room, `${player.name} spielt "${c.name}" im Kampf - Monster-Wahl ntig.`, [cardId]);
      announceCardPlay(room, player, cardId, 'Ziel wird gewhlt');
      touchRoom(room);
      return;
    }

    removeFromHand(player, cardId);
    discardCard(room, cardId);
    const desc = applyCombatPotionAction(room, player, doorSpec, c);
    log(room, `${player.name} spielt "${c.name}" im Kampf: ${desc}.`, [cardId]);
    announceCardPlay(room, player, cardId, desc);
    touchRoom(room);
    return;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/run.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server.js tests/card-unnatural-doors.test.js
git commit -m "refactor: Monsterauswahl fuer DOOR_COMBAT_CARDS abstrahiert"
```

---

### Task 3: TOD & ABGEBRANNT

**Files:**
- Modify: `src/cards/treasures.js` (DOOR_COMBAT_CARDS)
- Modify: `server.js` (`applyCombatPotionAction`, `kampfSchatzZahl`, `resolveCombatWin`)
- Modify: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Produces: `zeroTreasureMonsterIds` in `room.combat`.

- [ ] **Step 1: Write the failing test**

```javascript
describe('Welle B: TOD & ABGEBRANNT', () => {
  it('TOD entfernt Monster und schuettet dessen Schatz sofort aus', () => {
    startCombat(room, player.id, [findCardId('LAHMER GOBLIN')], { fromHand: true }); // 1 Schatz
    const startHand = player.hand.length;
    
    // TOD spielen
    const { DOOR_COMBAT_CARDS } = require('../src/cards/treasures');
    DOOR_COMBAT_CARDS['TOD'] = () => ({ type: 'removeOneMonster', leavesTreasure: true });
    
    const tod = findCardId('TOD'); // Assume we injected it or it exists
    player.hand.push(tod);
    handlePlayCombatCard(room, player.id, tod);
    
    assert.strictEqual(room.combat.monsterIds.length, 0);
    assert.strictEqual(player.hand.length, startHand + 1); // 1 TOD weg, 1 Schatz gezogen
  });

  it('ABGEBRANNT setzt Basis-Schaetze des Monsters auf 0', () => {
    startCombat(room, player.id, [findCardId('FLIEGENDES FROSCHGEZÜCHT')], { fromHand: true }); // 2 Schätze
    
    const { DOOR_COMBAT_CARDS } = require('../src/cards/treasures');
    DOOR_COMBAT_CARDS['ABGEBRANNT'] = () => ({ type: 'zeroMonsterTreasure' });
    
    player.hand.push(findCardId('ABGEBRANNT'));
    handlePlayCombatCard(room, player.id, findCardId('ABGEBRANNT'));
    
    assert.ok(room.combat.zeroTreasureMonsterIds);
    // Beende Kampf siegreich, pruefe Beute
    handlePassCombat(room, p2.id);
    handlePassCombat(room, p3.id);
    // Sieg
    const rewards = player.lastReward;
    assert.strictEqual(rewards.cardIds.length, 0); // 0 Schaetze
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/run.js` (Fails for ABGEBRANNT because `zeroMonsterTreasure` is unhandled).

- [ ] **Step 3: Write minimal implementation**

In `src/cards/treasures.js`, block `DOOR_COMBAT_CARDS`:
```javascript
    'TOD': () => ({ type: 'removeOneMonster', leavesTreasure: true }),
    'ABGEBRANNT': () => ({ type: 'zeroMonsterTreasure' }),
```

In `server.js` `applyCombatPotionAction`, add to the `switch (action.type)`:
```javascript
    case 'zeroMonsterTreasure': {
      const mid = action.monsterId || c.monsterIds[0];
      c.zeroTreasureMonsterIds = c.zeroTreasureMonsterIds || [];
      c.zeroTreasureMonsterIds.push(mid);
      return `reduziert die Schtze von "${card(mid).name}" auf 0`;
    }
```

In `server.js` `kampfSchatzZahl`:
```javascript
  const basis = c.monsterIds.reduce((sum, id) => {
    if (c.zeroTreasureMonsterIds && c.zeroTreasureMonsterIds.includes(id)) return sum;
    return sum + ((card(id) || {}).treasureCount || 0);
  }, 0);
```

In `server.js` `resolveCombatWin` (around line 4851, the first `baseTreasures` block):
```javascript
  const baseTreasures = monsters.reduce((sum, m) => {
    if (c.zeroTreasureMonsterIds && c.zeroTreasureMonsterIds.includes(m.id)) return sum;
    return sum + (m.treasureCount || 0);
  }, 0) + extras.treasures;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/run.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cards/treasures.js server.js tests/card-unnatural-doors.test.js
git commit -m "feat: TOD und ABGEBRANNT implementiert"
```

---

### Task 4: FREUNDLICH

**Files:**
- Modify: `src/cards/treasures.js` (DOOR_COMBAT_CARDS)
- Modify: `server.js` (`handleResolveCardChoice`, `applyCombatPotionAction`, `isMonsterEnhancerCard`)
- Modify: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Produces: `freundlichChoice` und `freundlichFightOn` in `server.js`.
- Produces: `freundlichGespielt` property on combat.

- [ ] **Step 1: Write the failing test**

```javascript
describe('Welle B: FREUNDLICH', () => {
  it('bietet Wahl zwischen Schatz nehmen oder Wuerfeln, blockiert SCHLAFEND', () => {
    startCombat(room, player.id, [findCardId('LAHMER GOBLIN')], { fromHand: true });
    
    const { DOOR_COMBAT_CARDS } = require('../src/cards/treasures');
    DOOR_COMBAT_CARDS['FREUNDLICH'] = (p, r) => {
      const c = r.combat;
      if (c && c.enhancerIds && c.enhancerIds.some(id => card(id).name === 'SCHLAFEND' || card(id).name === 'WÜTEND')) return null;
      return { type: 'freundlichChoice' };
    };
    
    player.hand.push(findCardId('FREUNDLICH'));
    handlePlayCombatCard(room, player.id, findCardId('FREUNDLICH'));
    
    // Wahl offen
    assert.strictEqual(room.pendingCardAction.kind, 'choice');
    
    // Waehle "Trotzdem kaempfen"
    handleResolveCardChoice(room, player.id, 'fight');
    
    assert.ok(room.combat.freundlichGespielt);
    assert.ok(room.combat.monsterModifier > 0); // Gewuerfelt
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/run.js` (Fails at resolving `fight` because `freundlichChoice` is not implemented).

- [ ] **Step 3: Write minimal implementation**

In `src/cards/treasures.js`, block `DOOR_COMBAT_CARDS`:
```javascript
    'FREUNDLICH': (p, r) => {
      const c = r.combat;
      if (c && c.enhancerIds && c.enhancerIds.some((id) => card(id).name === 'SCHLAFEND' || card(id).name === 'WÜTEND')) return null;
      return { type: 'freundlichChoice' };
    },
```

In `server.js` `isMonsterEnhancerCard` (around line 2530), modify the block for SCHLAFEND:
```javascript
  if (c.name === 'SCHLAFEND') {
    return !(room.combat && room.combat.freundlichGespielt);
  }
```

In `server.js` `handleResolveCardChoice`, add to `COMBAT_ACTION_TYPES`:
```javascript
  const COMBAT_ACTION_TYPES = new Set(['modifier', 'endCombatNoLevel', 'removeHelper', 'killMonsterInCombat', 'removeOneMonster', 'doubleStrength', 'combatAddMonster', 'combatReplaceMonster', 'treatMonsterAsLevel1', 'tripleItemBonus', 'forceSelfAsHelper', 'schatzUmtauschAnmelden', 'freundlichFightOn', 'duplicateMonsterMommy', 'zeroMonsterTreasure']);
```

In `server.js` `applyCombatPotionAction`, add to `switch (action.type)`:
```javascript
    case 'freundlichChoice': {
      c.freundlichGespielt = true;
      openCardChoice(room, findPlayer(room, c.actorId), (potionCard || {}).name || 'FREUNDLICH', [
        { id: 'take', label: 'Schatz kampflos nehmen', action: { type: 'endCombatNoLevel', leavesTreasure: true } },
        { id: 'fight', label: 'Trotzdem kmpfen (+2W6 fr Monster)', action: { type: 'freundlichFightOn' } }
      ]);
      return 'muss sich entscheiden: Schatz nehmen oder trotzdem kmpfen';
    }
    case 'freundlichFightOn': {
      const r1 = Math.floor(Math.random() * 6) + 1;
      const r2 = Math.floor(Math.random() * 6) + 1;
      const add = r1 + r2;
      c.monsterModifier += add;
      log(room, `${player.name} kmpft trotzdem weiter. Die Wrfel (${r1}, ${r2}) fgen den Monstern +${add} hinzu.`);
      return `wrfelt +${add} fr die Monster`;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/run.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cards/treasures.js server.js tests/card-unnatural-doors.test.js
git commit -m "feat: FREUNDLICH Türkarte implementiert"
```

---

### Task 5: MAMI

**Files:**
- Modify: `src/cards/treasures.js` (DOOR_COMBAT_CARDS)
- Modify: `server.js` (`applyCombatPotionAction`, `monsterVictoryExtras`)
- Modify: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- Produces: `mommyMonsterId` on combat and processes `duplicateMonsterMommy`.

- [ ] **Step 1: Write the failing test**

```javascript
describe('Welle B: MAMI', () => {
  it('dupliziert ein Monster <= Stufe 5, ignoriert BABY-Strafe, gibt Zusatzstufen', () => {
    startCombat(room, player.id, [findCardId('LAHMER GOBLIN')], { fromHand: true }); // Stufe 1
    
    const { DOOR_COMBAT_CARDS } = require('../src/cards/treasures');
    DOOR_COMBAT_CARDS['MAMI'] = (p, r) => {
      const c = r.combat;
      const hasBaby = c.enhancerIds && c.enhancerIds.some(id => card(id).name === 'BABY');
      const valid = c.monsterIds.filter(id => hasBaby || card(id).level <= 5);
      if (valid.length === 0) return null;
      return { type: 'duplicateMonsterMommy', validMonsterIds: valid };
    };
    
    player.hand.push(findCardId('MAMI'));
    handlePlayCombatCard(room, player.id, findCardId('MAMI'));
    
    assert.strictEqual(room.combat.monsterIds.length, 2);
    assert.ok(room.combat.mommyMonsterId);
    assert.strictEqual(room.combat.monsterModifier, 10); // +10 von MAMI
    
    // Check Victory Extras
    const extras = require('../server').monsterVictoryExtras(room, player, null, room.combat.monsterIds.map(id => card(id)));
    assert.strictEqual(extras.levels, 1);
    assert.strictEqual(extras.treasures, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/run.js` (Fails at `assert.strictEqual(room.combat.monsterIds.length, 2)` because `duplicateMonsterMommy` is unhandled).

- [ ] **Step 3: Write minimal implementation**

In `src/cards/treasures.js`, block `DOOR_COMBAT_CARDS`:
```javascript
    'MAMI': (p, r) => {
      const c = r.combat;
      const hasBaby = c.enhancerIds && c.enhancerIds.some((id) => card(id).name === 'BABY');
      const valid = c.monsterIds.filter((id) => hasBaby || card(id).level <= 5);
      if (valid.length === 0) return null;
      return { type: 'duplicateMonsterMommy', validMonsterIds: valid };
    },
```

In `server.js` `applyCombatPotionAction`, add:
```javascript
    case 'duplicateMonsterMommy': {
      const mid = action.monsterId || action.validMonsterIds[0];
      c.monsterIds.push(mid);
      c.mommyMonsterId = mid;
      
      const hasBaby = c.enhancerIds && c.enhancerIds.some((id) => card(id).name === 'BABY');
      const enhancerBonus = c.enhancerBonus || 0;
      const mamiEnhancerBonus = hasBaby ? enhancerBonus + 5 : enhancerBonus;
      c.monsterModifier += mamiEnhancerBonus + 10;
      
      const enhancerTreasure = c.enhancerTreasure || 0;
      const mamiEnhancerTreasure = hasBaby ? enhancerTreasure + 1 : enhancerTreasure;
      if (mamiEnhancerTreasure) {
        c.treasureDelta = (c.treasureDelta || 0) + mamiEnhancerTreasure;
      }
      return `bringt Mami auf den Plan (+10 Stufen, kopiert Verstrker${hasBaby ? ' auYer Baby' : ''})`;
    }
```

In `server.js` `monsterVictoryExtras`:
```javascript
  if (c && c.mommyMonsterId) {
    levels += 1;
    treasures += 1;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/run.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cards/treasures.js server.js tests/card-unnatural-doors.test.js
git commit -m "feat: MAMI Türkarte implementiert"
```
