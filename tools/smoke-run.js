// Durchlauf-Probe gegen einen LAUFENDEN Server: eine echte Socket-Sitzung,
// Solo-Raum mit drei Bots, N Zugwechsel. Geprueft wird nur eines, dafuer
// gruendlich: bleibt die Partie irgendwo stehen? Kein haengender Dialog, kein
// Kampf, der nicht auswertbar wird, kein Zustand, der sich im Kreis dreht.
// Gerendert wird nichts - die Oberflaeche bleibt der Handprobe vorbehalten.
//
//   npm start                                  (in einem zweiten Fenster)
//   node tools/smoke-run.js                    alle Sets, 15 Zugwechsel
//   NUR_BASIS=1 RUNDEN=80 node tools/smoke-run.js
//   PORT=3111 BOT_DELAY_MIN_MS=60 BOT_DELAY_MAX_MS=160 npm start   (schneller)
//
// Der Lauf hat schon einen echten Fehler gefunden, den kein Unittest sah:
// einen Bot, der im Fluchtentscheidungsfenster endlos gegen dieselbe Wand
// lief (siehe botFleeRerollCard in server.js).
//
// WICHTIG: pro gameState genau EINE Aktion. broadcastState schickt gameState
// UND yourInfo; wer auf beide reagiert, verdoppelt seine Aktionen bei jedem
// Durchlauf und ueberflutet den Server (in der ersten Fassung bis zum
// Heap-Limit).
const { io } = require('socket.io-client');

const PORT = process.env.PORT || 3111;
const ZIEL = Number(process.env.RUNDEN || 15);
const s = io(`http://localhost:${PORT}`, { transports: ['websocket'] });

let state = null;
let info = null;
let meId = null;
let letzteAenderung = Date.now();
let zugwechsel = 0;
let letzterTurnPlayer = null;
let wartend = false;      // eine Aktion ist raus, Antwort steht aus
let letzteSignatur = null;
let gleich = Date.now(); // seit wann sich der Zustand nicht mehr aendert
let letzterVersuch = null;
let nachfassen = null;
const fehler = [];
const gesehen = new Set();
const versucht = new Set(); // Karten, die schon einmal angelegt/ausgespielt wurden
let idx = {};               // cardIndex des Servers

function spielbar(id) {
  const k = idx[id];
  if (!k) return false;
  return k.category === 'item' || k.category === 'race' || k.category === 'class';
}

function act(event, payload) {
  wartend = true;
  gesehen.add(event);
  s.emit(event, payload || {});
}

function schritt() {
  if (!state || !info || state.phase !== 'playing' || state.winner) return;
  const pa = state.pendingCardAction;
  if (pa && pa.playerId === meId) {
    if (pa.kind === 'choice') return act('resolveCardChoice', { optionId: pa.options[0].id });
    if (pa.kind === 'targetPlayer') return act('resolveCardTarget', { targetId: pa.candidateIds[0] });
    if (pa.kind === 'chooseCard') return act('resolveCardCardChoice', { cardId: pa.candidateIds[0] });
    fehler.push(`unbekannte pendingCardAction.kind: ${pa.kind}`);
    return;
  }
  if (state.pendingRoll && state.pendingRoll.holders.includes(meId)) return act('passReaction');
  // Kleberflaeschchen-Fenster nach einer gelungenen Flucht - dasselbe Event,
  // anderes Feld. Wer hier nicht antwortet, laesst den Kampf stehen.
  if (state.combat && (state.combat.escapeReactionOffer || []).includes(meId)) return act('passReaction');
  const pc = state.pendingConsequence;
  if (pc && pc.playerId === meId) {
    if (pc.choice) return act('resolveConsequenceChoice', { optionId: pc.choice.options[0].id });
    return act('ackConsequence');
  }
  const k = state.combat;
  // Ein Kampf wartet auf die Bestaetigung aller menschlichen Zuschauer
  // (combatReadyRequired) - ohne die laeuft auch der Bot nicht weiter.
  if (k && k.actorId !== meId && !(k.ready || {})[meId]) return act('setCombatReady', { ready: true });
  if (state.turnPlayerId !== meId) return;   // sonst sind die Bots dran
  if (k) {
    if (k.helperPending && k.helperPending.targetId === meId) return act('respondHelp', { accept: false });
    if (k.actorId !== meId) return;
    if (k.fleeRerollOffer) return act('fleeReroll', { cardId: null }); // dem Miesen Zeug stellen
    if (k.mustFlee) return act('attemptFlee', { modifier: 0 });
    // Ohne Siege bleibt die Testfigur auf Stufe 1 und die Wege nach einem
    // gewonnenen Kampf (Schatz, Ausruestung, Verkaufen, Stufenaufstieg,
    // Siegpruefung) werden nie betreten. Das manuelle Bonusfeld ist dafuer
    // genau der richtige Hebel - es ist eine echte Funktion des Clients.
    if (k.actorModifier !== 25) return act('setCombatModifier', { who: 'player', value: 25 });
    return act('evaluateCombat');
  }
  if (state.turnPhase === 'tuer') {
    if (state.revealedDoorCard) return act('takeRevealedDoor');
    return act('drawDoor');
  }
  if (state.turnPhase === 'aerger') return act('skipToLoot');
  if (state.turnPhase === 'pluendern') return act('lootRoom');
  // Vor dem Zugende noch alles anlegen/ausspielen, was auf der Hand liegt -
  // sonst kaempft die Testfigur ewig mit Stufe 1 und die Wege durch
  // Ausruestung, Rassen und Klassen werden nie betreten. Jede Karte wird nur
  // EINMAL versucht: eine abgelehnte Karte erzeugt keinen Broadcast, eine
  // Wiederholung wuerde den Durchlauf stehen lassen.
  const naechste = info.hand.find((id) => !versucht.has(id) && spielbar(id));
  if (naechste) {
    versucht.add(naechste);
    const k = idx[naechste];
    if (k.category === 'race' || k.category === 'class') return act('playRaceOrClass', { cardId: naechste });
    return act('equipItem', { cardId: naechste });
  }
  // 'gabe': ueber dem Handlimit beendet der Server den Zug nicht - erst auf 5
  // abwerfen (immer erlaubt), dann beenden.
  if (info.hand.length > 5) return act('discardFromHand', { cardId: info.hand[0] });
  return act('endTurn');
}

s.on('connect', () => {
  s.emit('createRoom', { name: 'Abnahme' }, (res) => {
    if (!res || !res.ok) { fehler.push('createRoom fehlgeschlagen: ' + JSON.stringify(res)); return ende(); }
    meId = res.playerId;
    s.emit('addBot'); s.emit('addBot'); s.emit('addBot');
    // NUR_BASIS=1: der Durchlauf, um den es dem Plan geht - die Kartenkraefte
    // dieser Runde sind alle aus dem Basis-Set.
    if (process.env.NUR_BASIS) {
      s.emit('updateSets', { base: true, clericalerrors: false, pixelsandpaperpromos: false,
        unnaturalaxe: false, pathfinder: false });
    }
    setTimeout(() => s.emit('startGame'), 300);
  });
});

s.on('cardIndex', (i) => { idx = i; });
s.on('yourInfo', (i) => { info = i; });  // nur merken, NICHT handeln
s.on('gameState', (st) => {
  letzteAenderung = Date.now();
  state = st;
  wartend = false;
  if (st.turnPlayerId && st.turnPlayerId !== letzterTurnPlayer) { letzterTurnPlayer = st.turnPlayerId; zugwechsel += 1; }
  if (st.winner) { console.log(`Sieg: ${(st.winner && st.winner.name) || st.winner}`); return ende(); }
  if (zugwechsel >= ZIEL) return ende();
  // Dreht sich der Zustand im Kreis (gleiche Signatur, gleiche Aktion), ist
  // das genauso ein Haenger wie gar keine Antwort.
  const sig = JSON.stringify([st.turnPlayerId, st.turnPhase, !!st.combat, st.combat && st.combat.monsterIds,
    st.pendingCardAction && st.pendingCardAction.cardName, st.pendingConsequence && st.pendingConsequence.cardId,
    st.players.map((p) => p.level)]);
  if (sig !== letzteSignatur) { letzteSignatur = sig; gleich = Date.now(); }
  if (Date.now() - gleich > 15000) { fehler.push(`DREHT SICH IM KREIS bei ${sig}`); return ende(); }
  // Bei unveraendertem Zustand nicht sofort dieselbe (offenbar abgelehnte)
  // Aktion nachschieben: das erzeugt nur neue Broadcasts und laesst dem
  // Server keine Luft fuer die Bot-Timer (900-2200 ms).
  if (sig === letzterVersuch) { clearTimeout(nachfassen); nachfassen = setTimeout(schritt, 300); return; }
  letzterVersuch = sig;
  schritt();
});

const wach = setInterval(() => {
  if (Date.now() - letzteAenderung > 15000) {
    fehler.push(`HAENGT: 15s kein gameState. phase=${state && state.turnPhase} turnPlayer=${state && state.turnPlayerId} `
      + `ichBinDran=${state && state.turnPlayerId === meId} kampf=${!!(state && state.combat)} wartend=${wartend} `
      + `pendingCardAction=${state && state.pendingCardAction && state.pendingCardAction.playerId} `
      + `pendingConsequence=${state && state.pendingConsequence && state.pendingConsequence.playerId}`);
    ende();
  }
}, 1000);

let fertig = false;
function ende() {
  if (fertig) return;
  fertig = true;
  clearInterval(wach);
  const letzte = ((state && state.logs) || []).slice(-6);
  console.log(`\nZugwechsel: ${zugwechsel} (Ziel ${ZIEL})`);
  console.log(`Stufen: ${((state && state.players) || []).map((p) => `${p.name}=${p.level}`).join(', ')}`);
  console.log(`benutzte Events: ${[...gesehen].sort().join(', ')}`);
  console.log('letzte Logzeilen:\n  ' + letzte.map((l) => (typeof l === 'string' ? l : l.text)).join('\n  '));
  if (fehler.length) { console.log('\nFEHLER:\n - ' + fehler.join('\n - ')); process.exitCode = 1; }
  else console.log('\nOK - Durchlauf ohne Haenger.');
  s.close();
  setTimeout(() => process.exit(process.exitCode || 0), 200);
}
