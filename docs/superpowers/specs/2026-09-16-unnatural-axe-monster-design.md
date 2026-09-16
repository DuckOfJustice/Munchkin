# Unnatural Axe: die Monsterkarten

Datum: 2026-09-16. Erster Abschnitt der Unnatural-Axe-Umsetzung. Bewusst
eingegrenzt auf die **27 Monsterkarten** des Sets — Türkarten, Flüche und
Schätze aus Unnatural Axe bleiben außen vor und bekommen eigene Runden.

Vorbild für Aufbau und Arbeitsweise sind die beiden vorangegangenen Runden:
`docs/superpowers/plans/2026-09-12-basis-set-kartenkraefte.md` und
`2026-09-13-clerical-errors-kartenkraefte.md`.

## 1. Ausgangslage

Von den 27 Monstern ist heute fast nichts verdrahtet:

- **Kampfregeln (`text`):** genau drei Einträge — PTERODAKTYL und
  FÜRCHTERLICHE CLOWNS in `MONSTER_TRAIT_BONUS`, DIE SCHATTENNASE in
  `UNDEAD_MONSTERS`. Alle anderen Kartentexte sind wirkungslos.
- **Schlimme Dinge (`badstuff`):** 18 von 27 laufen bereits, teils über den
  generischen `parseAutoConsequence`, teils über bestehende
  `CONSEQUENCE_OVERRIDES`. Neun fehlen.

Die Mechanik dafür existiert weitgehend. Gebraucht und vorhanden sind:
`MONSTER_TRAIT_BONUS` (mit `races`/`classes`/`wennErfuellt`, Regel-Arrays,
negativen Boni und `nurKaempfer`), `MONSTER_REFUSES`,
`MONSTER_REFUSES_TREASURE`, `MONSTER_IGNORES_BONUSES`, `MONSTER_FORBIDS_HELP`,
`FLEE_MONSTER_MOD`, `FLEE_IMPOSSIBLE`, `MONSTER_AUTO_KILL_BY_RACE`,
`COMBAT_START_OPTIONS`, `FIRE_ITEMS`, `waffenAnzahl`, `istGeschlecht`,
`LINGERING_CURSES` sowie die Primitive `queuedDiscardOwn`,
`queuedTakeFromHand`, `queuedTakeItem`, `levelDelta`, `discardWholeHand`,
`combo` und `choice`.

## 2. Abgrenzung

Drin: alle Kampfregeln und alle Schlimmen Dinge der 27 Monster.

Draußen: Türkarten, Flüche und Schatzkarten aus Unnatural Axe. Wo eine
Monsterregel eine solche Karte erwähnt (PSYCHO-EICHHÖRNCHEN nennt den
STACHELIGEN GENITALSCHONER), wird nur der Monsterteil gebaut; die genannte
Karte bleibt unverändert und die Regel prüft schlicht, ob sie getragen wird.

## 3. Entscheidungen

**„Mensch" = keine Rassenkarte.** RIESENKAKERLAKE („+5 gegen Elfen oder
Menschen") und GRASGNOLL („+5 gegen Menschen") brauchen den Begriff. Umgesetzt
als `wennErfuellt`, nach dem Vorbild von RÜSSELKÄFER („+3 gegen die, die keine
Klasse haben"). Geprüft wird durch dieselbe Brille wie alle anderen
Monsterboni, also über `monsterSeesRace` — wer FALSCHE OHREN trägt, gilt für
Monster als Zwerg und damit nicht als Mensch.

**„-2 am Samstag" wird echt ausgewertet.** Die vierte Klausel des MONSTERS,
DAS DER SL SICH SELBST AUSGEDACHT HAT prüft den realen Wochentag. Das ist der
Gag der Karte, kostet eine Zeile und ist deterministisch. Bekannte Folge: über
Mitternacht hinweg ändert sich die Monsterstärke — wird im Code vermerkt.

**`wennErfuellt` bekommt den Raum dazu.** Heute lautet die Signatur
`(player) => bool`. FEUERLÖSCHER („+5, wenn dir niemand hilft") braucht den
Kampfzustand. Die Signatur wird additiv zu `(player, room) => bool` erweitert;
alle bestehenden Regeln ignorieren das zweite Argument und bleiben unberührt.

## 4. Die 27 Monster

Spalte „Welle" steuert die Reihenfolge der Umsetzung (siehe Abschnitt 6).

### 4.1 Kampfregeln aus `text`

| Monster | Regel | Mechanismus | Welle |
|---|---|---|---|
| KATZENMÄDCHEN | +5 gegen Orks | `MONSTER_TRAIT_BONUS` | 1 |
| TEDDYBÄR | +5 gegen Orks | `MONSTER_TRAIT_BONUS` | 1 |
| JUDGE FREDD | +5 gegen Diebe | `MONSTER_TRAIT_BONUS` | 1 |
| M.T.-ANZUG | +5 gegen Zauberer oder Diebe | `MONSTER_TRAIT_BONUS` | 1 |
| DING MIT ÜBERLANGEM NAMEN | +5 gegen Krieger | `MONSTER_TRAIT_BONUS` | 1 |
| TENTAKELDÄMON | +5 gegen Priester | `MONSTER_TRAIT_BONUS` | 1 |
| JABBERWOCK | +3 gegen Zwerge **oder** Zauberer (addiert sich auf +6) | Regel-Array | 1 |
| WEIHNACHTSMANN | -5 gegen Elfen | negativer Bonus | 1 |
| ROTZ-ELEMENTAR | +4 gegen Elfen | `MONSTER_TRAIT_BONUS` | 1 |
| FÜRCHTERLICHE CLOWNS, PTERODAKTYL | +5 gegen Halblinge | **schon da** | — |
| TENTAKELDÄMON, FEUERLÖSCHER | greift niemanden mit Stufe ≤2 an | `MONSTER_REFUSES` | 1 |
| JABBERWOCK | greift niemanden mit Stufe ≤4 an | `MONSTER_REFUSES` | 1 |
| WERSCHILDKRÖTE | +2 auf Weglaufen | `FLEE_MONSTER_MOD` | 1 |
| PESTRATTEN | -1 auf Weglaufen für alle außer Orks | `FLEE_MONSTER_MOD` | 1 |
| GEWALTIGER BAZILLUS | Halblinge töten automatisch | **schon da** | — |
| RIESENKAKERLAKE | +5 gegen Elfen oder Menschen | `wennErfuellt` (Mensch) | 2 |
| GRASGNOLL | +5 gegen Menschen | `wennErfuellt` (Mensch) | 2 |
| FEUERLÖSCHER | +5, wenn niemand hilft | `wennErfuellt` mit Raum | 2 |
| MONSTER, DAS DER SL … | +4 Zwerge, +2 Frauen, -3 Zauberer, -2 samstags | Regel-Array, `istGeschlecht`, Wochentag | 2 |
| PSYCHO-EICHHÖRNCHEN | greift keine Frauen an, auch keine Träger des Stacheligen Genitalschoners | `MONSTER_REFUSES` mit Bedingung | 2 |
| PESTRATTEN | flüchtet vor Orks und lässt den Schatz da | `MONSTER_REFUSES` + `MONSTER_REFUSES_TREASURE` | 2 |
| MONDJUNGFERN | im Kampf keine Vorteile durch Waffen | neue Regel, `waffenAnzahl`-Brille | 2 |
| EISRIESE | Feuer-/Flammengegenstände machen doppelten Schaden | `FIRE_ITEMS`, Bonusverdopplung | 2 |
| FUNGUS | als Gigantisch +25 statt +10 | Verstärker-Sonderfall | 2 |
| ROTZ-ELEMENTAR | zusammen mit LAUFENDE NASE / DIE SCHATTENNASE: jeder +10 | Bedingung „anderes Monster im Kampf" | 2 |
| DIE SCHATTENNASE | keine Flucht möglich, nicht bestechbar | `FLEE_IMPOSSIBLE`, keine `COMBAT_START_OPTIONS` | 2 |
| PIÑATA | bei Sieg zieht **jede:r am Tisch** einen offenen Schatz | Sieg-Hook für alle | 2 |
| RIESENSTINKTIER | niemand darf helfen, hintergehen oder Karten für/gegen dich spielen | zugübergreifende Sperre | 3 |
| LUSTMONSTER | nur mit Hilfe des anderen Geschlechts besiegbar, sonst Flucht | Eingriff in den Hilfe-Ablauf | 3 |
| EISKALTES HÄNDCHEN | statt zu kämpfen einen Wunschring geben; die Karte wird ein +3-Gegenstand | Monsterkarte wird Ausrüstung | 3 |

### 4.2 Schlimme Dinge

18 laufen bereits. Zwei davon decken ihren Text nur teilweise ab und bleiben
bewusst so — beide bekommen einen `ponytail:`-Kommentar:

- **FUNGUS**: Elfen verlieren zwei Stufen, alle anderen eine (umgesetzt); die
  Verdopplung bei Gigantischem Fungus fehlt.
- **GRASGNOLL**: drei Stufen Verlust (umgesetzt); „eine Stufe zurück je sofort
  abgelegtem Trank" fehlt.

Die neun fehlenden:

| Monster | Schlimme Dinge | Mechanismus | Welle |
|---|---|---|---|
| GEWALTIGER BAZILLUS | zwei Handkarten eigener Wahl ablegen | `queuedDiscardOwn` count 2 | 1 |
| MONDJUNGFERN | Hand aufdecken, jede:r andere nimmt eine Karte | `queuedTakeFromHand` mode `allOthers` | 1 |
| KATZENMÄDCHEN | würfeln, so viele Handkarten ablegen | neues Primitiv `diceDiscardHand` | 2 |
| PTERODAKTYL | ganze Hand **oder** alle kleinen Gegenstände — du wählst | `choice` aus zwei vorhandenen Primitiven | 2 |
| PIÑATA | die Person nach dem Opfer wählt einen Gegenstand des Opfers und legt ihn ab | Variante von `queuedTakeItem` (ablegen statt nehmen, nur die nächste Person) | 2 |
| MONSTER, DAS DER SL … | Halblinge -1, Elfen -2, Männer zusätzlich -1 und 1 Karte, alle übrigen 2 Karten | eigener Override, `combo` | 2 |
| LUSTMONSTER | eine Stufe; im nächsten Kampf sind Hand-Gegenstände nutzlos | `levelDelta` + `LINGERING_CURSES` | 3 |
| RIESENSTINKTIER | niemand hilft, bis alle Kleidung und Rüstung abgelegt ist; Goldwert halbiert | zugübergreifender Zustand | 3 |
| WEIHNACHTSMANN | kein Schatz, bis du ein Monster allein tötest | zugübergreifender Zustand | 3 |

## 5. Neue Bausteine

Bewusst wenige. Alles andere sind Tabellenzeilen.

1. **`istMensch(player)`** — keine Rassenkarte, durch die `monsterSeesRace`-Brille.
2. **`wennErfuellt(player, room)`** — Signatur additiv erweitert.
3. **Primitiv `diceDiscardHand`** — würfeln, so viele Handkarten selbst
   aussuchen und ablegen. Baut auf `queuedDiscardOwn` auf, nur mit gewürfelter
   Anzahl.
4. **Primitiv `queuedDiscardItemOfVictim`** — eine andere Person wählt einen
   Gegenstand des Opfers, der abgelegt wird (PIÑATA). Spiegelbild zu
   `queuedTakeItem`, das ihn nimmt.
5. **Waffen-Ausblendung im Kampf** (MONDJUNGFERN) — eine Monsterregel, die
   Boni getragener Hand-Gegenstände aus der Kampfrechnung nimmt. Kleiner
   Bruder von `MONSTER_IGNORES_BONUSES`, das heute alle Boni streicht.
6. **Sieg-Hook für den Tisch** (PIÑATA) — beim Sieg zieht jede:r einen offenen
   Schatz. `resolveCombatWin` verteilt heute nur an Kämpfende und Helfer:in.

Welle 3 bringt zusätzlich einen zugübergreifenden Zustand am Spieler
(RIESENSTINKTIER, WEIHNACHTSMANN) — das ist die einzige Stelle, an der dieses
Vorhaben die Engine wirklich erweitert, und deshalb bewusst zuletzt.

## 6. Reihenfolge

- **Welle 1 — Tabellenzeilen.** Alle Boni, Weglauf-Modifikatoren,
  Stufengrenzen und die zwei einfachen Schlimmen Dinge. Kein neuer
  Mechanismus, nur Einträge plus Tests.
- **Welle 2 — vorhandene Bausteine, neu kombiniert.** Die sechs neuen
  Bausteine aus Abschnitt 5 und die darauf aufbauenden Karten.
- **Welle 3 — zugübergreifende Zustände.** RIESENSTINKTIER, WEIHNACHTSMANN,
  LUSTMONSTER, EISKALTES HÄNDCHEN. Vor dem Start dieser Welle wird noch einmal
  Rücksprache gehalten: sie ist der einzige Teil, der neue Zustandshaltung in
  die Engine bringt, und sie ist verzichtbar, solange die vier Karten mit
  einem `ponytail:`-Kommentar als bewusst manuell markiert bleiben.

## 7. Tests

Eine neue Datei `tests/card-unnatural-monsters.test.js` nach dem Muster von
`tests/card-clerical-monsters.test.js`:

- Je Bonusregel eine Differenzmessung über `combatTotals` — mit und ohne die
  genannte Rasse/Klasse/Bedingung, damit der Test auch dann rot wird, wenn das
  Monster aus anderen Gründen stärker ist.
- Weglauf-Modifikatoren über `fleeModifierParts`, ebenfalls als Differenz.
- `MONSTER_REFUSES` über `monsterRefusesTarget`.
- Jedes neue Schlimme Ding über `resolveConsequenceSpec` plus Anwendung, mit
  Prüfung, dass danach kein Dialog hängen bleibt.
- Der Wochentags-Bonus wird mit gestelltem `Date` geprüft, nicht mit dem
  echten Datum.

Die bestehende Invariante in `tests/card-abilities.test.js` (jeder Name in
jeder Tabelle muss eine echte Karte sein) deckt die neuen Einträge automatisch
mit ab.

## 8. Verifikation

- `npm test` grün.
- `node tools/coverage-scan.js unnaturalaxe` meldet im Abschnitt MONSTER nach
  Welle 2 nur noch die bewusst zurückgestellten Karten.
- Für jede neue Regel eine Gegenprobe: Eintrag entfernen, Test wird rot.
