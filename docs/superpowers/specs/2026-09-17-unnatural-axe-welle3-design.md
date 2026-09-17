# Unnatural Axe, Welle 3: die vier zugübergreifenden Karten

Datum: 2026-09-17. Abschluss der Unnatural-Axe-Monsterrunde. Umfasst genau die
vier Karten, die
`docs/superpowers/specs/2026-09-16-unnatural-axe-monster-design.md` §6 bewusst
zurückgestellt hat: **RIESENSTINKTIER, LUSTMONSTER, WEIHNACHTSMANN,
EISKALTES HÄNDCHEN**.

Der Vorgängerplan ist vollständig umgesetzt
(`docs/superpowers/plans/2026-09-16-unnatural-axe-monster.md`, 16 Tasks); der
Stand steht in HANDOVER.md §11. Diese Runde löst den dortigen Abschnitt 11.3
("Was zurückgestellt ist") auf.

## 1. Ausgangslage

Die vier Karten galten als zurückgestellt, weil sie "zugübergreifenden Zustand"
brauchen, den es angeblich nicht gibt. Die Erkundung zeigt: **es gibt ihn.**
`player.activeCurses` (server.js:2651-2735) hält je Spieler:in Einträge der
Form `{ cardId, name, kind, amount, dauer, hinweis }`, läuft bei
`dauer: 'naechsterKampf'` automatisch in `resolveCombatWin`/`finishFleeSuccess`
ab (`clearNextCombatCurses`), bleibt bei `dauer: 'dauerhaft'` stehen und wird
vom WUNSCHRING über `clearActiveCurse` beendet. Der Client zeigt die Einträge
bereits über `hinweis` an.

Was fehlt, ist nur der **Zugang**: `addActiveCurse` wird heute ausschließlich
aus dem Fluch-Ziehpfad (`handleDrawDoor`) gerufen und liest seine Regeln aus
`LINGERING_CURSES`, einer Tabelle, die nach *Fluchkartennamen* indiziert ist.
Monster-Schlimme-Dinge kommen aber aus `autoApplyLossConsequence` und sprechen
die Action-Spec-Sprache der `CONSEQUENCE_OVERRIDES`.

Ebenso vorhanden und wiederverwendbar:

- **`kartenSperreAktiv`** (server.js:2247, EINSTWEILIGE VERFÜGUNG) — sperrt
  eine Person daran, im Kampf *überhaupt* Karten gegen eine geschützte Person
  zu spielen. Exakt die Bauform, die das RIESENSTINKTIER braucht.
- **`excludeIds` in `combatTotals`** (server.js:3499) — nimmt Hand-Gegenstände
  aus allen drei Item-Summanden heraus, gebaut für MONDJUNGFERN. Exakt das,
  was das LUSTMONSTER für seine Schlimmen Dinge braucht.
- **`SPECIAL_SLOT_ITEMS`** (src/cards/passives.js:571) — Sammelplatz
  "Spezialausrüstung" für Karten, die in den Rohdaten keinen `slotKind` haben,
  aber angelegt gehören (FALSCHE OHREN, ZAUBERCOUCH, AM FUSS BEFESTIGTER
  STREITKOLBEN). Exakt der Platz für das EISKALTE HÄNDCHEN.
- **`istGeschlecht`** (server.js:1203) — inklusive der Geschlechtslosigkeit des
  STRICHMÄNNCHENS, das für jede Regel, die ein Geschlecht *nennt*, als keins
  von beiden gilt.
- **`c.mustFlee`** (server.js:4312) — der Zustand "dieser Kampf ist verloren,
  alle laufen einzeln weg".

Diese Runde baut daher **kein neues Zustandssystem**. Sie öffnet einen
vorhandenen Tracker für eine zweite Quelle und ergänzt drei Einträge, eine
Sperre nach vorhandenem Vorbild und einen Ausrüstungsplatz.

## 2. Abgrenzung

Drin: die vier genannten Karten, vollständig — Kampftext und Schlimme Dinge.

Draußen: alles andere aus Unnatural Axe (Türkarten, Flüche, Schätze). Der
STACHELIGE GENITALSCHONER bleibt unangelegbar, die Teilabdeckung beim
PSYCHO-EICHHÖRNCHEN (HANDOVER §11.2) bleibt damit bestehen. Ebenso bleiben die
beiden anderen dort genannten Teilabdeckungen (FUNGUS-Strafenverdopplung,
GRASGNOLL-Trankrückgabe) unberührt.

## 3. Grundlage: activeCurses für Monster-Schlimme-Dinge öffnen

### 3.1 Der Zugang

Zwei Wege standen zur Wahl:

- **(a) Ein neues Primitiv `lingeringCurse`** in `applyPrimitiveAction`. Die
  Konsequenz-Funktionen sprechen ohnehin schon die Action-Spec-Sprache, ein
  Eintrag sieht dann so aus:

  ```js
  'LUSTMONSTER': () => ({ type: 'combo', actions: [
    { type: 'levelDelta', amount: -1 },
    { type: 'lingeringCurse', kind: 'noHandItemBonus', dauer: 'naechsterKampf',
      hinweis: 'Im nächsten Kampf zählen deine Hand-Gegenstände nicht.' },
  ] })
  ```

- (b) Eine zweite Tabelle `MONSTER_LINGERING_EFFECTS` neben `LINGERING_CURSES`,
  gerufen aus `autoApplyLossConsequence`.

**Gewählt: (a).** Die Einträge bleiben dort, wo alle anderen Schlimmen Dinge
schon stehen (`CONSEQUENCE_OVERRIDES` in src/cards/consequences.js); es
entsteht keine zweite Tabelle und keine zweite Aufrufstelle. Anzeige (`hinweis`),
Ablauf (`dauer`) und WUNSCHRING-Auflösung kommen unverändert von
`addActiveCurse`/`clearActiveCurse`.

Dafür wird `addActiveCurse` so aufgeteilt, dass der Regel-Nachschlag in
`LINGERING_CURSES` vom Eintragen getrennt ist: der Fluchpfad schlägt weiter
nach, das Primitiv reicht die Regel direkt durch. Die
Kleidungs-Sonderbehandlung (`noTwoHandedItems` legt getragene Zweihänder
zurück auf die Hand) bleibt im Eintrage-Teil und gilt damit für beide Quellen.

### 3.2 Die drei neuen `kind`s

| `kind` | Karte | gelesen in | Ende |
|---|---|---|---|
| `noHandItemBonus` | LUSTMONSTER | `combatTotals`, über den vorhandenen `excludeIds`-Pfad | `dauer: 'naechsterKampf'`, automatisch |
| `noHelpHalfGold` | RIESENSTINKTIER | `handleRequestHelp`, `handleSellItems` | `dauer: 'dauerhaft'` plus eigene Löschbedingung (§4.2) |
| `noTreasure` | WEIHNACHTSMANN | Schatzvergabe in `resolveCombatWin` | `dauer: 'dauerhaft'` plus eigene Löschbedingung (§6) |

Der WUNSCHRING beendet alle drei, weil `clearActiveCurse` nicht nach Herkunft
unterscheidet. Das ist ausdrücklich gewollt: die Strafen sind im Spielgefühl
Flüche, und der Kartentext des Rings sagt "Beendet jeden Fluch".

### 3.3 Selbstlöschende Einträge

`noHelpHalfGold` und `noTreasure` enden nicht nach einer festen Dauer, sondern
wenn ein Ereignis eintritt. Sie tragen deshalb `dauer: 'dauerhaft'` (damit
`clearNextCombatCurses` sie in Ruhe lässt) und werden an genau der Stelle
gelöscht, an der ihre Bedingung geprüft wird — jeweils über einen kleinen
Helfer `clearActiveCurseByKind(player, kind)`, damit die Löschung nicht an drei
Stellen als Array-Filter ausgeschrieben steht.

## 4. RIESENSTINKTIER

Text: *"Deine 'Freunde' kommen nicht dichter als 20 Meter, wenn du das
Riesenstinktier bekämpfst. Sie können dir nicht helfen, dich hintergehen, oder
beliebige Karten für oder gegen dich verwenden – außer Wandernde Monster und
Monsterverstärker."*

Schlimme Dinge: *"Besprüht! Niemand wird dir im Kampf helfen, bevor du nicht
alle getragene Kleidung und Rüstung ablegst. Der Goldwert ist halbiert."*

### 4.1 Die Kampfsperre

Umgesetzt als **Weiße Liste**, nicht als Aufzählung gesperrter Pfade: gesperrt
ist alles, erlaubt sind genau die zwei im Text genannten Ausnahmen. Das ist
zugleich die kleinere Fläche und die treuere Lesart.

Neu: `MONSTER_LOCKS_OTHERS = new Set(['RIESENSTINKTIER'])` in
src/cards/passives.js und eine Gate-Funktion in server.js:

```js
// Gesperrt ist, wer NICHT selbst kämpft - der Text richtet sich an "deine
// Freunde", nicht an dich.
function stinktierSperre(room, playerId) {
  if (!room.combat || !combatHasMonster(room, MONSTER_LOCKS_OTHERS)) return false;
  return !combatParticipants(room).some((p) => p.id === playerId);
}
```

**Wer gesperrt ist:** alle außer der kämpfenden Person. Der Kartentext
adressiert ausdrücklich *"deine Freunde"* ("**Sie** können dir nicht helfen,
dich hintergehen, oder …"), nicht die kämpfende Person selbst. Wer gegen das
Stinktier antritt, spielt seine eigenen Waffen und Tränke also weiterhin
normal. Eine Helfer:in kann es nicht geben, weil die Hilfe-Anfrage gesperrt ist
— `combatParticipants` enthält damit faktisch nur die kämpfende Person.

**Vier Aufrufstellen**, alle nach dem Muster von `kartenSperreAktiv`
(loggen, `touchRoom`, `return`):

1. `handleRequestHelp` — keine Hilfe.
2. Der Rückenfall-Pfad (`handleBackstab`, server.js:3195 ff.) — kein
   Hintergehen.
3. `handlePlayCurseFromHand` — kein Fluch gegen die kämpfende Person, solange
   der Kampf läuft.
4. `handlePlayCombatCard` — hier lebt die weiße Liste: durchgelassen wird nur
   `c.name === 'WANDERNDES MONSTER'` und `isMonsterEnhancerCard(c)`. Alles
   andere wird abgewiesen, ausdrücklich einschließlich KUMPEL, ILLUSION,
   HILF MIR und ÜBERFALLTRANK — sie sind Karten, die "für oder gegen dich"
   wirken, und die Karte nennt sie nicht als Ausnahme.

Die Prüfung steht in `handlePlayCombatCard` **vor** der
`COMBAT_REACTION_CARDS`-Verzweigung, sonst greift sie für KUMPEL und
ÜBERFALLTRANK zu spät.

### 4.2 Die Schlimmen Dinge

Ein `activeCurses`-Eintrag `kind: 'noHelpHalfGold'`, `dauer: 'dauerhaft'`, mit
zwei Wirkungen:

- **Keine Hilfe:** `handleRequestHelp` weist die Anfrage ab, solange der
  Eintrag steht — dieselbe Stelle, an der schon `MONSTER_FORBIDS_HELP` und die
  Stinktier-Sperre hängen.
- **Halbierter Goldwert:** in `handleSellItems`. Halbiert wird die
  **Endsumme**, abgerundet (`Math.floor(total / 2)`), also nach dem
  Alchemisten-Mindestwert und nach dem Halbling-Bonus. Begründung: der
  Kartentext nennt eine Eigenschaft der Person ("der Goldwert ist halbiert"),
  keine Eigenschaft einzelner Gegenstände; die Endsumme ist die Zahl, die die
  Karte meint, und sie ist zugleich die Stelle, an der ohnehin schon gerundet
  wird (`Math.floor(total / 1000)`).

**Löschbedingung:** "bevor du nicht alle getragene Kleidung und Rüstung
ablegst" — also sobald kein getragener Gegenstand mit `slotKind` aus
`{head, armor, feet}` mehr anliegt. Hand-Gegenstände (Waffen, Schilde) zählen
nicht als Kleidung. Geprüft in `handleUnequipItem` und überall dort, wo
Ausrüstung verloren geht — praktisch also über eine Prüfung direkt in der
Lesefunktion: der Eintrag wird beim Lesen als erloschen behandelt und dann
entfernt, statt an jeder Ablege-Stelle nachzuhalten.

```js
const KLEIDUNG_SLOTS = ['head', 'armor', 'feet'];

// Der Eintrag loescht sich selbst, sobald nichts Getragenes mehr an Kleidung
// oder Ruestung uebrig ist - geprueft beim Lesen statt an jeder Stelle, an
// der Ausruestung verloren gehen kann (Ablegen, Fluch, Schlimme Dinge,
// Verkaufen). Hand-Gegenstaende zaehlen nicht als Kleidung.
function stinktierStrafeAktiv(player) {
  if (!(player.activeCurses || []).some((f) => f.kind === 'noHelpHalfGold')) return false;
  if (KLEIDUNG_SLOTS.some((s) => player.equipped[s])) return true;
  clearActiveCurseByKind(player, 'noHelpHalfGold');
  return false;
}
```

Das ist bewusst die faulere Variante: eine Prüfstelle statt fünf
Aufräumstellen, und sie kann nicht vergessen werden, wenn später ein neuer Weg
dazukommt, auf dem Ausrüstung verschwindet.

## 5. LUSTMONSTER

Text: *"Du musst dir von einem Charakter des anderen Geschlechts helfen lassen
… sonst kannst du das Lustmonster nicht besiegen. Findest du keinen passenden
Charakter, musst du leider flüchten."*

Schlimme Dinge: *"Verliere eine Stufe … in deinem nächsten Kampf werden deine
Hand-Gegenstände nutzlos."*

### 5.1 Die Hilfe-Pflicht

Neu: `MONSTER_REQUIRES_OTHER_GENDER = new Set(['LUSTMONSTER'])`.

- **Passende Hilfe:** `istGeschlecht(helfer, g)` für das *andere* `g` als das
  der kämpfenden Person. Ist eine der beiden Personen geschlechtslos
  (STRICHMÄNNCHEN), kann die Bedingung nicht erfüllt werden — der zweite Satz
  der Karte ("erleidet aber keine der Strafen") betrifft Strafen, nicht
  Voraussetzungen, und für jede Regel, die ein Geschlecht *nennt*, gilt das
  Strichmännchen als keins von beiden (server.js:1198-1206).
- **Abweisung:** in `handleRespondHelp`. Eine Zusage einer Person des falschen
  Geschlechts wird abgelehnt und geloggt, statt sie als Helfer:in einzutragen.
  Bewusst dort und nicht in `handleRequestHelp`: das Fragen bleibt erlaubt,
  nur das Zustandekommen der Hilfe nicht — so sieht der Tisch im Verlauf, dass
  es versucht wurde.

### 5.2 Der Flucht-Zwang

In `resolveCombat` (server.js ~4290), **vor** dem Stärkevergleich:

```js
// "sonst kannst du das Lustmonster nicht besiegen": ohne passende Hilfe ist
// der Kampf unabhaengig von der Kampfstaerke verloren.
if (combatHasMonster(room, MONSTER_REQUIRES_OTHER_GENDER) && !passendeHilfe(room)) {
  // -> mustFlee, wie beim verlorenen Stärkevergleich
}
```

Die Flucht selbst läuft danach über den bestehenden Pfad (`c.fleeQueue`,
`c.fleeingId`, `handleAttemptFlee`) — es entsteht kein zweiter Fluchtweg. Der
Zweig wird mit derselben Logzeile und demselben Zustand abgeschlossen wie der
verlorene Stärkevergleich, nur mit eigener Begründung im Text.

Ausdrücklich **nicht** über `FLEE_AUTOMATIC`: das Set macht die Flucht
*gelingen*, hier geht es darum, dass der Kampf nicht *gewonnen* werden kann.

### 5.3 Die Schlimmen Dinge

`CONSEQUENCE_OVERRIDES['LUSTMONSTER']` als `combo` aus `levelDelta -1` und dem
neuen Primitiv `lingeringCurse` mit `kind: 'noHandItemBonus'`,
`dauer: 'naechsterKampf'`.

Gelesen wird der Eintrag in `combatTotals` an der Stelle, an der schon
MONDJUNGFERN die Waffen ausblendet:

```js
const excludeIds = (ignoreWeapons || curseHidesHandItems(p)) ? handItemIds(p) : null;
```

Damit erbt die Regel automatisch die dort schon bedachten Feinheiten
(Kartenanhänge an der Waffe, konditionale und rassenabhängige Item-Boni fallen
mit weg) — genau die Fälle, die der MONDJUNGFERN-Kommentar aufzählt.

Feinheit: `excludeIds` ist heute pro Kampf aus einer Monsterregel abgeleitet,
also für beide Seiten gleich. Der Fluch hängt dagegen an der Person. Der
Ausdruck wird deshalb innerhalb der `sides.reduce`-Schleife je `p` gebildet —
er steht dort ohnehin schon.

## 6. WEIHNACHTSMANN

Der Kampfbonus (-5 gegen Elfen) läuft seit Welle 1. Offen sind nur die
Schlimmen Dinge: *"Du kommst auf die Störerliste. Du erhältst keine
Schatzkarten … auch nicht von anderen Spielern … bis du ein Monster ohne Hilfe
tötest."*

- **Eintrag:** `kind: 'noTreasure'`, `dauer: 'dauerhaft'`.
- **Wirkung:** an den Stellen, an denen Schätze tatsächlich an eine Person
  übergeben werden. Das sind in `resolveCombatWin` die Zuteilungen an
  `actor` und `helper` (einschließlich der Piñata-Karten) sowie die
  Schatz-Zusage an die Helfer:in. Betroffene Karten werden **gar nicht erst
  gezogen**, statt gezogen und weggeworfen zu werden — der Text sagt "du
  erhältst keine", der Stapel soll dadurch nicht schrumpfen.
- **"auch nicht von anderen Spielern":** der Tauschpfad weist eine Annahme
  ab, bei der eine Schatzkarte an die betroffene Person ginge.
- **Löschbedingung:** in `resolveCombatWin`, wenn `!c.helperId` — "ein Monster
  ohne Hilfe getötet". Die Löschung geschieht **vor** der Schatzvergabe
  desselben Kampfes: wer die Strafe mit einem hilfsfreien Sieg abschüttelt,
  bekommt den Schatz dieses Kampfes schon wieder. Das ist die
  spielerfreundliche Lesart von "bis du ein Monster ohne Hilfe tötest" und
  vermeidet die sonst nötige Erklärung, warum der befreiende Sieg als einziger
  leer ausgeht.

## 7. EISKALTES HÄNDCHEN

Text: *"Wenn du Eiskaltes Händchen einen Wunschring gibst, anstatt sie zu
bekämpfen, wird sie deine kleine Freundin. Lege den Ring ab; behalte diese
Karte und zähle die Hand als einen kleinen Gegenstand, der einen Bonus von +3
im Kampf gibt."*

Die Schlimmen Dinge (2 Stufen verlieren) laufen bereits.

- **Das Angebot:** beim Aufdecken in `handleDrawDoor`, bevor der Kampf
  beginnt, und nur wenn die aufdeckende Person einen WUNSCHRING auf der Hand
  oder angelegt hat. Umgesetzt über das vorhandene `openCardChoice` mit zwei
  Optionen ("Ring geben" / "kämpfen"). Ohne Ring passiert nichts Neues: der
  Kampf startet wie heute.
- **Die Verwandlung:** Ring auf den Ablagestapel, Monsterkarte in den
  Spezialplatz. Dafür ein Eintrag
  `'EISKALTES HÄNDCHEN': { slot: 'special', bonus: 3 }` in
  `SPECIAL_SLOT_ITEMS`.
- **Der Bonus:** `c.bonus` ist in den Rohdaten `null` (es ist eine
  Monsterkarte). `equippedBonusSum` bekommt deshalb einen Rückfall auf den
  `bonus` der Spezialplatz-Regel, wenn die Karte selbst keinen nennt. Das ist
  eine Zeile und öffnet den Weg zugleich für jede weitere Karte, die angelegt
  gehört, aber in den Rohdaten keinen Bonus trägt.
- **Kleiner Gegenstand:** die Karte hat keinen `isBig`-Marker und zählt damit
  über `istGrosserGegenstand` ohnehin als klein — es ist nichts zu tun.

## 8. Tests

Erweiterung von `tests/card-unnatural-monsters.test.js`, in der Bauform, die
der letzte Commit dort etabliert hat: **die echten Pfade laufen lassen, nicht
die Tabellen abfragen.** Ein Test, der `MONSTER_LOCKS_OTHERS.has(...)` prüft,
beweist nur, dass ein Eintrag existiert.

Je Karte:

- **RIESENSTINKTIER:** `handleRequestHelp` bleibt wirkungslos; der
  Rückenfall-Pfad ändert `backstabMalus` nicht; `handlePlayCombatCard` mit
  einem Trank einer dritten Person lässt `monsterModifier`/`actorModifier`
  unverändert, mit einem Monsterverstärker dagegen **nicht** (die Gegenprobe,
  die zeigt, dass die weiße Liste wirklich weiß ist); die kämpfende Person
  selbst kann weiter spielen. Für die Schlimmen Dinge: `handleSellItems` mit
  2000 Gold gibt 1 statt 2 Stufen, und nach `handleUnequipItem` der letzten
  Rüstung wieder 2.
- **LUSTMONSTER:** `handleRespondHelp` mit gleichem Geschlecht setzt
  `c.helperId` nicht, mit anderem schon; `resolveCombat` mit erdrückender
  Übermacht und ohne passende Hilfe endet trotzdem in `mustFlee`. Für die
  Schlimmen Dinge eine Differenzmessung über `combatTotals`: dieselbe Person
  mit angelegter Waffe, einmal mit und einmal ohne den Eintrag.
- **WEIHNACHTSMANN:** nach der Konsequenz bringt ein gewonnener Kampf *mit*
  Helfer:in keine Handkarten; ein Sieg *ohne* Helfer:in löscht den Eintrag und
  zahlt aus.
- **EISKALTES HÄNDCHEN:** mit Ring auf der Hand erscheint die Wahl; nach der
  Zusage liegt kein Kampf an, der Ring im Ablagestapel, die Karte im
  Spezialplatz, und `combatTotals` weist in einem *späteren* Kampf +3 mehr aus.

Dazu für jede neue Regel die Gegenprobe aus dem Vorgängerplan: Eintrag
entfernen, Test wird rot. Die bestehende Invariante in
`tests/card-abilities.test.js` (jeder Name in jeder Tabelle muss eine echte
Karte sein) deckt die neuen Tabelleneinträge automatisch mit ab.

## 9. Verifikation

- `npm test` grün (aktuell 27/27).
- `node tools/coverage-scan.js unnaturalaxe` meldet im Abschnitt MONSTER keine
  der vier Karten mehr.
- **Die Manuell-Schranke in `tests/auto-consequence.test.js` muss neu
  begründet werden.** HANDOVER §11.4 ist an dieser Stelle überholt: der dort
  vorgeschlagene Umbau ist inzwischen umgesetzt (Commit 166a138), die Schranke
  zählt nur noch Karten **ohne** Override, die durch den Textparser fallen
  (`assert.ok(manualOhneOverride >= 3)`).

  Sie bricht in dieser Runde trotzdem — aus einem anderen Grund als damals.
  Die drei Karten, die sie zählt, sind namentlich RIESENSTINKTIER, LUSTMONSTER
  und WEIHNACHTSMANN, also genau die, die hier Overrides bekommen. Danach ist
  der Zählwert 0, und die Schranke misst nichts mehr: es gibt keine Karte ohne
  Override mehr, an der sich ein zu gieriger Parser zeigen könnte. Ein
  Nachziehen auf `>= 0` wäre eine Assertion, die nie fehlschlagen kann.

  Umgesetzt wird deshalb der Wächter, den die Schranke eigentlich sein will:
  eine feste, kurze Liste von Kartentexten, die `parseAutoConsequence`
  **nicht** auflösen darf, direkt geprüft. Ein zu großzügiger Regex fängt sie
  ein und färbt den Test rot — unabhängig davon, wie viele Karten sonst noch
  kuratiert sind. Das ist die Eigenschaft, die HANDOVER §11.4 mit
  "haltbar über mehrere Runden" gemeint hat, und sie hält auch die Runde
  aus, in der die letzte Karte einen Override bekommt.
- HANDOVER.md §11.3 wird durch einen Abschnitt ersetzt, der den erreichten
  Stand beschreibt.
