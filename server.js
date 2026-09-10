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
    powerGroups: [], // Machtgruppe (Pathfinder-Set): drittes Merkmal wie Rasse/Klasse
    raceCapCard: null, // HALB-BLUT, falls gehalten -> Rassen-Obergrenze 2 statt 1
    classCapCard: null, // SUPER MUNCHKIN, falls gehalten -> Klassen-Obergrenze 2 statt 1
    powerGroupCapCard: null, // DOPPELLEBEN, falls gehalten -> Machtgruppen-Obergrenze 2 statt 1
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
    pendingCardAction: null,
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

// Ein paar Gegenstände geben laut Kartentext einen zusätzlichen Bonus/Malus,
// der vom konkreten Monster im aktuellen Kampf abhängt (equippedBonusSum
// summiert nur den festen Grundbonus). Nur die Fälle, die sich anhand
// vorhandener Daten (Rasse, exakter Monstername) eindeutig berechnen lassen -
// Fälle, die einen fehlenden Datenpunkt bräuchten (z.B. eine "Untot"- oder
// "feuerimmun"-Kennzeichnung auf Monsterkarten, die es in den Daten nicht
// gibt), bleiben bewusst manuell (siehe README, Abschnitt Item-Sonderfälle).
const ITEM_CONDITIONAL_BONUS = {
  // "+2 Bonus für Elfen" - Grundbonus ist 1, für Elfen kommt 1 dazu.
  'GEILER HELM': (player, monsters) => (hasRace(player, 'ELF') ? 1 : 0),
  // "+10 gegen alles, was mit dem Buchstaben J beginnt."
  'VORPALE KLINGE': (player, monsters) => (monsters.some((m) => /^J/i.test(m.name || '')) ? 10 : 0),
  // "Gibt keinen Bonus gegen Krakzilla" - hebt den gedruckten Bonus (+4) wieder auf.
  'ALLES AUSSER KRAKZILLA ABSCHLACHTENDES SCHWERT': (player, monsters) => (monsters.some((m) => m.name === 'KRAKZILLA') ? -4 : 0),
  // "+5 gegen die Laufende Nase und den Schatten."
  'SCHRECKLICHE SOCKEN': (player, monsters) => (monsters.some((m) => m.name === 'LAUFENDE NASE' || m.name === 'SCHATTEN') ? 5 : 0),
};

function conditionalItemBonusSum(player, monsters) {
  if (!player || !monsters || !monsters.length) return 0;
  return equippedItemIds(player).reduce((sum, id) => {
    const c = card(id);
    const fn = c && ITEM_CONDITIONAL_BONUS[c.name];
    return sum + (fn ? fn(player, monsters) : 0);
  }, 0);
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
    powerGroups: p.powerGroups,
    raceCapCard: p.raceCapCard,
    classCapCard: p.classCapCard,
    powerGroupCapCard: p.powerGroupCapCard,
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
    combat: room.combat ? Object.assign({}, room.combat, combatConditionalBonusFields(room)) : null,
    pendingConsequence: room.pendingConsequence,
    pendingCardAction: room.pendingCardAction,
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
  } else if (c.category === 'curse' || DOOR_OTHER_AS_CURSE.has(c.name)) {
    room.pendingConsequence = { playerId: player.id, kind: 'curse', cardId: id, text: c.text || c.name, autoApplied: null, choice: null };
    room.doorDiscard.push(id);
    room.revealedDoorCard = null;
    log(room, `Fluch! ${player.name} muss die Auswirkung anwenden: "${c.name}".`, [id]);
    autoApplyLossConsequence(room, player, [{ name: c.name, text: c.text }]);
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
    applyDeathConsequence(room, player);
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

function applyDeathConsequence(room, player) {
  room.doorDiscard.push(...player.hand.filter((id) => card(id).type === 'door'));
  room.treasureDiscard.push(...player.hand.filter((id) => card(id).type === 'treasure'));
  room.doorDiscard.push(...equippedItemIds(player));
  player.hand = [];
  player.equipped = { head: null, armor: null, feet: null, hands: [null, null] };
  setLevel(player, 1);
}

// ---------------------------------------------------------------------------
// Automatische Berechnung von "Schlimme Dinge"/Fluch-Konsequenzen
// ---------------------------------------------------------------------------
// Wie bei den Monster-Verstärkerkarten oben gilt grundsätzlich das "Trust"-
// Prinzip (siehe Kommentar am Dateianfang): der Server zeigt den Original-
// text, Spieler:innen wenden ihn selbst an. Für "Schlimme Dinge" (verlorener
// Kampf) und Flüche gehen wir hier aber bewusst einen Schritt weiter, da
// diese Texte sich - anders als die hunderten sehr individuellen Sonder-
// kräfte - überwiegend auf eine begrenzte Menge klar erkennbarer Muster
// reduzieren lassen (Stufenverlust, Tod, fester Ausrüstungsverlust, würfel-
// basierte Effekte, Rassen-/Klassen-Bedingungen, echte Entweder-Oder-Wahl).
//
// Zwei Ebenen der Erkennung:
//  1) CONSEQUENCE_OVERRIDES: eine kuratierte, pro Kartenname geprüfte Tabelle
//     für alle Karten mit individueller, aber trotzdem eindeutig berechen-
//     barer Logik (Rassen-/Klassen-Bedingungen, Ausrüstungszustand, Werte-
//     Vergleiche, Wahlmöglichkeiten). Jede Regel ist unten mit dem exakten
//     Original-Kartentext kommentiert.
//  2) parseAutoConsequence: ein generischer Regex-Fallback für die übrigen,
//     immer wiederkehrenden einfachen Formulierungen ("Verliere N Stufen.").
//
// Bewusst AUSSERHALB des Umfangs (bleibt manuell, siehe Aufgabenstellung):
// alles, was ANDERE Spieler am Tisch betrifft (z. B. "jeder andere Spieler
// muss ..."), sowie die Handvoll Karten, die von Daten abhängen, die dieser
// Server nicht erfasst (Geschlecht, "Großer Gegenstand"-Flag, exakter
// Goldwert-Kombinationen) oder eine echte freie Auswahl unter mehreren
// eigenen Karten verlangen ("2 Gegenstände deiner Wahl" - dafür gibt es
// weiterhin das Ablege-Dropdown unten, das keine Rechnerei erfordert).
// Verifiziert gegen den kompletten Kartensatz, siehe tests/auto-consequence.test.js.

// Adjektiv-Formen, wie sie in Gegenstands-Texten für Rassen-/Klassen-Boni
// vorkommen (z.B. "+2 Bonus für Elfen"), gemappt auf den jeweiligen Karten-
// namen der Rassen-/Klassenkarte selbst ("ELF").
const RACE_ADJECTIVE_DE = { ELF: 'Elfen', ZWERG: 'Zwerge', HALBLING: 'Halblinge' };
const CLASS_ADJECTIVE_DE = { ZAUBERER: 'Zauberer', PRIESTER: 'Priester', DIEB: 'Diebe', KRIEGER: 'Krieger' };

function hasRace(player, substr) {
  return player.races.some((id) => { const c = card(id); return c && c.name && c.name.toUpperCase().includes(substr.toUpperCase()); });
}

function hasPowerGroup(player, name) {
  return player.powerGroups.some((id) => { const c = card(id); return c && c.name && c.name.toUpperCase() === name.toUpperCase(); });
}

function slotLabelDe(slot) {
  return { head: 'Kopfbedeckung', armor: 'Rüstung', feet: 'Schuhwerk' }[slot] || slot;
}

// Führt eine einzelne, bereits eindeutig aufgelöste Aktion aus und mutiert
// dabei room/player. Gibt eine kurze, menschenlesbare Beschreibung für Log/UI
// zurück.
function applyPrimitiveAction(room, player, action) {
  switch (action.type) {
    case 'death':
      applyDeathConsequence(room, player);
      return 'Tod';
    case 'levelDelta':
      setLevel(player, player.level - action.amount);
      return `-${action.amount} Stufe(n) (jetzt Stufe ${player.level})`;
    case 'levelUp':
      setLevel(player, player.level + action.amount);
      return `+${action.amount} Stufe(n) (jetzt Stufe ${player.level})`;
    case 'drawTreasureN': {
      const drawn = [];
      for (let i = 0; i < action.n; i++) { const t = drawTreasure(room); if (t) drawn.push(t); }
      drawn.forEach((id) => player.hand.push(id));
      return `${drawn.length} Schatzkarte(n) gezogen`;
    }
    case 'discardDoorCardsFromHand': {
      const ids = player.hand.filter((id) => { const c = card(id); return c && c.type === 'door'; });
      if (!ids.length) return 'keine Türkarten auf der Hand';
      ids.forEach((id) => removeFromHand(player, id));
      ids.forEach((id) => discardCard(room, id));
      return `Türkarte(n) abgelegt (${ids.map((id) => card(id).name).join(', ')})`;
    }
    case 'discardHandSlotItemElseLevel': {
      const ids = player.equipped.hands.filter(Boolean);
      if (!ids.length) return applyPrimitiveAction(room, player, { type: 'levelDelta', amount: 1 });
      const id = ids[0];
      unequipSlotCard(player, id);
      discardCard(room, id);
      return `Hand-Gegenstand "${card(id).name}" abgelegt`;
    }
    case 'setLevel1':
      setLevel(player, 1);
      return 'auf Stufe 1 gesetzt';
    case 'setLevelToTableMin': {
      const minLevel = Math.min(...room.players.map((p) => p.level));
      setLevel(player, minLevel);
      return `auf Stufe ${player.level} gesetzt (niedrigste Stufe am Tisch)`;
    }
    case 'diceLevelLoss': {
      const roll = rollDie();
      setLevel(player, player.level - roll);
      return `Würfelwurf ${roll} -> -${roll} Stufe(n)`;
    }
    case 'diceThresholdDeath': {
      const roll = rollDie();
      if (action.deathValues.includes(roll)) {
        applyDeathConsequence(room, player);
        return `Würfelwurf ${roll} -> Tod`;
      }
      setLevel(player, player.level - roll);
      return `Würfelwurf ${roll} -> -${roll} Stufe(n)`;
    }
    case 'discardSlot': {
      const id = player.equipped[action.slot];
      if (!id) return `${slotLabelDe(action.slot)}: nichts getragen`;
      player.equipped[action.slot] = null;
      discardCard(room, id);
      return `${slotLabelDe(action.slot)} "${card(id).name}" abgelegt`;
    }
    case 'discardAllEquipped': {
      const ids = equippedItemIds(player);
      if (!ids.length) return 'keine Ausrüstung getragen';
      ids.forEach((id) => discardCard(room, id));
      player.equipped = { head: null, armor: null, feet: null, hands: [null, null] };
      return `Ausrüstung abgelegt (${ids.map((id) => card(id).name).join(', ')})`;
    }
    case 'discardWholeHand': {
      const ids = [...player.hand];
      if (!ids.length) return 'Hand war leer';
      player.hand = [];
      ids.forEach((id) => discardCard(room, id));
      return `ganze Hand abgelegt (${ids.length} Karte(n))`;
    }
    case 'discardWholeHandWithBonusDraw': {
      const ids = [...player.hand];
      player.hand = [];
      ids.forEach((id) => discardCard(room, id));
      let extra = '';
      if (ids.length > 1) {
        const t = drawTreasure(room);
        if (t) { player.hand.push(t); extra = `, +1 Schatz gezogen ("${card(t).name}")`; }
      }
      return `ganze Hand abgelegt (${ids.length} Karte(n))${extra}`;
    }
    case 'discardRaceCards': {
      const ids = [...player.races];
      if (!ids.length) return 'keine Rassenkarte(n)';
      player.races = [];
      ids.forEach((id) => discardCard(room, id));
      if (player.raceCapCard) { discardCard(room, player.raceCapCard); player.raceCapCard = null; }
      return `Rassenkarte(n) abgelegt (${ids.map((id) => card(id).name).join(', ')})`;
    }
    case 'discardClassCards': {
      const ids = [...player.classes];
      if (!ids.length) return 'keine Klassenkarte(n)';
      player.classes = [];
      ids.forEach((id) => discardCard(room, id));
      if (player.classCapCard) { discardCard(room, player.classCapCard); player.classCapCard = null; }
      return `Klassenkarte(n) abgelegt (${ids.map((id) => card(id).name).join(', ')})`;
    }
    case 'discardSpecificClassCard': {
      const idx = player.classes.indexOf(action.cardId);
      if (idx < 0) return 'Klassenkarte nicht (mehr) vorhanden';
      const id = player.classes.splice(idx, 1)[0];
      discardCard(room, id);
      if (!player.classes.length && player.classCapCard) { discardCard(room, player.classCapCard); player.classCapCard = null; }
      return `Klassenkarte "${card(id).name}" abgelegt`;
    }
    // "Verliere zwei Karten": der/die Nächste bzw. Vorherige in der
    // Zugreihenfolge zieht je eine ZUFÄLLIGE Karte aus der Hand des Opfers
    // (welche genau, legt die Originalkarte nicht fest).
    case 'giveHandCardsToNeighbors': {
      if (!player.hand.length) return 'Hand war leer';
      const idx = room.players.findIndex((p) => p.id === player.id);
      const n = room.players.length;
      const results = [];
      const giveOne = (targetIdx) => {
        if (!player.hand.length) return;
        const target = room.players[targetIdx];
        if (!target || target.id === player.id) return;
        const cid = player.hand[Math.floor(Math.random() * player.hand.length)];
        removeFromHand(player, cid);
        target.hand.push(cid);
        results.push(`${target.name} erhält 1 Karte`);
      };
      if (n >= 2) giveOne((idx + 1) % n);
      if (n >= 3) giveOne((idx - 1 + n) % n);
      return results.length ? results.join('; ') : 'keine Mitspieler:innen vorhanden';
    }
    // "Regeln der Neuauflage": betrifft ALLE am Tisch, nicht nur die
    // ziehende Person (der Wunschring-Aufhebungs-Sonderfall bleibt manuell).
    case 'levelDeltaAllPlayers':
      room.players.forEach((p) => setLevel(p, p.level - action.amount));
      return `alle Spieler:innen -${action.amount} Stufe`;
    case 'discardPowerGroupCards': {
      const ids = [...player.powerGroups];
      if (!ids.length) return 'keine Machtgruppenkarte(n)';
      player.powerGroups = [];
      ids.forEach((id) => discardCard(room, id));
      if (player.powerGroupCapCard) { discardCard(room, player.powerGroupCapCard); player.powerGroupCapCard = null; }
      return `Machtgruppenkarte(n) abgelegt (${ids.map((id) => card(id).name).join(', ')})`;
    }
    // Sucht - beginnend mit der obersten Karte - im Türablagestapel nach der
    // ersten Karte der passenden Kategorie ("Rasse"/"Klasse"/Machtgruppe) und
    // ersetzt damit die eigene(n) verlorene(n) Karte(n); wird keine gefunden,
    // bleibt es beim reinen Verlust. Für WECHSLE DEINE KLASSE / WECHSLE DEINE
    // MACHTGRUPPE (die Rassen-Variante existiert im Kartensatz nicht).
    case 'replaceTraitFromDiscard': {
      const arrField = action.arrField; // 'classes' | 'powerGroups'
      const capField = action.capField; // 'classCapCard' | 'powerGroupCapCard'
      const currentIds = [...player[arrField]];
      if (!currentIds.length) return `${action.label} war bereits leer - Fluch wirkungslos`;
      currentIds.forEach((id) => discardCard(room, id));
      player[arrField] = [];
      if (player[capField]) { discardCard(room, player[capField]); player[capField] = null; }
      const matches = (action.category === 'class' || action.category === 'race')
        ? (cc) => cc.category === action.category
        : (cc) => cc.category === 'door_other' && POWER_GROUP_NAMES.has((cc.name || '').toUpperCase());
      for (let i = room.doorDiscard.length - 1; i >= 0; i--) {
        const cc = card(room.doorDiscard[i]);
        if (cc && matches(cc)) {
          room.doorDiscard.splice(i, 1);
          player[arrField].push(cc.id);
          return `${action.label} ersetzt durch "${cc.name}" (aus dem Ablagestapel)`;
        }
      }
      return `${action.label} verloren - keine passende Ersatzkarte im Ablagestapel gefunden`;
    }
    case 'discardOneRaceCardIfAny': {
      if (!player.races.length) return 'war bereits ohne (nicht-menschliche) Rasse';
      const id = player.races.shift();
      discardCard(room, id);
      return `Rassenkarte "${card(id).name}" abgelegt`;
    }
    case 'discardClassCardMatchingElseDeath': {
      const idx = player.classes.findIndex((id) => { const c = card(id); return c && c.name && c.name.toUpperCase().includes(action.substr.toUpperCase()); });
      if (idx >= 0) {
        const id = player.classes.splice(idx, 1)[0];
        discardCard(room, id);
        return `Klassenkarte "${card(id).name}" abgelegt (statt Tod)`;
      }
      applyDeathConsequence(room, player);
      return 'Tod (keine passende Klasse)';
    }
    case 'discardMaxBonusItem': {
      const ids = equippedItemIds(player);
      let best = null;
      ids.forEach((id) => { const c = card(id); if (c && c.bonus && (!best || c.bonus > card(best).bonus)) best = id; });
      if (!best) return 'kein Gegenstand mit Bonus getragen';
      unequipSlotCard(player, best);
      discardCard(room, best);
      return `Gegenstand mit größtem Bonus abgelegt ("${card(best).name}")`;
    }
    case 'discardMaxGoldItem': {
      const ids = equippedItemIds(player);
      let best = null;
      ids.forEach((id) => { const c = card(id); const g = (c && c.gold) || 0; if (!best || g > ((card(best) && card(best).gold) || 0)) best = id; });
      if (!best) return 'keinen Gegenstand getragen';
      unequipSlotCard(player, best);
      discardCard(room, best);
      return `Gegenstand mit höchstem Goldwert abgelegt ("${card(best).name}")`;
    }
    case 'discardTraitBonusItems': {
      const traitIds = action.which === 'race' ? player.races : player.classes;
      const adjMap = action.which === 'race' ? RACE_ADJECTIVE_DE : CLASS_ADJECTIVE_DE;
      const adjectives = traitIds.map((id) => { const c = card(id); return c && adjMap[(c.name || '').toUpperCase()]; }).filter(Boolean);
      if (!adjectives.length) return `keine aktuelle ${action.which === 'race' ? 'Rasse' : 'Klasse'} mit bekanntem Bonus-Muster`;
      const ids = equippedItemIds(player).filter((id) => {
        const c = card(id);
        return c && adjectives.some((adj) => new RegExp(`für\\s+${adj}`, 'i').test(c.text || ''));
      });
      if (!ids.length) return 'keine passenden Bonus-Gegenstände getragen';
      ids.forEach((id) => { unequipSlotCard(player, id); discardCard(room, id); });
      return `Gegenstände abgelegt (${ids.map((id) => card(id).name).join(', ')})`;
    }
    case 'discardItemsAboveBonus': {
      const ids = equippedItemIds(player).filter((id) => { const c = card(id); return c && typeof c.bonus === 'number' && c.bonus > action.threshold; });
      if (!ids.length) return `keine Gegenstände über +${action.threshold} Bonus`;
      ids.forEach((id) => { unequipSlotCard(player, id); discardCard(room, id); });
      return `Gegenstände über +${action.threshold} Bonus abgelegt (${ids.map((id) => card(id).name).join(', ')})`;
    }
    case 'discardItemsByTextMatch': {
      const re = action.pattern;
      const ids = equippedItemIds(player).filter((id) => { const c = card(id); return c && (re.test(c.name || '') || re.test(c.text || '')); });
      if (!ids.length) return 'keine passenden Gegenstände getragen';
      ids.forEach((id) => { unequipSlotCard(player, id); discardCard(room, id); });
      return `Gegenstände abgelegt (${ids.map((id) => card(id).name).join(', ')})`;
    }
    case 'discardHandCardsMatching': {
      const ids = player.hand.filter((id) => action.predicate(card(id)));
      if (!ids.length) return 'keine passenden Karten auf der Hand';
      ids.forEach((id) => removeFromHand(player, id));
      ids.forEach((id) => discardCard(room, id));
      return `Karte(n) abgelegt (${ids.map((id) => card(id).name).join(', ')})`;
    }
    case 'combo':
      return action.actions.map((a) => applyPrimitiveAction(room, player, a)).join('; ');
    case 'noEffect':
      return 'kein spielmechanischer Effekt';
    default:
      return '';
  }
}

// Kuratierte Sonderfälle (siehe Erklärung oben). Schlüssel = exakter Karten-
// name aus data/cards.json. Jede Funktion bekommt (player, room) und gibt
// zurück: eine Aktion (siehe applyPrimitiveAction) zum automatischen
// Anwenden, `null` um EXPLIZIT den generischen Fallback zu unterdrücken
// (bleibt manuell), oder `undefined` um an den generischen Regex-Fallback
// durchzureichen.
const CONSEQUENCE_OVERRIDES = {
  // --- Eindeutiger Tod in ungewöhnlicher Formulierung ---
  'BULLROG': () => ({ type: 'death' }), // "Du wirst zu Tode gepeitscht."
  'JUDGE FREDD': () => ({ type: 'death' }), // "Er prügelt dich zu Tode ..."
  'KALI': () => ({ type: 'death' }), // "Stirb, stirb, stirb ..."
  'TENTAKELDÄMON': () => ({ type: 'death' }), // "Wenn du gefangen wirst, stirbst du." (Kontext: Flucht ist bereits gescheitert)
  'SIEBENJÄHRIGER LICH': () => ({ type: 'death' }), // "Wenn er dich erwischt, stirbst du ..."
  // Enthält zwar "stirbst", bezieht sich aber auf einen ZUKÜNFTIGEN Tod
  // (persistenter Fluch) - explizit NICHT automatisch:
  'VERFLUCHTER GEGENSTAND': () => null,

  // --- Reine Flavor-Texte ohne Spielmechanik ---
  'GOLDFISCH': () => ({ type: 'noEffect' }), // "Du musst den Hohn der anderen Spieler ertragen."
  'TOPFPFLANZE': () => ({ type: 'noEffect' }), // "Keine. Automatische Flucht."

  // --- Fester Ausrüstungsverlust (kein Auswahl nötig) ---
  'BIGFOOT': () => ({ type: 'discardSlot', slot: 'head' }),
  'RIESENKAKERLAKE': () => ({ type: 'discardSlot', slot: 'head' }),
  'FÜRST YAHOO': () => ({ type: 'discardSlot', slot: 'head' }),
  'RAPIER-TROTTEL': () => ({ type: 'discardSlot', slot: 'armor' }),
  'DRECKIGE GÄNSE': () => ({ type: 'discardSlot', slot: 'feet' }),
  'GIFTEFEU KUDZU-FLIEGENFALLE': () => ({ type: 'combo', actions: [{ type: 'discardSlot', slot: 'armor' }, { type: 'discardSlot', slot: 'head' }] }),
  'FILZLAUSE': () => ({ type: 'combo', actions: [{ type: 'discardSlot', slot: 'armor' }, { type: 'discardSlot', slot: 'feet' }] }),
  'KÖNIG TUT': () => ({ type: 'combo', actions: [{ type: 'discardAllEquipped' }, { type: 'discardWholeHand' }] }),
  // Persistenter "-10 gegen Pflanzen"-Malus wird - wie andere Dauereffekte
  // im Spiel - nicht mechanisch durchgesetzt, nur der sofortige Teil:
  'REDNECK-BAUM': () => ({ type: 'combo', actions: [{ type: 'discardSlot', slot: 'armor' }, { type: 'levelDelta', amount: 2 }] }),
  'TANTE PALADIN': () => ({ type: 'combo', actions: [{ type: 'discardSlot', slot: 'armor' }, { type: 'levelDelta', amount: 3 }] }),

  // --- Ganze Hand ablegen ---
  'PIKOTZU': () => ({ type: 'discardWholeHand' }),
  'TEDDYBÄR': () => ({ type: 'discardWholeHandWithBonusDraw' }), // "... mehr als eine Karte abgelegt -> Schatz ziehen"

  // --- Rassen-/Klassenkarten ---
  'KREISCHENDER DEPP': () => ({ type: 'combo', actions: [{ type: 'discardRaceCards' }, { type: 'discardClassCards' }] }),
  'WERSCHILDKRÖTE': () => ({ type: 'discardOneRaceCardIfAny' }), // Halb-Blut verliert eine Rasse, reiner Mensch: nichts
  'AMAZONE': (player) => (player.classes.length ? { type: 'discardClassCards' } : { type: 'levelDelta', amount: 3 }),
  'UNGLAUBLICHER UNAUSSPRECHLICHER SCHRECKEN': () => ({ type: 'discardClassCardMatchingElseDeath', substr: 'ZAUBERER' }),

  // --- Rassen-bedingte Stufenzahl ---
  'ZUNGENDÄMON': (player) => ({ type: 'levelDelta', amount: hasRace(player, 'ELF') ? 3 : 2 }),
  // Verdopplung bei angehängtem "Gigantisch" wird nicht erkannt (dafür gibt
  // es kein Datenfeld an dieser Stelle) - Basis-Effekt wird trotzdem berechnet:
  'FUNGUS': (player) => ({ type: 'levelDelta', amount: hasRace(player, 'ELF') ? 2 : 1 }),

  // --- Bedingt auf aktuellen Ausrüstungszustand (zum Zeitpunkt der Konsequenz bekannt) ---
  'FEDERFEIND': (player) => (player.equipped.head ? { type: 'discardSlot', slot: 'head' } : { type: 'levelDelta', amount: 2 }),
  'SABBERNDER SCHLEIM': (player) => (player.equipped.feet ? { type: 'discardSlot', slot: 'feet' } : { type: 'levelDelta', amount: 1 }),
  'ÜBERBÄR': (player) => (player.equipped.armor ? { type: 'noEffect' } : { type: 'levelDelta', amount: 1 }),
  'GESICHTSSAUGER': () => ({ type: 'combo', actions: [{ type: 'discardSlot', slot: 'head' }, { type: 'levelDelta', amount: 1 }] }),

  // --- Würfelbasiert ---
  '3.872 ORKS': () => ({ type: 'diceThresholdDeath', deathValues: [1, 2] }), // "bei 1/2 Tod, sonst so viele Stufen wie gewürfelt"
  'DIE TROLLE VOM TOTEN MEER': () => ({ type: 'diceLevelLoss' }),
  'FEUERLÖSCHER': () => ({ type: 'diceLevelLoss' }),
  // "+1 Stufe zurück je sofort abgelegtem Trank" wird nicht erkannt (kein
  // Datenfeld für "Trank") - nur der garantierte Basis-Verlust:
  'GRASGNOLL': () => ({ type: 'levelDelta', amount: 3 }),

  // --- Werte-/textbasierter Gegenstandsverlust ---
  'WIRKLICH BESCHISSENER FLUCH!': () => ({ type: 'discardMaxBonusItem' }),
  'DRYADE': () => ({ type: 'discardItemsAboveBonus', threshold: 2 }),
  'EISRIESE': () => ({ type: 'discardItemsByTextMatch', pattern: /feuer|flamme/i }),
  'Harter Typ': () => ({ type: 'discardHandCardsMatching', predicate: (c) => !!c && (c.category === 'monster' || isMonsterEnhancerCard(c)) }),

  // --- Eigene Tischwerte (keine Fremdeinwirkung auf andere Spieler) ---
  'GEMEINE GHOULE': () => ({ type: 'setLevelToTableMin' }),
  'PACKRATTE': () => ({ type: 'discardMaxGoldItem' }),
  'ROTZ-ELEMENTAR': () => ({ type: 'discardTraitBonusItems', which: 'race' }),
  'DING MIT EINEM ÜBERLANGEN NAMEN, DESSEN BILD NICHT AUF DIE KARTE PASST': () => ({ type: 'discardTraitBonusItems', which: 'class' }),
  // "... und 1 kleinen Gegenstand" bleibt bewusst manuell (freie Auswahl über
  // das Ablege-Dropdown) - nur der garantierte Stufenverlust wird berechnet:
  'AFFENBANDE': () => ({ type: 'levelDelta', amount: 1 }),

  // --- Echte Entweder-Oder-Wahl: zwei Buttons statt Rechnerei ---
  'ENTIKOR': () => ({
    type: 'choice',
    options: [
      { id: 'hand', label: 'Ganze Hand ablegen', action: { type: 'discardWholeHand' } },
      { id: 'levels', label: '2 Stufen verlieren', action: { type: 'levelDelta', amount: 2 } },
    ],
  }),
  'JABBERWOCK': () => ({
    type: 'choice',
    options: [
      { id: 'level1', label: 'Auf Stufe 1 zurückkehren', action: { type: 'setLevel1' } },
      { id: 'items', label: 'Alle Gegenstände verlieren', action: { type: 'discardAllEquipped' } },
    ],
  }),

  // --- Fehlkategorisierte Flüche (Pathfinder-Set): stehen in den Rohdaten in
  // "door_other" statt "curse", sind aber textlich eindeutig sofort beim
  // Ziehen wirkende Flüche (gleiche Wortwahl/Perspektive wie die echten
  // Fluch-Karten oben) - siehe DOOR_OTHER_AS_CURSE unten, das sie über
  // denselben Mechanismus wie echte Flüche laufen lässt. ---
  'SCHUHSUPPE': () => ({ type: 'discardSlot', slot: 'feet' }), // "VERLIERE DEIN SCHUHWERK"
  'OHRWÜRMER': () => ({ type: 'discardSlot', slot: 'head' }), // "VERLIERE DEINE KOPFBEDECKUNG."
  'ANTHRAKITIS': () => ({ type: 'levelDelta', amount: 1 }), // "VERLIERE 1 STUFE"
  'BRANDBAUCH': () => ({ type: 'levelDelta', amount: 1 }), // "VERLIERE 1 STUFE"
  'VERLIERE DEINE KLASSE!': () => ({ type: 'discardClassCards' }),
  'VERLIERE DEINE MACHTGRUPPE!': () => ({ type: 'discardPowerGroupCards' }),
  'WECHSLE DEINE KLASSE': () => ({ type: 'replaceTraitFromDiscard', arrField: 'classes', capField: 'classCapCard', category: 'class', label: 'Klasse' }),
  'WECHSLE DEINE MACHTGRUPPE': (player, room) => ({ type: 'replaceTraitFromDiscard', arrField: 'powerGroups', capField: 'powerGroupCapCard', category: 'door_other', label: 'Machtgruppe' }),
  'SACKGASSE': () => ({ type: 'discardDoorCardsFromHand' }), // "Lege alle Türkarten aus deiner Hand ab."
  'VERSAGEN BEI DER PRÜFUNG DES STERNSTEINS': () => ({ type: 'discardMaxBonusItem' }), // "Lege den Gegenstand ab, der dir den größten Kampfbonus gewährt."
  'ROTE VERZIERUNG': () => ({ type: 'discardHandSlotItemElseLevel' }), // "VERLIERE 1 HAND-GEGENSTAND, sonst 1 Stufe"
  // "Verliere 1 Stufe" + Sonderklausel bei "ausdrücklich an den Knien
  // getragenem" Gegenstand - dafür gibt es kein Datenfeld, nur die
  // garantierte Basis-Stufe wird automatisch verrechnet:
  'EXPLODIERENDE KNIESCHÜTZER': () => ({ type: 'levelDelta', amount: 1 }),
  // "Verliere 1 Stufe. Kundschafter können ihre Machtgruppe ablegen, anstatt
  // 1 Stufe zu verlieren" - jetzt, wo Machtgruppen erfasst werden, als echte
  // Wahl abbildbar:
  'VERLIERE DEN PFAD': (player) => (hasPowerGroup(player, 'KUNDSCHAFTER')
    ? { type: 'choice', options: [
        { id: 'level', label: '1 Stufe verlieren', action: { type: 'levelDelta', amount: 1 } },
        { id: 'group', label: 'Machtgruppe (Kundschafter) ablegen', action: { type: 'discardPowerGroupCards' } },
      ] }
    : { type: 'levelDelta', amount: 1 }),
  // Bewusst NICHT automatisch: "Großer Gegenstand"-Bezug (kein Datenfeld) -
  // bleibt manuell, wie die anderen "Großer Gegenstand"-Fälle im Spiel:
  'GRÜNSCHLEIM': () => null,
  // Betrifft, WELCHE Karte(n) andere Spieler:innen von der eigenen Hand
  // nehmen (freie/zufällige Auswahl, in den Rohdaten nicht festgelegt) -
  // bleibt bewusst manuell:
  'SCHARLACHLEPRA': () => null,
  // Freie Auswahl "irgendein kleiner Gegenstand ablegen" (hier ist ohnehin
  // JEDER Gegenstand "klein", da kein "Großer Gegenstand"-Datenfeld
  // existiert) - dafür gibt es schon die generischen Ablegen-Knöpfe, bleibt
  // bewusst manuell statt einer erzwungenen Wahl:
  'HÄNGENGELASSEN': () => null,
  'SCHNELLES GELD': () => null,
  // Hat einen alternativen Kampf-Einsatz ("+3 für Monster bei Goblins")
  // zusätzlich zum Sofort-Effekt - nur der Sofort-Effekt wird automatisch
  // berechnet, der Kampf-Bonus bleibt (wie bei Monster-Verstärkern mit
  // Zusatzklauseln) manuell:
  'GOBLINAUSSCHLAG': () => ({ type: 'discardSlot', slot: 'armor' }), // "DU VERLIERST DEINE RÜSTUNG"

  // --- Fluch, der die Konsequenz des obersten Monsters im Ablagestapel auslöst ---
  'STERBENDER FLUCH': (player, room) => {
    for (let i = room.doorDiscard.length - 1; i >= 0; i--) {
      const c = card(room.doorDiscard[i]);
      if (c && c.category === 'monster') {
        return resolveConsequenceSpec(c.name, c.badstuff, player, room) || { type: 'noEffect' };
      }
    }
    return { type: 'noEffect' };
  },

  // --- Fehlkategorisierte Flüche (Basis-Set + Erweiterungen): stehen in den
  // Rohdaten in "door_other" statt "curse", sind aber textlich eindeutig
  // sofort beim Ziehen wirkende Flüche - siehe DOOR_OTHER_AS_CURSE unten. ---
  'Rüstung verlieren': () => ({ type: 'discardSlot', slot: 'armor' }),
  'Kopfbedeckung verlieren': () => ({ type: 'discardSlot', slot: 'head' }),
  'SCHUHWERK VERLIEREN': () => ({ type: 'discardSlot', slot: 'feet' }),
  'VERLIERE 1 STUFE': () => ({ type: 'levelDelta', amount: 1 }),
  'VERLIERE DEINE KLASSE': (player) => {
    if (player.classes.length >= 2) {
      return {
        type: 'choice',
        options: player.classes.map((cid) => ({
          id: `class-${cid}`,
          label: `${card(cid) ? card(cid).name : 'Klasse'} ablegen`,
          action: { type: 'discardSpecificClassCard', cardId: cid },
        })),
      };
    }
    if (player.classes.length === 1) return { type: 'discardClassCards' };
    return { type: 'levelDelta', amount: 1 };
  },
  'VERLIERE DEINE RASSE': () => ({ type: 'discardRaceCards' }),
  'KLASSE WECHSELN': () => ({ type: 'replaceTraitFromDiscard', arrField: 'classes', capField: 'classCapCard', category: 'class', label: 'Klasse' }),
  'RASSE WECHSELN': () => ({ type: 'replaceTraitFromDiscard', arrField: 'races', capField: 'raceCapCard', category: 'race', label: 'Rasse' }),
  // "Du darfst kein Schuhwerk tragen. Wenn du gerade Schuhwerk trägst, wird
  // es zerstört ...":
  'QUANTEN': (player) => (player.equipped.feet ? { type: 'discardSlot', slot: 'feet' } : { type: 'noEffect' }),
  'REGELN DER NEUAUFLAGE': () => ({ type: 'levelDeltaAllPlayers', amount: 1 }), // Wunschring-Sonderfall bleibt manuell
  // "Du kannst keine Gegenstände tragen, die mehr als eine Hand benötigen." -
  // Dauereffekt, den dieser Server (wie andere Dauer-Mali) nicht mechanisch
  // durchsetzt; nur zur Anzeige als Fluch, kein Sofort-Effekt:
  'WINZIGE HÄNDE': () => ({ type: 'noEffect' }),
  'VERLIERE ZWEI KARTEN': () => ({ type: 'giveHandCardsToNeighbors' }),
  // "Verliere 2 Stufen" (fällt bereits unter den generischen Fallback, hier
  // nur zur Klarheit/Dokumentation nicht nötig - kein Override nötig).
  // Bewusst NICHT automatisch (freie Auswahl aus dem gesamten Ablagestapel
  // ohne Wertgrenze in den Rohdaten, o.ä.) - bleibt manuell:
  'VERLIERE 1 GROSSEN GEGENSTAND': () => null,
  'VERLIERE 1 KLEINEN GEGENSTAND': () => null,
  // Persistente Mali/Flags ohne laufenden Status-Tracker in diesem Server -
  // bleiben nach dem Einordnen als Fluch bewusst manuell/nur textlich:
  'GESCHLECHTSUMWANDLUNG': () => null,
  'HUHN AUF DEINEM KOPF': () => null,
  'NARRENGOLD': () => null,
  'BLUTSCHLEIER': () => null,
  'RAUSCHPOCKEN': () => null,
  'TOURISTENFALLE': () => null,
  'MIESER SPIEGEL': () => null,
  'STINKER': () => null,
  // Braucht Datenpunkte/Mechaniken, die es hier nicht gibt (freie Handel-
  // Reihenfolge, wiederkehrender Rundenend-Hook, neue Kampfauslösung
  // mitten in der Konsequenz-Auflösung, unterdrückter Rassen/Klassen-
  // Status) - bleiben bewusst manuell:
  'EDELMUT': () => null,
  'HUNGRIGER RUCKSACK': () => null,
  'KLEINER FEHLER': () => null,
  'TEMPORÄRE ANMNESIE': () => null,
  'DU STOLPERST ÜBER DEINE EIGENE TRUHE': () => null,
};

// Karten aus dem Pathfinder-Set, die in den Rohdaten als "door_other"
// geführt werden, aber - anders als die übrigen "Sonstige"-Türkarten -
// textlich eindeutig sofort beim Ziehen wirkende Flüche sind (gleiche
// Perspektive/Wortwahl wie die 4 echten "curse"-Karten, siehe Vergleich in
// README). handleDrawDoor behandelt sie deshalb wie echte Fluch-Karten statt
// sie kommentarlos auf die Hand zu legen.
const DOOR_OTHER_AS_CURSE = new Set([
  'SCHUHSUPPE', 'OHRWÜRMER', 'ANTHRAKITIS', 'BRANDBAUCH', 'SACKGASSE',
  'VERLIERE DEINE KLASSE!', 'VERLIERE DEINE MACHTGRUPPE!',
  'WECHSLE DEINE KLASSE', 'WECHSLE DEINE MACHTGRUPPE',
  'VERSAGEN BEI DER PRÜFUNG DES STERNSTEINS', 'ROTE VERZIERUNG',
  'EXPLODIERENDE KNIESCHÜTZER', 'VERLIERE DEN PFAD', 'GRÜNSCHLEIM',
  'SCHARLACHLEPRA', 'HÄNGENGELASSEN', 'SCHNELLES GELD', 'GOBLINAUSSCHLAG',
  // Basis-Set + Erweiterungen (siehe CONSEQUENCE_OVERRIDES oben für Details
  // zu jeder einzelnen Karte):
  'Rüstung verlieren', 'Kopfbedeckung verlieren', 'SCHUHWERK VERLIEREN',
  'VERLIERE 1 STUFE', 'VERLIERE DEINE KLASSE', 'VERLIERE DEINE RASSE',
  'KLASSE WECHSELN', 'RASSE WECHSELN', 'QUANTEN', 'REGELN DER NEUAUFLAGE',
  'WINZIGE HÄNDE', 'VERLIERE ZWEI KARTEN', 'VERLIERE 1 GROSSEN GEGENSTAND',
  'VERLIERE 1 KLEINEN GEGENSTAND', 'GESCHLECHTSUMWANDLUNG',
  'HUHN AUF DEINEM KOPF', 'NARRENGOLD', 'BLUTSCHLEIER', 'RAUSCHPOCKEN',
  'TOURISTENFALLE', 'EDELMUT', 'HUNGRIGER RUCKSACK', 'KLEINER FEHLER',
  'TEMPORÄRE ANMNESIE', 'DU STOLPERST ÜBER DEINE EIGENE TRUHE',
  'ENTE DES SCHRECKENS', 'MIESER SPIEGEL', 'STINKER',
]);

const CONSEQUENCE_CONDITIONAL_RE = /\b(wenn|falls|sofern|es sei denn|außer|ansonsten|andernfalls|entweder)\b/i;
const CONSEQUENCE_CHOICE_OR_RE = /\bStufen?\b.{0,20}\boder\b|\boder\b.{0,20}\bStufen?\b/i;
// Wortgrenzen sind hier wichtig: ohne \b würde z.B. "Elfen" auch in "helfen"
// anschlagen und fälschlich einen eigentlich eindeutigen Text ausschließen.
const CONSEQUENCE_ITEM_OR_TRAIT_RE = /\bGegenst[aä]nde?\w*\b|\bRüstung\w*\b|\bKopfbedeckung\w*\b|\bSchuhwerk\w*\b|\bKlasse\w*\b|\bRasse\w*\b|\bHand\s+ab\b|\bMänner\b|\bFrauen\b|\bHalbling\w*\b|\bElfen\b|\bZwerg\w*\b/i;

// Generischer Fallback für die übrigen, immer wiederkehrenden einfachen
// Formulierungen (siehe Erklärung oben). Wird nur benutzt, wenn kein Eintrag
// in CONSEQUENCE_OVERRIDES existiert.
const GERMAN_NUMBER_WORDS = { eine: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6 };

function parseAutoConsequence(rawText) {
  if (!rawText) return null;
  const t = String(rawText).replace(/\\n/g, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[bi]>/gi, '');
  if (/\bdu\s+bist\s+tot\b/i.test(t) || /\bstirbst?\b/i.test(t) || /zu\s+Tode\s+\w+/i.test(t)) return { type: 'death' };
  if (/w[üu]rfle/i.test(t) && /stufen/i.test(t) && /gew[üu]rfelt/i.test(t)) return { type: 'diceLevelLoss' };
  const excluded = () => t.includes('(') || CONSEQUENCE_CONDITIONAL_RE.test(t) || CONSEQUENCE_CHOICE_OR_RE.test(t) || CONSEQUENCE_ITEM_OR_TRAIT_RE.test(t);
  const NUM = '(\\d+|eine|zwei|drei|vier|fünf|sechs)';
  const toAmount = (s) => (/^\d+$/.test(s) ? parseInt(s, 10) : GERMAN_NUMBER_WORDS[s.toLowerCase()]);
  // Verb zuerst: "Verliere(st) 2/zwei Stufen." / "... kostet dich 2 Stufen."
  let m = t.match(new RegExp(`(?:verlier\\w*|kostet)\\s+(?:du\\s+|dich\\s+)?${NUM}\\s+Stufen?\\b`, 'i'));
  // Zahl zuerst: "Zwei/2 Stufen verlieren."
  if (!m) m = t.match(new RegExp(`\\b${NUM}\\s+Stufen?\\s+verlier\\w*`, 'i'));
  if (m) {
    if (excluded()) return null;
    return { type: 'levelDelta', amount: toAmount(m[1]) };
  }
  if (/auf\s+Stufe\s+1\s+(reduziert|zur[üu]ckgesetzt|gesetzt)/i.test(t)) return { type: 'setLevel1' };
  return null;
}

// Löst EINE Quelle (ein Monster oder ein Fluch) auf: erst die kuratierte
// Override-Tabelle (per exaktem Kartennamen), sonst der generische Fallback.
function resolveConsequenceSpec(name, text, player, room) {
  const override = CONSEQUENCE_OVERRIDES[name];
  if (override) {
    const result = override(player, room);
    if (result !== undefined) return result; // null = bewusst manuell, sonst eine Aktion
  }
  return parseAutoConsequence(text);
}

// Wendet - wo eindeutig erkennbar - die Konsequenz(en) für eine verlorene
// Kampfrunde (ein oder mehrere Monster) oder einen Fluch automatisch an und
// trägt das Ergebnis direkt in room.pendingConsequence ein (muss von der
// aufrufenden Stelle bereits gesetzt sein). `sources` ist eine Liste von
// {name, text}. Bietet eine Karte eine echte Wahl an UND ist sie die
// einzige Quelle, wird stattdessen `pendingConsequence.choice` gesetzt und
// auf die Antwort der Spielerin gewartet (siehe handleResolveConsequenceChoice).
function autoApplyLossConsequence(room, player, sources) {
  const pc = room.pendingConsequence;
  if (!pc) return;
  if (sources.length === 1) {
    const spec = resolveConsequenceSpec(sources[0].name, sources[0].text, player, room);
    if (spec && spec.type === 'choice') {
      pc.choice = { sourceName: sources[0].name, options: spec.options.map((o) => ({ id: o.id, label: o.label })) };
      room._pendingChoiceActions = {};
      spec.options.forEach((o) => { room._pendingChoiceActions[o.id] = o.action; });
      return;
    }
  }
  const parts = [];
  sources.forEach((s) => {
    const spec = resolveConsequenceSpec(s.name, s.text, player, room);
    if (!spec || spec.type === 'choice') return; // Mehrere Quellen mit echter Wahl gleichzeitig: bewusst manuell
    const desc = applyPrimitiveAction(room, player, spec);
    if (desc) parts.push(`${s.name}: ${desc}`);
  });
  if (parts.length) {
    pc.autoApplied = parts.join('; ');
    log(room, `${player.name}: Automatisch berechnet - ${pc.autoApplied}.`);
  }
}

function handleResolveConsequenceChoice(room, playerId, optionId) {
  const pc = room.pendingConsequence;
  if (!pc || pc.playerId !== playerId || !pc.choice) return;
  const stored = room._pendingChoiceActions;
  if (!stored || !stored[optionId]) return;
  const player = findPlayer(room, playerId);
  if (!player) return;
  const option = pc.choice.options.find((o) => o.id === optionId);
  const desc = applyPrimitiveAction(room, player, stored[optionId]);
  pc.autoApplied = `${pc.choice.sourceName}: ${option ? option.label : optionId} -> ${desc}`;
  log(room, `${player.name}: ${pc.autoApplied}`);
  pc.choice = null;
  room._pendingChoiceActions = null;
  touchRoom(room);
}

// ---------------------------------------------------------------------------
// Schatzkarten-Sonderkräfte ("Sonstige"-Schatzkarten ohne Ausrüsten/Verkaufen)
// ---------------------------------------------------------------------------
// Analog zum "Trust"-Prinzip oben gilt: die riesige Mehrheit der 177
// "Sonstige"-Schatzkarten hat gar keinen anderen Spielmechanismus als
// Ausrüsten/Verkaufen/Ablegen, obwohl ihr Text eine eigene Sonderkraft
// beschreibt. Zwei Muster decken den Großteil automatisch ab:
//  1) isInstantLevelUpCard: einfache "Steige eine Stufe auf"-Karten.
//  2) TREASURE_POWER_OVERRIDES: kuratierte Einzelfälle (Wahlmöglichkeiten,
//     Ziel-Auswahl, Sonderregeln), nach demselben Muster wie
//     CONSEQUENCE_OVERRIDES oben - jeder Eintrag mit Original-Kartentext
//     kommentiert. `null` = bewusst manuell (Bedingung nicht prüfbar oder
//     außerhalb des Umfangs), eine Aktion = automatisch anwendbar.
// Bewusst AUSSERHALB des Umfangs: Karten, die einen "Großer Gegenstand"-Flag,
// eine "Untot"-Kennzeichnung auf Monstern, einen dauerhaften Fluch-/Status-
// Tracker (den es in diesem Server nicht gibt, siehe WUNSCHRING) oder eine
// echte freie Auswahl aus dem gesamten Ablagestapel mit Wertgrenze brauchen
// (FLOHMARKT, EINHEITSGRÖSSE) - siehe README für die vollständige Liste.

function normalizeCardText(raw) {
  return String(raw || '').replace(/\\n/g, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[bi]>/gi, '').replace(/\s+/g, ' ').trim();
}

const INSTANT_LEVEL_UP_RE = /^\s*Steige\s+(?:eine|\d+)\s+Stufen?\s+auf\b/i;

function isInstantLevelUpCard(c) {
  if (!c || c.category !== 'treasure_other') return false;
  if (TREASURE_POWER_OVERRIDES[c.name] !== undefined) return true; // kuratiert, siehe unten
  return INSTANT_LEVEL_UP_RE.test(normalizeCardText(c.text));
}

const TREASURE_POWER_OVERRIDES = {
  // --- Ziel-Auswahl (Spieler-Picker) ---
  // "Wähle den Spieler aus, von dem du eine Stufe stehlen willst. Du
  // steigst eine auf und der Gegenspieler steigt eine ab."
  'KLAUE EINE STUFE': () => ({
    type: 'targetPlayer',
    prompt: 'Von wem eine Stufe stehlen?',
    action: { type: 'stealLevel' },
  }),

  // --- Echte Wahl ---
  // "Steige eine Stufe auf. Legst du deine ganze Hand ab (mind. drei
  // Karten), steige zwei Stufen und nicht eine auf!"
  'SINNIEREN': (player) => {
    const options = [{ id: 'one', label: '1 Stufe aufsteigen', action: { type: 'levelUp', amount: 1 } }];
    if (player.hand.length >= 3) {
      options.push({ id: 'hand', label: 'Ganze Hand ablegen (mind. 3 Karten) -> 2 Stufen aufsteigen', action: { type: 'combo', actions: [{ type: 'discardWholeHand' }, { type: 'levelUp', amount: 2 }] } });
    }
    return { type: 'choice', options };
  },
  // "Steige eine Stufe auf. Statt eine Stufe aufzusteigen, kannst du dies
  // auf einen Rivalen spielen, um ihn dazu zu zwingen, dir den Gegenstand
  // zu geben, der ihm den größten Bonus bringt, und er bekommt stattdessen
  // eine Stufe."
  'SINNLOSER AKT DER FREUNDLICHKEIT': () => ({
    type: 'choice',
    options: [
      { id: 'self', label: 'Selbst 1 Stufe aufsteigen', action: { type: 'levelUp', amount: 1 } },
      { id: 'target', label: 'Auf einen Mitspieler anwenden', action: { type: 'targetPlayer', prompt: 'Wen dazu zwingen, seinen besten Gegenstand herzugeben?', action: { type: 'stealBestItemGiveLevel' } } },
    ],
  }),

  // --- Bedingung prüfbar (blockiert, wenn nicht erfüllt) ---
  // "... nicht einsetzbar, wenn du im Augenblick der (oder einer der)
  // höchststufige(n) Spieler bist." / "... wenn du aktuell die höchste
  // Stufe hast oder die höchste Stufe teilst."
  'JAMMER DEN SPIELLEITER AN': (player, room) => (isTopLevel(room, player) ? null : { type: 'levelUp', amount: 1 }),
  'CHARAKTERSEITEN WECHSELN': (player, room) => (isTopLevel(room, player) ? null : { type: 'levelUp', amount: 1 }),

  // --- Bewusst manuell: hängt von Karten/Zustand ab, den dieser Server
  // nicht separat verfolgt (Mietling "im Spiel" ist keine eigene Zone;
  // "nach einem beliebigen Kampf" ist keine geprüfte Zeitbedingung; die
  // Mehrfach-Effekt-Kette betrifft mehrere Spieler in fester Reihenfolge). ---
  'TÖTE DEN MIETLING': () => null,
  'ENTE DER VIELEN SACHEN': () => null,

  // --- Sonstige Einzelfälle ---
  // "Ziehe sofort 3 weitere Schatzkarten."
  'SCHATZHORT!': () => ({ type: 'drawTreasureN', n: 3 }),
  // "Durchsuche die abgelegten Karten, um eine Karte zu finden, die du
  // willst. Nimm die neue Karte und lege diese ab." (Original-Karte wird
  // beim Ausspielen ohnehin abgelegt.)
  'WÜNSCHELSTAB': () => ({ type: 'chooseDiscardedCard' }),
  'GEDENKTAFEL': (player, room) => (room.combat ? null : { type: 'chooseDiscardedCard' }),
};

function isTopLevel(room, player) {
  const maxLevel = Math.max(...room.players.map((p) => p.level));
  return player.level >= maxLevel;
}

function openCardChoice(room, player, cardName, options) {
  room.pendingCardAction = { playerId: player.id, cardName, kind: 'choice', options: options.map((o) => ({ id: o.id, label: o.label })) };
  room._pendingCardActionResolvers = {};
  options.forEach((o) => { room._pendingCardActionResolvers[o.id] = o.action; });
}

function openCardTarget(room, player, cardName, prompt, action) {
  room.pendingCardAction = {
    playerId: player.id,
    cardName,
    kind: 'targetPlayer',
    prompt: prompt || 'Ziel wählen',
    candidateIds: room.players.filter((p) => p.id !== player.id).map((p) => p.id),
  };
  room._pendingCardActionResolvers = action;
}

function openCardCardChoice(room, player, cardName, prompt) {
  const candidates = [...room.doorDiscard, ...room.treasureDiscard].map((id) => card(id)).filter(Boolean);
  room.pendingCardAction = {
    playerId: player.id,
    cardName,
    kind: 'chooseCard',
    prompt: prompt || 'Karte aus den Ablagestapeln wählen',
    candidateIds: candidates.map((c) => c.id),
  };
  room._pendingCardActionResolvers = null;
}

// Wendet eine bereits aufgelöste Aktion an, die (anders als
// applyPrimitiveAction) eine ZWEITE Person betrifft (Ziel einer
// Spieler-Auswahl, z.B. "Klaue eine Stufe").
function applyTargetAction(room, actor, target, action) {
  switch (action.type) {
    case 'stealLevel':
      setLevel(actor, actor.level + 1);
      setLevel(target, target.level - 1);
      return `${actor.name} +1 Stufe, ${target.name} -1 Stufe`;
    case 'stealBestItemGiveLevel': {
      const ids = equippedItemIds(target);
      let best = null;
      ids.forEach((id) => { const c = card(id); if (c && c.bonus && (!best || c.bonus > card(best).bonus)) best = id; });
      setLevel(target, target.level + 1);
      if (!best) return `${target.name} hatte keinen Gegenstand mit Bonus, bekommt trotzdem +1 Stufe`;
      unequipSlotCard(target, best);
      actor.hand.push(best);
      return `${actor.name} erhält "${card(best).name}" von ${target.name}, ${target.name} +1 Stufe`;
    }
    default:
      return '';
  }
}

function handleUseCardPower(room, playerId, cardId) {
  const player = findPlayer(room, playerId);
  if (!player || !player.hand.includes(cardId)) return;
  if (room.pendingCardAction || room.pendingConsequence) return;
  const c = card(cardId);
  if (!c) return;
  let spec;
  if (TREASURE_POWER_OVERRIDES[c.name] !== undefined) {
    spec = TREASURE_POWER_OVERRIDES[c.name](player, room);
  } else if (isInstantLevelUpCard(c)) {
    spec = { type: 'levelUp', amount: 1 };
  } else {
    return; // keine automatisierte Sonderkraft für diese Karte
  }
  if (spec == null) {
    log(room, `${player.name} kann die Sonderkraft von "${c.name}" gerade nicht automatisch nutzen (Bedingung nicht erfüllt oder Karte bleibt manuell).`);
    touchRoom(room);
    return;
  }
  removeFromHand(player, cardId);
  discardCard(room, cardId);
  if (spec.type === 'choice') {
    openCardChoice(room, player, c.name, spec.options);
    log(room, `${player.name} spielt "${c.name}" - Wahl nötig.`, [cardId]);
    touchRoom(room);
    return;
  }
  if (spec.type === 'targetPlayer') {
    openCardTarget(room, player, c.name, spec.prompt, spec.action);
    log(room, `${player.name} spielt "${c.name}" - Ziel nötig.`, [cardId]);
    touchRoom(room);
    return;
  }
  if (spec.type === 'chooseDiscardedCard') {
    openCardCardChoice(room, player, c.name);
    log(room, `${player.name} spielt "${c.name}" - Kartenwahl aus dem Ablagestapel nötig.`, [cardId]);
    touchRoom(room);
    return;
  }
  const desc = applyPrimitiveAction(room, player, spec);
  log(room, `${player.name} spielt "${c.name}": ${desc}.`, [cardId]);
  touchRoom(room);
}

function handleResolveCardChoice(room, playerId, optionId) {
  const pa = room.pendingCardAction;
  if (!pa || pa.playerId !== playerId || pa.kind !== 'choice') return;
  const stored = room._pendingCardActionResolvers;
  if (!stored || !stored[optionId]) return;
  const player = findPlayer(room, playerId);
  if (!player) return;
  const option = pa.options.find((o) => o.id === optionId);
  const action = stored[optionId];
  room.pendingCardAction = null;
  room._pendingCardActionResolvers = null;
  // Eine Wahl kann selbst wieder eine Ziel-Auswahl auslösen (z.B. "Sinnloser
  // Akt der Freundlichkeit" -> "Auf Mitspieler anwenden").
  if (action.type === 'targetPlayer') {
    openCardTarget(room, player, pa.cardName, action.prompt, action.action);
    log(room, `${player.name}: "${pa.cardName}" -> ${option ? option.label : optionId} - Ziel nötig.`);
    touchRoom(room);
    return;
  }
  const COMBAT_ACTION_TYPES = new Set(['modifier', 'endCombatNoTreasure', 'removeHelper', 'killMonsterInCombat']);
  const sourceCard = pa.sourceCardId ? card(pa.sourceCardId) : null;
  const desc = COMBAT_ACTION_TYPES.has(action.type)
    ? applyCombatPotionAction(room, player, action, sourceCard)
    : applyPrimitiveAction(room, player, action);
  log(room, `${player.name}: "${pa.cardName}" -> ${option ? option.label : optionId} (${desc}).`);
  touchRoom(room);
}

function handleResolveCardTarget(room, playerId, targetId) {
  const pa = room.pendingCardAction;
  if (!pa || pa.playerId !== playerId || pa.kind !== 'targetPlayer') return;
  if (!pa.candidateIds.includes(targetId)) return;
  const stored = room._pendingCardActionResolvers;
  const player = findPlayer(room, playerId);
  const target = findPlayer(room, targetId);
  if (!stored || !player || !target) return;
  room.pendingCardAction = null;
  room._pendingCardActionResolvers = null;
  const desc = applyTargetAction(room, player, target, stored);
  log(room, `${player.name}: "${pa.cardName}" -> ${target.name} (${desc}).`);
  touchRoom(room);
}

function handleResolveCardCardChoice(room, playerId, chosenCardId) {
  const pa = room.pendingCardAction;
  if (!pa || pa.playerId !== playerId || pa.kind !== 'chooseCard') return;
  if (!pa.candidateIds.includes(chosenCardId)) return;
  const player = findPlayer(room, playerId);
  if (!player) return;
  const idx = room.doorDiscard.indexOf(chosenCardId);
  if (idx >= 0) room.doorDiscard.splice(idx, 1);
  else {
    const tIdx = room.treasureDiscard.indexOf(chosenCardId);
    if (tIdx >= 0) room.treasureDiscard.splice(tIdx, 1);
    else return;
  }
  player.hand.push(chosenCardId);
  const chosen = card(chosenCardId);
  room.pendingCardAction = null;
  room._pendingCardActionResolvers = null;
  log(room, `${player.name}: "${pa.cardName}" -> "${chosen ? chosen.name : chosenCardId}" aus dem Ablagestapel geholt.`, [chosenCardId]);
  touchRoom(room);
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
  const monsters = c.monsterIds.map(card);
  const monsterLevel = monsters.reduce((sum, m) => sum + (m.level || 0), 0);
  const actorCond = conditionalItemBonusSum(actor, monsters);
  const helperCond = helper ? conditionalItemBonusSum(helper, monsters) : 0;
  const playerStrength = baseStrength(actor) + actorCond + (helper ? baseStrength(helper) + helperCond : 0) + c.actorModifier;
  const monsterStrength = monsterLevel + c.monsterModifier;
  return { playerStrength, monsterStrength, monsterLevel };
}

// Liefert die zustandsabhängigen Item-Zusatzboni (siehe ITEM_CONDITIONAL_BONUS)
// getrennt für Angreifer:in und Helfer:in, damit der Client dieselbe Zahl wie
// der Server anzeigen kann, ohne die Kartendaten selbst neu auszuwerten.
function combatConditionalBonusFields(room) {
  const c = room.combat;
  const actor = findPlayer(room, c.actorId);
  const helper = c.helperId ? findPlayer(room, c.helperId) : null;
  const monsters = c.monsterIds.map(card);
  return {
    actorConditionalBonus: conditionalItemBonusSum(actor, monsters),
    helperConditionalBonus: helper ? conditionalItemBonusSum(helper, monsters) : 0,
  };
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

// "Kampf-Trank"-Erkenner: treasure_other-Karten, die laut Text während eines
// beliebigen Kampfes gespielt werden dürfen und einen festen +N-Bonus für
// eine Seite geben (anders als Monster-Verstärker steht die Zahl hier nur im
// Fließtext, nicht in einem eigenen bonus-Feld). Deckt die weitaus häufigste
// Formulierung ab; seltenere Sonderfälle stehen in COMBAT_POTION_OVERRIDES.
const COMBAT_PLAYABLE_RE = /Im Kampf (spielen|einsetzen)|Während\s+(eines\s+)?beliebige[nm]\s+Kampf(es)?\s+spielen/i;

function parseCombatPotion(rawText) {
  const t = normalizeCardText(rawText);
  let m = t.match(/\+(\d+)\s+für\s+beide\s+Seiten/i);
  if (m) return { side: 'both', amount: parseInt(m[1], 10) };
  m = t.match(/\+(\d+)\s+(?:für\s+eine\s+der\s+Parteien,\s+)?egal\s+(?:für\s+welche|welche)\s+Seite/i);
  if (m) return { side: 'either', amount: parseInt(m[1], 10) };
  m = t.match(/\+(\d+)\s+nur\s+für\s+Monster/i);
  if (m) return { side: 'monster', amount: parseInt(m[1], 10) };
  m = t.match(/\+(\d+)\s+für\s+die\s+Munchkin-Seite/i);
  if (m) return { side: 'actor', amount: parseInt(m[1], 10) };
  return null;
}

// Kuratierte Einzelfälle für Kampf-Tränke, die sich nicht auf das einfache
// "+N für Seite X"-Muster reduzieren lassen. Rückgabe wie bei
// TREASURE_POWER_OVERRIDES: eine Aktion, `null` = bewusst manuell/Bedingung
// nicht erfüllt.
const COMBAT_POTION_OVERRIDES = {
  // "Lege alle Monster des Kampfes ab. Du erhältst keinen Schatz, aber du
  // darfst den Raum durchsuchen."
  'FREUNDSCHAFTSTRANK': () => ({ type: 'endCombatNoTreasure', thenLoot: true }),
  // "Verwandelt ein Monster in einen Papagei, der wegfliegt und seinen
  // Schatz zurücklässt."
  'POLLYVERWANDLUNGSTRANK': () => ({ type: 'endCombatNoTreasure' }),
  // "Bringt ein Monster dazu, verwirrt wegzulaufen und seinen Schatz
  // zurückzulassen."
  'TRANK DER IRRELEVANZ': () => ({ type: 'endCombatNoTreasure' }),
  // "Lege das Monster nach unten in den Türstapel zurück."
  'ENTLASSUNGSGLOCKE': () => ({ type: 'endCombatNoTreasure', returnToDoorDeckBottom: true }),
  // "Der Helfer vergisst, dass er kämpft, geht und lässt den Hauptkämpfer
  // allein im Kampf zurück." (nur spielbar, wenn ein Helfer im Kampf ist)
  'CYTILLESH-TRANK': (player, room) => (room.combat.helperId ? { type: 'removeHelper' } : null),
  // "+2 egal für welche Seite, oder tötet sofort die Laufende Nase."
  'TRANK DES MUNDGERUCHS': (player, room) => {
    const hasLaufendeNase = room.combat.monsterIds.some((id) => { const m = card(id); return m && m.name === 'LAUFENDE NASE'; });
    const options = [
      { id: 'munchkins', label: '+2 für die Munchkins', action: { type: 'modifier', side: 'actor', amount: 2 } },
      { id: 'monster', label: '+2 für das Monster', action: { type: 'modifier', side: 'monster', amount: 2 } },
    ];
    if (hasLaufendeNase) options.push({ id: 'kill', label: 'Laufende Nase sofort töten (kein Schatz)', action: { type: 'killMonsterInCombat', name: 'LAUFENDE NASE' } });
    return { type: 'choice', options };
  },
  // "Nur einmal einsetzbar und nur, um Elfen zu helfen. +2 für jeden Elf im
  // Kampf." (Angreifer:in + Helfer:in gezählt; ohne Elf nicht einsetzbar.)
  'YUPPIE-WASSER': (player, room) => {
    const c = room.combat;
    const participants = [c.actorId, c.helperId].filter(Boolean).map((id) => findPlayer(room, id)).filter(Boolean);
    const elfCount = participants.filter((p) => hasRace(p, 'ELF')).length;
    return elfCount ? { type: 'modifier', side: 'actor', amount: 2 * elfCount } : null;
  },
  // "... aber nur, wenn du mindestens eine freie Hand hast. +4 für die
  // Munchkin-Seite."
  'FLÜSSIGKLINGE': (player) => (player.equipped.hands.includes(null) ? { type: 'modifier', side: 'actor', amount: 4 } : null),
};

function isCombatPotionCard(c) {
  if (!c || c.category !== 'treasure_other') return false;
  if (COMBAT_POTION_OVERRIDES[c.name] !== undefined) return true;
  const t = normalizeCardText(c.text);
  return COMBAT_PLAYABLE_RE.test(t) && parseCombatPotion(c.text) != null;
}

// Wendet eine bereits aufgelöste Kampf-Trank-Aktion an (mutiert
// room.combat). Machtgruppe Alchemist ("Tränkemeister") verdoppelt den
// Bonus von "Nur einmal einsetzbar"-Gegenständen.
function applyCombatPotionAction(room, player, action, sourceCard) {
  const c = room.combat;
  if (!c) return '';
  const isAlchemistDoubled = hasPowerGroup(player, 'ALCHEMIST') && /nur\s+einmal\s+einsetzbar/i.test((sourceCard && sourceCard.text) || '');
  switch (action.type) {
    case 'modifier': {
      const amount = isAlchemistDoubled ? action.amount * 2 : action.amount;
      if (action.side === 'both') { c.actorModifier += amount; c.monsterModifier += amount; return `+${amount} für beide Seiten`; }
      if (action.side === 'monster') { c.monsterModifier += amount; return `+${amount} für das Monster`; }
      c.actorModifier += amount;
      return `+${amount} für die Munchkins`;
    }
    case 'endCombatNoTreasure': {
      const names = c.monsterIds.map((id) => card(id).name).join(' + ');
      if (action.returnToDoorDeckBottom) c.monsterIds.forEach((id) => room.doorDeck.unshift(id));
      else c.monsterIds.forEach((id) => room.doorDiscard.push(id));
      room.combat = null;
      room.turnPhase = action.thenLoot ? 'pluendern' : 'gabe';
      return `Kampf gegen ${names} beendet, kein Schatz`;
    }
    case 'removeHelper': {
      const helper = findPlayer(room, c.helperId);
      c.helperId = null;
      return `${helper ? helper.name : 'Helfer'} verlässt den Kampf`;
    }
    case 'killMonsterInCombat': {
      const idx = c.monsterIds.findIndex((id) => { const m = card(id); return m && m.name === action.name; });
      if (idx < 0) return 'Monster nicht im Kampf gefunden';
      const [dead] = c.monsterIds.splice(idx, 1);
      room.doorDiscard.push(dead);
      if (c.monsterIds.length === 0) { room.combat = null; room.turnPhase = 'gabe'; }
      return `${action.name} sofort besiegt (kein Schatz)`;
    }
    default:
      return '';
  }
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
  if (!c) return;
  if (isMonsterEnhancerCard(c)) {
    removeFromHand(player, cardId);
    room.combat.monsterModifier += c.bonus;
    room.doorDiscard.push(cardId);
    log(room, `${player.name} spielt "${c.name}" im Kampf (${c.bonus >= 0 ? '+' : ''}${c.bonus} für das Monster).`, [cardId]);
    touchRoom(room);
    return;
  }
  if (!isCombatPotionCard(c)) return;
  if (room.pendingCardAction || room.pendingConsequence) return;
  const spec = COMBAT_POTION_OVERRIDES[c.name] !== undefined
    ? COMBAT_POTION_OVERRIDES[c.name](player, room)
    : (() => { const p = parseCombatPotion(c.text); return p && { type: 'modifier', side: p.side, amount: p.amount }; })();
  if (spec == null) {
    log(room, `${player.name} kann "${c.name}" gerade nicht einsetzen (Bedingung nicht erfüllt).`);
    touchRoom(room);
    return;
  }
  removeFromHand(player, cardId);
  room.doorDiscard.push(cardId); // treasure_other-Karten landen mechanisch wie alle "Nur einmal einsetzbar"-Karten im Ablagestapel
  if (spec.type === 'modifier' && spec.side === 'either') {
    openCardChoice(room, player, c.name, [
      { id: 'munchkins', label: `+${spec.amount} für die Munchkins`, action: { type: 'modifier', side: 'actor', amount: spec.amount } },
      { id: 'monster', label: `+${spec.amount} für das Monster`, action: { type: 'modifier', side: 'monster', amount: spec.amount } },
    ]);
    room.pendingCardAction.sourceCardId = cardId;
    log(room, `${player.name} spielt "${c.name}" im Kampf - Seite nötig.`, [cardId]);
    touchRoom(room);
    return;
  }
  if (spec.type === 'choice') {
    openCardChoice(room, player, c.name, spec.options);
    room.pendingCardAction.sourceCardId = cardId;
    log(room, `${player.name} spielt "${c.name}" im Kampf - Wahl nötig.`, [cardId]);
    touchRoom(room);
    return;
  }
  const desc = applyCombatPotionAction(room, player, spec, c);
  log(room, `${player.name} spielt "${c.name}" im Kampf: ${desc}.`, [cardId]);
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
    room.pendingConsequence = { playerId: actor.id, kind: 'loss', cardId: null, text: badstuffText, autoApplied: null, choice: null };
    autoApplyLossConsequence(room, actor, monsters.map((m) => ({ name: m.name, text: m.badstuff })));
  }
  touchRoom(room);
}

// Garantierte Flucht-Karten: statt eines Weglaufen-Würfelwurfs sofort und
// sicher aus dem Kampf entkommen. Nur nutzbar, während tatsächlich geflohen
// werden muss (mustFlee) und nur für die kämpfende Person selbst (Hilfe für
// eine zweite Person ist in diesem Server ohnehin nicht separat vom
// Kampf-Ausgang der Hauptperson abhängig, siehe handleAttemptFlee).
const GUARANTEED_FLEE_CARDS = new Set(['FERTIGMAUER', 'BABY-ÖL', 'DER ANDERE RING']);

function handleUseGuaranteedFlee(room, playerId, cardId) {
  if (!room.combat || !room.combat.mustFlee) return;
  const c = room.combat;
  if (c.actorId !== playerId) return;
  const player = findPlayer(room, playerId);
  if (!player || !player.hand.includes(cardId)) return;
  const cardData = card(cardId);
  if (!cardData || !GUARANTEED_FLEE_CARDS.has(cardData.name)) return;
  removeFromHand(player, cardId);
  discardCard(room, cardId);
  c.monsterIds.forEach((id) => room.doorDiscard.push(id));
  room.combat = null;
  room.turnPhase = 'gabe';
  let extra = '';
  // "Du kannst automatisch aus einem beliebigen Kampf weglaufen ... aber du
  // verlierst eine Stufe."
  if (cardData.name === 'DER ANDERE RING') { setLevel(player, player.level - 1); extra = ', verliert dafür 1 Stufe'; }
  log(room, `${player.name} entkommt garantiert mit "${cardData.name}"${extra}.`, [cardId]);
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
  // Machtgruppe Alchemist, "Blei zu Gold": mindestens 300 Goldstücke pro
  // verkauftem Gegenstand, bevor andere Modifikatoren angewendet werden.
  const isAlchemist = hasPowerGroup(player, 'ALCHEMIST');
  ids.forEach((id) => {
    const inHand = player.hand.includes(id);
    const inEquip = equippedItemIds(player).includes(id);
    if (!inHand && !inEquip) return;
    const c = card(id);
    if (!c || typeof c.gold !== 'number') return;
    total += isAlchemist ? Math.max(c.gold, 300) : c.gold;
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

// Machtgruppe (Pathfinder-Set): ein drittes Merkmal neben Rasse/Klasse, mit
// eigenen "Beitritts"-Karten (Kategorie "door_other" in den Rohdaten, aber
// mechanisch identisch zu Rassen-/Klassenkarten - Ausleihkarte, max. 1,
// solange keine Doppelleben-Karte gehalten wird). Ihre "gegen [Machtgruppe]"
// Kampfboni auf anderen Karten (z.B. TENGU: "+3 gegen Kundschafter") bleiben
// bewusst manuell: dafür müsste jede der 92 Monsterkarten mit ihrer eigenen
// Machtgruppen-Zugehörigkeit getaggt sein, ein Datenpunkt, den es nicht gibt.
const POWER_GROUP_NAMES = new Set([
  'KUNDSCHAFTER', 'NEKROMANT', 'HEXE', 'HÖLLENRITTER', 'ADLERRITTER',
  'PAKTMAGIER', 'ALCHEMIST', 'ASSASSINE DER ROTEN MANTIS',
]);

function traitCap(player, kind) {
  if (kind === 'race') return player.raceCapCard ? 2 : 1;
  if (kind === 'class') return player.classCapCard ? 2 : 1;
  return player.powerGroupCapCard ? 2 : 1;
}

function handlePlayRaceOrClass(room, playerId, cardId) {
  const player = findPlayer(room, playerId);
  if (!player || !player.hand.includes(cardId)) return;
  const c = card(cardId);
  if (!c) return;
  const upper = c.name.toUpperCase();
  if (c.category === 'race') {
    if (player.races.length >= traitCap(player, 'race')) return;
    removeFromHand(player, cardId);
    player.races.push(cardId);
  } else if (c.category === 'class') {
    if (player.classes.length >= traitCap(player, 'class')) return;
    removeFromHand(player, cardId);
    player.classes.push(cardId);
  } else if (c.category === 'door_other' && POWER_GROUP_NAMES.has(upper)) {
    if (player.powerGroups.length >= traitCap(player, 'powerGroup')) {
      log(room, `${player.name} kann "${c.name}" nicht spielen (Machtgruppen-Obergrenze erreicht).`);
      touchRoom(room);
      return;
    }
    removeFromHand(player, cardId);
    player.powerGroups.push(cardId);
  } else if (upper === 'HALB-BLUT') {
    if (player.raceCapCard) { log(room, `${player.name} hat bereits eine Halb-Blut-Karte.`); touchRoom(room); return; }
    removeFromHand(player, cardId);
    player.raceCapCard = cardId;
  } else if (upper === 'SUPER MUNCHKIN') {
    if (player.classCapCard) { log(room, `${player.name} hat bereits eine Super-Munchkin-Karte.`); touchRoom(room); return; }
    removeFromHand(player, cardId);
    player.classCapCard = cardId;
  } else if (upper === 'DOPPELLEBEN') {
    if (player.powerGroupCapCard) { log(room, `${player.name} hat bereits eine Doppelleben-Karte.`); touchRoom(room); return; }
    removeFromHand(player, cardId);
    player.powerGroupCapCard = cardId;
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
  socket.on('resolveConsequenceChoice', ({ optionId }) => act(socket, (room, pid) => handleResolveConsequenceChoice(room, pid, optionId)));
  socket.on('useCardPower', ({ cardId }) => act(socket, (room, pid) => handleUseCardPower(room, pid, cardId)));
  socket.on('resolveCardChoice', ({ optionId }) => act(socket, (room, pid) => handleResolveCardChoice(room, pid, optionId)));
  socket.on('resolveCardTarget', ({ targetId }) => act(socket, (room, pid) => handleResolveCardTarget(room, pid, targetId)));
  socket.on('resolveCardCardChoice', ({ cardId }) => act(socket, (room, pid) => handleResolveCardCardChoice(room, pid, cardId)));
  socket.on('useGuaranteedFlee', ({ cardId }) => act(socket, (room, pid) => handleUseGuaranteedFlee(room, pid, cardId)));
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
  parseAutoConsequence, isMonsterEnhancerCard, resolveConsequenceSpec, CONSEQUENCE_OVERRIDES,
  DOOR_OTHER_AS_CURSE, isInstantLevelUpCard, TREASURE_POWER_OVERRIDES,
  parseCombatPotion, isCombatPotionCard, COMBAT_POTION_OVERRIDES,
  POWER_GROUP_NAMES, GUARANTEED_FLEE_CARDS, ITEM_CONDITIONAL_BONUS,
};
