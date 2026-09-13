# Clerical Errors: Kartenkräfte Implementation Plan

> **For agentic workers:** Tasks nacheinander, jede mit rot→grün-Test (`npm test`).
> Kartentabellen bleiben kuratiert und per exaktem Kartennamen indiziert - das
> Muster des Basis-Set-Plans (`2026-09-12-basis-set-kartenkraefte.md`).

**Goal:** Die 102 Karten des Sets *Clerical Errors* spielbar machen. Die
Infrastruktur steht bereits (Aktions-Warteschlange, Fluch-Tracker,
Kampfreaktionen, Große Gegenstände, Klassenkräfte) - der größte Teil sind
Tabellenzeilen, nicht neue Mechanik.

**Audit-Stand 2026-09-13** (`node tools/coverage-scan.js clericalerrors`):
von 102 Karten laufen rund 60 bereits über bestehende Tabellen und Erkenner,
40 nicht.

## Audit: was heute NICHT funktioniert

### A. Harte Blocker - Karten sind gar nicht spielbar

| Karte | Problem |
|---|---|
| `ORK` (Rasse) | steht in den Rohdaten als `door_other`. `handlePlayRaceOrClass` kennt nur `category==='race'/'class'` plus `POWER_GROUP_NAMES` → fällt in `else return;`. Die Karte liegt tot auf der Hand. |
| `GNOM` (Rasse) | dito |
| `BARDE` (Klasse) | dito |

Folgefehler: sechs Monsterkarten nennen ausdrücklich Barden oder Orks
(`TEQUILA-LIEDCHEN`, `DOPPELGANGSTER`, `DRECKIGE GÄNSE`, `FÜRST YAHOO`,
`Harter Typ`, `REDNECK-BAUM`) - deren Boni können heute nie greifen.

### B. Monster-Kampfkräfte (Vordertext) ohne Umsetzung

`MONSTER_TRAIT_BONUS` fehlt: `TEQUILA-LIEDCHEN` (+5 Barden), `DOPPELGANGSTER`
(+3 Barden), `DRECKIGE GÄNSE` (**-3** Barden), `GIFTEFEU KUDZU-FLIEGENFALLE`
(**-4** Elfen), `Harter Typ` (+5 Orks), `REDNECK-BAUM` (+5 Orks, +5 Krieger),
`DIE TROLLE VOM TOTEN MEER` (+5 Elfen), `MEDUSA` (+4 Elfen), `FEDERFEIND`
(+5 Priester, +3 Zauberer), `SIEBENJÄHRIGER LICH` (+5 Krieger), `TANTE PALADIN`
(+5 Priester), `KALI` (+5 Priester), `RÜSSELKÄFER` (+3 gegen Klassenlose),
`GOTHYANKI` (+5 gegen Super-Munchkin *oder* Halb-Blut, +10 gegen beide).

Weitere Dauerwirkungen ohne Tabellenzeile:

| Karte | fehlende Regel |
|---|---|
| `GUMMI-GOLEM` | "nur auf deiner Stufe kämpfen, ohne weitere Boni" → `MONSTER_IGNORES_BONUSES` |
| `SIEBENJÄHRIGER LICH` | "Greift niemanden mit Stufe 2 oder niedriger an" → `MONSTER_REFUSES` |
| `DIE TROLLE VOM TOTEN MEER` | "Jeder erhält +1 auf Weglaufen" → `FLEE_MONSTER_MOD` |
| `GOLDFISCH` | "du fliehst automatisch" → `FLEE_AUTOMATIC` |
| `BOBBELKOPF` | Elfen dürfen die Karte einfach abwerfen → `MONSTER_PASS_OPTION` |
| `PACKRATTE` | ohne Gegenstände im Spiel: 2 offene Schätze statt Kampf → `COMBAT_START_OPTIONS` |
| `SIEBENJÄHRIGER LICH` | Lich ist untot → `UNDEAD_MONSTERS` (Priester "Vertreiben") |
| `RAPIER-TROTTEL` | Monsterverstärker zählen doppelt |
| `DER GANZ NORMALE HASE` | Würfel nach Helferwahl, bei 6 Stufe 15 |
| `DRYADE` | Zauberer verliert beim Kampfbeginn die Klasse |
| `KALI` | +5 zusätzlich, außer mit 2 eigenen Waffen |
| `CHAUVINISTENSCHWEIN`, `TANTE PALADIN`, `STRICHMÄNNCHEN`, `FREUD'SCHEN SLIPPER` | brauchen ein Geschlechtsmerkmal - das gibt es in `data/cards.json` nicht |

### C. Schlimme Dinge ohne Automatik (9 Monster)

`TEQUILA-LIEDCHEN` (2 Handkarten), `RÜSSELKÄFER` (1 Handkarte),
`DOPPELGANGSTER` (2 kleine Gegenstände), `KAMIKAZE-KOBOLDE` (2 eigene + je 1
bei allen anderen), `GOTHYANKI` (Stufen an alle Niedrigeren),
`BOBBELKOPF` (jeder Ork zieht eine Handkarte), `GUMMI-GOLEM` (Dauerzwang
"Hilfe anbieten"), `STRICHMÄNNCHEN` + `CHAUVINISTENSCHWEIN` (Geschlecht).

### D. Türkarten ohne Automatik

`ZWERGENBIER` (-4/+4 nächster Kampf → `LINGERING_CURSES`),
`TYPOGRAFISCHER FEHLER` (Monster zählt als Stufe 1),
`UNFASSBAR REICH` (Schatz-Umtausch),
`MONSTER SIND BESCHÄFTIGT` (Schatz gegen Stufenkarten tauschen).
Bereits bewusst manuell: `KLEINER FEHLER`, `HUNGRIGER RUCKSACK`,
`TEMPORÄRE ANMNESIE`, `TOURISTENFALLE`, `DU STOLPERST ÜBER DEINE EIGENE TRUHE`.

### E. Schatzkarten ohne Automatik

**Billig (bestehende Aktionsarten reichen):**

| Karte | Weg |
|---|---|
| `MONSTERFUTTER` | "+5 für beide Seiten", aber der Text sagt nie "im Kampf" → `COMBAT_PLAYABLE_RE` greift nicht |
| `SCHARFE PFEFFERSOSSE` | "gewährt beiden Seiten +3" - Zahl steht hinter der Seite → `COMBAT_POTION_OVERRIDES` |
| `DEUS EX MASCHINENGEWEHR` | `endCombatNoLevel` ohne Schatz, ohne Plündern |
| `TRANK DER APATHIE` | `removeHelper` (existiert für `CYTILLESH-TRANK`) |
| `EINHEITSGRÖSSE` | `chooseDiscardedCard`, gefiltert auf tragbare Gegenstände |
| `GHOULPEITSCHE` | "+3 gegen Untote" → `ITEM_CONDITIONAL_BONUS` + `UNDEAD_MONSTERS` |
| `AM FUSS BEFESTIGTER STREITKOLBEN` | bonus 4, aber `slotLabel` null → nicht anlegbar; dazu -2 Weglaufen |
| `DER ANDERE RING` | Flucht klappt, "verlierst eine Stufe" und Wunschring-Alternative fehlen |

**Neue Mechanik nötig:**

| Karte | fehlt |
|---|---|
| `VERGIFTET`, `GESEGNET` (+2 an einen Gegenstand), `NÜTZLICHE GRIFFE` (Großer Gegenstand zählt als klein) | allgemeine Gegenstands-Anhänge; `attachments` ist heute nur ein einzelnes `cheatedItemId` |
| `ZWEIHÄNDIGES SCHWERT` | gibt eine zusätzliche Hand |
| `GNOMEX-ANZUG`, `SCHRECKLICHE SOCKEN` | zweite Karte auf demselben Platz (Rüstung über Rüstung, Socken unter Schuhwerk) |
| `STICH-O-MAT` | +2 Rücken für Nicht-Diebe / +1 für Diebe |
| `HALBFINAL-SCHLAG` | 3-facher Bonus eines gewählten Gegenstands |
| `KATZENINTERVENTION` | Würfel-Reaktion, die Wurf *und* bereits gespielte Karten verwirft |
| `DAS MANCHMAL VERLÄSSLICHE AMULETT`, `PRÄCHTIGER HUT` | Reaktionsfenster auf einen eintreffenden Fluch |
| `HEIMSE DIE LORBEEREN EIN` | Reaktionsfenster auf fremden Stufenaufstieg |
| `NIMM MICH! NIMM MICH!` | Hilfe erzwingen |
| `EINSTWEILIGE VERFÜGUNG` | Kartensperre gegen eine Person für den Rest des Zugs |
| `DAS DUNGEON-CASINO` | Würfeltabelle mit Einsatz |
| `ZAUBERCOUCH`, `FALSCHE OHREN` | Rasse/Klasse leihweise zählen lassen |
| `SPASSBREMSE` | Gnom-Sonderfall (nach Task 1 ableitbar) |
| `ENTE DER VIELEN SACHEN` | bleibt bewusst manuell (feste Mehrspieler-Kette) |

## Tasks

- [x] **Task 1 - Neue Rasse/Klasse spielbar:** `ORK`, `GNOM`, `BARDE` über eine
      Tabelle `TRAIT_DOOR_CARDS` in `src/cards/passives.js` als Rasse bzw.
      Klasse zulassen; Liste über `publicState` an den Client (kein zweiter
      Namensspiegel). Billige Kräfte: Ork "Sieg allein mit >10 → +1 Stufe",
      Gnom "+1 je nicht-einmaliger Gegenstand mit G/N", Gnom "gilt Monstern als
      Halbling", Gnom "Monster mit *Nase* im Namen greifen nicht an",
      Barde "Bardenglück: 1 Extraschatz nach eigenem Sieg". Ork-Fluchwahl und
      Barden-Verzaubern bleiben vorerst manuell (`// ponytail:`).
- [x] **Task 2 - Monsterboni und Dauerwirkungen (B):** alle Tabellenzeilen aus
      Abschnitt B, inklusive negativer Boni (`DRECKIGE GÄNSE`, `GIFTEFEU`) und
      der beiden Sonderformen `RÜSSELKÄFER` (keine Klasse) und `GOTHYANKI`
      (Obergrenzen-Karten).
- [x] **Task 3 - Schlimme Dinge (C):** `RÜSSELKÄFER`, `TEQUILA-LIEDCHEN`,
      `DOPPELGANGSTER`, `KAMIKAZE-KOBOLDE`, `GOTHYANKI`, `BOBBELKOPF`.
- [x] **Task 4 - Kampfkarten und Flüche (D + E billig):** `ZWERGENBIER`,
      `MONSTERFUTTER`, `SCHARFE PFEFFERSOSSE`, `DEUS EX MASCHINENGEWEHR`,
      `TRANK DER APATHIE`, `EINHEITSGRÖSSE`, `GHOULPEITSCHE`,
      `AM FUSS BEFESTIGTER STREITKOLBEN`, `DER ANDERE RING`,
      `TYPOGRAFISCHER FEHLER`.
- [x] **Task 5 - Gegenstands-Anhänge:** `VERGIFTET`, `GESEGNET`,
      `NÜTZLICHE GRIFFE`, `HALBFINAL-SCHLAG`, `ZWEIHÄNDIGES SCHWERT`,
      `STICH-O-MAT`, `GNOMEX-ANZUG`, `SCHRECKLICHE SOCKEN`.
- [x] **Task 6 - Reaktionsfenster:** `KATZENINTERVENTION`,
      `DAS MANCHMAL VERLÄSSLICHE AMULETT`, `PRÄCHTIGER HUT`,
      `HEIMSE DIE LORBEEREN EIN`, `NIMM MICH! NIMM MICH!`.
- [x] **Task 7 - Abnahme:** `node tools/coverage-scan.js clericalerrors` ohne
      neue Lücken außer den bewusst manuellen; README/HANDOVER nachziehen.

## Ergebnis (2026-09-13)

Alle sieben Tasks sind umgesetzt, `npm test` steht bei 24/24 und der
Abdeckungs-Scan meldet für Clerical Errors noch sechs bewusst manuelle Karten
(siehe `HANDOVER.md` §9.3). Das Basis-Set blieb bei 0 Lücken.

**Zur ursprünglich offenen Frage Geschlecht:** in Absprache mit dem Nutzer
eingeführt - `player.gender`, alle starten männlich, niemand wählt etwas aus.
Damit laufen `STRICHMÄNNCHEN`, `CHAUVINISTENSCHWEIN`, `TANTE PALADIN` und die
`FREUD'SCHEN SLIPPER` automatisch. Ebenfalls mit dem Nutzer geklärt: die drei
Großen Gegenstände des Sets (ZAUBERCOUCH, ZWEIHÄNDIGES SCHWERT, GROSSE FIESE
LEIER), die Wirkung der SPASSBREMSE (ein Gnom, der sie anlegt, stirbt) und
dass der SIEBENJÄHRIGE LICH das einzige untote Monster des Sets ist.
