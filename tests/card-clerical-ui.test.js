// Clerical Errors, Task 1 (Plan 2026-09-14-clerical-errors-audit.md): der
// Client pflegte handkopierte Namenslisten der Server-Tabellen, die
// auseinandergedriftet sind - 13 Karten lagen serverseitig fertig, aber ohne
// Knopf tot auf der Hand. Kein einziger Test hat das gesehen, weil alle
// Zusicherungen an der Modulgrenze von server.js endeten.
//
// Deshalb prueft dieser Test die BEIDEN Enden der Strecke, nicht die Tabelle
// in der Mitte:
//   1. was publicState() tatsaechlich verschickt (nicht die Konstante, aus
//      der es gebaut wird - die gegen sich selbst zu pruefen ist zirkulaer),
//   2. dass public/client.js dieses Feld auch wirklich liest.
// Faellt eines der beiden weg, verschwindet der Knopf im Browser - und genau
// dann muss dieser Test rot werden.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  ROLL_REACTION_CARDS, publicState, createRoom,
} = require('../server.js');

const room = createRoom();
clearTimeout(room.cleanupTimer); // sonst haelt der Aufraeum-Timer den Testprozess offen
const state = publicState(room);

// --- 1. Die Nutzlast, die der Client bekommt ------------------------------
const listen = ['treasurePowerCards', 'combatPotionCards', 'rollReactionCards', 'rollRerollCards'];
listen.forEach((key) => {
  assert.ok(Array.isArray(state[key]), `publicState verschickt ${key} nicht als Liste`);
  assert.ok(state[key].length > 0, `publicState verschickt ${key} leer - im Browser erscheint kein Knopf`);
});

// --- 2. Der Client liest sie auch (Kommentare zaehlen nicht: client.js
// erwaehnt die Feldnamen auch im Kommentarblock ueber hasCardPower) --------
const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\n]*?\/\/.*$/gm, (zeile) => zeile.replace(/\/\/.*$/, ''));
listen.forEach((key) => {
  // Kein blosses includes(): "state.treasurePowerCardsXX" enthaelt den
  // kurzen Namen als Teilstring und liesse eine Umbenennung durchrutschen.
  const stelle = clientSrc.indexOf(`state.${key}`);
  const danach = stelle < 0 ? 'x' : (clientSrc[stelle + key.length + 6] || ' ');
  assert.ok(stelle >= 0 && !/[A-Za-z0-9_$]/.test(danach), `public/client.js liest state.${key} nicht (mehr)`);
});

// --- 3. Genau die Karten aus dem Audit (Abschnitt A), die ohne Knopf tot
// auf der Hand lagen - geprueft an der verschickten Liste. -----------------
['HEIMSE DIE LORBEEREN EIN', 'EINHEITSGRÖSSE', 'DAS DUNGEON-CASINO', 'EINSTWEILIGE VERFÜGUNG', 'DER ANDERE RING']
  .forEach((name) => assert.ok(state.treasurePowerCards.includes(name), `${name} wird nicht an den Client geschickt`));

['MONSTERFUTTER', 'SCHARFE PFEFFERSOSSE', 'DEUS EX MASCHINENGEWEHR', 'TRANK DER APATHIE',
  'NIMM MICH! NIMM MICH!', 'HALBFINAL-SCHLAG']
  .forEach((name) => assert.ok(state.combatPotionCards.includes(name), `${name} wird nicht an den Client geschickt`));

['KATZENINTERVENTION', 'GEZINKTER WÜRFEL']
  .forEach((name) => assert.ok(state.rollReactionCards.includes(name), `${name} wird nicht an den Client geschickt`));
assert.deepStrictEqual([...ROLL_REACTION_CARDS].sort(), [...state.rollReactionCards].sort(),
  'die verschickte Liste weicht von ROLL_REACTION_CARDS ab');

// --- 4. Exklusivitaet: keine Karte in mehr als einer Liste - sonst muesste
// der Client raten, welcher Knopf gilt. ------------------------------------
{
  const [schatz, trank, wurf] = [state.treasurePowerCards, state.combatPotionCards, state.rollReactionCards].map((l) => new Set(l));
  const inMehreren = [...schatz].filter((n) => trank.has(n) || wurf.has(n))
    .concat([...trank].filter((n) => wurf.has(n)));
  assert.deepStrictEqual(inMehreren, [], `Karten stehen in mehr als einer veroeffentlichten Liste: ${inMehreren.join(', ')}`);
}

console.log('card-clerical-ui: ok');
