# Regellücken Welle 1: Hase, Halb-Blut, Schilde, Huhn, Zaubercouch

Stand: 2026-09-22. Gefunden per Reproduktion gegen den laufenden Code (nicht
nur aus Kommentaren). Welle 2 (anhaltende Flüche) und Welle 3 (Barde,
Trojanisches Pferd, Verstärker pro Monster) bekommen eigene Specs.

## Ziel

Fünf Stellen, an denen der Server von der gedruckten Karte abweicht,
kartengetreu machen. Jede mit einem Test, der vorher fehlschlägt.

## 1. DER GANZ NORMALE HASE: Helfer kann nicht entkommen

**Karte:** „Nachdem du entschieden hast, ob und wer dir im Kampf hilft, wirf
einen Würfel. Bei einer 6 ist es ‚Der Hase Aus Dem Film‘ auf Stufe 15 und der
Helfer kann nicht mehr entkommen …“

**Heute:** Bei einer 6 steigt nur die Stufe (`haseAnwenden`). In der
Fluchtphase würfelt die helfende Person normal und kann entkommen
(reproduziert: Helfer würfelt 6 → „geschafft!“).

**Soll:** `haseAnwenden` merkt sich bei einer 6 am Kampf, dass die helfende
Person gefangen ist. Ist sie in der Fluchtreihe dran, scheitert ihre Flucht
automatisch ohne Wurf (Logzeile „kann nicht mehr entkommen“) und sie bekommt
wie jede gescheiterte Person die Schlimmen Dinge. Die kämpfende Person
würfelt normal. Kam erst nach dem Wurf eine helfende Person dazu, gilt die
Sperre ebenfalls (die Karte spricht von „dem Helfer“ dieses Kampfs).

## 2. HALB-BLUT / SUPER MUNCHKIN: keine Nachteile der Rasse

**Karte (HALB-BLUT):** „… oder du darfst eine Rassenkarte haben und hast alle
Vorteile aber keine Nachteile.“ SUPER MUNCHKIN entsprechend für Klassen.

**Heute:** Der Schutz (`traitImmun`) greift nur bei den Kampfboni der
Monster gegen Rassen/Klassen (`monsterTraitBonusSum`). Reproduziert: ein
Halb-Blut-Elf verliert gegen den ZUNGENDÄMON 3 statt 2 Stufen, ein
Halb-Blut-Halbling muss gegen den BEKIFFTEN GOLEM kämpfen.

**Soll:** Eine gemeinsame Prüfung „hat Rasse X mit ihren Nachteilen“ =
`hasRace(p, X) && !traitImmun(p, 'races')` (Halb-Blut mit zwei Rassen hat
laut Karte alle Nachteile, das deckt `traitImmun` schon ab). Sie ersetzt das
blanke `hasRace` überall dort, wo die Rasse ein Nachteil ist:

| Stelle | Nachteil |
|---|---|
| ZUNGENDÄMON (Schlimme Dinge) | Elfen 3 statt 2 Stufen |
| FUNGUS (Schlimme Dinge) | Elfen 2 statt 1 Stufe |
| MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT (Schlimme Dinge) | Elfen +2, Halblinge +1 Stufe |
| BEKIFFTER GOLEM (`MONSTER_PASS_OPTION.forcedFightRaces`) | Halblinge müssen kämpfen |
| KRAKZILLA (`MONSTER_REFUSES`) | greift Elfen auch auf Stufe ≤ 4 an |
| SPASSBREMSE (`DEADLY_ITEMS_BY_RACE`) | tödlich für Gnome |

Klassen: außerhalb der Monster-Kampfboni gibt es heute keine Stelle, an der
eine Klasse ein Nachteil ist. Bei der Umsetzung wird das noch einmal per
Suche geprüft; findet sich eine, gilt dieselbe Prüfung mit `'classes'`.

Vorteile bleiben unverändert (z. B. Elf +1 auf Weglaufen, Halbling-Würfel).

## 3. Schilde sind keine Waffen

**Karten:** MONDJUNGFERN „In diesem Kampf erhältst du keine Vorteile durch
Waffen.“ KALI „… es sei denn, du verteidigst dich mit (mindestens) 2 eigenen
Waffen.“

**Heute:** „Waffe“ heißt im Code „belegt eine Hand“ (`handItemIds`,
`waffenAnzahl`). Reproduziert: GANZKÖRPER-SCHILD (+4) zählt gegen die
Mondjungfern nicht, Stärke 5 statt 9.

**Soll:** Kuratierte Liste `SHIELD_ITEMS` = FLOTTER BUCKLER, GANZKÖRPER-SCHILD
(die einzigen Schilde in `data/cards.json`). Neue Id-Menge „Waffen“ =
Hand-Gegenstände ohne Schilde; sie ersetzt `handItemIds` genau dort, wo die
Regel „Waffe“ sagt (MONDJUNGFERN, KALI). Wo die Regel „Hand-Gegenstand“
meint (z. B. LUSTMONSTER-Fluch `noHandItemBonus`), bleiben Schilde drin.

## 4. HUHN AUF DEINEM KOPF fällt mit der Kopfbedeckung

**Karte:** „-1 auf alle Würfe. Jeder Fluch oder alle Schlimmen Dinge, die
deine Kopfbedeckung entfernen, nehmen das Huhn mit.“

**Heute:** Reproduziert: Kopfbedeckung per Schlimme Dinge abgelegt, der
Huhn-Eintrag in `activeCurses` bleibt.

**Soll:** Im gemeinsamen Konsequenzweg (`autoApplyLossConsequence` und
`handleResolveConsequenceChoice`, beide für Flüche und Schlimme Dinge) wird
vor dem Anwenden die getragene Kopfbedeckung notiert. Ist danach keine mehr
da, endet das Huhn (Logzeile). Eine Stelle für alle heutigen und künftigen
„Kopfbedeckung verlieren“-Karten. Freiwilliges Ablegen oder Verkaufen
entfernt das Huhn nicht (die Karte nennt nur Flüche und Schlimme Dinge).

## 5. ZAUBERCOUCH: Wahl zu Beginn jedes Kampfs

**Karte:** „Wenn du dich auf dieser Couch ausruhst, wirst du in allen
Belangen zusätzlich zu deiner (oder deinen) ursprünglichen Klasse(n) als
Zauberer angesehen. Du kannst zu Beginn eines jeden Kampfes entscheiden, ob
du die Zaubercouch verwenden willst. Wenn du es tust, erhältst du -1 auf
Weglaufen.“

**Heute:** Die Couch gilt immer als benutzt: dauerhaft Zauberer, dauerhaft
-1 auf Weglaufen (reproduziert).

**Soll (Nutzerentscheidung: Frage bei jedem Kampfbeginn):**
- Nimmt jemand mit angelegter Couch an einem Kampf teil (kämpfende Person bei
  Kampfbeginn, helfende Person beim Einstieg), steht im Kampf eine offene
  Frage für diese Person: „Zaubercouch verwenden? Ja / Nein“. Die Antwort
  gilt für diesen Kampf und ist danach fest.
- Solange eine Couch-Frage offen ist, kann der Kampf nicht ausgewertet werden
  (gilt für kämpfende und helfende Person; die helfende Person kann auch
  nicht „Bereit“ drücken).
- Nur bei „Ja“: in diesem Kampf Zauberer (Klassenkräfte, Monsterboni gegen
  Zauberer, alles, was `itemGrantsTrait` für die Couch liefert) und -1 auf
  Weglaufen.
- Außerhalb eines Kampfs macht die Couch nicht zum Zauberer.
- Bots antworten automatisch mit „Nein“ (keine Blockade).
- Client: die Frage erscheint im Kampf-Panel bei der betroffenen Person.

## Nicht im Umfang

- Welle 2/3 (siehe oben).
- Weitere Stellen, an denen „Waffe“ oder „Rasse“ vorkommt, ohne dass die Karte
  einen Nachteil bzw. eine Waffe meint.

## Tests

Neue Datei `tests/card-regelluecken-welle1.test.js`, je Punkt mindestens:
Fehlerfall reproduziert (schlägt vor dem Fix fehl) plus Gegenprobe (z. B.
Elf ohne Halb-Blut verliert weiter 3 Stufen, Schwert zählt gegen Mondjungfern
weiter nicht, Couch mit „Nein“ kein Malus). `npm test` bleibt grün.
