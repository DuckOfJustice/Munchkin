// Munchkin Online - Client
(function () {
  'use strict';

  // -- Pfad-Präfix automatisch ermitteln (für Betrieb hinter dem Spielehub) --
  function computeBasePath() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length && !parts[0].includes('.')) return '/' + parts[0];
    return '';
  }
  const basePath = computeBasePath();
  const socket = io({ path: basePath + '/socket.io' });

  // Läuft diese Seite hinter dem Spielehub (also unter einem Pfad-Präfix),
  // zeigen wir einen Link zurück zur Spielauswahl (Hub-Startseite). Bei
  // direktem Zugriff ohne Hub gibt es keine Spielauswahl - dann bleibt er versteckt.
  if (basePath) {
    const backHub = document.getElementById('btnBackHub');
    if (backHub) {
      backHub.href = '/';
      backHub.classList.remove('hidden');
    }
  }

  const CATEGORY_LABELS = {
    monster: 'Monster', curse: 'Fluch', race: 'Rasse', class: 'Klasse',
    item: 'Gegenstand', treasure_other: 'Schatz', door_other: 'Türkarte',
  };

  let cardIndex = {};
  let state = null;
  let myInfo = { playerId: null, hand: [] };
  let session = loadSession();
  let sellSelection = new Set();

  // Handkarten nach Typ sortieren. Reihenfolge bewusst nach Spielablauf, nicht
  // alphabetisch: erst was man ausspielt (Monster, Fluch), dann was man
  // anlegt (Rasse/Klasse/Gegenstand), dann der Rest.
  const HAND_SORT_ORDER = ['monster', 'curse', 'race', 'class', 'door_other', 'item', 'treasure_other'];
  // Die Einstellung ist reine Anzeigesache und gilt nur auf diesem Gerät.
  let handSort = false;
  try { handSort = localStorage.getItem('munchkin_handsort') === '1'; } catch (e) { /* ignore */ }

  // -- Handel (Trading) --
  let tradeComposeTargetId = null; // gerade ein neues Angebot an diese Person zusammenstellen
  let tradeComposeSelection = new Set(); // eigene Karten/angelegte Gegenstände, die dabei angeboten werden
  let tradeCounterForId = null; // gerade die eigene Gegenleistung für dieses eingehende Angebot zusammenstellen
  let tradeCounterSelection = new Set();

  function startTradeCompose(targetId) {
    tradeComposeTargetId = targetId;
    tradeComposeSelection = new Set();
    tradeCounterForId = null;
    render();
  }

  function loadSession() {
    try { return JSON.parse(localStorage.getItem('munchkin_session') || 'null'); } catch (e) { return null; }
  }
  function saveSession(s) {
    session = s;
    try { localStorage.setItem('munchkin_session', JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  function clearSession() {
    session = null;
    try { localStorage.removeItem('munchkin_session'); } catch (e) { /* ignore */ }
  }

  function $(id) { return document.getElementById(id); }
  function showScreen(name) {
    ['start', 'lobby', 'game'].forEach((s) => {
      $('screen-' + s).classList.toggle('hidden', s !== name);
    });
  }

  function card(id) { return cardIndex[id] || { name: id, category: 'door_other', text: '', badstuff: '' }; }

  // ---------------------------------------------------------------------
  // Start-Screen
  // ---------------------------------------------------------------------

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
      $('tab-' + btn.dataset.tab).classList.remove('hidden');
      showStartError('');
    });
  });

  $('btnCreate').addEventListener('click', () => {
    const name = $('createNameInput').value.trim();
    if (!name) return showStartError('Bitte einen Namen eingeben.');
    socket.emit('createRoom', { name }, (res) => {
      if (!res.ok) return showStartError(res.error);
      saveSession({ code: res.code, playerId: res.playerId, token: res.token, name });
    });
  });

  $('btnJoin').addEventListener('click', () => {
    const name = $('joinNameInput').value.trim();
    const code = $('codeInput').value.trim().toUpperCase();
    if (!name) return showStartError('Bitte einen Namen eingeben.');
    if (!code) return showStartError('Bitte einen Raum-Code eingeben.');
    socket.emit('joinRoom', { code, name }, (res) => {
      if (!res.ok) return showStartError(res.error);
      saveSession({ code: res.code, playerId: res.playerId, token: res.token, name });
    });
  });

  function showStartError(msg) { $('startError').textContent = msg || ''; }

  function doLeaveRoom() {
    socket.emit('leaveRoom');
    clearSession();
    location.reload();
  }
  $('btnLeave').addEventListener('click', doLeaveRoom);
  $('btnLeaveLobby').addEventListener('click', doLeaveRoom);

  // Defensiv über das optionale Element: hat der Browser noch eine ältere
  // index.html im Cache, während client.js schon neu ist, wäre das hier sonst
  // ein TypeError auf null - und der würde die gesamte restliche Verdrahtung
  // in dieser Datei mitreißen, also aus einem fehlenden Schalter ein totes
  // Spiel machen.
  const handSortInput = $('handSortInput');
  if (handSortInput) {
    handSortInput.addEventListener('change', (e) => {
      handSort = e.target.checked;
      try { localStorage.setItem('munchkin_handsort', handSort ? '1' : '0'); } catch (err) { /* ignore */ }
      if (state) render();
    });
  }

  socket.on('connect', () => {
    if (session && session.code) {
      socket.emit('joinRoom', { code: session.code, name: session.name, token: session.token }, (res) => {
        if (!res.ok) { clearSession(); showScreen('start'); return; }
        saveSession({ code: res.code, playerId: res.playerId, token: res.token, name: session.name });
      });
    }
  });

  // Der Server schickt bei JEDER Aktion alle drei Events neu raus - auch dann,
  // wenn sich am Inhalt nichts geaendert hat. Da jedes render() das komplette
  // Spiel-DOM samt aller <img> neu aufbaut, waren das bis zu drei komplette
  // Neuaufbauten pro Broadcast: sichtbares Flackern. Deshalb werden
  // unveraenderte Nutzlasten hier einfach verworfen.
  // Wichtig: doorReveal.seq steckt mit im gameState - ein echtes Aufdecken
  // aendert den State also immer, playDoorReveal() feuert weiterhin genau
  // einmal pro Aufdecken.
  const lastPayload = {};
  function changed(key, value) {
    const json = JSON.stringify(value);
    if (lastPayload[key] === json) return false;
    lastPayload[key] = json;
    return true;
  }

  // cardIndex ist serverseitig eine Konstante (alle Karten aller Sets) und
  // wird trotzdem bei jedem Broadcast mitgeschickt - einmal uebernehmen reicht.
  socket.on('cardIndex', (idx) => { const first = !Object.keys(cardIndex).length; cardIndex = idx; if (first && state) render(); });
  socket.on('yourInfo', (info) => { if (!changed('yourInfo', info)) return; myInfo = info; if (state) render(); });
  socket.on('gameState', (s) => { if (!changed('gameState', s)) return; state = s; render(); });

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  function render() {
    if (!state) return;
    if (state.phase === 'lobby') { showScreen('lobby'); renderLobby(); }
    else { showScreen('game'); renderGame(); }
  }

  function me() { return state.players.find((p) => p.id === myInfo.playerId); }
  function isMyTurn() { return state.turnPlayerId === myInfo.playerId; }

  function renderLobby() {
    $('lobbyCode').textContent = state.code;
    $('lobbyCount').textContent = state.players.length;
    $('lobbyMax').textContent = state.maxPlayers;
    const list = $('lobbyPlayers');
    list.innerHTML = '';
    state.players.forEach((p) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${p.isHost ? '⭐ ' : ''}${escapeHtml(p.name)}${p.isBot ? ' <span class="tag">Bot</span>' : ''}</span>` +
        (p.id === myInfo.playerId ? '<span class="tag you">Du</span>' : '');
      if (p.isBot && me() && me().isHost) {
        const btn = document.createElement('button');
        btn.className = 'small'; btn.textContent = 'entfernen';
        btn.onclick = () => socket.emit('removeBot', { botId: p.id });
        li.appendChild(btn);
      }
      list.appendChild(li);
    });

    const toggles = $('setToggles');
    toggles.innerHTML = '<b>Sets:</b>';
    state.setKeys.forEach((k) => {
      const label = document.createElement('label');
      label.style.display = 'inline-flex'; label.style.alignItems = 'center'; label.style.gap = '4px'; label.style.margin = '0';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.style.width = 'auto';
      cb.checked = !!state.settings.sets[k];
      cb.disabled = !(me() && me().isHost);
      cb.onchange = () => {
        const sets = Object.assign({}, state.settings.sets);
        sets[k] = cb.checked;
        socket.emit('updateSets', sets);
      };
      label.appendChild(cb);
      label.appendChild(document.createTextNode(state.setLabels[k]));
      toggles.appendChild(label);
    });

    const iAmHost = me() && me().isHost;
    $('hostControls').classList.toggle('hidden', !iAmHost);
    $('btnAddBot').onclick = () => socket.emit('addBot');
    $('btnStart').onclick = () => socket.emit('startGame');
    $('btnStart').disabled = state.players.length < 1;
  }

  // Aufdeck-Animation: spielt genau einmal pro neu aufgedeckter Tuerkarte.
  // Beim (Wieder-)Einsteigen wird der zuletzt gesehene seq nur uebernommen,
  // ohne ein laengst vergangenes Aufdecken nachtraeglich zu animieren.
  let lastRevealSeq = null;
  let revealAnimTimer = null;
  function playDoorReveal() {
    const r = state.doorReveal;
    if (!r || r.seq === lastRevealSeq) return;
    const first = lastRevealSeq === null;
    lastRevealSeq = r.seq;
    if (first) return;
    const box = $('revealAnim');
    box.innerHTML = '';
    box.appendChild(cardTile(r.cardId, {}));
    box.classList.remove('hidden', 'play');
    void box.offsetWidth; // Reflow erzwingen, sonst startet die Animation bei schneller Folge nicht neu
    box.classList.add('play');
    clearTimeout(revealAnimTimer);
    revealAnimTimer = setTimeout(() => { box.classList.add('hidden'); box.innerHTML = ''; }, 1500);
  }

  // Wuerfel-Animation beim Weglaufen. Gleiches Muster wie playDoorReveal:
  // genau einmal pro neuem seq, beim (Wieder-)Einstieg nur den seq uebernehmen.
  // Alle am Tisch sehen sie, deshalb steht der Name der wuerfelnden Person dabei.
  const DIE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  let lastDieSeq = null;
  let dieAnimTimer = null;
  let dieTickTimer = null;
  function playDieRoll() {
    const d = state.dieRoll;
    if (!d || d.seq === lastDieSeq) return;
    const first = lastDieSeq === null;
    lastDieSeq = d.seq;
    if (first) return;
    const box = $('dieAnim');
    const modText = `${d.mod >= 0 ? '+' : ''}${d.mod}`;
    box.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'die-box';
    const who = document.createElement('div');
    who.className = 'die-who';
    who.textContent = `${d.playerName} läuft weg…`;
    const face = document.createElement('div');
    face.className = 'die-face';
    face.textContent = DIE_FACES[d.roll - 1];
    const sum = document.createElement('div');
    sum.className = 'die-sum';
    sum.textContent = `${d.roll} ${modText} = ${d.total}`;
    const res = document.createElement('div');
    res.className = `die-result ${d.success ? 'good' : 'bad'}`;
    res.textContent = d.success ? 'Entkommen!' : 'Gescheitert!';
    wrap.append(who, face, sum, res);
    // Woher der Modifikator kommt (Elf, Weglaufstiefel, Monstertext ...) -
    // sonst sieht die Zahl nach einem Rechenfehler aus.
    if (d.note) {
      const note = document.createElement('div');
      note.className = 'die-note';
      note.textContent = d.note;
      wrap.appendChild(note);
    }
    box.appendChild(wrap);
    box.classList.remove('hidden', 'play');
    void box.offsetWidth; // Reflow erzwingen, sonst startet die Animation bei schneller Folge nicht neu
    box.classList.add('play');
    // Waehrend des "Rollens" wechseln die Augenzahlen; danach bleibt das echte
    // Ergebnis stehen, damit die Animation es nicht verschluckt.
    clearInterval(dieTickTimer);
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      dieTickTimer = setInterval(() => { face.textContent = DIE_FACES[Math.floor(Math.random() * 6)]; }, 90);
      setTimeout(() => { clearInterval(dieTickTimer); face.textContent = DIE_FACES[d.roll - 1]; }, 900);
    }
    clearTimeout(dieAnimTimer);
    dieAnimTimer = setTimeout(() => { box.classList.add('hidden'); box.innerHTML = ''; }, 2600);
  }

  // Beute-Animation nach einem Kampfsieg: nur die/der Siegende bekommt sie zu
  // sehen, denn die gezogenen Schatzkarten sind Handkarten und damit geheim -
  // deshalb haengt sie an myInfo (privates yourInfo-Event), nicht am State.
  let lastRewardSeq = null;
  let rewardAnimTimer = null;
  let rewardFlyTimer = null;

  // Zum Schluss fliegen die Beutekarten in die eigene Handleiste, damit
  // sichtbar ist, wo der Schatz landet. FLIP-Prinzip: einmal die Zielposition
  // messen, dann pro Karte genau ein transform - kein Reflow pro Frame.
  function flyRewardCardsToHand(box) {
    const target = $('myHand').getBoundingClientRect();
    if (!target.width) return; // Handleiste nicht sichtbar - dann nur ausblenden
    box.querySelectorAll('.cardtile').forEach((tile, i) => {
      const r = tile.getBoundingClientRect();
      tile.style.animation = 'none'; // Einflug-Keyframes abschalten, sonst kaempfen sie mit dem transform
      tile.style.transition = `transform 0.6s cubic-bezier(0.4, 0, 0.7, 1) ${i * 0.07}s, opacity 0.6s ease-in ${i * 0.07}s`;
      void tile.offsetWidth;
      tile.style.transform = `translate(${target.left + target.width / 2 - (r.left + r.width / 2)}px, ${target.top + target.height / 2 - (r.top + r.height / 2)}px) scale(0.25)`;
      tile.style.opacity = '0';
    });
  }
  function playReward() {
    const r = myInfo.lastReward;
    if (!r || r.seq === lastRewardSeq) return;
    const first = lastRewardSeq === null;
    lastRewardSeq = r.seq;
    if (first) return;
    const box = $('rewardAnim');
    box.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'reward-box';
    const head = document.createElement('div');
    head.className = 'reward-head';
    // Ohne Stufengewinn wurde das Monster nicht besiegt, sondern hat seinen
    // Schatz zurueckgelassen (Polly-Trank & Co.) - dann passt "besiegt" nicht.
    head.textContent = r.levelsGained
      ? `⚔️ ${r.monsterNames.join(' + ')} besiegt!`
      : `🪙 ${r.monsterNames.join(' + ')} liess den Schatz zurueck!`;
    wrap.appendChild(head);
    if (r.levelsGained) {
      const lvl = document.createElement('div');
      lvl.className = 'reward-level';
      lvl.textContent = `+${r.levelsGained} Stufe${r.levelsGained === 1 ? '' : 'n'}`;
      wrap.appendChild(lvl);
    }
    if (r.cardIds.length) {
      const label = document.createElement('div');
      label.className = 'reward-label';
      label.textContent = `Deine Beute: ${r.cardIds.length} Schatzkarte${r.cardIds.length === 1 ? '' : 'n'}`;
      wrap.appendChild(label);
      const row = document.createElement('div');
      row.className = 'reward-cards';
      r.cardIds.forEach((id, i) => {
        const tile = cardTile(id, {});
        tile.style.animationDelay = `${0.25 + i * 0.18}s`; // Karten nacheinander einfliegen lassen
        row.appendChild(tile);
      });
      wrap.appendChild(row);
    } else {
      wrap.appendChild(textNode('Dieses Monster liess keinen Schatz zurueck.'));
    }
    box.appendChild(wrap);
    box.classList.remove('hidden', 'play', 'fly');
    void box.offsetWidth; // Reflow erzwingen, sonst startet die Animation bei schneller Folge nicht neu
    box.classList.add('play');
    clearTimeout(rewardAnimTimer);
    clearTimeout(rewardFlyTimer);
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      rewardFlyTimer = setTimeout(() => { box.classList.add('fly'); flyRewardCardsToHand(box); }, 1400);
    }
    rewardAnimTimer = setTimeout(() => {
      box.classList.add('hidden');
      box.classList.remove('play', 'fly');
      box.innerHTML = '';
    }, reduced ? 3400 : 2400);
  }

  function renderGame() {
    $('gameCode').textContent = state.code;
    $('deckInfo').textContent = `🚪 Tür: ${state.doorDeckCount} | 💰 Schatz: ${state.treasureDeckCount}`;

    if (state.phase === 'gameend') {
      const winner = state.players.find((p) => p.id === state.winner);
      $('turnBanner').textContent = `🏆 ${winner ? winner.name : '?'} hat gewonnen!`;
    } else {
      const tp = state.players.find((p) => p.id === state.turnPlayerId);
      const phaseLabel = {
        tuer: 'Phase 1: Tür eintreten', aerger: 'Phase 2: Auf Ärger aus sein',
        pluendern: 'Phase 3: Raum plündern', gabe: 'Phase 4: Milde Gabe', kampf: 'Kampf!',
      }[state.turnPhase] || '';
      $('turnBanner').textContent = `${tp ? tp.name : '?'} ist am Zug - ${phaseLabel}`;
    }

    playDoorReveal();
    playDieRoll();
    playReward();
    renderPlayerList();
    renderDiscardPeek();
    renderReveal();
    renderCombat();
    renderConsequence();
    renderCardAction();
    renderPhaseActions();
    renderTradeArea();
    renderMyPanel();
    renderLog();

    if (state.phase === 'gameend') {
      const banner = $('banner');
      banner.classList.remove('hidden');
      const winner = state.players.find((p) => p.id === state.winner);
      banner.textContent = `🏆 Spiel vorbei! ${winner ? winner.name : '?'} hat Stufe 10 erreicht.`;
      const btn = document.createElement('button');
      btn.textContent = 'Zurück zur Lobby'; btn.style.marginLeft = '12px';
      btn.onclick = () => socket.emit('resetGame');
      banner.appendChild(btn);
    } else {
      $('banner').classList.add('hidden');
    }
  }

  // Eine Zeile pro Karte auf dem Spezialplatz; ohne Karten bleibt der Platz
  // mit einer leeren Zeile sichtbar.
  function specialSlotRows(p) {
    const cfg = state.specialSlots || {};
    return Object.keys(cfg).flatMap((key) => {
      const label = cfg[key].label || key;
      const v = p.equipped[key];
      const ids = Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []);
      if (!ids.length) return [[key, label, null]];
      return ids.map((id, i) => [`${key}${i}`, ids.length > 1 ? `${label} ${i + 1}` : label, id]);
    });
  }

  function renderPlayerList() {
    const box = $('playerList');
    box.innerHTML = '<h3>Spieler:innen</h3>';
    state.players.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'prow clickable' + (p.id === state.turnPlayerId ? ' active-turn' : '');
      const equip = equippedIdsOf(p).length;
      row.innerHTML = `<span>${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</span>` +
        `<span>` +
        (p.id === state.turnPlayerId ? '<span class="tag turn">Zug</span> ' : '') +
        (p.id === myInfo.playerId ? '<span class="tag you">Du</span> ' : '') +
        (!p.connected ? '<span class="tag off">offline</span> ' : '') +
        `<span class="tag">Stufe ${p.level}</span> <span class="tag">⚔ ${p.strength}</span> <span class="tag">🎒 ${equip}</span>` +
        (p.activeCurses && p.activeCurses.length ? ` <span class="tag">🌀 Fluch x${p.activeCurses.length}</span>` : '') +
        `</span>`;
      row.title = 'Klicken für Ausrüstung';
      row.addEventListener('click', () => openPlayerModal(p.id));
      if (p.id !== myInfo.playerId && p.connected) {
        const tradeBtn = document.createElement('button');
        tradeBtn.className = 'small'; tradeBtn.textContent = '🤝 Handeln';
        tradeBtn.style.marginTop = '6px';
        tradeBtn.onclick = (e) => { e.stopPropagation(); startTradeCompose(p.id); };
        row.appendChild(tradeBtn);
      }
      box.appendChild(row);
    });
  }

  // ---------------------------------------------------------------------
  // Spieler-Modal (Ausrüstung ansehen)
  // ---------------------------------------------------------------------

  function openPlayerModal(playerId) {
    const p = state.players.find((pl) => pl.id === playerId);
    if (!p) return;
    const body = $('cardModalBody');
    body.innerHTML = `<h3>${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''} - Stufe ${p.level}</h3>`;

    const badges = document.createElement('div');
    badges.className = 'row gap wrap';
    badges.style.marginBottom = '12px';
    p.races.forEach((id) => badges.appendChild(smallTag(card(id).name, 'var(--c-race)')));
    p.classes.forEach((id) => badges.appendChild(smallTag(card(id).name, 'var(--c-class)')));
    (p.powerGroups || []).forEach((id) => badges.appendChild(smallTag(card(id).name, 'var(--c-class)')));
    if (!p.races.length && !p.classes.length && !(p.powerGroups || []).length) badges.appendChild(textNode('Mensch, ohne Klasse'));
    body.appendChild(badges);

    const equip = document.createElement('div');
    equip.className = 'row gap wrap';
    const slotDefs = [
      ['Kopf', p.equipped.head], ['Rüstung', p.equipped.armor], ['Schuhe', p.equipped.feet],
      ['Hand 1', p.equipped.hands[0]], ['Hand 2', p.equipped.hands[1]],
      ...specialSlotRows(p).map(([, label, cardId]) => [label, cardId]),
    ];
    slotDefs.forEach(([label, cardId]) => {
      const el = document.createElement('div');
      el.className = 'equipslot' + (cardId ? ' filled' : '');
      if (cardId) {
        const c = card(cardId);
        const img = document.createElement('img');
        img.className = 'eqimg'; img.alt = ''; img.src = cardImageUrl(cardId);
        img.onerror = () => img.remove();
        el.innerHTML = `<b>${label}</b>`;
        el.appendChild(img);
        el.appendChild(document.createTextNode(`${c.name}${c.bonus ? ` (+${c.bonus})` : ''}`));
        el.style.cursor = 'pointer';
        el.onclick = () => openCardModal(cardId);
      } else {
        el.innerHTML = `<b>${label}</b><span class="hint">leer</span>`;
      }
      equip.appendChild(el);
    });
    body.appendChild(equip);
    $('cardModal').classList.remove('hidden');
  }

  // ---------------------------------------------------------------------
  // Handel (Trading) - jederzeit möglich, nicht an den eigenen Zug gebunden.
  // ---------------------------------------------------------------------

  // Handelbar sind eigene Handkarten UND eigene angelegte Gegenstände
  // (letztere sind öffentlich sichtbar und stehen im state).
  function myEquippedIds() {
    const me = state && state.players.find((p) => p.id === myInfo.playerId);
    if (!me) return [];
    return [...new Set(equippedIdsOf(me))];
  }
  function myTradableIds() {
    return [...new Set([...(myInfo.hand || []), ...myEquippedIds()])];
  }
  function goldSum(ids) {
    return (ids || []).reduce((sum, id) => sum + (typeof card(id).gold === 'number' ? card(id).gold : 0), 0);
  }

  function tradePickGrid(ids, selection) {
    const equipped = myEquippedIds();
    const grid = document.createElement('div');
    grid.className = 'row gap wrap tradegrid';
    ids.forEach((id) => {
      const c = card(id);
      const label = document.createElement('label');
      label.className = 'tradepick' + (selection.has(id) ? ' picked' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = selection.has(id);
      cb.onchange = () => {
        if (cb.checked) selection.add(id); else selection.delete(id);
        renderTradeArea();
      };
      label.appendChild(cb);
      label.appendChild(document.createTextNode(
        ` ${c.name}${typeof c.gold === 'number' ? ` (${c.gold} GS)` : ''}${equipped.includes(id) ? ' • angelegt' : ''}`
      ));
      grid.appendChild(label);
    });
    if (!ids.length) grid.appendChild(textNode('Nichts Tauschbares vorhanden.'));
    return grid;
  }

  // Anklickbare Kartenverweise (wie im Verlauf) für eine Handelshälfte.
  function tradeChips(ids) {
    const row = document.createElement('div');
    row.className = 'row gap wrap';
    (ids || []).forEach((id) => {
      const c = card(id);
      const chip = document.createElement('a');
      chip.href = '#'; chip.className = 'logcardlink';
      chip.textContent = `[${c.name}${typeof c.gold === 'number' ? ` ${c.gold} GS` : ''}]`;
      chip.onclick = (e) => { e.preventDefault(); openCardModal(id); };
      row.appendChild(chip);
    });
    if (!(ids || []).length) row.appendChild(textNode('(nichts)'));
    return row;
  }

  // "300 vs. 400 Goldstücke" - Wert gegen Wert abwägen. Gold ist im Spiel
  // keine Währung, sondern nur der Verkaufswert der Karten (Verkauf ab 1.000
  // Goldstücken über handleSellItems) - hier also reine Entscheidungshilfe.
  function tradeVsLine(giveIds, getIds) {
    return textNode(`Du gibst ${goldSum(giveIds)} GS  vs.  du bekommst ${goldSum(getIds)} GS`);
  }

  function renderTradeArea() {
    const box = $('tradeArea');
    if (!box) return;
    box.innerHTML = '';
    if (!state || state.phase !== 'playing') return;

    // 1. Eigenes Angebot zusammenstellen
    if (tradeComposeTargetId) {
      const target = state.players.find((p) => p.id === tradeComposeTargetId);
      if (!target || !target.connected) {
        tradeComposeTargetId = null;
      } else {
        const panel = document.createElement('div');
        panel.className = 'tradebox';
        panel.innerHTML = `<h3>🤝 Handel anbieten an ${escapeHtml(target.name)}</h3>` +
          `<p class="hint">Wähle, was du hergeben willst - Handkarten oder angelegte Gegenstände. ` +
          `${escapeHtml(target.name)} legt dann die Gegenleistung fest, die du anschließend bestätigen musst.</p>`;
        panel.appendChild(tradePickGrid(myTradableIds(), tradeComposeSelection));
        const selected = Array.from(tradeComposeSelection);
        panel.appendChild(textNode(`Dein Angebot: ${selected.length} Karte(n), ${goldSum(selected)} Goldstücke`));
        const actions = document.createElement('div');
        actions.className = 'row gap'; actions.style.marginTop = '10px';
        const sendBtn = mkBtn('Angebot senden', () => {
          if (!tradeComposeSelection.size) return;
          socket.emit('proposeTrade', { toId: tradeComposeTargetId, offerCardIds: Array.from(tradeComposeSelection) });
          tradeComposeTargetId = null; tradeComposeSelection = new Set();
          renderTradeArea();
        });
        sendBtn.className = 'primary';
        sendBtn.disabled = !tradeComposeSelection.size;
        const cancelBtn = mkBtn('Abbrechen', () => { tradeComposeTargetId = null; tradeComposeSelection = new Set(); renderTradeArea(); });
        actions.appendChild(sendBtn); actions.appendChild(cancelBtn);
        panel.appendChild(actions);
        box.appendChild(panel);
      }
    }

    // 2. Angebote an mich - ich lege meine Hälfte fest
    (myInfo.incomingTrades || []).forEach((t) => {
      const panel = document.createElement('div');
      panel.className = 'tradebox';
      panel.innerHTML = `<h3>🤝 Handelsangebot von ${escapeHtml(t.fromName)}</h3><p>Bietet dir an:</p>`;
      panel.appendChild(tradeChips(t.offerCardIds));

      if (t.status === 'countered') {
        panel.appendChild(textNode('Du verlangst dafür:'));
        panel.appendChild(tradeChips(t.counterCardIds));
        panel.appendChild(tradeVsLine(t.counterCardIds, t.offerCardIds));
        panel.appendChild(textNode(`Wartet auf Bestätigung von ${t.fromName}...`));
        box.appendChild(panel);
        return;
      }

      const actions = document.createElement('div');
      actions.className = 'row gap wrap'; actions.style.marginTop = '10px';
      const counterBtn = mkBtn('Gegenleistung festlegen...', () => { tradeCounterForId = t.id; tradeCounterSelection = new Set(); renderTradeArea(); });
      counterBtn.className = 'primary';
      const giftBtn = mkBtn('Annehmen, ohne etwas zu geben', () => socket.emit('respondTrade', { tradeId: t.id, accept: true, counterCardIds: [] }));
      const declineBtn = mkBtn('Ablehnen', () => socket.emit('respondTrade', { tradeId: t.id, accept: false }));
      declineBtn.className = 'danger';
      actions.appendChild(counterBtn); actions.appendChild(giftBtn); actions.appendChild(declineBtn);
      panel.appendChild(actions);

      if (tradeCounterForId === t.id) {
        panel.appendChild(tradePickGrid(myTradableIds(), tradeCounterSelection));
        const mine = Array.from(tradeCounterSelection);
        panel.appendChild(tradeVsLine(mine, t.offerCardIds));
        const confirmBtn = mkBtn('Gegenleistung verlangen', () => {
          if (!tradeCounterSelection.size) return;
          socket.emit('respondTrade', { tradeId: t.id, accept: true, counterCardIds: Array.from(tradeCounterSelection) });
          tradeCounterForId = null; tradeCounterSelection = new Set();
        });
        confirmBtn.className = 'primary'; confirmBtn.style.marginTop = '6px';
        confirmBtn.disabled = !tradeCounterSelection.size;
        panel.appendChild(confirmBtn);
      }
      box.appendChild(panel);
    });

    // 3. Meine eigenen Angebote - warten bzw. Gegenleistung bestätigen
    (myInfo.outgoingTrades || []).forEach((t) => {
      const panel = document.createElement('div');
      panel.className = 'tradebox';
      panel.innerHTML = `<h3>🤝 Dein Angebot an ${escapeHtml(t.toName)}</h3><p>Du bietest:</p>`;
      panel.appendChild(tradeChips(t.offerCardIds));

      const actions = document.createElement('div');
      actions.className = 'row gap wrap'; actions.style.marginTop = '10px';
      if (t.status === 'countered') {
        panel.appendChild(textNode(`${t.toName} verlangt dafür:`));
        panel.appendChild(tradeChips(t.counterCardIds));
        panel.appendChild(tradeVsLine(t.offerCardIds, t.counterCardIds));
        const okBtn = mkBtn('Tausch bestätigen', () => socket.emit('respondTrade', { tradeId: t.id, accept: true }));
        okBtn.className = 'primary';
        const noBtn = mkBtn('Gegenleistung ablehnen', () => socket.emit('respondTrade', { tradeId: t.id, accept: false }));
        noBtn.className = 'danger';
        actions.appendChild(okBtn); actions.appendChild(noBtn);
      } else {
        panel.appendChild(textNode(`Wert: ${goldSum(t.offerCardIds)} Goldstücke - wartet auf Antwort von ${t.toName}...`));
        actions.appendChild(mkBtn('Zurückziehen', () => socket.emit('cancelTrade', { tradeId: t.id })));
      }
      panel.appendChild(actions);
      box.appendChild(panel);
    });
  }

  function renderDiscardPeek() {
    const box = $('discardPeek');
    let html = '<h3>Ablagestapel</h3>';
    html += `<div class="hint">Tür (${state.doorDiscardCount}): ${state.doorDiscardTop ? escapeHtml(card(state.doorDiscardTop).name) : '-'}</div>`;
    html += `<div class="hint">Schatz (${state.treasureDiscardCount}): ${state.treasureDiscardTop ? escapeHtml(card(state.treasureDiscardTop).name) : '-'}</div>`;
    box.innerHTML = html;
  }

  function renderReveal() {
    const box = $('revealArea');
    box.innerHTML = '';
    if (!state.revealedDoorCard) return;
    const c = card(state.revealedDoorCard);
    const div = document.createElement('div');
    div.className = 'revealbox';
    div.innerHTML = `<h3>Aufgedeckte Türkarte</h3>`;
    div.appendChild(cardTile(state.revealedDoorCard, {}));
    if (isMyTurn()) {
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = 'Auf die Hand nehmen';
      btn.onclick = () => socket.emit('takeRevealedDoor');
      div.appendChild(btn);
    } else {
      const tp = state.players.find((p) => p.id === state.turnPlayerId);
      div.appendChild(textNode(`Warte auf ${tp ? tp.name : '?'}...`));
    }
    box.appendChild(div);
  }

  function renderCombat() {
    const box = $('combatArea');
    box.innerHTML = '';
    const c = state.combat;
    if (!c) return;
    const actor = state.players.find((p) => p.id === c.actorId);
    const helper = c.helperId ? state.players.find((p) => p.id === c.helperId) : null;
    // Die Summen kommen fertig gerechnet vom Server (playerStrength/
    // monsterStrength). Früher rechnete der Client sie selbst nach und kannte
    // dabei weder die Monsterboni gegen Rassen/Klassen ("+6 gegen Elfen") noch
    // die Sonderregeln einzelner Monster - die Anzeige wich dann von dem ab,
    // was der Server tatsächlich auswertet.
    const playerStrength = c.playerStrength;
    const monsterStrength = c.monsterStrength;

    const div = document.createElement('div');
    div.className = 'combatbox';
    div.innerHTML = `<h3>⚔️ Kampf gegen ${c.monsterIds.map((id) => card(id).name).join(' + ')}</h3>`;

    const monsterRow = document.createElement('div');
    monsterRow.className = 'cardgrid';
    c.monsterIds.forEach((id) => monsterRow.appendChild(cardTile(id, {})));
    div.appendChild(monsterRow);

    const iAmActor = c.actorId === myInfo.playerId;
    const iAmHelper = c.helperId === myInfo.playerId;

    const strengthRow = document.createElement('div');
    strengthRow.className = 'strengthrow';
    strengthRow.innerHTML = `<div>Ihr: <span class="${playerStrength > monsterStrength ? 'strengthgood' : 'strengthbad'}">${playerStrength}</span></div>` +
      `<div class="vs">vs.</div><div>Monster: <b>${monsterStrength}</b></div>`;
    div.appendChild(strengthRow);

    // Dauerwirkungen der Monsterkarte sichtbar machen, sonst wirken die Zahlen
    // willkürlich.
    const notes = [];
    if (c.monsterTraitBonus) notes.push(`Kartenbonus des Monsters gegen eure Rasse/Klasse: +${c.monsterTraitBonus}`);
    if (c.ignoresBonuses) notes.push('Gegen dieses Monster zählt nur eure Charakterstufe - keine Gegenstände, keine Boni.');
    if (c.ignoresLevel) notes.push('Gegen dieses Monster zählt eure Stufe nicht - nur eure Boni.');
    if (c.forbidsHelp) notes.push('Gegen dieses Monster darf niemand helfen.');
    if (c.doubleActor) notes.push('Doppelgänger: eure Kampfstärke zählt doppelt.');
    // Ohne Hinweis sähe die Monsterstärke 0 wie ein Anzeigefehler aus.
    (c.autoKilledMonsters || []).forEach((name) => {
      notes.push(`${name}: von Halblingen einfach eingestampft - zählt mit Stärke 0, Stufe und Schatz gibt es trotzdem.`);
    });
    const power = myInfo.classCombatPower;
    if (power && power.remaining > 0) {
      notes.push(`Deine Klassenkraft "${power.label}": bis zu ${power.remaining} weitere Handkarte(n) ablegen für je +${power.bonus} ` +
        `${power.kind === 'flee' ? 'auf Weglaufen' : 'im Kampf'} - die Knöpfe stehen unten an deinen Handkarten.`);
    }
    notes.forEach((t) => {
      const el = document.createElement('div');
      el.className = 'hint';
      el.textContent = t;
      div.appendChild(el);
    });

    // Bedingtes Reaktionsfenster: GEZINKTER WÜRFEL (auf den Weglaufwurf) und
    // KLEBERFLÄSCHCHEN (auf eine gelungene Flucht). Beide Felder kommen
    // direkt vom Server - das eigentliche Ausspielen passiert an der
    // jeweiligen Handkarte (siehe handActionsFor), hier nur Hinweis + Passen.
    if (state.pendingRoll && state.pendingRoll.holders.includes(myInfo.playerId)) {
      const row = document.createElement('div');
      row.className = 'row gap wrap';
      const werfer = state.players.find((p) => p.id === state.pendingRoll.playerId);
      row.appendChild(textNode(`${werfer ? werfer.name : '?'} hat ${state.pendingRoll.roll} gewürfelt - du darfst noch mit "GEZINKTER WÜRFEL" reagieren.`));
      row.appendChild(mkBtn('Passen', () => socket.emit('passReaction', {})));
      div.appendChild(row);
    }
    if (c.escapeReactionOffer && c.escapeReactionOffer.includes(myInfo.playerId)) {
      const row = document.createElement('div');
      row.className = 'row gap wrap';
      row.appendChild(textNode(`${actor.name} ist entkommen - du darfst noch ein "KLEBERFLÄSCHCHEN" spielen und die Flucht wiederholen lassen.`));
      row.appendChild(mkBtn('Passen', () => socket.emit('passReaction', {})));
      div.appendChild(row);
    }

    // Jede:r am Tisch darf hier eingreifen - nicht nur Angreifer:in/Helfer:in -
    // um z.B. einen Fluch oder eine Hilfskarte zu verrechnen, die nicht
    // automatisch erkannt wird (Monster-Verstärkerkarten mit festem Bonus
    // rechnen sich weiter unten automatisch ein, siehe "Im Kampf spielen").
    if (!c.mustFlee) {
      const modRow = document.createElement('div');
      modRow.className = 'row gap wrap';
      modRow.innerHTML = `
        <label style="margin:0">Bonus/Malus der Kämpfenden (Karteneffekte manuell eintragen)
          <input type="number" id="actorModInput" value="${c.actorModifier}" style="width:80px">
        </label>
        <label style="margin:0">Monster Bonus/Malus (Karteneffekte manuell eintragen)
          <input type="number" id="monsterModInput" value="${c.monsterModifier}" style="width:80px">
        </label>`;
      div.appendChild(modRow);
      div.appendChild(textNode('Jede:r am Tisch darf hier eintragen - z.B. um dem Monster zu helfen/schaden oder den Kämpfenden zu unterstützen.'));
      modRow.querySelector('#actorModInput').onchange = (e) => socket.emit('setCombatModifier', { who: 'actor', value: e.target.value });
      modRow.querySelector('#monsterModInput').onchange = (e) => socket.emit('setCombatModifier', { who: 'monster', value: e.target.value });
    }

    // Bereit-Check: ausgewertet wird erst, wenn niemand mehr eingreifen will.
    // Wer bestätigen muss, sagt der Server (readyRequired) - Bots und
    // Getrennte sind da nicht dabei.
    const required = c.readyRequired || [];
    if (!c.mustFlee && required.length) {
      const readyRow = document.createElement('div');
      readyRow.className = 'readyrow';
      readyRow.appendChild(textNode('Bereit zur Auswertung:'));
      required.forEach((pid) => {
        const p = state.players.find((x) => x.id === pid);
        const tag = document.createElement('span');
        const ok = !!(c.ready && c.ready[pid]);
        tag.className = `readytag ${ok ? 'yes' : 'no'}`;
        tag.textContent = `${ok ? '✅' : '⬜'} ${p ? p.name : '?'}`;
        readyRow.appendChild(tag);
      });
      div.appendChild(readyRow);

      if (required.includes(myInfo.playerId)) {
        const mine = !!(c.ready && c.ready[myInfo.playerId]);
        const btn = document.createElement('button');
        btn.className = mine ? '' : 'primary';
        btn.textContent = mine ? 'Doch noch nicht bereit' : '✅ Bereit - auswerten kann losgehen';
        btn.onclick = () => socket.emit('setCombatReady', { ready: !mine });
        div.appendChild(btn);
        if (!mine) div.appendChild(textNode('Solange du nicht bereit bist, kann der Kampf nicht ausgewertet werden - spiel jetzt, was du noch spielen willst.'));
      }
    }

    const actions = document.createElement('div');
    actions.className = 'row gap wrap';

    if (iAmActor && !c.mustFlee) {
      const evalBtn = document.createElement('button');
      evalBtn.className = 'primary'; evalBtn.textContent = 'Kampf auswerten';
      evalBtn.disabled = !c.allReady;
      evalBtn.onclick = () => socket.emit('evaluateCombat');
      actions.appendChild(evalBtn);
      if (!c.allReady) {
        const offen = required.filter((pid) => !(c.ready && c.ready[pid]))
          .map((pid) => { const p = state.players.find((x) => x.id === pid); return p ? p.name : '?'; });
        actions.appendChild(textNode(`Warte auf: ${offen.join(', ')}`));
      }

      if (!c.helperId && !c.helperPending) {
        const helpSelect = document.createElement('select');
        helpSelect.innerHTML = '<option value="">Um Hilfe bitten...</option>' +
          state.players.filter((p) => p.id !== c.actorId && p.connected)
            .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
        helpSelect.onchange = () => { if (helpSelect.value) socket.emit('requestHelp', { targetId: helpSelect.value }); };
        actions.appendChild(helpSelect);
      }
      if (c.helperPending) {
        actions.appendChild(textNode(`Warte auf Antwort von ${state.players.find((p) => p.id === c.helperPending.targetId).name}...`));
      }
    }

    if (c.helperPending && c.helperPending.targetId === myInfo.playerId) {
      const ask = document.createElement('div');
      const asker = state.players.find((p) => p.id === c.actorId);
      ask.innerHTML = `<b>${escapeHtml(asker ? asker.name : '?')} bittet dich um Hilfe im Kampf!</b>`;
      const yes = document.createElement('button'); yes.textContent = 'Helfen'; yes.className = 'primary';
      yes.onclick = () => socket.emit('respondHelp', { accept: true });
      const no = document.createElement('button'); no.textContent = 'Ablehnen';
      no.onclick = () => socket.emit('respondHelp', { accept: false });
      ask.appendChild(yes); ask.appendChild(no);
      div.appendChild(ask);
    }

    // HALBLING: nach dem verpatzten ersten Wurf noch eine Entscheidung -
    // 1 Handkarte ablegen und nochmal würfeln (Knopf an der Karte) oder das
    // Miese Zeug hinnehmen. Solange das offen ist, kein neuer Wurf.
    // ZAUBERER "Verzauberung": ganze Hand gegen Monster+Schatz, keine Stufe.
    const enchant = myInfo.classEnchant;
    if (enchant && !c.mustFlee) {
      const btn = mkBtn(`✨ Verzauberung: ganze Hand ablegen (${enchant.handCount} Karten) und "${enchant.monsterName}" verzaubern - Schatz ja, Stufe nein`,
        () => socket.emit('enchantMonster', {}));
      btn.className = 'primary';
      div.appendChild(btn);
    }

    if (iAmActor && c.fleeRerollOffer) {
      const escapeIds = myInfo.fleeEscapeCardIds || [];
      const wege = [];
      if (c.canReroll) wege.push('als Halbling 1 Handkarte ablegen (Knopf unter der Karte) und noch einmal würfeln');
      if (escapeIds.length) wege.push('eine Rettungskarte ablegen und automatisch entkommen');
      const lampIds = myInfo.lampCardIds || [];
      if (lampIds.length) wege.push('die Magische Lampe nutzen und ein Monster verschwinden lassen');
      div.appendChild(textNode(`Der Wurf ist misslungen - du kannst noch ${wege.join(' oder ')}. Oder du stellst dich dem Miesen Zeug.`));
      escapeIds.forEach((escId) => {
        const btn = mkBtn(`🫥 "${card(escId).name}" ablegen und automatisch entkommen`, () => socket.emit('fleeEscape', { cardId: escId }));
        btn.className = 'primary';
        div.appendChild(btn);
      });
      // MAGISCHE LAMPE: pro gehaltener Lampe und pro Monster im Kampf ein
      // Knopf - war es das einzige Monster, gibt es dafür noch seinen Schatz.
      lampIds.forEach((lampId) => {
        c.monsterIds.forEach((monsterId) => {
          const btn = mkBtn(`🧞 "${card(lampId).name}": "${card(monsterId).name}" verschwinden lassen`,
            () => socket.emit('useLamp', { cardId: lampId, monsterId }));
          btn.className = 'primary';
          div.appendChild(btn);
        });
      });
      const acceptBtn = mkBtn('Miesem Zeug stellen', () => socket.emit('fleeReroll', { cardId: null }));
      div.appendChild(acceptBtn);
    } else if (iAmActor && c.mustFlee) {
      div.appendChild(textNode('Ihr verliert diesen Kampf - jetzt fliehen (Würfelwurf ≥ 5 nötig)!'));
      const fleeRow = document.createElement('div');
      fleeRow.className = 'row gap';
      fleeRow.innerHTML = `<label style="margin:0">Wurf-Modifikator <input type="number" id="fleeModInput" value="0" style="width:70px"></label>`;
      const fleeBtn = document.createElement('button');
      fleeBtn.className = 'primary'; fleeBtn.textContent = '🎲 Fliehen';
      fleeBtn.onclick = () => socket.emit('attemptFlee', { modifier: fleeRow.querySelector('#fleeModInput').value });
      fleeRow.appendChild(fleeBtn);
      div.appendChild(fleeRow);
    }

    div.appendChild(actions);
    box.appendChild(div);
  }

  function renderConsequence() {
    const box = $('consequenceArea');
    box.innerHTML = '';
    const pc = state.pendingConsequence;
    if (!pc) return;
    const player = state.players.find((p) => p.id === pc.playerId);
    const div = document.createElement('div');
    div.className = 'consequencebox';
    div.innerHTML = `<h3>${pc.kind === 'curse' ? '💀 Fluch' : '☠️ Schlimme Dinge'} - ${escapeHtml(player.name)}</h3>` +
      `<p>${pc.text ? formatCardText(pc.text) : '(kein Text)'}</p>` +
      (pc.autoApplied ? `<p class="autoconsequence">✅ <b>Automatisch berechnet:</b> ${escapeHtml(pc.autoApplied)}</p>` : '');
    if (pc.cardId) div.appendChild(cardTile(pc.cardId, {}));

    if (pc.playerId === myInfo.playerId) {
      if (pc.choice) {
        const choiceBox = document.createElement('div');
        choiceBox.className = 'row gap wrap';
        choiceBox.appendChild(textNode('Diese Karte lässt dich wählen - beide Optionen werden automatisch berechnet:'));
        pc.choice.options.forEach((opt) => {
          const btn = document.createElement('button');
          btn.className = 'primary'; btn.textContent = opt.label;
          btn.onclick = () => socket.emit('resolveConsequenceChoice', { optionId: opt.id });
          choiceBox.appendChild(btn);
        });
        div.appendChild(choiceBox);
      }
      div.appendChild(textNode(pc.autoApplied
        ? 'Die eindeutige Auswirkung wurde bereits automatisch angewendet (siehe oben). Falls die Karte noch weitere Effekte hat (z. B. einen Gegenstand ablegen), erledige das jetzt noch, dann "Fertig".'
        : (pc.choice ? 'Wähle oben eine Option, dann "Fertig". (Oder wende die Auswirkung manuell mit den Werkzeugen unten an.)' : 'Wende die Auswirkung mit den Werkzeugen unten an (Original-Kartentext oben beachten), dann "Fertig".')));
      const tools = document.createElement('div');
      tools.className = 'row gap wrap';
      const minus = document.createElement('button'); minus.textContent = '-1 Stufe';
      minus.onclick = () => socket.emit('applyConsequenceAction', { type: 'levelDelta', delta: -1 });
      const plus = document.createElement('button'); plus.textContent = '+1 Stufe';
      plus.onclick = () => socket.emit('applyConsequenceAction', { type: 'levelDelta', delta: 1 });
      const death = document.createElement('button'); death.className = 'danger'; death.textContent = '💀 Ich bin gestorben';
      death.onclick = () => { if (confirm('Charakter wirklich zurücksetzen (Stufe 1, Hand & Ausrüstung leer)?')) socket.emit('applyConsequenceAction', { type: 'death' }); };
      tools.appendChild(minus); tools.appendChild(plus); tools.appendChild(death);
      div.appendChild(tools);

      const myPlayer = me();
      const discardables = [...myPlayer.hand || myInfo.hand, ...[]];
      const allMine = [...myInfo.hand, ...equippedIdsOf(myPlayer)];
      if (allMine.length) {
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="">Gegenstand/Karte ablegen...</option>' +
          allMine.map((id) => `<option value="${id}">${escapeHtml(card(id).name)}</option>`).join('');
        sel.onchange = () => { if (sel.value) { socket.emit('applyConsequenceAction', { type: 'discardCard', cardId: sel.value }); sel.value = ''; } };
        div.appendChild(sel);
      }

      const doneBtn = document.createElement('button');
      doneBtn.className = 'primary'; doneBtn.textContent = 'Fertig';
      doneBtn.onclick = () => socket.emit('ackConsequence');
      div.appendChild(doneBtn);
    } else {
      div.appendChild(textNode('Warte darauf, dass die Auswirkung angewendet wird...'));
    }
    box.appendChild(div);
  }

  function renderCardAction() {
    const box = $('cardActionArea');
    box.innerHTML = '';
    const pa = state.pendingCardAction;
    if (!pa) return;
    const div = document.createElement('div');
    div.className = 'consequencebox';
    if (pa.playerId !== myInfo.playerId) {
      const owner = state.players.find((p) => p.id === pa.playerId);
      div.innerHTML = `<h3>✨ "${escapeHtml(pa.cardName)}"</h3><p>Warte auf ${owner ? escapeHtml(owner.name) : '?'}...</p>`;
      box.appendChild(div);
      return;
    }
    if (pa.kind === 'choice') {
      div.innerHTML = `<h3>✨ "${escapeHtml(pa.cardName)}" - Wahl</h3>`;
      const row = document.createElement('div');
      row.className = 'row gap wrap';
      pa.options.forEach((opt) => {
        const btn = mkBtn(opt.label, () => socket.emit('resolveCardChoice', { optionId: opt.id }));
        btn.className = 'primary';
        row.appendChild(btn);
      });
      div.appendChild(row);
    } else if (pa.kind === 'targetPlayer') {
      div.innerHTML = `<h3>✨ "${escapeHtml(pa.cardName)}" - ${escapeHtml(pa.prompt || 'Ziel wählen')}</h3>`;
      const row = document.createElement('div');
      row.className = 'row gap wrap';
      pa.candidateIds.forEach((pid) => {
        const target = state.players.find((p) => p.id === pid);
        const btn = mkBtn(target ? target.name : pid, () => socket.emit('resolveCardTarget', { targetId: pid }));
        btn.className = 'primary';
        row.appendChild(btn);
      });
      div.appendChild(row);
    } else if (pa.kind === 'chooseCard') {
      div.innerHTML = `<h3>✨ "${escapeHtml(pa.cardName)}" - ${escapeHtml(pa.prompt || 'Karte wählen')}</h3>`;
      const row = document.createElement('div');
      row.className = 'cardgrid';
      pa.candidateIds.forEach((cid) => {
        const tile = cardTile(cid, {});
        const btn = mkBtn('Nehmen', () => socket.emit('resolveCardCardChoice', { cardId: cid }));
        btn.className = 'primary';
        tile.querySelector('.ctbody').appendChild(btn);
        row.appendChild(tile);
      });
      if (!pa.candidateIds.length) row.appendChild(textNode('(Ablagestapel sind leer.)'));
      div.appendChild(row);
    }
    box.appendChild(div);
  }

  // Spezialplaetze ("Spezialausruestung", "Beine") kommen als Konfiguration
  // vom Server (state.specialSlots / state.specialSlotItems) - hier wird
  // bewusst keine zweite Kartenliste gepflegt.
  function specialSlotIds(p) {
    return Object.keys(state.specialSlots || {}).flatMap((k) => {
      const v = p.equipped[k];
      return Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []);
    });
  }

  function equippedIdsOf(p) {
    if (!p) return [];
    return [p.equipped.head, p.equipped.armor, p.equipped.feet, ...p.equipped.hands, ...specialSlotIds(p)].filter(Boolean);
  }

  function renderPhaseActions() {
    const box = $('phaseActions');
    box.innerHTML = '';
    if (state.phase === 'gameend' || state.combat || state.pendingConsequence || state.pendingCardAction) return;
    if (!isMyTurn()) { box.appendChild(textNode('Warte, bis du an der Reihe bist...')); return; }

    if (state.turnPhase === 'tuer' && !state.revealedDoorCard) {
      const btn = document.createElement('button'); btn.className = 'primary'; btn.textContent = '🚪 Tür eintreten (Karte aufdecken)';
      btn.onclick = () => socket.emit('drawDoor');
      box.appendChild(btn);
    } else if (state.turnPhase === 'aerger') {
      const skip = document.createElement('button'); skip.className = 'primary'; skip.textContent = 'Kein Monster spielen -> weiter';
      skip.onclick = () => socket.emit('skipToLoot');
      box.appendChild(skip);
      box.appendChild(textNode('Du kannst stattdessen unten bei einer Monster-Karte in deiner Hand "Als Monster spielen" wählen.'));
    } else if (state.turnPhase === 'pluendern') {
      const btn = document.createElement('button'); btn.className = 'primary'; btn.textContent = '📦 Raum plündern (verdeckt ziehen)';
      btn.onclick = () => socket.emit('lootRoom');
      box.appendChild(btn);
    } else if (state.turnPhase === 'gabe') {
      const myPlayer = me();
      // Limit kommt vom Server - Zwerge dürfen laut Kartentext 6 Karten halten.
      const limit = (myPlayer && myPlayer.handLimit) || 5;
      const over = myPlayer ? myInfo.hand.length - limit : 0;
      if (over > 0) {
        box.appendChild(textNode(`Milde Gabe: bitte noch ${over} Karte(n) ablegen (max. ${limit} auf der Hand).`));
      } else {
        const btn = document.createElement('button'); btn.className = 'primary'; btn.textContent = 'Zug beenden';
        btn.onclick = () => socket.emit('endTurn');
        box.appendChild(btn);
      }
    }
  }

  function renderMyPanel() {
    const p = me();
    if (!p) return;
    $('myLevel').textContent = p.level;

    const badges = $('myBadges');
    badges.innerHTML = '';
    p.races.forEach((id) => badges.appendChild(smallTag(card(id).name, 'var(--c-race)')));
    p.classes.forEach((id) => badges.appendChild(smallTag(card(id).name, 'var(--c-class)')));
    (p.powerGroups || []).forEach((id) => badges.appendChild(smallTag(card(id).name, 'var(--c-class)')));
    if (!p.races.length && !p.classes.length && !(p.powerGroups || []).length) badges.appendChild(textNode('Mensch, ohne Klasse'));
    if (p.raceCapCard) badges.appendChild(smallTag(card(p.raceCapCard).name, 'var(--c-race)'));
    if (p.classCapCard) badges.appendChild(smallTag(card(p.classCapCard).name, 'var(--c-class)'));
    if (p.powerGroupCapCard) badges.appendChild(smallTag(card(p.powerGroupCapCard).name, 'var(--c-class)'));

    const equip = $('myEquip');
    equip.innerHTML = '';
    const slotDefs = [
      ['head', 'Kopf', p.equipped.head],
      ['armor', 'Rüstung', p.equipped.armor],
      ['feet', 'Schuhe', p.equipped.feet],
      ['hand1', 'Hand 1', p.equipped.hands[0]],
      ['hand2', 'Hand 2', p.equipped.hands[1]],
      ...specialSlotRows(p),
    ];
    slotDefs.forEach(([key, label, cardId]) => {
      const el = document.createElement('div');
      el.className = 'equipslot' + (cardId ? ' filled' : '');
      if (cardId) {
        const c = card(cardId);
        const img = document.createElement('img');
        img.className = 'eqimg'; img.alt = ''; img.src = cardImageUrl(cardId);
        img.onerror = () => img.remove();
        el.innerHTML = `<b>${label}</b>`;
        el.appendChild(img);
        el.appendChild(document.createTextNode(`${c.name}${c.bonus ? ` (+${c.bonus})` : ''}`));
        const btn = document.createElement('button');
        btn.className = 'small'; btn.textContent = 'ablegen';
        btn.onclick = () => socket.emit('unequipItem', { cardId });
        el.appendChild(btn);
      } else {
        el.innerHTML = `<b>${label}</b><span class="hint">leer</span>`;
      }
      equip.appendChild(el);
    });

    renderHand(p);
  }

  function sortedHand() {
    if (!handSort) return myInfo.hand;
    // Kopie: die Reihenfolge in myInfo.hand kommt vom Server und bleibt die
    // Wahrheit (z.B. fürs Ablegen beim Bot-Zug).
    return myInfo.hand.slice().sort((a, b) => {
      const ca = card(a);
      const cb = card(b);
      const ia = HAND_SORT_ORDER.indexOf(ca.category);
      const ib = HAND_SORT_ORDER.indexOf(cb.category);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return ca.name.localeCompare(cb.name, 'de');
    });
  }

  function renderHand(p) {
    const box = $('myHand');
    box.innerHTML = '';
    // PRIESTER "Auferstehung": nicht an eine einzelne Karte gebunden, also
    // einmal ueber der Hand. Welche Stapel gehen, sagt der Server.
    (myInfo.resurrectPiles || []).forEach((pile) => {
      if (state.pendingCardAction || state.pendingRoll) return;
      const btn = mkBtn(`✝️ Auferstehung: oberste Karte vom ${pile === 'door' ? 'Tür' : 'Schatz'}-Ablagestapel nehmen (kostet 1 Handkarte)`,
        () => socket.emit('priestResurrect', { pile }));
      box.appendChild(btn);
    });
    if (handSortInput) handSortInput.checked = handSort;
    sortedHand().forEach((id) => {
      const tile = cardTile(id, { hand: true });
      tile.querySelector('.ctbody').appendChild(handActionsFor(id, p));
      box.appendChild(tile);
    });
    updateSellBar();
  }

  function handActionsFor(id, p) {
    const c = card(id);
    const wrap = document.createElement('div');
    wrap.className = 'row gap wrap';
    wrap.style.marginTop = '4px';

    const myTurn = isMyTurn() && state.turnPhase && !state.combat && !state.pendingConsequence && !state.pendingCardAction;

    const specialRule = (state.specialSlotItems || {})[c.name];
    const isBig = (state.bigItems || []).includes(c.name);
    if ((c.category === 'item' || specialRule) && myTurn) {
      const label = specialRule
        ? `Anlegen (${(state.specialSlots[specialRule.slot] || {}).label || specialRule.slot}${specialRule.races ? `, nur ${specialRule.races.join('/')}` : ''}${isBig ? ', Großer Gegenstand' : ''})`
        : `Anlegen${isBig ? ' (Großer Gegenstand)' : ''}`;
      const btn = mkBtn(label, () => socket.emit('equipItem', { cardId: id }));
      wrap.appendChild(btn);
    }
    // SCHUMMELN!: hebt die Anlege-Regeln fuer GENAU EINEN eigenen Gegenstand
    // auf (Hand oder angelegt) - Auswahl per Dropdown, der Server prueft den
    // Rest (Besitz, schon vorhandener Anhang).
    if (c.name === 'SCHUMMELN!' && myTurn) {
      const items = myTradableIds().filter((iid) => {
        const ic = card(iid);
        return ic && iid !== id && (ic.category === 'item' || (state.specialSlotItems || {})[ic.name]);
      });
      const select = document.createElement('select');
      select.innerHTML = '<option value="">🃏 Auf Gegenstand spielen...</option>' +
        items.map((iid) => `<option value="${iid}">${escapeHtml(card(iid).name)}</option>`).join('');
      select.onchange = () => {
        if (select.value) socket.emit('playCheat', { cheatCardId: id, targetItemId: select.value });
      };
      wrap.appendChild(select);
    }
    if (c.category === 'monster' && myTurn && state.turnPhase === 'aerger') {
      const btn = mkBtn('Als Monster spielen', () => socket.emit('playMonsterFromHand', { cardId: id }));
      wrap.appendChild(btn);
    }
    if ((c.category === 'race' || c.category === 'class') && myTurn) {
      const btn = mkBtn('Spielen', () => socket.emit('playRaceOrClass', { cardId: id }));
      wrap.appendChild(btn);
    }
    // Machtgruppe (Pathfinder-Set) und die drei "Obergrenze +1"-Karten
    // (Halb-Blut/Super Munchkin/Doppelleben) werden mechanisch wie
    // Rasse/Klasse gespielt, sind aber als "door_other" kategorisiert.
    if (myTurn && c.category === 'door_other' && (POWER_GROUP_NAMES.has((c.name || '').toUpperCase()) || TRAIT_CAP_CARD_NAMES.has(c.name))) {
      const btn = mkBtn('Spielen', () => socket.emit('playRaceOrClass', { cardId: id }));
      wrap.appendChild(btn);
    }
    // Generische "Sonderkraft nutzen"-Aktion für Schatzkarten mit
    // automatisierter Fähigkeit (Sofort-Stufenaufstieg, kuratierte
    // Einzelfälle - siehe TREASURE_POWER_NAMES/isInstantLevelUpText unten).
    if (myTurn && !state.pendingCardAction && (hasTreasurePower(c) || hasDoorPower(c))) {
      const btn = mkBtn('✨ Sonderkraft nutzen', () => socket.emit('useCardPower', { cardId: id }));
      wrap.appendChild(btn);
    }
    if (typeof c.gold === 'number' && c.gold > 0) {
      const label = document.createElement('label');
      label.style.margin = '0'; label.style.display = 'inline-flex'; label.style.gap = '4px'; label.style.alignItems = 'center';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.style.width = 'auto';
      cb.checked = sellSelection.has(id);
      cb.onchange = () => { if (cb.checked) sellSelection.add(id); else sellSelection.delete(id); updateSellBar(); };
      label.appendChild(cb);
      label.appendChild(document.createTextNode(`${c.gold} GS`));
      wrap.appendChild(label);
    }
    if (myTurn) {
      const btn = mkBtn('Ablegen', () => socket.emit('discardFromHand', { cardId: id }));
      wrap.appendChild(btn);
    }
    // Monster-Verstärkerkarten ("+X für das Monster") darf jede:r am Tisch
    // jederzeit während eines laufenden Kampfes ausspielen, nicht nur die
    // kämpfende Person - der Bonus/Malus wird automatisch verrechnet.
    if (state.combat && !state.combat.mustFlee && isMonsterEnhancer(c)) {
      const sign = c.bonus > 0 ? '+' : '';
      const btn = mkBtn(`⚔️ Im Kampf spielen (${sign}${c.bonus} Monster)`, () => socket.emit('playCombatCard', { cardId: id }));
      wrap.appendChild(btn);
    }
    // "Kampf-Tränke": Schatzkarten mit einem +N-Bonus für eine wählbare
    // Seite, jederzeit während eines laufenden Kampfes spielbar.
    if (state.combat && !state.combat.mustFlee && !state.pendingCardAction && isCombatPotion(c)) {
      const btn = mkBtn('⚔️ Im Kampf spielen', () => socket.emit('playCombatCard', { cardId: id }));
      wrap.appendChild(btn);
    }
    // Türkarten mit eigener Kampfwirkung (MAHLZEIT!) - welche das sind, sagt
    // der Server (state.doorCombatCards), damit hier keine Namensliste liegt.
    if (state.combat && !state.combat.mustFlee && (state.doorCombatCards || []).includes(c.name)) {
      const btn = mkBtn('⚔️ Im Kampf spielen', () => socket.emit('playCombatCard', { cardId: id }));
      wrap.appendChild(btn);
    }
    // Kampfreaktionskarten (Kumpel, Wanderndes Monster, Illusion, Hilf mir,
    // Ueberfalltrank) - welche das sind, sagt der Server (state.combatReactionCards).
    if (state.combat && !state.combat.mustFlee && !state.pendingCardAction && (state.combatReactionCards || []).includes(c.name)) {
      const btn = mkBtn('⚔️ Im Kampf spielen', () => socket.emit('playCombatCard', { cardId: id }));
      wrap.appendChild(btn);
    }
    // Klassenkräfte, die Handkarten kosten (Krieger "Berserken", Priester
    // "Vertreiben", Zauberer "Flugzauber"). Welche gerade nutzbar ist und wie
    // viele Karten noch gehen, rechnet der Server - hier steht bewusst keine
    // zweite Kopie der Regeln.
    const power = myInfo.classCombatPower;
    if (power && power.remaining > 0) {
      const suffix = power.kind === 'flee' ? 'auf Weglaufen' : 'im Kampf';
      const btn = mkBtn(`⚔️ ${power.label}: ablegen für +${power.bonus} ${suffix} (noch ${power.remaining})`,
        () => socket.emit('useClassCombatDiscard', { cardId: id }));
      wrap.appendChild(btn);
    }
    // DIEB: beide Kraefte kosten genau eine Handkarte - deshalb haengen sie
    // an jeder Karte. Wer Ziel sein darf, sagt der Server (myInfo.thiefPower).
    const thief = myInfo.thiefPower;
    if (thief && thief.backstabTargets.length && !state.pendingCardAction) {
      const sel = document.createElement('select');
      sel.innerHTML = '<option value="">🗡️ In den Rücken fallen (-2)...</option>' +
        thief.backstabTargets.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
      sel.onchange = () => { if (sel.value) socket.emit('thiefBackstab', { cardId: id, targetId: sel.value }); };
      wrap.appendChild(sel);
    }
    if (thief && thief.stealTargets.length && !state.pendingCardAction && !state.pendingRoll) {
      const sel = document.createElement('select');
      sel.innerHTML = '<option value="">🗝️ Diebstahl (Wurf ab 4)...</option>' +
        thief.stealTargets.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
      sel.onchange = () => { if (sel.value) socket.emit('thiefSteal', { cardId: id, targetId: sel.value }); };
      wrap.appendChild(sel);
    }
    // HALBLING-Wiederholungswurf: jede Handkarte kann die Karte sein, die
    // dafür abgelegt wird.
    if (state.combat && state.combat.fleeRerollOffer && state.combat.canReroll && state.combat.actorId === myInfo.playerId) {
      const btn = mkBtn('🎲 Halbling: ablegen und nochmal weglaufen', () => socket.emit('fleeReroll', { cardId: id }));
      btn.className = 'primary';
      wrap.appendChild(btn);
    }
    // Garantierte Flucht-Karten: nur die aktuell kämpfende Person, nur
    // während tatsächlich geflohen werden muss.
    if (guaranteedFleeUsable(c)) {
      const btn = mkBtn(`🛡️ Garantiert entkommen mit "${c.name}"`, () => socket.emit('useGuaranteedFlee', { cardId: id }));
      btn.className = 'primary';
      wrap.appendChild(btn);
    }
    // GEZINKTER WÜRFEL: nur, solange das Reaktionsfenster für genau diese
    // Person offen ist (state.pendingRoll.holders).
    if (state.pendingRoll && state.pendingRoll.holders.includes(myInfo.playerId) && c.name === 'GEZINKTER WÜRFEL') {
      const btn = mkBtn('🎲 Wurf ändern', () => {
        const v = Number(window.prompt('Neues Würfelergebnis (1-6)?', String(state.pendingRoll.roll)));
        if (v >= 1 && v <= 6) socket.emit('playReactionCard', { cardId: id, value: v });
      });
      btn.className = 'primary';
      wrap.appendChild(btn);
    }
    // KLEBERFLÄSCHCHEN: nur, solange das Fluchtreaktionsfenster für genau
    // diese Person offen ist (combat.escapeReactionOffer).
    if (state.combat && (state.combat.escapeReactionOffer || []).includes(myInfo.playerId) && c.name === 'KLEBERFLÄSCHCHEN') {
      const btn = mkBtn('🧪 Kleberfläschchen: Flucht wiederholen lassen', () => socket.emit('playReactionCard', { cardId: id }));
      btn.className = 'primary';
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function isMonsterEnhancer(c) {
    return c.category === 'door_other' && typeof c.bonus === 'number' && c.bonus !== 0 &&
      /für\s+(das\s+)?Monster/i.test(c.text || '');
  }

  // ---------------------------------------------------------------------
  // Client-seitige Spiegel der server.js-Erkenner (server.js bleibt die
  // Quelle der Wahrheit für die tatsächliche Auswirkung - hier geht es nur
  // darum, ob überhaupt ein Knopf angezeigt wird; siehe isMonsterEnhancer
  // oben, das nach demselben Muster funktioniert).
  // ---------------------------------------------------------------------
  const POWER_GROUP_NAMES = new Set([
    'KUNDSCHAFTER', 'NEKROMANT', 'HEXE', 'HÖLLENRITTER', 'ADLERRITTER',
    'PAKTMAGIER', 'ALCHEMIST', 'ASSASSINE DER ROTEN MANTIS',
  ]);
  const TRAIT_CAP_CARD_NAMES = new Set(['HALB-BLUT', 'SUPER MUNCHKIN', 'DOPPELLEBEN']);
  const GUARANTEED_FLEE_NAMES = new Set(['FERTIGMAUER', 'BABY-ÖL', 'DER ANDERE RING', 'RATTE AM SPIESS']);
  // Karten, die nur gegen schwache Monster garantiert wirken - der Server
  // prüft das nochmal, hier wird der Knopf nur gar nicht erst angeboten.
  const GUARANTEED_FLEE_MAX_LEVEL = { 'RATTE AM SPIESS': 8 };

  function guaranteedFleeUsable(c) {
    if (!state.combat || !state.combat.mustFlee) return false;
    if (state.combat.actorId !== myInfo.playerId) return false;
    if (!GUARANTEED_FLEE_NAMES.has(c.name)) return false;
    const max = GUARANTEED_FLEE_MAX_LEVEL[c.name];
    if (typeof max !== 'number') return true;
    return state.combat.monsterIds.every((id) => (card(id).level || 0) <= max);
  }
  // Kuratierte Einzelfälle aus TREASURE_POWER_OVERRIDES (server.js) - Namen
  // müssen mit dort synchron gehalten werden.
  const TREASURE_POWER_NAMES = new Set([
    'KLAUE EINE STUFE', 'SINNIEREN', 'SINNLOSER AKT DER FREUNDLICHKEIT',
    'JAMMER DEN SPIELLEITER AN', 'CHARAKTERSEITEN WECHSELN',
    'ENTE DER VIELEN SACHEN',
    'SCHATZHORT!', 'WÜNSCHELSTAB', 'GEDENKTAFEL', 'WUNSCHRING',
  ]);
  const INSTANT_LEVEL_UP_RE = /^\s*Steige\s+(?:eine|\d+)\s+Stufen?\s+auf\b/i;

  function hasTreasurePower(c) {
    if (!c || c.category !== 'treasure_other') return false;
    if (TREASURE_POWER_NAMES.has(c.name)) return true;
    return INSTANT_LEVEL_UP_RE.test(c.text || '');
  }

  // Tuerkarten mit aktiver Sonderkraft (server.js: DOOR_POWER_CARDS) - Namen
  // muessen dort synchron gehalten werden.
  const DOOR_POWER_NAMES = new Set(['GOTTLICHE INTERVENTION']);

  function hasDoorPower(c) {
    return !!c && DOOR_POWER_NAMES.has(c.name);
  }

  const COMBAT_POTION_NAMES = new Set([
    'FREUNDSCHAFTSTRANK', 'POLLYVERWANDLUNGSTRANK', 'TRANK DER IRRELEVANZ',
    'ENTLASSUNGSGLOCKE', 'CYTILLESH-TRANK', 'TRANK DES MUNDGERUCHS',
    'YUPPIE-WASSER', 'FLÜSSIGKLINGE', 'VERZAUBERARMBAND',
  ]);
  const COMBAT_PLAYABLE_RE = /im\s+Kampf\b|Während\s+(eines\s+)?beliebige[nm]\s+Kampf(es)?\s+spielen/i;

  function combatPotionAmountFound(rawText) {
    const t = String(rawText || '').replace(/\\n/g, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[bi]>/gi, '');
    return /\+\d+\s+für\s+beide\s+Seiten/i.test(t) ||
      /\+\d+[,\s]+(?:für\s+)?(?:eine\s+der\s+Parteien,\s*)?egal[,\s]+(?:für\s+)?welche\s+Seite/i.test(t) ||
      /\+\d+\s+nur\s+für\s+Monster/i.test(t) ||
      /\+\d+\s+für\s+die\s+Munchkin-Seite/i.test(t);
  }

  function isCombatPotion(c) {
    if (!c || c.category !== 'treasure_other') return false;
    if (COMBAT_POTION_NAMES.has(c.name)) return true;
    return COMBAT_PLAYABLE_RE.test(c.text || '') && combatPotionAmountFound(c.text);
  }

  function mkBtn(label, onClick) {
    const b = document.createElement('button');
    b.className = 'small'; b.textContent = label; b.onclick = onClick;
    return b;
  }

  function updateSellBar() {
    // ungültige Auswahl (Karte nicht mehr auf der Hand) entfernen
    for (const id of Array.from(sellSelection)) {
      if (!myInfo.hand.includes(id)) sellSelection.delete(id);
    }
    let sum = 0;
    sellSelection.forEach((id) => { sum += card(id).gold || 0; });
    $('sellSum').textContent = `Ausgewählt: ${sum} Goldstücke`;
    const btn = $('btnSell');
    btn.disabled = sum < 1000;
    btn.onclick = () => {
      socket.emit('sellItems', { cardIds: Array.from(sellSelection) });
      sellSelection.clear();
    };
  }

  function renderLog() {
    const feed = $('logFeed');
    feed.innerHTML = '';
    state.logs.slice().reverse().forEach((l, i) => {
      const div = document.createElement('div');
      div.className = 'logline' + (i === 0 ? ' logline-latest' : '');
      div.appendChild(document.createTextNode(l.text));
      // Bezieht sich der Eintrag auf öffentlich bekannte Karten (z.B. eine
      // aufgedeckte Türkarte), zeigen wir sie als anklickbare Verweise an,
      // die die Karte im Modal aufrufen.
      if (l.cardIds && l.cardIds.length) {
        div.appendChild(document.createTextNode(' '));
        l.cardIds.forEach((id) => {
          const c = cardIndex[id];
          if (!c) return;
          const link = document.createElement('a');
          link.href = '#'; link.className = 'logcardlink';
          link.textContent = `[${c.name}]`;
          link.addEventListener('click', (e) => { e.preventDefault(); openCardModal(id); });
          div.appendChild(link);
          div.appendChild(document.createTextNode(' '));
        });
      }
      feed.appendChild(div);
    });
  }

  // ---------------------------------------------------------------------
  // Karten-Kacheln + Modal
  // ---------------------------------------------------------------------

  function cardImageUrl(id) { return `images/${id}.webp`; }

  function cardTile(id, opts) {
    opts = opts || {};
    const c = card(id);
    const div = document.createElement('div');
    div.className = `cardtile cat-${c.category}${opts.slim ? ' slim' : ''}`;
    let meta = '';
    if (c.category === 'monster') meta = `Stufe ${c.level} | 🎁 ${c.treasureCount || 0}`;
    else if (c.category === 'item') meta = `${c.slotLabel || ''}${c.bonus ? ` +${c.bonus}` : ''}${typeof c.gold === 'number' ? ` | ${c.gold} GS` : ''}`;
    else if (typeof c.gold === 'number') meta = `${c.gold} GS`;

    const imgWrap = document.createElement('div');
    imgWrap.className = 'ctimgwrap';
    const img = document.createElement('img');
    // Kein loading="lazy": die Kacheln sind beim Neuaufbau ohnehin sofort
    // sichtbar, und ein verzoegertes Nachladen liess das (laengst im Cache
    // liegende) Bild bei jedem Re-Render kurz aufblitzen.
    img.className = 'ctimg'; img.alt = '';
    img.src = cardImageUrl(id);
    img.onerror = () => { div.classList.add('noimg'); imgWrap.remove(); };
    imgWrap.appendChild(img);
    div.appendChild(imgWrap);

    const type = document.createElement('span');
    type.className = 'cttype'; type.textContent = CATEGORY_LABELS[c.category] || '';
    div.appendChild(type);

    const body = document.createElement('div');
    body.className = 'ctbody';
    // Der Name wird per CSS auf zwei Zeilen begrenzt (siehe .ctname), damit
    // Extremfaelle wie "DING MIT EINEM ÜBERLANGEN NAMEN, DESSEN BILD NICHT AUF
    // DIE KARTE PASST" die Kachel nicht in die Hoehe ziehen. Vollstaendig
    // lesbar bleibt er im Karten-Modal (Klick auf die Kachel) und im Tooltip.
    body.innerHTML = `<span class="ctname" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>` +
      (meta ? `<span class="ctmeta">${escapeHtml(meta)}</span>` : '');
    div.appendChild(body);

    div.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'LABEL') return;
      openCardModal(id);
    });
    return div;
  }

  // Werte-Zeile fuer die Grossansicht: zeigt nur, was die Karte wirklich hat -
  // eine Monsterkarte hat keinen Slot, ein Schatz keine Stufe. "Grosser
  // Gegenstand" kommt als c.big direkt vom Server mit (siehe ALL_CARDS in
  // server.js), damit hier keine zweite Namensliste gepflegt werden muss.
  function cardValuesHtml(c) {
    const teile = [];
    if (typeof c.level === 'number') teile.push(`Stufe ${c.level}`);
    if (typeof c.treasureCount === 'number') teile.push(`🎁 ${c.treasureCount} Schatz/Schaetze`);
    if (c.slotLabel) teile.push(escapeHtml(c.slotLabel));
    if (c.handsCost) teile.push(`${c.handsCost} Hand${c.handsCost > 1 ? 'e' : ''}`);
    if (c.bonus) teile.push(`${c.bonus > 0 ? '+' : ''}${c.bonus} im Kampf`);
    if (typeof c.gold === 'number' && c.gold > 0) teile.push(`${c.gold} GS`);
    if (c.big) teile.push('📦 <b>Grosser Gegenstand</b>');
    if (!teile.length) return '';
    return `<p class="cardvalues">${teile.join(' &middot; ')}</p>`;
  }

  function openCardModal(id) {
    const c = card(id);
    const img = new Image();
    img.className = 'modalimg';
    img.alt = '';
    img.src = cardImageUrl(id);
    img.onerror = () => img.remove();
    $('cardModalBody').innerHTML = `<h3>${escapeHtml(c.name)}</h3>` +
      `<p class="hint">${CATEGORY_LABELS[c.category] || ''} - ${escapeHtml(c.setLabel || '')}</p>` +
      cardValuesHtml(c) +
      (c.text ? `<p>${formatCardText(c.text)}</p>` : '') +
      (c.badstuff ? `<p><b>Schlimme Dinge:</b> ${formatCardText(c.badstuff)}</p>` : '');
    $('cardModalBody').prepend(img);
    $('cardModal').classList.remove('hidden');
  }
  $('cardModalClose').addEventListener('click', () => $('cardModal').classList.add('hidden'));

  function smallTag(text, color) {
    const span = document.createElement('span');
    span.className = 'tag'; span.style.background = color; span.style.color = 'white';
    span.textContent = text;
    return span;
  }
  function textNode(text) { const s = document.createElement('span'); s.className = 'hint'; s.textContent = text; return s; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  // Kartentexte aus den eigenen Spieldaten enthalten vereinzelt einfache
  // Formatierungs-Tags (<b>, <i>, <br>) - escapen und dann gezielt wieder
  // freigeben, statt sie als sichtbaren Text ("&lt;b&gt;") anzuzeigen. Ein
  // Teil der Texte enthält außerdem ein literales "\n" (Backslash + n, kein
  // echter Zeilenumbruch - ein Artefakt aus der Datenaufbereitung) statt
  // eines <br> - wird hier ebenfalls in einen Zeilenumbruch umgewandelt.
  function formatCardText(s) {
    return escapeHtml(s)
      .replace(/\\n/g, '<br>')
      .replace(/&lt;b&gt;/gi, '<b>').replace(/&lt;\/b&gt;/gi, '</b>')
      .replace(/&lt;i&gt;/gi, '<i>').replace(/&lt;\/i&gt;/gi, '</i>')
      .replace(/&lt;br\s*\/?&gt;/gi, '<br>');
  }
})();
