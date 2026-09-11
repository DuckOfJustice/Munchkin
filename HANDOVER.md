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
Datei ist der Stand nach der Runde vom **2026-09-11**.

**Wer hier neu anfängt, liest zuerst Abschnitt 7.** Dort steht die
Kartenauswertung der letzten Runde (Dauerwirkungen von Karten) - sie deckt
bisher **nur das Basis-Set** ab, und Abschnitt 7 sagt genau, was für die
übrigen Sets noch fehlt und in welcher Reihenfolge man es angeht.

Stand der vorherigen Runde (2026-09-10): Verifikation des
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

> **Veraltet - die aktuelle Arbeitsliste steht in Abschnitt 7.7.** Dieser
> Abschnitt stammt aus der Runde vom 2026-09-10 und bleibt nur als
> Verlaufsprotokoll stehen. Punkt 1 (Sichtprüfung im Browser) ist weiterhin
> offen, die übrigen sind von Abschnitt 7 überholt.

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
Ein Socket-Event **ohne Payload** beendete den kompletten Node-Prozess: die
Handler destrukturieren ihr Argument im Funktionskopf (`({ botId }) => ...`),
und das wirft bei `undefined`, bevor irgendeine Prüfung im Rumpf greift. Kein
Raum-Beitritt nötig, keine Authentifizierung. Da alle Räume nur im
Arbeitsspeicher liegen, war jedes laufende Spiel weg (der Container startet
per `restart: unless-stopped` zwar neu, aber ohne Spielstand). Betroffen
waren ~20 Handler, dazu Payloads mit falschem Typ (etwa eine Zahl, wo der
Handler eine Liste erwartet und darüber iteriert).

Behoben durch `onSafe()`: alle Handler werden nicht mehr über `socket.on()`
registriert, sondern zentral über diese eine Funktion (fehlender Payload ->
`{}`, fehlender Callback -> No-Op, Fehler beendet nur das eine Event). Damit
greift der Schutz automatisch für jeden künftig ergänzten Handler.
Regressionstest: `tests/malformed-input.test.js` feuert 765 fehlerhafte
Events ab und prüft, dass der Server danach noch normal antwortet.

### 6.2 XSS über den Spielernamen (kritisch, behoben)
`public/client.js` escapte den Namen an **einer** Stelle nicht: der
"X bittet dich um Hilfe im Kampf"-Kasten schrieb ihn roh per `innerHTML`.
Der Server kürzt Namen nur auf 20 Zeichen und filtert kein HTML - und 20
Zeichen genügen für ein selbstauslösendes Tag. Ausgeführt wurde das im
Browser der **angegriffenen** Person, und im `localStorage` liegt unter
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

## 7. Kartenauswertung: Dauerwirkungen (Runde vom 2026-09-11) - **nur Basis-Set**

**Das ist der Abschnitt, an dem eine neue Session weitermacht.** Was hier
entstand, deckt ausschließlich das **Basis-Set** ab. Die Muster und die
Mechanik darunter sind fertig und getestet; für die Erweiterungs-Sets fehlen
im Wesentlichen nur die Tabelleneinträge - mit einer großen Ausnahme, siehe
7.4.

### 7.1 Worum es geht

Bis zu dieser Runde wertete der Server nur Kartentexte aus, die jemand **aktiv
ausspielt** (`CONSEQUENCE_OVERRIDES`, `TREASURE_POWER_OVERRIDES`,
Kampf-Tränke) oder die als Konsequenz auflaufen. Kartentexte, die **ohne Zutun
dauerhaft gelten**, gab es im Code überhaupt nicht als Konzept.

Aufgefallen ist das am Bericht des Nutzers: "ich hatte Schutzsandalen im
Schuh-Slot, die sollten mich vor Flüchen schützen, ich habe den Fluch
trotzdem abbekommen". Die Karte sagt wörtlich: *"Flüche, die du ziehst,
nachdem du eine Tür eintrittst, haben keine Wirkung."* Der Server hat den Text
nie gelesen. Die anschließende Durchsicht des Basis-Sets fand knapp 40 weitere
Karten derselben Art - darunter 12 Monster mit "+N gegen Elfen/Zwerge/..."
und 6 Bossmonster, die niedrigstufige Charaktere gar nicht angreifen dürfen.

### 7.2 Der Mechanismus (fertig, gilt für alle Sets)

Neuer Abschnitt in `server.js` ab **Zeile ~1523**, Überschrift
*"Dauerwirkungen von Karten (Basis-Set)"*. Aufbau exakt wie die bereits
etablierten Override-Tabellen (siehe Abschnitt 1): kuratierte, per exaktem
Kartennamen indizierte Tabellen, jeder Eintrag mit dem Original-Kartentext im
Kommentar.

**Bewusst kuratiert statt Regex.** Das wurde beim Bauen geprüft und
verworfen: Die Formulierungen sind zu uneinheitlich (*"Elfen haben -4!"*
gegenüber *"+6 gegen Elfen"* - dasselbe Spielresultat, völlig anderer Text),
und ein Regex fängt Karten mit ein, bei denen dieselbe Formel eine **aktiv
auszuspielende** Kraft beschreibt. Konkreter Fehlalarm: Der ZAUBERER hat *"+1
Bonus auf Weglaufen"* - aber nur pro abgelegter Handkarte. Ein Textscan hätte
ihm einen permanenten Bonus gegeben.

| Tabelle | Zeile | Deckt ab |
|---|---|---|
| `CURSE_PROOF_ITEMS` | 1562 | Getragene Gegenstände, die gezogene Flüche neutralisieren |
| `MONSTER_REFUSES` | 1573 | "Greift niemanden mit Stufe X oder niedriger an" + ANWALT/Dieb |
| `MONSTER_TRAIT_BONUS` | 1596 | "+N gegen Elfen/Zwerge/Krieger/..." |
| `MONSTER_IGNORES_LEVEL` | 1625 | "Deine Stufe zählt nicht im Kampf" |
| `MONSTER_IGNORES_BONUSES` | 1628 | "Kämpfe nur mit deiner Charakterstufe" |
| `MONSTER_FORBIDS_HELP` | 1630 | "Niemand kann dir helfen" |
| `FLEE_ITEM_BONUS` | 1639 | Getragene Gegenstände mit festem Weglaufen-Bonus |
| `FLEE_MONSTER_MOD` | 1643 | "Du hast ±N auf Weglaufen" (Monsterkarte) |
| `FLEE_IMPOSSIBLE` | 1651 | "Denen kannst du nicht entkommen" |
| `FLEE_AUTOMATIC` | 1653 | "Automatische Flucht" |
| `FLEE_PENALTY` | 1655 | Stufenverlust **trotz** gelungener Flucht |
| `FLEE_TREASURE_ITEMS` | 1662 | Schatz beim erfolgreichen Entkommen |
| `MONSTER_EXTRA_LEVEL` | 1690 | "Zusätzliche Stufe, wenn du es besiegst" |
| `FIRE_ITEMS` | 1696 | Was als "Feuer oder Flammen" zählt |
| `CLASS_COMBAT_DISCARD` | 1723 | Klassenkräfte, die Handkarten kosten |
| `UNDEAD_MONSTERS` | 1732 | Was als "untot" gilt |
| `CLASS_FLEE_DISCARD` | 1739 | Dasselbe, aber auf den Weglaufwurf |
| `GUARANTEED_FLEE_MAX_MONSTER_LEVEL` | 2325 | Stufengrenze garantierter Fluchtkarten |

Dazu die auswertenden Funktionen: `monsterTraitBonusSum`,
`fleeModifierParts` (1666), `monsterVictoryExtras` (1698), `handLimit` (1796),
`classDiscardPower`. Alle hängen bereits in `combatTotals`,
`handleDrawDoor`, `handleAttemptFlee`, `resolveCombatWin` und
`handleEvaluateCombat` - **wer nur Tabelleneinträge ergänzt, muss an keinem
Handler etwas ändern.**

Zwei Nebenwirkungen, die man kennen muss:

- **`combatConditionalBonusFields` liefert jetzt fertige Summen**
  (`playerStrength`/`monsterStrength`) an den Client. Der hat sie früher
  selbst nachgerechnet und kannte die neuen Monsterboni nicht - zwei
  Rechenwege, die auseinanderlaufen. Neue Regeln, die die Kampfstärke
  verändern, brauchen daher **nichts** am Client; sie erscheinen automatisch.
- **Bereit-Check vor der Auswertung** (`combatSignature`, Zeile 1857): Der
  Bereit-Status aller Mitspielenden verfällt, sobald sich an den Kampfwerten
  etwas ändert. Die Signatur enthält die fertigen Summen - eine neue
  Tabellenzeile, die die Stärke beeinflusst, setzt den Bereit-Status also von
  allein korrekt zurück. Nicht kaputtmachen, indem man Werte an der Signatur
  vorbeirechnet.

### 7.3 Abdeckung je Set - die eigentliche offene Arbeit

Gemessen am 2026-09-11 durch Textscan über `data/cards.json`. "Offen" heißt:
Der Kartentext passt auf ein Muster, für das eine Tabelle existiert, aber die
Karte steht nicht drin.

| Muster | base | Unnatural Axe | Clerical Errors | Pathfinder |
|---|---|---|---|---|
| `MONSTER_TRAIT_BONUS` | 12 ✅ | **10 offen** | **13 offen** | 27 offen, s. 7.4/7.5 |
| `MONSTER_REFUSES` | 7 ✅ (+AMAZONE, s. 7.6) | **4 offen** | **1 offen** | s. 7.4 |
| `FLEE_MONSTER_MOD` | 4 ✅ | - | **1 offen** | s. 7.4 |
| `FLEE_ITEM_BONUS` | 2 ✅ | **1 offen** | - | s. 7.4 |
| `FLEE_PENALTY` / `FLEE_IMPOSSIBLE` / `FLEE_AUTOMATIC` | 5 ✅ | - | - | - |
| `MONSTER_IGNORES_*` / `FORBIDS_HELP` | 3 ✅ | - | - | - |
| `CURSE_PROOF_ITEMS` | 1 ✅ | - | - | - |

Die konkreten offenen Karten:

**Unnatural Axe** - `MONSTER_TRAIT_BONUS`: RIESENKAKERLAKE, JABBERWOCK,
JUDGE FREDD, M.T.-ANZUG, MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT,
WEIHNACHTSMANN, FÜRCHTERLICHE CLOWNS, ROTZ-ELEMENTAR, TENTAKELDÄMON, DING MIT
EINEM ÜBERLANGEN NAMEN, DESSEN BILD NICHT AUF DIE KARTE PASST.
`MONSTER_REFUSES`: FEUERLÖSCHER, JABBERWOCK, PSYCHO-EICHHÖRNCHEN,
TENTAKELDÄMON. `FLEE_ITEM_BONUS`: BELAGERUNGSMASCHINE.

**Clerical Errors** - `MONSTER_TRAIT_BONUS`: STRICHMÄNNCHEN, FÜRST YAHOO,
AFFENBANDE, KAMIKAZE-KOBOLDE, DIE TROLLE VOM TOTEN MEER, REDNECK-BAUM,
ÜBERBÄR, GIFTEFEU KUDZU-FLIEGENFALLE, FEDERFEIND, SIEBENJÄHRIGER LICH, TANTE
PALADIN, MEDUSA, KALI. `MONSTER_REFUSES`: SIEBENJÄHRIGER LICH.
`FLEE_MONSTER_MOD`: DIE TROLLE VOM TOTEN MEER.

**Zwei Karten brauchen mehr als eine Zeile:** JABBERWOCK und FEDERFEIND haben
je **zwei** Trait-Boni ("+3 gegen Zwerge" *und* "+6 gegen Zwerge" bzw. "+5
gegen Priester" und "+3 gegen Zauberer"). `MONSTER_TRAIT_BONUS` kennt pro
Karte nur **einen** Eintrag `{races|classes, bonus}`. Für diese beiden entweder
den Wert auf eine Liste von Regeln erweitern oder - lazy - den jeweils
höheren Eintrag nehmen und das im Kommentar festhalten.

Ebenfalls prüfen: MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT (+4 Zwerge,
**-3** Zauberer) und WEIHNACHTSMANN (**-5** Elfen) haben *negative* Boni. Die
Tabelle kann das (die Zahl wird nur addiert), aber `monsterTraitBonusSum`
wurde nur mit positiven Werten getestet.

**UNDEAD_MONSTERS** (1732) ist eine reine Einschätzung, keine Datenlage -
`cards.json` kennt kein Untot-Merkmal, im Basis-Set steht das Wort auf keiner
einzigen Monsterkarte. Aktuell eingetragen: MR. BONES, UNTOTES PFERD, KÖNIG
TUT, GRUFTIGE GEBRÜDER. **Vor dem Erweitern gegen die echten Karten
abgleichen** - davon hängt ab, wann der Priester "Vertreiben" (+3 pro Karte)
einsetzen darf. In Clerical Errors ist mindestens SIEBENJÄHRIGER LICH ein
Kandidat.

### 7.4 Blocker: Pathfinder hat überhaupt keine auswertbaren Kartendaten

**Das ist die größte offene Baustelle und keine Fleißarbeit.**

Alle **145** Pathfinder-Karten in `data/cards.json` haben nur die Kategorien
`door_other` (74) oder `treasure_other` (71). Gemessen:

- `level`: **0 von 145** Karten haben einen Wert
- `treasureCount`: **0 von 145**
- `bonus`: **0 von 145**
- `slotKind`: **0 von 145**

Gleichzeitig haben **37** dieser `door_other`-Karten ein `badstuff`-Feld, sind
also eindeutig **Monster** (TENGU, RUNENRIESE, GEB, LINDNORM, MOBOGO,
GOBLINSCHLANGE, ...). Zum Vergleich: Bei Unnatural Axe und Clerical Errors
haben *alle* 27 bzw. 27 Monster sowohl `level` als auch `treasureCount`.

**Praktische Folge:** Pathfinder ist in `settings.sets` standardmäßig **aktiv**
(siehe Raum-Initialisierung). Zieht jemand TENGU, behandelt `handleDrawDoor`
die Karte als harmlose "sonstige Türkarte" und legt sie auf die Hand. Es
entsteht kein Kampf, kein Schatz, keine Stufe - die 37 Pathfinder-Monster sind
im Spiel schlicht wirkungslose Sammelkarten. Das ist unabhängig von dieser
Runde schon länger so und fällt nur nicht auf, weil niemand die Karte
vermisst.

Ohne `level` **kann** keine Kampfregel greifen, egal wie viele Tabellenzeilen
man schreibt. Reihenfolge für eine neue Session:

1. Entscheiden, woher Stufe und Schatzanzahl kommen. Entweder die Datenquelle
   nachbessern, aus der `cards.json` erzeugt wurde, oder eine kuratierte
   Korrekturtabelle im Stil von `DOOR_OTHER_AS_CURSE` anlegen
   (`PATHFINDER_MONSTER_STATS: name -> {level, treasureCount}`, 37 Einträge).
2. Erst danach `MONSTER_TRAIT_BONUS` und die Weglaufen-Tabellen für
   Pathfinder füllen.
3. Alternative, falls das zu viel ist: Pathfinder in den Voreinstellungen
   **abwählen** und im Lobby-Hinweis kennzeichnen. Ehrlicher als 37 kaputte
   Karten im Stapel.

Nebenbei fehlen Pathfinder auch Rassen-, Klassen- und Gegenstandskarten als
solche - `race`/`class`/`item` kommen im Set nicht vor. Ob das an den echten
Karten liegt oder ebenfalls an den Daten, wurde nicht geprüft.

### 7.5 `MONSTER_TRAIT_BONUS` kennt noch keine Machtgruppen

Pathfinder nutzt statt Rassen/Klassen die **Machtgruppen** (`POWER_GROUP_NAMES`,
8 Stück: Kundschafter, Nekromant, Hexe, Höllenritter, Adlerritter, Paktmagier,
Alchemist, Assassine der Roten Mantis). Der Textscan findet **27 Boni gegen
Machtgruppen** auf Pathfinder-Karten, zum Beispiel:

```
TENGU        +3 gegen Kundschafter
GEB          -4 gegen Adlerritter
MOBOGO       +4 gegen Paktmagier, -4 gegen Hexen
HEMOGOBLIN   -3 gegen Kundschafter, +4 gegen Assassinen
```

`MONSTER_TRAIT_BONUS` unterstützt bisher nur `races` und `classes`. Die
Erweiterung ist klein und lokal: ein drittes Feld `powerGroups` im
Tabelleneintrag und eine zusätzliche `.some()`-Bedingung in
`monsterTraitBonusSum` (Zeile ~1612) - `hasPowerGroup` existiert bereits.
Beachten: Die Machtgruppen-Adjektive im Kartentext stehen im Plural
("Kundschafter", "Nekromanten", "Hexen", "Assassinen") und weichen von den
Kartennamen ab, genau wie `RACE_ADJECTIVE_DE`/`CLASS_ADJECTIVE_DE` das für
Rassen/Klassen abbilden. **Sinnvoll erst nach 7.4**, weil ohne Monsterstufe
kein Kampf stattfindet, in dem der Bonus zählen könnte.

Ebenfalls offen, aber kleiner: `ADLERRITTER` hat mit *"Im Kampf darfst du bis
zu 3 Karten aus deiner Hand ablegen"* exakt die Form von
`CLASS_COMBAT_DISCARD` (1723). Da `classDiscardPower` derzeit nur über
`hasClass` sucht, bräuchte es dort einen Zweig für Machtgruppen.

### 7.6 Bewusst manuell geblieben (nicht nachtragen ohne Anlass)

Alles, was eine **echte Entscheidung** verlangt oder auf Daten beruht, die
dieser Server nicht führt. Für all das gibt es weiterhin das manuelle
Bonus-Zahlenfeld im Kampf und das Ablege-Dropdown:

- **DIEB "In den Rücken fallen"** (-2 für eine *andere* Person). Kräfte gegen
  Mitspielende sind im ganzen Projekt manuell, siehe Kommentar am Dateianfang.
- **ZWERG**: "beliebig viele Große Gegenstände" - es gibt kein Groß-Flag in
  den Daten, also gibt es auch keine Beschränkung, die die Ausnahme bräuchte.
- **AMAZONE** ("greift keine Spielerinnen an") - Geschlecht wird nicht
  erfasst, siehe 4.1.
- **LAUFENDE NASE (Bestechung), MÖCHTEGERN-VAMPIR, PIT BULL, ANWALT** (die
  Dieb-Tauschoption): Wahlmöglichkeiten, keine Dauerwirkungen.
- **ZAUBERER "Flugzauber"** ist umgesetzt, weicht aber bewusst vom Text ab:
  Die Karte sagt "*nachdem* du deinen Weglaufwurf gemacht hast", der Server
  bietet den Abwurf **vor** dem Wurf an. Grund: `handleAttemptFlee` löst den
  Wurf sofort auf, eine Zwischenphase "gewürfelt, aber noch nicht
  entschieden" gibt es nirgends im Projekt. Wer das wortgetreu will, baut
  genau diese Phase - dann lohnt sich auch der HALBLING-Wiederholungswurf, der
  dieselbe Phase braucht.
- **PIKOTZU** und **GROSSES WUTENDES HUHN** stehen bewusst *nicht* in
  `MONSTER_EXTRA_LEVEL`, sondern als Sonderfälle in `monsterVictoryExtras`
  (1698) - sie haben Bedingungen ("ohne Hilfe und Boni", "mit Feuer"). Ein
  Textscan meldet sie als "offen"; sie sind es nicht.

### 7.6b Inzwischen doch umgesetzt (HALBLING & Co.)

Diese vier standen in 7.6 als "bewusst manuell" und sind es nicht mehr - wer
hier etwas ändert, findet die Regel jeweils an der genannten Stelle:

- **HALBLING, doppelter Verkaufspreis**: `handleSellItems` verdoppelt den
  teuersten der verkauften Gegenstände, `player.halblingSaleUsed` wird in
  `endTurn` zurückgesetzt.
- **HALBLING, Weglaufwurf wiederholen**: die in 7.6 vermisste Phase
  "gewürfelt, aber noch nicht entschieden" gibt es jetzt -
  `combat.fleeRerollOffer` plus `handleFleeReroll`. Der Zauberer-Flugzauber
  könnte darauf aufsetzen, wenn er wortgetreu werden soll.
- **GEWALTIGER BAZILLUS** ("Halblinge können sie einstampfen"):
  `MONSTER_AUTO_KILL_BY_RACE` - das Monster zählt in `combatTotals` mit
  Stärke 0, Stufe und Schatz kommen aus der normalen Auswertung.
- **BEKIFFTER GOLEM** ("kämpfen oder vorbeigehen", Halblinge müssen
  kämpfen): `MONSTER_PASS_OPTION` in `handleDrawDoor`, umgesetzt als
  `openCardChoice` mit den Aktionen `startRevealedCombat`/`passMonster`.
  Bots entscheiden selbst (Staerkevergleich), sonst würde die Partie auf
  einen Wahldialog warten.

### 7.7 Nächste Schritte, in dieser Reihenfolge

1. **Unnatural Axe und Clerical Errors nachtragen** (~30 Tabellenzeilen, keine
   Logikänderung). Das ist die gesamte Arbeit für diese beiden Sets. Die
   Kartenlisten in 7.3 sind vollständig; Kartentexte mit
   `node -e` aus `data/cards.json` holen und jeweils als Kommentar mitnehmen,
   so wie es die bestehenden Einträge tun.
2. **`UNDEAD_MONSTERS` gegen die echten Karten prüfen** und für die beiden
   Sets erweitern.
3. **JABBERWOCK/FEDERFEIND**: entscheiden, ob `MONSTER_TRAIT_BONUS` mehrere
   Regeln pro Karte können soll.
4. **Pathfinder-Datenlage klären** (7.4). Bis dahin nichts weiter für
   Pathfinder bauen - es wäre toter Code.
5. **Machtgruppen in `MONSTER_TRAIT_BONUS`** (7.5), erst nach Schritt 4.

### 7.8 Verifikation

`npm test` - fünf Dateien, laufen einzeln in eigenen Kindprozessen.

- **`tests/card-passives.test.js`** ist in dieser Runde neu und der relevante
  für alles aus Abschnitt 7. Er prüft **Verhalten**, nicht Tabelleninhalt:
  jeder Fall baut ein echtes Raum-Objekt und ruft den vollständigen Handler.
  Eine Tabelle, die nirgends ausgewertet wird, bestünde einen reinen
  Tabellentest - dieser Test nicht.
- **`tests/card-abilities.test.js`** enthält einen
  Namens-Abdeckungscheck (`nameSources`): Jeder Schlüssel jeder kuratierten
  Tabelle muss zu einer Karte in `cards.json` passen. **Neue Tabellen dort
  eintragen**, sonst fällt ein Tippfehler im Kartennamen nie auf - der Eintrag
  wäre einfach still wirkungslos.
- **`tests/basic-game-flow.test.js`** spielt mit echten Sockets gegen Bots.
  Er hat beim Bereit-Check korrekt zugeschlagen: Der Testclient bestätigte
  nicht, ein Kampf unter Bot-Führung stand für immer. Wer Spielfluss ändert,
  schaut hier zuerst.

Das Scan-Skript, das die Zahlen in 7.3 erzeugt hat, liegt bewusst nicht im
Repo (Einmalwerkzeug). Kurzform zum Nachbauen: `data/cards.json` laden,
`server.js` requiren, Kartentexte normalisieren
(`\n`, `<br>`, `<i>` entfernen), pro Muster-Regex über alle Karten laufen und
gegen die jeweilige Tabelle prüfen.
