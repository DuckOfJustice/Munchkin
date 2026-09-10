# Munchkin – Online

Eine browserbasierte Online-Version des Kartenspiels **„Munchkin"** (Steve Jackson Games / Pegasus Spiele) zum Spielen mit Freunden – jede:r auf dem eigenen Handy/Tablet/PC, ein gemeinsamer Server übernimmt Tür-/Schatzstapel, Phasen, Kampf-Mathematik, Stufen und Ausrüstung.

Die Kartendaten (504 Karten: Base, Clerical Errors, Pixels & Paper Promos, Unnatural Axe, Pathfinder) stammen aus den eigenen, bereits erworbenen Spieldateien und wurden für dieses Projekt aufbereitet (`data/cards.json`). Es werden **keine offiziellen Kartengrafiken** verwendet – die Karten werden als einfache, klar erkennbare Text-Kacheln dargestellt (siehe „Warum keine Kartenbilder?" unten).

## Wichtig: Was automatisiert ist / Was manuell bleibt

Munchkin hat hunderte Karten mit jeweils **individuellem** Regeltext (Sondermonster wie „Wanderndes Monster" oder „Kumpel", besondere Rassen-/Klassenkräfte, sehr unterschiedliche Flüche, Verkaufs-/Handelstricks, ...). Das alles einzeln zu programmieren ist nicht sinnvoll machbar – genauso, wie bei „Tempel des Schreckens" das eigentliche Bluffen bewusst außerhalb der App am Tisch/per Anruf stattfindet, gilt hier ein **Trust-Prinzip**:

**Automatisiert:**
- Tür-/Schatzstapel (Mischen, Ziehen, Ablegen, Neu-Mischen wenn leer)
- Die 4 Zug-Phasen (Tür eintreten, Auf Ärger aus sein, Raum plündern, Milde Gabe inkl. 5-Karten-Limit)
- Kampf-Mathematik (Stufe + Ausrüstungsboni vs. Monsterstufe), inkl. Hilfe anfragen/annehmen, inkl. der wenigen Gegenstände mit gegner-/rassenabhängigem Zusatzbonus, die sich aus den Kartendaten eindeutig berechnen lassen (Geiler Helm, Vorpale Klinge, Alles außer Krakzilla Abschlachtendes Schwert, Schreckliche Socken)
- Kampf-Gleichstand: gewinnt normal das Monster, mit Alufolie auf der Hand die Spielerseite (die Karte wird dabei verbraucht)
- Fluchtwurf (Würfel ≥ 5 nötig) mit frei eintragbarem Modifikator, plus garantierte Flucht-Karten (Fertigmauer, Baby-Öl, Der Andere Ring) als eigener Knopf
- Ausrüstung anlegen/ablegen mit Körperteil-Regeln (1 Kopf, 1 Rüstung, 1 Schuhwerk, max. 2 Hände)
- Gegenstände verkaufen (1.000 Goldstücke = 1 Stufe), inkl. Machtgruppe Alchemist ("Blei zu Gold": mind. 300 GS pro Gegenstand)
- Passive Machtgruppen-Kräfte: Höllenritter ("Höllenritterrüstung": +5 im Kampf, solange Rüstungs- und Kopf-Slot frei bleiben), Assassine der Roten Mantis ("Heimlichkeit": +1 auf Weglaufen)
- Rasse/Klasse/Machtgruppe spielen (max. 1 von jeder, max. 2 mit Halb-Blut/Super Munchkin/Doppelleben)
- „Schlimme Dinge" und Flüche: für die meisten Monster- und Fluch-Texte (inkl. der ca. 45 fehlkategorisierten Flüche aus Basis-Set und Erweiterungen, die in den Rohdaten als normale Türkarte statt als Fluch geführt werden - siehe `DOOR_OTHER_AS_CURSE` in `server.js`) wird die Stufen-/Ausrüstungs-/Handkonsequenz automatisch berechnet und angewendet; bietet die Karte eine echte Wahl, gibt es zwei Buttons statt Rechnerei (siehe `tests/auto-consequence.test.js`)
- Ein großer Teil der Schatzkarten-Sonderkräfte: einfache „Steige eine Stufe auf"-Karten und Kampf-Tränke (+N für eine Seite) lassen sich per Klick einsetzen, dazu einzelne kuratierte Sonderfälle (Klaue eine Stufe, Schatzhort!, Wünschelstab, ...) - siehe `tests/card-abilities.test.js`
- Sieg bei Stufe 10

**Manuell (mit Werkzeug-Unterstützung):** der genaue Effekt der übrigen, sehr individuellen Sonderkräfte (Wanderndes Monster/Kumpel, die meisten Rassen-/Klassen-/Machtgruppen-Sonderkräfte, Boni gegen bestimmte Rassen/Klassen/Machtgruppen auf Monsterkarten), Handeln zwischen Spieler:innen. Der **Original-Kartentext wird immer angezeigt** (Klick auf eine Karte). Bei Konsequenzen, die nicht automatisch erkannt werden, gibt es ein generisches Werkzeug (±1 Stufe, Gegenstand ablegen, „ich bin gestorben"), mit dem ihr die Auswirkung wie am echten Tisch selbst nachvollzieht. Kampf-Boni/Mali aus Karteneffekten, die nicht automatisch erkannt werden, tragt ihr im Kampf-Panel als Zahl ein.

Bewusst **außerhalb des Umfangs** bleiben Karten, die einen Datenpunkt bräuchten, den `data/cards.json` nicht enthält (ein „Großer Gegenstand"-Flag, eine „Untot"-/Feuerimmunitäts-Kennzeichnung auf Monsterkarten, welche Machtgruppe ein Monster „hasst"), einen dauerhaften Fluch-/Status-Tracker, den dieser Server nicht führt (z. B. Wunschring - es gibt schlicht keinen laufenden Fluch-Zustand zum Beenden), oder eine echte freie Auswahl mit Wertgrenze aus dem gesamten Ablagestapel (Flohmarkt, Einheitsgröße). Die vollständige, kommentierte Liste steht direkt im Code bei `CONSEQUENCE_OVERRIDES`, `DOOR_OTHER_AS_CURSE`, `TREASURE_POWER_OVERRIDES` und `COMBAT_POTION_OVERRIDES` in `server.js`.

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
├── data/cards.json       504 Karten (Name, Text, Stufe, Bonus, Goldwert, Körperteil, ...)
├── package.json
├── Dockerfile
├── docker-compose.yml
├── public/
│   ├── index.html
│   ├── style.css
│   └── client.js
├── tests/                Integrationstest (siehe unten)
├── .github/workflows/    GitHub-Actions-CI, läuft bei jedem Push automatisch
└── README.md
```

## Automatisierte Tests

Unter `tests/` liegt ein Integrationstest, der den Server als echten Prozess startet und über `socket.io-client` eine Partie mit 2 Bots antreibt (inkl. automatischer Kampf-/Konsequenz-Reaktion für den menschlichen Test-Spieler). Er prüft, dass der Server dabei nicht abstürzt, Stufen/Handkartenzahlen immer plausibel bleiben und mindestens ein Kampf stattfindet.

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

- Rassen-/Klassen-Sonderkräfte, Wanderndes Monster/Kumpel, Handeln zwischen Spieler:innen: nicht automatisiert (siehe oben).
- Super Munchkin / Halb-Blut (zweite Rasse/Klasse): aktuell nicht automatisiert – Karte landet in der Hand, kann aber nicht "zusätzlich" gespielt werden. Bei Bedarf gerne nachrüsten.
- Bots sind bewusst simpel gehalten (kein Ausrüsten, kein Kämpfen aus der Hand, keine Hilfe) – gedacht zum Testen des Ablaufs, nicht als vollwertige Mitspieler.
- Pathfinder-Set: 145 Karten ohne numerische Werte (Stufe/Bonus/Goldwert) in den Original-Spieldaten gefunden – falls das im Spiel auffällt, gerne Bescheid geben, dann schaue ich nach einer anderen Datenquelle für dieses Set.

## Sicherheitshinweis

Es gibt aktuell keinen Zugriffsschutz (kein Passwort) – wer die URL und einen Raum-Code kennt, kann beitreten. Für ein privates Spiel im Freundeskreis meist unkritisch, aber gut zu wissen, bevor der Link weiter verbreitet wird.
