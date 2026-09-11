// Startet den Server als echten Prozess, verbindet einen "menschlichen"
// Client (der auf jede Phase automatisch mit der einfachsten gültigen Aktion
// reagiert) plus 2 Bots, spielt ein paar Minuten lang und prüft, dass der
// Server dabei nicht abstürzt und die Werte durchgehend plausibel bleiben.

const { startServer, stopServer, connectClient, emitAsync, assert } = require('./helpers');

const PORT = 4100 + Math.floor(Math.random() * 300);
const RUN_MS = 8000;

async function main() {
  const proc = await startServer(PORT, { BOT_DELAY_MIN_MS: '5', BOT_DELAY_MAX_MS: '20' });
  try {
    const socket = await connectClient(`http://localhost:${PORT}`);

    const created = await emitAsync(socket, 'createRoom', { name: 'Testerin' });
    assert(created.ok, `createRoom fehlgeschlagen: ${created.error}`);
    const myId = created.playerId;

    socket.emit('addBot');
    socket.emit('addBot');
    await new Promise((resolve) => setTimeout(resolve, 200));

    let lastState = null;
    let myHand = [];
    let sawGameEnd = false;
    let sawCombat = false;
    let ticks = 0;

    function checkInvariants(s) {
      s.players.forEach((p) => {
        assert(p.level >= 1 && p.level <= 10, `Stufe außerhalb 1-10: ${p.level}`);
        assert(p.handCount >= 0, 'negative Handkartenzahl');
      });
      assert(s.doorDeckCount >= 0 && s.treasureDeckCount >= 0, 'negative Deckgröße');
      if (s.phase === 'gameend') {
        const winner = s.players.find((p) => p.id === s.winner);
        assert(winner && winner.level === 10, 'Gewinner hat nicht Stufe 10');
        sawGameEnd = true;
      }
      if (s.combat) sawCombat = true;
    }

    function react(s) {
      lastState = s;
      ticks++;
      checkInvariants(s);
      if (s.phase !== 'playing') return;

      if (s.pendingConsequence) {
        if (s.pendingConsequence.playerId === myId) socket.emit('ackConsequence');
        return;
      }
      if (s.combat) {
        // Ausgewertet wird erst, wenn alle anderen bestätigt haben, dass sie
        // nicht mehr eingreifen wollen - ohne dieses Signal steht ein Kampf
        // unter Bot-Führung für immer.
        if ((s.combat.readyRequired || []).includes(myId) && !(s.combat.ready || {})[myId]) {
          socket.emit('setCombatReady', { ready: true });
          return;
        }
        if (s.combat.actorId === myId) {
          if (s.combat.mustFlee) socket.emit('attemptFlee', { modifier: 0 });
          else socket.emit('evaluateCombat');
        } else if (s.combat.helperPending && s.combat.helperPending.targetId === myId) {
          socket.emit('respondHelp', { accept: false });
        }
        return;
      }
      if (s.turnPlayerId !== myId) return;
      if (s.turnPhase === 'tuer') socket.emit(s.revealedDoorCard ? 'takeRevealedDoor' : 'drawDoor');
      else if (s.turnPhase === 'aerger') socket.emit('skipToLoot');
      else if (s.turnPhase === 'pluendern') socket.emit('lootRoom');
      else if (s.turnPhase === 'gabe') {
        if (myHand.length > 5) socket.emit('discardFromHand', { cardId: myHand[0] });
        else socket.emit('endTurn');
      }
    }

    socket.on('gameState', react);
    socket.on('yourInfo', (info) => {
      if (info.playerId === myId) {
        myHand = info.hand;
        if (lastState) react(lastState);
      }
    });

    socket.emit('startGame');

    await new Promise((resolve) => setTimeout(resolve, RUN_MS));

    assert(ticks > 5, `Zu wenige Spielzustands-Updates empfangen (${ticks}) - Spiel kam nicht in Gang`);
    assert(sawCombat, 'In der Testlaufzeit kam es zu keinem einzigen Kampf - unwahrscheinlich, evtl. Fehler in der Kampf-Logik');
    console.log(`OK - ${ticks} Zustands-Updates, Kampf gesehen: ${sawCombat}, Spielende erreicht: ${sawGameEnd}`);

    socket.close();
  } finally {
    await stopServer(proc);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
