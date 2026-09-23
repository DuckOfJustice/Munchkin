// Ein Client bestimmt Event-Name und Payload selbst. Dieser Test feuert jedes
// bekannte Event mit fehlendem und mit unsinnigem Payload ab und prüft, dass
// der Server danach noch läuft und weiter normal antwortet.
//
// Hintergrund: vorher genügte ein `socket.emit('removeBot')` ohne Argument, um
// den kompletten Prozess zu beenden (Destrukturierung von undefined im
// Handler-Parameter) - und damit alle laufenden Spiele, die nur im
// Arbeitsspeicher liegen. Siehe onSafe() in server.js.
const assert = require('assert');
const { startServer, stopServer, connectClient, emitAsync } = require('./helpers.js');

const PORT = 3251;

// createRoom/joinRoom sind absichtlich ratenbegrenzt (8 bzw. 20 pro Minute und
// IP). Sie werden deshalb getrennt und sparsam beschossen, damit das Limit
// nicht den eigentlichen Test verfälscht.
const RATE_LIMITED_EVENTS = ['createRoom', 'joinRoom'];

// Jedes weitere Event, das der Server kennt (siehe io.on('connection')).
const EVENTS = [
  'leaveRoom', 'addBot', 'removeBot', 'updateSets',
  'startGame', 'resetGame', 'drawDoor', 'ackConsequence', 'applyConsequenceAction',
  'resolveConsequenceChoice', 'useCardPower', 'resolveCardChoice', 'resolveCardTarget',
  'resolveCardCardChoice', 'useGuaranteedFlee', 'playMonsterFromHand', 'skipToLoot',
  'lootRoom', 'setCombatModifier', 'playCombatCard', 'proposeTrade', 'cancelTrade',
  'respondTrade', 'requestHelp', 'respondHelp', 'bardeVerzaubern', 'evaluateCombat', 'attemptFlee',
  'equipItem', 'unequipItem', 'sellItems', 'playRaceOrClass', 'discardFromHand',
  'endTurn',
];

// Payload-Formen, die ein Handler nicht erwartet.
const PAYLOADS = [
  undefined, null, 0, '', 'nonsense', [], true,
  { cardId: null }, { cardId: 42 }, { cardIds: 5 }, { cardIds: 'abc' },
  { botId: {} }, { optionId: [] }, { targetId: 0 }, { modifier: 'viel' },
  { who: 'monster', value: 'NaN' }, { accept: 'ja' }, { tradeId: null },
  { tradeId: 'gibtsnicht', accept: true, counterCardIds: 'alles' },
  { toId: null, offerCardIds: 'keine' }, { name: 123 }, { code: [] }, { type: 'levelDelta' },
];

async function run() {
  const proc = await startServer(PORT);
  let exitedWith = null;
  proc.on('exit', (code) => { exitedWith = code; });

  try {
    const socket = await connectClient(`http://localhost:${PORT}`);

    // 1. Alles abfeuern, ohne einem Raum beigetreten zu sein.
    for (const event of EVENTS) {
      for (const payload of PAYLOADS) socket.emit(event, payload);
      socket.emit(event); // ganz ohne Argument
    }
    // Die ratenbegrenzten Events sparsam, aber ebenfalls ohne/mit Murks-Payload.
    RATE_LIMITED_EVENTS.forEach((event) => {
      socket.emit(event);
      socket.emit(event, null);
      socket.emit(event, 'nonsense');
    });
    await new Promise((r) => setTimeout(r, 400));
    assert.strictEqual(exitedWith, null, 'Server ist durch Events ohne Raum abgestürzt');

    // 2. Dasselbe innerhalb eines echten, laufenden Spiels.
    const created = await emitAsync(socket, 'createRoom', { name: 'Fuzzer' });
    assert.ok(created && created.ok, `Raum konnte nicht erstellt werden: ${created && created.error}`);
    socket.emit('addBot');
    await new Promise((r) => setTimeout(r, 150));
    socket.emit('startGame');
    await new Promise((r) => setTimeout(r, 300));

    for (const event of EVENTS) {
      for (const payload of PAYLOADS) socket.emit(event, payload);
      socket.emit(event);
    }
    await new Promise((r) => setTimeout(r, 600));
    assert.strictEqual(exitedWith, null, 'Server ist durch Events im laufenden Spiel abgestürzt');

    // 3. Der Server muss danach noch normal antworten - hier über den
    // Wiederverbinden-Pfad, der nicht am createRoom-Limit hängt.
    const socket2 = await connectClient(`http://localhost:${PORT}`);
    const rejoined = await emitAsync(socket2, 'joinRoom', { code: created.code, name: 'Danach', token: created.token });
    assert.ok(rejoined && rejoined.ok, `Server antwortet nach dem Beschuss nicht mehr normal: ${rejoined && rejoined.error}`);

    socket.close();
    socket2.close();
    const shots = EVENTS.length * (PAYLOADS.length + 1) + RATE_LIMITED_EVENTS.length * 3;
    console.log(`OK - ${shots} fehlerhafte Events ohne Serverabsturz verarbeitet.`);
  } finally {
    await stopServer(proc);
  }
}

run().then(() => {
  console.log('1/1 Tests erfolgreich (malformed-input.test.js).');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
