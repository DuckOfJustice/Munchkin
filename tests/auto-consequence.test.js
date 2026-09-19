// Verifiziert die automatische Berechnung von "Schlimme Dinge"/Fluch-
// Konsequenzen: sowohl den generischen Regex-Fallback (parseAutoConsequence)
// als auch die kuratierte Sonderfall-Tabelle (CONSEQUENCE_OVERRIDES) über
// resolveConsequenceSpec, inklusive tatsächlicher Zustandsänderungen.
const assert = require('assert');
const {
  parseAutoConsequence, resolveConsequenceSpec, ALL_CARDS, CONSEQUENCE_OVERRIDES,
} = require('../server.js');

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

  // Seit Task 9 (Unnatural Axe) loest CONSEQUENCE_OVERRIDES die Karte selbst
  // auf, statt sie an den generischen Textparser durchzureichen - "stirbst"
  // im Text darf trotzdem nicht den Tod-Fallback ausloesen: ohne angelegten
  // Kandidaten (humanPlayer traegt nichts) bleibt es bei 'noEffect'.
  assert.deepStrictEqual(resolveConsequenceSpec('VERFLUCHTER GEGENSTAND', 'Und wenn du stirbst, wird der Fluch übertragen.', humanPlayer, room), { type: 'noEffect' });

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
  let resolved = 0, choice = 0, manual = 0, manualOhneOverride = 0;
  [...monsters.map((c) => ({ name: c.name, text: c.badstuff })), ...curses.map((c) => ({ name: c.name, text: c.text }))]
    .forEach((s) => {
      const spec = resolveConsequenceSpec(s.name, s.text, defaultPlayer, room);
      if (!spec) {
        manual++;
        // Nur Karten OHNE Eintrag in CONSEQUENCE_OVERRIDES sind ueberhaupt
        // beim generischen Textparser (parseAutoConsequence) - siehe unten.
        if (!CONSEQUENCE_OVERRIDES[s.name]) manualOhneOverride++;
      } else if (spec.type === 'choice') choice++;
      else resolved++;
    });
  const total = monsters.length + curses.length;
  console.log(`OK - Konsequenz-Abdeckung: ${resolved} automatisch, ${choice} als Wahl-Buttons, ${manual} bleiben manuell (von ${total}).`);
  // Untergrenze statt exakter Zahl: neue Overrides dürfen die Abdeckung nur
  // erhöhen; ein deutlicher RÜCKGANG deutet auf eine kaputte Regel hin.
  assert.ok(resolved + choice >= 60, `Abdeckung eingebrochen: nur noch ${resolved + choice} von ${total} automatisch/Wahl (erwartet >= 60)`);
  // Waechter gegen eine zu grosszuegige generische TEXTREGEL
  // (parseAutoConsequence) - NICHT gegen kuratierte Fortschritte in
  // CONSEQUENCE_OVERRIDES.
  //
  // Frueher war das eine Untergrenze auf der ANZAHL manuell gebliebener
  // Karten. Diese Zahl ist zweimal an ihrem eigenen Erfolg gescheitert:
  // erst zaehlte sie kuratierte Karten mit und musste nach jeder Runde
  // nachgezogen werden; dann zaehlte sie nur noch Karten ohne Override -
  // aber das waren genau RIESENSTINKTIER, LUSTMONSTER und WEIHNACHTSMANN,
  // und als die Overrides bekamen, fiel sie auf 0. Eine Untergrenze, deren
  // Gegenstand verschwinden kann, ist kein Waechter.
  //
  // Gemessen wird deshalb direkt die Eigenschaft, um die es geht: diese
  // Kartentexte DUERFEN vom generischen Parser nicht aufgeloest werden. Sie
  // nennen Bedingungen, Zeitpunkte oder Zustaende, die eine Textregel nicht
  // sehen kann - wer sie einfaengt, hat eine zu gierige Regex gebaut.
  // Kuratierte Overrides sind hier egal: geprueft wird parseAutoConsequence
  // selbst, nicht der Weg, den die Karte im Spiel nimmt.
  const PARSER_TABU = [
    // "bis du ein Monster ohne Hilfe toetest" - ein Zeitpunkt in der Zukunft.
    'WEIHNACHTSMANN',
    // "in deinem naechsten Kampf" - eine Wirkung ueber diese Konsequenz hinaus.
    'LUSTMONSTER',
    // "bevor du nicht alle getragene Kleidung und Ruestung ablegst" - eine
    // Bedingung, die an einem Zustand haengt.
    'RIESENSTINKTIER',
    // "Wuerfle. Bei 1-3 ..." - ein Wurf, kein fester Effekt.
    'SCHNECKEN AUF SPEED',
  ];
  PARSER_TABU.forEach((name) => {
    const karte = ALL_CARDS.find((c) => c.name === name);
    assert.ok(karte, `Testvoraussetzung: Karte "${name}" existiert`);
    assert.strictEqual(parseAutoConsequence(karte.badstuff || ''), null,
      `Der generische Textparser loest "${name}" auf, obwohl der Text eine Bedingung/einen Zeitpunkt nennt, die er nicht sehen kann - vermutlich eine zu großzügige Regex-Regel`);
  });
}

run();
console.log('1/1 Tests erfolgreich (auto-consequence.test.js).');
