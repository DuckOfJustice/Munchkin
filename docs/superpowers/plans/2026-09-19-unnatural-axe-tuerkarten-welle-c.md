# Implementation Plan: Unnatural Axe Türkarten - Welle C

## Base Branch
Branch off from `main` or continue on `feat/unnatural-axe-tuerkarten-welle-c`.

## Task 1: SCHICKSALHAFTE KARTEN - Frontend Selection UI
- **Files:** `public/client.js`, `public/index.html` (if necessary for CSS)
- **Action:** 
  1. Add a `multiCardSelection` set (similar to `sellSelection`) to track clicked hand cards.
  2. In `render()` (or `renderHand`), if `state.pendingCardAction && state.pendingCardAction.kind === 'multiCardSelection'`, intercept clicks on hand cards to toggle them in `multiCardSelection` instead of showing normal play options. Highlight selected cards.
  3. Render a control bar (like `sellBar`) showing how many cards are selected, with two buttons:
     - "X Karten abwerfen und [Türen] ziehen" -> `socket.emit('resolveMultiCardSelection', { cardIds, deck: 'door' })`
     - "X Karten abwerfen und [Schätze] ziehen" -> `socket.emit('resolveMultiCardSelection', { cardIds, deck: 'treasure' })`

## Task 2: SCHICKSALHAFTE KARTEN - Backend Logic
- **Files:** `server.js`, `src/cards/reactions.js`, `tests/card-unnatural-doors-c.test.js`
- **Action:**
  1. Add `SCHICKSALHAFTE KARTEN` to `DOOR_POWER_CARDS` returning `{ type: 'multiCardSelection', actionType: 'schicksalhafteKarten' }`.
  2. In `server.js`, handle `multiCardSelection` in `playDoorPower` to set the `pendingCardAction`.
  3. Add `socket.on('resolveMultiCardSelection')` handler in `server.js`.
  4. Discard the selected cards via `discardCard()`. Draw the same amount of face-down cards from the requested deck (`drawDoor` or `drawTreasure`). Close action.
  5. Write tests ensuring the correct amount is discarded and drawn.

## Task 3: FINDE EINE KARTE - Backend Choice Flow
- **Files:** `server.js`, `src/cards/reactions.js`, `tests/card-unnatural-doors-c.test.js`
- **Action:**
  1. Add `FINDE EINE KARTE` to `DOOR_POWER_CARDS` returning `{ type: 'findeEineKarte' }`.
  2. In `playDoorPower`, handle `findeEineKarte`. 
     - Check if `doorDeck` has 3 cards (call `shuffleDiscardIntoDeck('door')` if needed).
     - Pull the top 3 cards from `doorDeck`.
     - Store them in `room.pendingCardAction = { kind: 'choice', ... context: { cardsToSort: [...] } }`.
     - Ask "Welche Karte soll ganz NACH OBEN auf das Deck?".
  3. In `handleResolveCardChoice`, add `FINDE_EINE_KARTE_SORT` logic. 
     - On first pick: store pick in `context.sortedCards`, present second dialog for remaining 2 cards ("Welche Karte soll als ZWEITES auf das Deck?").
     - On second pick: unshift the 3 cards back onto `doorDeck` in reverse order (last unshifted ends up on top), clear `pendingCardAction`, and end.
  4. Write tests ensuring the deck order matches the player's choices.
