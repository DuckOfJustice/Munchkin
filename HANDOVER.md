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
Datei ist der Stand nach der Runde vom **2026-09-10**: Verifikation des
Basis-Set-Fluch-Nachtrags, ALUFOLIE-Gleichstand behoben, die passiven
Machtgruppen-Kräfte (Höllenritter, Assassine) ergänzt.

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

## 2. Lieferweg

**Erledigt/überholt.** Eine frühere Session musste über
`SendUserFile` + `device_commit_files` ausliefern, weil kein Shell-Zugriff
auf den PC des Nutzers bestand. Seit der Session vom 2026-09-10 läuft Claude
Code direkt in `C:\git\Munchkin` mit normalem Datei- und `git`-Zugriff -
einfach direkt im Repo arbeiten.

Einziger Stolperstein: `node_modules` ist nicht eingecheckt. Nach einem
frischen Clone zuerst `npm install`, sonst schlagen alle Tests mit
`Cannot find module 'express'` fehl (das sieht nach Regression aus, ist aber
nur die fehlende Installation).

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

**Verifikation nachgeholt (2026-09-10), aber anders als hier empfohlen.**
Der vorgeschlagene Playwright-Lauf wäre der schlechtere Test gewesen: er
hätte die fraglichen Karten nur zufällig gezogen und Playwright hätte erst
einen Browser-Download gebraucht. Stattdessen prüft
`tests/card-abilities.test.js` jetzt **deterministisch alle 46** Karten aus
`DOOR_OTHER_AS_CURSE`: Karte auf den Türstapel legen, `handleDrawDoor()`
aufrufen, und dann sicherstellen, dass sie als Fluch aufläuft
(`pendingConsequence.kind === 'curse'`), **nicht** auf der Hand landet, auf
dem Türablagestapel landet und nicht als offene Türkarte hängen bleibt. Dazu
eine Gegenprobe mit einer normalen Türkarte (muss weiterhin auf der Hand
landen), damit der Check nicht trivial durchläuft. Der Test wurde per
Mutation gegengeprüft: entfernt man `DOOR_OTHER_AS_CURSE.has(c.name)` aus
`handleDrawDoor()`, schlägt er fehl.

Zusätzlich neu: ein Check, dass **kein** Eintrag in `CONSEQUENCE_OVERRIDES`,
`TREASURE_POWER_OVERRIDES`, `COMBAT_POTION_OVERRIDES`,
`ITEM_CONDITIONAL_BONUS`, `DOOR_OTHER_AS_CURSE`, `POWER_GROUP_NAMES` oder
`GUARANTEED_FLEE_CARDS` ins Leere zeigt. Ein Tippfehler im Kartennamen wäre
sonst ein still wirkungsloser Eintrag - der wahrscheinlichste Fehler beim
Pflegen dieser Tabellen. Aktueller Stand: 0 Treffer, alle 170 Namen passen.

**Client-Rendering** braucht dafür keinen eigenen Browser-Test:
`renderConsequence()` in `public/client.js` rendert ausschließlich aus
`state.pendingConsequence` und verzweigt nirgends nach Kartenkategorie oder
-name. Eine `DOOR_OTHER_AS_CURSE`-Karte erzeugt exakt dasselbe
`pendingConsequence`-Objekt wie ein echter Fluch (`server.js`, in
`handleDrawDoor()`) und damit exakt dieselbe Anzeige.

Weiterhin offen: eine echte Sichtprüfung im Browser. In der Session vom
2026-09-10 war die Chrome-Erweiterung nicht verbunden ("Browser extension is
not connected"), der Server selbst lief und lieferte aus (HTTP 200 auf `/`
und `/client.js`).

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

### 4.3 Machtgruppen-Sonderkräfte (teilweise umgesetzt)
Umgesetzt sind inzwischen alle **passiven** Kräfte, also die, die ohne jede
Spieler-Interaktion auskommen:
- Alchemist: "Blei zu Gold" (Verkauf), "Tränkemeister" (doppelter Bonus bei
  "nur einmal einsetzbar"-Karten)
- Höllenritter: "Höllenritterrüstung" (+5 im Kampf) - seit 2026-09-10, siehe
  `hellknightArmorBonus()`. Der Bonus zählt nur, solange Rüstungs- **und**
  Kopf-Slot frei sind. Die Karte sagt zwar "du darfst keine andere Rüstung
  tragen", aber die Bonus-Bedingung ist die kürzere Variante: sie ist in
  jeder Reihenfolge korrekt (Ausrüstung zuerst oder Machtgruppe zuerst) und
  braucht keine Blockier-Logik im Anlegen-Pfad.
- Assassine der Roten Mantis: "Heimlichkeit" (+1 auf Weglaufen) - seit
  2026-09-10, in `handleAttemptFlee()`. Wird **nach** der Begrenzung des
  Client-Modifikators addiert, weil der Bonus serverseitig feststeht.

Weiterhin manuell, weil jede dieser Kräfte echte Spieler-Interaktion braucht
(Karten auswählen, Ziel wählen) - der `pendingCardAction`-Mechanismus
(`choice` / `targetPlayer` / `chooseCard`) wäre dafür jeweils das Werkzeug:
- Adlerritter "Standhaft bleiben" und Assassine "Auftragsmörder": bis zu 3
  Handkarten ablegen für je +2 im Kampf. **Die beiden einfachsten
  verbleibenden Fälle** - nur eine Kartenauswahl aus der eigenen Hand plus
  ein Kampfmodifikator, kein neuer Zustand. (Adlerritter zusätzlich −1 auf
  Weglaufen je abgelegter Karte, das braucht einen Zähler am Kampf.)
- Paktmagier "Eidolon" (Monster aus der Hand als Bonus = 2× `treasureCount`)
  und "Beschwören" (oberstes Monster vom Türablagestapel auf die Hand)
- Hexe "Hex" (Schlimme Dinge eines Monsters einem anderen Spieler als Fluch
  zufügen) und "Begleitung" (Fluch-Schutz beim Türeintreten)
- Kundschafter "Das Geheimnis aufdecken" (oberste 2 Türkarten ansehen, eine
  zurücklegen, eine ablegen). Die "Verliere den Pfad"-Ausweichoption für
  Kundschafter IST bereits automatisiert, siehe `VERLIERE DEN PFAD` in
  `CONSEQUENCE_OVERRIDES`.
- Nekromant "Reanimation" / "Geheimnisse der Untoten": **zusätzlich durch
  fehlende Daten blockiert**, nicht nur durch Aufwand - beide hängen am
  Begriff "untotes Monster", und eine Untot-Kennzeichnung gibt es in
  `data/cards.json` nicht (siehe 4.1). Eine frühere Fassung dieser Datei
  empfahl Nekromant als guten Einstieg; das ist irreführend.

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

### 4.6 Kampf-Gleichstand / ALUFOLIE - BEHOBEN (2026-09-10)
`handleEvaluateCombat()` nutzte striktes `playerStrength > monsterStrength`,
ein Gleichstand ging also immer ans Monster, und ALUFOLIE ("Du gewinnst bei
einem Gleichstand im Kampf") war wirkungslos.

**Achtung, die frühere Fassung dieser Datei lag hier falsch**: sie empfahl
eine `equippedItems`-Prüfung auf "ALUFOLIE". Das wäre toter Code gewesen -
ALUFOLIE hat `category: "treasure_other"`, und `handleEquipItem()` lehnt
alles ab, was nicht `category === 'item'` ist. Die Karte kann also gar nicht
angelegt werden, sie liegt auf der Hand.

Umgesetzt ist deshalb: bei Gleichstand sucht `findTieBreaker()` die Karte auf
der Hand der kämpfenden **oder** der helfenden Person, verbraucht sie
(Ablagestapel) und der Kampf gilt als gewonnen. Bewusst **ohne** Rückfrage-UI
- ein Gleichstand ist ohne die Karte immer eine Niederlage, sie einzusetzen
ist also nie schlechter als sie liegen zu lassen, und damit gibt es nichts zu
entscheiden. Als Einwegkarte behandelt (der Kartentext nennt keine
Dauerwirkung), markiert mit einem `ponytail:`-Kommentar.

## 5. Empfohlene nächste Schritte für eine neue Session

Die drei Punkte, die hier vorher standen, sind erledigt (siehe 3., 4.3, 4.6).
Was sinnvollerweise als Nächstes kommt:

1. **Sichtprüfung im Browser**, sobald die Chrome-Erweiterung verbunden ist:
   Server mit `PORT=3111 node server.js` starten, Raum mit Bots aufmachen,
   und einmal mit eigenen Augen einen Fluch, einen Kampf-Gleichstand mit
   Alufolie und die Höllenritter-Kampfstärke ansehen. Die Logik ist getestet,
   die Optik nicht.
2. **Adlerritter "Standhaft bleiben" / Assassine "Auftragsmörder"** (4.3) -
   die beiden einfachsten verbleibenden Machtgruppen-Kräfte, weil sie nur
   eine Kartenauswahl aus der eigenen Hand brauchen und keinen neuen
   dauerhaften Zustand.
3. Alles Weitere in Abschnitt 4 ist bewusst offen und sollte nur angefasst
   werden, wenn der Nutzer es ausdrücklich will - 4.1 (fehlende Datenpunkte
   in `cards.json`) und 4.2 (Fluch-/Status-Tracker) sind echte
   Vorbedingungen, keine Fleißarbeit.

Bei jedem neuen Karten-Feature: zuerst `data/cards.json` nach dem exakten
Kartentext durchsuchen (`node -e "..."`-Einzeiler, siehe Muster oben), dann
Override + ggf. `applyPrimitiveAction`-Fall + Test ergänzen, dann
`node -c server.js` + `node tests/run.js`.

**Und: nicht ungeprüft aus dieser Datei heraus arbeiten.** Zwei Angaben hier
waren schlicht falsch (ALUFOLIE als anlegbarer Gegenstand, Nekromant als
guter Einstieg) - beides wäre beim Nachlesen von `data/cards.json` bzw.
`handleEquipItem()` in einer Minute aufgefallen. Erst die Karte und den
Code-Pfad nachschlagen, dann bauen.

## 6. Repo-Durchsicht 2026-09-10: gefundene und behobene Fehler

Alle vier waren vorher unbemerkt und sind jetzt behoben und durch Tests
abgesichert. Alle Fixes wurden per Mutation gegengeprüft (Fehler wieder
einbauen -> Test schlägt fehl).

### 6.1 Jeder Client konnte den Server abschießen (kritisch, behoben)
`socket.emit('removeBot')` **ohne Argument** beendete den kompletten
Node-Prozess: die Handler destrukturieren ihren Payload im Funktionskopf
(`({ botId }) => ...`), und das wirft bei `undefined`, bevor irgendeine
Prüfung im Rumpf greift. Kein Raum-Beitritt nötig, keine Authentifizierung -
eine Zeile aus der Browser-Konsole genügte. Da alle Räume nur im
Arbeitsspeicher liegen, war jedes laufende Spiel weg (der Container startet
per `restart: unless-stopped` zwar neu, aber ohne Spielstand). Betroffen
waren ~20 Handler, dazu Payloads mit falschem Typ (z.B. `sellItems` mit
`cardIds: 5` -> `new Set(5)` wirft).

Behoben durch `onSafe()`: alle Handler werden nicht mehr über `socket.on()`
registriert, sondern zentral über diese eine Funktion (fehlender Payload ->
`{}`, fehlender Callback -> No-Op, Fehler beendet nur das eine Event). Damit
greift der Schutz automatisch für jeden künftig ergänzten Handler.
Regressionstest: `tests/malformed-input.test.js` feuert 765 fehlerhafte
Events ab und prüft, dass der Server danach noch normal antwortet.

### 6.2 XSS über den Spielernamen (kritisch, behoben)
`public/client.js` escapte den Namen an **einer** Stelle nicht: der
"X bittet dich um Hilfe im Kampf"-Kasten schrieb ihn roh per `innerHTML`.
Der Server kürzt Namen nur auf 20 Zeichen und filtert kein HTML - und
`<svg onload=alert()>` ist exakt 20 Zeichen. Ausgeführt wurde das im Browser
der **angegriffenen** Person, und im `localStorage` liegt unter
`munchkin_session` der Wiederverbinden-Token: Skript liest Token, meldet sich
per `joinRoom` als diese Person an, übernimmt deren Platz. Alle anderen ~30
Einbaustellen benutzen korrekt `escapeHtml()`, diese eine war übersehen.

### 6.3 Tod verunreinigte beide Kartenstapel (behoben)
`applyDeathConsequence()` legte die **angelegten Gegenstände** pauschal auf
den **Tür**-Ablagestapel. Alle 58 anlegbaren Gegenstände sind aber
Schatzkarten (`handleEquipItem()` lässt nur `category: 'item'` zu, und die
gibt es ausschließlich als `type: 'treasure'`). Folge: Nach jedem Tod
wanderten Schatzkarten in den Türstapel, wurden beim Neumischen zu Türkarten
und landeten beim "Tür eintreten" wortlos auf der Hand - und fehlten dem
Schatzstapel dauerhaft. Behoben, indem die vorhandene Hilfsfunktion
`discardCard()` benutzt wird, die nach Kartentyp auf den richtigen Stapel
legt. Der Test prüft zusätzlich generell, dass auf jedem Ablagestapel nur
Karten des passenden Typs liegen.

### 6.4 Sitzungs-Token aus `Math.random()` (behoben)
`makeId()` erzeugte den Wiederverbinden-Token aus `Math.random()`. Dessen
interner Zustand lässt sich aus wenigen beobachteten Werten rekonstruieren -
und wer den Token kennt, übernimmt den Platz (siehe 6.2). Jetzt
`crypto.randomBytes(16)`.

### 6.5 Kleinigkeit: Aufräum-Timer (behoben)
Beim Löschen eines leeren Raums wurden `cleanupTimer`/`botTimer` nicht
gestoppt, der Raum blieb also bis zu 3 Stunden im Speicher. Harmlos, aber
jetzt mit aufgeräumt.

### 6.6 Bewusst nicht angefasst
- Die `setTimeout`-Rückrufe der Bot-Logik haben kein `try/catch`. Ein Fehler
  dort beendet weiterhin den Prozess. Anders als 6.1 ist das aber kein
  Angriffsweg (der Zustand kommt vom Server selbst), und ein pauschales
  `catch` würde echte Fehler verstecken. Wenn Abstürze im Betrieb auftauchen:
  hier zuerst schauen.
- Der Docker-Build kopiert nur `package.json`, keine `package-lock.json` -
  Builds sind damit nicht reproduzierbar.
- Raumcodes sind 4 Zeichen aus 32 (~1 Mio) und werden ebenfalls über
  `Math.random()` erzeugt. Beitreten ist aber nur in der Lobby möglich, und
  mehr als "in eine fremde Lobby stolpern" geht damit nicht.
