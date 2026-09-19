# Unnatural Axe Treasure Cards - Welle C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the remaining 6 Unnatural Axe treasure cards.

**Architecture:** We will implement the simpler cards first (Helm, Alufolien-Hut, Hammer). Then Juckpulver and Flohmarkt (which require UI prompts). We will handle Bumerangdolch last with a start-of-turn queue.

**Tech Stack:** Node.js, Mocha.

**Spec:** docs/superpowers/specs/2026-09-19-unnatural-axe-schaetze-welle-c-design.md

## Global Constraints
- Do not break existing Welle A/B cards.
- Follow existing patterns in `server.js` and `passives.js`.

## Review Focus
- HELM FÜR PERIPHERES SEHEN correctly blocks Thief skills.
- ALUFOLIEN-HUT correctly distinguishes between curses played by self/door vs. other players.
- GESEGNETER HAMMER only works against Undead and limits to 3 discards.

---

### Task 1: HELM FÜR PERIPHERES SEHEN & ALUFOLIEN-HUT

**Files:**
- Modify: `server.js`
- Modify: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- `handleUseClassSkill`: check if target wears `HELM FÜR PERIPHERES SEHEN`.
- `playCurse` (or `handlePlayCurse`): check if target wears `ALUFOLIEN-HUT` and `sourcePlayerId !== targetId`.

- [x] **Step 1: Write tests for both items**
- [x] **Step 2: Run tests (they should fail)**
- [x] **Step 3: Implement blocking logic in `server.js`**
- [x] **Step 4: Verify tests pass**
- [x] **Step 5: Commit**

### Task 2: GESEGNETER HAMMER VON ST. UUUAAAAH

**Files:**
- Modify: `server.js`
- Modify: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- `handleUseClassCombatDiscard`: add check for Hammer when fighting Undead.
- `c.hammerDiscards` counter on the combat object.

- [x] **Step 1: Write test for Hammer against Undead (allows 3 discards for +3 each)**
- [x] **Step 2: Run test (fails)**
- [x] **Step 3: Implement logic**
- [x] **Step 4: Verify tests pass**
- [x] **Step 5: Commit**

### Task 3: JUCKPULVER

**Requirements:** "Während beliebigem Kampf spielen. Das Opfer muss ein Kleidungs- oder Rüstungsstück ablegen, das *du* bestimmst. (Waffen und Schilde sind weder Kleidung noch Rüstung.) Nur einmal einsetzbar."

**Files:**
- Modify: `src/cards/treasures.js`
- Modify: `server.js`
- Modify: `tests/card-unnatural-doors.test.js`

**Interfaces:**
- `COMBAT_POTION_OVERRIDES` in `treasures.js` must set `customTargetChoice: true` or similar, triggering a multi-step action.
- Add `handleJuckpulverTargetSelect` and `handleJuckpulverItemSelect`.

- [x] **Step 1: Write tests**
- [x] **Step 2: Implement UI flow in `server.js`**
- [x] **Step 3: Add to `COMBAT_POTION_OVERRIDES`**
- [x] **Step 4: Verify tests**
- [x] **Step 5: Commit**

### Task 4: FLOHMARKT & BUMERANGDOLCH
- [x] Implemented Flohmarkt using chained openCardChoice in applyPrimitiveAction.
- [x] Implemented Bumerangdolch using room.bumerangReturns intercepted at handleSellItems, stealItemFrom, and discardCard (for curses), restored on endTurn.
- [x] Added tests.
