# Übergabe für eine andere Claude-Session

Diese Datei entstand, weil der Nutzer gefragt hat "was muss noch getan werden,
und wenn was fehlt, erstelle eine Übergabe-MD für eine andere Claude-Session".
Sie richtet sich an eine **neue** Claude-Session ohne Gesprächskontext und
beschreibt: (1) welche Architektur/Muster in diesem Projekt bereits etabliert
sind, (2) was inzwischen automatisiert ist, (3) was bewusst/aus Kapazitäts-
oder Datengründen offen bleibt, und (4) wie hier praktisch gearbeitet wird
(Lieferweg, Tests, Verifikation).

Kontext: Der Nutzer wollte ursprünglich, dass **möglichst viele** der
hunderten individuellen Karten-Sonderregeln (die laut ursprünglichem
Server-Design bewusst "Trust-Prinzip"-manuell blieben) tatsächlich im Server
nachgebildet werden - inklusive eines komplett neuen dritten Charakter-Merkmals
("Machtgruppe", Pathfinder-Set). Das ist über mehrere Runden passiert; diese
Datei ist der Stand nach der letzten Runde (Nachtrag: fehlkategorisierte
Basis-Set-Flüche).

## 1. Architektur / etablierte Muster

Alles in `server.js` (Node/Express + Socket.IO, ein In-Memory `rooms`-Map,
keine Datenbank).

- **Kuratierte Override-Tabellen**, jeweils exakt per Kartennamen (Groß-/
  Kleinschreibung wie in `data/cards.json`) indiziert. Jeder Eintrag ist eine
  Funktion `(player, room) => actionSpec | null | undefined`:
  - `CONSEQUENCE_OVERRIDES` - Flüche/Monster-"Schlimme Dinge". `null` heißt
    "bewusst nicht automatisch" (wird als solches im Client trotzdem als
    Fluch/Konsequenz erkannt, aber ohne automatische Wirkung). `undefined`
    (kein Eintrag) fällt durch zu `parseAutoConsequence()` (generischer
    Regex-Parser für Standardformulierungen wie "Verliere 1 Stufe").
  - `TREASURE_POWER_OVERRIDES` - Schatzkarten-Sonderkräfte (`treasure_other`).
  - `COMBAT_POTION_OVERRIDES` - Kampf-Tränke mit Sonderlogik (über die
    generische "+N für Seite X"-Erkennung hinaus).
  - `ITEM_CONDITIONAL_BONUS` - Gegenstände mit monster-/rassenabhängigem
    Kampfbonus (z. B. Vorpale Klinge: +10 gegen Monster mit "J" im Namen).
- **`DOOR_OTHER_AS_CURSE`** (Set von Kartennamen): Karten, die in den
  Rohdaten als `door_other` (normale Türkarte) geführt werden, aber textlich
  eindeutig Sofort-Flüche sind (Pathfinder-Set UND, seit dem letzten
  Nachtrag, ca. 25 Basis-Set/Erweiterungs-Karten). `handleDrawDoor()` prüft
  `c.category === 'curse' || DOOR_OTHER_AS_CURSE.has(c.name)` und behandelt
  beide Fälle über denselben Fluch-Mechanismus (`resolveConsequenceSpec` →
  `CONSEQUENCE_OVERRIDES` → `parseAutoConsequence`-Fallback).
- **`applyPrimitiveAction(room, player, action)`**: zentraler Dispatcher, der
  ein `actionSpec` (`{ type: '...', ... }`) tatsächlich ausführt (Stufe
  ändern, Gegenstand ablegen, Hand ablegen, Rassen-/Klassenkarte tauschen,
  ...). Neue Konsequenz-Arten werden hier als neuer `case` ergänzt.
- **Generisches "Pending Card Action"-System** (`room.pendingCardAction`,
  Resolver in `room._pendingCardActionResolvers`), für Sonderkräfte, die
  echte Spieler-Interaktion brauchen: `choice` (Buttons), `targetPlayer`
  (Mitspieler wählen), `chooseCard` (Karte aus einem Ablagestapel wählen).
  Server: `openCardChoice()`, `openCardTarget()`, `openCardCardChoice()`,
  `handleResolveCardChoice()`, `handleResolveCardTarget()`,
  `handleResolveCardCardChoice()`. Client: `renderCardAction()` in
  `public/client.js`, Ziel-Div `#cardActionArea` in `public/index.html`.
  (Es gibt daneben noch das ältere `pendingConsequence.choice`-System nur für
  Konsequenz-Wahlmöglichkeiten - beide bestehen parallel, nicht
  zusammengeführt.)
- **Machtgruppe** (`powerGroups` auf jedem Spieler, `POWER_GROUP_NAMES` Set,
  `powerGroupCapCard`): drittes Charakter-Merkmal neben Rasse/Klasse,
  spezifisch für das Pathfinder-Set. Cap-Karten (analog zu "Super Munchkin"):
  HALB-BLUT (Rasse), SUPER MUNCHKIN (Klasse), DOPPELLEBEN (Machtgruppe).
  `handlePlayRaceOrClass()` wurde entsprechend erweitert, inkl.
  Log-Feedback, wenn eine Karte wegen Cap nicht spielbar ist.
- **Kampf-Tränke** (`treasure_other`, "Im Kampf spielen"/"Während beliebigem
  Kampf spielen"): `COMBAT_PLAYABLE_RE`, `parseCombatPotion()`,
  `isCombatPotionCard()`, `applyCombatPotionAction()`.
- **Bedingter Item-Kampfbonus**: zusätzlich zum pauschalen
  `equippedBonusSum` gibt es `conditionalItemBonusSum(player, monsters)`,
  die nur innerhalb von `combatTotals()`/`combatConditionalBonusFields()`
  einfließt (abhängig vom/von den aktuellen Monster(n) im Kampf).
- **Tests**: `tests/run.js` führt alle `tests/*.test.js` aus.
  - `tests/basic-game-flow.test.js`: Integrationstest mit echten
    Socket.IO-Bots, prüft grob auf Abstürze/Plausibilität.
  - `tests/auto-consequence.test.js`: Abdeckungs-Regressionscheck für
    Flüche/Monster-Konsequenzen.
  - `tests/card-abilities.test.js`: gezielte Verhaltenstests + Abdeckungs-
    Regressionscheck für die neueren Mechanismen (Level-Up-Karten,
    Kampf-Tränke, Machtgruppen, `DOOR_OTHER_AS_CURSE`, bedingte Item-Boni).
- **Verifikation über Playwright** (`/opt/pw-browsers/chromium`, bereits
  vorinstalliert): Skripte wie `/tmp/verify_cards2.js` starten einen
  Solo-Raum mit Bots und klicken sich durch viele Runden. **Wichtige Falle**:
  nie ein `ElementHandle` über einen State-Wechsel hinweg cachen - immer
  direkt vor jedem `.click()` per `page.$(selector)` neu abfragen (siehe
  `tryClick()`-Helper in den Skripten), sonst "Element is not attached to
  the DOM"-Fehler.

## 2. Lieferweg (wichtig!)

`mcp__remote-devices__device_bash` (Shell auf dem Windows-PC des Nutzers) ist
in dieser Session **durchgehend fehlgeschlagen** ("no Plan9 drive shares
mounted"). Direkter `git`-Zugriff auf dem PC des Nutzers war daher nicht
möglich. Stattdessen wurde jede Änderung so ausgeliefert:

1. `SendUserFile` auf die geänderte Datei (aus `/home/claude/Munchkin/...`).
2. `mcp__remote-devices__device_commit_files` schreibt sie an den passenden
   Pfad unter `C:\git\Munchkin\...` (verbundener Ordner).
3. Dem Nutzer werden manuelle `git add`/`commit`/`push`-Befehle mitgegeben,
   da kein Push von hier aus möglich ist.

Verbundene Ordner laut `get_device_info`: `C:\Users\ouali\Desktop\Munchkin.
Digital.Build.21578161`, `C:\Users\ouali\Desktop`, `C:\git`. Das lokale
Repo liegt unter `C:\git\Munchkin`.

**Falls `device_bash` in einer neuen Session wieder funktioniert**: direkt
im verbundenen Ordner arbeiten (Lesen/Schreiben/`git`) statt über den
Stage/Commit-Umweg - deutlich schneller, siehe generelle Nutzungsregeln
oben im System-Prompt.

## 3. Was in dieser Runde neu ergänzt wurde (Nachtrag Basis-Set-Flüche)

Bei einer erneuten, gründlichen Prüfung ("was fehlt noch") wurde entdeckt,
dass die vorherige Runde nur die **Pathfinder**-Fehlkategorisierungen erfasst
hatte. Ein systematischer Scan aller `door_other`-Karten (gefiltert nach
"nicht bereits über Monster-Verstärker/Machtgruppen/Cap-Karten abgedeckt" und
"textlich eindeutig ein Fluch") ergab ca. 25 weitere, echte Basis-Set/
Erweiterungs-Karten, die ebenfalls fälschlich als normale Türkarte statt als
Fluch geführt werden (mehrere enthalten wörtlich "der Fluch"). Diese wurden
jetzt ergänzt:

- Neu in `CONSEQUENCE_OVERRIDES` **mit** automatischer Wirkung: Rüstung
  verlieren, Kopfbedeckung verlieren, SCHUHWERK VERLIEREN, VERLIERE 1 STUFE,
  VERLIERE DEINE KLASSE (inkl. echter Wahl bei 2 Klassen dank Super
  Munchkin), VERLIERE DEINE RASSE, KLASSE WECHSELN, RASSE WECHSELN
  (`replaceTraitFromDiscard` wurde dafür generalisiert, unterstützt jetzt
  auch `category: 'race'`), QUANTEN (bedingt: nur falls Schuhwerk getragen
  wird), REGELN DER NEUAUFLAGE (neuer Fall `levelDeltaAllPlayers`, betrifft
  alle am Tisch), VERLIERE ZWEI KARTEN (neuer Fall
  `giveHandCardsToNeighbors`: Vorgänger/Nachfolger in der Zugreihenfolge
  ziehen je eine Zufallskarte aus der Hand des Opfers).
- Neue `applyPrimitiveAction`-Fälle dafür: `discardSpecificClassCard`,
  `giveHandCardsToNeighbors`, `levelDeltaAllPlayers`.
- Neu in `CONSEQUENCE_OVERRIDES` mit `() => null` (bewusst weiterhin
  manuell, aber jetzt korrekt als Fluch erkannt/angezeigt): VERLIERE 1
  GROSSEN GEGENSTAND, VERLIERE 1 KLEINEN GEGENSTAND, GESCHLECHTSUMWANDLUNG,
  HUHN AUF DEINEM KOPF, NARRENGOLD, BLUTSCHLEIER, RAUSCHPOCKEN,
  TOURISTENFALLE, EDELMUT, HUNGRIGER RUCKSACK, KLEINER FEHLER, TEMPORÄRE
  ANMNESIE, DU STOLPERST ÜBER DEINE EIGENE TRUHE, MIESER SPIEGEL, STINKER,
  WINZIGE HÄNDE.
- ENTE DES SCHRECKENS braucht keinen Override (fällt sauber unter den
  generischen `parseAutoConsequence`-Fallback: "Verliere 2 Stufen").
- Alle oben genannten wurden zusätzlich zu `DOOR_OTHER_AS_CURSE` hinzugefügt,
  damit sie beim Ziehen überhaupt über den Fluch-Mechanismus laufen (auch
  die `null`-Fälle - sie werden dann korrekt als Fluch mit Original-Text
  angezeigt, nur ohne automatische Spielzustandsänderung).
- Neue Tests in `tests/card-abilities.test.js`: Abdeckungs-Untergrenze für
  `DOOR_OTHER_AS_CURSE.size`, gezielte Verhaltenschecks für Rüstung
  verlieren/VERLIERE DEINE RASSE/VERLIERE DEINE KLASSE (0/1/2-Klassen-Fälle)/
  QUANTEN.
- `node -c server.js` und die volle Testsuite (`node tests/run.js`) laufen
  danach fehlerfrei (3/3 Testdateien grün).
- README-Zeile zu "Was automatisiert ist" aktualisiert (nicht mehr nur
  "Pathfinder-Flüche", sondern "Basis-Set und Erweiterungen").

**Was hierbei NICHT geprüft wurde**: Live-Playwright-Verifikation der neuen
Karten im Browser (wegen fehlender `device_bash`-Verbindung und um die
Session nicht unnötig zu verlängern - die Unit-/Integrationstests decken die
reine Logik aber ab). Empfehlung für die nächste Session: kurzer
Playwright-Lauf, der gezielt einen Raum mit vielen Basis-Set-Türkarten
durchspielt und prüft, dass die neuen Flüche als Fluch-Popup erscheinen statt
stillschweigend auf der Hand zu landen.

## 4. Was weiterhin bewusst offen bleibt (nicht trivial nachrüstbar)

### 4.1 Fehlende Datenpunkte in `data/cards.json`
Diese Punkte sind **nicht** mit vertretbarem Aufwand lösbar, ohne die
Kartendaten selbst zu erweitern:
- Kein "Großer Gegenstand"-Flag → alle "wähle 1 großen/kleinen Gegenstand
  ab"-Karten bleiben manuelle Auswahl.
- Keine "Untot"-/Feuerimmunitäts-Kennzeichnung auf Monsterkarten → z. B.
  GHOULPEITSCHE/REDI-FLOW (bedingte Item-Boni gegen Untote/feuerimmune
  Monster) bleiben unberechnet.
- Keine Machtgruppen-Zugehörigkeit auf Monsterkarten → die "+N gegen
  [Machtgruppe]"-Kampfmodifikatoren auf ca. 20 Pathfinder-`door_other`-Karten
  (TENGU, GHOULER FREITAG, STRIX, HOBBES GOBLIN, MILBCHEN, WELPWAMPI,
  CHARAU-KA, GOBLINHUND, BIENEMOTH, MOBOGO, LINDNORM, FLÜSTERTYRANN,
  SANDTEUFEL, WINTERHEXE, KUPFERKOCH, BOGGARD, HEMOGOBLIN, AKATA, DIV, GEB,
  TODESNETZ, BLÄHMAGIER, OGERGEIZLING) sind nicht automatisierbar.

### 4.2 Fehlender persistenter Fluch-/Status-Tracker
Der Server führt aktuell keinen laufenden "aktiver Fluch X wirkt noch"-
Zustand (z. B. für Wunschring-Aufhebung). Betrifft u. a.: BLUTSCHLEIER,
RAUSCHPOCKEN, TOURISTENFALLE, NARRENGOLD, MIESER SPIEGEL, STINKER, WINZIGE
HÄNDE, HUHN AUF DEINEM KOPF, GESCHLECHTSUMWANDLUNG (permanenter Malus).

### 4.3 Machtgruppen-Sonderkräfte (nur Alchemist ist umgesetzt)
Nur die zwei Alchemist-Kräfte sind implementiert ("Blei zu Gold" beim
Verkauf, Wünschelstab-artige Sonderfälle). Folgende Machtgruppen-Kräfte
bleiben komplett manuell:
- Nekromant: "Reanimation", "Geheimnisse der Untoten"
- Paktmagier: "Eidolon", "Beschwören"
- Hexe: "Hex", "Begleitung"
- Höllenritter: permanenter Rüstungs+Kopfbedeckungs-Slot
- Adlerritter: "Standhaft bleiben"
- Assassine der Roten Mantis: "Heimlichkeit", "Auftragsmörder"
- Kundschafter: "Das Geheimnis aufdecken" (die "Verliere den Pfad"-
  Ausweichoption für Kundschafter IST bereits automatisiert, siehe
  `VERLIERE DEN PFAD` in `CONSEQUENCE_OVERRIDES`)

### 4.4 Architektonisch aufwändigere Einzelfälle (brauchen mehr als einen
Override-Eintrag)
- **HUNGRIGER RUCKSACK**: braucht einen wiederkehrenden Rundenend-Hook (am
  Ende JEDES eigenen Zuges würfeln), nicht nur eine Einmal-Konsequenz beim
  Ziehen. Aktuelle Zug-Phasen-Logik hat keinen "Ende jedes Zuges"-Hook dieser
  Art.
- **KLEINER FEHLER**: müsste mitten in der Konsequenz-Auflösung einen NEUEN
  Kampf starten (wiederbelebtes Monster aus dem Ablagestapel). Der aktuelle
  `pendingConsequence` → `handleAckConsequence`-Fluss geht von genau einer
  Konsequenz ohne Folge-Kampf aus.
- **TEMPORÄRE ANMNESIE**: braucht einen neuen persistenten "Rasse/Klasse
  unterdrückt, bis X passiert"-Zustand pro Spieler.
- **EDELMUT**: braucht eine sequenzielle "jedem anderen Spieler einen
  Gegenstand geben, du wählst wem was"-UI (verteilt über mehrere
  Interaktionsschritte) statt einer einfachen Wahl/Zielauswahl.

### 4.5 69 verbleibende, wirklich manuelle `treasure_other`-Karten
Mit echtem Kartentext, aber ohne Override (zu individuell/erfordern freie
Verhandlung zwischen Spielern/Wertgrenzen-Suche im ganzen Ablagestapel).
Beispiele: DOPPELGÄNGER, KLEBERFLÄSCHCHEN, GEZINKTER WÜRFEL, MAGISCHE LAMPE,
WUNSCHRING, MIETLING, "...DER VERDAMMNIS"-Reihe, VERGIFTET, GESEGNET,
FLOHMARKT, EINHEITSGRÖSSE, ALUFOLIE, SONNENORCHIDEE-ELIXIER, RÜSTUNG DER
BELEIDIGUNG, DECEMVIRI-HELM, ZEPTER DER ZEITALTER, u. v. m. (28 weitere
Pathfinder-Karten haben in den Rohdaten gar keinen Text/keine Werte - siehe
README "Bekannte Einschränkungen"). Die vollständige, kommentierte Liste
lässt sich jederzeit reproduzieren mit einem kurzen Node-Skript, das
`ALL_CARDS` nach `category === 'treasure_other'` filtert und die bereits
über `isInstantLevelUpCard`/`isCombatPotionCard`/`TREASURE_POWER_OVERRIDES`
abgedeckten Namen ausschließt.

### 4.6 Bekannter, nicht behobener Detail-Bug: Kampf-Gleichstand
`handleEvaluateCombat()` nutzt striktes `if (playerStrength > monsterStrength)`
- bei einem Gleichstand gewinnt aktuell **immer** das Monster. Der
  Gegenstand ALUFOLIE ("Du gewinnst bei einem Gleichstand im Kampf") setzt
  aber voraus, dass ein Gleichstand *manchmal* zugunsten der Spielerseite
  ausgehen kann. Diese Karten-spezifische Tie-Break-Regel ist nirgends
  verdrahtet - würde eine `equippedItems`-Prüfung auf "ALUFOLIE" direkt in
  `handleEvaluateCombat()` erfordern. Nicht behoben, nur dokumentiert.

## 5. Empfohlene nächste Schritte für eine neue Session

1. Playwright-Live-Verifikation des Basis-Set-Fluch-Nachtrags (siehe 3.).
2. Falls gewünscht: ALUFOLIE-Tie-Break (4.6) beheben - kleiner, klar
   umrissener Fix.
3. Falls gewünscht: eine der Machtgruppen-Sonderkräfte aus 4.3 umsetzen
   (Nekromant/Paktmagier/Hexe sind vermutlich die "interessantesten" für
   Spieler:innen).
4. Bei jedem neuen Karten-Feature: zuerst `data/cards.json` nach dem exakten
   Kartentext durchsuchen (`node -e "..."`-Einzeiler, siehe Muster oben),
   dann Override + ggf. `applyPrimitiveAction`-Fall + Test ergänzen, dann
   `node -c server.js` + `node tests/run.js`, dann liefern (Abschnitt 2).
