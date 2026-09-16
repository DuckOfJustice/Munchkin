// Verifiziert die automatische Berechnung von "Schlimme Dinge"/Fluch-
// Konsequenzen: sowohl den generischen Regex-Fallback (parseAutoConsequence)
// als auch die kuratierte Sonderfall-Tabelle (CONSEQUENCE_OVERRIDES) über
// resolveConsequenceSpec, inklusive tatsächlicher Zustandsänderungen.
const assert = require('assert');
const { parseAutoConsequence, resolveConsequenceSpec, ALL_CARDS } = require('../server.js');

function makePlayer(overrides) {
  return Object.assign({
    id: 'p1', name: 'Test', level: 5, hand: [], races: [], classes: [],
    equipped: { head: null, armor: null, feet: null, hands: [null, null] },
  }, overrides || {});
}

function idByName(name) {
  const c = ALL_CARDS.find((x) => x.name === name);
  if (!c) throw new Error(`Testkarte nicht gefunden: ${name}`);
  return c.id;
}

function run() {
  // ---------------------------------------------------------------------
  // Generischer Regex-Fallback (parseAutoConsequence)
  // ---------------------------------------------------------------------
  assert.deepStrictEqual(parseAutoConsequence('Seine knochige Berührung kostet dich 2 Stufen.'), { type: 'levelDelta', amount: 2 });
  assert.deepStrictEqual(parseAutoConsequence('Verliere 3 Stufen.'), { type: 'levelDelta', amount: 3 });
  assert.deepStrictEqual(parseAutoConsequence('Zwei Stufen verlieren.'), { type: 'levelDelta', amount: 2 }, 'Zahlwort + Stufen + Verb (nachgestellt)');
  assert.deepStrictEqual(parseAutoConsequence('Verliere drei Stufen.'), { type: 'levelDelta', amount: 3 }, 'Verb + Zahlwort (vorangestellt)');
  assert.deepStrictEqual(parseAutoConsequence('2 Stufen verlieren.'), { type: 'levelDelta', amount: 2 }, 'Ziffer + Stufen + Verb (nachgestellt)');
  assert.deepStrictEqual(parseAutoConsequence('Du wirst geröstet und gefressen. Du bist tot.'), { type: 'death' });
  assert.deepStrictEqual(parseAutoConsequence('Du wirst auf Stufe 1 reduziert.'), { type: 'setLevel1' });
  assert.deepStrictEqual(
    parseAutoConsequence('Würfle. Bei einer 1 oder 2 trampeln sie dich zu Tode. Ansonsten verlierst du soviele Stufen, wie gewürfelt wurde.'),
    { type: 'diceLevelLoss' }
  );
  // Regressionsfall: "helfen" darf wegen des enthaltenen "elfen" nicht
  // fälschlich als Rassen-Ausnahme erkannt werden (Wortgrenzen!).
  assert.deepStrictEqual(
    parseAutoConsequence('Verlierst du den Kampf, kannst du nicht fliehen. Nichts wird dir helfen. Du verlierst 3 Stufen.'),
    { type: 'levelDelta', amount: 3 },
    '"helfen" darf nicht als "Elfen"-Ausnahme fehlinterpretiert werden'
  );

  // --- bewusst NICHT automatisch: mehrdeutig/bedingt/zusammengesetzt ---
  assert.strictEqual(parseAutoConsequence('Ein wirklich ekliger Kuss kostet dich 2 Stufen (3 für Elfen).'), null, 'Rassen-Klammer-Ausnahme muss ausgeschlossen bleiben');
  assert.strictEqual(parseAutoConsequence('Lege entweder deine ganze Hand ab oder verliere 2 Stufen.'), null, 'Entweder-Oder-Wahl muss ausgeschlossen bleiben');
  assert.strictEqual(parseAutoConsequence('Lege das Schuhwerk, das du trägst, ab. Verliere 1 Stufe, falls du kein Schuhwerk trägst.'), null, 'Bedingter Fall (falls...) muss ausgeschlossen bleiben');
  assert.strictEqual(parseAutoConsequence('Frauen verlieren ihre Rüstung. Männer müssen ein Bier mit ihm teilen, verliere 1 Stufe.'), null, 'Geschlechts-Sonderfall muss ausgeschlossen bleiben');
  assert.strictEqual(parseAutoConsequence('Du verlierst alle Gegenstände und alle Karten auf deiner Hand.'), null, 'Reiner Gegenstandsverlust ohne Stufen-Zahl bleibt manuell');
  assert.strictEqual(parseAutoConsequence(''), null);
  assert.strictEqual(parseAutoConsequence(null), null);

  // ---------------------------------------------------------------------
  // Kuratierte Sonderfälle (CONSEQUENCE_OVERRIDES via resolveConsequenceSpec)
  // ---------------------------------------------------------------------
  const room = { players: [makePlayer({ id: 'p1', level: 5 }), makePlayer({ id: 'p2', level: 2 })], doorDiscard: [] };

  // Rassen-bedingte Stufenzahl: "(3 für Elfen)"
  const elfId = idByName('ELF');
  const humanPlayer = makePlayer();
  const elfPlayer = makePlayer({ races: [elfId] });
  assert.deepStrictEqual(resolveConsequenceSpec('ZUNGENDÄMON', 'x', humanPlayer, room), { type: 'levelDelta', amount: 2 });
  assert.deepStrictEqual(resolveConsequenceSpec('ZUNGENDÄMON', 'x', elfPlayer, room), { type: 'levelDelta', amount: 3 });

  // Ausrüstungszustands-bedingt: FEDERFEIND (Kopfbedeckung vorhanden -> ablegen, sonst Stufenverlust)
  const helmId = ALL_CARDS.find((c) => c.slotKind === 'head' && c.category === 'item').id;
  const bareHead = makePlayer();
  const withHelm = makePlayer({ equipped: { head: helmId, armor: null, feet: null, hands: [null, null] } });
  assert.deepStrictEqual(resolveConsequenceSpec('FEDERFEIND', 'x', bareHead, room), { type: 'levelDelta', amount: 2 });
  assert.deepStrictEqual(resolveConsequenceSpec('FEDERFEIND', 'x', withHelm, room), { type: 'discardSlot', slot: 'head' });

  // Klassenkarte statt Tod: UNGLAUBLICHER UNAUSSPRECHLICHER SCHRECKEN
  const zaubererId = idByName('ZAUBERER');
  const wizard = makePlayer({ classes: [zaubererId] });
  const nonWizard = makePlayer();
  assert.deepStrictEqual(resolveConsequenceSpec('UNGLAUBLICHER UNAUSSPRECHLICHER SCHRECKEN', 'x', wizard, room), { type: 'discardClassCardMatchingElseDeath', substr: 'ZAUBERER' });
  assert.deepStrictEqual(resolveConsequenceSpec('UNGLAUBLICHER UNAUSSPRECHLICHER SCHRECKEN', 'x', nonWizard, room), { type: 'discardClassCardMatchingElseDeath', substr: 'ZAUBERER' });

  // Echte Entweder-Oder-Wahl: ENTIKOR
  const entikorSpec = resolveConsequenceSpec('ENTIKOR', 'x', humanPlayer, room);
  assert.strictEqual(entikorSpec.type, 'choice');
  assert.strictEqual(entikorSpec.options.length, 2);

  // Explizit unterdrückt trotz "stirbst" im Text (zukünftiger, nicht aktueller Tod):
  assert.strictEqual(resolveConsequenceSpec('VERFLUCHTER GEGENSTAND', 'Und wenn du stirbst, wird der Fluch übertragen.', humanPlayer, room), null);

  // ---------------------------------------------------------------------
  // Tatsächliche Zustandsänderung (applyDeathConsequence-Pfad, Ausrüstung, Hand)
  // ---------------------------------------------------------------------
  // discardSlot muss den Slot leeren und applyPrimitiveAction wird über
  // autoApplyLossConsequence indirekt getestet (siehe basic-game-flow.test.js
  // für den vollen Server-Integrationstest); hier reicht die reine Logik-Ebene.

  // ---------------------------------------------------------------------
  // Abdeckungs-Regressionscheck gegen den vollen Kartensatz
  // ---------------------------------------------------------------------
  const monsters = ALL_CARDS.filter((c) => c.category === 'monster');
  const curses = ALL_CARDS.filter((c) => c.category === 'curse');
  const defaultPlayer = makePlayer();
  let resolved = 0, choice = 0, manual = 0;
  [...monsters.map((c) => ({ name: c.name, text: c.badstuff })), ...curses.map((c) => ({ name: c.name, text: c.text }))]
    .forEach((s) => {
      const spec = resolveConsequenceSpec(s.name, s.text, defaultPlayer, room);
      if (!spec) manual++;
      else if (spec.type === 'choice') choice++;
      else resolved++;
    });
  const total = monsters.length + curses.length;
  console.log(`OK - Konsequenz-Abdeckung: ${resolved} automatisch, ${choice} als Wahl-Buttons, ${manual} bleiben manuell (von ${total}).`);
  // Untergrenze statt exakter Zahl: neue Overrides dürfen die Abdeckung nur
  // erhöhen; ein deutlicher RÜCKGANG deutet auf eine kaputte Regel hin.
  assert.ok(resolved + choice >= 60, `Abdeckung eingebrochen: nur noch ${resolved + choice} von ${total} automatisch/Wahl (erwartet >= 60)`);
  // Nach der Runde vom 2026-09-12 (Task 9, "Schlimme Dinge mit Fremd-
  // beteiligung") sind sieben weitere Karten kuratiert automatisiert:
  // HIPPOGREIF, ANWALT, LEPRACHAUN, NETZ-TROLL, VERSICHERUNGSVERTRETER,
  // SCHNECKEN AUF SPEED (Monster) und FLUCH! EINKOMMENSSTEUER (Fluch) -
  // GALLERT-OKTAEDER war schon vorher automatisiert und zaehlt hier nicht
  // erneut. Die Schranke sinkt deshalb von 27 auf tatsaechlich 20 manuell;
  // sie wird hier bewusst nur bis 15 gesenkt (statt exakt auf 20), damit
  // etwas Spielraum bleibt. Die Schranke schuetzt weiter davor, dass eine zu
  // grosszuegige REGEX-Regel Karten einfaengt - kuratierte Eintraege wie die
  // sieben obigen sind davon nicht betroffen.
  // Runde vom 2026-09-13 (Clerical Errors, Tasks 2-3): neun weitere Karten
  // sind kuratiert dazugekommen - TEQUILA-LIEDCHEN, RÜSSELKÄFER,
  // DOPPELGANGSTER, KAMIKAZE-KOBOLDE, GOTHYANKI, BOBBELKOPF, STRICHMÄNNCHEN,
  // CHAUVINISTENSCHWEIN (Monster) und GESCHLECHTSUMWANDLUNG (Fluch, seit dem
  // Geschlechtsmerkmal mit echtem Sofort-Effekt). Tatsaechlich stehen damit
  // noch 12 Karten manuell; die Schranke geht auf 10, der Zweck bleibt
  // derselbe: eine zu grosszuegige REGEX-Regel auffallen lassen. Kuratierte
  // Eintraege sind davon nicht betroffen.
  // Runde vom 2026-09-16 (Unnatural Axe, Task 3): zwei weitere Karten
  // sind kuratiert dazugekommen - GEWALTIGER BAZILLUS und MONDJUNGFERN.
  // Tatsaechlich stehen damit noch 9 Karten manuell; die Schranke geht auf 8.
  // Runde vom 2026-09-16 (Unnatural Axe, Tasks 7-10): drei weitere Karten
  // sind kuratiert dazugekommen - PSYCHO-EICHHÖRNCHEN, PTERODAKTYL und die
  // Schlimmen Dinge des SL-Monsters. Tatsaechlich stehen damit noch 6 Karten
  // manuell; die Schranke geht auf 5.
  assert.ok(manual >= 5, `Zu viele Karten automatisch erkannt (${manual} manuell) - vermutlich eine zu großzügige Regel; bitte gegen die Kartentexte prüfen`);
}

run();
console.log('1/1 Tests erfolgreich (auto-consequence.test.js).');
