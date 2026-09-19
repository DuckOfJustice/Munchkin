# Unnatural Axe, Türkarten Welle A: vier Flüche und ein Gegenstand

Datum: 2026-09-18. Erste von drei Wellen über die restlichen Türkarten des
Sets. Umfasst **VERFLUCHTER GEGENSTAND, STINKER, NARRENGOLD, TODESANGST** und
**EISKALTES HÄNDCHEN (KLEINE FREUNDIN)**.

Die Monsterseite des Sets ist seit
`docs/superpowers/plans/2026-09-17-unnatural-axe-welle3.md` vollständig
(`node tools/coverage-scan.js unnaturalaxe` meldet im Abschnitt MONSTER
nichts mehr). Offen sind 26 Karten: 12 auf der Tür-, 14 auf der Schatzseite.
Diese Welle nimmt die fünf davon, die mit vorhandener Maschinerie auskommen.

## 1. Ausgangslage

Alles, was diese Welle braucht, existiert bereits:

- **`player.activeCurses` samt `LINGERING_CURSES`** (src/cards/reactions.js) —
  Einträge der Form `{ cardId, name, kind, amount, dauer, hinweis }`. `dauer:
  'naechsterKampf'` läuft über `clearNextCombatCurses` an allen Kampfende-Pfaden
  ab, `dauer: 'dauerhaft'` bleibt stehen, der WUNSCHRING beendet über
  `clearActiveCurseByKind` nach Wirkungsart. Der Client zeigt jeden Eintrag mit
  Kartenbild und `hinweis` neben der Spielerzeile.
- **`handlePlayCurseFromHand`** akzeptiert jede Karte mit `category: 'curse'`
  oder Mitgliedschaft in `DOOR_OTHER_AS_CURSE`. Ein Eintrag dort macht eine
  Karte gleichzeitig beim Ziehen wirksam *und* aus der Hand gegen andere
  spielbar. STINKER und NARRENGOLD stehen bereits drin, VERFLUCHTER GEGENSTAND
  ist `category: 'curse'`.
- **`excludeIds` in `combatTotals`** — nimmt Gegenstands-Ids aus allen drei
  Item-Summanden heraus, samt Kartenanhängen (VERGIFTET/GESEGNET) und
  rassenabhängigen Boni (GNOM). Gebaut für MONDJUNGFERN, seither auch vom
  LUSTMONSTER benutzt.
- **Die Verweigerungs-Bauform `MONSTER_FORBIDS_HELP`/`stinktierSperre`** —
  eine Prüfung in `handleRequestHelp`, eine in `handleRespondHelp`, beide mit
  ehrlicher Logzeile statt stummem `return`.
- **`lustOhneHilfe` in `resolveCombat`** — der Pfad "dieser Kampf ist
  unabhängig von der Kampfstärke verloren", vor Krieger-Gleichstand und
  ALUFOLIE-Notlösung.
- **`combatHasUndead`** — Untot im laufenden Kampf, entweder über
  `UNDEAD_MONSTERS` oder über die gespielte Verstärkerkarte UNTOT.
- **`removeOneMonster` mit `leavesTreasure`** (POLLYVERWANDLUNGSTRANK) — ein
  Monster verschwindet und lässt seinen Schatz da.
- **`SPECIAL_SLOT_ITEMS`** — Sammelplatz für Karten ohne `slotKind`, die
  trotzdem angelegt gehören.
- **`clearCheatIfLost` im `takeFrom`-Zweig von
  `handleResolveCardCardChoice`** — die Stelle, an der eine Karte beim
  Leichenplündern die Hand wechselt.

Neu ist damit nur: vier Tabelleneinträge, ein Primitiv (`curseItem`), eine
Markierung am Gegenstand und fünf Lesestellen.

## 2. Abgrenzung

**Drin:** die fünf genannten Karten, vollständig.

**Draußen:** die übrigen sieben Türkarten (Welle B: ABGEBRANNT, TOD,
FREUNDLICH, MAMI; Welle C: SCHICKSALHAFTE KARTEN, FINDE EINE KARTE; dazu
EDELMUT, das mit seiner Verteilrunde über den ganzen Tisch eher zu B gehört),
die gesamte Schatzseite und die beiden anderen nicht anlegbaren Schatzkarten
(SÜSSER SCHULTERDRACHE, STACHELIGER GENITALSCHONER) — und damit auch die
Halbumsetzung beim PSYCHO-EICHHÖRNCHEN.

## 3. VERFLUCHTER GEGENSTAND

> "Ein Gegenstand, der dir einen Kampfbonus oder eine besondere Kraft verleiht,
> ist nun verflucht. Er verliert seine Kräfte, aber du kannst ihn nicht ablegen
> oder loswerden, bis der Fluch aufgehoben wird. Der Gegenstand kann durch einen
> anderen Fluch zerstört werden. Ein Wunschring stellt den Normalzustand wieder
> her. Und wenn du stirbst, wird der Fluch auf den übertragen, der ihn von
> deinem Körper entfernt."

**Auswahl:** das Opfer wählt selbst (Ruling 2026-09-18). Kandidaten sind die
angelegten Gegenstände mit Kampfbonus *oder* Sonderkraft — praktisch:
`equippedItemIds` gefiltert auf `bonus > 0`, `TREASURE_POWER_OVERRIDES[name]`
oder `specialSlotRule(c).bonus`. Genau ein Kandidat: kein Dialog, der Fluch
trifft ihn direkt. Kein Kandidat: der Fluch verpufft mit ehrlicher Logzeile.

**Tracker-Eintrag:** `{ kind: 'cursedItem', itemId, dauer: 'dauerhaft' }`. Die
`itemId` steht am Eintrag, nicht in einem zweiten Feld am Spieler — so
verschwindet sie mit dem Eintrag, und der WUNSCHRING braucht keine
Sonderbehandlung.

**Vier Wirkungen:**

1. *Kräfte weg.* `combatTotals` bekommt die Id in dieselbe `excludeIds`-Menge,
   die MONDJUNGFERN und LUSTMONSTER benutzen. Damit fallen Kartenanhänge und
   der Gnom-Bonus automatisch mit weg — der Grund, warum diese Menge existiert.
2. *Nicht loswerden.* Sperre mit Logzeile in `handleUnequipItem`,
   `handleSellItems` (die ganze Verkaufsaktion wird abgelehnt, nicht still
   gefiltert — dieselbe Entscheidung wie bei der Störerliste in `finishTrade`)
   und `ownTradeIds`.
3. *Ein anderer Fluch zerstört ihn.* Fällt ohne Zutun heraus: `discardSlot` und
   die anderen Verlustpfade laufen über `unequipSlotCard`; damit der Eintrag
   nicht auf eine Karte zeigt, die niemand mehr trägt, prüft die Lesestelle
   (wie `stinktierStrafeAktiv`) beim Lesen, ob die `itemId` überhaupt noch
   angelegt ist, und räumt sonst auf.
4. *Tod überträgt.* Im `takeFrom`-Zweig von `handleResolveCardCardChoice`,
   neben `clearCheatIfLost`: nimmt jemand die verfluchte Karte aus der Leiche,
   wandert der Tracker-Eintrag mit.

## 4. STINKER

> "Niemand hilft dir in deinem nächsten Kampf. Wenn dir in dem Moment, in dem
> diese Karte ausgespielt wird, jemand in einem Kampf hilft, zieht er sich
> straffrei zurück und du musst alleine kämpfen. (Aber wenn Laufende Nase oder
> sein Schatten im Kampf sind, flüchten sie sofort und hinterlassen ihren
> Schatz.)"

Eintrag: `{ kind: 'noHelp', dauer: 'naechsterKampf' }`.

**Lesestellen:** `handleRequestHelp` und `handleRespondHelp` lehnen ab, mit
Logzeile — gleiche Bauform wie `MONSTER_FORBIDS_HELP`, aber an der Person statt
am Monster.

**Sofortwirkung beim Verfluchen im Kampf** (Ruling 2026-09-18): ist die
verfluchte Person gerade im Kampf, gilt der Eintrag für diesen Kampf; eine
zugesagte Helfer:in verlässt ihn straffrei (`helperId`/`helperReward` zurück
auf null/0 wie in `removeHelper`, danach `refreshCombatReady`). Liegen
LAUFENDE NASE oder DIE SCHATTENNASE im Kampf, verschwinden sie und lassen
ihren Schatz da — mechanisch `removeOneMonster` mit `leavesTreasure`. Bleibt
dadurch kein Monster übrig, endet der Kampf über `beendeKampfOhneSieg`.

## 5. NARRENGOLD

> "Du erhältst keinen Schatz im nächsten Kampf. Wenn du dich im Kampf
> befindest, während der Fluch ausgesprochen wird, erhältst du keinen Schatz in
> diesem Kampf."

Eintrag: `{ kind: 'noCombatTreasure', dauer: 'naechsterKampf' }`.

**Lesestelle:** `resolveCombatWin`. Gezogen wird gar nicht erst — dieselbe
Entscheidung wie bei der Störerliste des Weihnachtsmanns: der Stapel darf
durch eine Sperre nicht schrumpfen. Betroffen ist nur die kämpfende Person,
nicht die Helfer:in: der Fluch hängt an einer Person, und die Zusage der
Helfer:in ist ihr eigener Anspruch. Bekommt die kämpfende Person nichts, zieht
die Helfer:in ihren zugesagten Anteil direkt — der Pfad dafür existiert seit
der Störerliste (`ziehendFuer`/`sollZiehen`).

**Abgrenzung zur Störerliste:** `noTreasure` (Weihnachtsmann) sperrt *jede*
Schatzkarte, auch Geschenke und Handel, und geht deshalb durch
`zieheSchaetzeFuer`. `noCombatTreasure` sperrt nur die Kampfbeute — also
ausdrücklich **nicht** über `zieheSchaetzeFuer`, sonst verlöre die Person auch
das Packratten-Geschenk.

## 6. TODESANGST

> "Du hast Angst vor den Untoten. Du hilfst niemandem, die Untoten zu
> bekämpfen. Wenn Untote in einen Kampf treten, in dem du geholfen hast, musst
> du diesen Kampf verlassen (keine Strafe). Wenn du gegen Untote kämpfst, wird
> dir niemand helfen! Du musst Weglaufen, selbst wenn du das Monster besiegen
> könntest."

Eintrag: `{ kind: 'fearUndead', dauer: 'dauerhaft' }`. TODESANGST kommt in
`DOOR_OTHER_AS_CURSE` — damit wirkt die Karte beim Ziehen und ist aus der Hand
spielbar.

**Drei Lesestellen:**

1. `handleRespondHelp`: Zusage kommt nicht zustande, wenn
   `combatHasUndead(room)`. Bewusst dort und nicht in `handleRequestHelp` —
   gefragt werden darf, so sieht der Tisch den Versuch (gleiche Entscheidung
   wie beim LUSTMONSTER).
2. Untote treten nachträglich in den Kampf (Verstärkerkarte UNTOT, WANDERNDES
   MONSTER, KUMPEL): die helfende Person mit `fearUndead` verlässt den Kampf
   straffrei. Eine Prüfstelle nach dem Vorbild von `refreshCombatReady`, die
   nach jeder Monster-/Verstärkeränderung läuft.
3. `resolveCombat`: kämpft die Person selbst gegen Untote, ist der Kampf
   verloren — derselbe Zweig wie `lustOhneHilfe`, vor Krieger-Gleichstand und
   ALUFOLIE. Zusätzlich verweigert `handleRequestHelp` die Anfrage ("wird dir
   niemand helfen").

## 7. EISKALTES HÄNDCHEN (KLEINE FREUNDIN)

Eigene Deckkarte (`door_other`, `bonus: 3`, kein `slotKind`) neben der
Monsterkarte, deren besänftigte Form seit Welle 3 auf dem Spezialplatz liegt.
Ein `SPECIAL_SLOT_ITEMS`-Eintrag macht sie anlegbar: `{ slot: 'special' }` —
den Bonus liefert hier das eigene `bonus`-Feld, anders als bei der
Monsterkarte, deren Bonus an der Regel hängt.

## 8. Teststrategie

Neue Datei `tests/card-unnatural-doors.test.js` (der Runner liest
`tests/*.test.js` selbst ein). Ein Block je Karte, testgetrieben: jeder Test
wird vor der Implementierung rot gesehen.

Mindestens je ein Test für:

- VERFLUCHTER GEGENSTAND: Wahl unter mehreren Gegenständen; Bonus zählt im
  Kampf nicht mehr (inklusive eines Anhangs am selben Gegenstand); Ablegen,
  Verkaufen und Handel werden abgelehnt; WUNSCHRING hebt auf; die Übertragung
  beim Leichenplündern.
- STINKER: Hilfe wird abgelehnt; beim Verfluchen im Kampf verlässt die
  Helfer:in den Kampf; LAUFENDE NASE flieht und lässt ihren Schatz da.
- NARRENGOLD: Kampfsieg ohne Beute, Schatzstapel unverändert; die Zusage an
  die Helfer:in wird trotzdem bedient.
- TODESANGST: Zusage gegen Untote scheitert; nachträgliche Untote werfen die
  Helfer:in raus; eigener Kampf gegen Untote ist trotz höherer Kampfstärke
  verloren.
- EISKALTES HÄNDCHEN (KLEINE FREUNDIN): anlegbar, +3 im Kampf, kleiner
  Gegenstand.

## 9. Offene Auslegungen

Punkte, die jemand später anders entscheiden könnte:

- Kandidat für VERFLUCHTER GEGENSTAND ist nur **angelegte** Ausrüstung. Ein
  Gegenstand auf der Hand verleiht keine Kräfte, kann also nach dieser Lesart
  nicht gemeint sein.
- Der Fluch sperrt den Gegenstand, nicht den Platz: eine verfluchte Rüstung
  bleibt liegen, eine zweite lässt sich nicht darüberlegen — wer sie loswerden
  will, braucht den Wunschring oder einen Fluch, der den Platz räumt.
- STINKER wirft die Helfer:in nur beim Verfluchen im Kampf hinaus. Wer
  *danach* im selben Kampf um Hilfe bittet, wird ohnehin abgelehnt.
- TODESANGST ist dauerhaft und endet nur über den Wunschring. Der Kartentext
  nennt kein Ende.
- Wird jemand mit NARRENGOLD und der Störerliste gleichzeitig belegt, greifen
  beide; die Störerliste bleibt nach dem Kampf bestehen, NARRENGOLD läuft ab.
