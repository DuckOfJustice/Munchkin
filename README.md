# Munchkin – Online

Eine browserbasierte Online-Version des Kartenspiels **„Munchkin"** (Steve Jackson Games / Pegasus Spiele) zum Spielen mit Freunden – jede:r auf dem eigenen Handy/Tablet/PC, ein gemeinsamer Server übernimmt Tür-/Schatzstapel, Phasen, Kampf-Mathematik, Stufen und Ausrüstung.

Die Kartendaten (504 Karten: Base, Clerical Errors, Pixels & Paper Promos, Unnatural Axe, Pathfinder) stammen aus den eigenen, bereits erworbenen Spieldateien und wurden für dieses Projekt aufbereitet (`data/cards.json`). Es werden **keine offiziellen Kartengrafiken** verwendet – die Karten werden als einfache, klar erkennbare Text-Kacheln dargestellt (siehe „Warum keine Kartenbilder?" unten).

## Wichtig: Was automatisiert ist / Was manuell bleibt

Munchkin hat hunderte Karten mit jeweils **individuellem** Regeltext (Sondermonster wie „Wanderndes Monster" oder „Kumpel", besondere Rassen-/Klassenkräfte, sehr unterschiedliche Flüche, Verkaufs-/Handelstricks, ...). Das alles einzeln zu programmieren ist nicht sinnvoll machbar – genauso, wie bei „Tempel des Schreckens" das eigentliche Bluffen bewusst außerhalb der App am Tisch/per Anruf stattfindet, gilt hier ein **Trust-Prinzip**:

**Automatisiert:**
- Tür-/Schatzstapel (Mischen, Ziehen, Ablegen, Neu-Mischen wenn leer)
- Eine **Vorbereitungsrunde** vor dem ersten Zug: alle legen gleichzeitig ihre Ausrüstung an, die erste Runde startet, sobald alle auf "Bereit" gedrückt haben
- Die 4 Zug-Phasen (Tür eintreten, Auf Ärger aus sein, Raum plündern, Milde Gabe inkl. 5-Karten-Limit)
- Kampf-Mathematik (Stufe + Ausrüstungsboni vs. Monsterstufe), inkl. Hilfe anfragen/annehmen, inkl. der wenigen Gegenstände mit gegner-/rassenabhängigem Zusatzbonus, die sich aus den Kartendaten eindeutig berechnen lassen (Geiler Helm, Vorpale Klinge, Alles außer Krakzilla Abschlachtendes Schwert, Schreckliche Socken)
- Kampf-Gleichstand: gewinnt normal das Monster, mit Alufolie auf der Hand die Spielerseite (die Karte wird dabei verbraucht)
- Fluchtwurf (Würfel ≥ 5 nötig) mit frei eintragbarem Modifikator, plus garantierte Flucht-Karten (Fertigmauer, Baby-Öl, Der Andere Ring) als eigener Knopf
- Ausrüstung anlegen/ablegen mit Körperteil-Regeln (1 Kopf, 1 Rüstung, 1 Schuhwerk, max. 2 Hände) - und mit dem gedruckten Zeitpunkt: nur im eigenen Zug und nie mitten im Kampf (Ausnahme ist die Vorbereitungsrunde)
- Gegenstände verkaufen (1.000 Goldstücke = 1 Stufe, ebenfalls nur im eigenen Zug und nicht im Kampf), inkl. Machtgruppe Alchemist ("Blei zu Gold": mind. 300 GS pro Gegenstand)
- Passive Machtgruppen-Kräfte: Höllenritter ("Höllenritterrüstung": +5 im Kampf, solange Rüstungs- und Kopf-Slot frei bleiben), Assassine der Roten Mantis ("Heimlichkeit": +1 auf Weglaufen)
- Rasse/Klasse/Machtgruppe spielen (max. 1 von jeder, max. 2 mit Halb-Blut/Super Munchkin/Doppelleben)
- „Schlimme Dinge" und Flüche: für die meisten Monster- und Fluch-Texte (inkl. der ca. 45 fehlkategorisierten Flüche aus Basis-Set und Erweiterungen, die in den Rohdaten als normale Türkarte statt als Fluch geführt werden - siehe `DOOR_OTHER_AS_CURSE` in `server.js`) wird die Stufen-/Ausrüstungs-/Handkonsequenz automatisch berechnet und angewendet; bietet die Karte eine echte Wahl, gibt es zwei Buttons statt Rechnerei (siehe `tests/auto-consequence.test.js`)
- Ein großer Teil der Schatzkarten-Sonderkräfte: einfache „Steige eine Stufe auf"-Karten und Kampf-Tränke (+N für eine Seite) lassen sich per Klick einsetzen, dazu einzelne kuratierte Sonderfälle (Klaue eine Stufe, Schatzhort!, Wünschelstab, ...) - siehe `tests/card-abilities.test.js`
- Sieg bei Stufe 10 - aber **nur durch einen Kampf oder eine Karte, die es ausdrücklich erlaubt**: Verkaufen bringt auf Stufe 10, gewinnt aber nicht (Göttliche Intervention ist die gedruckte Ausnahme)
- **Große Gegenstände**: kuratierte Liste (`src/cards/bigitems.js`), Traglimit 1 für Nicht-Zwerge - schaltet Gallert-Oktaeder, Verliere 1 Großen/Kleinen Gegenstand, Grünschleim und die Zwergen-Rassenkraft frei
- **Anhaltende Flüche** mit laufendem Tracker: Mieser Spiegel, Geschlechtsumwandlung, Huhn auf deinem Kopf, Winzige Hände - und der Wunschring, der sie beendet
- **Karten, die andere handeln lassen** (Hippogreif, Anwalt, Leprachaun, Netz-Troll, Versicherungsvertreter, Schnecken auf Speed, Fluch! Einkommenssteuer): eine Warteschlange fragt die Betroffenen der Reihe nach, Bots antworten selbst
- **Reaktionsfenster** auf einen Wurf oder eine gelungene Flucht: Gezinkter Würfel, Kleberfläschchen, Magische Lampe
- **Kampfreaktionskarten**: Kumpel, Wanderndes Monster, Illusion, Hilf mir, Überfalltrank
- **Kartenanhänge**: Schummeln! (hebt die Anlege-Regel für einen Gegenstand auf), Knieschützer der Verlockung
- **Alternativen statt Kampf** bei Möchtegern-Vampir, Laufende Nase, Pit Bull, plus der erzwungene Preis des Zungendämons
- **Rassen- und Klassenkräfte**: Super Munchkin / Halb-Blut ("alle Vorteile, keine Nachteile"), Zauberer (Verzauberung, Flugzauber), Krieger (Berserken), Priester (Vertreiben, Auferstehung), Dieb (In den Rücken fallen, Diebstahl), Halbling-Wiederholungswurf, Zwergen-Handlimit

Die Liste oben gilt in dieser Tiefe für das **Basis-Set** und für **Clerical Errors** - dort ist inzwischen praktisch jede Karte anklickbar (Stand 2026-09-13; die sechs bewusst manuell gebliebenen Karten stehen in `HANDOVER.md` §9.3). In den drei übrigen Erweiterungen sind die Stufen-/Ausrüstungs-Konsequenzen und die Kampf-Mathematik ebenso automatisiert, einzelne Sonderkräfte aber weiterhin nicht.

Was dabei an Spielzustand dazugekommen ist und für alle Sets gilt: ein **Geschlecht** pro Person (alle starten männlich, geändert wird es nur durch Karten), **Kartenanhänge** am Gegenstand (Vergiftet/Gesegnet/Nützliche Griffe - sie bleiben beim Gegenstand, auch wenn er den Besitzer wechselt) und drei Rassen-/Klassenkarten, die in den Rohdaten fälschlich als normale Türkarte geführt werden (Ork, Gnom, Barde) und deshalb bis dahin gar nicht spielbar waren.

**Manuell (mit Werkzeug-Unterstützung):** der genaue Effekt der übrigen, sehr individuellen Sonderkräfte aus den Erweiterungen, und Boni gegen Machtgruppen auf Monsterkarten. Der **Original-Kartentext wird immer angezeigt** (Klick auf eine Karte). Bei Konsequenzen, die nicht automatisch erkannt werden, gibt es ein generisches Werkzeug (±1 Stufe, Gegenstand ablegen, „ich bin gestorben"), mit dem ihr die Auswirkung wie am echten Tisch selbst nachvollzieht. Kampf-Boni/Mali aus Karteneffekten, die nicht automatisch erkannt werden, tragt ihr im Kampf-Panel als Zahl ein.

Bewusst **außerhalb des Umfangs** bleiben Karten, die einen Datenpunkt bräuchten, den `data/cards.json` nicht enthält, oder eine Tischabsprache statt einer Regel sind: die Dieb-Tauschoption des Anwalts (toter Code - das Monster greift Diebe ohnehin nicht an), das verdeckte Ziehen bei Schatzhort! (es gibt kein "offen/verdeckt" für Schätze) und 34 Basis-Karten, die in `data/cards.json` gar keinen Text haben. Die vollständige, kommentierte Liste steht im Code bei `CONSEQUENCE_OVERRIDES` und `DOOR_OTHER_AS_CURSE` (`src/cards/consequences.js`), `TREASURE_POWER_OVERRIDES` und `COMBAT_POTION_OVERRIDES` (`src/cards/treasures.js`) sowie in `HANDOVER.md` §8.

## Warum keine Kartenbilder?

Die Illustrationen der echten Munchkin-Karten (von John Kovalic) sind urheberrechtlich geschützt. Genau wie bei „Tempel des Schreckens" (eigene Platzhalter-Zeichnungen statt Scans der Schmidt-Spiele-Karten) verzichtet diese Version bewusst auf die offiziellen Grafiken und auf das offizielle Kartendesign/Logo – die Karten werden als klar eigenständig gestaltete, farbcodierte Text-Kacheln dargestellt. Kartennamen und -texte selbst sind Spieldaten (nötig, damit das Spiel funktioniert), keine Grafiken.

## Funktionen

- **Sets wählbar** – in der Lobby lässt sich jedes der 5 Sets einzeln an-/abwählen (Host).
- **Test-Bots** – der Raum lässt sich per Klick mit Bots auffüllen. Bots spielen vorsichtig (kein freiwilliger Monsterkampf, kein Ausrüsten, keine Hilfe) – ausreichend zum Testen des Spielablaufs, aber kein Ersatz für echte Mitspieler:innen.
- Wiederverbindung nach Verbindungsabbruch/Neuladen der Seite (Sitzplatz, Hand, Stufe, Ausrüstung bleiben erhalten).
- Läuft komplett im Speicher – keine Datenbank nötig, ideal für einen Raspberry Pi.

## Entwicklung

```bash
npm install
npm start          # http://localhost:3000
npm test           # Integrationstest (kompletter Spielablauf mit Bots)
```

## Deployment (Raspberry Pi, analog zu den anderen Projekten)

```bash
./deploy.sh
```

Der Container lauscht intern auf Port 3000 und wird laut `docker-compose.yml` nur auf `127.0.0.1:8098` veröffentlicht – ein bereits laufender Reverse Proxy auf dem Pi kann eine eigene Subdomain (z. B. `munchkin.oualid.de`) dorthin routen, genau wie bei `wd.oualid.de` → 8092 für „Der Widerstand". Port 8098 wurde gewählt, weil 8080/8081/8090/8091/8092/8093/8094/8095/8096/8097/8443 bereits von den anderen Projekten belegt sind.

### Optional: In den Spielehub einhängen

Soll das Spiel wie die anderen über `games.oualid.de/munchkin/` erreichbar sein, in `Spielehub/nginx.conf` einen weiteren `location /munchkin/`-Block (analog zu den bestehenden, Ziel `127.0.0.1:8098`) sowie in `Spielehub/public/index.html` eine weitere Kachel ergänzen. Der Client (`public/client.js`) ermittelt das Pfad-Präfix bereits automatisch aus der Browser-URL.

## Projektstruktur

```
Munchkin/
├── server.js            Spiel-Server (Node.js, Express + Socket.IO)
├── src/cards/            Kartentabellen (Große Gegenstände, Konsequenzen, Schätze, Dauerwirkungen, Reaktionen)
├── tools/                coverage-scan.js (welche Karte hat keinen Ausspielweg? `node tools/coverage-scan.js <set>`), smoke-run.js (Partie gegen den laufenden Server)
├── data/cards.json       504 Karten (Name, Text, Stufe, Bonus, Goldwert, Körperteil, ...)
├── package.json
├── Dockerfile
├── docker-compose.yml
├── public/
│   ├── index.html
│   ├── style.css
│   └── client.js
├── tests/                17 Testdateien (siehe unten)
├── .github/workflows/    GitHub-Actions-CI, läuft bei jedem Push automatisch
└── README.md
```

## Automatisierte Tests

Unter `tests/` liegen 17 Testdateien, die `tests/run.js` automatisch einsammelt. Zwei davon starten den Server als echten Prozess und treiben ihn über `socket.io-client` an (kompletter Spielablauf mit Bots, fehlerhafte Events), die übrigen bauen ein Raum-Objekt im Speicher und rufen die Handler direkt auf - eine Datei je Kartenmechanismus (Warteschlange, Reaktionsfenster, Flüche, Kampfreaktionen, Anhänge, Große Gegenstände, Klassenkräfte, ...).

```bash
npm install
npm test
```

Bei jedem Push nach GitHub läuft das automatisch über eine GitHub Action (`.github/workflows/ci.yml`) mit.

## Mit Freunden im selben WLAN spielen

1. Server wie oben starten (`npm start`).
2. Die lokale IP-Adresse deines Rechners herausfinden (Windows: `ipconfig`, unter „IPv4-Adresse", z. B. `192.168.1.42`).
3. Freunde im selben WLAN öffnen im Browser: `http://192.168.1.42:3000`
4. Eine Person erstellt einen Raum und teilt den 4-stelligen Raum-Code, alle anderen treten mit Namen + Code bei.

## Bekannte Einschränkungen

- Einzelne Karten bleiben absichtlich manuell (Schatzhort!-Ziehen, Anwalt-Tauschoption, sechs Karten aus Clerical Errors) - siehe oben, `HANDOVER.md` §8 und §9.3.
- Bots sind bewusst simpel gehalten (kein Ausrüsten, kein Kämpfen aus der Hand, keine Hilfe) – gedacht zum Testen des Ablaufs, nicht als vollwertige Mitspieler.
- Pathfinder-Set: 145 Karten ohne numerische Werte (Stufe/Bonus/Goldwert) in den Original-Spieldaten gefunden – falls das im Spiel auffällt, gerne Bescheid geben, dann schaue ich nach einer anderen Datenquelle für dieses Set.

## Sicherheitshinweis

Es gibt aktuell keinen Zugriffsschutz (kein Passwort) – wer die URL und einen Raum-Code kennt, kann beitreten. Für ein privates Spiel im Freundeskreis meist unkritisch, aber gut zu wissen, bevor der Link weiter verbreitet wird.
