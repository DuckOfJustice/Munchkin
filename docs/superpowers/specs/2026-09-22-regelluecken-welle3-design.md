# Regellücken Welle 3: Barde und Verstärker pro Monster

Stand: 2026-09-22. Welle 1 (PR #17) und Welle 2 (PR #18) sind offen; diese
Welle setzt auf `origin/main` auf und berührt beide nicht inhaltlich.

## Ziel

Die letzten beiden großen Lücken aus der Prüfung vom 2026-09-22:

1. Die Klasse **BARDE** hat zwei Kräfte; „Bardenglück" ist halb umgesetzt,
   „Verzaubern" fehlt vollständig. Der Abdeckungs-Scan meldet die Karte nicht,
   weil eine Klassenkarte allein durch ihr Auslegen als abgedeckt gilt.
2. **Monster-Verstärker** („+10 für das Monster") zählen kampfweit statt pro
   Monster. Verschwindet ein Monster, bleibt sein Verstärker wirksam - obwohl
   die ILLUSION ausdrücklich sagt: „Lege ein beliebiges Monster in diesem Kampf
   ab, zusammen mit allen Karten, die gespielt wurden, um es zu verändern".

## 1. Verstärker pro Monster

**Heute:** `room.combat.monsterModifier` ist ein einziges Feld für alles, was
die Monsterseite stärkt (Verstärkerkarten, Kampf-Tränke „für das Monster",
Würfelergebnisse, MAMI). Dazu kommen `enhancerIds`, `enhancerBonus` und
`enhancerTreasure` als Sammelwerte für KUMPEL. Welches Monster ein Verstärker
trifft, weiß der Server nicht (`ponytail:`-Notizen in `applyCombatReaction` und
bei `removeOneMonster`).

**Soll (Nutzerentscheidung: Ziel wählen ab zwei Monstern):**

- Neue Liste `room.combat.enhancers`: je gespielter Verstärkerkarte ein Eintrag
  `{ cardId, monsterId }`. `enhancerIds`, `enhancerBonus` und `enhancerTreasure`
  entfallen; ihre bisherigen Leser rechnen aus der Liste.
- Beim Ausspielen eines Verstärkers mit **mehr als einem** Monster im Kampf
  wählt die spielende Person das Zielmonster (gleicher Wahldialog wie bei der
  MAGISCHEN LAMPE). Bei genau einem Monster keine Rückfrage.
- Die Monsterstärke zählt für jedes Monster im Kampf seine eigenen Verstärker.
  Steht dasselbe Monster zweimal im Kampf (KUMPEL: „ein weiteres Monster mit
  den gleichen Monsterverstärker-Karten"), zählen seine Verstärker zweimal -
  das ergibt sich aus der Rechnung und ersetzt die heutige Sonderbehandlung.
- Verschwindet ein Monster (POLLYVERWANDLUNGSTRANK, ILLUSION, MONSTER SIND
  BESCHÄFTIGT, TYPOGRAFISCHER FEHLER lässt es stehen), gehen seine Verstärker
  mit: Bonus und Schatzzuschlag fallen weg, die Karten liegen wie bisher auf
  dem Ablagestapel.
- Kartenwirkungen, die heute „irgendein Monster im Kampf" prüfen, prüfen künftig
  das Zielmonster des Verstärkers:
  - **Gigantischer Fungus** (+25 statt +10): nur wenn GIGANTISCH auf dem FUNGUS
    liegt. Ebenso die Verdopplung der Schlimmen Dinge (Welle 1, PR #16).
  - **RAPIER-TROTTEL** (verdoppelt Verstärker): nur für Verstärker auf dem
    Trottel selbst.
  - **UNTOT** („Das Monster zählt jetzt als Untoter"): nur das Zielmonster gilt
    als untot, nicht der ganze Kampf.
  - **BABY** / **MAMI**: ihre heutige Sonderrechnung liest dieselbe Liste.
- Kampf-Tränke „für das Monster", Würfelboni und MAMIs Zuschlag bleiben
  kampfweit in `monsterModifier` - sie nennen kein einzelnes Monster.

## 2. BARDE „Verzaubern"

**Karte:** „Im Kampf kannst du in deinem Zug eine Karte abwerfen und einen
Rivalen wählen. Ihr würfelt beide, wenn dein Wurf besser ist als seiner, *muss*
er dir helfen und kann keine Belohnung verlangen. Wenn du scheiterst, darfst du
erneut ablegen und versuchen, einen anderen Rivalen zu verzaubern, bis du
Erfolg hast, aufgibst oder dir die Karten oder Gegner ausgehen. Du kannst das
Spiel mit dieser Fähigkeit nicht gewinnen."

**Soll (Nutzerentscheidung: pro Klick ein Versuch):**

- Angeboten wird die Kraft nur der **kämpfenden** Person mit Klasse BARDE, im
  eigenen Zug, solange der Kampf noch keine helfende Person hat und mindestens
  eine Handkarte sowie ein möglicher Rivale da sind.
- Ein Versuch: Karte abwerfen (frei gewählt), Rivalen wählen, beide würfeln.
  Beide Würfe laufen über das vorhandene Wurf-Fenster, damit GEZINKTER WÜRFEL
  und KATZENINTERVENTION reagieren dürfen und der Huhn-Malus zählt.
- Höherer Wurf des Barden: die gewählte Person wird helfende Person, ohne
  Belohnung und ohne Ablehnmöglichkeit (gleiche Bauform wie der KNIESCHÜTZER
  DER VERLOCKUNG: `helperPending.compelled`). Gleichstand oder niedriger: der
  Versuch ist gescheitert, die Karte bleibt weg, ein neuer Versuch ist möglich.
- „Du kannst das Spiel mit dieser Fähigkeit nicht gewinnen": gewinnt die
  kämpfende Person diesen Kampf auf Stufe 10, zählt der Sieg nicht als
  Spielsieg - dieselbe Prüfung wie beim Verkaufen (`winAllowed`/`checkWin`).
  Umgesetzt als Kampf-Merker, der beim Sieg gelesen wird.
- Die erzwungene Hilfe endet wie jede andere mit dem Kampf.

## 3. BARDE „Bardenglück" - Abwerfen

**Karte:** „Wenn du in deinem Zug einen Kampf gewinnst, ziehe einen
zusätzlichen Schatz. Sieh sie dir alle an und wirf sofort einen ab (beliebig)."

**Heute:** Der Extraschatz wird gezogen, das Abwerfen ist nur eine Logzeile.

**Soll:** Nach der Belohnung öffnet sich für die Bardin/den Barden eine Wahl
über **alle** Karten auf der Hand („sieh sie dir alle an"), genau eine davon
wandert auf den Ablagestapel. Läuft über `pendingConsequence.choice` bzw. den
vorhandenen Kartenwähler, damit kein zweiter Wartezustand neben der Beute
entsteht. Gewinnt eine Bardin ohne Handkarten (theoretisch möglich), entfällt
die Wahl.

## Nicht im Umfang

- Die DRYADE liest die Klassen direkt und sieht eine Zaubercouch-„Ja"-Antwort
  nicht (Fund aus Welle 1, weiterhin zurückgestellt).
- „Verzaubern" gegen Bots: Bots würfeln wie alle anderen mit, entscheiden aber
  nichts - sie können die erzwungene Hilfe ohnehin nicht ablehnen.

## Tests

Neue Datei `tests/card-regelluecken-welle3.test.js`:

- Verstärker: Ziel wählen bei zwei Monstern; Bonus zählt nur für sein Monster;
  Monster entfernt → Bonus und Schatzzuschlag weg; KUMPEL verdoppelt die
  Verstärker seines Monsters; GIGANTISCH auf dem FUNGUS gibt +25, auf einem
  anderen Monster nicht; UNTOT macht nur sein Monster untot.
- Barde: erfolgreicher und gescheiterter Verzauber-Versuch (Würfel gestellt),
  Karte ist in beiden Fällen weg, erzwungene Hilfe kann nicht abgelehnt werden,
  kein Spielsieg auf Stufe 10 nach erzwungener Hilfe; Bardenglück öffnet die
  Abwurf-Wahl und legt genau eine Karte ab.
- Gegenproben: ein Monster im Kampf → keine Zielabfrage; Nicht-Barden bekommen
  die Kraft nicht angeboten.

`npm test` bleibt grün.
