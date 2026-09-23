# Regellücken Welle 2: vier wirkungslose Karten + zwei Nachträge

Stand: 2026-09-22. Welle 1 (Hase, Halb-Blut, Schilde, Huhn, Zaubercouch) liegt
als PR #17 vor. Welle 3 (Barde „Verzaubern", Verstärker pro Monster) bekommt
eine eigene Spec.

## Ziel

Vier Karten, die heute gar nichts tun (`() => null` in
`CONSEQUENCE_OVERRIDES`, aber bereits in `DOOR_OTHER_AS_CURSE`), bekommen ihre
Wirkung. Alle vier sind anhaltende Flüche mit einer eigenen Endbedingung und
nutzen den vorhandenen Tracker `player.activeCurses` (`LINGERING_CURSES`,
`addActiveCurse`, `clearActiveCurseByKind`, Beenden per WUNSCHRING).

Nicht im Umfang: TROJANISCHER PFERD - die Karte ist seit Commit 48f83ae
umgesetzt (Reaktionsfenster nach gewonnenem Kampf, `TREASURE_REACTION_CARDS`).
Der Abdeckungs-Scan meldet sie nur deshalb als offen, weil ihm diese Tabelle
fehlt (siehe §6).

## 1. HUNGRIGER RUCKSACK

**Karte:** „Am Ende jedes deiner Züge würfelst du, bevor ‚Milde Gabe' verteilt
oder abgelegt wird. Dein Rucksack frisst entsprechend des Wurfs so viele
zufällige Karten deiner Hand! Bei einer gewürfelten 6 verschluckt der Rucksack
sich selbst und verschwindet. Deine Hand bleibt unversehrt und der Fluch endet."

**Soll:**
- Neue Wirkungsart `hungrigerRucksack`, Dauer `dauerhaft`.
- Der Wurf fällt beim Übergang in die Phase „Milde Gabe" (`room.turnPhase =
  'gabe'`), also bevor abgelegt oder verschenkt wird - das ist der Zeitpunkt,
  den die Karte nennt. Er fällt nur im Zug der verfluchten Person.
- Wurf 1-5: so viele zufällige Handkarten wie gewürfelt wandern auf den
  passenden Ablagestapel (weniger, wenn die Hand kleiner ist). Wurf 6: nichts
  wird gefressen, der Fluch endet.
- Der Wurf läuft über `rollWithWindow` wie jeder andere Würfelwurf, damit
  GEZINKTER WÜRFEL und KATZENINTERVENTION darauf reagieren dürfen. Der
  Rollmalus des HUHNS gilt wie bei jedem Wurf.
- Es gibt mehrere Wege in die Gabe-Phase (Plündern, Kampfende, Vorbeiziehen
  eines Monsters). Der Wurf hängt deshalb an einer Stelle, die alle bedient,
  und darf pro Zug nur einmal fallen.

## 2. TEMPORÄRE ANMNESIE

**Karte:** „Eine Beule am Kopf lässt dich deine Klasse(n) und Rasse(n)
vergessen. Du wirst dich erst an sie erinnern, wenn du ein Monster getötet hast
oder dabei geholfen hast, eines zu töten. Bis dahin wirst du überall als
klassenloser Mensch gezählt."

**Soll:**
- Neue Wirkungsart `traitsVergessen`, Dauer `dauerhaft`.
- `hasRace` und `hasClass` liefern für die verfluchte Person `false` - damit
  gilt sie „überall" als klassenloser Mensch: Monsterboni, Kampfzwang,
  Klassenkräfte, Rassenvorteile, `istMensch`. Die Karten bleiben ausliegen und
  kommen unverändert zurück, wenn der Fluch endet.
- Gegenstände, die eine Rasse/Klasse verleihen (`itemGrantsTrait`, z. B.
  FALSCHE OHREN, ZAUBERCOUCH), zählen währenddessen ebenfalls nicht - auch das
  ist „vergessen".
- Ende: sobald die Person einen Kampf gewinnt, an dem sie beteiligt war -
  kämpfend oder helfend (`resolveCombatWin`, alle `combatParticipants`).
  Monster, die ohne Kampf verschwinden, zählen nicht.

## 3. TOURISTENFALLE

**Karte:** „Du darfst nicht ‚Auf Ärger aus sein'. Dieser Fluch bleibt bestehen,
bis du einem anderen Spieler geholfen hast, einen Kampf zu gewinnen."

**Soll:**
- Neue Wirkungsart `keinAergerSuchen`, Dauer `dauerhaft`.
- `handlePlayMonsterFromHand` lehnt für die verfluchte Person ab (Logzeile mit
  Grund, Karte bleibt auf der Hand). Türkarten eintreten, plündern, helfen und
  Karten in fremde Kämpfe spielen bleiben erlaubt - die Karte verbietet nur
  Phase 2.
- Ende: sobald die Person als **helfende** Person einen Kampf gewinnt
  (`resolveCombatWin`, `c.helperId === p.id`). Ein eigener Sieg beendet den
  Fluch nicht.

## 4. GUMMI-GOLEM (Schlimme Dinge)

**Karte:** „Zuckerschock! Du musst in *jedem Kampf* deine Hilfe anbieten,
darfst keinen Schatz annehmen, bis du einen verlierst. Keiner muss deine Hilfe
annehmen, aber du musst sie anbieten."

**Soll:**
- Neue Wirkungsart `zuckerschock`, Dauer `dauerhaft`. Der Kampfbonus des
  Monsters („nur mit deiner Stufe kämpfen") läuft schon über
  `MONSTER_IGNORES_BONUSES` und bleibt unverändert.
- **Hilfe anbieten (Nutzerentscheidung: der Server bietet automatisch an):**
  Bei jedem Kampfbeginn, an dem die verfluchte Person nicht selbst kämpft,
  schreibt der Server ihr Angebot in den Verlauf („X muss helfen und bietet
  seine Hilfe an"). Fragt die kämpfende Person diese Person um Hilfe, nimmt sie
  automatisch an (sie darf nicht ablehnen). Niemand muss sie fragen.
- **Kein Schatz:** dieselbe Sperre wie die Störerliste des WEIHNACHTSMANNS
  (`hatSchatzSperre`, greift in `zieheSchaetzeFuer` und in allen Übergabewegen
  über `darfSchatzBekommen`). Die Wirkungsart `zuckerschock` zählt dafür wie
  `noTreasure`.
- **Ende:** sobald die Person eine Schatzkarte verliert. Gemessen an der Zahl
  der besessenen Schatzkarten (Hand + angelegt): sinkt sie unter den Stand beim
  Eintragen des Fluchs, endet er. Das deckt jeden Verlustweg ab (ablegen,
  verkaufen, gestohlen, Fluch, Handel), ohne an jedem einzelnen zu hängen.
  Geprüft wird bei jeder Zustandsänderung (`touchRoom`).
  Bewusste Grenze: wer trotz Sperre irgendwie Schätze dazubekommt (z. B.
  Anfangsverteilung neuer Karten durch eine andere Karte) und danach einen
  verliert, bleibt verflucht, solange der Stand nicht unter den Startwert fällt.

## 5. Nachtrag aus Welle 1: RIESENKAKERLAKE trifft Halb-Blut-Elfen

**Karte:** „+5 gegen Elfen oder Menschen."

**Heute:** Die Regel steht als `wennErfuellt`-Bedingung in
`MONSTER_TRAIT_BONUS`. `monsterTraitBonusSum` wendet den Halb-Blut-Schutz
(`traitImmun`) aber nur auf `rule.races`/`rule.classes` an - ein Halb-Blut-Elf
bekommt die +5 also weiterhin.

**Soll:** `wennErfuellt`-Regeln dürfen `nachteilFuer: 'races' | 'classes'`
tragen. Trägt eine Regel das, gilt für sie derselbe Schutz wie für
`races`/`classes`. RIESENKAKERLAKE bekommt `nachteilFuer: 'races'`; ein
Halb-Blut-Elf ist damit weder Elf (geschützt) noch Mensch (er hat eine
Rassenkarte) und bekommt keinen Bonus. GRASGNOLL („+5 gegen Menschen") bleibt
unverändert: ein Mensch hat keine Rassenkarte und damit nie Halb-Blut.

## 6. Nachtrag: Fehlalarm im Abdeckungs-Scan

`tools/coverage-scan.js` kennt `TREASURE_REACTION_CARDS` nicht und meldet
TROJANISCHER PFERD als Karte ohne Ausspielweg. Die Tabelle kommt in `abgedeckt()`
dazu. Danach meldet `node tools/coverage-scan.js unnaturalaxe` keine Karte mehr.

## Tests

Neue Datei `tests/card-regelluecken-welle2.test.js`, je Karte mindestens: die
Wirkung, die Endbedingung, eine Gegenprobe (ohne Fluch bleibt alles beim
Alten). Dazu: WUNSCHRING beendet jeden der vier Flüche, Halb-Blut-Elf gegen
RIESENKAKERLAKE, und ein Scan-Aufruf ohne Treffer. `npm test` bleibt grün.
