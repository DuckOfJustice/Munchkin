// Task 11 (Plan 2026-09-12): zwei Teilwirkungen, die bisher stillschweigend
// fehlten.
//
//  1) SUPER MUNCHKIN / HALB-BLUT, zweite Kartenhaelfte: "Oder du darfst 1
//     Klassenkarte haben und hast alle Vorteile aber KEINE Nachteile der
//     Klasse (z.B. Monster, die Priester hassen, werden diesen Bonus nicht
//     gegen einen Super Priester haben)." Bisher wirkte nur die
//     Obergrenzen-Haelfte (2 statt 1 Merkmal).
//  2) VERSTUEMMLE DIE LEICHEN: "Diese Karte darf nur nach einem Kampf
//     ausgespielt werden, aber es muss nicht dein Kampf gewesen sein."
//     Bisher jederzeit spielbar.
const assert = require('assert');
const {
  ALL_CARDS, combatTotals, newEquipped, handleUseCardPower,
} = require('../server.js');

function byName(n) { const c = ALL_CARDS.find((x) => x.name === n); assert.ok(c, n); return c; }

function makePlayer(id, extra) {
  return Object.assign({
    id, name: id.toUpperCase(), level: 5, hand: [], races: [], classes: [],
    powerGroups: [], raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), attachments: { cheatedItemId: null }, activeCurses: [],
    isBot: false, connected: true,
  }, extra || {});
}

// Der Kampf wird hier direkt gestellt, statt ihn ueber handleDrawDoor zu
// erzeugen - combatTotals liest nur room.combat und die Spielerfelder.
function raumMit(p, monsterName) {
  const m = byName(monsterName);
  return {
    code: 'T', players: [p], turnIndex: 0, doorDiscard: [], treasureDiscard: [],
    logs: [], combatHappenedThisTurn: false,
    combat: {
      actorId: p.id, helperId: null, monsterIds: [m.id], actorModifier: 0,
      monsterModifier: 0, mustFlee: false, ready: {},
    },
  };
}

// touchRoom setzt einen 3-Stunden-Timer, der den Testlauf sonst offen haelt.
function done(room) { clearTimeout(room.cleanupTimer); clearTimeout(room.botTimer); }

function run() {
  const priester = byName('PRIESTER');
  const krieger = byName('KRIEGER');
  const elf = byName('ELF');
  const superM = byName('SUPER MUNCHKIN');
  const halbblut = byName('HALB-BLUT');

  // ------------------------------------------------------------------
  // 1) SUPER MUNCHKIN: Klassen-Nachteil (+4 gegen Priester)
  // ------------------------------------------------------------------
  {
    const p = makePlayer('a', { classes: [priester.id] });
    assert.strictEqual(combatTotals(raumMit(p, 'ZUNGENDÄMON')).monsterStrength, 12 + 4,
      'normaler Priester kassiert den Malus');
  }
  {
    const p = makePlayer('a', { classes: [priester.id], classCapCard: superM.id });
    assert.strictEqual(combatTotals(raumMit(p, 'ZUNGENDÄMON')).monsterStrength, 12,
      'Super-Priester hat alle Vorteile, aber keine Nachteile');
  }
  {
    const p = makePlayer('a', { classes: [priester.id, krieger.id], classCapCard: superM.id });
    assert.strictEqual(combatTotals(raumMit(p, 'ZUNGENDÄMON')).monsterStrength, 12 + 4,
      'zwei Klassen heisst alle Vor- UND Nachteile');
  }

  // ------------------------------------------------------------------
  // 2) HALB-BLUT: derselbe Zweig fuer Rassen (LEPRACHAUN +5 gegen Elfen)
  // ------------------------------------------------------------------
  {
    const p = makePlayer('a', { races: [elf.id] });
    assert.strictEqual(combatTotals(raumMit(p, 'LEPRACHAUN')).monsterStrength, 4 + 5,
      'normaler Elf kassiert den Malus');
  }
  {
    const p = makePlayer('a', { races: [elf.id], raceCapCard: halbblut.id });
    assert.strictEqual(combatTotals(raumMit(p, 'LEPRACHAUN')).monsterStrength, 4,
      'Halb-Elf mit genau einer Rasse hat keine Nachteile');
  }

  // Die Immunitaet gilt getrennt je Merkmal: eine Cap-Karte fuer Klassen
  // schuetzt nicht vor einem Rassen-Malus.
  {
    const p = makePlayer('a', { races: [elf.id], classes: [priester.id], classCapCard: superM.id });
    assert.strictEqual(combatTotals(raumMit(p, 'LEPRACHAUN')).monsterStrength, 4 + 5,
      'Super-Munchkin schuetzt nicht vor dem Rassen-Malus');
  }

  // Ein immuner Angreifer schuetzt nicht die Helferin: der Bonus gilt einmal
  // pro Monster, sobald IRGENDWER auf der Munchkin-Seite das Merkmal hat.
  {
    const a = makePlayer('a', { classes: [priester.id], classCapCard: superM.id });
    const b = makePlayer('b', { classes: [priester.id] });
    const room = raumMit(a, 'ZUNGENDÄMON');
    room.players.push(b);
    room.combat.helperId = b.id;
    assert.strictEqual(combatTotals(room).monsterStrength, 12 + 4,
      'die nicht immune Helferin zieht den Malus weiter');
  }

  // ------------------------------------------------------------------
  // 3) VERSTUEMMLE DIE LEICHEN nur nach einem Kampf
  // ------------------------------------------------------------------
  const verstuemmle = byName('VERSTÜMMLE DIE LEICHEN');
  {
    const p = makePlayer('a', { hand: [verstuemmle.id] });
    const room = raumMit(p, 'ZUNGENDÄMON');
    room.combat = null;
    room.combatHappenedThisTurn = false;
    handleUseCardPower(room, p.id, verstuemmle.id);
    assert.strictEqual(p.level, 5, 'ohne Kampf keine Stufe');
    assert.ok(p.hand.includes(verstuemmle.id), 'Karte bleibt auf der Hand');
    assert.ok(!room.treasureDiscard.includes(verstuemmle.id), 'Karte wird nicht abgelegt');
    done(room);
  }
  {
    const p = makePlayer('a', { hand: [verstuemmle.id] });
    const room = raumMit(p, 'ZUNGENDÄMON');
    room.combat = null;
    room.combatHappenedThisTurn = true;
    handleUseCardPower(room, p.id, verstuemmle.id);
    assert.strictEqual(p.level, 6, 'nach einem Kampf steigt die Stufe');
    assert.ok(!p.hand.includes(verstuemmle.id), 'Karte ist gespielt');
    assert.ok(room.treasureDiscard.includes(verstuemmle.id), 'Karte liegt im Ablagestapel');
    done(room);
  }

  console.log('OK - Super Munchkin/Halb-Blut ohne Nachteile, Verstuemmle nur nach einem Kampf.');
}

run();
