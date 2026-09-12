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
const crypto = require('crypto');
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
// Zwei Kartennamen tragen ein <BR> aus der Vorlage mit sich herum ("SINGENDES
// &<BR>TANZENDES SCHWERT") - einmal hier begradigt, dann stimmt es in Logs,
// Kartenkacheln und Ausruestungsplaetzen gleichzeitig.
ALL_CARDS.forEach((c) => { c.name = String(c.name).replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim(); });
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

// Wird u.a. für den Wiederverbinden-Token benutzt. Wer den Token einer anderen
// Person kennt, übernimmt deren Platz im Spiel (siehe joinRoom) - deshalb aus
// crypto und nicht aus Math.random(), dessen Zustand sich aus wenigen
// beobachteten Werten rekonstruieren lässt.
function makeId() {
  return crypto.randomBytes(16).toString('hex');
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
    equipped: newEquipped(),
    // SCHUMMELN!: hebt fuer genau einen Gegenstand die Anlege-Regeln auf.
    attachments: { cheatedItemId: null },
    // Anhaltende Flueche (MIESER SPIEGEL, GESCHLECHTSUMWANDLUNG, HUHN AUF
    // DEINEM KOPF, WINZIGE HÄNDE) - siehe LINGERING_CURSES/addActiveCurse.
    activeCurses: [],
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
    doorReveal: null, // {cardId, seq} - nur fuer die Aufdeck-Animation im Client
    dieRoll: null, // {seq, roll, mod, total, success, playerId, playerName} - nur fuer die Wuerfel-Animation im Client
    combat: null,
    pendingConsequence: null,
    pendingCardAction: null,
    pendingRoll: null, // {playerId, purpose, roll, holders, onResolve} - siehe rollWithWindow
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

// Reihenfolge, in der Mitspielende von einer Karte betroffen werden. Die
// Karten sagen Unterschiedliches ("beginnend mit dem Spieler VOR dir" gegen
// "NACH dir"), deshalb ein Modus je Formulierung statt einer festen Regel.
function playerQueueFrom(room, player, mode) {
  const n = room.players.length;
  const self = room.players.findIndex((p) => p.id === player.id);
  if (self < 0 || n < 2) return [];
  if (mode === 'after') {
    return Array.from({ length: n - 1 }, (_, i) => room.players[(self + 1 + i) % n].id);
  }
  if (mode === 'before') {
    return Array.from({ length: n - 1 }, (_, i) => room.players[((self - 1 - i) % n + n) % n].id);
  }
  if (mode === 'neighbours') {
    const vor = room.players[((self - 1) % n + n) % n].id;
    const danach = room.players[(self + 1) % n].id;
    return vor === danach ? [vor] : [vor, danach];
  }
  if (mode === 'topLevel') {
    const others = room.players.filter((p) => p.id !== player.id);
    if (!others.length) return [];
    const max = Math.max.apply(null, others.map((p) => p.level));
    return others.filter((p) => p.level === max).map((p) => p.id);
  }
  return room.players.filter((p) => p.id !== player.id).map((p) => p.id); // 'allOthers'
}

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

// SPECIAL_SLOT_ITEMS, SPECIAL_SLOTS: siehe src/cards/passives.js (Tabelle
// wird weiter unten, nach hasRace/hasClass, per passivesFactory geladen -
// SPECIAL_SLOT_KEYS steht dort direkt daneben).

function newEquipped() {
  const eq = { head: null, armor: null, feet: null, hands: [null, null] };
  SPECIAL_SLOT_KEYS.forEach((k) => { eq[k] = []; });
  return eq;
}

function specialSlotCards(player, key) {
  const v = player.equipped[key];
  return Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []);
}

function specialSlotRule(c) {
  return (c && SPECIAL_SLOT_ITEMS[c.name]) || null;
}

function equippedItemIds(player) {
  return [player.equipped.head, player.equipped.armor, player.equipped.feet, ...player.equipped.hands,
    ...SPECIAL_SLOT_KEYS.flatMap((k) => specialSlotCards(player, k))].filter(Boolean);
}

const { BIG_ITEMS, isBigItem } = require('./src/cards/bigitems.js');

// ZWERG: "Du kannst eine beliebige Anzahl Grosser Gegenstaende tragen und
// ausruesten." Alle anderen duerfen genau einen tragen.
function bigItemCount(player) {
  return equippedItemIds(player).filter((id) => isBigItem(card(id))).length;
}

function canCarryAnotherBigItem(player) {
  return hasRace(player, 'ZWERG') || bigItemCount(player) < 1;
}

function equippedBonusSum(player) {
  return equippedItemIds(player).reduce((sum, id) => {
    const c = card(id);
    return sum + (c && c.bonus ? c.bonus : 0);
  }, 0);
}

// Machtgruppe Höllenritter, "Höllenritterrüstung": eine im Kampf +5 werte
// Rüstung, die zugleich als Rüstung UND Kopfbedeckung zählt - laut Karte darf
// daneben keine andere Rüstung/Kopfbedeckung getragen werden. Statt das
// Anlegen zu blockieren, zählt der Bonus nur, solange beide Slots frei sind:
// gleiches Ergebnis, egal in welcher Reihenfolge Karte und Ausrüstung kommen,
// und die Spielerin sieht die Zahl sofort statt einer Fehlermeldung.
// ponytail: bewusst keine Blockier-Logik im Anlegen-Pfad.
function hellknightArmorBonus(player) {
  if (!hasPowerGroup(player, 'HÖLLENRITTER')) return 0;
  return (player.equipped.armor || player.equipped.head) ? 0 : 5;
}

function baseStrength(player) {
  return player.level + equippedBonusSum(player) + hellknightArmorBonus(player);
}

// ITEM_CONDITIONAL_BONUS: siehe src/cards/passives.js (dort zusammen mit den
// übrigen Dauerwirkungstabellen geladen, obwohl die Nutzung hier ist).

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
  SPECIAL_SLOT_KEYS.forEach((k) => {
    player.equipped[k] = specialSlotCards(player, k).filter((id) => id !== cardId);
  });
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
    attachments: p.attachments, // SCHUMMELN!: markiert den geschummelten Gegenstand fuer den Client
    activeCurses: p.activeCurses, // anhaltende Flueche, siehe LINGERING_CURSES
    strength: baseStrength(p),
    handLimit: handLimit(p), // ZWERG darf 6 Karten halten, alle anderen 5
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
    // Statische Konfiguration der Spezialplaetze - so braucht der Client
    // keine zweite Kartenliste (er zeigt nur Knopf und Platz an).
    specialSlots: SPECIAL_SLOTS,
    specialSlotItems: SPECIAL_SLOT_ITEMS,
    // Statische Liste fuer den Hinweistext am "Anlegen"-Knopf (siehe
    // BIG_ITEMS in src/cards/bigitems.js) - die eigentliche Durchsetzung
    // bleibt serverseitig in handleEquipItem.
    bigItems: [...BIG_ITEMS],
    doorCombatCards: Object.keys(DOOR_COMBAT_CARDS),
    combatReactionCards: Object.keys(COMBAT_REACTION_CARDS),
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
    doorReveal: room.doorReveal,
    dieRoll: room.dieRoll,
    combat: room.combat ? Object.assign({}, room.combat, combatConditionalBonusFields(room)) : null,
    pendingConsequence: room.pendingConsequence,
    // onResolve ist eine Funktion und darf nicht serialisiert werden -
    // deshalb hier nur die drei Felder, die der Client fuer den
    // "Wurf aendern"/"Passen"-Knopf braucht.
    pendingRoll: room.pendingRoll
      ? { playerId: room.pendingRoll.playerId, roll: room.pendingRoll.roll, holders: room.pendingRoll.holders }
      : null,
    pendingCardAction: room.pendingCardAction,
    winner: room.winner,
    logs: room.logs.slice(-80),
  };
}

function sendInfoTo(room, player) {
  if (!player.socketId) return;
  const trades = room.trades || [];
  // Handelsangebote sind privat, bis sie angenommen wurden (sie verraten
  // Handkarten) - jede:r sieht nur die eigenen offenen Angebote (inklusive
  // der Gegenleistung, die nur die beiden Beteiligten betrifft), nicht die
  // aller anderen. Nach Annahme landet das Ergebnis öffentlich im Verlauf.
  const mapTrade = (t) => ({
    id: t.id,
    status: t.status,
    fromId: t.fromId, fromName: (findPlayer(room, t.fromId) || {}).name || '?',
    toId: t.toId, toName: (findPlayer(room, t.toId) || {}).name || '?',
    offerCardIds: t.offerCardIds,
    counterCardIds: t.counterCardIds || [],
  });
  const incomingTrades = trades.filter((t) => t.toId === player.id).map(mapTrade);
  const outgoingTrades = trades.filter((t) => t.fromId === player.id).map(mapTrade);
  io.to(player.socketId).emit('yourInfo', {
    playerId: player.id,
    hand: player.hand,
    incomingTrades,
    outgoingTrades,
    // Welche Klassenkraft diese Person im laufenden Kampf gerade einsetzen
    // darf (Berserken/Vertreiben/Flugzauber) - privat, weil sie von der
    // eigenen Hand und Klasse abhängt.
    classCombatPower: classCombatPowerInfo(room, player),
    // ZAUBERER "Verzauberung" und die Rettungskarten nach einem verpatzten
    // Weglaufwurf haengen an der eigenen Hand - deshalb privat und nicht im
    // oeffentlichen Kampfzustand.
    classEnchant: room.combat ? enchantInfo(room, player) : null,
    fleeEscapeCardIds: (room.combat && room.combat.fleeRerollOffer && room.combat.actorId === player.id)
      ? postFleeEscapeCardIds(player) : [],
    // MAGISCHE LAMPE: nur waehrend des Fluchtentscheidungsfensters relevant.
    lampCardIds: (room.combat && room.combat.fleeRerollOffer && room.combat.actorId === player.id)
      ? lampCardIds(player) : [],
    // Beute-Animation nach einem Kampfsieg. Bewusst hier im privaten
    // yourInfo statt im oeffentlichen publicState: welche Schatzkarten
    // jemand gezogen hat, gehoert zur Hand und ist damit geheim - im
    // Verlauf steht fuer alle nur die ANZAHL.
    lastReward: player.lastReward || null,
  });
}

function broadcastState(room) {
  // Muss VOR publicState laufen: veränderte Kampfwerte setzen den
  // Bereit-Status zurück, und der Client soll den neuen Stand sehen.
  refreshCombatReady(room);
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
    p.equipped = newEquipped();
    p.activeCurses = [];
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
  if (currentPlayer(room) && currentPlayer(room).hand.length > handLimit(currentPlayer(room))) return; // Milde Gabe erzwingen
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  // Der HALBLING-Doppelverkauf gilt "pro Runde" - siehe handleSellItems.
  room.players.forEach((p) => { p.halblingSaleUsed = false; });
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
  // Zaehler statt nur Karten-ID: dieselbe Karte kann (nach dem Neumischen des
  // Ablagestapels) zweimal hintereinander aufgedeckt werden - der Client
  // erkennt am seq trotzdem, dass es ein NEUES Aufdecken ist, und spielt die
  // Animation genau einmal ab.
  room.doorReveal = { cardId: id, seq: (room.doorReveal ? room.doorReveal.seq : 0) + 1 };
  const c = card(id);
  log(room, `${player.name} deckt "${c.name}" auf (${c.setLabel}).`, [id]);

  if (c.category === 'monster') {
    room.revealedDoorCard = null;
    // "Greift niemanden mit Stufe X oder niedriger an" / "Greift keinen Dieb
    // an": das Monster zieht weiter, der Zug läuft mit Phase 2 weiter.
    if (monsterRefusesTarget(id, player)) {
      room.doorDiscard.push(id);
      room.turnPhase = 'aerger';
      log(room, `"${c.name}" greift ${player.name} nicht an und zieht weiter. Phase 2: Auf Ärger aus sein.`, [id]);
    } else if (monsterPassOption(id, player)) {
      // "Kaempfen oder vorbeigehen und winken" - Halblinge bekommen die Wahl
      // gar nicht angeboten (monsterPassOption), die muessen kaempfen.
      const fightAction = { type: 'startRevealedCombat', cardId: id };
      const passAction = { type: 'passMonster', cardId: id };
      if (player.isBot) {
        // Ein Wahldialog wuerde auf einen Bot ewig warten: er kaempft, wenn
        // seine Staerke reicht, und geht sonst vorbei.
        const desc = applyPrimitiveAction(room, player, baseStrength(player) > (c.level || 0) ? fightAction : passAction);
        log(room, `${player.name} (Bot) trifft die Wahl bei "${c.name}": ${desc}.`, [id]);
      } else {
        openCardChoice(room, player, c.name, [
          { id: 'fight', label: 'Kaempfen', action: fightAction },
          { id: 'pass', label: 'Vorbeigehen und winken (kein Kampf, kein Schatz)', action: passAction },
        ]);
        log(room, `"${c.name}": ${player.name} darf kaempfen oder einfach vorbeigehen.`, [id]);
      }
    } else {
      startCombat(room, player.id, [id], { fromHand: false });
    }
  } else if (c.category === 'curse' || DOOR_OTHER_AS_CURSE.has(c.name)) {
    room.doorDiscard.push(id);
    room.revealedDoorCard = null;
    const shield = curseProtectionItem(player);
    if (shield) {
      // SCHUTZSANDALEN: gezogene Flüche haben keine Wirkung.
      room.turnPhase = 'aerger';
      log(room, `Fluch "${c.name}" - aber ${player.name} trägt "${card(shield).name}": keine Wirkung. Phase 2: Auf Ärger aus sein.`, [id, shield]);
    } else {
      room.pendingConsequence = { playerId: player.id, kind: 'curse', cardId: id, text: c.text || c.name, autoApplied: null, choice: null };
      log(room, `Fluch! ${player.name} muss die Auswirkung anwenden: "${c.name}".`, [id]);
      autoApplyLossConsequence(room, player, [{ name: c.name, text: c.text, cardId: id }]);
    }
  } else {
    // Karte bleibt offen auf dem Tisch liegen (wie ein Monster), bis sie per
    // handleTakeRevealedDoor aktiv auf die Hand genommen wird - die Phase
    // bleibt solange 'tuer' und blockiert damit alle Folgephasen.
    log(room, `"${c.name}" liegt offen aus - ${player.name} kann sie auf die Hand nehmen.`, [id]);
  }
}

// Die offen liegende (Nicht-Monster-, Nicht-Fluch-)Tuerkarte auf die Hand
// nehmen und damit Phase 1 abschliessen.
function handleTakeRevealedDoor(room, playerId) {
  const player = currentPlayer(room);
  if (!player || player.id !== playerId) return;
  if (room.turnPhase !== 'tuer' || !room.revealedDoorCard || room.combat || room.pendingConsequence) return;
  const id = room.revealedDoorCard;
  player.hand.push(id);
  room.revealedDoorCard = null;
  room.turnPhase = 'aerger';
  log(room, `${player.name} nimmt "${card(id).name}" auf die Hand. Phase 2: Auf Ärger aus sein.`, [id]);
}

function handleAckConsequence(room, playerId) {
  if (!room.pendingConsequence || room.pendingConsequence.playerId !== playerId) return;
  const pc = room.pendingConsequence;
  const wasCurse = pc.kind === 'curse';
  room.pendingConsequence = null;
  const player = findPlayer(room, playerId);
  if (wasCurse) {
    room.turnPhase = 'aerger';
    log(room, `${player.name} macht weiter mit Phase 2: Auf Ärger aus sein.`);
  } else if (pc.originalActorId) {
    // ÜBERFALLTRANK: der urspruengliche Spieler darf den Raum trotz
    // verlorenem Kampf pluendern (siehe applyFleeFailure).
    room.turnPhase = 'pluendern';
    log(room, `${player.name} macht weiter mit Phase 3: Raum plündern.`);
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
  // SCHUMMELN!: "Lege diese Karte ab, wenn du den geschummelten Gegenstand
  // verlierst." Das trifft praktisch jeden Ablege-Weg (Verkauf, Konsequenzen,
  // Weglaufkarten) - deshalb hier zentral geloest statt an jeder Aufrufstelle
  // einzeln. Steal/Handel gehen NICHT über discardCard (Gegenstand landet in
  // einer anderen Hand statt im Ablagestapel) - dafuer siehe clearCheatIfLost.
  room.players.forEach((p) => {
    if (p.attachments && p.attachments.cheatedItemId === cardId) p.attachments.cheatedItemId = null;
  });
}

// KUMPEL legt dieselbe Monster-Karten-ID ein zweites Mal in c.monsterIds
// (siehe COMBAT_REACTION_CARDS/applyCombatReaction), damit Stufe und Schatz
// automatisch doppelt zaehlen. Beim gemeinsamen Ablegen aller verbliebenen
// Kampfmonster (Sieg, Flucht, garantierte Flucht, ...) darf die ID trotzdem
// nur EINMAL auf den Zielstapel wandern - sonst verdoppelt sich die Karte im
// Deck. Zentral hier statt an jeder Ablege-Stelle einzeln dedupliziert.
function discardMonsterIds(target, monsterIds) {
  [...new Set(monsterIds)].forEach((id) => target.push(id));
}

// SCHUMMELN!: fuer die zwei Faelle, in denen ein Gegenstand die Besitzerin
// wechselt, ohne den Ablagestapel zu sehen (Diebstahl, Handel) - siehe
// discardCard() fuer den haeufigeren Ablage-Fall.
function clearCheatIfLost(player, cardId) {
  if (player.attachments && player.attachments.cheatedItemId === cardId) player.attachments.cheatedItemId = null;
}

function applyDeathConsequence(room, player) {
  // Über discardCard(), weil das nach Kartentyp auf den richtigen Stapel legt.
  // Angelegte Gegenstände sind ausnahmslos Schatzkarten (handleEquipItem lässt
  // nur category 'item' zu, und die gibt es nur als type 'treasure') - früher
  // landeten sie hier pauschal auf dem Tür-Ablagestapel und wurden beim
  // Neumischen zu Türkarten.
  [...player.hand, ...equippedItemIds(player)].forEach((id) => discardCard(room, id));
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
    // Entscheidung bei Monstern mit Vorbeigeh-Option (BEKIFFTER GOLEM).
    case 'startRevealedCombat':
      startCombat(room, player.id, [action.cardId], { fromHand: false });
      return 'stellt sich dem Monster';
    case 'passMonster':
      room.doorDiscard.push(action.cardId);
      room.turnPhase = 'aerger';
      return `geht vorbei und winkt - "${card(action.cardId).name}" behaelt seinen Schatz`;
    case 'death':
      applyDeathConsequence(room, player);
      return 'Tod';
    case 'levelDelta':
      setLevel(player, player.level - action.amount);
      return `-${action.amount} Stufe(n) (jetzt Stufe ${player.level})`;
    case 'levelUp':
      setLevel(player, player.level + action.amount);
      return `+${action.amount} Stufe(n) (jetzt Stufe ${player.level})`;
    case 'levelUpAllPriests': {
      const priester = room.players.filter((p) => hasClass(p, 'PRIESTER'));
      if (!priester.length) return 'niemand ist Priester - keine Wirkung';
      priester.forEach((p) => setLevel(p, p.level + 1));
      // Ausdruecklich erlaubt: "Dies darf die Siegesstufe sein."
      priester.forEach((p) => { if (!room.winner) checkWin(room, p); });
      return `Priester steigen 1 Stufe auf: ${priester.map((p) => p.name).join(', ')}`;
    }
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
    // ponytail: Konsequenz-Wuerfe bleiben synchron - applyPrimitiveAction
    // liefert einen Text zurueck und kann nicht warten. GEZINKTER WUERFEL
    // wirkt deshalb vorerst nur auf den Weglaufwurf. Aufruestweg:
    // applyPrimitiveAction auf Callbacks umstellen.
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
    case 'discardBigItem': {
      // GALLERT-OKTAEDER: "Lass ALLE deine Grossen Gegenstaende fallen." -
      // deshalb alle betroffenen, nicht nur einer.
      const ids = equippedItemIds(player).filter((id) => isBigItem(card(id)));
      if (!ids.length) return 'kein Grosser Gegenstand getragen';
      ids.forEach((id) => { unequipSlotCard(player, id); discardCard(room, id); });
      return `Grosse Gegenstaende abgelegt: ${ids.map((id) => card(id).name).join(', ')}`;
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
        // SCHUMMELN!: dritter Transferweg neben Diebstahl/Handel, der nicht
        // ueber discardCard laeuft - Anhang muss auch hier mit der Karte weg.
        clearCheatIfLost(player, cid);
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
    // WUNSCHRING: "Beendet jeden Fluch." - siehe TREASURE_POWER_OVERRIDES.
    case 'clearCurse': {
      const removed = clearActiveCurse(room, player, action.index);
      return removed ? `Fluch "${removed.name}" beendet` : 'kein Fluch (mehr) vorhanden';
    }
    default:
      return '';
  }
}

// CONSEQUENCE_OVERRIDES, DOOR_OTHER_AS_CURSE: siehe src/cards/consequences.js.
// resolveConsequenceSpec wird als Funktionsreferenz durchgereicht (STERBENDER
// FLUCH ruft sie zur Laufzeit auf - sie liest ihrerseits CONSEQUENCE_OVERRIDES,
// ein Zyklus, der sich dadurch auflöst, dass der Aufruf erst beim Anwenden der
// Konsequenz passiert, nicht beim Laden dieses Moduls).
const consequencesFactory = require('./src/cards/consequences.js');
const { CONSEQUENCE_OVERRIDES, DOOR_OTHER_AS_CURSE } = consequencesFactory({
  card, hasRace, hasPowerGroup, isMonsterEnhancerCard,
  resolveConsequenceSpec, bigItemCount,
});

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
    // Anhaltende Flüche: zusätzlich zum (fehlenden) Sofort-Effekt den Tracker
    // eintragen - unabhängig davon, ob spec null/choice/eine Aktion ist.
    if (LINGERING_CURSES[s.name]) addActiveCurse(room, player, s.name, s.cardId);
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

function isTopLevel(room, player) {
  const maxLevel = Math.max(...room.players.map((p) => p.level));
  return player.level >= maxLevel;
}

// TREASURE_POWER_OVERRIDES, COMBAT_POTION_OVERRIDES, DOOR_COMBAT_CARDS,
// POST_FLEE_ESCAPE_CARDS, GUARANTEED_FLEE_CARDS, GUARANTEED_FLEE_MAX_MONSTER_LEVEL:
// siehe src/cards/treasures.js.
const treasuresFactory = require('./src/cards/treasures.js');
const {
  TREASURE_POWER_OVERRIDES, COMBAT_POTION_OVERRIDES, DOOR_COMBAT_CARDS,
  POST_FLEE_ESCAPE_CARDS, GUARANTEED_FLEE_CARDS, GUARANTEED_FLEE_MAX_MONSTER_LEVEL,
} = treasuresFactory({ card, hasRace, findPlayer, currentPlayer, isTopLevel });

// ROLL_REACTION_CARDS, ESCAPE_REACTION_CARDS, DOOR_POWER_CARDS, LINGERING_CURSES:
// siehe src/cards/reactions.js.
const reactionsFactory = require('./src/cards/reactions.js');
const {
  ROLL_REACTION_CARDS, ESCAPE_REACTION_CARDS, DOOR_POWER_CARDS, LINGERING_CURSES,
  COMBAT_REACTION_CARDS,
} = reactionsFactory();

// Eine Aktion, die mehrere Personen NACHEINANDER betrifft. specFor(playerId)
// liefert je Person den Inhalt (kind/options/prompt/candidateIds) - so kann
// jede Person aus ihrer eigenen Hand waehlen.
function openQueuedCardAction(room, cardName, queue, specFor) {
  room._queuedCardAction = { cardName, queue: queue.slice(), specFor };
  advanceCardActionQueue(room);
}

function advanceCardActionQueue(room) {
  const q = room._queuedCardAction;
  if (!q) {
    room.pendingCardAction = null;
    room._pendingCardActionResolvers = null;
    return;
  }
  const nextId = q.queue.shift();
  if (!nextId) {
    room._queuedCardAction = null;
    room.pendingCardAction = null;
    room._pendingCardActionResolvers = null;
    return;
  }
  const p = findPlayer(room, nextId);
  // Getrennte werden uebersprungen - sonst haengt die Partie an jemandem, der
  // gerade nicht am Geraet ist (gleiche Regel wie bei combatReadyRequired).
  if (!p || !p.connected) return advanceCardActionQueue(room);
  const spec = q.specFor(nextId);
  if (!spec) return advanceCardActionQueue(room);
  room.pendingCardAction = Object.assign({ playerId: nextId, cardName: q.cardName }, spec);
  // Der Resolver hat je "kind" eine andere Form - genau wie bei
  // openCardChoice/openCardTarget/openCardCardChoice. Eine Warteschlange darf
  // jede der drei Arten liefern (die Schnittstelle schraenkt "kind" nicht
  // ein), also muss hier dieselbe Fallunterscheidung stehen wie dort.
  if (spec.kind === 'targetPlayer') {
    room._pendingCardActionResolvers = spec.action;
  } else if (spec.kind === 'chooseCard') {
    room._pendingCardActionResolvers = null;
  } else {
    room._pendingCardActionResolvers = {};
    (spec.options || []).forEach((o) => { room._pendingCardActionResolvers[o.id] = o.action; });
  }
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
      clearCheatIfLost(target, best);
      actor.hand.push(best);
      return `${actor.name} erhält "${card(best).name}" von ${target.name}, ${target.name} +1 Stufe`;
    }
    // HILF MIR: "Nimm einen Gegenstand von einem beliebigen Spieler. In diesem
    // Augenblick muss der Gegenstand den Unterschied zwischen Gewinnen und
    // Verlieren ausmachen." ponytail: die zweite Haelfte pruefen wir nicht -
    // sie ist eine Tischabsprache, keine berechenbare Bedingung.
    case 'takeAnyItem': {
      const ids = equippedItemIds(target);
      if (!ids.length) return `${target.name} trägt keinen Gegenstand`;
      let best = ids[0];
      ids.forEach((id) => { if ((card(id).bonus || 0) > (card(best).bonus || 0)) best = id; });
      unequipSlotCard(target, best);
      clearCheatIfLost(target, best);
      actor.hand.push(best);
      refreshCombatReady(room);
      return `${actor.name} nimmt "${card(best).name}" von ${target.name}`;
    }
    // ÜBERFALLTRANK: "Ein anderer Spieler (deiner Wahl) kaempft gegen das/die
    // Monster ... Der urspruengliche Spieler ist dann wieder am Zug und darf
    // den Raum pluendern, unabhaengig davon, ob der Kampf gewonnen oder
    // verloren wurde." originalActorId ueberlebt bis zum Kampfende (siehe
    // resolveCombatWin/finishFleeSuccess/handleAckConsequence) und sorgt dort
    // fuer die Pluenderphase statt "gabe" - room.turnIndex bleibt unveraendert,
    // der Zug ist nie gewechselt.
    case 'handOverCombat': {
      const c = room.combat;
      if (!c) return 'kein Kampf im Gange';
      c.originalActorId = c.originalActorId || c.actorId;
      c.actorId = target.id;
      c.helperId = null;
      c.helperPending = null;
      c.ready = {};
      refreshCombatReady(room);
      return `${target.name} kämpft jetzt anstelle von ${actor.name}`;
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
  if (DOOR_POWER_CARDS[c.name] !== undefined) {
    spec = DOOR_POWER_CARDS[c.name](player, room);
  } else if (TREASURE_POWER_OVERRIDES[c.name] !== undefined) {
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
  // Eine Wahl kann selbst wieder eine Ziel-Auswahl auslösen (z.B. "Sinnloser
  // Akt der Freundlichkeit" -> "Auf Mitspieler anwenden"). Eine laufende
  // Warteschlange rueckt dabei NICHT sofort vor - das passiert erst, wenn die
  // Ziel-Wahl in handleResolveCardTarget aufgeloest wird (return unten).
  if (action.type === 'targetPlayer') {
    room.pendingCardAction = null;
    room._pendingCardActionResolvers = null;
    openCardTarget(room, player, pa.cardName, action.prompt, action.action);
    log(room, `${player.name}: "${pa.cardName}" -> ${option ? option.label : optionId} - Ziel nötig.`);
    touchRoom(room);
    return;
  }
  const COMBAT_ACTION_TYPES = new Set(['modifier', 'endCombatNoLevel', 'removeHelper', 'killMonsterInCombat', 'doubleStrength', 'combatAddMonster', 'combatReplaceMonster']);
  const sourceCard = pa.sourceCardId ? card(pa.sourceCardId) : null;
  const desc = COMBAT_ACTION_TYPES.has(action.type)
    ? applyCombatPotionAction(room, player, action, sourceCard)
    : applyPrimitiveAction(room, player, action);
  log(room, `${player.name}: "${pa.cardName}" -> ${option ? option.label : optionId} (${desc}).`);
  if (room._queuedCardAction) advanceCardActionQueue(room);
  else { room.pendingCardAction = null; room._pendingCardActionResolvers = null; }
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
  const desc = applyTargetAction(room, player, target, stored);
  log(room, `${player.name}: "${pa.cardName}" -> ${target.name} (${desc}).`);
  if (room._queuedCardAction) advanceCardActionQueue(room);
  else { room.pendingCardAction = null; room._pendingCardActionResolvers = null; }
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
  log(room, `${player.name}: "${pa.cardName}" -> "${chosen ? chosen.name : chosenCardId}" aus dem Ablagestapel geholt.`, [chosenCardId]);
  if (room._queuedCardAction) advanceCardActionQueue(room);
  else { room.pendingCardAction = null; room._pendingCardActionResolvers = null; }
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
  // Auch ein aus der Hand gespieltes Monster greift nicht an, wenn sein Text
  // das ausschließt - die Karte ist dann trotzdem verbraucht.
  if (monsterRefusesTarget(cardId, player)) {
    removeFromHand(player, cardId);
    room.doorDiscard.push(cardId);
    log(room, `"${c.name}" greift ${player.name} nicht an und zieht weiter.`, [cardId]);
    touchRoom(room);
    return;
  }
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
// Dauerwirkungen von Karten (Basis-Set)
//
// Bis hierher wertete der Server nur Kartentexte aus, die jemand aktiv
// ausspielt oder die als Konsequenz auflaufen. Daneben hat das Basis-Set eine
// ganze Reihe DAUERWIRKUNGEN, die ohne Zutun gelten und schlicht ignoriert
// wurden: "+6 gegen Zwerge", "Greift niemanden mit Stufe 3 oder niedriger
// an", "Flüche haben keine Wirkung". Wer Schutzsandalen trug, bekam den
// Fluch trotzdem ab - genau daran ist das hier aufgefallen.
//
// Bewusst kuratierte Tabellen statt Regex über den Kartentext: die
// Formulierungen sind zu uneinheitlich ("Elfen haben -4!" gegenüber "+6
// gegen Elfen"), und ein Regex spränge auf Karten an, die dieselbe Formel
// in einer AKTIV auszuspielenden Kraft verwenden - der Zauberer hat "+1 Bonus
// auf Weglaufen", aber nur, wenn er dafür Karten ablegt. Jede Regel steht
// mit dem Original-Kartentext im Kommentar. Ein Test prüft, dass jeder
// Tabellenname zu einer echten Karte gehört.
//
// ponytail: nur Basis-Set, wie beauftragt. Die Erweiterungs-Sets haben
// dieselben Muster (z.B. "+5 gegen Elfen" bei RIESENKAKERLAKE) - dort
// jeweils dieselben Tabellen ergänzen, die Mechanik darunter passt schon.
// ---------------------------------------------------------------------------

function hasClass(player, substr) {
  return player.classes.some((id) => { const c = card(id); return c && c.name && c.name.toUpperCase().includes(substr.toUpperCase()); });
}

function combatParticipants(room) {
  const c = room.combat;
  return [findPlayer(room, c.actorId), c.helperId ? findPlayer(room, c.helperId) : null].filter(Boolean);
}

function combatHasMonster(room, nameSet) {
  return !!room.combat && room.combat.monsterIds.some((id) => { const c = card(id); return c && nameSet.has(c.name); });
}

// Dauerwirkungstabellen (CURSE_PROOF_ITEMS, MONSTER_REFUSES, ...): siehe
// src/cards/passives.js. Aufruf hier - erst nach hasRace/hasClass, aber vor
// der ersten Benutzung der Tabellen (curseProtectionItem gleich darunter).
const passivesFactory = require('./src/cards/passives.js');
const {
  CURSE_PROOF_ITEMS, MONSTER_REFUSES, MONSTER_AUTO_KILL_BY_RACE,
  MONSTER_PASS_OPTION, MONSTER_TRAIT_BONUS, MONSTER_IGNORES_LEVEL,
  MONSTER_IGNORES_BONUSES, MONSTER_FORBIDS_HELP, FLEE_ITEM_BONUS,
  FLEE_MONSTER_MOD, FLEE_IMPOSSIBLE, FLEE_AUTOMATIC, FLEE_PENALTY,
  FLEE_TREASURE_ITEMS, MONSTER_EXTRA_LEVEL, FIRE_ITEMS,
  CLASS_COMBAT_DISCARD, UNDEAD_MONSTERS, CLASS_FLEE_DISCARD,
  ITEM_CONDITIONAL_BONUS, SPECIAL_SLOT_ITEMS, SPECIAL_SLOTS,
} = passivesFactory({ card, hasRace, hasClass });
const SPECIAL_SLOT_KEYS = Object.keys(SPECIAL_SLOTS);

// --- Fluchschutz -----------------------------------------------------------
// SCHUTZSANDALEN: siehe CURSE_PROOF_ITEMS in src/cards/passives.js.
function curseProtectionItem(player) {
  return equippedItemIds(player).find((id) => { const c = card(id); return c && CURSE_PROOF_ITEMS.has(c.name); }) || null;
}

// --- Anhaltende Flüche (M1) -------------------------------------------------
// LINGERING_CURSES (src/cards/reactions.js): Flüche, die nach dem Ziehen
// weiterwirken statt nur einmalig. Ergänzt CONSEQUENCE_OVERRIDES (die dort
// bleiben `() => null`/`noEffect`, weil sie keinen SOFORT-Effekt haben) um
// einen laufenden Zustand je Spieler:in.
function addActiveCurse(room, player, cardName, cardId) {
  const regel = LINGERING_CURSES[cardName];
  if (!regel) return;
  // ponytail: defensiv statt eine Invariante vorauszusetzen - ältere
  // Test-Helper/Spielstände ohne activeCurses sollen nicht abstürzen.
  if (!player.activeCurses) player.activeCurses = [];
  player.activeCurses.push({
    cardId, name: cardName, kind: regel.kind, amount: regel.amount || 0, dauer: regel.dauer,
  });
  log(room, `${player.name} steht unter dem Fluch "${cardName}".`);
}

// Rückgabewert statt eigenem log() - die aufrufende Stelle (applyPrimitiveAction
// 'clearCurse' -> handleUseCardPower/handleResolveCardChoice) loggt bereits
// einheitlich "X spielt WUNSCHRING: ...", wie bei jeder anderen Sonderkraft.
function clearActiveCurse(room, player, index) {
  return (player.activeCurses || []).splice(index, 1)[0] || null;
}

// "Nächster Kampf"-Flüche gelten für GENAU den einen folgenden Kampf - egal
// ob er mit Sieg oder Flucht endet. Wird an beiden Stellen aufgerufen, an
// denen ein Kampf wirklich vorbei ist (resolveCombatWin, finishFleeSuccess).
function clearNextCombatCurses(players) {
  (players || []).forEach((p) => {
    if (!p || !p.activeCurses || !p.activeCurses.length) return;
    p.activeCurses = p.activeCurses.filter((f) => f.dauer !== 'naechsterKampf');
  });
}

function curseCombatModifier(player) {
  return (player.activeCurses || [])
    .filter((f) => f.kind === 'combatMalus')
    .reduce((sum, f) => sum + f.amount, 0);
}

function curseSuppressesItemBonuses(player) {
  return (player.activeCurses || []).some((f) => f.kind === 'noItemBonusExceptArmor');
}

// ponytail: 'rollMalus' (HUHN AUF DEINEM KOPF) und 'noTwoHandedItems'
// (WINZIGE HÄNDE) werden getrackt und angezeigt, aber nicht mechanisch
// durchgesetzt (kein Abzug in rollDie, keine Anlege-Sperre in
// handleEquipItem) - wie die übrigen Dauer-Mali ohne eigenen Tracker vorher
// bleiben sie bewusst manuell. Ausbauweg: rollDie um curseRollModifier(player)
// ergänzen bzw. handleEquipItem für zweihändige Gegenstände sperren.

// --- Monster, die bestimmte Munchkins gar nicht angreifen ------------------
// siehe MONSTER_REFUSES in src/cards/passives.js. Das Monster zieht weiter:
// kein Kampf, kein Schatz, keine Stufe. Die Karte wandert auf den Ablage-
// stapel und der Zug läuft normal mit Phase 2 weiter - damit bleiben beide
// regulären Optionen offen (Monster aus der Hand spielen oder plündern).
function monsterRefusesTarget(cardId, player) {
  const c = card(cardId);
  const rule = c && MONSTER_REFUSES[c.name];
  return !!rule && rule(player);
}

// --- Monster, die eine Rasse automatisch totstampft ----------------------
// siehe MONSTER_AUTO_KILL_BY_RACE in src/cards/passives.js. Umgesetzt als
// Staerke 0 in der Kampfrechnung: besiegt wird das Monster dann ueber die
// normale Auswertung, Stufe und Schatz gibt es also trotzdem.
function monsterAutoKilled(m, sides) {
  const race = m && MONSTER_AUTO_KILL_BY_RACE[m.name];
  return !!race && sides.some((p) => hasRace(p, race));
}

// --- Monster, an denen man auch einfach vorbeigehen darf -----------------
// siehe MONSTER_PASS_OPTION in src/cards/passives.js. Gilt nur fuer
// aufgedeckte Monster - ein aus der Hand gespieltes Monster hat sich die
// kaempfende Person selbst eingeladen.
function monsterPassOption(cardId, player) {
  const c = card(cardId);
  const rule = c && MONSTER_PASS_OPTION[c.name];
  if (!rule) return null;
  if ((rule.forcedFightRaces || []).some((r) => hasRace(player, r))) return null;
  return rule;
}

// --- Monsterboni gegen Rassen/Klassen --------------------------------------
// siehe MONSTER_TRAIT_BONUS in src/cards/passives.js. Der Bonus gilt einmal
// pro Monster, sobald IRGENDWER auf der Munchkin-Seite die Rasse/Klasse hat
// (Angreifer:in oder Helfer:in) - nicht einmal pro Person.
function monsterTraitBonusSum(room) {
  const parts = combatParticipants(room);
  return room.combat.monsterIds.reduce((sum, id) => {
    const c = card(id);
    const rule = c && MONSTER_TRAIT_BONUS[c.name];
    if (!rule) return sum;
    const hit = parts.some((p) => (rule.races || []).some((r) => hasRace(p, r)) || (rule.classes || []).some((k) => hasClass(p, k)));
    return sum + (hit ? rule.bonus : 0);
  }, 0);
}

// --- Monster, die die Kampfrechnung selbst verändern ---------------------
// siehe MONSTER_IGNORES_LEVEL, MONSTER_IGNORES_BONUSES, MONSTER_FORBIDS_HELP
// in src/cards/passives.js. Die ersten beiden Regeln gelten für die ganze
// Munchkin-Seite: sobald jemand mithilft, kämpfen beide gegen dasselbe
// Monster, also trifft die Einschränkung auch die Helfer:in.

// --- Weglaufen -------------------------------------------------------------
// siehe FLEE_ITEM_BONUS, FLEE_MONSTER_MOD, FLEE_IMPOSSIBLE, FLEE_AUTOMATIC,
// FLEE_PENALTY, FLEE_TREASURE_ITEMS in src/cards/passives.js. Der Zauberer-
// Flugzauber ("+1 pro abgelegter Karte") steht bewusst NICHT dort - er
// kostet Karten und bleibt darum eine manuelle Eingabe im Weglaufen-Feld.

// Summiert alle festen Weglaufen-Modifikatoren und liefert die Einzelposten
// mit, damit Log und Würfelanimation sie benennen können.
function fleeModifierParts(room, player) {
  const parts = [];
  if (hasRace(player, 'ELF')) parts.push({ label: 'Elf', amount: 1 }); // "Du hast +1 auf Weglaufen."
  // Machtgruppe Assassine der Roten Mantis, "Heimlichkeit".
  if (hasPowerGroup(player, 'ASSASSINE DER ROTEN MANTIS')) parts.push({ label: 'Heimlichkeit', amount: 1 });
  equippedItemIds(player).forEach((id) => {
    const c = card(id);
    if (c && FLEE_ITEM_BONUS[c.name]) parts.push({ label: c.name, amount: FLEE_ITEM_BONUS[c.name] });
  });
  if (room.combat) {
    room.combat.monsterIds.forEach((id) => {
      const c = card(id);
      if (c && FLEE_MONSTER_MOD[c.name]) parts.push({ label: c.name, amount: FLEE_MONSTER_MOD[c.name] });
    });
    // Bereits abgeworfene Flugzauber-Karten (siehe CLASS_FLEE_DISCARD).
    if (room.combat.fleeBonus) parts.push({ label: 'Flugzauber', amount: room.combat.fleeBonus });
  }
  return parts;
}

// --- Bedingtes Reaktionsfenster --------------------------------------------
// Manche Karten reagieren auf ein Ereignis, statt aktiv ausgespielt zu
// werden (GEZINKTER WÜRFEL auf einen Wurf, KLEBERFLÄSCHCHEN auf eine
// gelungene Flucht). Dafür braucht es ein kurzes Zeitfenster, das der Server
// sonst nirgends hat.

// Wer koennte auf dieses Ereignis reagieren? Bots spielen keine
// Reaktionskarten, Getrennte koennen nicht - beide oeffnen deshalb kein
// Fenster, sonst haengt die Partie an niemandem.
function reactionHolders(room, cardSet) {
  return room.players
    .filter((p) => p.connected && !p.isBot
      && p.hand.some((id) => cardSet.has((card(id) || {}).name)))
    .map((p) => p.id);
}

// ponytail: kein generischer Reaktions-Stack. Haelt niemand eine passende
// Karte, laeuft alles synchron weiter - bitgleich zum Verhalten vorher. Ein
// Fenster entsteht nur, wenn es wirklich jemanden gibt, der es nutzen
// koennte. Obergrenze: genau zwei Ausloeser (Wurf, gelungene Flucht). Kommen
// mehr dazu, lohnt sich ein echter Stack.
function rollWithWindow(room, player, purpose, onResolve) {
  const roll = rollDie();
  const holders = reactionHolders(room, ROLL_REACTION_CARDS);
  if (!holders.length) { onResolve(roll); return; }
  room.pendingRoll = { playerId: player.id, purpose, roll, holders, onResolve };
  log(room, `${player.name} würfelt ${roll} - es darf noch auf den Wurf reagiert werden.`);
}

function resolvePendingRoll(room, finalRoll) {
  const pr = room.pendingRoll;
  if (!pr) return;
  room.pendingRoll = null;
  pr.onResolve(typeof finalRoll === 'number' ? finalRoll : pr.roll);
}

// Gemeinsamer Einstiegspunkt fuer beide Reaktionskarten: welches Fenster
// gerade offen ist (Wurf oder gelungene Flucht), entscheidet, welcher Ast
// greift. Aussenrum bewusst kein drittes generisches Feld - siehe
// ponytail-Kommentar oben.
function handlePlayReactionCard(room, playerId, cardId, value) {
  const pr = room.pendingRoll;
  if (pr && pr.holders.includes(playerId)) {
    const p = findPlayer(room, playerId);
    const c = card(cardId);
    if (!p || !c || !p.hand.includes(cardId) || !ROLL_REACTION_CARDS.has(c.name)) return;
    const neu = Math.max(1, Math.min(6, Math.round(Number(value) || pr.roll)));
    removeFromHand(p, cardId);
    discardCard(room, cardId);
    log(room, `${p.name} spielt "${c.name}": Wurf ${pr.roll} wird zu ${neu}.`, [cardId]);
    resolvePendingRoll(room, neu);
    touchRoom(room);
    return;
  }
  const combat = room.combat;
  const offer = combat && combat.escapeReactionOffer;
  if (offer && offer.includes(playerId)) {
    const p = findPlayer(room, playerId);
    const c = card(cardId);
    if (!p || !c || !p.hand.includes(cardId) || !ESCAPE_REACTION_CARDS.has(c.name)) return;
    const actor = findPlayer(room, combat.actorId);
    removeFromHand(p, cardId);
    discardCard(room, cardId);
    combat.escapeReactionOffer = null;
    combat.escapeReactionDone = true; // verhindert eine Endlosschleife bei erneut gelungener Flucht
    log(room, `${p.name} spielt "${c.name}": ${actor.name} muss die Flucht noch einmal würfeln.`, [cardId]);
    touchRoom(room);
    handleAttemptFlee(room, actor.id, combat.fleeManualModifier || 0);
  }
}

function handlePassReaction(room, playerId) {
  const pr = room.pendingRoll;
  if (pr && pr.holders.includes(playerId)) {
    pr.holders = pr.holders.filter((id) => id !== playerId);
    if (!pr.holders.length) resolvePendingRoll(room, pr.roll);
    touchRoom(room);
    return;
  }
  const combat = room.combat;
  const offer = combat && combat.escapeReactionOffer;
  if (offer && offer.includes(playerId)) {
    combat.escapeReactionOffer = offer.filter((id) => id !== playerId);
    if (!combat.escapeReactionOffer.length) {
      const actor = findPlayer(room, combat.actorId);
      combat.escapeReactionOffer = null;
      finishFleeSuccess(room, actor, combat);
    }
    touchRoom(room);
  }
}

// --- Bonusstufen und Bonusschätze beim Sieg ------------------------------
// siehe MONSTER_EXTRA_LEVEL, FIRE_ITEMS in src/cards/passives.js. (In diesem
// Server findet ein Kampf immer im eigenen Zug statt, die Bedingung "während
// deines Zugs" ist also immer erfüllt.)
function monsterVictoryExtras(room, actor, helper, monsters) {
  const c = room.combat;
  let levels = 0;
  let treasures = 0;
  monsters.forEach((m) => {
    if (MONSTER_EXTRA_LEVEL.has(m.name)) levels += 1;
    // "Du erhältst eine Extrastufe, wenn du es ohne Hilfe und Boni besiegst."
    if (m.name === 'PIKOTZU' && !helper && c.actorModifier === 0 && equippedBonusSum(actor) === 0) levels += 1;
    if (m.name === 'GROSSES WUTENDES HUHN' && equippedItemIds(actor).some((id) => FIRE_ITEMS.has((card(id) || {}).name))) levels += 1;
    // "Elfen ziehen 1 zusätzlichen Schatz, nachdem sie besiegt wurde."
    if (m.name === 'TOPFPFLANZE' && hasRace(actor, 'ELF')) treasures += 1;
  });
  return { levels, treasures };
}

// --- Klassenkräfte: Karten im Kampf abwerfen ------------------------------
// siehe CLASS_COMBAT_DISCARD, UNDEAD_MONSTERS, CLASS_FLEE_DISCARD in
// src/cards/passives.js. Drei der vier Basis-Klassen haben dieselbe Form:
// bis zu 3 Handkarten abwerfen, jede gibt einen festen Bonus. Dafür gab es
// bisher überhaupt keinen Weg im Spiel - nur das manuelle Bonus-Zahlenfeld,
// das aber keine Karte abwirft.

// DIEB "In den Rücken fallen" (-2 für eine ANDERE Person) fehlt hier
// bewusst: die Kraft richtet sich gegen Mitspieler:innen, und genau das ist
// laut Kommentar am Dateianfang durchgehend manuell gehalten.

function classDiscardPower(room, player) {
  const c = room.combat;
  if (!c) return null;
  const flee = !!c.mustFlee;
  const table = flee ? CLASS_FLEE_DISCARD : CLASS_COMBAT_DISCARD;
  const name = Object.keys(table).find((n) => hasClass(player, n));
  if (!name) return null;
  const rule = table[name];
  if (rule.requiresUndead && !combatHasMonster(room, UNDEAD_MONSTERS)) return null;
  const used = (c.classDiscards || {})[`${player.id}:${flee ? 'flee' : 'combat'}`] || 0;
  return Object.assign({ className: name, kind: flee ? 'flee' : 'combat', used, remaining: Math.max(0, rule.max - used) }, rule);
}

// Was die/der Einzelne gerade nutzen darf - wandert ins private yourInfo,
// damit der Client keine eigene Kopie der Tabellen braucht.
function classCombatPowerInfo(room, player) {
  const c = room.combat;
  if (!c) return null;
  if (player.id !== c.actorId && player.id !== c.helperId) return null;
  const power = classDiscardPower(room, player);
  if (!power) return null;
  return { label: power.label, className: power.className, bonus: power.bonus, kind: power.kind, remaining: power.remaining };
}

// ZAUBERER "Verzauberung": "Du darfst deine ganze Hand ablegen (Minimum 3
// Karten), um ein einzelnes Monster zu verzaubern, anstatt zu bekaempfen.
// Lege das Monster ab und nimm seinen Schatz, erhalte aber keine Stufe.
// Sollten mehrere Monster am Kampf beteiligt sein, musst du die anderen
// normal bekaempfen." -> mechanisch dasselbe wie das VERZAUBERARMBAND, nur
// mit der ganzen Hand als Preis; deshalb keine eigene Schatzauszahlung.
const ENCHANT_MIN_HAND = 3;

function enchantInfo(room, player) {
  const c = room.combat;
  if (!c || c.mustFlee || c.actorId !== player.id) return null;
  if (!hasClass(player, 'ZAUBERER')) return null;
  if (c.monsterIds.length !== 1) return null; // mehrere Monster: normal kaempfen
  if (player.hand.length < ENCHANT_MIN_HAND) return null;
  const m = card(c.monsterIds[0]);
  return { handCount: player.hand.length, monsterName: m ? m.name : '?' };
}

function handleEnchantMonster(room, playerId) {
  const player = findPlayer(room, playerId);
  if (!player) return;
  const info = enchantInfo(room, player);
  if (!info) return;
  const hand = player.hand.slice();
  hand.forEach((id) => { removeFromHand(player, id); discardCard(room, id); });
  const desc = applyCombatPotionAction(room, player, { type: 'endCombatNoLevel', leavesTreasure: true }, null);
  log(room, `${player.name} (Zauberer) legt die ganze Hand ab (${hand.length} Karten) und verzaubert "${info.monsterName}": ${desc}.`, hand);
  touchRoom(room);
}

function handleUseClassCombatDiscard(room, playerId, cardId) {
  if (!room.combat) return;
  const c = room.combat;
  const player = findPlayer(room, playerId);
  if (!player || !player.hand.includes(cardId)) return;
  // Nur wer wirklich im Kampf steht - Zuschauer:innen dürfen nicht abwerfen.
  if (playerId !== c.actorId && playerId !== c.helperId) return;
  const power = classDiscardPower(room, player);
  if (!power || power.remaining <= 0) return;
  c.classDiscards = c.classDiscards || {};
  c.classDiscards[`${playerId}:${power.kind}`] = power.used + 1;
  removeFromHand(player, cardId);
  discardCard(room, cardId);
  if (power.kind === 'flee') {
    c.fleeBonus = (c.fleeBonus || 0) + power.bonus;
    log(room, `${player.name} (${power.className}) legt "${card(cardId).name}" ab - ${power.label}: +${power.bonus} auf Weglaufen.`, [cardId]);
  } else {
    c.actorModifier += power.bonus;
    log(room, `${player.name} (${power.className}) legt "${card(cardId).name}" ab - ${power.label}: +${power.bonus} im Kampf.`, [cardId]);
  }
  touchRoom(room);
}

// --- Handkartenlimit -------------------------------------------------------
// ZWERG: "Du darfst sechs Karten auf deiner Hand haben."
function handLimit(player) {
  return player && hasRace(player, 'ZWERG') ? HAND_LIMIT + 1 : HAND_LIMIT;
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
    classDiscards: {}, // "<playerId>:combat"/"<playerId>:flee" -> Anzahl bereits abgeworfener Karten
    fleeBonus: 0,      // Summe der Flugzauber-Karten
    treasureDelta: 0,  // Schatzbonus/-malus gespielter Monster-Verstärker
    ready: {},         // playerId -> true, sobald jemand die Auswertung freigibt
    readySignature: null,
  };
  touchRoom(room);
}

// ---------------------------------------------------------------------------
// Bereit-Check vor der Kampfauswertung
//
// Jede:r am Tisch darf in einen laufenden Kampf eingreifen (Monster-
// Verstärker, Kampf-Tränke, das manuelle Bonusfeld). Vorher konnte die
// kämpfende Person aber sofort auf "Kampf auswerten" drücken - wer das
// Monster noch verstärken wollte, hatte nur seine Reaktionsgeschwindigkeit.
// Deshalb muss jetzt jede:r andere bestätigen, dass nichts mehr kommt.
// ---------------------------------------------------------------------------

// Wer bestätigen muss: alle außer der kämpfenden Person. Bots greifen nie
// ein und gelten sofort als bereit, Getrennte werden übersprungen - sonst
// hängt das Spiel an jemandem, der gerade nicht am Gerät ist.
function combatReadyRequired(room) {
  const c = room.combat;
  if (!c) return [];
  return room.players.filter((p) => p.id !== c.actorId && p.connected && !p.isBot).map((p) => p.id);
}

function combatAllReady(room) {
  const c = room.combat;
  if (!c) return false;
  return combatReadyRequired(room).every((id) => (c.ready || {})[id]);
}

// Der Bereit-Status verfällt, sobald sich am Kampf irgendetwas ändert -
// sonst bestätigen alle, jemand spielt danach noch "Uralt +10", und der
// Kampf löst mit veralteter Zustimmung aus.
//
// Bewusst über eine Signatur statt über einen Reset-Aufruf in jedem
// einzelnen Handler: so kann keine künftig ergänzte Karte den Reset
// vergessen. Die Signatur enthält die fertigen Summen, also wirkt auch
// Ausrüsten mitten im Kampf.
function combatSignature(room) {
  const c = room.combat;
  if (!c) return null;
  const t = combatTotals(room);
  return JSON.stringify([c.monsterIds, c.helperId, c.actorModifier, c.monsterModifier,
    t.playerStrength, t.monsterStrength, c.mustFlee]);
}

function refreshCombatReady(room) {
  const c = room.combat;
  if (!c) return;
  const sig = combatSignature(room);
  if (c.readySignature !== sig) {
    c.ready = {};
    c.readySignature = sig;
  }
}

function handleSetCombatReady(room, playerId, ready) {
  const c = room.combat;
  if (!c) return;
  if (!combatReadyRequired(room).includes(playerId)) return;
  c.ready = c.ready || {};
  if (ready) c.ready[playerId] = true; else delete c.ready[playerId];
  const p = findPlayer(room, playerId);
  log(room, `${p.name} ist ${ready ? 'bereit' : 'doch noch nicht bereit'} für die Auswertung.`);
  touchRoom(room);
}

function combatTotals(room) {
  const c = room.combat;
  const actor = findPlayer(room, c.actorId);
  const helper = c.helperId ? findPlayer(room, c.helperId) : null;
  const monsters = c.monsterIds.map(card);
  const sides = [actor, helper].filter(Boolean);
  // Eingestampfte Monster (siehe MONSTER_AUTO_KILL_BY_RACE) bringen keine
  // Stufe in die Rechnung ein.
  const monsterLevel = monsters.reduce((sum, m) => sum + (monsterAutoKilled(m, sides) ? 0 : (m.level || 0)), 0);
  const ignoreLevel = combatHasMonster(room, MONSTER_IGNORES_LEVEL);
  const ignoreBonuses = combatHasMonster(room, MONSTER_IGNORES_BONUSES);
  let playerStrength;
  if (ignoreBonuses) {
    // GEMEINE GHOULE: nur die Charakterstufe(n) - keine Ausrüstung, keine
    // ausgespielten Karten. Monster-Verstärker bleiben davon unberührt.
    playerStrength = sides.reduce((sum, p) => sum + p.level, 0);
  } else {
    playerStrength = sides.reduce((sum, p) => {
      // MIESER SPIEGEL: "keine Boni durch Gegenstände, die einzige Ausnahme
      // sind Rüstungsboni" - sonst zaehlen Ausruestung + situative Item-Boni
      // wie gewohnt. hellknightArmorBonus bleibt in beiden Faellen stehen
      // (kein regulaerer Gegenstands-Slot, siehe Kommentar dort).
      const items = curseSuppressesItemBonuses(p)
        ? ((card(p.equipped.armor) || {}).bonus || 0)
        : equippedBonusSum(p) + conditionalItemBonusSum(p, monsters);
      return sum + p.level + items + hellknightArmorBonus(p)
        + curseCombatModifier(p) - (ignoreLevel ? p.level : 0);
    }, 0) + c.actorModifier;
  }
  // DOPPELGAENGER: "Verdopple deine Kampfstaerke" - auf die fertige Summe der
  // Munchkin-Seite, gespielte Karten eingeschlossen.
  if (c.doubleActor) playerStrength *= 2;
  const monsterStrength = monsterLevel + c.monsterModifier + monsterTraitBonusSum(room);
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
  const totals = combatTotals(room);
  return {
    actorConditionalBonus: conditionalItemBonusSum(actor, monsters),
    helperConditionalBonus: helper ? conditionalItemBonusSum(helper, monsters) : 0,
    // Fertig gerechnete Summen: der Client hat sie früher selbst
    // nachgerechnet und würde die Monsterboni gegen Rassen/Klassen und die
    // Sonderregeln sonst nicht kennen - zwei Rechenwege, die auseinander-
    // laufen können. Jetzt zeigt er genau das an, was der Server wertet.
    playerStrength: totals.playerStrength,
    monsterStrength: totals.monsterStrength,
    readyRequired: combatReadyRequired(room),
    allReady: combatAllReady(room),
    monsterTraitBonus: monsterTraitBonusSum(room),
    ignoresLevel: combatHasMonster(room, MONSTER_IGNORES_LEVEL),
    ignoresBonuses: combatHasMonster(room, MONSTER_IGNORES_BONUSES),
    forbidsHelp: combatHasMonster(room, MONSTER_FORBIDS_HELP),
    autoKilledMonsters: monsters.filter((m) => monsterAutoKilled(m, [actor, helper].filter(Boolean))).map((m) => m.name),
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
// Das bloße "im Kampf" reicht als Spielbarkeits-Hinweis, weil
// isCombatPotionCard zusätzlich einen geparsten +N-Bonus verlangt
// ("Sorgen im Kampf für Ablenkung. +5, egal für welche Seite.").
const COMBAT_PLAYABLE_RE = /im\s+Kampf\b|Während\s+(eines\s+)?beliebige[nm]\s+Kampf(es)?\s+spielen/i;

function parseCombatPotion(rawText) {
  const t = normalizeCardText(rawText);
  let m = t.match(/\+(\d+)\s+für\s+beide\s+Seiten/i);
  if (m) return { side: 'both', amount: parseInt(m[1], 10) };
  // Alle Schreibweisen des Grundspiels: "+2 egal für welche Seite", "+5 für
  // egal welche Seite", "+5, egal für welche Seite", "+3 für eine der
  // Parteien, egal für welche Seite".
  m = t.match(/\+(\d+)[,\s]+(?:für\s+)?(?:eine\s+der\s+Parteien,\s*)?egal[,\s]+(?:für\s+)?welche\s+Seite/i);
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
// nicht erfüllt. Siehe COMBAT_POTION_OVERRIDES, DOOR_COMBAT_CARDS in
// src/cards/treasures.js.

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
    // Kampf endet, ohne dass ein Monster besiegt wurde: nie Stufen. Ob es
    // Schatz gibt, sagt der Kartentext - "lässt seinen Schatz zurück"
    // (leavesTreasure) gegen "du erhältst keinen Schatz".
    case 'endCombatNoLevel': {
      const monsters = c.monsterIds.map(card);
      const names = monsters.map((m) => m.name).join(' + ');
      if (action.returnToDoorDeckBottom) [...new Set(c.monsterIds)].forEach((id) => room.doorDeck.unshift(id));
      else discardMonsterIds(room.doorDiscard, c.monsterIds);
      const drawn = [];
      if (action.leavesTreasure) {
        // Schatz wie beim Sieg: an die kämpfende Person, nicht an die, die
        // den Trank gespielt hat (jede:r am Tisch darf ihn einwerfen).
        const actor = findPlayer(room, c.actorId) || player;
        // MAHLZEIT! nennt eine feste Zahl, sonst gilt der treasureCount der
        // zurueckgelassenen Monster.
        const treasureCount = typeof action.fixedTreasures === 'number'
          ? action.fixedTreasures
          : monsters.reduce((sum, m) => sum + (m.treasureCount || 0), 0);
        for (let i = 0; i < treasureCount; i++) { const t = drawTreasure(room); if (t) drawn.push(t); }
        drawn.forEach((id) => actor.hand.push(id));
        actor.lastReward = {
          seq: (actor.lastReward ? actor.lastReward.seq : 0) + 1,
          cardIds: drawn,
          levelsGained: 0,
          monsterNames: monsters.map((m) => m.name),
        };
      }
      room.combat = null;
      room.turnPhase = action.thenLoot ? 'pluendern' : 'gabe';
      return action.leavesTreasure
        ? `Kampf gegen ${names} beendet, keine Stufe, ${drawn.length} zurückgelassene Schatzkarte(n)`
        : `Kampf gegen ${names} beendet, kein Schatz`;
    }
    case 'doubleStrength': {
      c.doubleActor = true;
      return 'Kampfstaerke der Munchkin-Seite verdoppelt';
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
    // WANDERNDES MONSTER: "Dein Monster schliesst sich dem schon kaempfenden
    // an - addiere ihre Kampfstaerken."
    case 'combatAddMonster': {
      removeFromHand(player, action.cardId);
      c.monsterIds.push(action.cardId);
      refreshCombatReady(room);
      return `"${card(action.cardId).name}" schliesst sich dem Kampf an`;
    }
    // ILLUSION: "Lege ein beliebiges Monster in diesem Kampf ab, zusammen mit
    // allen Karten, die gespielt wurden, um es zu veraendern, und ersetze es."
    case 'combatReplaceMonster': {
      removeFromHand(player, action.cardId);
      const alt = c.monsterIds.shift();
      if (alt) room.doorDiscard.push(alt);
      c.monsterIds.unshift(action.cardId);
      // monsterModifier ist ein einziges kampfweites Feld, keine Zuordnung
      // pro Monster - bei genau einem Monster im Kampf (Regelfall) verfaellt
      // er damit korrekt mit dem ausgetauschten Monster. ponytail: bei
      // mehreren Monstern (Kumpel/Wanderndes Monster im selben Kampf) trifft
      // der Reset faelschlich auch die anderen - Aufruestweg: monsterModifier
      // pro monsterId statt kampfweit fuehren, falls das je gebraucht wird.
      c.monsterModifier = 0;
      refreshCombatReady(room);
      return `"${card(alt).name}" wird durch "${card(action.cardId).name}" ersetzt`;
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
  // COMBAT_REACTION_CARDS (Kumpel, Wanderndes Monster, Illusion, Hilf mir,
  // Ueberfalltrank): sie greifen selbst in monsterIds/actorId ein statt nur
  // einen Zahlenwert zu addieren - deshalb vor der Verstaerker-/Trank-Logik.
  const reaktion = COMBAT_REACTION_CARDS[c.name];
  if (reaktion) {
    if (room.pendingCardAction || room.pendingConsequence) return;
    applyCombatReaction(room, player, cardId, reaktion);
    return;
  }
  if (isMonsterEnhancerCard(c)) {
    removeFromHand(player, cardId);
    room.combat.monsterModifier += c.bonus;
    // "Wird das Monster besiegt, ziehe 2 zusätzliche Schätze" (GIGANTISCH,
    // URALT) bzw. "ziehe 1 Schatz weniger, mindestens 1" (BABY): der Wert
    // steckt in treasureCount der Verstärkerkarte. Aufgesammelt hier,
    // ausgezahlt in resolveCombatWin.
    const delta = typeof c.treasureCount === 'number' ? c.treasureCount : 0;
    if (delta) room.combat.treasureDelta = (room.combat.treasureDelta || 0) + delta;
    room.doorDiscard.push(cardId);
    log(room, `${player.name} spielt "${c.name}" im Kampf (${c.bonus >= 0 ? '+' : ''}${c.bonus} für das Monster${delta ? `, ${delta >= 0 ? '+' : ''}${delta} Schatz` : ''}).`, [cardId]);
    touchRoom(room);
    return;
  }
  if (DOOR_COMBAT_CARDS[c.name]) {
    const doorSpec = DOOR_COMBAT_CARDS[c.name](player, room);
    if (doorSpec == null) {
      log(room, `${player.name} kann "${c.name}" gerade nicht einsetzen (Bedingung nicht erfuellt).`);
      touchRoom(room);
      return;
    }
    removeFromHand(player, cardId);
    discardCard(room, cardId);
    const desc = applyCombatPotionAction(room, player, doorSpec, c);
    log(room, `${player.name} spielt "${c.name}" im Kampf: ${desc}.`, [cardId]);
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
  // Über discardCard(), weil Kampf-Tränke type 'treasure' sind: auf dem
  // Tür-Ablagestapel würden sie beim Neumischen (drawDoor) zu Türkarten.
  discardCard(room, cardId);
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

// Wendet eine der fuenf COMBAT_REACTION_CARDS an - siehe Kommentar dort im
// Kartennamen-Kommentar (src/cards/reactions.js) fuer den Originaltext.
function applyCombatReaction(room, player, cardId, regel) {
  const c = room.combat;
  const karte = card(cardId);
  if (regel.kind === 'duplicateMonster') {
    // Dieselbe Karten-ID ein zweites Mal in den Kampf: Stufe, Schatzzahl und
    // alle Dauerwirkungen gelten damit automatisch doppelt (siehe
    // combatTotals/resolveCombatWin). Beim Ablegen darf die ID trotzdem nur
    // einmal auf den Stapel wandern - siehe discardMonsterIds weiter unten.
    const erstes = c.monsterIds[0];
    if (!erstes) return;
    c.monsterIds.push(erstes);
    removeFromHand(player, cardId);
    discardCard(room, cardId);
    log(room, `${player.name} spielt "${karte.name}": "${card(erstes).name}" taucht ein zweites Mal auf.`, [cardId]);
    refreshCombatReady(room);
    touchRoom(room);
    return;
  }
  if (regel.kind === 'addMonsterFromHand' || regel.kind === 'replaceMonsterFromHand') {
    const eigene = player.hand.filter((id) => (card(id) || {}).category === 'monster');
    if (!eigene.length) {
      log(room, `${player.name} hat kein Monster auf der Hand - "${karte.name}" bleibt liegen.`);
      touchRoom(room);
      return;
    }
    removeFromHand(player, cardId);
    discardCard(room, cardId);
    openCardChoice(room, player, karte.name, eigene.map((id) => ({
      id: `mon-${id}`,
      label: card(id).name,
      action: regel.kind === 'addMonsterFromHand'
        ? { type: 'combatAddMonster', cardId: id }
        : { type: 'combatReplaceMonster', cardId: id },
    })));
    log(room, `${player.name} spielt "${karte.name}" - Monster von der Hand nötig.`, [cardId]);
    touchRoom(room);
    return;
  }
  if (regel.kind === 'takeItemFromPlayer') {
    removeFromHand(player, cardId);
    discardCard(room, cardId);
    openCardTarget(room, player, karte.name, 'Von wem einen Gegenstand nehmen?', { type: 'takeAnyItem' });
    log(room, `${player.name} spielt "${karte.name}" - Ziel nötig.`, [cardId]);
    touchRoom(room);
    return;
  }
  if (regel.kind === 'handOverCombat') {
    removeFromHand(player, cardId);
    discardCard(room, cardId);
    openCardTarget(room, player, karte.name, 'Wer soll stattdessen kämpfen?', { type: 'handOverCombat' });
    log(room, `${player.name} spielt "${karte.name}" - Ziel nötig.`, [cardId]);
    touchRoom(room);
  }
}

function handleRequestHelp(room, playerId, targetId) {
  if (!room.combat) return;
  const c = room.combat;
  if (c.actorId !== playerId || c.helperId) return;
  const actor = findPlayer(room, playerId);
  const target = findPlayer(room, targetId);
  if (!target || targetId === c.actorId) return;
  // "Niemand kann dir helfen. Du musst dich dem Pavillon allein stellen."
  if (combatHasMonster(room, MONSTER_FORBIDS_HELP)) {
    log(room, 'Gegen dieses Monster darf niemand helfen.');
    touchRoom(room);
    return;
  }
  // KNIESCHÜTZER DER VERLOCKUNG: "Kein Spieler mit einer höheren Stufe als du
  // darf deine Bitte ablehnen ... beizustehen." Die Karte bleibt beim
  // Anfragen auf der Hand (treasure_other, nicht anlegbar) - "das Fragen nach
  // einer Belohnung" bildet der Server nirgends ab und bleibt daher aussen vor.
  const compelled = target.level > actor.level
    && actor.hand.some((id) => { const cc = card(id); return cc && cc.name === 'KNIESCHÜTZER DER VERLOCKUNG'; });
  c.helperPending = { targetId, compelled };
  log(room, `${actor.name} bittet ${target.name} um Hilfe${compelled ? ' (Knieschützer der Verlockung: kann nicht ablehnen)' : ''}.`);
  touchRoom(room);
}

function handleRespondHelp(room, playerId, accept) {
  if (!room.combat || !room.combat.helperPending) return;
  const c = room.combat;
  if (c.helperPending.targetId !== playerId) return;
  const target = findPlayer(room, playerId);
  const compelled = !!c.helperPending.compelled;
  if (!accept && compelled) {
    log(room, `${target.name} darf nicht ablehnen (Knieschützer der Verlockung).`);
    accept = true;
  }
  if (accept) {
    c.helperId = playerId;
    // "In einem Kampf, bei dem der Helfer ... genötigt wurde, kannst du
    // nicht die Siegesstufe erreichen." Greift in resolveCombatWin.
    if (compelled) c.noWinLevel = true;
    log(room, `${target.name} hilft im Kampf.`);
  } else {
    log(room, `${target.name} lehnt ab.`);
  }
  c.helperPending = null;
  touchRoom(room);
}

// "Du gewinnst bei einem Gleichstand im Kampf." ALUFOLIE ist eine
// treasure_other-Karte und damit nicht anlegbar - sie liegt auf der Hand.
// Ohne sie verliert ein Gleichstand immer, sie einzusetzen ist also nie
// schlechter als sie liegen zu lassen. Deshalb ohne Rückfrage automatisch,
// statt dafür eine eigene Kampf-Schaltfläche zu bauen.
// ponytail: als Einwegkarte behandelt (Text nennt keine Dauerwirkung).
const TIE_BREAKER_CARD = 'ALUFOLIE';

function findTieBreaker(room) {
  const c = room.combat;
  const sides = [findPlayer(room, c.actorId), c.helperId ? findPlayer(room, c.helperId) : null];
  for (const p of sides) {
    if (!p) continue;
    const cardId = p.hand.find((id) => { const cd = card(id); return cd && cd.name === TIE_BREAKER_CARD; });
    if (cardId) return { player: p, cardId };
  }
  return null;
}

function handleEvaluateCombat(room, playerId) {
  if (!room.combat) return;
  const c = room.combat;
  if (c.actorId !== playerId) return;
  // Erst auswerten, wenn niemand mehr eingreifen will.
  if (!combatAllReady(room)) return;
  const { playerStrength, monsterStrength } = combatTotals(room);
  // KRIEGER: "Bei Gleichstand im Kampf gewinnst du." Greift vor der
  // ALUFOLIE-Notlösung, damit die Karte nicht unnötig verbraucht wird.
  const warrior = playerStrength === monsterStrength
    ? combatParticipants(room).find((p) => hasClass(p, 'KRIEGER')) : null;
  if (warrior) {
    log(room, `Gleichstand (${playerStrength} vs. ${monsterStrength}) - ${warrior.name} ist Krieger und gewinnt ihn.`);
    resolveCombatWin(room);
    return;
  }
  const tie = playerStrength === monsterStrength ? findTieBreaker(room) : null;
  if (tie) {
    removeFromHand(tie.player, tie.cardId);
    discardCard(room, tie.cardId);
    log(room, `${tie.player.name} setzt "${TIE_BREAKER_CARD}" ein: Gleichstand (${playerStrength} vs. ${monsterStrength}) zählt als Sieg.`, [tie.cardId]);
  }
  if (playerStrength > monsterStrength || tie) {
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
  // MIESER SPIEGEL/GESCHLECHTSUMWANDLUNG gelten nur "im nächsten Kampf" -
  // der ist hiermit vorbei (gewonnen).
  clearNextCombatCurses([actor, helper]);
  const monsters = c.monsterIds.map(card);
  // 1 Stufe pro besiegtem Monster, dazu die kartenspezifischen Bonusstufen
  // und -schätze (Bossmonster, PIKOTZU ohne Hilfe, Feuer gegen das Huhn,
  // Elfen gegen die Topfpflanze) - siehe monsterVictoryExtras.
  const extras = monsterVictoryExtras(room, actor, helper, monsters);
  const levelsGained = monsters.length + extras.levels;
  setLevel(actor, actor.level + levelsGained);
  const baseTreasures = monsters.reduce((sum, m) => sum + (m.treasureCount || 0), 0) + extras.treasures;
  // Monster-Verstärker aus dem Kampf zählen mit; BABY sagt ausdrücklich
  // "mindestens 1", deshalb die Untergrenze - aber nur, wenn überhaupt ein
  // Verstärker im Spiel war (ohne ihn bleibt es bei der Kartenangabe).
  const treasureCount = c.treasureDelta ? Math.max(1, baseTreasures + c.treasureDelta) : baseTreasures;
  const drawn = [];
  for (let i = 0; i < treasureCount; i++) { const t = drawTreasure(room); if (t) drawn.push(t); }
  // einfache Aufteilung: alles an actor, außer helper wurde per Vorabsprache
  // (README) etwas zugesagt - hier immer erst alles an die/den Angreifer:in,
  // Weitergabe von Schätzen kann jederzeit frei "gehandelt" werden.
  drawn.forEach((id) => actor.hand.push(id));
  actor.lastReward = {
    seq: (actor.lastReward ? actor.lastReward.seq : 0) + 1,
    cardIds: drawn,
    levelsGained,
    monsterNames: monsters.map((m) => m.name),
  };
  discardMonsterIds(room.doorDiscard, c.monsterIds);
  log(room, `${actor.name} besiegt ${monsters.map((m) => m.name).join(' + ')}! +${levelsGained} Stufe(n), ${treasureCount} Schatzkarte(n) gezogen.`, c.monsterIds);
  if (extras.levels) log(room, `Kartenbonus: +${extras.levels} zusätzliche Stufe(n).`);
  if (extras.treasures) log(room, `Kartenbonus: +${extras.treasures} zusätzliche(r) Schatz.`);
  if (helper) log(room, `(${helper.name} hat geholfen.)`);
  // ELF: "Für jedes Monster, das du jemandem anderen hilfst zu töten,
  // steigst du 1 Stufe auf."
  if (helper && hasRace(helper, 'ELF')) {
    setLevel(helper, helper.level + monsters.length);
    log(room, `${helper.name} ist Elf und steigt fürs Helfen ${monsters.length} Stufe(n) auf -> jetzt Stufe ${helper.level}.`);
  }
  // KNIESCHÜTZER DER VERLOCKUNG: "In einem Kampf, bei dem der Helfer ...
  // genötigt wurde, kannst du nicht die Siegesstufe erreichen." Nur die
  // Siegesstufe in DIESEM Kampf ist gesperrt, nicht der Kampf selbst und
  // nicht künftige Kämpfe (noWinLevel haengt am Kampf, nicht am Spieler).
  if (c.noWinLevel && actor.level >= MAX_LEVEL) {
    setLevel(actor, MAX_LEVEL - 1);
    log(room, `${actor.name} hat die Hilfe mit den Knieschützern erzwungen und kann in diesem Kampf nicht gewinnen.`);
  }
  room.combat = null;
  // Auch die Helfer:in kann so Stufe 10 erreichen - die Stufe kommt aus einem
  // besiegten Monster, damit zählt sie als Sieg.
  let won = checkWin(room, actor);
  if (!won && helper) won = checkWin(room, helper);
  // ÜBERFALLTRANK: der urspruengliche Spieler (nicht die/der Kaempfende) darf
  // danach den Raum pluendern - room.turnIndex zeigt ohnehin noch auf sie/ihn,
  // der Zug ist nie gewechselt.
  if (!won) room.turnPhase = c.originalActorId ? 'pluendern' : 'gabe';
  touchRoom(room);
}

function handleAttemptFlee(room, playerId, modifier) {
  if (!room.combat || !room.combat.mustFlee) return;
  if (room.combat.fleeRerollOffer) return; // erst das Halbling-Angebot beantworten
  const c = room.combat;
  if (c.actorId !== playerId) return;
  const actor = findPlayer(room, c.actorId);
  // `modifier` kommt aus dem Client und ist damit ungeprüfte Fremdeingabe
  // (manuell eingetragene Karteneffekte). Alles, was fest auf Karten steht -
  // Elfenbonus, Weglaufstiefel, Tuba, Monster wie die Schnecken auf Speed -
  // rechnet der Server selbst dazu, statt sich darauf zu verlassen, dass es
  // jemand von Hand einträgt.
  const manual = Math.max(-9, Math.min(9, Math.round(Number(modifier) || 0)));
  const parts = fleeModifierParts(room, actor);
  const mod = manual + parts.reduce((sum, x) => sum + x.amount, 0);
  // GEZINKTER WÜRFEL darf den Weglaufwurf noch aendern, bevor er ausgewertet
  // wird - deshalb ab hier ueber das Reaktionsfenster statt mit einem
  // direkten rollDie(). Haelt niemand die Karte, laeuft der Rest synchron
  // weiter wie zuvor (siehe rollWithWindow).
  rollWithWindow(room, actor, 'flee', function mitWurf(roll) {
    const total = roll + mod;
    const impossible = combatHasMonster(room, FLEE_IMPOSSIBLE);
    const automatic = combatHasMonster(room, FLEE_AUTOMATIC);
    const success = impossible ? false : (automatic ? true : total >= 5);
    let note = parts.length ? parts.map((x) => `${x.label} ${x.amount >= 0 ? '+' : ''}${x.amount}`).join(', ') : '';
    if (impossible) note = 'Vor diesem Monster gibt es kein Entkommen.';
    else if (automatic) note = 'Automatische Flucht.';
    log(room, `${actor.name} würfelt ${roll} (${mod >= 0 ? '+' : ''}${mod} = ${total}) zum Weglaufen: ${success ? 'geschafft!' : 'gescheitert!'}${note ? ` [${note}]` : ''}`);
    // Eigenes seq-Feld fuer die Wuerfel-Animation: room.combat wird gleich auf
    // null gesetzt, die Animation darf davon nicht abhaengen.
    room.dieRoll = {
      seq: (room.dieRoll ? room.dieRoll.seq : 0) + 1,
      roll, mod, total, success, note, playerId: actor.id, playerName: actor.name,
    };
    if (success) {
      applyFleeSuccess(room, actor, c);
    } else if (halblingRerollPossible(room, actor) || postFleeEscapeCardIds(actor).length || lampCardIds(actor).length) {
      // Entscheidung nach dem verpatzten Wurf - der Kampf bleibt stehen, bis
      // sie da ist (handleFleeReroll / handleFleeEscape / handleUseLamp):
      //  * HALBLING: "1 Karte ablegen und es noch mal probieren"
      //  * UNSICHTBARKEITSTRANK: "Ablegen, wenn der Weglaufen-Wurf misslingt.
      //    Du entkommst automatisch."
      //  * MAGISCHE LAMPE: "... selbst wenn dein Weglaufenwurf verpatzt
      //    wurde und es dich fangen wuerde." Kein eigenes Fenster noetig -
      //    genau dieser Moment ist es schon.
      const optionen = [];
      if (halblingRerollPossible(room, actor)) {
        c.halblingRerollUsed = true;
        c.canReroll = true;
        optionen.push('als Halbling 1 Karte ablegen und noch einmal weglaufen');
      }
      if (postFleeEscapeCardIds(actor).length) optionen.push('eine Rettungskarte ablegen und automatisch entkommen');
      if (lampCardIds(actor).length) optionen.push('die Magische Lampe nutzen und ein Monster verschwinden lassen');
      c.fleeRerollOffer = true;
      c.fleeManualModifier = manual;
      log(room, `${actor.name} kann noch reagieren: ${optionen.join(' oder ')} - oder das Miese Zeug hinnehmen.`);
    } else {
      applyFleeFailure(room, actor, c);
    }
    touchRoom(room);
  });
}

// Gelungene Flucht: erst das Reaktionsfenster fuer KLEBERFLÄSCHCHEN, dann
// (finishFleeSuccess) Stufenverlust trotz Flucht (MR. BONES, KOENIG TUT,
// GRUFTIGE GEBRUEDER), Tuba-Schatz auf dem Weg nach draussen, Monster weg.
// Steht separat, weil eine Rettungskarte nach verpatztem Wurf hier
// hereinspringt (handleFleeEscape).
function applyFleeSuccess(room, actor, c) {
  // "Einsetzbar, wenn jemand erfolgreich (egal warum) einem Kampf entkommt.
  // Er muss seine Flucht noch einmal wuerfeln." escapeReactionDone
  // verhindert eine Endlosschleife, wenn der erzwungene Neuwurf wieder
  // gelingt.
  if (!c.escapeReactionDone) {
    const holders = reactionHolders(room, ESCAPE_REACTION_CARDS);
    if (holders.length) {
      c.escapeReactionOffer = holders;
      log(room, `${actor.name} entkommt - es darf noch ein Kleberfläschchen gespielt werden.`);
      return;
    }
  }
  finishFleeSuccess(room, actor, c);
}

function finishFleeSuccess(room, actor, c) {
  // MIESER SPIEGEL/GESCHLECHTSUMWANDLUNG gelten nur "im nächsten Kampf" -
  // der ist hiermit vorbei (geflohen). Helfer:in ist an einer Flucht nicht
  // beteiligt (siehe handleAttemptFlee: nur actor würfelt), daher hier nur
  // die/der Fliehende.
  clearNextCombatCurses([actor]);
  let penalty = 0;
  c.monsterIds.forEach((id) => {
    const m = card(id);
    const fn = m && FLEE_PENALTY[m.name];
    if (fn) penalty += fn(actor);
  });
  if (penalty) {
    setLevel(actor, actor.level - penalty);
    log(room, `Trotz Flucht: ${actor.name} verliert ${penalty} Stufe(n) -> jetzt Stufe ${actor.level}.`);
  }
  if (equippedItemIds(actor).some((id) => FLEE_TREASURE_ITEMS.has((card(id) || {}).name))) {
    const t = drawTreasure(room);
    if (t) { actor.hand.push(t); log(room, `${actor.name} nimmt auf dem Weg nach draussen noch 1 verdeckte Schatzkarte mit.`); }
  }
  discardMonsterIds(room.doorDiscard, c.monsterIds);
  room.combat = null;
  // ÜBERFALLTRANK: siehe Kommentar in resolveCombatWin.
  room.turnPhase = c.originalActorId ? 'pluendern' : 'gabe';
}

// POST_FLEE_ESCAPE_CARDS: siehe src/cards/treasures.js. "Ablegen, wenn der
// Weglaufen-Wurf misslingt. Du entkommst automatisch." (Die
// GUARANTEED_FLEE_CARDS wirken dagegen VOR dem Wurf.)
function postFleeEscapeCardIds(actor) {
  return actor.hand.filter((id) => POST_FLEE_ESCAPE_CARDS.has((card(id) || {}).name));
}

// Rettungskarte nach dem verpatzten Wurf einsetzen.
function handleFleeEscape(room, playerId, cardId) {
  const c = room.combat;
  if (!c || !c.fleeRerollOffer || c.actorId !== playerId) return;
  const actor = findPlayer(room, playerId);
  if (!actor || !postFleeEscapeCardIds(actor).includes(cardId)) return;
  c.fleeRerollOffer = false;
  removeFromHand(actor, cardId);
  discardCard(room, cardId);
  log(room, `${actor.name} legt "${card(cardId).name}" ab und entkommt trotz des verpatzten Wurfs.`, [cardId]);
  applyFleeSuccess(room, actor, c);
  touchRoom(room);
}

// "Nur in deiner Runde spielbar. Sie beschwoert einen Geist, der ein Monster
// verschwinden laesst, selbst wenn dein Weglaufenwurf verpatzt wurde und es
// dich fangen wuerde. War es das einzige Monster, erhaeltst du seinen Schatz,
// aber keine Stufe." - ponytail: kein eigenes Fenster, sie haengt am
// bestehenden Fluchtentscheidungsfenster (c.fleeRerollOffer), das genau
// diesen Moment beschreibt. Aufruestweg fuer "jederzeit spielbar": ein
// eigenes Kampf-weites Fenster wie bei den Reaktionskarten oben.
const LAMP_CARDS = new Set(['MAGISCHE LAMPE']);

function lampCardIds(actor) {
  return actor.hand.filter((id) => LAMP_CARDS.has((card(id) || {}).name));
}

function handleUseLamp(room, playerId, cardId, monsterId) {
  const c = room.combat;
  if (!c || !c.fleeRerollOffer || c.actorId !== playerId) return;
  const actor = findPlayer(room, playerId);
  if (!actor || !actor.hand.includes(cardId)) return;
  const lampe = card(cardId);
  if (!lampe || !LAMP_CARDS.has(lampe.name)) return;
  const idx = c.monsterIds.indexOf(monsterId);
  if (idx < 0) return;
  removeFromHand(actor, cardId);
  discardCard(room, cardId);
  if (c.monsterIds.length === 1) {
    // War es das einzige Monster, erhaeltst du seinen Schatz, aber keine
    // Stufe - endCombatNoLevel liest den Schatz aus den noch im Kampf
    // stehenden Monstern, das Monster darf also NICHT vorher aus
    // c.monsterIds gesplict werden (siehe VERZAUBERARMBAND-Kommentar in
    // src/cards/treasures.js, derselbe Grund).
    log(room, `${actor.name} spielt "${lampe.name}": "${card(monsterId).name}" verschwindet - es war das einzige Monster.`, [cardId, monsterId]);
    applyCombatPotionAction(room, actor, { type: 'endCombatNoLevel', leavesTreasure: true }, lampe);
  } else {
    const weg = c.monsterIds.splice(idx, 1)[0];
    room.doorDiscard.push(weg);
    log(room, `${actor.name} spielt "${lampe.name}": "${card(weg).name}" verschwindet.`, [cardId, weg]);
    c.fleeRerollOffer = false;
    refreshCombatReady(room);
  }
  touchRoom(room);
}

// Das Miese Zeug nach einem endgueltig gescheiterten Weglaufwurf. Steht
// separat, weil beim HALBLING noch eine Entscheidung dazwischen liegt.
function applyFleeFailure(room, actor, c) {
  // Auch eine misslungene Flucht beendet "den nächsten Kampf" - sonst würde
  // der Fluch fälschlich in einen weiteren, künftigen Kampf hineinwirken.
  clearNextCombatCurses([actor]);
  const monsters = c.monsterIds.map(card);
  const badstuffText = monsters.map((m) => `${m.name}: ${m.badstuff || '(kein Text hinterlegt)'}`).join(' | ');
  discardMonsterIds(room.doorDiscard, c.monsterIds);
  room.combat = null;
  // ÜBERFALLTRANK: originalActorId muss den Kampf ueberleben (room.combat
  // wird gerade geleert) - handleAckConsequence liest ihn von hier, sobald
  // die Konsequenz bestaetigt wird, und oeffnet dann die Pluenderphase statt
  // "gabe" fuer den urspruenglichen Spieler.
  room.pendingConsequence = {
    playerId: actor.id, kind: 'loss', cardId: null, text: badstuffText, autoApplied: null, choice: null,
    originalActorId: c.originalActorId || null,
  };
  autoApplyLossConsequence(room, actor, monsters.map((m) => ({ name: m.name, text: m.badstuff })));
}

// Nur beim ersten verpatzten Wurf, nur mit Karte auf der Hand - und nicht
// gegen Monster, vor denen es ohnehin kein Entkommen gibt (der zweite Wurf
// wuerde genauso scheitern und die Karte waere umsonst weg).
function halblingRerollPossible(room, actor) {
  const c = room.combat;
  if (!c || c.halblingRerollUsed) return false;
  if (combatHasMonster(room, FLEE_IMPOSSIBLE)) return false;
  return hasRace(actor, 'HALBLING') && actor.hand.length > 0;
}

// Antwort auf das Halbling-Angebot: mit Karte nochmal wuerfeln, ohne Karte
// (cardId null) das Miese Zeug hinnehmen.
function handleFleeReroll(room, playerId, cardId) {
  const c = room.combat;
  if (!c || !c.fleeRerollOffer || c.actorId !== playerId) return;
  const actor = findPlayer(room, playerId);
  if (!actor) return;
  if (cardId !== null && cardId !== undefined) {
    if (!c.canReroll) return; // der Wiederholungswurf steht nur Halblingen zu
    if (!actor.hand.includes(cardId)) return; // Fremdeingabe: Angebot bleibt stehen
    c.fleeRerollOffer = false;
    removeFromHand(actor, cardId);
    discardCard(room, cardId);
    log(room, `${actor.name} (Halbling) legt "${card(cardId).name}" ab und laeuft noch einmal weg.`, [cardId]);
    handleAttemptFlee(room, playerId, c.fleeManualModifier || 0);
    return;
  }
  c.fleeRerollOffer = false;
  log(room, `${actor.name} verzichtet auf den zweiten Weglaufversuch.`);
  applyFleeFailure(room, actor, c);
  touchRoom(room);
}

// GUARANTEED_FLEE_CARDS, GUARANTEED_FLEE_MAX_MONSTER_LEVEL: siehe
// src/cards/treasures.js. Statt eines Weglaufen-Würfelwurfs sofort und
// sicher aus dem Kampf entkommen. Nur nutzbar, während tatsächlich geflohen
// werden muss (mustFlee) und nur für die kämpfende Person selbst (Hilfe für
// eine zweite Person ist in diesem Server ohnehin nicht separat vom
// Kampf-Ausgang der Hauptperson abhängig, siehe handleAttemptFlee).

function handleUseGuaranteedFlee(room, playerId, cardId) {
  if (!room.combat || !room.combat.mustFlee) return;
  const c = room.combat;
  if (c.actorId !== playerId) return;
  const player = findPlayer(room, playerId);
  if (!player) return;
  const inHand = player.hand.includes(cardId);
  const equipped = equippedItemIds(player).includes(cardId);
  if (!inHand && !equipped) return;
  const cardData = card(cardId);
  if (!cardData || !GUARANTEED_FLEE_CARDS.has(cardData.name)) return;
  // Karten mit Stufengrenze (RATTE AM SPIESS: "Stufe 8 oder niedriger")
  // wirken nur gegen entsprechend schwache Monster.
  const maxLevel = GUARANTEED_FLEE_MAX_MONSTER_LEVEL[cardData.name];
  if (typeof maxLevel === 'number' && c.monsterIds.some((id) => ((card(id) || {}).level || 0) > maxLevel)) {
    log(room, `"${cardData.name}" wirkt nur gegen Monster bis Stufe ${maxLevel}.`);
    touchRoom(room);
    return;
  }
  if (inHand) removeFromHand(player, cardId); else unequipSlotCard(player, cardId);
  discardCard(room, cardId);
  discardMonsterIds(room.doorDiscard, c.monsterIds);
  room.combat = null;
  // ÜBERFALLTRANK: siehe Kommentar in resolveCombatWin.
  room.turnPhase = c.originalActorId ? 'pluendern' : 'gabe';
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
  if (!c) return;
  // SCHUMMELN!: "Diesen Gegenstand kannst du nun legal einsetzen, auch wenn
  // das normalerweise nicht erlaubt wäre" - hebt fuer GENAU DIESEN Gegenstand
  // die Anlege-Regeln auf (siehe handlePlayCheat). Bewusst nur fuer die
  // Gross-Gegenstand- und Rassen-Sperre umgesetzt: die Slot-Belegung
  // (Kopf/Ruestung/Schuhe/Haende) ist hier je Spieler:in ein fester Platz
  // (kein Array), ein zweiter Gegenstand im selben Slot wuerde den ersten
  // stillschweigend verdraengen statt ihn abzulegen - dafuer muesste das
  // Ausruestungsmodell erst auf Arrays je Slot umgestellt werden.
  // ponytail: Slot-Belegung/Handzahl bleiben deshalb hart, Ausbauweg s.o.
  const geschummelt = player.attachments && player.attachments.cheatedItemId === cardId;
  if (!geschummelt && isBigItem(c) && !canCarryAnotherBigItem(player)) {
    log(room, `${player.name} kann "${c.name}" nicht anlegen - Grosser Gegenstand, und es wird bereits einer getragen (nur Zwerge duerfen mehrere).`);
    touchRoom(room);
    return;
  }
  // Spezialausruestung zuerst: diese Karten sind keine 'item'-Karten und
  // haben keinen slotKind, gehoeren aber trotzdem angelegt.
  const special = specialSlotRule(c);
  if (special) {
    if (specialSlotCards(player, special.slot).includes(cardId)) return; // liegt schon an
    if (!geschummelt && special.races && !special.races.some((r) => hasRace(player, r))) {
      log(room, `${player.name} kann "${c.name}" nicht anlegen - nur für ${special.races.join('/')}.`);
      touchRoom(room);
      return;
    }
    removeFromHand(player, cardId);
    player.equipped[special.slot] = [...specialSlotCards(player, special.slot), cardId];
    log(room, `${player.name} legt "${c.name}" an (${SPECIAL_SLOTS[special.slot].label}).`, [cardId]);
    touchRoom(room);
    return;
  }
  if (c.category !== 'item') return;
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

// "Spiele diese Karte auf einen Gegenstand, den du im Spiel hast, oder dann,
// wenn du einen Gegenstand aus deiner Hand ausspielst. Diesen Gegenstand
// kannst du nun legal einsetzen, auch wenn das normalerweise nicht erlaubt
// waere. Lege diese Karte ab, wenn du den geschummelten Gegenstand verlierst
// (verkaufst usw.)." Der Anhang gilt fuer genau einen Gegenstand gleichzeitig
// (siehe attachments.cheatedItemId - kein Array).
function handlePlayCheat(room, playerId, cheatCardId, targetItemId) {
  const player = findPlayer(room, playerId);
  if (!player || !player.hand.includes(cheatCardId)) return;
  const cheat = card(cheatCardId);
  if (!cheat || cheat.name !== 'SCHUMMELN!') return;
  const ziel = card(targetItemId);
  if (!ziel) return;
  if (ziel.category !== 'item' && !specialSlotRule(ziel)) return;
  const besitzt = player.hand.includes(targetItemId) || equippedItemIds(player).includes(targetItemId);
  if (!besitzt) return;
  if (player.attachments.cheatedItemId) {
    log(room, `${player.name} hat bereits einen geschummelten Gegenstand.`);
    touchRoom(room);
    return;
  }
  removeFromHand(player, cheatCardId);
  discardCard(room, cheatCardId);
  player.attachments.cheatedItemId = targetItemId;
  log(room, `${player.name} schummelt bei "${ziel.name}" - die Anlege-Regeln gelten dafuer nicht mehr.`, [cheatCardId, targetItemId]);
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
  const values = [];
  ids.forEach((id) => {
    const inHand = player.hand.includes(id);
    const inEquip = equippedItemIds(player).includes(id);
    if (!inHand && !inEquip) return;
    const c = card(id);
    if (!c || typeof c.gold !== 'number') return;
    const value = isAlchemist ? Math.max(c.gold, 300) : c.gold;
    values.push(value);
    total += value;
    removable.push(id);
  });
  // HALBLING: "Du darfst 1 Gegenstand pro Runde zum doppelten Preis verkaufen
  // (und weitere Gegenstände zum normalen Preis)." Verdoppelt wird automatisch
  // der teuerste der verkauften Gegenstände - eine Auswahl wäre nur nötig, wenn
  // jemand sich bewusst schlechter stellen wollte.
  const halblingBonus = (hasRace(player, 'HALBLING') && !player.halblingSaleUsed && values.length)
    ? Math.max.apply(null, values) : 0;
  total += halblingBonus;
  if (total < 1000) return;
  if (halblingBonus) player.halblingSaleUsed = true;
  const levels = Math.floor(total / 1000);
  removable.forEach((id) => {
    if (player.hand.includes(id)) removeFromHand(player, id); else unequipSlotCard(player, id);
    discardCard(room, id);
  });
  setLevel(player, player.level + levels);
  if (halblingBonus) log(room, `${player.name} ist Halbling und verkauft den teuersten Gegenstand zum doppelten Preis (+${halblingBonus} Goldstücke, einmal pro Runde).`);
  log(room, `${player.name} legt Gegenstände im Wert von ${total} Goldstücken ab und steigt ${levels} Stufe(n) auf (jetzt Stufe ${player.level}).`);
  // Die Siegesstufe ist laut Regelwerk nur durch ein besiegtes Monster
  // erreichbar - Verkaufen bringt auf Stufe 10, gewinnt aber nicht. Der Sieg
  // faellt beim naechsten gewonnenen Kampf (resolveCombatWin ruft checkWin
  // ohnehin auf). Einzige gedruckte Ausnahme: GOTTLICHE INTERVENTION.
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
  if (player.hand.length > handLimit(player)) return;
  endTurn(room);
  touchRoom(room);
}

// ---------------------------------------------------------------------------
// Handel zwischen Spielenden - jederzeit möglich, nicht an Zug/Phase
// gebunden, ganz wie am echten Tisch. Tauschbar sind Handkarten UND angelegte
// Gegenstände; beim Empfänger landet alles auf der Hand (Anlegen bleibt eine
// eigene Aktion, damit Größen-/Slot-Regeln weiter gelten).
//
// Echter Tausch - beide Seiten müssen zustimmen:
//   1. proposeTrade: Angebot an eine Person (Status "pending").
//   2. respondTrade der Gegenseite: ablehnen, ohne Gegenleistung annehmen
//      (dann sofort fertig - Geschenk) oder eine Gegenleistung festlegen
//      (Status "countered").
//   3. respondTrade des/der Anbietenden: sieht die Gegenleistung und
//      bestätigt oder lehnt ab. cancelTrade zieht das Angebot zurück.
// Ein offener Handel pro Richtung; Angebote stehen nur im privaten yourInfo
// der beiden Beteiligten, im öffentlichen Verlauf nur Anzahlen bzw. das
// Ergebnis.
// ---------------------------------------------------------------------------

// Handelbar ist alles, was man wirklich besitzt: Handkarten und angelegte
// Gegenstände (Zweihandwaffen stehen in zwei Slots -> dedupliziert).
function tradableCardIds(player) {
  return [...new Set([...player.hand, ...equippedItemIds(player)])];
}

// Fremde IDs auf das reduzieren, was diese Person gerade wirklich besitzt.
function ownTradeIds(player, ids) {
  const own = tradableCardIds(player);
  return [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => own.includes(id));
}

// Karte aus Hand oder Slot lösen (Slot-Variante wie beim Verkaufen).
function takeTradedCard(player, cardId) {
  if (player.hand.includes(cardId)) removeFromHand(player, cardId);
  else unequipSlotCard(player, cardId);
}

function tradeGoldSum(ids) {
  return ids.reduce((sum, id) => { const c = card(id); return sum + (c && typeof c.gold === 'number' ? c.gold : 0); }, 0);
}

function handleProposeTrade(room, playerId, toId, offerCardIds) {
  const from = findPlayer(room, playerId);
  const to = findPlayer(room, toId);
  if (!from || !to || from.id === to.id || !to.connected) return;
  const ids = ownTradeIds(from, offerCardIds);
  if (!ids.length) return;
  if (!room.trades) room.trades = [];
  // Nur ein offener Handel pro Richtung gleichzeitig - ein neues Angebot ersetzt ein altes.
  room.trades = room.trades.filter((t) => !(t.fromId === from.id && t.toId === to.id));
  room.trades.push({ id: makeId(), fromId: from.id, toId: to.id, offerCardIds: ids, counterCardIds: [], status: 'pending', at: Date.now() });
  log(room, `${from.name} bietet ${to.name} einen Handel an (${ids.length} Karte(n)).`);
  touchRoom(room);
}

function handleCancelTrade(room, playerId, tradeId) {
  if (!room.trades) return;
  const trade = room.trades.find((t) => t.id === tradeId && t.fromId === playerId);
  if (!trade) return;
  room.trades = room.trades.filter((t) => t.id !== trade.id);
  const from = findPlayer(room, playerId);
  log(room, `${from.name} zieht ein Handelsangebot zurück.`);
  touchRoom(room);
}

// Antwort auf einen Handel - je nach Status und Rolle Schritt 2 oder 3.
function handleRespondTrade(room, playerId, tradeId, accept, counterCardIds) {
  if (!room.trades) return;
  const trade = room.trades.find((t) => t.id === tradeId);
  if (!trade) return;
  const from = findPlayer(room, trade.fromId);
  const to = findPlayer(room, trade.toId);
  if (!from || !to) { room.trades = room.trades.filter((t) => t.id !== trade.id); return; }

  // Schritt 2: die angefragte Seite antwortet auf das Angebot.
  if (trade.status === 'pending' && playerId === to.id) {
    if (!accept) {
      room.trades = room.trades.filter((t) => t.id !== trade.id);
      log(room, `${to.name} lehnt den Handel von ${from.name} ab.`);
      touchRoom(room);
      return;
    }
    const counterIds = ownTradeIds(to, counterCardIds);
    // Ohne Gegenleistung ist es ein Geschenk - dafür braucht es keine zweite
    // Bestätigung, das Angebot stand ja genau so da.
    if (!counterIds.length) { finishTrade(room, trade, from, to, []); return; }
    trade.counterCardIds = counterIds;
    trade.status = 'countered';
    log(room, `${to.name} will für den Handel mit ${from.name} eine Gegenleistung (${counterIds.length} Karte(n)) - ${from.name} muss noch bestätigen.`);
    touchRoom(room);
    return;
  }

  // Schritt 3: der/die Anbietende sieht die Gegenleistung und entscheidet.
  if (trade.status === 'countered' && playerId === from.id) {
    if (!accept) {
      room.trades = room.trades.filter((t) => t.id !== trade.id);
      log(room, `${from.name} lehnt die Gegenleistung von ${to.name} ab.`);
      touchRoom(room);
      return;
    }
    finishTrade(room, trade, from, to, trade.counterCardIds);
  }
}

function finishTrade(room, trade, from, to, counterCardIds) {
  room.trades = room.trades.filter((t) => t.id !== trade.id);
  // Erneut gegen den aktuellen Zustand prüfen - die Karten könnten seither
  // abgelegt, verkauft oder angelegt worden sein. Was weg ist, wird
  // übersprungen; der Rest wird getauscht.
  const offerIds = ownTradeIds(from, trade.offerCardIds);
  const counterIds = ownTradeIds(to, counterCardIds);
  offerIds.forEach((id) => { takeTradedCard(from, id); clearCheatIfLost(from, id); to.hand.push(id); });
  counterIds.forEach((id) => { takeTradedCard(to, id); clearCheatIfLost(to, id); from.hand.push(id); });
  const names = (ids) => ids.map((id) => { const c = card(id); return c ? c.name : id; }).join(', ');
  const offerText = offerIds.length ? `${names(offerIds)} - ${tradeGoldSum(offerIds)} GS` : '(nichts mehr davon verfügbar)';
  const counterText = counterIds.length ? `${names(counterIds)} - ${tradeGoldSum(counterIds)} GS` : '(nichts zurück)';
  log(room, `Handel: ${from.name} gibt [${offerText}] an ${to.name}, erhält dafür [${counterText}].`, [...offerIds, ...counterIds]);
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

// Beantwortet eine an einen Bot gerichtete Kartenaktion (Wahl/Ziel/Karte aus
// dem Ablagestapel) mit der jeweils ersten Option - siehe
// scheduleBotActionsIfNeeded für den Aufrufkontext.
function resolveBotCardAction(room) {
  const pa = room.pendingCardAction;
  if (!pa) return;
  const bot = findPlayer(room, pa.playerId);
  if (!bot || !bot.isBot) return;
  if (pa.kind === 'choice' && (pa.options || []).length) {
    handleResolveCardChoice(room, bot.id, pa.options[0].id);
  } else if (pa.kind === 'targetPlayer' && (pa.candidateIds || []).length) {
    handleResolveCardTarget(room, bot.id, pa.candidateIds[0]);
  } else if (pa.kind === 'chooseCard' && (pa.candidateIds || []).length) {
    handleResolveCardCardChoice(room, bot.id, pa.candidateIds[0]);
  } else {
    // Nichts Waehlbares oder unbekannte Art: ueberspringen statt haengen.
    advanceCardActionQueue(room);
  }
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

  // Eine an einen Bot gerichtete Kartenaktion muss der Server selbst
  // beantworten - sonst wartet die Partie ewig auf einen Dialog, den niemand
  // sieht. Bots waehlen bewusst simpel (erste Option / erstes Ziel); eine
  // kluegere Auswahl waere ein eigenes Thema.
  if (room.pendingCardAction) {
    const p = findPlayer(room, room.pendingCardAction.playerId);
    if (p && p.isBot) {
      const snapshot = room.pendingCardAction;
      room.botTimer = setTimeout(() => {
        room.botTimer = null;
        if (!rooms.has(room.code) || room.pendingCardAction !== snapshot) return;
        resolveBotCardAction(room);
        broadcastState(room);
      }, randomDelay());
    }
    return;
  }

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
      // Solange noch jemand bestätigen muss, gar nicht erst einplanen -
      // handleEvaluateCombat würde nur wirkungslos abprallen und der Bot
      // liefe im Sekundentakt dagegen. Das nächste "Bereit" löst ohnehin
      // einen Broadcast und damit eine neue Planung aus.
      if (!c.mustFlee && !combatAllReady(room)) return;
      const snapshotCombat = c;
      room.botTimer = setTimeout(() => {
        room.botTimer = null;
        if (!rooms.has(room.code) || room.combat !== snapshotCombat) return;
        // Ein Bot-Halbling muss das Wiederholungsangebot selbst beantworten,
        // sonst wartet die Partie ewig auf eine Entscheidung.
        if (room.combat.fleeRerollOffer) handleFleeReroll(room, actor.id, actor.hand[0] || null);
        else if (room.combat.mustFlee) handleAttemptFlee(room, actor.id, 0);
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
      if (room.revealedDoorCard) handleTakeRevealedDoor(room, actor.id);
      else handleDrawDoor(room, actor.id);
    } else if (room.turnPhase === 'aerger') {
      // Bot spielt nie freiwillig ein Monster aus der Hand (Vereinfachung).
      handleSkipToLoot(room, actor.id);
    } else if (room.turnPhase === 'pluendern') {
      handleLootRoom(room, actor.id);
    } else if (room.turnPhase === 'gabe') {
      while (actor.hand.length > handLimit(actor)) {
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

// Ein Client bestimmt Event-Namen UND Payload selbst - beides ist ungeprüfte
// Fremdeingabe. Ohne Absicherung genügte ein `socket.emit('removeBot')` ganz
// ohne Argument, um den kompletten Serverprozess zu beenden (Destrukturierung
// von undefined im Parameter der Handler-Funktion) und damit ALLE laufenden
// Spiele zu verlieren - die Räume liegen nur im Arbeitsspeicher.
//
// Deshalb wird jeder Handler zentral über diese Funktion registriert statt
// über socket.on() direkt: fehlender Payload wird zu {}, ein fehlender
// Callback zu einer No-Op-Funktion, und ein Fehler im Handler beendet nur
// dieses eine Event statt des Prozesses. Damit greift der Schutz auch für
// jeden künftig ergänzten Handler, ohne dass daran gedacht werden muss.
function onSafe(socket, event, handler) {
  socket.on(event, (payload, cb) => {
    try {
      handler(payload == null ? {} : payload, typeof cb === 'function' ? cb : () => {});
    } catch (err) {
      console.error(`Fehler im Event "${event}" (Socket ${socket.id}):`, err && err.message);
    }
  });
}

io.on('connection', (socket) => {
  onSafe(socket, 'createRoom', ({ name }, cb) => {
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

  onSafe(socket, 'joinRoom', ({ code, name, token }, cb) => {
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

  onSafe(socket, 'leaveRoom', () => {
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
    if (room.players.length === 0) {
      // Aufräum-Timer mitnehmen, sonst hält er den Raum noch stundenlang im
      // Speicher, obwohl ihn niemand mehr erreichen kann.
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
      if (room.botTimer) clearTimeout(room.botTimer);
      rooms.delete(room.code);
    } else broadcastState(room);
  });

  onSafe(socket, 'addBot', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'lobby' || socket.data.playerId !== room.hostId) return;
    addBot(room);
    broadcastState(room);
  });

  onSafe(socket, 'removeBot', ({ botId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'lobby' || socket.data.playerId !== room.hostId) return;
    const bot = findPlayer(room, botId);
    if (!bot || !bot.isBot) return;
    room.players = room.players.filter((p) => p.id !== botId);
    broadcastState(room);
  });

  onSafe(socket, 'updateSets', (sets) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'lobby' || socket.data.playerId !== room.hostId) return;
    SET_KEYS.forEach((k) => { if (typeof sets[k] === 'boolean') room.settings.sets[k] = sets[k]; });
    if (!activeSetKeys(room).length) room.settings.sets.base = true;
    broadcastState(room);
  });

  onSafe(socket, 'startGame', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'lobby' || socket.data.playerId !== room.hostId) return;
    if (room.players.length < 1 || room.players.length > MAX_PLAYERS) return;
    startGame(room);
    broadcastState(room);
  });

  onSafe(socket, 'resetGame', () => {
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
  onSafe(socket, 'drawDoor', () => act(socket, (room, pid) => handleDrawDoor(room, pid)));
  onSafe(socket, 'takeRevealedDoor', () => act(socket, (room, pid) => handleTakeRevealedDoor(room, pid)));
  onSafe(socket, 'ackConsequence', () => act(socket, (room, pid) => handleAckConsequence(room, pid)));
  onSafe(socket, 'applyConsequenceAction', (action) => act(socket, (room, pid) => handleApplyConsequenceAction(room, pid, action)));
  onSafe(socket, 'resolveConsequenceChoice', ({ optionId }) => act(socket, (room, pid) => handleResolveConsequenceChoice(room, pid, optionId)));
  onSafe(socket, 'useCardPower', ({ cardId }) => act(socket, (room, pid) => handleUseCardPower(room, pid, cardId)));
  onSafe(socket, 'resolveCardChoice', ({ optionId }) => act(socket, (room, pid) => handleResolveCardChoice(room, pid, optionId)));
  onSafe(socket, 'resolveCardTarget', ({ targetId }) => act(socket, (room, pid) => handleResolveCardTarget(room, pid, targetId)));
  onSafe(socket, 'resolveCardCardChoice', ({ cardId }) => act(socket, (room, pid) => handleResolveCardCardChoice(room, pid, cardId)));
  onSafe(socket, 'useGuaranteedFlee', ({ cardId }) => act(socket, (room, pid) => handleUseGuaranteedFlee(room, pid, cardId)));
  onSafe(socket, 'playMonsterFromHand', ({ cardId }) => act(socket, (room, pid) => handlePlayMonsterFromHand(room, pid, cardId)));
  onSafe(socket, 'skipToLoot', () => act(socket, (room, pid) => handleSkipToLoot(room, pid)));
  onSafe(socket, 'lootRoom', () => act(socket, (room, pid) => handleLootRoom(room, pid)));
  onSafe(socket, 'setCombatModifier', ({ who, value }) => act(socket, (room, pid) => handleSetCombatModifier(room, pid, who, value)));
  onSafe(socket, 'playCombatCard', ({ cardId }) => act(socket, (room, pid) => handlePlayCombatCard(room, pid, cardId)));
  onSafe(socket, 'useClassCombatDiscard', ({ cardId }) => act(socket, (room, pid) => handleUseClassCombatDiscard(room, pid, cardId)));
  onSafe(socket, 'proposeTrade', ({ toId, offerCardIds }) => act(socket, (room, pid) => handleProposeTrade(room, pid, toId, offerCardIds)));
  onSafe(socket, 'cancelTrade', ({ tradeId }) => act(socket, (room, pid) => handleCancelTrade(room, pid, tradeId)));
  onSafe(socket, 'respondTrade', ({ tradeId, accept, counterCardIds }) => act(socket, (room, pid) => handleRespondTrade(room, pid, tradeId, accept, counterCardIds)));
  onSafe(socket, 'requestHelp', ({ targetId }) => act(socket, (room, pid) => handleRequestHelp(room, pid, targetId)));
  onSafe(socket, 'respondHelp', ({ accept }) => act(socket, (room, pid) => handleRespondHelp(room, pid, accept)));
  onSafe(socket, 'setCombatReady', ({ ready }) => act(socket, (room, pid) => handleSetCombatReady(room, pid, ready !== false)));
  onSafe(socket, 'evaluateCombat', () => act(socket, (room, pid) => handleEvaluateCombat(room, pid)));
  onSafe(socket, 'attemptFlee', ({ modifier }) => act(socket, (room, pid) => handleAttemptFlee(room, pid, modifier)));
  onSafe(socket, 'fleeReroll', ({ cardId }) => act(socket, (room, pid) => handleFleeReroll(room, pid, cardId === undefined ? null : cardId)));
  onSafe(socket, 'fleeEscape', ({ cardId }) => act(socket, (room, pid) => handleFleeEscape(room, pid, cardId)));
  onSafe(socket, 'useLamp', ({ cardId, monsterId }) => act(socket, (room, pid) => handleUseLamp(room, pid, cardId, monsterId)));
  onSafe(socket, 'playReactionCard', ({ cardId, value }) => act(socket, (room, pid) => handlePlayReactionCard(room, pid, cardId, value)));
  onSafe(socket, 'passReaction', () => act(socket, (room, pid) => handlePassReaction(room, pid)));
  onSafe(socket, 'enchantMonster', () => act(socket, (room, pid) => handleEnchantMonster(room, pid)));
  onSafe(socket, 'equipItem', ({ cardId }) => act(socket, (room, pid) => handleEquipItem(room, pid, cardId)));
  onSafe(socket, 'unequipItem', ({ cardId }) => act(socket, (room, pid) => handleUnequipItem(room, pid, cardId)));
  onSafe(socket, 'playCheat', ({ cheatCardId, targetItemId }) => act(socket, (room, pid) => handlePlayCheat(room, pid, cheatCardId, targetItemId)));
  onSafe(socket, 'sellItems', ({ cardIds }) => act(socket, (room, pid) => handleSellItems(room, pid, cardIds)));
  onSafe(socket, 'playRaceOrClass', ({ cardId }) => act(socket, (room, pid) => handlePlayRaceOrClass(room, pid, cardId)));
  onSafe(socket, 'discardFromHand', ({ cardId }) => act(socket, (room, pid) => handleDiscardFromHand(room, pid, cardId)));
  onSafe(socket, 'endTurn', () => act(socket, (room, pid) => handleEndTurnAction(room, pid)));

  onSafe(socket, 'disconnect', () => {
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
  handleDrawDoor, handleTakeRevealedDoor, handleEvaluateCombat, handleAttemptFlee, baseStrength,
  handleFleeReroll, handleFleeEscape, handleEnchantMonster, enchantInfo,
  POST_FLEE_ESCAPE_CARDS, DOOR_COMBAT_CARDS, handleSellItems, endTurn,
  handleApplyConsequenceAction, handleRequestHelp, handleUseGuaranteedFlee,
  CURSE_PROOF_ITEMS, MONSTER_REFUSES, MONSTER_TRAIT_BONUS, MONSTER_IGNORES_LEVEL,
  SPECIAL_SLOT_ITEMS, SPECIAL_SLOTS, newEquipped, handleEquipItem, handleUnequipItem, equippedItemIds,
  handlePlayCheat, handleRespondHelp, resolveCombatWin, applyPrimitiveAction,
  MONSTER_AUTO_KILL_BY_RACE, MONSTER_PASS_OPTION, handleResolveCardChoice,
  playerQueueFrom, openQueuedCardAction, advanceCardActionQueue, resolveBotCardAction,
  handleResolveCardTarget, handleResolveCardCardChoice,
  MONSTER_IGNORES_BONUSES, MONSTER_FORBIDS_HELP, FLEE_ITEM_BONUS, FLEE_MONSTER_MOD,
  FLEE_IMPOSSIBLE, FLEE_AUTOMATIC, FLEE_PENALTY, FLEE_TREASURE_ITEMS,
  MONSTER_EXTRA_LEVEL, FIRE_ITEMS, GUARANTEED_FLEE_MAX_MONSTER_LEVEL,
  combatTotals, handLimit, hasRace, hasClass,
  CLASS_COMBAT_DISCARD, CLASS_FLEE_DISCARD, UNDEAD_MONSTERS,
  handleUseClassCombatDiscard, classCombatPowerInfo,
  handleSetCombatReady, combatReadyRequired, combatAllReady, refreshCombatReady,
  handleSetCombatModifier, handlePlayCombatCard,
  handleProposeTrade, handleCancelTrade, handleRespondTrade, tradableCardIds,
  BIG_ITEMS, isBigItem, bigItemCount, canCarryAnotherBigItem,
  ROLL_REACTION_CARDS, ESCAPE_REACTION_CARDS, reactionHolders, rollWithWindow,
  handlePlayReactionCard, handlePassReaction, LAMP_CARDS, lampCardIds, handleUseLamp,
  handleUseCardPower, DOOR_POWER_CARDS,
  LINGERING_CURSES, addActiveCurse, clearActiveCurse, curseCombatModifier, curseSuppressesItemBonuses,
  clearNextCombatCurses, COMBAT_REACTION_CARDS, applyCombatReaction, handleAckConsequence,
};
