# Clerical Errors: Audit "was funktioniert heute nicht?"

## Context

`HANDOVER.md` §9 erklärt das Set für abgeschlossen: `node tools/coverage-scan.js
clericalerrors` meldet nur noch sechs bewusst manuelle Karten, `npm test` steht
bei 25/25 (heute nachgeprüft, alles grün).

Der Scan prüft aber nur **eine** Frage: hat die Karte serverseitig irgendeinen
Handler? Er prüft nicht, ob der Handler die gedruckte Regel trifft — und vor
allem nicht, ob die Karte im Spiel überhaupt **anklickbar** ist. Genau dort
liegt der größte Teil der Ausfälle: 13 Karten sind serverseitig fertig
implementiert und haben im Client keinen Knopf. Sie liegen tot auf der Hand,
ohne Log-Zeile, ohne Fehler.

Dieser Plan listet die tatsächlichen Ausfälle und schlägt eine Reihenfolge zur
Behebung vor. Geprüft wurde jede der 102 Karten gegen den echten Code, nicht
gegen Kommentare.

> **Stand:** geprüft auf `d52bb16` (`origin/main` eingemergt, Fast-Forward).
> Die beiden neuen Commits (Bot-Scheduler-Fix beim ÜBERFALLTRANK,
> Auferstehung-Knöpfe in eigene Leiste) fassen weder Kartentabellen noch die
> Client-Spiegellisten an; alle Befunde wurden danach erneut maschinell
> nachgeprüft und gelten unverändert. `npm test`: 25/25.

---

## A. Serverseitig fertig, im Client nicht spielbar (13 Karten)

Das ist die Hauptursache und eine einzige Klasse von Fehler: `public/client.js`
pflegt **von Hand kopierte Namenslisten** der Server-Tabellen. Die sind
auseinandergedriftet. `HANDOVER.md` §8.5 nennt das schon als "dauerhafte
Driftquelle" — inzwischen ist es keine Quelle mehr, sondern ein Leck.

**`TREASURE_POWER_NAMES` (`public/client.js:1589`)** — fünf Karten aus
`TREASURE_POWER_OVERRIDES` fehlen, keine matcht die Regex-Reserve
`INSTANT_LEVEL_UP_RE`, also erscheint nie ein "✨ Sonderkraft nutzen":

- `HEIMSE DIE LORBEEREN EIN`
- `EINHEITSGRÖSSE`
- `DAS DUNGEON-CASINO`
- `EINSTWEILIGE VERFÜGUNG`
- `DER ANDERE RING` (nur die Wunschring-Hälfte; die Flucht-Hälfte läuft über
  `GUARANTEED_FLEE_NAMES` und funktioniert)

**`COMBAT_POTION_NAMES` (`public/client.js:1611`)** — **alle sechs** Karten aus
`COMBAT_POTION_OVERRIDES` dieses Sets fehlen und fallen auch durch die
Client-Regex:

- `MONSTERFUTTER`, `SCHARFE PFEFFERSOSSE`, `DEUS EX MASCHINENGEWEHR`,
  `TRANK DER APATHIE`, `NIMM MICH! NIMM MICH!`, `HALBFINAL-SCHLAG`

**Hart verdrahteter Knopf (`public/client.js:1528`)** — das Würfel-Reaktionsfenster
bietet nur `c.name === 'GEZINKTER WÜRFEL'` an:

- `KATZENINTERVENTION` — serverseitig vollständig (`ROLL_REROLL_CARDS`,
  `server.js:2534`), im Spiel nie auslösbar.

**`myTurn`-Sperre (`public/client.js:1323`, genutzt `1392`)** — `myTurn` ist
false, sobald ein Kampf läuft oder eine andere Person am Zug ist. Der Server
prüft in `handleUseCardPower` (`server.js:1999`) **keinen** Zug:

- `EINHEITSGRÖSSE` ist doppelt blockiert: der Server *verlangt* einen Kampf
  (`treasures.js:90`), der Client zeigt den Knopf nur *ohne* Kampf.
- `WUNSCHRING` und `EINSTWEILIGE VERFÜGUNG` sind laut Karte "jederzeit spielbar",
  gehen aber nur im eigenen Zug.
- `HEIMSE DIE LORBEEREN EIN` reagiert auf einen **fremden** Sieg — der findet
  per Definition im fremden Zug statt.

**Kein UI-Pfad für Nicht-Diebe:**

- `STICH-O-MAT` — der Server erlaubt Nicht-Dieben den Rückenfall
  (`BACKSTAB_ITEMS`, `server.js:2720`), aber `thiefPowerInfo` gibt für alle ohne
  DIEB-Klasse `null` zurück (`server.js:2801`), und der Client hängt allein an
  `myInfo.thiefPower`. Die Dieb-Hälfte (+1) funktioniert.

Mitbetroffen außerhalb des Sets, dieselbe Ursache: `VERSTÜMMLE DIE LEICHEN`
(Sonderkraft) und `DOPPELGÄNGER` (Kampfkarte).

---

## B. Falsch oder faktisch nie auslösbar (3)

| Karte | Befund |
|---|---|
| `HEIMSE DIE LORBEEREN EIN` | `treasures.js:65` verlangt `room.lastCombatWinnerId !== player.id`, aber das Feld wird bei **jedem** Zugwechsel geleert (`server.js:636`, `657`). Der fremde Sieg liegt immer im fremden Zug → beim eigenen Zug ist das Feld schon `null`. Die Karte wäre selbst mit Knopf wirkungslos. |
| `KAMIKAZE-KOBOLDE` | "+3 gegen Zauberer" fehlt komplett in `MONSTER_TRAIT_BONUS` (`passives.js:221-281`). Das Monster hat nur seine Schlimmen Dinge. Im Audit der letzten Runde (Abschnitt B des alten Plans) war die Zeile schlicht nicht aufgelistet. |
| `SCHRECKLICHE SOCKEN` | `passives.js:396` prüft `m.name === 'SCHATTEN'` — **diese Karte gibt es nicht**. Gemeint ist `DIE SCHATTENNASE` (unnaturalaxe). Die halbe +5-Klausel feuert nie. (Einziger echter toter Tabelleneintrag; alle anderen Schlüssel matchen `data/cards.json` exakt — das `<BR>` in zwei Basis-Kartennamen wird in `server.js:44` beim Laden begradigt.) |

---

## C. Halb umgesetzt — Klausel fehlt (18)

Die Karte ist spielbar und tut etwas, aber nicht alles, was draufsteht.

**Rassen/Klassen:**

| Karte | Was fehlt |
|---|---|
| `GNOM` | "Monster aus der Hand als einmalige Illusion ausspielen, Stufe addieren" — kein Code, kein `ponytail:`-Vermerk. Die separate Karte `ILLUSION` ist etwas anderes. |
| `BARDE` | "Verzaubern" fehlt ganz (`handleRequestHelp` kennt nur KNIESCHÜTZER). Bardenglück gibt den Extraschatz (`server.js:2612`), das Pflicht-Abwerfen ist nur eine Log-Zeile (`server.js:3701`). |
| `ORK` | "Fluch ignorieren gegen 1 Stufe" fehlt ganz. Die Extrastufe bei >10 Punkten funktioniert. |
| `ZAUBERER` | Verzauberung nur bei **genau einem** Monster (`server.js:2663`); "die anderen normal bekämpfen" fehlt. Flugzauber feuert vor statt nach dem Wurf (bewusst, `passives.js:374`). |
| `PRIESTER` | Auferstehung ist kein Ersatz für einen offenen Zug, sondern ein freier "oberste Ablagekarte gegen 1 Handkarte"-Knopf (`server.js:2822`) — nimmt nur die oberste, keine Auswahl, kein Mehrfachzug. |
| `SUPER MUNCHKIN` / `HALB-BLUT` | "ohne Nachteile" unterdrückt nur `MONSTER_TRAIT_BONUS` (`traitImmun`, `server.js:2392`), nicht sonstige Klassennachteile. |

**Monster:**

| Karte | Was fehlt |
|---|---|
| `BOBBELKOPF` | "oder helfen nicht" — Elfen können die Hilfe nicht gezielt verweigern. Abwerfen statt kämpfen funktioniert. |
| `DER GANZ NORMALE HASE` | "Helfer kann nicht mehr entkommen" fehlt; der Wurf hängt an `handleEvaluateCombat` (`server.js:3619`), wer vorher flieht, würfelt nie. |
| `GOTHYANKI` | `monsterTraitBonusSum` testet jede Regel mit `parts.some` (`server.js:2425`) — Super-Munchkin bei der einen Person **plus** Halb-Blut bei der Helfer:in ergibt schon +10. Gemeint ist eine Person mit beidem. |
| `CHAUVINISTENSCHWEIN` | Extraschatz je helfender Frau (kein Schatz-pro-Person-Weg). |
| `FEDERFEIND` | Huhn-Klausel ("nimmt das Huhn, verschwindet, 2 Schätze") hat keinen Code. |
| `KALI` | "2 eigene Waffen" ist als "2 belegte Handplätze" genähert — ein Schild zählt mit. |
| `GOLDFISCH` | "greift nicht an" startet trotzdem einen Kampf; man muss Weglaufen klicken (das dann garantiert klappt). |

**Schatz/Gegenstände:**

| Karte | Was fehlt |
|---|---|
| `VERGIFTET` | `RATTE AM SPIESS` hat `bonus:1`, mit +2 also **+3** statt der gedruckten +4. |
| `LECKERER KUCHEN` | "+4 wenn von einem Ork geworfen" und "Halbling isst ihn und steigt auf" fehlen — läuft nur über den generischen +2-Parser. |
| `ZWERGENWURF` | "braucht einen Zwerg außerhalb des Kampfes, nicht dich selbst" wird nirgends geprüft. |
| `ÖL DES KOCHENS` | "zählt als Flammenangriff" wirkungslos (`FIRE_ITEMS` gilt nur für angelegte Gegenstände). |
| `SEHR DEPRESSIV` | Unverträglichkeit mit `WUTEND` (Basis-Set, existiert) wird nicht durchgesetzt. |
| `TRANK DER APATHIE` | Helfer:in bekommt gespielte Karten nicht zurück, keine Freiwilligen-Nachfrage. |
| `NIMM MICH! NIMM MICH!` | Einmalkarten der vorherigen Freiwilligen kommen nicht zurück. |
| `SCHUMMELN!` | Hebt nur Groß-/Rassenbeschränkung auf; Platzbelegung und Handzahl bleiben hart (`server.js:4110`). |
| `ZAUBERCOUCH` | Keine Ja/Nein-Frage zu Kampfbeginn, also gilt −1 Weglaufen dauerhaft. |
| `SCHRECKLICHE SOCKEN` | "kein anderer nimmt deine Hilfe an" fehlt. |
| `MONSTER SIND BESCHÄFTIGT` | Schatz-gegen-Stufenkarten-Handel fehlt. |
| `EINSTWEILIGE VERFÜGUNG` | Zurücknehmen bereits gespielter Karten fehlt (Sperre selbst läuft). |
| `WUNSCHRING` / `DER ANDERE RING` | Beenden nur Flüche aus `LINGERING_CURSES` (6 Stück); die meisten Flüche lösen sich sofort auf und sind nicht "beendbar". |
| `HALBFINAL-SCHLAG` | Würfel läuft über `rollDie()` statt `rollWithWindow` → Gezinkter Würfel/Katze greifen nicht. |
| `TYPOGRAFISCHER FEHLER` | Wählt automatisch das stärkste Monster, keine Auswahl. |

---

## D. Bewusst manuell — unverändert (7)

`GUMMI-GOLEM` (Schlimme Dinge), `TEMPORÄRE ANMNESIE`, `KLEINER FEHLER`,
`HUNGRIGER RUCKSACK`, `TOURISTENFALLE`, `ENTE DER VIELEN SACHEN`,
`EXPLODIERENDE KNIESCHÜTZER` (nur die Knie-Klausel; die −1 Stufe läuft).

Anmerkung zu `EXPLODIERENDE KNIESCHÜTZER`: der Kommentar in
`consequences.js:189` sagt "dafür gibt es kein Datenfeld", aber es gibt genau
zwei Knie-Gegenstände im ganzen Spiel (`KNIESCHÜTZER DER VERLOCKUNG`,
`SPIESSIGE KNIE`). Eine kuratierte Zweier-Menge nach dem Muster von
`FIRE_ITEMS` reicht.

---

## E. Datenlücken (4)

`DU STOLPERST ÜBER DEINE EIGENE TRUHE` hat in `data/cards.json` **leeren
`text` und leeren `badstuff`** — die Karte kann nichts tun, solange der Text
fehlt. Sie wird immerhin als Fluch behandelt (`DOOR_OTHER_AS_CURSE`).

`KETTEN-BIKINI`, `GROSSE, FIESE LEIER`, `SCHLITTENGLOCKE` haben keinen `text`,
aber vollständige Bonus-/Platz-/Golddaten — sie funktionieren als normale
Gegenstände. Verloren ist nur die gedruckte Trägerbeschränkung (Bikini:
Frauen). Gleiches Datenproblem wie `HANDOVER.md` §8.6 fürs Basis-Set.

---

## Vorgeschlagene Reihenfolge

### Task 1 — Die Client-Spiegel abschaffen (behebt A, 13 Karten)

Das ist der größte Gewinn und der kürzeste Diff. Das Muster steht schon im
Repo: `server.js:492-515` schickt `doorCombatCards`, `combatReactionCards`,
`curseCards`, `traitDoorCards`, `attachmentCards`, `specialSlotItems`,
`bigItems` über `publicState` — kein Client-Spiegel nötig, keine Drift möglich.

1. In `publicState` (`server.js:486`) drei Listen ergänzen:
   - `treasurePowerCards`: `Object.keys(TREASURE_POWER_OVERRIDES)` plus
     `DOOR_POWER_CARDS` plus alle Karten, für die `isInstantLevelUpCard(c)`
     gilt.
   - `combatPotionCards`: `ALL_CARDS.filter(isCombatPotionCard).map(c => c.name)`
     (heute 47 Karten über alle Sets).
   - `rollReactionCards`: `[...ROLL_REACTION_CARDS]`.
2. In `public/client.js` ersatzlos löschen: `TREASURE_POWER_NAMES`,
   `INSTANT_LEVEL_UP_RE`, `DOOR_POWER_NAMES`, `COMBAT_POTION_NAMES`,
   `COMBAT_PLAYABLE_RE`, `combatPotionAmountFound`. `hasTreasurePower`,
   `hasDoorPower` und `isCombatPotion` fragen nur noch die `state`-Listen ab.
3. Den hart verdrahteten `GEZINKTER WÜRFEL`-Knopf (`public/client.js:1528`) auf
   `state.rollReactionCards` umstellen. `KATZENINTERVENTION` braucht keinen
   Wert-Prompt — der Server würfelt neu (`ROLL_REROLL_CARDS`), also Prompt nur
   zeigen, wenn die Karte **nicht** in `rollRerollCards` steht (die Liste
   ebenfalls mitschicken).
4. Die `myTurn`-Sperre am Sonderkraft-Knopf (`public/client.js:1392`) auflösen.
   Der Server ist bereits die Instanz, die entscheidet: `handleUseCardPower`
   prüft keinen Zug, und jeder `TREASURE_POWER_OVERRIDES`-Eintrag gibt `null`
   zurück, wenn seine Bedingung nicht erfüllt ist (dann kommt die Log-Zeile
   "kann die Sonderkraft gerade nicht automatisch nutzen"). Bedingung wird
   `!state.pendingCardAction && !state.pendingConsequence`.
5. `GUARANTEED_FLEE_NAMES` und `TRAIT_CAP_CARD_NAMES` sind aktuell synchron und
   können bleiben — oder im selben Zug mitgehen, wenn der Diff ohnehin dort ist.

Danach `STICH-O-MAT` für Nicht-Diebe: `thiefPowerInfo` (`server.js:2801`) darf
nicht mehr bei `!hasClass(player, 'DIEB')` aussteigen, sondern nur noch, wenn
weder DIEB noch ein `BACKSTAB_ITEMS`-Gegenstand angelegt ist; `stealTargets`
bleibt dabei leer für Nicht-Diebe.

**Test:** eine `tests/card-clerical-ui.test.js`, die zusichert, dass jede Karte
mit serverseitigem Spielweg in genau einer der veröffentlichten Listen steht —
so kann die Drift nicht zurückkommen.

### Task 2 — Die drei echten Fehler (B)

- Eine Zeile `'KAMIKAZE-KOBOLDE': { classes: ['ZAUBERER'], bonus: 3 }` in
  `MONSTER_TRAIT_BONUS` (`src/cards/passives.js:243ff`).
- `'SCHATTEN'` → `'DIE SCHATTENNASE'` in `passives.js:396`.
- `HEIMSE DIE LORBEEREN EIN`: `room.lastCombatWinnerId` beim Zugwechsel nicht
  mehr leeren (`server.js:636`, `657`), sondern erst beim **nächsten** Sieg
  überschreiben. Braucht Task 1, um überhaupt anklickbar zu sein.

### Task 3 — Billige Klauseln aus C

Karten, die ohne neue Mechanik auskommen, je eine Tabellenzeile oder ein
`COMBAT_POTION_OVERRIDES`-Eintrag:

- `VERGIFTET` + `RATTE AM SPIESS` → Sonderfall auf +4.
- `LECKERER KUCHEN` → `COMBAT_POTION_OVERRIDES` mit Ork-/Halbling-Zweigen.
- `ZWERGENWURF` → Bedingung "ein Zwerg außerhalb des Kampfes, nicht man selbst".
- `SEHR DEPRESSIV` ↔ `WUTEND` → gegenseitige Sperre über `combat.enhancerIds`.
- `GOTHYANKI` → die beiden Regeln auf **dieselbe** Person beziehen, statt jede
  Regel einzeln mit `parts.some` zu testen.
- `EXPLODIERENDE KNIESCHÜTZER` → kuratierte Knie-Menge nach `FIRE_ITEMS`-Muster.
- `HALBFINAL-SCHLAG` → `rollWithWindow` statt `rollDie`.
- `SCHRECKLICHE SOCKEN` → Hilfe-Annahme in `handleRespondHelp` blocken.
- `BARDE` Bardenglück → Abwurf als echte `pendingConsequence`-Wahl statt Log.

### Task 4 — Größere Klauseln (nur nach Rückfrage)

`GNOM`-Illusion, `BARDE`-Verzaubern, `ORK`-Fluchwahl, `ZAUBERER`-Verzauberung
bei mehreren Monstern, `PRIESTER`-Auferstehung als echtes Zugsurrogat,
`ZAUBERCOUCH`-Frage zu Kampfbeginn, `EINSTWEILIGE VERFÜGUNG`-Rücknahme.
Jede braucht neue Mechanik oder ein neues Fenster.

### Task 5 — Daten (optional)

`DU STOLPERST ÜBER DEINE EIGENE TRUHE` Kartentext in `data/cards.json`
nachtragen, sonst bleibt die Karte dauerhaft wirkungslos. Trägerbeschränkungen
(`KETTEN-BIKINI` u.a.) sind dasselbe offene Datenproblem wie im Basis-Set und
gehören in eine eigene Runde.

---

## Verifikation

- `npm test` — aktuell 25/25 grün, muss grün bleiben.
- `node tools/coverage-scan.js clericalerrors` — darf keine neue Zeile bekommen
  (heute sechs, alle bewusst manuell).
- `node tools/coverage-scan.js base` — muss bei 0 Lücken bleiben; Task 1 fasst
  Code an, der alle Sets betrifft.
- `node tools/smoke-run.js` — ohne Hänger durchlaufen.
- Neuer Test aus Task 1: jede serverseitig spielbare Karte steht in genau einer
  veröffentlichten Client-Liste.
- Von Hand im Browser (`tools/browser-run.js`): mit einer Hand aus
  `MONSTERFUTTER`, `DAS DUNGEON-CASINO`, `KATZENINTERVENTION` und
  `EINSTWEILIGE VERFÜGUNG` prüfen, dass jetzt tatsächlich ein Knopf erscheint
  und die Wirkung im Log landet — das ist der Punkt, den `npm test` in der
  letzten Runde nicht erwischt hat.
