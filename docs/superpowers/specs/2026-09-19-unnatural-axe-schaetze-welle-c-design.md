# Unnatural Axe Treasure Cards - Welle C

## Goal
Implement the remaining 6 Unnatural Axe treasure cards in the Munchkin project: GESEGNETER HAMMER VON ST. UUUAAAAH, BUMERANGDOLCH, HELM FÜR PERIPHERES SEHEN, ALUFOLIEN-HUT, JUCKPULVER, FLOHMARKT.

## Cards & Requirements

1. **GESEGNETER HAMMER VON ST. UUUAAAAH**
   - **Type:** treasure (2 Hände, Bonus: +4)
   - **Text:** Der Träger dieses Hammers hat die Kräfte eines Priesters in Bezug auf Untote. Er kann bis zu drei Karten im Kampf ablegen und erhält für jede einen Bonus von +3.
   - **Requirement:** Adds a special `useClassCombatDiscard` check. If the player has this hammer equipped and the combat involves an Undead monster, the player gets a "GESEGNETER HAMMER" discard action (up to 3 cards for +3 each).

2. **BUMERANGDOLCH**
   - **Type:** treasure (1 Hand, Bonus: +1)
   - **Text:** Wird dieser Wurfdolch gestohlen, an einen Fluch verloren oder für eine Stufe verkauft, kehrt er am Anfang des nächsten Zuges zum Besitzer zurück. Wird er gehandelt, geplündert oder verschenkt, wird er dem neuen Besitzer treu. Nur bei Tod oder Schlimmen Dingen geht er permanent verloren. Die Karte kehrt auch zurück, wenn sie sich nach dem Diebstahl bewegt.
   - **Requirement:** This is extremely complex. The card must return at the start of the next turn to its original owner. We need to store state on the card (who it returns to and when) when it is discarded/lost via specific events (curse, steal, sell). 
   - **Simplification / Approximation:** Given the massive complexity of "Die Karte kehrt auch zurück, wenn sie sich nach dem Diebstahl bewegt", the most reliable implementation is: Whenever the Bumerangdolch leaves the player's possession via Steal, Curse, or Sell, it is placed in a special "limbo" state or marked with a timer. At the start of that player's next turn, it returns to their hand.

3. **HELM FÜR PERIPHERES SEHEN**
   - **Type:** treasure (Kopf, Bonus: +2)
   - **Text:** Dieser Helm verleiht auch komplette Immunität gegen Diebeskräfte. Dem Träger kann nicht in den Rücken gefallen werden und Diebe können ihm nichts stehlen.
   - **Requirement:** `handleUseClassSkill` (Dieb) must be blocked if the target has this helm equipped.

4. **ALUFOLIEN-HUT**
   - **Type:** treasure (Kopf, Bonus: null)
   - **Text:** Der Träger ist völlig immun gegen die Flüche anderer Spieler. (Durch Tür eintreten erhaltene Flüche wirken wie üblich.)
   - **Requirement:** `handlePlayCurse` must be blocked if the target has this helm equipped, UNLESS the player drew it face up or played it on themselves.

5. **JUCKPULVER**
   - **Type:** treasure_other (Kampftrank)
   - **Text:** Während beliebigem Kampf spielen. Das Opfer muss ein Kleidungs- oder Rüstungsstück ablegen, das *du* bestimmst. (Waffen und Schilde sind weder Kleidung noch Rüstung.) Nur einmal einsetzbar.
   - **Requirement:** In combat, when played, prompts the player of JUCKPULVER to select a target (actor or helper), then prompts them to select an equipped armor, head, or feet item of that target to discard.

6. **FLOHMARKT**
   - **Type:** treasure_other
   - **Text:** Spiele diese Karte aus, sobald du sie hast oder wann immer später dein Zug ist. Wähle einen Gegenstand und lege ihn ab. Wühle dann durch den Ablagestapel und wähle *zwei* Gegenstände, *beide* weniger oder gleich viel wert wie der abgelegte.
   - **Requirement:** Playable from hand on your turn (if not in combat). Prompts player to select an item from hand/equipped to discard. Then displays the treasure discard pile, allowing them to pick 2 items whose individual gold values are <= the discarded item's value.

## Architecture & Integration
- **GESEGNETER HAMMER**: Modify `useClassCombatDiscard` check for Priester-like abilities against Undead. Add tracking to `room.combat.priestDiscards` for the Hammer limit (max 3).
- **HELM FÜR PERIPHERES SEHEN**: Modify `handleUseClassSkill` to block Stehlen and Rücken fallen.
- **ALUFOLIEN-HUT**: Modify `playCurse` (or where it's applied) to block if played by another player.
- **JUCKPULVER**: Add a custom `COMBAT_POTION_OVERRIDES` entry that spawns a `pendingCardAction` for target selection and item selection.
- **FLOHMARKT**: Add a handler in `handlePlayAnytimeCard` for Flohmarkt. Set `pendingCardAction` with a multi-step flow (discard item -> select 2 from discard).

*(Note: Bumerangdolch will be excluded for now if it requires too much engine rework, or implemented via a simple `room.pendingBumerang` queue checked in `startTurn`.)*
