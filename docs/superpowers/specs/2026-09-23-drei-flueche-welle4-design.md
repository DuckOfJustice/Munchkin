# Regellücken Welle 4: drei Flüche aus Clerical Errors

Stand: 2026-09-23. Setzt auf `fix/welle3-barde-verstaerker` auf (Welle 3 noch
nicht in `main`); wird Welle 3 vorher gemergt, auf `main` umsetzen.

## Ziel

Der Abdeckungs-Scan (`node tools/coverage-scan.js clericalerrors`) meldet drei
Flüche ohne jede Automatik. In `src/cards/consequences.js` stehen sie nur als
`() => null`, sonst nirgends:

- TEMPORÄRE ANMNESIE
- HUNGRIGER RUCKSACK
- TOURISTENFALLE

Alle drei sind anhaltende Flüche und kommen in `LINGERING_CURSES`
(`src/cards/reactions.js`). Damit gelten für sie automatisch die vorhandenen
Wege: Anzeige in `activeCurses`, Ende per WUNSCHRING, Schutz durch
Fluchschutz-Gegenstände. Das Ende nach Bedingung läuft über
`clearActiveCurseByKind` (Vorbild: Weihnachtsmann-Fluch `noTreasure` in
`finishCombatWin`).

## 1. TEMPORÄRE ANMNESIE

**Karte:** „Eine Beule am Kopf lässt dich deine Klasse(n) und Rasse(n)
vergessen. Du wirst dich erst an sie erinnern, wenn du ein Monster getötet hast
oder dabei geholfen hast, eines zu töten. Bis dahin wirst du überall als
klassenloser Mensch gezählt."

**Soll (Nutzerentscheidung: Variante A, Karten bleiben liegen, zählen aber nicht):**

- Eintrag `'TEMPORÄRE ANMNESIE': { kind: 'amnesie', dauer: 'dauerhaft', hinweis: ... }`.
- Neue Hilfsfunktionen `aktiveKlassen(player)` und `aktiveRassen(player)`:
  liefern `[]`, solange ein `amnesie`-Eintrag in `activeCurses` steht, sonst
  `player.classes` bzw. `player.races`.
- `hasClass`, `hasRace` und `istMensch` (`src/cards/passives.js`) lesen über
  diese Hilfsfunktionen. Ebenso jede andere Stelle, die `.classes`/`.races`
  **als Wirkung** liest (Klassen-Kampfkräfte, DRYADE, Monsterboni gegen Rassen,
  Fluchtregeln u. Ä.). Stellen, die die Karten **als Besitz** lesen, bleiben bei
  den echten Listen: Obergrenzen (wie viele Klassen/Rassen ausliegen dürfen),
  Auslegen/Ablegen, Handel, Verkauf, Anzeige der ausliegenden Karten.
- Neue Klassen- oder Rassenkarten dürfen während des Fluchs ausgelegt werden;
  sie wirken ebenfalls erst nach dem Fluch.
- **Ende:** Die Person gewinnt einen Kampf als kämpfende Person oder als
  Helfer:in (`finishCombatWin`, für beide Beteiligten). Ein Monster, das durch
  eine Kartenwirkung verschwindet, zählt nicht als „getötet".
- Die ZAUBERCOUCH (Gegenstand, „wirst du ... als Zauberer angesehen") wirkt
  weiter. Das wird mit `ponytail:` markiert: Die Karte ist ein Gegenstand, keine
  Erinnerung. Aufrüstweg: `itemGrantsTrait` in `hasClass` ebenfalls sperren.
- **Client:** ausliegende Klassen- und Rassenkarten der verfluchten Person
  werden ausgegraut und mit „vergessen" beschriftet. Der Client liest dafür den
  vorhandenen `activeCurses`-Eintrag (`kind: 'amnesie'`), keine neue Server-Zahl.

## 2. HUNGRIGER RUCKSACK

**Karte:** „Am Ende jedes deiner Züge würfelst du, bevor ‚Milde Gabe' verteilt
oder abgelegt wird. Dein Rucksack frisst entsprechend des Wurfs so viele
zufällige Karten deiner Hand! Bei einer gewürfelten 6 verschluckt der Rucksack
sich selbst und verschwindet. Deine Hand bleibt unversehrt und der Fluch endet."

**Soll:**

- Eintrag `'HUNGRIGER RUCKSACK': { kind: 'rucksack', dauer: 'dauerhaft', hinweis: ... }`.
- **Zeitpunkt:** beim Wechsel in Phase `gabe`. Das passiert an fünf Stellen
  (`handleLootRoom` und viermal über `combatEndPhase`); alle fünf laufen künftig
  über eine Funktion `setzeZugphase(room, phase)`, die beim Eintritt in `gabe`
  den Rucksack auslöst.
  Hat die Person am Zug den Fluch, würfelt sie über `rollWithWindow` (Zweck
  `'rucksack'`), damit GEZINKTER WÜRFEL, KATZENINTERVENTION und der Huhn-Malus
  gelten.
- **Wurf 6:** Der Fluch endet (`clearActiveCurseByKind(player, 'rucksack')`),
  die Hand bleibt unverändert.
- **Wurf 1–5:** Der Rucksack frisst so viele **zufällige** Handkarten (alle,
  wenn es weniger sind). Jede Karte kommt auf ihren Ablagestapel
  (`discardCard`). Die Logzeile nennt nur die Anzahl: Handkarten sind geheim,
  `log()` darf keine privaten Karten verlinken.
- Der Fluch wirkt einmal pro eigenem Zug. Solange das Wurf-Fenster offen ist,
  blockiert `zugAktionOffen` das Beenden des Zugs, wie bei jedem offenen Wurf.
- Wird der Zug ohne Phase `gabe` beendet (z. B. Aussetzen durch KALI), wird
  nicht gewürfelt: Es gab keinen eigenen Zug, der endet.

## 3. TOURISTENFALLE

**Karte:** „Du darfst nicht ‚Auf Ärger aus sein'. Dieser Fluch bleibt bestehen,
bis du einem anderen Spieler geholfen hast, einen Kampf zu gewinnen."

**Soll:**

- Eintrag `'TOURISTENFALLE': { kind: 'keinAerger', dauer: 'dauerhaft', hinweis: ... }`.
- `handlePlayMonsterFromHand` lehnt ab, solange der Fluch wirkt, mit einer
  Logzeile. Der Client blendet die Aktion „Auf Ärger aus sein" aus. Bots
  versuchen es nicht (gleiche Prüfung vor ihrem Aufruf bzw. derselbe Riegel im
  Handler).
- **Ende:** Die Person ist Helfer:in in einem gewonnenen Kampf
  (`finishCombatWin`, `c.helperId`). Ein eigener Sieg beendet den Fluch nicht.

## Nicht im Umfang

- Kein neuer Ablageort für „vergessene" Karten (Variante B wurde verworfen).
- Monster, die durch Kartenwirkung verschwinden, beenden die ANMNESIE nicht.
- DRYADE/ZAUBERCOUCH-Zusammenspiel aus Welle 1 bleibt wie dokumentiert offen.

## Tests

Neue Datei `tests/card-clerical-fluechewelle4.test.js` (Raum/Spieler im
Speicher, Würfel über `Math.random` gestellt):

- ANMNESIE: `hasClass`/`hasRace` sind falsch, solange der Fluch wirkt; ein
  Monsterbonus gegen eine Rasse greift nicht; ein Kampfsieg als kämpfende Person
  beendet den Fluch; ebenso ein Sieg als Helfer:in; neue Klassenkarte wirkt erst
  nach dem Fluch.
- RUCKSACK: Wurf 3 frisst genau 3 Handkarten (oder alle bei kleinerer Hand);
  Wurf 6 beendet den Fluch und lässt die Hand unverändert; ohne Fluch wird nicht
  gewürfelt.
- TOURISTENFALLE: Monster aus der Hand spielen wird abgelehnt; ein eigener Sieg
  beendet den Fluch nicht; ein Sieg als Helfer:in beendet ihn.
- Alle drei: WUNSCHRING beendet den Fluch.

`npm test` bleibt grün; `node tools/coverage-scan.js clericalerrors` meldet die
drei Flüche nicht mehr.
