// Unnatural Axe, Monsterkarten (Plan 2026-09-16, Spec gleichen Datums).
//
// Gemessen wird jeweils die DIFFERENZ der Monsterstaerke mit und ohne das
// genannte Merkmal - ein absoluter Wert waere auch dann gruen, wenn das
// Monster aus einem anderen Grund staerker ist.
const assert = require('assert');
const {
  ALL_CARDS, newEquipped, combatTotals,
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
    isBot: false, connected: true, gender: 'm', genderBeiSlippern: null,
  }, overrides || {});
}

const raeume = [];
function makeRoom(players) {
  const room = {
    code: 'TEST', players, turnIndex: 0, turnPhase: 'kampf',
    doorDeck: [], doorDiscard: [], treasureDeck: [], treasureDiscard: [],
    itemAttachments: {}, logs: [], combat: null, combatHappenedThisTurn: false,
    pendingConsequence: null, pendingCardAction: null, pendingRoll: null,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  };
  raeume.push(room);
  return room;
}

// Monsterstaerke gegen genau eine Person.
function monsterStaerke(monsterName, player, mitMonstern) {
  const m = findCard(monsterName, 'monster');
  const room = makeRoom([player]);
  room.combat = {
    actorId: player.id, helperId: null,
    monsterIds: [m.id].concat(mitMonstern || []),
    actorModifier: 0, monsterModifier: 0, backstabs: {},
  };
  return combatTotals(room).monsterStrength;
}

const ORK = findCard('ORK', 'door_other');
const ELF = findCard('ELF', 'race');
const ZWERG = findCard('ZWERG', 'race');
const DIEB = findCard('DIEB', 'class');
const ZAUBERER = findCard('ZAUBERER', 'class');
const KRIEGER = findCard('KRIEGER', 'class');
const PRIESTER = findCard('PRIESTER', 'class');

// --- Einfache Monsterboni ---------------------------------------------------
[
  ['KATZENMÄDCHEN', { races: [ORK.id] }, 5],
  ['TEDDYBÄR', { races: [ORK.id] }, 5],
  ['JUDGE FREDD', { classes: [DIEB.id] }, 5],
  ['M.T.-ANZUG', { classes: [ZAUBERER.id] }, 5],
  ['M.T.-ANZUG', { classes: [DIEB.id] }, 5],
  ['DING MIT EINEM ÜBERLANGEN NAMEN, DESSEN BILD NICHT AUF DIE KARTE PASST', { classes: [KRIEGER.id] }, 5],
  ['TENTAKELDÄMON', { classes: [PRIESTER.id] }, 5],
  ['ROTZ-ELEMENTAR', { races: [ELF.id] }, 4],
  ['JABBERWOCK', { races: [ZWERG.id] }, 3],
  ['JABBERWOCK', { classes: [ZAUBERER.id] }, 3],
  ['WEIHNACHTSMANN', { races: [ELF.id] }, -5],
].forEach(([monster, merkmal, erwartet]) => {
  const ohne = monsterStaerke(monster, makePlayer({}));
  const mit = monsterStaerke(monster, makePlayer(merkmal));
  assert.strictEqual(mit - ohne, erwartet,
    `${monster}: erwartet ${erwartet}, gemessen ${mit - ohne}`);
});

// "+3 gegen Zwerge oder Zauberer. Ja, das macht +6 gegen Zwergenzauberer."
{
  const ohne = monsterStaerke('JABBERWOCK', makePlayer({}));
  const beides = monsterStaerke('JABBERWOCK', makePlayer({ races: [ZWERG.id], classes: [ZAUBERER.id] }));
  assert.strictEqual(beides - ohne, 6, 'Zwergenzauberer bekommen beide Boni');
}

// "+5 gegen Zauberer oder Diebe" nennt KEINE Addition - ein Zauberer-Dieb
// bekommt den Bonus genau einmal.
{
  const ohne = monsterStaerke('M.T.-ANZUG', makePlayer({}));
  const beides = monsterStaerke('M.T.-ANZUG', makePlayer({ classes: [ZAUBERER.id, DIEB.id] }));
  assert.strictEqual(beides - ohne, 5, 'der Anzug addiert nicht');
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-unnatural-monsters: ok');
