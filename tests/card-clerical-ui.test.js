// Clerical Errors, Task 1 (Plan 2026-09-14-clerical-errors-audit.md): der
// Client pflegte handkopierte Namenslisten der Server-Tabellen, die
// auseinandergedriftet sind - 13 Karten lagen serverseitig fertig, aber ohne
// Knopf tot auf der Hand. Dieser Test haelt die Garantie fest, die das
// kuenftig verhindert: jede serverseitig spielbare Karte steht in genau
// einer der ueber publicState veroeffentlichten Client-Listen.
const assert = require('assert');
const {
  ALL_CARDS, isInstantLevelUpCard, DOOR_POWER_CARDS, isCombatPotionCard,
  ROLL_REACTION_CARDS, TREASURE_POWER_CARD_NAMES, COMBAT_POTION_CARD_NAMES,
} = require('../server.js');

const treasurePowerCards = new Set(TREASURE_POWER_CARD_NAMES);
const combatPotionCards = new Set(COMBAT_POTION_CARD_NAMES);
const rollReactionCards = new Set(ROLL_REACTION_CARDS);

// --- Vollstaendigkeit: keine Karte fehlt in ihrer Liste --------------------
{
  const fehlend = ALL_CARDS.filter((c) => (isInstantLevelUpCard(c) || DOOR_POWER_CARDS[c.name] !== undefined)
    && !treasurePowerCards.has(c.name)).map((c) => c.name);
  assert.deepStrictEqual(fehlend, [], `Sofortkraft-Karten (Schatz/Tuer) fehlen in treasurePowerCards: ${fehlend.join(', ')}`);
}
{
  const fehlend = ALL_CARDS.filter((c) => isCombatPotionCard(c) && !combatPotionCards.has(c.name)).map((c) => c.name);
  assert.deepStrictEqual(fehlend, [], `Kampf-Traenke fehlen in combatPotionCards: ${fehlend.join(', ')}`);
}

// --- Exklusivitaet: keine Karte in mehr als einer Liste - sonst waere
// "genau eine" verletzt und der Client muesste raten, welcher Knopf gilt. ---
{
  const inMehreren = [...treasurePowerCards].filter((n) => combatPotionCards.has(n) || rollReactionCards.has(n))
    .concat([...combatPotionCards].filter((n) => rollReactionCards.has(n)));
  assert.deepStrictEqual(inMehreren, [], `Karten stehen in mehr als einer veroeffentlichten Liste: ${inMehreren.join(', ')}`);
}

// --- Stichprobe: genau die Karten aus dem Audit (Abschnitt A), die bisher
// ohne Knopf tot auf der Hand lagen. ----------------------------------------
['HEIMSE DIE LORBEEREN EIN', 'EINHEITSGRÖSSE', 'DAS DUNGEON-CASINO', 'EINSTWEILIGE VERFÜGUNG', 'DER ANDERE RING']
  .forEach((name) => assert.ok(treasurePowerCards.has(name), `${name} fehlt in treasurePowerCards`));

['MONSTERFUTTER', 'SCHARFE PFEFFERSOSSE', 'DEUS EX MASCHINENGEWEHR', 'TRANK DER APATHIE',
  'NIMM MICH! NIMM MICH!', 'HALBFINAL-SCHLAG']
  .forEach((name) => assert.ok(combatPotionCards.has(name), `${name} fehlt in combatPotionCards`));

assert.ok(rollReactionCards.has('KATZENINTERVENTION'), 'KATZENINTERVENTION fehlt in rollReactionCards');
assert.ok(rollReactionCards.has('GEZINKTER WÜRFEL'), 'GEZINKTER WÜRFEL fehlt in rollReactionCards');

console.log('card-clerical-ui: ok');
