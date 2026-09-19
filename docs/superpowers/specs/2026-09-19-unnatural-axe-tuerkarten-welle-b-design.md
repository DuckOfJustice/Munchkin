# Unnatural Axe, Türkarten Welle B

Datum: 2026-09-19
Karten: **EDELMUT, TOD, ABGEBRANNT, FREUNDLICH, MAMI**

Die zweite von drei Wellen der Türkarten deckt die verbleibenden kartenbasierten Kampf-Effekte sowie die komplexe Verteilkarte EDELMUT ab.

## 1. Ausgangslage & Zielsetzung

Die Karten greifen tief in den Kampf (Monster-Eigenschaften, Schätze, Vervielfachungen) oder in spielerübergreifende Interaktionen ein. Die bestehenden Primitive aus Welle 3 und Welle A (`DOOR_COMBAT_CARDS`, `monsterVictoryExtras`, `openQueuedCardAction`, Monsterauswahl bei `removeOneMonster`) bieten das perfekte Fundament.

**Ziel:** Alle 5 Karten vollständig und mit sauberen Randfall-Prüfungen implementieren.

## 2. Architektur-Details der einzelnen Karten

### 2.1 EDELMUT (Türkarte / Fluch)
*Text: "Du musst jedem anderen Spieler einen Gegenstand geben, die du im Spiel hast. Wenn du keine Gegenstände mehr hast, darf jeder, der nichts bekommen hat, zwei Karten aus deiner Hand ziehen, bis du keine Karten mehr hast. Du wählst die Reihenfolge, wer welchen Gegenstand erhält."*

- **Einordnung:** `category: 'door_other'`. Wird in `DOOR_OTHER_AS_CURSE` aufgenommen (ist dort bereits, war bisher aber ein Dummy `() => null`).
- **Ablauf (Neues Primitiv `curseEdelmut`):**
  - Ermittelt die Liste der anderen Mitspieler:innen (`playerQueueFrom(room, victim, 'after')`).
  - Nutzt `openQueuedCardAction`. Das *Opfer* handelt in jedem Schritt der Queue.
  - Im Queued-Callback für jede:n Mitspieler:in:
    - Hat das Opfer noch **angelegte Gegenstände** (`equippedItemIds(victim)`): Dialog (`chooseCard`) öffnet sich für das Opfer. Opfer wählt einen Gegenstand. Dieser wird abgelegt und in die **Hand** der/des Mitspieler:in transferiert.
    - Hat das Opfer **keine angelegten Gegenstände mehr**: Die/Der Mitspieler:in zieht automatisch bis zu 2 zufällige Handkarten aus der Hand des Opfers (analog zu "Dieb stiehlt" oder "Schlimme Dinge", random draw via `takeRandomFromHand`).
    - Hat das Opfer auch **keine Handkarten mehr**: Der Schritt entfällt lautlos ("bis du keine Karten mehr hast").

### 2.2 TOD (Türkarte)
*Text: "Das Monster kämpft nicht. Es ist tot, Jim. Nimm sein Zeug. Spiele auf ein beliebiges Monster aus. Diejenigen, die es bekämpft haben, können seinen Schatz kampflos übernehmen. Da es bereits tot ist, steigt niemand als Kampfbelohnung in der Stufe auf."*

- **Einordnung:** `DOOR_COMBAT_CARDS`.
- **Aktion:** `{ type: 'removeOneMonster', leavesTreasure: true }`.
- **Anpassung in `server.js` (`handlePlayCombatCard`):** Die Monsterauswahl bei mehreren Monstern (`if (spec.type === 'removeOneMonster' && room.combat.monsterIds.length > 1)`) muss *vor* den Aufruf von `DOOR_COMBAT_CARDS` gezogen werden (bzw. auf beide angewendet werden), damit der Spieler bei 2+ Monstern das Ziel von TOD wählen kann.

### 2.3 ABGEBRANNT (Türkarte)
*Text: "Während beliebigem Kampf spielen. Dieses Monster hat keinen einzigen Schatz."*

- **Einordnung:** `DOOR_COMBAT_CARDS`.
- **Aktion:** `{ type: 'zeroMonsterTreasure' }`. Bei mehreren Monstern wird wie bei TOD ein Monster gewählt.
- **Mechanik (`applyCombatPotionAction`):** Markiert die Monster-ID im Kampf (`c.zeroTreasureMonsterIds.push(monsterId)`).
- **Auswirkung:** In `kampfSchatzZahl` und `resolveCombatWin` liefert das markierte Monster als Basiswert `0` Schätze (statt `m.treasureCount`). Eventuelle `treasureDelta`-Boni von Modifikatoren auf dem Monster (z.B. +2 Schätze durch GIGANTISCH) verfallen für dieses Monster ebenfalls, da "keinen einzigen Schatz" absolut gilt.

### 2.4 FREUNDLICH (Türkarte)
*Text: "Im Kampf ausspielbar. Alle vorhandenen Monster überlassen dir ihren Schatz kampflos. Wenn du trotzdem kämpfen willst, würfle zweimal [...] und füge die Anzahl der Stufen jedem verletzten Monster zu. Nicht kompatibel mit Wütend oder Schlafend [...]."*

- **Einordnung:** `DOOR_COMBAT_CARDS`.
- **Validierung:** `doorSpec` liefert `null`, wenn `SCHLAFEND` (oder `WÜTEND`) bereits im Kampf liegt (`c.enhancerIds`).
- **Sperrwirkung:** `isMonsterEnhancerCard` verbietet das spätere Ausspielen von `SCHLAFEND`, wenn `FREUNDLICH` bereits liegt (`c.freundlichGespielt = true`).
- **Ablauf:**
  - Gibt `{ type: 'freundlichChoice' }` zurück.
  - Das Choice-Primitiv fragt den **Hauptkämpfenden (`c.actorId`)**:
    - *Schatz kampflos nehmen*: Führt `{ type: 'endCombatNoLevel', leavesTreasure: true }` aus (alle Monster verschwinden, Kampf endet, Schatz wird verteilt).
    - *Trotzdem kämpfen*: Würfelt sofort 2W6. Der Gesamtwert wird der Monsterseite gutgeschrieben (`c.monsterModifier += 2d6 * c.monsterIds.length` oder kampfweit, falls so formuliert). Der Wurf wird im Log protokolliert.

### 2.5 MAMI (Türkarte)
*Text: "Darf ausgespielt werden für ein Monster mit Stufe 5 oder niedriger oder für ein Baby-Monster. Ein weiteres Monster derselben Art erscheint, das 10 Stufen höher ist. Mami ist ein einzelnes Monster, das von allen Verbesserungen ihres Babys betroffen ist, außer der Baby-Karte selbst. Dasselbe gilt für Schlimme Dinge. Wenn Mami besiegt wird, ziehe den Schatz und steige so viele Stufen auf, wie das Baby besitzt, plus einen zusätzlichen Schatz und eine zusätzliche Stufe."*

- **Einordnung:** `DOOR_COMBAT_CARDS`.
- **Validierung:** Prüft `c.monsterIds`, ob ein Monster `m.level <= 5` hat ODER ob der Verstärker `BABY` im Kampf liegt (`c.enhancerIds` check auf 'BABY').
- **Aktion:** `{ type: 'duplicateMonsterMommy' }` (mit Monsterauswahl bei mehreren Zielen).
- **Mechanik (`applyCombatPotionAction`):**
  - Dupliziert das Ziel-Monster (`c.monsterIds.push(monsterId)`), analog zu KUMPEL.
  - Merkt sich die Klon-Identifikation in `c.mommyMonsterId = monsterId`.
  - Addiert `+10` Stufen auf `c.monsterModifier`.
  - *Randfall Baby-Umkehrung:* Falls `BABY` als Verstärker liegt, hat es den generellen `monsterModifier` bereits um -5 gesenkt. Da Mami von Baby nicht betroffen ist, muss Mami diese -5 ignorieren, effektiv erhält `c.monsterModifier` hierfür nochmal `+5` als Kompensation.
  - Registriert in `monsterVictoryExtras` beim Sieg +1 Stufe und +1 Schatz extra, wenn das Mami-Monster besiegt wird.

## 3. Randfälle und Entscheidungen (Rulings)
1. **EDELMUT-Empfänger:** Erhaltene Gegenstände wandern auf die Hand der Mitspieler:innen, nicht direkt in deren Ausrüstung (Munchkin Standardverhalten bei "geben").
2. **TOD und Monsterauswahl:** Der Code zur Monsterauswahl in `handlePlayCombatCard` wird umstrukturiert, sodass er nicht nur für Kampf-Tränke (`isCombatPotionCard`), sondern generisch für `DOOR_COMBAT_CARDS` funktioniert, die ein `removeOneMonster` oder ähnliche Auswahl erfordern.
3. **FREUNDLICH Würfeln:** Das 2W6-Würfeln wird serverseitig und ohne Benutzerinteraktion im Choice-Callback aufgelöst, um den Fluss nicht zu unterbrechen.
4. **MAMI und Baby-Verstärker:** Die Identifikation, ob das Monster "Baby" ist, hängt entweder an der Basiskarte (`m.name.includes('BABY')`) oder am Vorhandensein der Verstärker-Karte `BABY` im Kampf.

## 4. Spec Self-Review Ergebnis
- **Vollständigkeit:** Alle 5 Karten besprochen. Randfälle adressiert.
- **Konsistenz:** Fügt sich nahtlos in die bestehenden `DOOR_COMBAT_CARDS` und das Fluch-System ein.
- **Mögliche Konflikte:** Die Verallgemeinerung des `removeOneMonster`-Choice-Dialogs in `server.js` ist der heikelste Eingriff, wird aber isoliert testbar sein.
