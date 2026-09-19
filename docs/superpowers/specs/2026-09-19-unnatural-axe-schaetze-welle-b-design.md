# Design Spec: Unnatural Axe Schatzkarten – Welle B

## Scope
5 Karten aus Unnatural Axe (Schätze):
- FEIGHEITSTRANK
- UNGLÄUBIGKEITSTRANK
- KRONLEUCHTER
- REGENMANTEL
- WAPPEN

---

## Karten und Mechanik

### 1. KRONLEUCHTER
- **Typ:** Gegenstand, Kopfbedeckung (2 Bonus, 400 Gold)
- **Kartentext:** „Dieser Gegenstand kann über anderer Kopfbedeckung getragen werden, wenn etwas aber deine Kopfbedeckung entfernt, ist der Kronleuchter auch weg.“
- **Umsetzung:**
  - Erfordert einen Eintrag in `SPECIAL_SLOT_ITEMS` (wie SCHRECKLICHE SOCKEN).
  - `{ slot: 'special', mitSlot: 'head' }`
  - In `cards.json` ist er `category: 'item'` und `slotKind: 'head'`. Da er über `SPECIAL_SLOT_ITEMS` läuft, wird `handleEquipItem` ihn automatisch in `player.equipped.special` ablegen (analog zu GNOMEX-ANZUG).

### 2. REGENMANTEL
- **Typ:** Gegenstand, Rüstung (100 Gold)
- **Kartentext:** „Andere Spieler können deine Kämpfe nicht mit Tränken stören. (Hilft dir jemand im Kampf, können sie wie üblich Tränke für oder gegen dich verwenden.) Dieser Gegenstand kann nur über Rüstung getragen werden, wenn du aber die Rüstung verlierst, ist der Regenmantel auch weg.“
- **Umsetzung:**
  - Eintrag in `SPECIAL_SLOT_ITEMS`: `{ slot: 'special', mitSlot: 'armor' }`
  - In `server.js` (Funktion `handlePlayCombatCard`): Wenn `isCombatPotionCard(c)` true ist, prüfen wir, ob der Spieler ein Fremder ist (weder actor noch helper). Wenn ja, und es gibt keinen Helper (`!room.combat.helperId`), und der actor trägt den `REGENMANTEL`, weisen wir das Ausspielen des Tranks mit einer passenden Meldung ab.

### 3. FEIGHEITSTRANK
- **Typ:** treasure_other, 300 Gold
- **Kartentext:** „Während beliebigem Kampf spielen, um die Munchkins zum Weglaufen zu zwingen, auch wenn sie das Monster besiegen könnten. Nur einmal einsetzbar.“
- **Umsetzung:**
  - In `src/cards/passives.js` (Tabelle `COMBAT_POTION_OVERRIDES`):
    `'FEIGHEITSTRANK': () => ({ type: 'forceFlee' }),`
  - In `server.js` (Funktion `applyCombatPotionAction`):
    Neuen `case 'forceFlee'` hinzufügen, der `room.combat.mustFlee = true` setzt und den Text `"die Munchkins müssen weglaufen"` zurückgibt.

### 4. UNGLÄUBIGKEITSTRANK
- **Typ:** treasure_other, 1000 Gold
- **Kartentext:** „Während beliebigem Kampf spielen. Lege ein Monster ab, niemand erhält dafür eine Stufe. Du darfst den Schatz nur nehmen, wenn du die übrigen Monster besiegst. Nur einmal einsetzbar.“
- **Umsetzung:**
  - In `src/cards/passives.js` (Tabelle `COMBAT_POTION_OVERRIDES`):
    `'UNGLÄUBIGKEITSTRANK': () => ({ type: 'removeOneMonster', leavesTreasure: false, keepTreasureForWin: true }),`
  - In `server.js` (Funktion `applyCombatPotionAction`, `case 'removeOneMonster'`):
    Auswerten von `action.keepTreasureForWin`. Wenn `true`, wird die Schatzzahl des entfernten Monsters ( `m.treasureCount` ) auf `room.combat.treasureDelta` addiert. So wird der Schatz bei einem Gesamtsieg normal mitausgezahlt.

### 5. WAPPEN
- **Typ:** treasure_other, 500 Gold
- **Kartentext:** „Zwei starke, dampfbetriebene Arme verleihen dir die Fähigkeit, mit 2 extra Händen Zeug anzulegen.“
- **Umsetzung:**
  - In `SPECIAL_SLOT_ITEMS`: `{ slot: 'special' }`
  - In `server.js`: `player.equipped.hands` wird derzeit als Array der Länge 2 betrieben (`[null, null]`).
  - Wenn `WAPPEN` ausgerüstet wird, sollte das Array auf 4 erweitert werden. Wenn es abgelegt wird, schrumpft es wieder auf 2 (und überzählige Hand-Karten fallen zurück auf die Hand).
  - Statt das Array umständlich bei jedem Event zu resizen, implementieren wir eine Hilfsfunktion `ensureHandsLength(player)`, die `player.equipped.hands` passend zur Anwesenheit des `WAPPEN`s wachsen lässt.
  - In `handleEquipItem` und `unequipSlotCard` (oder an zentraler Stelle nach Ausrüstungsänderungen) wird `ensureHandsLength` aufgerufen. Wenn die Kapazität sinkt und Plätze belegt sind, fliegen die Gegenstände ans Ende des Arrays in die Hand zurück, bis die Länge wieder 2 ist.
  - ACHTUNG in `handleEquipItem`: `if (kosten === 2) { player.equipped.hands = [cardId, cardId]; }` muss auf die dynamische Länge umgebaut werden (z.B. die ersten beiden verfügbaren `null`-Slots belegen), sonst löscht ein Zweihänder die Extra-Hände des Wappens.

---
## Betroffene Dateien
- `src/cards/passives.js`: `SPECIAL_SLOT_ITEMS` und `COMBAT_POTION_OVERRIDES`
- `server.js`: `handlePlayCombatCard` (Regenmantel-Schutz), `applyCombatPotionAction` (forceFlee, keepTreasureForWin), Handkapazitäts-Logik
- `tests/card-unnatural-doors.test.js`: Neue Testblöcke für alle 5 Karten
