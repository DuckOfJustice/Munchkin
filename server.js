// Munchkin - Online
// Selbst-gehosteter Mehrspieler-Server auf Basis von Express + Socket.IO,
// nach demselben Muster wie die anderen Spiele (Wizard, Tempel des Schreckens, ...).
// Regelwerk: siehe README.md (Originalspiel von Steve Jackson Games / Pegasus Spiele).
//
// WICHTIG zum Umfang: Munchkin hat hunderte Karten mit jeweils eigenem,
// individuellem Regeltext ("Wanderndes Monster", "Kumpel", spezielle Rassen-/
// Klassen-Kräfte, jede Menge Flüche mit unterschiedlichsten Effekten, ...).
// Das alles einzeln zu kodieren ist nicht machbar. Der Server automatisiert
// daher die MECHANISCHEN Grundregeln vollständig (Phasen, Decks, Kampf-Mathe,
// Stufen, Ausrüstung, Gold/Aufstieg, Fluchtwurf) und zeigt bei allem
// Kartenspezifischen (Boni, Schlimme Dinge, Fluch-Effekte, Sonderkräfte) den
// Originaltext an, den die Spieler:innen - wie am echten Tisch - selbst
// anwenden ("Trust"-Prinzip, genau wie bei den Bluffs in "Tempel des
// Schreckens"). Siehe README.md, Abschnitt "Was automatisiert ist / Was
// manuell bleibt".

const path = require('path');
const http = require('http');
const fs = require('fs');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Kartendaten
// ---------------------------------------------------------------------------

const ALL_CARDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'cards.json'), 'utf8'));
const CARDS_BY_ID = new Map(ALL_CARDS.map((c) => [c.id, c]));
const SET_KEYS = ['base', 'clericalerrors', 'pixelsandpaperpromos', 'unnaturalaxe', 'pathfinder'];
const SET_LABELS = {
  base: 'Base (Grundspiel)',
  clericalerrors: 'Clerical Errors',
  pixelsandpaperpromos: 'Pixels & Paper Promos',
  unnaturalaxe: 'Unnatural Axe',
  pathfinder: 'Pathfinder',
};

function card(id) { return CARDS_BY_ID.get(id) || null; }

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

const MIN_PLAYERS = 1; // Munchkin braucht offiziell 3+, aber solo/zu zweit testen soll möglich sein
const MAX_PLAYERS = 6;
const MAX_ROOMS = 500;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_LEVEL = 10;
const HAND_LIMIT = 5;

const BOT_NAME_POOL = [
  'Bot Grabschänder', 'Bot Kellerkind', 'Bot Fallenfreund', 'Bot Rattenfänger',
  'Bot Türsteher', 'Bot Beutejäger', 'Bot Schleimschlucker', 'Bot Levelheini',
];

function makeRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function makeId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rollDie() { return 1 + Math.floor(Math.random() * 6); }

// ---------------------------------------------------------------------------
// Rate-Limiting (wie bei den anderen Spielen)
// ---------------------------------------------------------------------------

function getClientIp(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return socket.handshake.address || 'unknown';
}

const rateLimitHits = new Map();
function isRateLimited(key, limit, windowMs) {
  const now = Date.now();
  const hits = (rateLimitHits.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) { rateLimitHits.set(key, hits); return true; }
  hits.push(now);
  rateLimitHits.set(key, hits);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of rateLimitHits) {
    const fresh = hits.filter((t) => now - t < 10 * 60 * 1000);
    if (fresh.length) rateLimitHits.set(key, fresh); else rateLimitHits.delete(key);
  }
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Raumverwaltung
// ---------------------------------------------------------------------------

const rooms = new Map();
const ROOM_CLEANUP_MS = 3 * 60 * 60 * 1000;

function newPlayer(name, socketId, isBot) {
  return {
    id: makeId(),
    token: isBot ? null : makeId(),
    name,
    socketId: socketId || null,
    connected: true,
    isBot: !!isBot,
    level: 1,
    races: [],
    classes: [],
    hand: [], // card ids, privat
    equipped: { head: null, armor: null, feet: null, hands: [null, null] },
  };
}

function createRoom() {
  const code = makeRoomCode();
  const room = {
    code,
    hostId: null,
    players: [],
    settings: { sets: { base: true, clericalerrors: true, pixelsandpaperpromos: true, unnaturalaxe: true, pathfinder: true } },
    phase: 'lobby', // lobby | playing | gameend
    turnIndex: 0,
    turnPhase: null, // tuer | aerger | pluendern | gabe
    combatHappenedThisTurn: false,
    doorDeck: [], doorDiscard: [],
    treasureDeck: [], treasureDiscard: [],
    revealedDoorCard: null,
    combat: null,
    pendingConsequence: null,
    winner: null,
    logs: [],
    lastActivity: Date.now(),
    cleanupTimer: null,
    botTimer: null,
  };
  rooms.set(code, room);
  touchRoom(room);
  return room;
}

function touchRoom(room) {
  room.lastActivity = Date.now();
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => { rooms.delete(room.code); }, ROOM_CLEANUP_MS);
}

function log(room, text, cardIds) {
  // cardIds: optionale Liste öffentlich bekannter Karten, auf die sich dieser
  // Eintrag bezieht (z.B. eine aufgedeckte Türkarte) - der Client macht daraus
  // im Verlauf anklickbare Kartenverweise. NIE für private/verdeckte Karten
  // befüllen (z.B. verdeckt gezogene Türkarten beim Plündern)!
  room.logs.push({ text, at: Date.now(), cardIds: (cardIds && cardIds.length) ? cardIds.filter(Boolean) : undefined });
  if (room.logs.length > 300) room.logs.shift();
}

function findPlayer(room, playerId) { return room.players.find((p) => p.id === playerId); }
function currentPlayer(room) { return room.players[room.turnIndex] || null; }

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

function activeSetKeys(room) {
  return SET_KEYS.filter((k) => room.settings.sets[k]);
}

function buildDecks(room) {
  const sets = activeSetKeys(room);
  const doorCards = ALL_CARDS.filter((c) => sets.includes(c.set) && c.type === 'door').map((c) => c.id);
  const treasureCards = ALL_CARDS.filter((c) => sets.includes(c.set) && c.type === 'treasure').map((c) => c.id);
  room.doorDeck = shuffle(doorCards);
  room.doorDiscard = [];
  room.treasureDeck = shuffle(treasureCards);
  room.treasureDiscard = [];
}

function drawDoor(room) {
  if (room.doorDeck.length === 0) {
    if (room.doorDiscard.length === 0) return null;
    room.doorDeck = shuffle(room.doorDiscard);
    room.doorDiscard = [];
    log(room, 'Türstapel war leer - Ablagestapel wurde neu gemischt.');
  }
  return room.doorDeck.pop();
}

function drawTreasure(room) {
  if (room.treasureDeck.length === 0) {
    if (room.treasureDiscard.length === 0) return null;
    room.treasureDeck = shuffle(room.treasureDiscard);
    room.treasureDiscard = [];
    log(room, 'Schatzstapel war leer - Ablagestapel wurde neu gemischt.');
  }
  return room.treasureDeck.pop();
}

// ---------------------------------------------------------------------------
// Ausrüstung / Stufen / Kampfstärke
// ---------------------------------------------------------------------------

function equippedItemIds(player) {
  return [player.equipped.head, player.equipped.armor, player.equipped.feet, ...player.equipped.hands].filter(Boolean);
}

function equippedBonusSum(player) {
  return equippedItemIds(player).reduce((sum, id) => {
    const c = card(id);
    return sum + (c && c.bonus ? c.bonus : 0);
  }, 0);
}

function baseStrength(player) {
  return player.level + equippedBonusSum(player);
}

function setLevel(player, newLevel) {
  player.level = Math.max(1, Math.min(MAX_LEVEL, newLevel));
}

function removeFromHand(player, cardId) {
  const idx = player.hand.indexOf(cardId);
  if (idx >= 0) player.hand.splice(idx, 1);
}

function unequipSlotCard(player, cardId) {
  if (player.equipped.head === cardId) player.equipped.head = null;
  if (player.equipped.armor === cardId) player.equipped.armor = null;
  if (player.equipped.feet === cardId) player.equipped.feet = null;
  player.equipped.hands = player.equipped.hands.map((h) => (h === cardId ? null : h));
}

// ---------------------------------------------------------------------------
// Öffentlicher Zustand
// ---------------------------------------------------------------------------

function publicPlayer(room, p) {
  return {
    id: p.id,
    name: p.name,
    connected: p.connected,
    isHost: p.id === room.hostId,
    isBot: p.isBot === true,
    level: p.level,
    races: p.races,
    classes: p.classes,
    handCount: p.hand.length,
    equipped: p.equipped,
    strength: baseStrength(p),
  };
}

function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    players: room.players.map((p) => publicPlayer(room, p)),
    hostId: room.hostId,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    settings: room.settings,
    setLabels: SET_LABELS,
    setKeys: SET_KEYS,
    turnIndex: room.turnIndex,
    turnPlayerId: room.players[room.turnIndex] ? room.players[room.turnIndex].id : null,
    turnPhase: room.turnPhase,
    doorDeckCount: room.doorDeck.length,
    doorDiscardTop: room.doorDiscard.length ? room.doorDiscard[room.doorDiscard.length - 1] : null,
    doorDiscardCount: room.doorDiscard.length,
    treasureDeckCount: room.treasureDeck.length,
    treasureDiscardTop: room.treasureDiscard.length ? room.treasureDiscard[room.treasureDiscard.length - 1] : null,
    treasureDiscardCount: room.treasureDiscard.length,
    revealedDoorCard: room.revealedDoorCard,
    combat: room.combat,
    pendingConsequence: room.pendingConsequence,
    winner: room.winner,
    logs: room.logs.slice(-80),
  };
}

function sendInfoTo(room, player) {
  if (!player.socketId) return;
  const trades = room.trades || [];
  // Handelsangebote sind privat, bis sie angenommen wurden (sie verraten
  // Handkarten) - jede:r sieht nur die eigenen offenen Angebote, nicht die
  // aller anderen. Nach Annahme landet das Ergebnis öffentlich im Verlauf.
  const incomingTrades = trades.filter((t) => t.status === 'pending' && t.toId === player.id)
    .map((t) => ({ id: t.id, fromId: t.fromId, fromName: (findPlayer(room, t.fromId) || {}).name || '?', offerCardIds: t.offerCardIds }));
  const outgoingTrades = trades.filter((t) => t.status === 'pending' && t.fromId === player.id)
    .map((t) => ({ id: t.id, toId: t.toId, toName: (findPlayer(room, t.toId) || {}).name || '?', offerCardIds: t.offerCardIds }));
  io.to(player.socketId).emit('yourInfo', {
    playerId: player.id,
    hand: player.hand,
    incomingTrades,
    outgoingTrades,
  });
}

function broadcastState(room) {
  const cardCache = {};
  // Alle Karten mitschicken, die irgendwo referenziert sind, plus die Hände
  // der Spieler:innen einzeln - Kartendetails selbst sind kein Geheimnis
  // (Kartentexte sind öffentlich bekannt), nur WER welche Karte auf der Hand
  // hat ist privat.
  io.to(room.code).emit('gameState', publicState(room));
  io.to(room.code).emit('cardIndex', ALL_CARDS_MIN);
  room.players.forEach((p) => sendInfoTo(room, p));
  touchRoom(room);
  scheduleBotActionsIfNeeded(room);
}

// Schlanke, öffentliche Kartentabelle (einmalig an Clients gesendet) - so
// muss der Server bei jedem State-Update nicht die vollen Kartentexte erneut
// verschicken.
const ALL_CARDS_MIN = ALL_CARDS.reduce((acc, c) => { acc[c.id] = c; return acc; }, {});

// ---------------------------------------------------------------------------
// Spielstart
// ---------------------------------------------------------------------------

function startGame(room) {
  room.players = shuffle(room.players);
  buildDecks(room);
  room.players.forEach((p) => {
    p.level = 1;
    p.races = [];
    p.classes = [];
    p.hand = [];
    p.equipped = { head: null, armor: null, feet: null, hands: [null, null] };
    for (let i = 0; i < 4; i++) {
      const d = drawDoor(room); if (d) p.hand.push(d);
      const t = drawTreasure(room); if (t) p.hand.push(t);
    }
  });
  room.turnIndex = 0;
  room.turnPhase = 'tuer';
  room.combatHappenedThisTurn = false;
  room.revealedDoorCard = null;
  room.combat = null;
  room.pendingConsequence = null;
  room.winner = null;
  room.phase = 'playing';
  room.logs = [];
  room.trades = [];
  log(room, `Das Spiel beginnt mit ${room.players.length} Spieler:innen. Jede:r hat 4 Tür- und 4 Schatzkarten auf der Hand.`);
  log(room, `${currentPlayer(room).name} ist am Zug (Phase 1: Tür eintreten).`);
}

function endTurn(room) {
  if (room.pendingConsequence || room.combat) return;
  if (currentPlayer(room) && currentPlayer(room).hand.length > HAND_LIMIT) return; // Milde Gabe erzwingen
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.turnPhase = 'tuer';
  room.combatHappenedThisTurn = false;
  room.revealedDoorCard = null;
  log(room, `${currentPlayer(room).name} ist am Zug (Phase 1: Tür eintreten).`);
}

function checkWin(room, player) {
  if (player.level >= MAX_LEVEL) {
    room.phase = 'gameend';
    room.winner = player.id;
    log(room, `🏆 ${player.name} erreicht Stufe 10 und gewinnt das Spiel!`);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Phase 1: Tür eintreten
// ---------------------------------------------------------------------------

function handleDrawDoor(room, playerId) {
  const player = currentPlayer(room);
  if (!player || player.id !== playerId) return;
  if (room.turnPhase !== 'tuer' || room.revealedDoorCard || room.combat || room.pendingConsequence) return;
  const id = drawDoor(room);
  if (!id) { log(room, 'Türstapel ist leer.'); return; }
  room.revealedDoorCard = id;
  const c = card(id);
  log(room, `${player.name} deckt "${c.name}" auf (${c.setLabel}).`, [id]);

  if (c.category === 'monster') {
    room.revealedDoorCard = null;
    startCombat(room, player.id, [id], { fromHand: false });
  } else if (c.category === 'curse') {
    room.pendingConsequence = { playerId: player.id, kind: 'curse', cardId: id, text: c.text || c.name };
    room.doorDiscard.push(id);
    room.revealedDoorCard = null;
    log(room, `Fluch! ${player.name} muss die Auswirkung anwenden: "${c.name}".`, [id]);
  } else {
    player.hand.push(id);
    room.revealedDoorCard = null;
    room.turnPhase = 'aerger';
    log(room, `${player.name} nimmt "${c.name}" auf die Hand. Phase 2: Auf Ärger aus sein.`, [id]);
  }
}

function handleAckConsequence(room, playerId) {
  if (!room.pendingConsequence || room.pendingConsequence.playerId !== playerId) return;
  const wasCurse = room.pendingConsequence.kind === 'curse';
  room.pendingConsequence = null;
  const player = findPlayer(room, playerId);
  if (wasCurse) {
    room.turnPhase = 'aerger';
    log(room, `${player.name} macht weiter mit Phase 2: Auf Ärger aus sein.`);
  } else {
    // Folge einer verlorenen Kampfrunde: direkt weiter zu Phase 4 (wurde beim
    // Kampfstart bereits als combatHappenedThisTurn markiert).
    room.turnPhase = 'gabe';
    log(room, `${player.name} macht weiter mit Phase 4: Milde Gabe.`);
  }
  touchRoom(room);
}

// Generisches Werkzeug, um eine Konsequenz (Fluch oder "Schlimme Dinge")
// anzuwenden - siehe Kommentar am Dateianfang zum "Trust"-Prinzip.
function handleApplyConsequenceAction(room, playerId, action) {
  if (!room.pendingConsequence || room.pendingConsequence.playerId !== playerId) return;
  const player = findPlayer(room, playerId);
  if (!player) return;
  if (action.type === 'levelDelta') {
    setLevel(player, player.level + action.delta);
    log(room, `${player.name}: Stufe ${action.delta >= 0 ? '+' : ''}${action.delta} -> jetzt Stufe ${player.level}.`);
  } else if (action.type === 'discardCard') {
    const cardId = action.cardId;
    if (player.hand.includes(cardId)) {
      removeFromHand(player, cardId);
      discardCard(room, cardId);
    } else if (equippedItemIds(player).includes(cardId)) {
      unequipSlotCard(player, cardId);
      discardCard(room, cardId);
    } else return;
    const c = card(cardId);
    log(room, `${player.name} legt "${c ? c.name : cardId}" ab.`, [cardId]);
  } else if (action.type === 'death') {
    room.doorDiscard.push(...player.hand.filter((id) => card(id).type === 'door'));
    room.treasureDiscard.push(...player.hand.filter((id) => card(id).type === 'treasure'));
    room.doorDiscard.push(...equippedItemIds(player));
    player.hand = [];
    player.equipped = { head: null, armor: null, feet: null, hands: [null, null] };
    setLevel(player, 1);
    log(room, `💀 ${player.name} ist gestorben und beginnt bei Stufe 1 mit leeren Händen neu.`);
  }
  touchRoom(room);
}

function discardCard(room, cardId) {
  const c = card(cardId);
  if (!c) return;
  if (c.type === 'door') room.doorDiscard.push(cardId);
  else room.treasureDiscard.push(cardId);
}

// ---------------------------------------------------------------------------
// Phase 2: Auf Ärger aus sein (freiwilliges Monster aus der Hand)
// ---------------------------------------------------------------------------

function handlePlayMonsterFromHand(room, playerId, cardId) {
  const player = currentPlayer(room);
  if (!player || player.id !== playerId) return;
  if (room.turnPhase !== 'aerger' || room.combat) return;
  if (!player.hand.includes(cardId)) return;
  const c = card(cardId);
  if (!c || c.category !== 'monster') return;
  removeFromHand(player, cardId);
  startCombat(room, player.id, [cardId], { fromHand: true });
}

function handleSkipToLoot(room, playerId) {
  const player = currentPlayer(room);
  if (!player || player.id !== playerId) return;
  if (room.turnPhase !== 'aerger' || room.combat) return;
  room.turnPhase = 'pluendern';
  log(room, `${player.name} geht dem Ärger aus dem Weg. Phase 3: Raum plündern.`);
  touchRoom(room);
}

// ---------------------------------------------------------------------------
// Phase 3: Raum plündern
// ---------------------------------------------------------------------------

function handleLootRoom(room, playerId) {
  const player = currentPlayer(room);
  if (!player || player.id !== playerId) return;
  if (room.turnPhase !== 'pluendern') return;
  const id = drawDoor(room);
  if (id) {
    player.hand.push(id);
    log(room, `${player.name} plündert den Raum: 1 verdeckte Türkarte auf die Hand.`);
  }
  room.turnPhase = 'gabe';
  touchRoom(room);
}

// ---------------------------------------------------------------------------
// Kampf
// ---------------------------------------------------------------------------

function startCombat(room, actorId, monsterIds, opts) {
  room.combatHappenedThisTurn = true;
  room.turnPhase = 'kampf';
  room.combat = {
    actorId,
    helperId: null,
    helperPending: null, // { targetId }
    monsterIds,
    actorModifier: 0,
    monsterModifier: 0,
    mustFlee: false,
    fromHand: !!opts.fromHand,
  };
  touchRoom(room);
}

function combatTotals(room) {
  const c = room.combat;
  const actor = findPlayer(room, c.actorId);
  const helper = c.helperId ? findPlayer(room, c.helperId) : null;
  const monsterLevel = c.monsterIds.reduce((sum, id) => sum + (card(id).level || 0), 0);
  const playerStrength = baseStrength(actor) + (helper ? baseStrength(helper) : 0) + c.actorModifier;
  const monsterStrength = monsterLevel + c.monsterModifier;
  return { playerStrength, monsterStrength, monsterLevel };
}

// Monster-Verstärker: Türkarten (Kategorie "door_other"), die laut Text
// jederzeit während eines beliebigen Kampfes ausgespielt werden dürfen und
// einen festen Bonus/Malus "für das Monster" geben (z.B. Uralt +10, Baby -5).
// Diese lassen sich automatisch erkennen (nicht-null/nicht-0 bonus-Feld +
// passender Kartentext) und daher automatisch verrechnen, statt dass die
// Zahl manuell eingetragen werden muss.
function isMonsterEnhancerCard(c) {
  return !!c && c.category === 'door_other' && typeof c.bonus === 'number' && c.bonus !== 0 &&
    /für\s+(das\s+)?Monster/i.test(c.text || '');
}

function handleSetCombatModifier(room, playerId, who, value) {
  if (!room.combat) return;
  const c = room.combat;
  if (c.mustFlee) return;
  const player = findPlayer(room, playerId);
  if (!player) return;
  // Jede:r am Tisch darf hier eingreifen (Karteneffekte, die das Monster
  // stärken/schwächen oder den Kämpfenden helfen/schaden, manuell eintragen) -
  // nicht nur die kämpfende Person selbst.
  const v = Math.max(-99, Math.min(99, Math.round(Number(value) || 0)));
  if (who === 'monster') {
    if (c.monsterModifier === v) return;
    c.monsterModifier = v;
    log(room, `${player.name} setzt den Monster-Bonus/Malus auf ${v >= 0 ? '+' : ''}${v}.`);
  } else {
    if (c.actorModifier === v) return;
    c.actorModifier = v;
    log(room, `${player.name} setzt den Bonus/Malus der Kämpfenden auf ${v >= 0 ? '+' : ''}${v}.`);
  }
  touchRoom(room);
}

// Jede:r Spieler:in (nicht nur Angreifer:in/Helfer:in) darf einen
// Monster-Verstärker aus der eigenen Hand in den laufenden Kampf spielen -
// z.B. um das Monster zu stärken (mehr Risiko, mehr Schatz) oder zu
// schwächen und so der kämpfenden Person zu helfen.
function handlePlayCombatCard(room, playerId, cardId) {
  if (!room.combat || room.combat.mustFlee) return;
  const player = findPlayer(room, playerId);
  if (!player || !player.hand.includes(cardId)) return;
  const c = card(cardId);
  if (!isMonsterEnhancerCard(c)) return;
  removeFromHand(player, cardId);
  room.combat.monsterModifier += c.bonus;
  room.doorDiscard.push(cardId);
  log(room, `${player.name} spielt "${c.name}" im Kampf (${c.bonus >= 0 ? '+' : ''}${c.bonus} für das Monster).`, [cardId]);
  touchRoom(room);
}

function handleRequestHelp(room, playerId, targetId) {
  if (!room.combat) return;
  const c = room.combat;
  if (c.actorId !== playerId || c.helperId) return;
  const target = findPlayer(room, targetId);
  if (!target || targetId === c.actorId) return;
  c.helperPending = { targetId };
  log(room, `${findPlayer(room, playerId).name} bittet ${target.name} um Hilfe.`);
  touchRoom(room);
}

function handleRespondHelp(room, playerId, accept) {
  if (!room.combat || !room.combat.helperPending) return;
  const c = room.combat;
  if (c.helperPending.targetId !== playerId) return;
  const target = findPlayer(room, playerId);
  if (accept) {
    c.helperId = playerId;
    log(room, `${target.name} hilft im Kampf.`);
  } else {
    log(room, `${target.name} lehnt ab.`);
  }
  c.helperPending = null;
  touchRoom(room);
}

function handleEvaluateCombat(room, playerId) {
  if (!room.combat) return;
  const c = room.combat;
  if (c.actorId !== playerId) return;
  const { playerStrength, monsterStrength } = combatTotals(room);
  if (playerStrength > monsterStrength) {
    resolveCombatWin(room);
  } else {
    c.mustFlee = true;
    log(room, `Kampfstärke reicht nicht (${playerStrength} vs. ${monsterStrength}). Fliehen nötig!`);
    touchRoom(room);
  }
}

function resolveCombatWin(room) {
  const c = room.combat;
  const actor = findPlayer(room, c.actorId);
  const helper = c.helperId ? findPlayer(room, c.helperId) : null;
  const monsters = c.monsterIds.map(card);
  const levelsGained = monsters.length; // 1 pro besiegtem Monster (Sonderfälle "steigt 2 Stufen" -> manuell nachjustieren)
  setLevel(actor, actor.level + levelsGained);
  const treasureCount = monsters.reduce((sum, m) => sum + (m.treasureCount || 0), 0);
  const drawn = [];
  for (let i = 0; i < treasureCount; i++) { const t = drawTreasure(room); if (t) drawn.push(t); }
  // einfache Aufteilung: alles an actor, außer helper wurde per Vorabsprache
  // (README) etwas zugesagt - hier immer erst alles an die/den Angreifer:in,
  // Weitergabe von Schätzen kann jederzeit frei "gehandelt" werden.
  drawn.forEach((id) => actor.hand.push(id));
  c.monsterIds.forEach((id) => room.doorDiscard.push(id));
  log(room, `${actor.name} besiegt ${monsters.map((m) => m.name).join(' + ')}! +${levelsGained} Stufe(n), ${treasureCount} Schatzkarte(n) gezogen.`, c.monsterIds);
  if (helper) log(room, `(${helper.name} hat geholfen.)`);
  room.combat = null;
  const won = checkWin(room, actor);
  if (!won) room.turnPhase = 'gabe';
  touchRoom(room);
}

function handleAttemptFlee(room, playerId, modifier) {
  if (!room.combat || !room.combat.mustFlee) return;
  const c = room.combat;
  if (c.actorId !== playerId) return;
  const actor = findPlayer(room, c.actorId);
  const roll = rollDie();
  const mod = Math.max(-9, Math.min(9, Math.round(Number(modifier) || 0)));
  const total = roll + mod;
  const success = total >= 5;
  log(room, `${actor.name} würfelt ${roll} (${mod >= 0 ? '+' : ''}${mod} = ${total}) zum Weglaufen: ${success ? 'geschafft!' : 'gescheitert!'}`);
  if (success) {
    c.monsterIds.forEach((id) => room.doorDiscard.push(id));
    room.combat = null;
    room.turnPhase = 'gabe';
  } else {
    const monsters = c.monsterIds.map(card);
    const badstuffText = monsters.map((m) => `${m.name}: ${m.badstuff || '(kein Text hinterlegt)'}`).join(' | ');
    c.monsterIds.forEach((id) => room.doorDiscard.push(id));
    room.combat = null;
    room.pendingConsequence = { playerId: actor.id, kind: 'loss', cardId: null, text: badstuffText };
  }
  touchRoom(room);
}

// ---------------------------------------------------------------------------
// Ausrüstung, Verkauf, Rasse/Klasse, Ablegen
// ---------------------------------------------------------------------------

function handleEquipItem(room, playerId, cardId) {
  const player = findPlayer(room, playerId);
  if (!player || !player.hand.includes(cardId)) return;
  const c = card(cardId);
  if (!c || c.category !== 'item') return;
  if (c.slotKind === 'head') { if (player.equipped.head) return; removeFromHand(player, cardId); player.equipped.head = cardId; }
  else if (c.slotKind === 'armor') { if (player.equipped.armor) return; removeFromHand(player, cardId); player.equipped.armor = cardId; }
  else if (c.slotKind === 'feet') { if (player.equipped.feet) return; removeFromHand(player, cardId); player.equipped.feet = cardId; }
  else if (c.slotKind === 'hand') {
    const freeSlots = player.equipped.hands.filter((h) => h === null).length;
    if (freeSlots < c.handsCost) return;
    removeFromHand(player, cardId);
    if (c.handsCost === 2) { player.equipped.hands = [cardId, cardId]; }
    else { const idx = player.equipped.hands.indexOf(null); player.equipped.hands[idx] = cardId; }
  } else return;
  log(room, `${player.name} legt "${c.name}" an.`, [cardId]);
  touchRoom(room);
}

function handleUnequipItem(room, playerId, cardId) {
  const player = findPlayer(room, playerId);
  if (!player) return;
  if (!equippedItemIds(player).includes(cardId)) return;
  unequipSlotCard(player, cardId);
  player.hand.push(cardId);
  const c = card(cardId);
  log(room, `${player.name} legt "${c ? c.name : cardId}" wieder in die Hand.`, [cardId]);
  touchRoom(room);
}

function handleSellItems(room, playerId, cardIds) {
  const player = findPlayer(room, playerId);
  if (!player) return;
  const ids = [...new Set(cardIds)];
  let total = 0;
  const removable = [];
  ids.forEach((id) => {
    const inHand = player.hand.includes(id);
    const inEquip = equippedItemIds(player).includes(id);
    if (!inHand && !inEquip) return;
    const c = card(id);
    if (!c || typeof c.gold !== 'number') return;
    total += c.gold;
    removable.push(id);
  });
  if (total < 1000) return;
  const levels = Math.floor(total / 1000);
  removable.forEach((id) => {
    if (player.hand.includes(id)) removeFromHand(player, id); else unequipSlotCard(player, id);
    discardCard(room, id);
  });
  setLevel(player, player.level + levels);
  log(room, `${player.name} legt Gegenstände im Wert von ${total} Goldstücken ab und steigt ${levels} Stufe(n) auf (jetzt Stufe ${player.level}).`);
  checkWin(room, player);
  touchRoom(room);
}

const RACE_NAMES = new Set(['ELF', 'ZWERG', 'HALBLING']);
const CLASS_NAMES = new Set(['KRIEGER', 'ZAUBERER', 'DIEB', 'PRIESTER']);

function handlePlayRaceOrClass(room, playerId, cardId) {
  const player = findPlayer(room, playerId);
  if (!player || !player.hand.includes(cardId)) return;
  const c = card(cardId);
  if (!c) return;
  const upper = c.name.toUpperCase();
  if (c.category === 'race') {
    if (player.races.length >= 1) return; // Super Munchkin/Halb-Blut-Sonderfall: manuell im Log vermerken
    removeFromHand(player, cardId);
    player.races.push(cardId);
  } else if (c.category === 'class') {
    if (player.classes.length >= 1) return;
    removeFromHand(player, cardId);
    player.classes.push(cardId);
  } else return;
  log(room, `${player.name} spielt "${c.name}".`, [cardId]);
  touchRoom(room);
}

function handleDiscardFromHand(room, playerId, cardId) {
  const player = findPlayer(room, playerId);
  if (!player || !player.hand.includes(cardId)) return;
  removeFromHand(player, cardId);
  discardCard(room, cardId);
  const c = card(cardId);
  log(room, `${player.name} legt "${c ? c.name : cardId}" ab.`, [cardId]);
  touchRoom(room);
}

function handleEndTurnAction(room, playerId) {
  const player = currentPlayer(room);
  if (!player || player.id !== playerId) return;
  if (room.turnPhase !== 'gabe') return;
  if (player.hand.length > HAND_LIMIT) return;
  endTurn(room);
  touchRoom(room);
}

// ---------------------------------------------------------------------------
// Handel zwischen Spielenden (Gold- und andere Karten) - jederzeit möglich,
// nicht an Zug/Phase gebunden, ganz wie am echten Tisch. Da Handkarten privat
// sind, kann man nur die eigenen Karten anbieten; die Gegenseite wählt beim
// Annehmen selbst, was sie (falls überhaupt) zurückgibt - so muss nie auf
// fremde Handkarten Bezug genommen werden, die man gar nicht kennt.
// ---------------------------------------------------------------------------

function handleProposeTrade(room, playerId, toId, offerCardIds) {
  const from = findPlayer(room, playerId);
  const to = findPlayer(room, toId);
  if (!from || !to || from.id === to.id || !to.connected) return;
  const ids = [...new Set(offerCardIds || [])].filter((id) => from.hand.includes(id));
  if (!ids.length) return;
  if (!room.trades) room.trades = [];
  // Nur ein offenes Angebot pro Richtung gleichzeitig - ein neues ersetzt ein altes.
  room.trades = room.trades.filter((t) => !(t.fromId === from.id && t.toId === to.id && t.status === 'pending'));
  room.trades.push({ id: makeId(), fromId: from.id, toId: to.id, offerCardIds: ids, status: 'pending', at: Date.now() });
  log(room, `${from.name} bietet ${to.name} einen Handel an (${ids.length} Karte(n)).`);
  touchRoom(room);
}

function handleCancelTrade(room, playerId, tradeId) {
  if (!room.trades) return;
  const trade = room.trades.find((t) => t.id === tradeId && t.status === 'pending' && t.fromId === playerId);
  if (!trade) return;
  room.trades = room.trades.filter((t) => t.id !== tradeId);
  const from = findPlayer(room, playerId);
  log(room, `${from.name} zieht ein Handelsangebot zurück.`);
  touchRoom(room);
}

function handleRespondTrade(room, playerId, tradeId, accept, counterCardIds) {
  if (!room.trades) return;
  const trade = room.trades.find((t) => t.id === tradeId && t.status === 'pending' && t.toId === playerId);
  if (!trade) return;
  const from = findPlayer(room, trade.fromId);
  const to = findPlayer(room, trade.toId);
  room.trades = room.trades.filter((t) => t.id !== tradeId);
  if (!from || !to) return;
  if (!accept) {
    log(room, `${to.name} lehnt den Handel von ${from.name} ab.`);
    touchRoom(room);
    return;
  }
  // Erneut gegen die aktuelle Hand prüfen - die Karten könnten seither
  // anderweitig verwendet worden sein (abgelegt, angelegt, verkauft, ...).
  const offerIds = trade.offerCardIds.filter((id) => from.hand.includes(id));
  const counterIds = [...new Set(counterCardIds || [])].filter((id) => to.hand.includes(id));
  offerIds.forEach((id) => { removeFromHand(from, id); to.hand.push(id); });
  counterIds.forEach((id) => { removeFromHand(to, id); from.hand.push(id); });
  const offerNames = offerIds.map((id) => card(id).name).join(', ') || '(nichts mehr davon verfügbar)';
  const counterNames = counterIds.length ? counterIds.map((id) => card(id).name).join(', ') : '(nichts zurück)';
  log(room, `Handel: ${from.name} gibt [${offerNames}] an ${to.name}, erhält dafür [${counterNames}].`, [...offerIds, ...counterIds]);
  touchRoom(room);
}

// ---------------------------------------------------------------------------
// Bots (einfache Heuristik - siehe README)
// ---------------------------------------------------------------------------

function addBot(room) {
  if (room.players.length >= MAX_PLAYERS) return null;
  const usedNames = new Set(room.players.map((p) => p.name));
  const name = BOT_NAME_POOL.find((n) => !usedNames.has(n)) || `Bot ${room.players.length + 1}`;
  const bot = newPlayer(name, null, true);
  room.players.push(bot);
  log(room, `${name} (Bot) wurde hinzugefügt.`);
  return bot;
}

const BOT_DELAY_MIN = Number(process.env.BOT_DELAY_MIN_MS) || 900;
const BOT_DELAY_MAX = Number(process.env.BOT_DELAY_MAX_MS) || 2200;
function randomDelay(min = BOT_DELAY_MIN, max = BOT_DELAY_MAX) { return min + Math.random() * (max - min); }

// Nur EIN ausstehender Bot-Timer pro Raum gleichzeitig - jeder neue Aufruf
// (z.B. durch broadcastState() nach jeder Aktion) ersetzt einen zuvor
// geplanten, noch nicht ausgelösten Timer, statt zusätzliche parallele
// Timer für denselben Bot-Zug anzuhäufen. Verhindert doppelt/mehrfach
// ausgeführte Bot-Aktionen bei schneller Aktionsfolge.
function scheduleBotActionsIfNeeded(room) {
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  if (room.phase !== 'playing') return;
  const actor = currentPlayer(room);
  if (!actor) return;

  // Konsequenz eines Bots automatisch bestätigen (ohne manuelle Anpassung -
  // ein Bot "spielt einfach den Text nach bestem Wissen selbst nicht aus").
  if (room.pendingConsequence) {
    const p = findPlayer(room, room.pendingConsequence.playerId);
    if (p && p.isBot) {
      const snapshot = room.pendingConsequence;
      room.botTimer = setTimeout(() => {
        room.botTimer = null;
        if (!rooms.has(room.code) || room.pendingConsequence !== snapshot) return;
        handleAckConsequence(room, p.id);
        broadcastState(room);
      }, randomDelay());
    }
    return;
  }

  if (room.combat) {
    const c = room.combat;
    if (c.helperPending) {
      const helper = findPlayer(room, c.helperPending.targetId);
      if (helper && helper.isBot) {
        room.botTimer = setTimeout(() => {
          room.botTimer = null;
          if (!rooms.has(room.code) || !room.combat || !room.combat.helperPending) return;
          handleRespondHelp(room, helper.id, false); // Bots helfen aktuell nicht (Vereinfachung)
          broadcastState(room);
        }, randomDelay());
      }
      return;
    }
    if (actor.isBot) {
      const snapshotCombat = c;
      room.botTimer = setTimeout(() => {
        room.botTimer = null;
        if (!rooms.has(room.code) || room.combat !== snapshotCombat) return;
        if (room.combat.mustFlee) handleAttemptFlee(room, actor.id, 0);
        else handleEvaluateCombat(room, actor.id);
        broadcastState(room);
      }, randomDelay());
    }
    return;
  }

  if (!actor.isBot) return;

  const snapshotPhase = room.turnPhase;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (!rooms.has(room.code) || room.phase !== 'playing') return;
    if (currentPlayer(room) !== actor || room.turnPhase !== snapshotPhase) return;
    if (room.turnPhase === 'tuer') {
      handleDrawDoor(room, actor.id);
    } else if (room.turnPhase === 'aerger') {
      // Bot spielt nie freiwillig ein Monster aus der Hand (Vereinfachung).
      handleSkipToLoot(room, actor.id);
    } else if (room.turnPhase === 'pluendern') {
      handleLootRoom(room, actor.id);
    } else if (room.turnPhase === 'gabe') {
      while (actor.hand.length > HAND_LIMIT) {
        handleDiscardFromHand(room, actor.id, actor.hand[actor.hand.length - 1]);
      }
      handleEndTurnAction(room, actor.id);
    }
    broadcastState(room);
  }, randomDelay());
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, cb) => {
    try {
      if (isRateLimited(`createRoom:${getClientIp(socket)}`, 8, 60 * 1000)) {
        return cb({ ok: false, error: 'Zu viele neue Räume in kurzer Zeit. Bitte kurz warten.' });
      }
      if (rooms.size >= MAX_ROOMS) return cb({ ok: false, error: 'Gerade zu viele aktive Räume. Bitte später erneut versuchen.' });
      name = (name || '').trim().slice(0, 20) || 'Spieler';
      const room = createRoom();
      const player = newPlayer(name, socket.id, false);
      room.hostId = player.id;
      room.players.push(player);
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      log(room, `${name} hat den Raum erstellt.`);
      cb({ ok: true, code: room.code, playerId: player.id, token: player.token });
      broadcastState(room);
    } catch (err) {
      cb({ ok: false, error: 'Raum konnte nicht erstellt werden.' });
    }
  });

  socket.on('joinRoom', ({ code, name, token }, cb) => {
    if (isRateLimited(`joinRoom:${getClientIp(socket)}`, 20, 60 * 1000)) {
      return cb({ ok: false, error: 'Zu viele Versuche. Bitte kurz warten.' });
    }
    code = (code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: 'Diesen Raum gibt es nicht.' });

    if (token) {
      const existing = room.players.find((p) => p.token === token);
      if (existing) {
        existing.socketId = socket.id;
        existing.connected = true;
        socket.join(room.code);
        socket.data.roomCode = room.code;
        socket.data.playerId = existing.id;
        log(room, `${existing.name} ist wieder verbunden.`);
        cb({ ok: true, code: room.code, playerId: existing.id, token: existing.token, rejoined: true });
        broadcastState(room);
        return;
      }
    }
    if (room.phase !== 'lobby') return cb({ ok: false, error: 'Das Spiel läuft bereits.' });
    if (room.players.length >= MAX_PLAYERS) return cb({ ok: false, error: `Der Raum ist voll (max. ${MAX_PLAYERS}).` });
    name = (name || '').trim().slice(0, 20) || 'Spieler';
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return cb({ ok: false, error: 'Dieser Name ist bereits vergeben.' });
    }
    const player = newPlayer(name, socket.id, false);
    room.players.push(player);
    if (!room.hostId) room.hostId = player.id;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    log(room, `${name} ist dem Raum beigetreten.`);
    cb({ ok: true, code: room.code, playerId: player.id, token: player.token });
    broadcastState(room);
  });

  socket.on('leaveRoom', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = findPlayer(room, socket.data.playerId);
    if (!player) return;
    if (room.phase === 'lobby') {
      room.players = room.players.filter((p) => p.id !== player.id);
      if (room.hostId === player.id) room.hostId = room.players.length ? room.players[0].id : null;
      log(room, `${player.name} hat den Raum verlassen.`);
    } else {
      player.connected = false;
      log(room, `${player.name} hat das Spiel verlassen.`);
    }
    socket.leave(room.code);
    socket.data.roomCode = null;
    socket.data.playerId = null;
    if (room.players.length === 0) rooms.delete(room.code); else broadcastState(room);
  });

  socket.on('addBot', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'lobby' || socket.data.playerId !== room.hostId) return;
    addBot(room);
    broadcastState(room);
  });

  socket.on('removeBot', ({ botId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'lobby' || socket.data.playerId !== room.hostId) return;
    const bot = findPlayer(room, botId);
    if (!bot || !bot.isBot) return;
    room.players = room.players.filter((p) => p.id !== botId);
    broadcastState(room);
  });

  socket.on('updateSets', (sets) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'lobby' || socket.data.playerId !== room.hostId) return;
    SET_KEYS.forEach((k) => { if (typeof sets[k] === 'boolean') room.settings.sets[k] = sets[k]; });
    if (!activeSetKeys(room).length) room.settings.sets.base = true;
    broadcastState(room);
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'lobby' || socket.data.playerId !== room.hostId) return;
    if (room.players.length < 1 || room.players.length > MAX_PLAYERS) return;
    startGame(room);
    broadcastState(room);
  });

  socket.on('resetGame', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.playerId !== room.hostId) return;
    room.phase = 'lobby';
    room.turnPhase = null;
    room.combat = null;
    room.pendingConsequence = null;
    room.winner = null;
    room.revealedDoorCard = null;
    log(room, 'Zurück zur Lobby.');
    broadcastState(room);
  });

  // --- Spielzüge ---
  socket.on('drawDoor', () => act(socket, (room, pid) => handleDrawDoor(room, pid)));
  socket.on('ackConsequence', () => act(socket, (room, pid) => handleAckConsequence(room, pid)));
  socket.on('applyConsequenceAction', (action) => act(socket, (room, pid) => handleApplyConsequenceAction(room, pid, action)));
  socket.on('playMonsterFromHand', ({ cardId }) => act(socket, (room, pid) => handlePlayMonsterFromHand(room, pid, cardId)));
  socket.on('skipToLoot', () => act(socket, (room, pid) => handleSkipToLoot(room, pid)));
  socket.on('lootRoom', () => act(socket, (room, pid) => handleLootRoom(room, pid)));
  socket.on('setCombatModifier', ({ who, value }) => act(socket, (room, pid) => handleSetCombatModifier(room, pid, who, value)));
  socket.on('playCombatCard', ({ cardId }) => act(socket, (room, pid) => handlePlayCombatCard(room, pid, cardId)));
  socket.on('proposeTrade', ({ toId, offerCardIds }) => act(socket, (room, pid) => handleProposeTrade(room, pid, toId, offerCardIds)));
  socket.on('cancelTrade', ({ tradeId }) => act(socket, (room, pid) => handleCancelTrade(room, pid, tradeId)));
  socket.on('respondTrade', ({ tradeId, accept, counterCardIds }) => act(socket, (room, pid) => handleRespondTrade(room, pid, tradeId, accept, counterCardIds)));
  socket.on('requestHelp', ({ targetId }) => act(socket, (room, pid) => handleRequestHelp(room, pid, targetId)));
  socket.on('respondHelp', ({ accept }) => act(socket, (room, pid) => handleRespondHelp(room, pid, accept)));
  socket.on('evaluateCombat', () => act(socket, (room, pid) => handleEvaluateCombat(room, pid)));
  socket.on('attemptFlee', ({ modifier }) => act(socket, (room, pid) => handleAttemptFlee(room, pid, modifier)));
  socket.on('equipItem', ({ cardId }) => act(socket, (room, pid) => handleEquipItem(room, pid, cardId)));
  socket.on('unequipItem', ({ cardId }) => act(socket, (room, pid) => handleUnequipItem(room, pid, cardId)));
  socket.on('sellItems', ({ cardIds }) => act(socket, (room, pid) => handleSellItems(room, pid, cardIds)));
  socket.on('playRaceOrClass', ({ cardId }) => act(socket, (room, pid) => handlePlayRaceOrClass(room, pid, cardId)));
  socket.on('discardFromHand', ({ cardId }) => act(socket, (room, pid) => handleDiscardFromHand(room, pid, cardId)));
  socket.on('endTurn', () => act(socket, (room, pid) => handleEndTurnAction(room, pid)));

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = findPlayer(room, socket.data.playerId);
    if (!player) return;
    player.connected = false;
    log(room, `${player.name} hat die Verbindung verloren.`);
    broadcastState(room);
  });
});

function act(socket, fn) {
  const room = rooms.get(socket.data.roomCode);
  if (!room || room.phase !== 'playing') return;
  const pid = socket.data.playerId;
  if (!pid) return;
  fn(room, pid);
  broadcastState(room);
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Munchkin läuft auf Port ${PORT}`);
    console.log(`Lokal öffnen unter: http://localhost:${PORT}`);
  });
}

module.exports = {
  shuffle, ALL_CARDS, CARDS_BY_ID, SET_KEYS, MIN_PLAYERS, MAX_PLAYERS, MAX_LEVEL, HAND_LIMIT,
};
