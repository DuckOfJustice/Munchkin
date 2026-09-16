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
  ROLL_REACTION_CARDS, publicState, createRoom, halblingSaleOpen, ALL_CARDS,
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
// EINSTWEILIGE VERFÜGUNG steht in DEAKTIVIERTE_KARTEN und kommt derzeit in
// keinem Deck vor - die Verdrahtung wird trotzdem mitgeprueft, damit sie beim
// Reaktivieren nicht stillschweigend kaputt ist.
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

// --- 5. HALBLING "1 Gegenstand pro Runde zum doppelten Preis": der Server
// rechnet den Bonus in handleSellItems, der Client muss ihn in der
// Verkaufsleiste MITRECHNEN - sonst bleibt der Verkaufen-Knopf grau, obwohl
// der Server den Verkauf annehmen wuerde (genau der Fall, fuer den die
// Rassenkraft da ist: unter 1000 Rohwert trotzdem eine Stufe).
//
// Geprueft wird das VERHALTEN, nicht der Quelltext: eine Namenssuche wuerde
// ein Zurueckdrehen der Knopf-Bedingung auf den Rohwert nicht bemerken.
// updateSellBar wird deshalb aus client.js ausgeschnitten und mit Attrappen
// ausgefuehrt - einen DOM braucht die Funktion dafuer nicht.
{
  // Die Regel selbst - Server und Verkaufsleiste haengen an dieser Funktion.
  const halblingId = ALL_CARDS.find((c) => c.name === 'HALBLING' && c.category === 'race').id;
  assert.strictEqual(halblingSaleOpen({ races: [] }), false, 'ohne Halbling keine Verdopplung');
  assert.strictEqual(halblingSaleOpen({ races: [halblingId] }), true, 'Halbling: Verdopplung offen');
  assert.strictEqual(halblingSaleOpen({ races: [halblingId], halblingSaleUsed: true }), false,
    'einmal pro Runde - danach zu');

  const roh = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
  const anfang = roh.indexOf('function updateSellBar()');
  assert.ok(anfang >= 0, 'updateSellBar nicht in client.js gefunden');
  // Bis zur schliessenden Klammer der Funktion zaehlen.
  let tiefe = 0; let ende = -1;
  for (let i = roh.indexOf('{', anfang); i < roh.length; i++) {
    if (roh[i] === '{') tiefe++;
    else if (roh[i] === '}') { tiefe--; if (!tiefe) { ende = i + 1; break; } }
  }
  assert.ok(ende > anfang, 'Funktionsende nicht gefunden');
  const quelle = roh.slice(anfang, ende);

  function verkaufsleiste({ halblingSaleOpen: offen, goldwerte }) {
    const hand = goldwerte.map((g, i) => `k${i}`);
    const golds = {};
    goldwerte.forEach((g, i) => { golds[`k${i}`] = g; });
    const knopf = { disabled: null, onclick: null };
    const anzeige = { textContent: '' };
    const bauer = new Function('myInfo', 'sellSelection', 'card', '$', 'darfVerkaufen', 'socket',
      `${quelle}; return updateSellBar;`);
    bauer(
      { hand, halblingSaleOpen: offen },
      new Set(hand),
      (id) => ({ gold: golds[id] }),
      (id) => (id === 'btnSell' ? knopf : anzeige),
      () => true,
      { emit() {} },
    )();
    return { knopf, text: anzeige.textContent };
  }

  const halbling = verkaufsleiste({ halblingSaleOpen: true, goldwerte: [600] });
  assert.strictEqual(halbling.knopf.disabled, false,
    'Halbling mit 600 Gold: der Server nimmt den Verkauf an (1200), der Knopf muss klickbar sein');
  assert.ok(/1200/.test(halbling.text), `der verdoppelte Wert muss dastehen, war: "${halbling.text}"`);

  const mensch = verkaufsleiste({ halblingSaleOpen: false, goldwerte: [600] });
  assert.strictEqual(mensch.knopf.disabled, true, 'ohne Verdopplung reichen 600 Gold nicht');

  const verbraucht = verkaufsleiste({ halblingSaleOpen: false, goldwerte: [600, 300] });
  assert.strictEqual(verbraucht.knopf.disabled, true, '900 Gold ohne Bonus reichen nicht');
  const nochOffen = verkaufsleiste({ halblingSaleOpen: true, goldwerte: [600, 300] });
  assert.strictEqual(nochOffen.knopf.disabled, false, '900 + 600 Bonus reichen');

  assert.strictEqual(verkaufsleiste({ halblingSaleOpen: true, goldwerte: [] }).knopf.disabled, true,
    'leere Auswahl bleibt gesperrt');
}

console.log('card-clerical-ui: ok');
