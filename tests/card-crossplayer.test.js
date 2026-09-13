// Warteschlange fuer Aktionen, die MEHRERE Spieler nacheinander betreffen,
// plus der generische Bot-Aufloeser. Ohne den bliebe die Partie stehen,
// sobald ein Bot an der Reihe ist.
const assert = require('assert');
const {
  playerQueueFrom, openQueuedCardAction, handleResolveCardChoice, handleResolveCardTarget, newEquipped,
} = require('../server.js');

function makePlayer(id, extra) {
  return Object.assign({
    id, name: id.toUpperCase(), level: 5, hand: [], races: [], classes: [],
    powerGroups: [], raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), isBot: false, connected: true,
  }, extra || {});
}

function makeRoom(players, turnIndex) {
  return {
    code: 'TEST', players, turnIndex: turnIndex || 0, doorDiscard: [],
    treasureDiscard: [], logs: [], combat: null, pendingCardAction: null,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  };
}

// 1) Reihenfolgen - jede Karte sagt etwas anderes
{
  const ps = ['a', 'b', 'c', 'd'].map((x, i) => makePlayer(x, { level: i + 1 }));
  const room = makeRoom(ps, 1); // B ist am Zug
  const b = ps[1];

  assert.deepStrictEqual(playerQueueFrom(room, b, 'after'), ['c', 'd', 'a'],
    'ANWALT: "beginnend mit dem Spieler NACH dir"');
  assert.deepStrictEqual(playerQueueFrom(room, b, 'before'), ['a', 'd', 'c'],
    'HIPPOGREIF: "beginnend mit dem Spieler VOR dir"');
  assert.deepStrictEqual(playerQueueFrom(room, b, 'neighbours'), ['a', 'c'],
    'LEPRACHAUN: nur die beiden Nachbarn');
  assert.deepStrictEqual(playerQueueFrom(room, b, 'topLevel'), ['d'],
    'NETZ-TROLL: nur die hoechststufigen, unabhaengig von der Sitzordnung');
  assert.deepStrictEqual(playerQueueFrom(room, b, 'allOthers'), ['a', 'c', 'd'],
    'EINKOMMENSSTEUER: alle anderen');

  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
}

// 2) Gleichstand bei topLevel trifft alle Betroffenen
{
  const ps = [makePlayer('a', { level: 9 }), makePlayer('b', { level: 3 }),
              makePlayer('c', { level: 9 })];
  const room = makeRoom(ps, 1);
  assert.deepStrictEqual(playerQueueFrom(room, ps[1], 'topLevel').slice().sort(), ['a', 'c'],
    'bei Stufengleichstand nehmen beide je einen Gegenstand');

  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
}

// 3) Die Warteschlange rueckt vor und raeumt am Ende ab
{
  const ps = ['a', 'b', 'c'].map((x) => makePlayer(x));
  const room = makeRoom(ps, 0);
  const gesehen = [];
  openQueuedCardAction(room, 'TESTKARTE', ['b', 'c'], (pid) => {
    gesehen.push(pid);
    return { kind: 'choice', options: [{ id: 'ok', label: 'Ok', action: { type: 'noEffect' } }] };
  });
  assert.strictEqual(room.pendingCardAction.playerId, 'b', 'erst B');
  handleResolveCardChoice(room, 'b', 'ok');
  assert.strictEqual(room.pendingCardAction.playerId, 'c', 'dann C');
  handleResolveCardChoice(room, 'c', 'ok');
  assert.strictEqual(room.pendingCardAction, null, 'danach abgeraeumt');
  assert.deepStrictEqual(gesehen, ['b', 'c']);

  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
}

// 4) Eine fremde Person kann die Aktion nicht wegklicken
{
  const ps = ['a', 'b'].map((x) => makePlayer(x));
  const room = makeRoom(ps, 0);
  openQueuedCardAction(room, 'TESTKARTE', ['b'], () => ({
    kind: 'choice', options: [{ id: 'ok', label: 'Ok', action: { type: 'noEffect' } }],
  }));
  handleResolveCardChoice(room, 'a', 'ok');
  assert.strictEqual(room.pendingCardAction.playerId, 'b',
    'nur die adressierte Person darf aufloesen');

  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
}

// 5) Getrennte werden uebersprungen statt die Partie anzuhalten
{
  const ps = [makePlayer('a'), makePlayer('b', { connected: false }), makePlayer('c')];
  const room = makeRoom(ps, 0);
  openQueuedCardAction(room, 'TESTKARTE', ['b', 'c'], () => ({
    kind: 'choice', options: [{ id: 'ok', label: 'Ok', action: { type: 'noEffect' } }],
  }));
  assert.strictEqual(room.pendingCardAction.playerId, 'c',
    'die getrennte Person B wird uebersprungen');

  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
}

// 6) Eine Warteschlange darf auch targetPlayer-Specs liefern - der Resolver
// dort ist keine Options-Map, sondern die Aktion selbst (wie bei
// openCardTarget). Ohne den Fix bleibt der Resolver {} und die Aktion
// verpufft wortlos.
{
  const ps = [makePlayer('a', { level: 5 }), makePlayer('b', { level: 5 }), makePlayer('c', { level: 5 })];
  const room = makeRoom(ps, 0);
  openQueuedCardAction(room, 'TESTKARTE', ['b'], () => ({
    kind: 'targetPlayer', prompt: 'Ziel wählen', candidateIds: ['a', 'c'],
    action: { type: 'stealLevel' },
  }));
  assert.strictEqual(room.pendingCardAction.playerId, 'b');
  assert.strictEqual(room.pendingCardAction.kind, 'targetPlayer');
  handleResolveCardTarget(room, 'b', 'a');
  assert.strictEqual(ps[1].level, 6, 'B (Akteur) +1 Stufe durch stealLevel');
  assert.strictEqual(ps[0].level, 4, 'A (Ziel) -1 Stufe durch stealLevel');
  assert.strictEqual(room.pendingCardAction, null, 'Warteschlange war danach leer, also abgeraeumt');

  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
}

console.log('OK - Aktions-Warteschlange: fuenf Reihenfolgen, Vorruecken, Abraeumen, Getrennte, targetPlayer-Resolver.');
