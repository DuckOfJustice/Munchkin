### Task 4: Menschen-Begriff und die zwei Menschen-Boni

**Files:**
- Modify: `src/cards/passives.js` (neue Hilfsfunktion, zwei Einträge in `MONSTER_TRAIT_BONUS`)
- Test: `tests/card-unnatural-monsters.test.js`

**Interfaces:**
- Consumes: `monsterSeesRace` wird der Fabrik heute **nicht** übergeben — die Fabrik bekommt `{ card, hasRace, hasClass, equippedItemIds, istGeschlecht }` (server.js:2564). Dieser Task erweitert den Übergabesatz um `monsterSeesRace`.
- Produces: `istMensch(player)` innerhalb von `passives.js`

- [ ] **Step 1: Test ergänzen**

```js
// --- "Mensch" = keine Rassenkarte -------------------------------------------
[
  ['RIESENKAKERLAKE', 5],  // "+5 gegen Elfen oder Menschen."
  ['GRASGNOLL', 5],        // "+5 gegen Menschen."
].forEach(([monster, erwartet]) => {
  const mitRasse = monsterStaerke(monster, makePlayer({ races: [ZWERG.id] }));
  const ohneRasse = monsterStaerke(monster, makePlayer({}));
  assert.strictEqual(ohneRasse - mitRasse, erwartet,
    `${monster}: Menschen bekommen ${erwartet}`);
});

// Die Kakerlake trifft Elfen ebenso - aber nur einmal, nicht zusaetzlich.
{
  const zwerg = monsterStaerke('RIESENKAKERLAKE', makePlayer({ races: [ZWERG.id] }));
  const elf = monsterStaerke('RIESENKAKERLAKE', makePlayer({ races: [ELF.id] }));
  assert.strictEqual(elf - zwerg, 5, 'Elfen bekommen denselben Bonus');
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node tests/card-unnatural-monsters.test.js`
Expected: FAIL — `RIESENKAKERLAKE: Menschen bekommen 5`

- [ ] **Step 3: `monsterSeesRace` an die Fabrik durchreichen**

In `server.js` Zeile 2564 den Übergabesatz erweitern:

```js
} = passivesFactory({ card, hasRace, hasClass, equippedItemIds, istGeschlecht, monsterSeesRace });
```

`monsterSeesRace` ist eine `function`-Deklaration (server.js:2736) und damit gehoisted — der Aufruf oberhalb ihrer Definition ist zulässig.

In `src/cards/passives.js` die Signatur der Fabrik entsprechend erweitern und oberhalb von `MONSTER_TRAIT_BONUS` ergänzen:

```js
  // "Mensch" ist in Munchkin keine Karte, sondern ihr Fehlen: wer keine
  // Rassenkarte hat, ist Mensch. Geprueft wird durch dieselbe Brille wie alle
  // anderen Monsterboni - wer FALSCHE OHREN traegt, gilt fuer Monster als Elf
  // (und wer spaeter den FALSCHEN BART traegt, als Zwerg) und damit nicht als
  // Mensch.
  const istMensch = (p) => !['ELF', 'ZWERG', 'HALBLING', 'ORK', 'GNOM']
    .some((r) => monsterSeesRace(p, r));
```

- [ ] **Step 4: Die zwei Einträge ergänzen**

In `MONSTER_TRAIT_BONUS`, im Unnatural-Axe-Block:

```js
    // "+5 gegen Elfen oder Menschen." - eine Regel, nicht zwei: ein Elf ist
    // kein Mensch, die Faelle schliessen sich aus.
    'RIESENKAKERLAKE': { wennErfuellt: (p) => monsterSeesRace(p, 'ELF') || istMensch(p), bonus: 5 },
    'GRASGNOLL': { wennErfuellt: (p) => istMensch(p), bonus: 5 },   // "+5 gegen Menschen."
```

- [ ] **Step 5: Test laufen lassen, Erfolg prüfen**

Run: `node tests/card-unnatural-monsters.test.js && npm test`
Expected: beide grün.

- [ ] **Step 6: Commit**

```bash
git add server.js src/cards/passives.js tests/card-unnatural-monsters.test.js
git commit -m "Unnatural Axe: Menschen-Begriff fuer Riesenkakerlake und Grasgnoll"
```

---

