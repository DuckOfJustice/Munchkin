// Clerical Errors, Task 2 (Plan 2026-09-13): Monsterboni und Dauerwirkungen.
//
// Neu an MONSTER_TRAIT_BONUS sind drei Schreibweisen, die das Basis-Set nicht
// brauchte: negative Boni ("-3 gegen Barden"), mehrere Boni pro Karte
// ("+5 gegen Orks, +5 gegen Krieger") und Bedingungen, die keine Rasse und
// keine Klasse sind (RÜSSELKÄFER: "keine Klasse", GOTHYANKI: die
// Obergrenzen-Karten, KALI: "mindestens 2 eigene Waffen").
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, combatTotals, monsterRefusesTarget, monsterPassOption,
  fleeModifierParts, fleeIsAutomatic, UNDEAD_MONSTERS, MONSTER_IGNORES_BONUSES,
} = require('../server.js');

function findCard(name, category) {
  const c = ALL_CARDS.find((x) => x.name === name && (!category || x.category === category));
  if (!c) throw new Error(`Testkarte nicht gefunden: ${name}`);
  return c;
}

function makePlayer(overrides) {
  return Object.assign({
    id: 'p1', name: 'A', level: 5, hand: [], races: [], classes: [], powerGroups: [],
    raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), attachments: { cheatedItemId: null }, activeCurses: [],
    isBot: false, connected: true,
  }, overrides || {});
}

function makeRoom(players) {
  return {
    code: 'TEST', players, turnIndex: 0, turnPhase: 'kampf',
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
    logs: [], combat: null, combatHappenedThisTurn: false,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  };
}

// Monsterstaerke gegen genau eine Person - einmal mit, einmal ohne Merkmal.
function monsterStaerke(monsterName, player) {
  const m = findCard(monsterName, 'monster');
  const room = makeRoom([player]);
  room.combat = {
    actorId: player.id, helperId: null, monsterIds: [m.id],
    actorModifier: 0, monsterModifier: 0, backstabbed: {},
  };
  return combatTotals(room).monsterStrength;
}

const BARDE = findCard('BARDE', 'door_other');
const ORK = findCard('ORK', 'door_other');
const ELF = findCard('ELF', 'race');
const KRIEGER = findCard('KRIEGER', 'class');
const PRIESTER = findCard('PRIESTER', 'class');
const ZAUBERER = findCard('ZAUBERER', 'class');

// --- Einfache neue Zeilen ---------------------------------------------------
[
  ['TEQUILA-LIEDCHEN', { classes: [BARDE.id] }, 5],
  ['DOPPELGANGSTER', { classes: [BARDE.id] }, 3],
  ['Harter Typ', { races: [ORK.id] }, 5],
  ['DIE TROLLE VOM TOTEN MEER', { races: [ELF.id] }, 5],
  ['MEDUSA', { races: [ELF.id] }, 4],
  ['SIEBENJÄHRIGER LICH', { classes: [KRIEGER.id] }, 5],
  ['TANTE PALADIN', { classes: [PRIESTER.id] }, 5],
  // Negative Boni: das Monster wird SCHWAECHER.
  ['DRECKIGE GÄNSE', { classes: [BARDE.id] }, -3],
  ['GIFTEFEU KUDZU-FLIEGENFALLE', { races: [ELF.id] }, -4],
].forEach(([name, merkmal, erwartet]) => {
  const ohne = monsterStaerke(name, makePlayer({}));
  const mit = monsterStaerke(name, makePlayer(merkmal));
  assert.strictEqual(mit - ohne, erwartet, `${name}: erwartet ${erwartet}`);
});

// --- Mehrere Boni auf einer Karte ------------------------------------------
{
  // REDNECK-BAUM: "+5 gegen Orks, +5 gegen Krieger."
  const ohne = monsterStaerke('REDNECK-BAUM', makePlayer({}));
  assert.strictEqual(monsterStaerke('REDNECK-BAUM', makePlayer({ races: [ORK.id] })) - ohne, 5);
  assert.strictEqual(monsterStaerke('REDNECK-BAUM', makePlayer({ classes: [KRIEGER.id] })) - ohne, 5);
  assert.strictEqual(monsterStaerke('REDNECK-BAUM', makePlayer({ races: [ORK.id], classes: [KRIEGER.id] })) - ohne, 10,
    'beide Merkmale addieren sich');

  // FEDERFEIND: "+5 gegen Priester und +3 gegen Zauberer."
  const ohneF = monsterStaerke('FEDERFEIND', makePlayer({}));
  assert.strictEqual(monsterStaerke('FEDERFEIND', makePlayer({ classes: [PRIESTER.id] })) - ohneF, 5);
  assert.strictEqual(monsterStaerke('FEDERFEIND', makePlayer({ classes: [ZAUBERER.id] })) - ohneF, 3);
}

// --- Bedingungen jenseits von Rasse/Klasse ---------------------------------
{
  // RÜSSELKÄFER: "+3 gegen die, die keine Klasse haben."
  const ohneKlasse = monsterStaerke('RÜSSELKÄFER', makePlayer({}));
  const mitKlasse = monsterStaerke('RÜSSELKÄFER', makePlayer({ classes: [KRIEGER.id] }));
  assert.strictEqual(ohneKlasse - mitKlasse, 3, 'Klassenlose bekommen +3 ab');

  // GOTHYANKI: "+5 gegen Super-Munchkins oder Mischlinge. +10 gegen beide."
  const superM = findCard('SUPER MUNCHKIN', 'door_other');
  const halbB = findCard('HALB-BLUT', 'door_other');
  const basis = monsterStaerke('GOTHYANKI', makePlayer({}));
  assert.strictEqual(monsterStaerke('GOTHYANKI', makePlayer({ classCapCard: superM.id })) - basis, 5);
  assert.strictEqual(monsterStaerke('GOTHYANKI', makePlayer({ raceCapCard: halbB.id })) - basis, 5);
  assert.strictEqual(monsterStaerke('GOTHYANKI', makePlayer({ classCapCard: superM.id, raceCapCard: halbB.id })) - basis, 10,
    'beide Karten geben zusammen +10');

  // KALI: "+5 gegen Priester. ... zusaetzlich +5, es sei denn, du
  // verteidigst dich mit (mindestens) 2 eigenen Waffen."
  const waffe = findCard('VORPALE KLINGE');
  const zweite = findCard('GHOULPEITSCHE');
  const ohneWaffen = makePlayer({});
  const mitWaffen = makePlayer({});
  mitWaffen.equipped.hands = [waffe.id, zweite.id];
  assert.strictEqual(monsterStaerke('KALI', ohneWaffen) - monsterStaerke('KALI', mitWaffen), 5,
    'zwei Waffen nehmen Kali die Extra-5');
}

// --- Weitere Dauerwirkungen -------------------------------------------------
{
  const lich = findCard('SIEBENJÄHRIGER LICH', 'monster');
  assert.ok(monsterRefusesTarget(lich.id, makePlayer({ level: 2 })), 'Lich greift Stufe 2 nicht an');
  assert.ok(!monsterRefusesTarget(lich.id, makePlayer({ level: 3 })), 'ab Stufe 3 aber schon');
  assert.ok(UNDEAD_MONSTERS.has('SIEBENJÄHRIGER LICH'), 'Lich ist untot (Priester "Vertreiben")');

  // GUMMI-GOLEM: "du kannst nur auf deiner Stufe kaempfen, ohne weitere Boni."
  assert.ok(MONSTER_IGNORES_BONUSES.has('GUMMI-GOLEM'));
  const golem = findCard('GUMMI-GOLEM', 'monster');
  const helm = findCard('GEILER HELM');
  const p = makePlayer({ level: 7 });
  p.equipped.head = helm.id;
  const room = makeRoom([p]);
  room.combat = {
    actorId: p.id, helperId: null, monsterIds: [golem.id],
    actorModifier: 0, monsterModifier: 0, backstabbed: {},
  };
  assert.strictEqual(combatTotals(room).playerStrength, 7, 'gegen den Gummi-Golem zaehlt nur die Stufe');

  // BOBBELKOPF: nur Elfen duerfen ihn einfach abwerfen.
  const bobbel = findCard('BOBBELKOPF', 'monster');
  assert.ok(monsterPassOption(bobbel.id, makePlayer({ races: [ELF.id] })), 'Elf darf vorbeigehen');
  assert.strictEqual(monsterPassOption(bobbel.id, makePlayer({})), null, 'alle anderen muessen kaempfen');

  // DIE TROLLE VOM TOTEN MEER: "Jeder erhaelt +1 auf Weglaufen."
  const trolle = findCard('DIE TROLLE VOM TOTEN MEER', 'monster');
  const fleeRoom = makeRoom([makePlayer({})]);
  fleeRoom.combat = { actorId: 'p1', helperId: null, monsterIds: [trolle.id], actorModifier: 0, monsterModifier: 0 };
  const teile = fleeModifierParts(fleeRoom, fleeRoom.players[0]);
  assert.strictEqual(teile.reduce((s, x) => s + x.amount, 0), 1, 'Trolle geben +1 auf Weglaufen');

  // GOLDFISCH: "Greift nicht an und du fliehst automatisch."
  const fisch = findCard('GOLDFISCH', 'monster');
  const fischRoom = makeRoom([makePlayer({})]);
  fischRoom.combat = { actorId: 'p1', monsterIds: [fisch.id] };
  assert.ok(fleeIsAutomatic(fischRoom, fischRoom.players[0]), 'vor dem Goldfisch flieht man automatisch');
}

console.log('card-clerical-monsters: ok');

// --- Nachtraege aus dem Review (2026-09-14) ---------------------------------
// Alle drei Faelle waren gruen, weil niemand sie gefragt hat: negative Boni
// mit Kappen-Karte, eine "du"-Bedingung mit Helfer:in, und ein Monster, dessen
// eigener Text es untot nennt.
{
  // SUPER MUNCHKIN/HALB-BLUT: "alle Vorteile, aber keine Nachteile" - ein
  // NEGATIVER Monsterbonus ist ein Vorteil und darf nicht mit weggekappt
  // werden, sonst ist die Kappen-Karte schlechter als gar keine.
  const superM = findCard('SUPER MUNCHKIN', 'door_other');
  const halbB = findCard('HALB-BLUT', 'door_other');
  const basisG = monsterStaerke('DRECKIGE GÄNSE', makePlayer({}));
  assert.strictEqual(
    monsterStaerke('DRECKIGE GÄNSE', makePlayer({ classes: [BARDE.id], classCapCard: superM.id })) - basisG, -3,
    'der Super-Barde behaelt die -3 gegen die dreckigen Gaense');
  const basisK = monsterStaerke('GIFTEFEU KUDZU-FLIEGENFALLE', makePlayer({}));
  assert.strictEqual(
    monsterStaerke('GIFTEFEU KUDZU-FLIEGENFALLE', makePlayer({ races: [ELF.id], raceCapCard: halbB.id })) - basisK, -4,
    'der Halb-Elf behaelt die -4');
  // Der Nachteil bleibt dagegen gekappt: +5 gegen Priester zieht bei einem
  // Super-Munchkin mit genau einer Klasse nicht.
  assert.strictEqual(
    monsterStaerke('TANTE PALADIN', makePlayer({ classes: [PRIESTER.id], classCapCard: superM.id }))
    - monsterStaerke('TANTE PALADIN', makePlayer({})), 0,
    'positive Monsterboni kappt SUPER MUNCHKIN weiterhin');

  // KALI: "es sei denn, DU verteidigst dich mit 2 eigenen Waffen" - die
  // Waffen der Helfer:in zaehlen nicht, und ihre leeren Haende duerfen das
  // Monster nicht staerker machen (sonst bestraft Hilfe die kaempfende Person).
  const waffe = findCard('VORPALE KLINGE');
  const zweite = findCard('GHOULPEITSCHE');
  const kali = findCard('KALI', 'monster');
  function kaliMitHelfer(kaempferWaffen, helferWaffen) {
    const a = makePlayer({ id: 'pA' });
    const b = makePlayer({ id: 'pB', name: 'B' });
    a.equipped.hands = kaempferWaffen;
    b.equipped.hands = helferWaffen;
    const room = makeRoom([a, b]);
    room.combat = {
      actorId: a.id, helperId: b.id, monsterIds: [kali.id],
      actorModifier: 0, monsterModifier: 0, backstabbed: {},
    };
    return combatTotals(room).monsterStrength;
  }
  assert.strictEqual(kaliMitHelfer([waffe.id, zweite.id], []), kaliMitHelfer([waffe.id, zweite.id], [waffe.id, zweite.id]),
    'die Haende der Helfer:in aendern an Kali nichts');
  assert.strictEqual(kaliMitHelfer([], []) - kaliMitHelfer([waffe.id, zweite.id], []), 5,
    'nur die Bewaffnung der kaempfenden Person nimmt Kali die Extra-5');

  // DIE SCHATTENNASE: "... funktioniert auch fuer ihren Untoten Schatten" -
  // das einzige Monster im ganzen Spiel, dessen Text "untot" sagt. Ohne den
  // Eintrag liefen Priester-"Vertreiben" und GHOULPEITSCHE ins Leere.
  assert.ok(UNDEAD_MONSTERS.has('DIE SCHATTENNASE'), 'der Schatten ist untot');
}
