# Design Spec: Unnatural Axe Schatzkarten – Welle A

## Scope
10 Karten, die ausschließlich durch Einträge in bestehende Datentabellen
(`SPECIAL_SLOT_ITEMS`, `ITEM_CONDITIONAL_BONUS`, `FLEE_ITEM_BONUS`,
`ITEM_GRANTS_TRAIT`, `ATTACHMENT_CARDS`) und minimale Logik-Ergänzungen
funktionsfähig werden. Keine neuen UI-Elemente, keine neuen Socket-Events.

---

## Karten und ihre Einträge

### 1. Platzlose Gegenstände → `SPECIAL_SLOT_ITEMS`
Diese Karten liegen in `cards.json` als `category: 'treasure_other'` ohne
`slotKind`. Ohne Eintrag in `SPECIAL_SLOT_ITEMS` lässt `handleEquipItem`
sie nicht anlegen.

| Karte | Bonus | Gold | Eintrag |
|---|---|---|---|
| **BEGLEITER** | +3 | 400 | `{ slot: 'special' }` |
| **FÜRCHTERLICHE FALSCHE ZÄHNE** | +1 | 200 | `{ slot: 'special' }` |
| **GANZ HEILIGES BUCH** | +3 | 400 | `{ slot: 'special' }` |
| **TASCHE MIT KRÄHENFÜSSEN** | – | 200 | `{ slot: 'special' }` |
| **SÜSSER SCHULTERDRACHE** | +2 | 600 | `{ slot: 'special' }` |
| **STACHELIGER GENITALSCHONER** | +2 | 600 | `{ slot: 'special' }` |
| **FALSCHER BART** | – | 100 | `{ slot: 'special' }` |

### 2. Bedingte Kampfboni → `ITEM_CONDITIONAL_BONUS`
Analog zu `GEILER HELM` (+2 für Elfen) und `SCHÄDELHELM` (+2 für Orks).

| Karte | Regel |
|---|---|
| **SÜSSER SCHULTERDRACHE** | `(player) => istGeschlecht(player, 'w') ? 2 : 0` |
| **STACHELIGER GENITALSCHONER** | `(player) => istGeschlecht(player, 'm') ? 2 : 0` |

### 3. Flucht-Bonus → `FLEE_ITEM_BONUS`
Analog zu `STIEFEL ZUM ECHT SCHNELLEN DAVONLAUFEN` (+2).

| Karte | Wert |
|---|---|
| **TASCHE MIT KRÄHENFÜSSEN** | `1` |
| **BELAGERUNGSMASCHINE** | `-1` |

### 4. Rassen-Trait → `ITEM_GRANTS_TRAIT`
Analog zu `FALSCHE OHREN` (Elf-Trait).

| Karte | Eintrag |
|---|---|
| **FALSCHER BART** | `{ race: 'ZWERG', nurMonster: true }` |

Der Kartentext sagt: „Erlaubt dem Träger, zwerg-exklusive Gegenstände zu
nutzen. Monster reagieren auch, als wäre der Träger ein Zwerg. Gibt keine
sonstigen Zwergen-Fähigkeiten." Das `nurMonster: true`-Pattern aus
`FALSCHE OHREN` deckt genau das ab: Monster sehen den Träger als Zwerg,
und die Ausrüstungsprüfung lässt Zwergen-Items zu, aber es gibt keine
echte Rassenfähigkeit (kein extra Big-Item-Tragen).

### 5. Kartenanhang → `ATTACHMENT_CARDS`
Analog zu `VERGIFTET` und `GESEGNET`.

| Karte | Eintrag |
|---|---|
| **… DER VERDAMMNIS** | `{ bedingung: 'kampfbonus', label: 'der Verdammnis' }` |

Der Bonus (+2) steht bereits im `bonus`-Feld der Karte in `cards.json`,
genau wie bei `VERGIFTET`. `attachmentBonusSum` addiert ihn automatisch.

### 6. BELAGERUNGSMASCHINE – Big-Item-Ausnahme
Der Kartentext sagt: „Zählt nicht gegen die Zahl der Großen Gegenstände."

Die `BELAGERUNGSMASCHINE` ist in `cards.json` als `category: 'item'` mit
`slotKind: 'hand'` und `hands: 2` definiert. In `src/cards/bigitems.js`
steht sie **nicht** in `BIG_ITEMS`. Da `istGrosserGegenstand` nur für
Karten in `BIG_ITEMS` `true` zurückgibt, zählt sie schon jetzt nicht als
Großer Gegenstand → **keine Code-Änderung nötig**.

Flucht-Malus (-1): siehe Abschnitt 3 (`FLEE_ITEM_BONUS`).

Der Kartentext erwähnt eine Wahl „ob du am Anfang des Kampfes in der
Belagerungsmaschine bist". Wir vereinfachen: der -1 Flucht-Malus gilt
immer, wenn die Maschine angelegt ist. Eine aktive Kampfstart-Wahl wäre
ein neues UI-Element und steht in keinem Verhältnis zum Nutzen.

### 7. KRAKZILLA-SCHWERT – Flucht-Zwang
Teilweise implementiert: `ITEM_CONDITIONAL_BONUS` negiert den +4 Bonus
gegen Krakzilla bereits.

**Fehlend:** „Hast du dieses Schwert ausgespielt und triffst auf Krakzilla,
*musst* du versuchen, Wegzulaufen!"

Umsetzung: In `resolveCombat` (server.js), analog zum bestehenden
`angstVorUntoten`-Pattern, eine neue Prüfung:

```javascript
const krakzillaZwang = room.combat.monsterIds.some(
  (id) => (card(id) || {}).name === 'KRAKZILLA'
) && equippedItemIds(findPlayer(room, c.actorId)).some(
  (id) => (card(id) || {}).name === 'ALLES AUSSER KRAKZILLA ABSCHLACHTENDES SCHWERT'
);
```

`krakzillaZwang` wird zu `kampfVerloren` hinzugefügt:
```javascript
const kampfVerloren = lustOhneHilfe || angstVorUntoten || krakzillaZwang;
```

### 8. PSYCHO-EICHHÖRNCHEN – Genitalschoner-Klausel
Der Kommentar in `passives.js` (Zeile 42–46) vermerkt explizit, dass die
Item-Klausel nachgeholt wird, sobald der Genitalschoner einen Slot hat.

Aktuell:
```javascript
'PSYCHO-EICHHÖRNCHEN': (p) => istGeschlecht(p, 'w'),
```
Wird zu:
```javascript
'PSYCHO-EICHHÖRNCHEN': (p) => istGeschlecht(p, 'w')
  || equippedItemIds(p).some((id) => (card(id) || {}).name === 'STACHELIGER GENITALSCHONER'),
```

---

## Betroffene Dateien

| Datei | Änderungen |
|---|---|
| `src/cards/passives.js` | 7× `SPECIAL_SLOT_ITEMS`, 2× `ITEM_CONDITIONAL_BONUS`, 2× `FLEE_ITEM_BONUS`, 1× `ITEM_GRANTS_TRAIT`, 1× `ATTACHMENT_CARDS`, 1× `MONSTER_REFUSES` Update |
| `server.js` | 1× `resolveCombat` (Krakzilla-Zwang) |
| `tests/card-unnatural-doors.test.js` oder neue Datei | Tests für alle 10 Karten |

## Nicht im Scope
- Kein neues UI
- Keine neuen Socket-Events
- TROJANISCHER PFERD (eigenes Feature)
- Karten aus Welle B/C
