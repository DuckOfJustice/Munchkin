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

  // -- Handel (Trading) --
  let tradeComposeTargetId = null; // gerade ein neues Angebot an diese Person zusammenstellen
  let tradeComposeSelection = new Set(); // eigene Handkarten, die dabei angeboten werden
  let tradeCounterForId = null; // gerade ein Gegenangebot für dieses eingehende Angebot zusammenstellen
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

  socket.on('connect', () => {
    if (session && session.code) {
      socket.emit('joinRoom', { code: session.code, name: session.name, token: session.token }, (res) => {
        if (!res.ok) { clearSession(); showScreen('start'); return; }
        saveSession({ code: res.code, playerId: res.playerId, token: res.token, name: session.name });
      });
    }
  });

  socket.on('cardIndex', (idx) => { cardIndex = idx; if (state) render(); });
  socket.on('yourInfo', (info) => { myInfo = info; if (state) render(); });
  socket.on('gameState', (s) => { state = s; render(); });

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

    renderPlayerList();
    renderDiscardPeek();
    renderReveal();
    renderCombat();
    renderConsequence();
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

  function renderPlayerList() {
    const box = $('playerList');
    box.innerHTML = '<h3>Spieler:innen</h3>';
    state.players.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'prow clickable' + (p.id === state.turnPlayerId ? ' active-turn' : '');
      const equip = [p.equipped.head, p.equipped.armor, p.equipped.feet, ...p.equipped.hands]
        .filter(Boolean).length;
      row.innerHTML = `<span>${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</span>` +
        `<span>` +
        (p.id === state.turnPlayerId ? '<span class="tag turn">Zug</span> ' : '') +
        (p.id === myInfo.playerId ? '<span class="tag you">Du</span> ' : '') +
        (!p.connected ? '<span class="tag off">offline</span> ' : '') +
        `<span class="tag">Stufe ${p.level}</span> <span class="tag">⚔ ${p.strength}</span> <span class="tag">🎒 ${equip}</span>` +
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
    if (!p.races.length && !p.classes.length) badges.appendChild(textNode('Mensch, ohne Klasse'));
    body.appendChild(badges);

    const equip = document.createElement('div');
    equip.className = 'row gap wrap';
    const slotDefs = [
      ['Kopf', p.equipped.head], ['Rüstung', p.equipped.armor], ['Schuhe', p.equipped.feet],
      ['Hand 1', p.equipped.hands[0]], ['Hand 2', p.equipped.hands[1]],
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

  function tradePickGrid(ids, selection) {
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
      label.appendChild(document.createTextNode(` ${c.name}${typeof c.gold === 'number' ? ` (${c.gold} GS)` : ''}`));
      grid.appendChild(label);
    });
    if (!ids.length) grid.appendChild(textNode('Keine Karten auf der Hand.'));
    return grid;
  }

  function renderTradeArea() {
    const box = $('tradeArea');
    if (!box) return;
    box.innerHTML = '';
    if (!state || state.phase !== 'playing') return;

    if (tradeComposeTargetId) {
      const target = state.players.find((p) => p.id === tradeComposeTargetId);
      if (!target || !target.connected) {
        tradeComposeTargetId = null;
      } else {
        const panel = document.createElement('div');
        panel.className = 'tradebox';
        panel.innerHTML = `<h3>🤝 Handel anbieten an ${escapeHtml(target.name)}</h3>` +
          `<p class="hint">Wähle Karten aus deiner Hand, die du anbietest (Gold- oder andere Karten). ${target.name} entscheidet dann, was sie/er im Gegenzug gibt.</p>`;
        panel.appendChild(tradePickGrid(myInfo.hand, tradeComposeSelection));
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

    (myInfo.incomingTrades || []).forEach((t) => {
      const panel = document.createElement('div');
      panel.className = 'tradebox';
      panel.innerHTML = `<h3>🤝 Handelsangebot von ${escapeHtml(t.fromName)}</h3><p>Bietet an:</p>`;
      const preview = document.createElement('div');
      preview.className = 'row gap wrap';
      t.offerCardIds.forEach((id) => {
        const chip = document.createElement('a');
        chip.href = '#'; chip.className = 'logcardlink';
        chip.textContent = `[${card(id).name}]`;
        chip.onclick = (e) => { e.preventDefault(); openCardModal(id); };
        preview.appendChild(chip);
      });
      panel.appendChild(preview);

      const actions = document.createElement('div');
      actions.className = 'row gap wrap'; actions.style.marginTop = '10px';
      const acceptBtn = mkBtn('Annehmen', () => socket.emit('respondTrade', { tradeId: t.id, accept: true, counterCardIds: [] }));
      acceptBtn.className = 'primary';
      const counterBtn = mkBtn('Annehmen + selbst etwas geben...', () => { tradeCounterForId = t.id; tradeCounterSelection = new Set(); renderTradeArea(); });
      const declineBtn = mkBtn('Ablehnen', () => socket.emit('respondTrade', { tradeId: t.id, accept: false }));
      declineBtn.className = 'danger';
      actions.appendChild(acceptBtn); actions.appendChild(counterBtn); actions.appendChild(declineBtn);
      panel.appendChild(actions);

      if (tradeCounterForId === t.id) {
        panel.appendChild(tradePickGrid(myInfo.hand, tradeCounterSelection));
        const confirmBtn = mkBtn('Gegenangebot bestätigen & annehmen', () => {
          socket.emit('respondTrade', { tradeId: t.id, accept: true, counterCardIds: Array.from(tradeCounterSelection) });
          tradeCounterForId = null; tradeCounterSelection = new Set();
        });
        confirmBtn.className = 'primary'; confirmBtn.style.marginTop = '6px';
        panel.appendChild(confirmBtn);
      }
      box.appendChild(panel);
    });

    (myInfo.outgoingTrades || []).forEach((t) => {
      const panel = document.createElement('div');
      panel.className = 'tradebox';
      const names = t.offerCardIds.map((id) => card(id).name).join(', ');
      panel.innerHTML = `<h3>🤝 Dein Angebot an ${escapeHtml(t.toName)}</h3><p>Du bietest an: <b>${escapeHtml(names)}</b> - wartet auf Antwort...</p>`;
      const cancelBtn = mkBtn('Zurückziehen', () => socket.emit('cancelTrade', { tradeId: t.id }));
      panel.appendChild(cancelBtn);
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
    box.appendChild(div);
  }

  function renderCombat() {
    const box = $('combatArea');
    box.innerHTML = '';
    const c = state.combat;
    if (!c) return;
    const actor = state.players.find((p) => p.id === c.actorId);
    const helper = c.helperId ? state.players.find((p) => p.id === c.helperId) : null;
    const monsterLevel = c.monsterIds.reduce((s, id) => s + (card(id).level || 0), 0);
    const playerStrength = (actor ? actor.strength : 0) + (helper ? helper.strength : 0) + c.actorModifier;
    const monsterStrength = monsterLevel + c.monsterModifier;

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

    const actions = document.createElement('div');
    actions.className = 'row gap wrap';

    if (iAmActor && !c.mustFlee) {
      const evalBtn = document.createElement('button');
      evalBtn.className = 'primary'; evalBtn.textContent = 'Kampf auswerten';
      evalBtn.onclick = () => socket.emit('evaluateCombat');
      actions.appendChild(evalBtn);

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
      ask.innerHTML = `<b>${state.players.find((p) => p.id === c.actorId).name} bittet dich um Hilfe im Kampf!</b>`;
      const yes = document.createElement('button'); yes.textContent = 'Helfen'; yes.className = 'primary';
      yes.onclick = () => socket.emit('respondHelp', { accept: true });
      const no = document.createElement('button'); no.textContent = 'Ablehnen';
      no.onclick = () => socket.emit('respondHelp', { accept: false });
      ask.appendChild(yes); ask.appendChild(no);
      div.appendChild(ask);
    }

    if (iAmActor && c.mustFlee) {
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

  function equippedIdsOf(p) {
    if (!p) return [];
    return [p.equipped.head, p.equipped.armor, p.equipped.feet, ...p.equipped.hands].filter(Boolean);
  }

  function renderPhaseActions() {
    const box = $('phaseActions');
    box.innerHTML = '';
    if (state.phase === 'gameend' || state.combat || state.pendingConsequence) return;
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
      const over = myPlayer ? myInfo.hand.length - 5 : 0;
      if (over > 0) {
        box.appendChild(textNode(`Milde Gabe: bitte noch ${over} Karte(n) ablegen (max. 5 auf der Hand).`));
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
    if (!p.races.length && !p.classes.length) badges.appendChild(textNode('Mensch, ohne Klasse'));

    const equip = $('myEquip');
    equip.innerHTML = '';
    const slotDefs = [
      ['head', 'Kopf', p.equipped.head],
      ['armor', 'Rüstung', p.equipped.armor],
      ['feet', 'Schuhe', p.equipped.feet],
      ['hand1', 'Hand 1', p.equipped.hands[0]],
      ['hand2', 'Hand 2', p.equipped.hands[1]],
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

  function renderHand(p) {
    const box = $('myHand');
    box.innerHTML = '';
    myInfo.hand.forEach((id) => {
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

    const myTurn = isMyTurn() && state.turnPhase && !state.combat && !state.pendingConsequence;

    if (c.category === 'item' && myTurn) {
      const btn = mkBtn('Anlegen', () => socket.emit('equipItem', { cardId: id }));
      wrap.appendChild(btn);
    }
    if (c.category === 'monster' && myTurn && state.turnPhase === 'aerger') {
      const btn = mkBtn('Als Monster spielen', () => socket.emit('playMonsterFromHand', { cardId: id }));
      wrap.appendChild(btn);
    }
    if ((c.category === 'race' || c.category === 'class') && myTurn) {
      const btn = mkBtn('Spielen', () => socket.emit('playRaceOrClass', { cardId: id }));
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
    return wrap;
  }

  function isMonsterEnhancer(c) {
    return c.category === 'door_other' && typeof c.bonus === 'number' && c.bonus !== 0 &&
      /für\s+(das\s+)?Monster/i.test(c.text || '');
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
    img.className = 'ctimg'; img.loading = 'lazy'; img.alt = '';
    img.src = cardImageUrl(id);
    img.onerror = () => { div.classList.add('noimg'); imgWrap.remove(); };
    imgWrap.appendChild(img);
    div.appendChild(imgWrap);

    const type = document.createElement('span');
    type.className = 'cttype'; type.textContent = CATEGORY_LABELS[c.category] || '';
    div.appendChild(type);

    const body = document.createElement('div');
    body.className = 'ctbody';
    body.innerHTML = `<span class="ctname">${escapeHtml(c.name)}</span>` +
      (meta ? `<span class="ctmeta">${escapeHtml(meta)}</span>` : '');
    div.appendChild(body);

    div.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'LABEL') return;
      openCardModal(id);
    });
    return div;
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
