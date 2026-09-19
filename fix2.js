const fs = require('fs');
let text = fs.readFileSync('docs/superpowers/plans/2026-09-19-unnatural-axe-schaetze-welle-c.md', 'utf8');
text = text.replace('- [ ] **Step 1: Write tests**', '- [x] **Step 1: Write tests**')
           .replace('- [ ] **Step 2: Implement UI flow in `server.js`**', '- [x] **Step 2: Implement UI flow in `server.js`**')
           .replace('- [ ] **Step 3: Add to `COMBAT_POTION_OVERRIDES`**', '- [x] **Step 3: Add to `COMBAT_POTION_OVERRIDES`**')
           .replace('- [ ] **Step 4: Verify tests**', '- [x] **Step 4: Verify tests**')
           .replace('- [ ] **Step 5: Commit**', '- [x] **Step 5: Commit**');
text += `
### Task 4: FLOHMARKT & BUMERANGDOLCH
- [x] Implemented Flohmarkt using chained openCardChoice in applyPrimitiveAction.
- [x] Implemented Bumerangdolch using room.bumerangReturns intercepted at handleSellItems, stealItemFrom, and discardCard (for curses), restored on endTurn.
- [x] Added tests.
`;
fs.writeFileSync('docs/superpowers/plans/2026-09-19-unnatural-axe-schaetze-welle-c.md', text);
