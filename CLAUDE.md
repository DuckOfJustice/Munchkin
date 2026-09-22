# CLAUDE.md

Munchkin (Kartenspiel) als Browser-Multiplayer: Node/Express + Socket.IO,
alles im Speicher (`rooms`-Map, keine DB). Code, Kommentare, Commits,
Logs und UI sind **deutsch**. Deploy per Docker auf einen Raspberry Pi
(`deploy.sh`, Port `127.0.0.1:8098`).

## Befehle

```bash
npm install                            # node_modules ist nicht eingecheckt
npm start                              # http://localhost:3000 (PORT=... moeglich)
npm test                               # tests/run.js: jede *.test.js im eigenen Prozess
node tests/card-curses.test.js         # einzelne Testdatei
node -c server.js                      # Syntaxcheck
node tools/coverage-scan.js <set>      # Karten ohne Ausspielweg (base, clericalerrors, unnaturalaxe)
node tools/smoke-run.js                # Partie mit Bots gegen LAUFENDEN Server (Haenger finden)
```

`tools/browser-run.js` = Playwright gegen das echte Frontend (Playwright ist
bewusst keine Abhaengigkeit, siehe Dateikopf).

## Aufbau

- `server.js` (~7000 Zeilen): die ganze Spiellogik. Abschnitte sind mit
  `// ----` Kopfzeilen markiert: Kartendaten, Raumverwaltung, Decks,
  Ausruestung/Kampfstaerke, Oeffentlicher Zustand, Phase 1-3, Konsequenzen,
  Schatzkraefte, Dauerwirkungen, Kampf, Handel, Bots, Socket.IO.
  Exportiert fast alles per `module.exports` (fuer Tests/Tools); startet nur
  bei `require.main === module`.
- `src/cards/*.js`: kuratierte Kartentabellen als Factory `(ctx) => {...}`,
  in `server.js` mit Hilfsfunktionen aufgerufen:
  - `consequences.js`: `CONSEQUENCE_OVERRIDES`, `DOOR_OTHER_AS_CURSE`
  - `treasures.js`: `TREASURE_POWER_OVERRIDES`, `COMBAT_POTION_OVERRIDES`, Flucht-Sonderfaelle
  - `passives.js`: Dauerwirkungen, Monsterboni (`MONSTER_TRAIT_BONUS`), `MONSTER_REFUSES`, Flucht-Mods
  - `reactions.js`: Reaktionsfenster (Wuerfel, Flucht)
  - `bigitems.js`: Liste grosser Gegenstaende
- `data/cards.json`: 355 Karten (Sets: Basis, Clerical Errors, Unnatural Axe).
  Tabellen-Schluessel = **exakter** Kartenname von dort (Grossbuchstaben, Umlaute).
- `public/`: `index.html`, `style.css`, `client.js` (ein Client, rendert aus
  `gameState`; Namen immer mit `escapeHtml()`).

## Kernmuster

- Override-Funktion `(player, room) => actionSpec | null | undefined`:
  Spec = automatisch anwenden ueber `applyPrimitiveAction()`, `null` = bewusst
  manuell, `undefined` = Fallback auf den Regex-Parser `parseAutoConsequence()`.
  Neue Wirkungsart = neuer `case` in `applyPrimitiveAction`.
- Spieler-Interaktion: `room.pendingCardAction` (`openCardChoice`,
  `openCardTarget`, `openCardCardChoice` + `handleResolve*`), Client:
  `renderCardAction()`. Aelteres `pendingConsequence`-System besteht parallel.
- Anhaltende Flueche: `player.activeCurses` (`addActiveCurse`,
  `clearActiveCurseByKind`; WUNSCHRING beendet sie).
- Schatz ziehen fuer Spieler immer ueber `zieheSchaetzeFuer()` (Choke-Point
  fuer Sperren), nicht direkt `drawTreasure`.
- Socket-Handler nur ueber `onSafe()` registrieren (schuetzt vor fehlerhaften Payloads).

## Arbeitsweise

1. Kartentext zuerst in `data/cards.json` nachschlagen, dann den Code-Pfad
   lesen. HANDOVER.md hat sich schon geirrt, nicht blind daraus bauen.
2. Tabelleneintrag + ggf. Primitiv + Test in der passenden
   `tests/card-*.test.js`. Unit-Tests bauen Raum/Spieler im Speicher
   (`makePlayer`/`makeRoom` je Testdatei) und rufen Handler direkt; nur
   `basic-game-flow` und `malformed-input` starten echte Server (`tests/helpers.js`).
3. `npm test` muss gruen sein. Ein Test prueft, dass jeder Tabellen-Name in
   `cards.json` existiert.
4. Bewusste Vereinfachungen mit `// ponytail:` markieren, inkl. Grenze und Aufruestweg.
5. Groessere Runden: Spec + Plan unter `docs/superpowers/specs|plans/`
   (Datum-Praefix), Ergebnis als neuer Abschnitt in `HANDOVER.md`.

## Wo steht was

- `HANDOVER.md`: chronologisches Protokoll aller Runden (§1 Architektur,
  §4 bewusst offen, §11 Unnatural Axe = aktueller Stand). Lang, gezielt lesen.
- `README.md`: was automatisiert ist vs. manuell (Trust-Prinzip).
- Offene Karten eines Sets: `node tools/coverage-scan.js <set>`.
- README erwaehnt `.github/workflows/ci.yml`, das existiert im Repo nicht.
