# Welle 3 — Stand am Ende der Sitzung vom 2026-09-17

Zwischenstand für die nächste Session. Der Plan
`2026-09-17-unnatural-axe-welle3.md` wird mit **subagent-driven-development**
abgearbeitet (ein frischer Subagent je Task, danach ein Task-Review, am Ende
ein Gesamtreview über den ganzen Branch).

Diese Datei liegt bewusst **im Repo**: das Arbeitsverzeichnis der
SDD-Sitzung (`.superpowers/sdd/2026-09-17-unnatural-axe-welle3/`) ist
gitignoriert und kann jederzeit verschwinden. Alles, was zum Weiterarbeiten
nötig ist, steht deshalb hier.

## Wo es weitergeht

| Task | Stand |
|---|---|
| 1 — Primitiv `lingeringCurse` | fertig, Review sauber |
| 2 — RIESENSTINKTIER, Kampfsperre | fertig, Review sauber |
| 3 — RIESENSTINKTIER, Schlimme Dinge | fertig, Review sauber nach 2 Fix-Runden |
| 4 — LUSTMONSTER, Hilfe + Flucht | fertig, Review sauber nach 1 Fix-Runde |
| 5 — LUSTMONSTER, Schlimme Dinge | fertig, Review sauber |
| 6 — WEIHNACHTSMANN | **umgesetzt, Fix-Runde eingespielt, Review steht noch aus** |
| 7 — EISKALTES HÄNDCHEN | offen |
| 8 — Konsequenz-Wächter neu begründen | offen |
| 9 — Verifikation + HANDOVER.md | offen |

**Der nächste Schritt** ist das Task-Review für Task 6 über den Bereich
`9b71228..c9307ab` (zwei Commits: Grundumsetzung `fa4d828` und die
Nachzieh-Runde `c9307ab`). Erst danach Task 7.

Alle 27 Testsuiten sind bei jedem Commit grün, auch beim aktuellen HEAD.

## Was Task 8 wissen muss

Der Wächter in `tests/auto-consequence.test.js` wurde in dieser Runde
dreimal als **Zwischenschritt** abgesenkt (`>= 3` → `>= 2` → `>= 1` → `>= 0`),
weil er genau die drei Karten zählte, die hier Overrides bekommen haben.
Er steht jetzt auf `>= 0` und ist damit zahnlos — im Code als solches
kommentiert. Task 8 ersetzt ihn vollständig durch die direkte Prüfung, dass
`parseAutoConsequence` eine feste Liste von Kartentexten **nicht** auflöst.
Nicht nochmal nachziehen, sondern ersetzen.

## Entscheidungen, die ich in dieser Sitzung getroffen habe

Jede davon ist umkehrbar. Wer anderer Meinung ist, ändert sie — hier steht,
was sie kostet, wenn sie falsch war.

1. **`origin/main` vor dem Start gemergt** (`cf57d8c`). Fünf Commits,
   konfliktfrei, alle Tests grün. Dadurch sind alle Zeilennummern im Plan um
   rund 56 gewandert; sie wurden nachgezogen, und es gilt: **der zitierte
   Ankertext schlägt die Zeilennummer.**

2. **Goldwert-Test korrigiert, bevor er geschrieben wurde.** Die
   Plan-Vorlage nahm 1800 GS; halbiert sind das 900 und damit unter der
   1000er-Schwelle in `handleSellItems` — die Funktion wäre vorzeitig
   zurückgekehrt und hätte gar nichts verkauft, der Test wäre grün gewesen,
   ohne die Halbierung je zu prüfen. Jetzt 5100 GS (voll 5 Stufen, halbiert
   2), beide Seiten über der Schwelle.

3. **Die Halbierungs-Logzeile steht hinter dem 1000er-Gate.** Davor behauptete
   sie bei kleinen Summen einen Verkauf, der gar nicht stattfand. Die
   Halbierung von `total` selbst bleibt vor dem Gate — halbiertes Gold soll
   sehr wohl unter die Schwelle drücken können.

4. **`stinktierStrafeAktiv` wird auch aus `handleUnequipItem` gerufen.**
   Die Spec (§4.2) versprach "eine Prüfstelle statt fünf Aufräumstellen" —
   ein Read-and-Clear räumt aber nur auf, wenn jemand liest. Ohne diesen
   dritten Aufruf bliebe die Strafe bis zur nächsten Hilfe-Anfrage in der
   Anzeige stehen. **Die Spec-Formulierung ist damit überholt.**

5. **`resolveCombat` wurde herausgezogen, nicht nur exportiert.** Mein Plan
   nahm an, die Funktion gäbe es schon; die Logik lag inline in
   `handleEvaluateCombat`. Alle Vorprüfungen sind dort geblieben. Das Review
   hat die Verhaltensgleichheit des normalen Kampfpfads bestätigt.

6. **Die Lustmonster-Sperre schützt auch Gleichstands-Siege.** Der
   KRIEGER-Zweig gewann, bevor die Sperre überhaupt berechnet war, und die
   ALUFOLIE wurde **verbraucht und als Sieg geloggt**, bevor der Sieg doch
   verweigert wurde. Spec §5.2 sagt "unabhängig von der Kampfstärke
   verloren", und ein Gleichstandssieg ist ein Sieg.

7. **Die Störerliste gilt an neun statt fünf Stellen.** Meine Spec §6 nannte
   nur `resolveCombatWin` und `finishTrade`. Der Pfad-Audit fand vier
   weitere Wege, auf denen Schätze in eine Hand wandern (PESTRATTEN, die per
   `wegjagenMitSchatz` weggejagten Monster, das AMAZONE-Geschenk, die
   Bonuszüge von PACKRATTE). Der Kartentext schränkt nicht ein, und
   PESTRATTEN wie AMAZONE kommen häufig vor.

## Zurückgestellte Kleinigkeiten fürs Schlussreview

- Drei Logzeilen aus Task 2 schreiben `ae`/`ue` statt echter Umlaute
  (Konvention: **spielersichtbare** Logzeilen behalten echte Umlaute).
- Zwei verwaiste `//`-Zeilen um `MONSTER_LOCKS_OTHERS` in `passives.js`.
- `card(cardId)` wird in `handlePlayCombatCard` zweimal hintereinander gerufen.
- Die Stinktier-Sperre in `handlePlayCurseFromHand` hat keinen eigenen Test
  (Logik gelesen und für richtig befunden).
- Kein Test deckt "der Lustmonster-Fluch trifft nur die verfluchte Person,
  wenn eine Helfer:in dabei ist" (Logik nachverfolgt, korrekt).
- `NIMM MICH! NIMM MICH!` umgeht die Geschlechtsprüfung in
  `handleRespondHelp`. **Kein Regelbruch** — `passendeHilfe` wird in
  `resolveCombat` frisch berechnet, der Kampf bleibt unbesiegbar; es fehlt
  nur die Ablehnungs-Logzeile.
- RIESENSTINKTIER sitzt im Abschnitt "Schlimme Dinge mit freier Auswahl",
  obwohl die Karte keine Auswahl bietet. Wenn mehr kuratierte
  Unnatural-Axe-Einträge dazukommen, verdienen sie einen eigenen Abschnitt.

## Arbeitsweise, die sich bewährt hat

Zwei Tests in dieser Runde waren **leer** — sie wären auch gegen den
kaputten Code grün gewesen. Beide fielen erst auf, weil jemand den
Vor-Fix-Stand zurückgespielt und den neuen Test dagegen laufen ließ. Seitdem
gilt für jeden neuen Test in diesem Plan: **Rot-Grün vorführen, mit der
echten Fehlermeldung im Bericht.** Ein Test, der immer grün ist, ist
schlimmer als keiner, weil er wie Abdeckung aussieht.
