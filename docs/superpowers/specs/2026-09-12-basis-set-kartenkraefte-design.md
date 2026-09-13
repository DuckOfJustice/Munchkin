# Design: Fehlende Basis-Set-Kartenkräfte

Stand: 2026-09-12. Grundlage: Audit aller 147 Basis-Set-Karten gegen den
Stand von Commit `9254705`.

## 1. Ausgangslage

Das Audit hat vier Gruppen gefunden:

1. **12 vollständig wirkungslose Karten.** Sie liegen auf der Hand, haben
   aber keinerlei Ausspielweg: kein `TREASURE_POWER_OVERRIDES`-Eintrag, kein
   Kampf-Trank, kein Monster-Verstärker, keine Rassen-/Klassenkarte. Der
   Client bietet nur "Ablegen" an (`public/client.js:1144-1200`).
2. **2 fehlende Klassenkräfte** (DIEB komplett, PRIESTER "Auferstehung").
3. **Teilwirkungen auf sonst funktionierenden Karten** (7 nicht
   automatisierte Monster-"Schlimme Dinge", 6 nie angebotene
   Kampf-Alternativen, die zweite Hälfte von SUPER MUNCHKIN/HALB-BLUT,
   VERSTÜMMLE-Zeitpunkt).
4. **2 Regelabweichungen** (Verkaufen kann das Spiel gewinnen; GOTTLICHE
   INTERVENTION, die gedruckte Ausnahme, ist nicht spielbar).

Alle vier Gruppen sind in diesem Design enthalten.

Ausgangszustand der Tests: **6/6 grün** vor Beginn der Arbeit.

## 2. Getroffene Entscheidungen

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Umfang | Alle vier Gruppen |
| 2 | Ausspielfenster außerhalb des eigenen Zuges | Enge, kartenspezifische Fenster + zweiphasige Würfe. **Keine** generische Reaktions-Engine |
| 3 | Kräfte gegen Mitspielende | Warteschlange in `pendingCardAction`, alle entscheiden selbst |
| 4 | Dateiaufteilung | Kartentabellen nach `src/cards/*.js` auslagern, verhaltensneutral |
| 5 | "Großer Gegenstand"-Flag | Ja, für das Basis-Set kuratiert (8 Karten, mit dem Nutzer abgestimmt) |

Entscheidung 2 begründet sich aus der Messung: es gibt nur **drei**
`rollDie()`-Aufrufstellen (`server.js:772`, `:777`, `:2522`). Eine generische
Reaktions-Engine wäre für drei Stellen nicht zu rechtfertigen.

Das Grundprinzip der Datei ("Trust", siehe Kommentar am Dateianfang) wird mit
Entscheidung 3 bewusst weiter aufgeweicht - das setzt fort, was die Runden
seit 2026-09-10 ohnehin tun.

## 3. Mechanismen

### M0 - Modul-Auslagerung (verhaltensneutral, zuerst)

Die Tabellen sind keine reinen Daten: die Einträge schließen über `hasRace`,
`hasClass`, `hasPowerGroup`, `card`, `resolveConsequenceSpec` und
`isMonsterEnhancerCard`. Jedes Modul exportiert deshalb eine **Factory**, die
diese Helfer entgegennimmt:

```js
// src/cards/consequences.js
module.exports = (ctx) => ({
  'BULLROG': () => ({ type: 'death' }),
  // ...
});
```

`server.js` ruft jede Factory genau einmal mit einem gemeinsamen
`ctx`-Objekt auf. Die Einträge selbst werden **wortgleich** verschoben,
inklusive aller Kommentare mit den Original-Kartentexten.

Dateien:

| Datei | Inhalt |
|---|---|
| `src/cards/consequences.js` | `CONSEQUENCE_OVERRIDES`, `DOOR_OTHER_AS_CURSE` |
| `src/cards/treasures.js` | `TREASURE_POWER_OVERRIDES`, `COMBAT_POTION_OVERRIDES`, `GUARANTEED_FLEE_CARDS`, `GUARANTEED_FLEE_MAX_MONSTER_LEVEL`, `POST_FLEE_ESCAPE_CARDS`, `DOOR_COMBAT_CARDS` |
| `src/cards/passives.js` | `CURSE_PROOF_ITEMS`, `MONSTER_*`, `FLEE_*`, `FIRE_ITEMS`, `UNDEAD_MONSTERS`, `CLASS_COMBAT_DISCARD`, `CLASS_FLEE_DISCARD`, `ITEM_CONDITIONAL_BONUS`, `SPECIAL_SLOT_ITEMS`, `SPECIAL_SLOTS` |
| `src/cards/bigitems.js` | **neu**, `BIG_ITEMS` (siehe M7) |
| `src/cards/reactions.js` | **neu**, alle Tabellen dieser Runde |

**Abnahmekriterium:** `npm test` läuft 6/6 durch, **ohne dass eine einzige
Testdatei angefasst wurde**. Das ist der Beweis, dass der Umzug sauber war.
`module.exports` von `server.js` behält exakt seine heutige Oberfläche.

### M1 - Tracker für aktive Flüche

Neu: `player.activeCurses = [{ cardId, name, kind, data }]`.

Gesetzt, wenn ein Fluch mit Dauerwirkung aufgelöst wird. Ausgewertet von:

- `combatTotals` - MIESER SPIEGEL (im nächsten Kampf keine Gegenstandsboni
  außer Rüstung), GESCHLECHTSUMWANDLUNG (-5 im nächsten Kampf)
- Würfelwürfe - HUHN AUF DEINEM KOPF (-1 auf alle Würfe)
- `handleUseCardPower` - WUNSCHRING löscht einen aktiven Fluch

Verbraucht sich selbst, wo die Karte "nur im nächsten Kampf" sagt.

> **Achtung:** Jeder Wert, der die Kampfstärke beeinflusst, **muss** in
> `combatSignature` (`server.js:1857`) einfließen, sonst bleibt der
> Bereit-Status der Mitspielenden stehen, während sich die Zahlen ändern.
> Siehe HANDOVER §7.2. Das ist der wahrscheinlichste Weg, funktionierende
> Karten zu beschädigen.

### M2 - Bedingtes Reaktionsfenster

Kein pauschaler Umbau. Eine Funktion
`openReactionWindow(room, trigger, onResolve)` prüft zuerst, ob überhaupt
jemand eine passende Reaktionskarte auf der Hand hat.

- **Niemand hat eine** → sofortige, synchrone Auflösung, **bitgleich zum
  heutigen Verhalten**. Bestehende Weglauf- und Würfelpfade sowie alle
  Bot-Pfade bleiben dadurch per Konstruktion unberührt.
- **Jemand hat eine** → Fenster öffnet sich, Karte kann gespielt werden,
  danach Auflösung.

Zwei Auslöser:

| Auslöser | Karte |
|---|---|
| `roll` | GEZINKTER WÜRFEL (Ergebnis frei ändern) |
| `escapeSucceeded` | KLEBERFLÄSCHCHEN (Flucht muss neu gewürfelt werden) |

Beide Karten dürfen von **jeder** Person am Tisch gespielt werden, nicht nur
von der würfelnden - bei KLEBERFLÄSCHCHEN ist das sogar der Normalfall
("Einsetzbar, wenn **jemand** einem Kampf entkommt"). Das Fenster geht
deshalb an alle Haltenden, in Zugreihenfolge ab der kämpfenden Person.

`escapeSucceeded` ist ein eigener Auslöser, weil die Karte ausdrücklich auch
bei **automatisch** gelungenen Fluchten wirkt ("sogar wenn sie das erste Mal
automatisch gelungen war") - da gibt es keinen Wurf, an den man sich hängen
könnte.

Nebenwirkung: der ZAUBERER-Flugzauber kann damit endlich seinem gedruckten
Text folgen ("*nachdem* du deinen Weglaufwurf gemacht hast"). Siehe HANDOVER
§7.6. Das ist **kein** Teil dieser Runde, nur eine Notiz für später.

### M3 - Warteschlange in `pendingCardAction`

Neu: `room.pendingCardAction.queue = [playerId, ...]`, abgearbeitet in der
Reihenfolge, in der die Liste steht, plus `advanceCardActionQueue(room)`.

**Die Reihenfolge ist kartenspezifisch und muss beim Aufbau der Liste
entstehen, nicht im Abarbeiten.** Die Karten sagen Unterschiedliches:

- HIPPOGREIF: "Beginnend mit dem Spieler **vor** dir in Zugreihenfolge"
- ANWALT: "beginnend mit dem Spieler **nach** dir in Zugreihenfolge"
- LEPRACHAUN: nur die beiden Nachbarn, "von den Spielern **vor und nach**
  dir"
- NETZ-TROLL: nur die Spieler mit der **höchsten Stufe**, unabhängig von der
  Sitzordnung
- FLUCH! EINKOMMENSSTEUER: **alle** anderen

Eine Hilfsfunktion `playerQueueFrom(room, player, mode)` mit den Modi
`'after' | 'before' | 'neighbours' | 'topLevel' | 'allOthers'` deckt alle
fünf Fälle ab.

Der Client rendert bereits "Warte auf X..." für Aktionen, die an jemand
anderen gerichtet sind (`public/client.js:968`). Für den Wartefall ist
**keine** Client-Änderung nötig.

**Zwingend mitzuliefern:** `scheduleBotActionsIfNeeded` (`server.js:3017`)
hat heute **keinen** Zweig für `room.pendingCardAction`. Das fällt bisher
nicht auf, weil alle Erzeuger entweder von Menschen ausgelöst werden oder
einen eigenen Bot-Zweig haben (`server.js:560`). Sobald eine Warteschlange
einen Bot adressiert, steht die Partie. Es braucht deshalb einen generischen
Bot-Auflöser für `pendingCardAction`, der jede Art (`choice`,
`targetPlayer`, `chooseCard`) beantworten kann.

### M4 - Reaktionskarten im Kampf

Reiten auf der bestehenden `combatAllReady`-Schranke statt auf einem neuen
Fenster. `combatReadyRequired` (`server.js:1993`) schließt Bots und Getrennte
bereits aus, es kann also nichts hängen bleiben.

Neue Tabelle `COMBAT_REACTION_CARDS` in `src/cards/reactions.js`, plus ein
Zweig in `handlePlayCombatCard` (`server.js:2316`).

Gilt auch hier: alles, was die Kampfstärke verändert, muss in
`combatSignature`.

### M5 - Kartenanhänge

Neu: `player.attachments`.

- **SCHUMMELN!** markiert genau einen Gegenstand als regelbefreit. Der
  Anhang wird abgelegt, sobald der Gegenstand die Person verlässt.
- **KNIESCHÜTZER DER VERLOCKUNG** erzwingt Hilfe von höherstufigen
  Mitspielenden und setzt die Sperre für die Siegesstufe.

### M6 - Siegregel

- `checkWin` verschwindet aus `handleSellItems` (`server.js:2791`). Die
  Siegesstufe ist laut Regelwerk nur durch das Töten eines Monsters
  erreichbar.
- **GOTTLICHE INTERVENTION** wird die gedruckte Ausnahme ("Dies darf die
  Siegesstufe sein") und ruft `checkWin` ausdrücklich auf.
- KNIESCHÜTZER-Sperre wird in `resolveCombatWin` berücksichtigt.

Kartenname in den Rohdaten ist `GOTTLICHE INTERVENTION` (ohne Umlaut) -
Tabellen müssen exakt so indiziert werden.

### M7 - "Großer Gegenstand"

Kuratierte Namensliste `BIG_ITEMS` in `src/cards/bigitems.js` plus ein
Prädikat `isBigItem(card)`. Bewusst **keine** Änderung an
`data/cards.json` - dieselbe Bauform wie `UNDEAD_MONSTERS`, damit die Liste
an genau einer Stelle korrigierbar bleibt, falls sie von den echten Karten
abweicht.

Mit dem Nutzer abgestimmte Liste (8 Karten):

```
KETTENSÄGE DER BLUTIGEN ZERSTÜCKELUNG
STANGE, 11-FUSS
RIESIGER FELS
MITHRIL-RÜSTUNG
SCHWEIZER ARMEEHELLEBARDE
GANZKÖRPER-SCHILD
TUBA DER VERZAUBERUNG
TRITTLEITER
```

Ausdrücklich **nicht** groß, obwohl zunächst vermutet: BOGEN MIT BUNTEN
BÄNDERN, STRUMPFHOSE DER RIESENSTÄRK, NAPALMSTAB, KURZE BREITE RÜSTUNG.

Regelwirkung: Nicht-Zwerge dürfen nur **einen** Großen Gegenstand tragen.
Das gibt ZWERG endlich eine wirksame Rassenkraft und SCHUMMELN! eine echte
Beschränkung zum Umgehen.

Klassen-/Rassen-/Geschlechtsbeschränkungen auf Gegenständen
(VERDUNKELUNGSUMHANG nur Dieb, SPITZER HUT DER MACHT nur Zauberer, ...)
bleiben bewusst **außen vor** - sie werden nicht gebraucht, sobald `big`
existiert. Mit `ponytail:`-Kommentar vermerken.

## 4. Kartenzuordnung

| Karte | Mechanismus |
|---|---|
| WUNSCHRING, MIESER SPIEGEL, GESCHLECHTSUMWANDLUNG, HUHN AUF DEINEM KOPF | M1 |
| GEZINKTER WÜRFEL, KLEBERFLÄSCHCHEN, SCHNECKEN AUF SPEED | M2 |
| HIPPOGREIF, ANWALT, LEPRACHAUN, NETZ-TROLL, VERSICHERUNGSVERTRETER, FLUCH! EINKOMMENSSTEUER, HILF MIR, DIEB (beide Kräfte) | M3 |
| KUMPEL, WANDERNDES MONSTER, ILLUSION, HILF MIR, ÜBERFALLTRANK, DIEB "In den Rücken fallen" | M4 |
| SCHUMMELN!, KNIESCHÜTZER DER VERLOCKUNG | M5 |
| Verkaufs-Sieg, GOTTLICHE INTERVENTION, KNIESCHÜTZER-Sperre | M6 |
| GALLERT-OKTAEDER, VERLIERE 1 GROSSEN GEGENSTAND, GRÜNSCHLEIM, ZWERG | M7 |
| MAGISCHE LAMPE | bestehendes `combat.fleeRerollOffer` |
| MÖCHTEGERN-VAMPIR, LAUFENDE NASE, PIT BULL | bestehendes `openCardChoice` bei Kampfbeginn, wie BEKIFFTER GOLEM |
| ZUNGENDÄMON | erzwungenes Ablegen bei Kampfbeginn |
| PRIESTER "Auferstehung" | eigener Handler, eigener Zug |
| VERSTÜMMLE DIE LEICHEN | Prüfung auf `room.combatHappenedThisTurn` (existiert bereits, `server.js:162`) |
| SUPER MUNCHKIN, HALB-BLUT | Zweig in `monsterTraitBonusSum` |

**SUPER MUNCHKIN / HALB-BLUT** brauchen keinen Moduswahl-Dialog. Der
Kartentext leitet sich selbst ab: Cap-Karte + genau **1** Klasse ⇒ keine
Nachteile; Cap-Karte + **2** Klassen ⇒ normal mit allen Nachteilen.

## 5. Bewusst nicht umgesetzt

| Karte / Punkt | Grund |
|---|---|
| AMAZONE | Geschlecht wird nicht erfasst und soll es nicht |
| ANWALT, Dieb-Tauschoption | Toter Code: `MONSTER_REFUSES` verhindert bereits den Angriff auf Diebe, die Alternative tritt nie ein |
| SCHATZHORT!, verdecktes Ziehen | Es gibt kein Konzept "offen/verdeckt" für Schätze |
| Klassen-/Rassenbeschränkungen auf Gegenständen | Nicht nötig, sobald `big` existiert (siehe M7) |
| 34 Basis-Karten ohne `text` in `cards.json` | Eigenständiges Datenproblem, nicht Teil dieser Runde |

Diese fünf Punkte gehören unverändert in HANDOVER §8, damit die nächste
Session nicht erneut danach sucht.

## 6. Schutz gegen Regressionen

1. **M0 ist verhaltensneutral** und wird dadurch bewiesen, dass die
   bestehenden Tests **unverändert** grün bleiben.
2. **`module.exports` von `server.js`** behält exakt seine heutige
   Oberfläche - keine Testdatei muss ihren `require`-Block anfassen.
3. **`combatSignature`** ist Prüfpunkt bei *jeder* Aufgabe, die Kampfwerte
   berührt. Wer daran vorbeirechnet, lässt den Bereit-Status veralten.
4. **M2 löst synchron auf**, wenn niemand eine Reaktionskarte hält - die
   bestehenden Würfel- und Fluchtpfade sind dadurch unverändert.
5. **Bot-Deadlocks:** jede neue Interaktion muss einen Bot-Pfad haben. M3
   liefert den generischen Auflöser; `combatReadyRequired` schließt Bots
   bereits aus.

## 7. Teststrategie

`tests/run.js` findet `*.test.js` automatisch. Jede Aufgabe bekommt deshalb
eine **eigene neue Testdatei** - keine Konflikte zwischen parallel
arbeitenden Agenten, und die bestehenden sechs Dateien bleiben als
Regressionsnetz unangetastet.

Verhaltenstests nach dem Vorbild von `tests/card-passives.test.js`: ein
echtes Raum-Objekt bauen und den vollständigen Handler aufrufen. **Keine**
Tests, die nur Tabelleninhalte prüfen - eine Tabelle, die nirgends
ausgewertet wird, bestünde so einen Test.

Geplante Dateien: `card-crossplayer`, `card-attachments`, `card-reactions`,
`card-curses`, `card-combat-reactions`, `card-badstuffs`,
`card-alternatives`, `card-bigitems`, `card-classpowers`.

## 8. Abnahme

- `npm test` grün, inklusive der sechs bestehenden Dateien
- Ein Durchlauf im Browser (Solo-Raum mit Bots), der keine Partie hängen
  lässt
- HANDOVER §8 mit dem neuen Stand und der Liste aus Abschnitt 5
