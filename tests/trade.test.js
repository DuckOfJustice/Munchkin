// Prüft den Handel als echten Zwei-Wege-Tausch: beide Seiten stellen ihre
// Hälfte zusammen, und erst wenn beide zugestimmt haben, wechseln die Karten
// den Besitzer. Getauscht werden können Handkarten UND angelegte Gegenstände.
// Teil 1 im Stil von card-abilities.test.js: die Handler direkt mit einem
// minimalen Raum aufrufen und den Zustand danach prüfen. Teil 2 fährt
// denselben Ablauf über echte Sockets (Verdrahtung + Privatsphäre).
const assert = require('assert');
const {
  ALL_CARDS, handleProposeTrade, handleCancelTrade, handleRespondTrade, tradableCardIds,
} = require('../server.js');
const { startServer, stopServer, connectClient, emitAsync } = require('./helpers.js');

const PORT = 3271;

function findCard(name) {
  const c = ALL_CARDS.find((x) => x.name === name);
  if (!c) throw new Error(`Testkarte nicht gefunden: ${name}`);
  return c;
}

function makePlayer(id, hand, equipped) {
  return {
    id, name: id, connected: true, isBot: false, level: 1,
    hand: hand || [], races: [], classes: [], powerGroups: [],
    raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: Object.assign({ head: null, armor: null, feet: null, hands: [null, null] }, equipped || {}),
  };
}

const openRooms = [];
function makeRoom(p1, p2) {
  const room = { code: 'TEST', phase: 'playing', players: [p1, p2], logs: [], trades: [] };
  openRooms.push(room);
  return room;
}

// Karten mit bekanntem Goldwert (die Werte stehen im Handels-UI als Summe).
const helm = findCard('HELM DER TAPFERKEIT');      // 200 GS, Kopf
const tuch = findCard('COOLES TUCH FÜR HARTE KERLE'); // 400 GS, Kopf
const bogen = findCard('BOGEN MIT BUNTEN BÄNDERN');   // 800 GS, zwei Hände

function runUnit() {
  // -------------------------------------------------------------------
  // 1. Kompletter Zwei-Wege-Tausch: erst nach der Bestätigung der
  //    anbietenden Seite wechseln beide Hälften.
  // -------------------------------------------------------------------
  {
    const p1 = makePlayer('p1', [helm.id]);
    const p2 = makePlayer('p2', [tuch.id]);
    const room = makeRoom(p1, p2);

    handleProposeTrade(room, 'p1', 'p2', [helm.id]);
    assert.strictEqual(room.trades.length, 1, 'Angebot muss angelegt werden');
    assert.strictEqual(room.trades[0].status, 'pending');

    const tradeId = room.trades[0].id;
    handleRespondTrade(room, 'p2', tradeId, true, [tuch.id]);
    assert.strictEqual(room.trades[0].status, 'countered', 'Gegenleistung macht daraus einen offenen Tausch');
    assert.deepStrictEqual(p1.hand, [helm.id], 'vor der Bestätigung darf nichts wechseln');
    assert.deepStrictEqual(p2.hand, [tuch.id], 'vor der Bestätigung darf nichts wechseln');

    handleRespondTrade(room, 'p1', tradeId, true);
    assert.strictEqual(room.trades.length, 0, 'abgeschlossener Handel wird entfernt');
    assert.deepStrictEqual(p1.hand, [tuch.id], 'p1 muss die Gegenleistung erhalten');
    assert.deepStrictEqual(p2.hand, [helm.id], 'p2 muss das Angebot erhalten');
    assert.ok(room.logs.some((l) => l.text.includes('Handel:') && l.text.includes('200 GS') && l.text.includes('400 GS')),
      'Ergebnis samt Goldwerten muss öffentlich im Verlauf stehen');
  }

  // -------------------------------------------------------------------
  // 2. Angelegte Gegenstände: müssen aus dem Slot raus und landen beim
  //    Empfänger auf der Hand (NICHT automatisch angelegt).
  // -------------------------------------------------------------------
  {
    const p1 = makePlayer('p1', [], { head: helm.id, hands: [bogen.id, bogen.id] });
    const p2 = makePlayer('p2', [tuch.id]);
    const room = makeRoom(p1, p2);
    assert.deepStrictEqual(tradableCardIds(p1).sort(), [helm.id, bogen.id].sort(),
      'angelegte Gegenstände sind handelbar, Zweihandwaffen nur einmal');

    handleProposeTrade(room, 'p1', 'p2', [helm.id, bogen.id]);
    const tradeId = room.trades[0].id;
    handleRespondTrade(room, 'p2', tradeId, true, [tuch.id]);
    handleRespondTrade(room, 'p1', tradeId, true);

    assert.strictEqual(p1.equipped.head, null, 'Kopf-Slot muss beim Geber frei sein');
    assert.deepStrictEqual(p1.equipped.hands, [null, null], 'Zweihandwaffe muss aus beiden Hand-Slots raus sein');
    assert.deepStrictEqual(p1.hand, [tuch.id], 'p1 hat nur noch die Gegenleistung');
    assert.deepStrictEqual(p2.hand.sort(), [helm.id, bogen.id].sort(), 'Empfänger bekommt beides auf die Hand');
    assert.strictEqual(p2.equipped.head, null, 'beim Empfänger darf nichts automatisch angelegt werden');
  }

  // -------------------------------------------------------------------
  // 3. Ablehnen / Zurückziehen / Gegenleistung ablehnen ändert nichts.
  // -------------------------------------------------------------------
  {
    const p1 = makePlayer('p1', [helm.id]);
    const p2 = makePlayer('p2', [tuch.id]);
    const room = makeRoom(p1, p2);

    // Gegenseite lehnt ab
    handleProposeTrade(room, 'p1', 'p2', [helm.id]);
    handleRespondTrade(room, 'p2', room.trades[0].id, false, [tuch.id]);
    assert.strictEqual(room.trades.length, 0);
    assert.deepStrictEqual([p1.hand, p2.hand], [[helm.id], [tuch.id]], 'Ablehnen darf nichts tauschen');

    // Anbietende Seite zieht zurück
    handleProposeTrade(room, 'p1', 'p2', [helm.id]);
    handleCancelTrade(room, 'p1', room.trades[0].id);
    assert.strictEqual(room.trades.length, 0);
    assert.deepStrictEqual([p1.hand, p2.hand], [[helm.id], [tuch.id]], 'Zurückziehen darf nichts tauschen');

    // Anbietende Seite lehnt die verlangte Gegenleistung ab
    handleProposeTrade(room, 'p1', 'p2', [helm.id]);
    const tradeId = room.trades[0].id;
    handleRespondTrade(room, 'p2', tradeId, true, [tuch.id]);
    handleRespondTrade(room, 'p1', tradeId, false);
    assert.strictEqual(room.trades.length, 0);
    assert.deepStrictEqual([p1.hand, p2.hand], [[helm.id], [tuch.id]], 'abgelehnte Gegenleistung darf nichts tauschen');
  }

  // -------------------------------------------------------------------
  // 4. Manipulierte Anfragen (der Client bestimmt die IDs selbst).
  // -------------------------------------------------------------------
  {
    const p1 = makePlayer('p1', [helm.id]);
    const p2 = makePlayer('p2', [tuch.id]);
    const room = makeRoom(p1, p2);

    // fremde Karte anbieten
    handleProposeTrade(room, 'p1', 'p2', [tuch.id]);
    assert.strictEqual(room.trades.length, 0, 'fremde Karten dürfen nicht angeboten werden');
    // Murks-Payloads
    handleProposeTrade(room, 'p1', 'p2', 'keine');
    handleProposeTrade(room, 'p1', 'p1', [helm.id]);
    handleProposeTrade(room, 'p1', 'gibtsnicht', [helm.id]);
    handleRespondTrade(room, 'p2', 'gibtsnicht', true, [tuch.id]);
    handleCancelTrade(room, 'p1', null);
    assert.strictEqual(room.trades.length, 0, 'Müll-Payloads dürfen keinen Handel anlegen');

    // fremder Handel / falsche Rolle
    handleProposeTrade(room, 'p1', 'p2', [helm.id]);
    const tradeId = room.trades[0].id;
    handleRespondTrade(room, 'p1', tradeId, true, [helm.id]);
    assert.strictEqual(room.trades[0].status, 'pending', 'die anbietende Seite darf nicht selbst annehmen');
    handleCancelTrade(room, 'p2', tradeId);
    assert.strictEqual(room.trades.length, 1, 'nur die anbietende Seite kann zurückziehen');

    handleRespondTrade(room, 'p2', tradeId, true, [tuch.id]);
    handleRespondTrade(room, 'p2', tradeId, true);
    assert.strictEqual(room.trades.length, 1, 'die Gegenseite darf den Tausch nicht selbst bestätigen');
    assert.deepStrictEqual([p1.hand, p2.hand], [[helm.id], [tuch.id]], 'nichts gewechselt ohne Bestätigung');

    handleRespondTrade(room, 'p1', tradeId, true);
    assert.deepStrictEqual([p1.hand, p2.hand], [[tuch.id], [helm.id]], 'nach korrekter Bestätigung wechseln beide Hälften');
  }

  // -------------------------------------------------------------------
  // 5. Karten, die zwischenzeitlich weg sind, werden übersprungen -
  //    der Rest wird trotzdem getauscht.
  // -------------------------------------------------------------------
  {
    const p1 = makePlayer('p1', [helm.id, bogen.id]);
    const p2 = makePlayer('p2', [tuch.id]);
    const room = makeRoom(p1, p2);

    handleProposeTrade(room, 'p1', 'p2', [helm.id, bogen.id]);
    const tradeId = room.trades[0].id;
    handleRespondTrade(room, 'p2', tradeId, true, [tuch.id]);
    p1.hand = p1.hand.filter((id) => id !== bogen.id); // z.B. inzwischen abgelegt
    handleRespondTrade(room, 'p1', tradeId, true);

    assert.deepStrictEqual(p2.hand, [helm.id], 'nur die noch vorhandene Karte wandert');
    assert.deepStrictEqual(p1.hand, [tuch.id], 'die Gegenleistung wird trotzdem übergeben');
  }

  // -------------------------------------------------------------------
  // Im Kampf wird nicht gehandelt: weder anbieten noch einen laufenden
  // Handel abschliessen (sonst liesse sich die Kampfrechnung mitten im
  // Kampf ueber fremde Gegenstaende verschieben).
  // -------------------------------------------------------------------
  {
    const p1 = makePlayer('p1', [helm.id]);
    const p2 = makePlayer('p2', [tuch.id]);
    const room = makeRoom(p1, p2);
    room.combat = { actorId: 'p1', helperId: null, monsterIds: [] };

    handleProposeTrade(room, 'p1', 'p2', [helm.id]);
    assert.strictEqual(room.trades.length, 0, 'im Kampf kommt kein Angebot zustande');

    // Angebot von VOR dem Kampf darf mittendrin nicht abgeschlossen werden.
    room.combat = null;
    handleProposeTrade(room, 'p1', 'p2', [helm.id]);
    const tradeId = room.trades[0].id;
    room.combat = { actorId: 'p1', helperId: null, monsterIds: [] };
    handleRespondTrade(room, 'p2', tradeId, true, [tuch.id]);
    assert.strictEqual(room.trades[0].status, 'pending', 'die Antwort wird im Kampf abgewiesen');
    assert.ok(p1.hand.includes(helm.id) && p2.hand.includes(tuch.id), 'es wechselt nichts');

    // Zuruecknehmen bewegt keine Karten und bleibt deshalb erlaubt.
    handleCancelTrade(room, 'p1', tradeId);
    assert.strictEqual(room.trades.length, 0, 'zurueckziehen geht auch im Kampf');
  }

  openRooms.forEach((r) => clearTimeout(r.cleanupTimer)); // touchRoom-Timer aufräumen
  console.log('OK - Zwei-Wege-Tausch, angelegte Gegenstände, Ablehnen/Zurückziehen und manipulierte Anfragen geprüft.');
}

// Zweiter Teil: derselbe Ablauf über echte Sockets - prüft die
// Event-Verdrahtung und dass Handelsangebote privat bleiben (nur die beiden
// Beteiligten bekommen sie in ihrem yourInfo).
async function runSockets() {
  const proc = await startServer(PORT);
  try {
    const a = await connectClient(`http://localhost:${PORT}`);
    const b = await connectClient(`http://localhost:${PORT}`);
    const c = await connectClient(`http://localhost:${PORT}`);
    const infos = new Map();
    [['a', a], ['b', b], ['c', c]].forEach(([key, sock]) => sock.on('yourInfo', (i) => infos.set(key, i)));

    const created = await emitAsync(a, 'createRoom', { name: 'Anna' });
    assert.ok(created.ok, `createRoom fehlgeschlagen: ${created.error}`);
    const joinedB = await emitAsync(b, 'joinRoom', { code: created.code, name: 'Bert' });
    const joinedC = await emitAsync(c, 'joinRoom', { code: created.code, name: 'Cem' });
    assert.ok(joinedB.ok && joinedC.ok, 'Beitreten fehlgeschlagen');
    a.emit('startGame');
    await new Promise((r) => setTimeout(r, 400));

    const handA = infos.get('a').hand.slice();
    const handB = infos.get('b').hand.slice();
    assert.ok(handA.length && handB.length, 'beide brauchen Handkarten');

    a.emit('proposeTrade', { toId: joinedB.playerId, offerCardIds: [handA[0]] });
    await new Promise((r) => setTimeout(r, 200));
    const offer = infos.get('b').incomingTrades[0];
    assert.ok(offer && offer.offerCardIds[0] === handA[0], 'Angebot muss bei Bert ankommen');
    assert.strictEqual(infos.get('a').outgoingTrades.length, 1, 'Anna sieht ihr eigenes Angebot');
    assert.deepStrictEqual([infos.get('c').incomingTrades, infos.get('c').outgoingTrades], [[], []],
      'Unbeteiligte dürfen fremde Handelsangebote nicht sehen');

    b.emit('respondTrade', { tradeId: offer.id, accept: true, counterCardIds: [handB[0]] });
    await new Promise((r) => setTimeout(r, 200));
    const pending = infos.get('a').outgoingTrades[0];
    assert.strictEqual(pending.status, 'countered', 'Anna sieht die verlangte Gegenleistung');
    assert.deepStrictEqual(pending.counterCardIds, [handB[0]]);
    assert.ok(infos.get('a').hand.includes(handA[0]), 'vor der Bestätigung wechselt nichts');

    a.emit('respondTrade', { tradeId: offer.id, accept: true });
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!infos.get('a').hand.includes(handA[0]) && infos.get('a').hand.includes(handB[0]),
      'Anna hat getauscht');
    assert.ok(!infos.get('b').hand.includes(handB[0]) && infos.get('b').hand.includes(handA[0]),
      'Bert hat getauscht');
    assert.strictEqual(infos.get('a').outgoingTrades.length, 0, 'abgeschlossener Handel verschwindet');

    a.close(); b.close(); c.close();
    console.log('OK - Handel über Sockets abgeschlossen, Angebote blieben privat.');
  } finally {
    await stopServer(proc);
  }
}

runUnit();
runSockets().then(() => {
  console.log('2/2 Tests erfolgreich (trade.test.js).');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
