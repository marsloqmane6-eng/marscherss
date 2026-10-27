/* MarsChess online lobby, matchmaking, live games, clocks, draw offers, and chat. */
(function () {
  'use strict';

  const MC = window.MC;
  const E = MC.E;
  const state = MC.state;

  state.online.flipped = false;
  state.online.zeroPollAt = 0;
  state.online.pollAt = 0;
  state.online.sseErrorAt = 0;
  state.online.modalFor = null;

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  function parseEvent(event) {
    try { return JSON.parse(event.data || '{}'); } catch (e) { return {}; }
  }

  function myColor(game) {
    if (!game || !state.user) return 0;
    if (game.white && Number(game.white.id) === Number(state.user.id)) return 1;
    if (game.black && Number(game.black.id) === Number(state.user.id)) return -1;
    return 0;
  }

  function isPlayer(game) {
    return myColor(game) !== 0;
  }

  function opponentPlayer(game, my) {
    if (!game || !my) return null;
    return my === 1 ? game.black : game.white;
  }

  function setGameClock(game) {
    if (!game) { state.online.clock = null; return; }
    state.online.clock = {
      whiteMs: Number(game.whiteMs) || 0,
      blackMs: Number(game.blackMs) || 0,
      lastMoveAt: Number(game.lastMoveAt) || Date.now(),
      serverNow: Number(game.serverNow) || Date.now(),
      receivedAt: Date.now()
    };
  }

  function onlineClockValues() {
    const game = state.online.game;
    if (!game) return { whiteMs: 0, blackMs: 0 };
    if (game.status !== 'active' || !state.online.clock) {
      return { whiteMs: Number(game.whiteMs) || 0, blackMs: Number(game.blackMs) || 0 };
    }
    const c = state.online.clock;
    const elapsed = Math.max(0, (c.serverNow - c.lastMoveAt) + (Date.now() - c.receivedAt));
    if (game.turn === 1) {
      return { whiteMs: Math.max(0, c.whiteMs - elapsed), blackMs: c.blackMs };
    }
    return { whiteMs: c.whiteMs, blackMs: Math.max(0, c.blackMs - elapsed) };
  }

  function updateOnlineCount(count) {
    if (!Number.isFinite(Number(count))) return;
    const n = Number(count);
    if (!state.stats) state.stats = { users: 0, games: 0, activeGames: 0, online: n, queued: 0 };
    state.stats.online = n;
    MC.$$('[data-online-count]').forEach(el => { el.textContent = MC.formatNumber(n); });
    MC.$$('[data-live-count]').forEach(el => { el.textContent = `${MC.formatNumber(n)} online`; });
  }

  function updateOnlineClockDom() {
    const game = state.online.game;
    if (!game) return;
    const values = onlineClockValues();
    for (const color of ['white', 'black']) {
      const el = document.querySelector(`[data-online-clock="${color}"]`);
      if (!el) continue;
      const ms = color === 'white' ? values.whiteMs : values.blackMs;
      el.textContent = MC.formatClock(ms);
      el.classList.toggle('low', ms < 20_000);
      el.classList.toggle('active', game.status === 'active' && game.turn === (color === 'white' ? 1 : -1));
    }
  }

  function drawBannerHtml(game) {
    if (!game || game.status !== 'active' || !game.drawOfferBy) return '';
    const mine = state.user && Number(game.drawOfferBy) === Number(state.user.id);
    if (mine) {
      return `<div class="draw-banner"><span class="db-icon">½</span><span class="db-copy">Draw offer sent. Waiting for your opponent.</span></div>`;
    }
    return `<div class="draw-banner"><span class="db-icon">½</span><span class="db-copy">Your opponent offers a draw.</span><span class="db-actions"><button type="button" class="btn btn-green btn-sm" data-action="online-draw-accept">Accept</button><button type="button" class="btn btn-secondary btn-sm" data-action="online-draw-decline">Decline</button></span></div>`;
  }

  function chatMessagesHtml() {
    if (!state.online.chat.length) return '<div class="chat-empty">No messages yet. Say hello — both players can see the chat.</div>';
    return state.online.chat.map(msg => {
      const mine = state.user && msg.user && Number(msg.user.id) === Number(state.user.id);
      const time = new Date(Number(msg.createdAt) || Date.now());
      const hh = String(time.getHours()).padStart(2, '0');
      const mm = String(time.getMinutes()).padStart(2, '0');
      return `<div class="chat-msg ${mine ? 'mine' : ''}"><span class="who">${MC.escapeHtml(msg.user ? msg.user.username : 'Player')}</span>: ${MC.escapeHtml(msg.text)}<span class="chat-time">${hh}:${mm}</span></div>`;
    }).join('');
  }

  function scrollChatToBottom() {
    const box = MC.byId('chatMessages');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function renderChat() {
    const box = MC.byId('chatMessages');
    if (box) box.innerHTML = chatMessagesHtml();
    scrollChatToBottom();
  }

  function addChatMessage(message) {
    if (!message || !message.id) return;
    if (state.online.chat.some(m => Number(m.id) === Number(message.id))) return;
    state.online.chat.push(message);
    if (state.online.chat.length > 120) state.online.chat = state.online.chat.slice(-120);
    renderChat();
  }

  // -------------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------------

  function lobbyQueueHtml() {
    const queue = state.online.queue;
    if (!queue) return '';
    const tc = MC.timeControl(queue.timeControl);
    const position = queue.position ? ` · position #${queue.position}` : '';
    return `<div class="queue-panel" id="lobbyQueue">
      <div class="queue-copy"><h3>Searching for a ${tc.label} ${tc.name} opponent…</h3><p>${MC.formatNumber(state.stats && state.stats.online || 0)} online${position}. We will start as soon as a match is found.</p></div>
      <div class="queue-clock" data-queue-clock>${MC.formatDuration(Math.max(0, (Date.now() - (state.online.queueSince || Date.now())) / 1000))}</div>
      <button type="button" class="btn btn-secondary" data-action="cancel-queue">Cancel search</button>
    </div>`;
  }

  function timeCardHtml(tc, lobby, user, activeGameId) {
    const queued = state.online.queue && state.online.queue.timeControl === tc.id;
    const waiting = Number(lobby.queues && lobby.queues[tc.id] || 0);
    const inc = tc.incMs ? ` · +${tc.incMs / 1000}s` : '';
    let action;
    if (queued) {
      action = `<button type="button" class="btn btn-green btn-sm" data-action="cancel-queue">Searching · Cancel</button>`;
    } else if (activeGameId) {
      action = `<button type="button" class="btn btn-secondary btn-sm" disabled>Game in progress</button>`;
    } else {
      action = `<button type="button" class="btn btn-primary btn-sm" data-action="queue" data-tc="${tc.id}">Play</button>`;
    }
    return `<article class="time-card">
      <div class="tc-top"><span class="tc-icon">${tc.icon}</span><span class="badge">${tc.name}</span></div>
      <div class="tc-main"><div class="tc-big">${tc.label}</div><div class="tc-type">${tc.name}${inc}</div></div>
      <div class="tc-count">${waiting} waiting now</div>
      ${action}
    </article>`;
  }

  function playerOnlineHtml(user) {
    return `<div class="online-player">
      <span class="op-avatar">${MC.escapeHtml(MC.initials(user.username))}</span>
      <span class="op-main"><span class="op-name">${MC.escapeHtml(user.username)}</span><span class="op-rating">${MC.formatNumber(user.rating)} Elo</span></span>
      <span class="op-live"></span>
    </div>`;
  }

  function renderLobbyMarkup(lobby, meData) {
    const user = state.user;
    const online = lobby.online || [];
    const count = Number(lobby.count || 0);
    const activeGameId = meData && meData.activeGameId || (state.me && state.me.activeGameId) || null;
    const queue = state.online.queue;
    const players = online.slice(0, 12).map(playerOnlineHtml).join('');
    MC.setView(`
      <div class="lobby-page">
        <section class="lobby-hero">
          <div>
            <span class="eyebrow">Live arena</span>
            <h1>Find your next rival.</h1>
            <p>Choose a time control and get matched with another human. Every move is checked by the server, both clocks are authoritative, and ratings update after the game.</p>
          </div>
          <div class="live-pill"><span class="pulse"></span><span data-live-count>${MC.formatNumber(count)} online</span></div>
        </section>

        ${activeGameId ? `<div class="active-game-banner"><div class="ag-icon">♞</div><div class="ag-copy"><h3>Your online game is still live</h3><p>The clock is running. Return to the board to continue.</p></div><a class="btn btn-green btn-sm" href="#game/${activeGameId}">Resume game</a></div>` : ''}

        ${!user ? `<div class="lobby-login">
          <div><h3>Sign in to play rated games</h3><p>Online matchmaking, server clocks, chat, and Elo ratings are available with a free account.</p></div>
          <div class="actions"><a class="btn btn-secondary" href="#auth">Sign in</a><a class="btn btn-primary" href="#auth/register">Create account</a></div>
        </div>` : ''}

        <div id="lobbyQueueSlot">${lobbyQueueHtml()}</div>

        <section>
          <div class="section-head">
            <div><span class="eyebrow">Time controls</span><h2>How fast do you want to play?</h2><p>${queue ? 'You are currently in the matchmaking queue.' : 'Pick a format. You can switch queues at any time.'}</p></div>
            <button type="button" class="btn btn-ghost btn-sm" data-action="refresh-online">↻ Refresh</button>
          </div>
          <div class="time-grid">
            ${MC.TIME_CONTROLS.map(tc => timeCardHtml(tc, lobby, user, activeGameId)).join('')}
          </div>
        </section>

        <div class="online-panel-grid">
          <section class="panel panel-pad">
            <div class="panel-head"><h2 class="panel-title"><span class="dot"></span>Players online</h2><span class="badge green">${MC.formatNumber(online.length)}</span></div>
            ${players ? `<div class="online-player-grid">${players}</div>` : '<div class="lobby-empty">No other players are connected right now. Queue up and the next arrival will find you.</div>'}
          </section>
          <section class="panel panel-pad">
            <div class="panel-head"><h2 class="panel-title">How online play works</h2></div>
            <div class="stack" style="gap:9px">
              <div class="game-over-note green"><span class="go-icon">◉</span><span><strong>Server-authoritative</strong>Moves, clocks, and results are validated on the server.</span></div>
              <div class="game-over-note"><span class="go-icon">½</span><span><strong>Draws and resignations</strong>Both players can offer a draw, resign, or abort before two moves.</span></div>
              <div class="game-over-note"><span class="go-icon">▤</span><span><strong>Post-game review</strong>After the game, run a Stockfish review with accuracy and key moments.</span></div>
            </div>
          </section>
        </div>
      </div>`);
    updateOnlineCount(count);
    scrollChatToBottom();
  }

  async function loadLobby(showLoading) {
    if (showLoading) MC.renderLoading('Finding the live arena…');
    const token = state.pageToken;
    let lobby = state.online.lobby || { online: [], count: state.stats && state.stats.online || 0, queues: {} };
    let meData = state.me;
    try {
      const tasks = [MC.api('/api/online')];
      if (state.user) tasks.push(MC.api('/api/me'));
      const results = await Promise.all(tasks);
      lobby = results[0] || lobby;
      meData = results[1] || state.me;
      if (meData) {
        state.me = meData;
        state.user = meData.user || state.user;
        if (meData.queue) {
          state.online.queue = meData.queue;
          state.online.queueSince = Date.now() - Number(meData.queue.elapsed || 0) * 1000;
        } else if (state.online.queue && !state.online.privateQueueAction) {
          state.online.queue = null;
          state.online.queueSince = 0;
        }
        MC.updateNav();
      }
      state.online.lobby = lobby;
      if (lobby.online) state.online.onlineUsers = lobby.online;
      updateOnlineCount(lobby.count);
    } catch (e) {
      if (e.status === 401) {
        state.user = null;
        state.me = null;
        MC.updateNav();
      } else if (showLoading) {
        MC.toast(e.message || 'Could not load the online lobby.', 'error');
      }
    }
    if (token !== state.pageToken) return;
    renderLobbyMarkup(lobby, meData);
  }

  async function renderOnlineLobbyPage(route, token) {
    await loadLobby(!state.online.lobby);
  }

  async function refreshLobbyData() {
    if (state.route !== 'online') return;
    await loadLobby(false);
  }

  function updateQueueClockDom() {
    const el = document.querySelector('[data-queue-clock]');
    if (!el || !state.online.queue) return;
    const seconds = Math.max(0, (Date.now() - (state.online.queueSince || Date.now())) / 1000);
    el.textContent = MC.formatDuration(seconds);
  }

  // -------------------------------------------------------------------------
  // Online game rendering
  // -------------------------------------------------------------------------

  function onlinePlayerCard(color, game, flipped) {
    const player = color === 1 ? game.white : game.black;
    const isUser = state.user && Number(player.id) === Number(state.user.id);
    const clockValues = onlineClockValues();
    const clockMs = color === 1 ? clockValues.whiteMs : clockValues.blackMs;
    const active = game.status === 'active' && game.turn === color;
    const low = clockMs < 20_000;
    const captured = MC.capturedHtml(E.fromFEN(game.fen), color);
    const opponentOffline = !isUser && isPlayer(game) && !state.online.opponentOnline;
    return `<div class="player-card ${isUser ? 'you' : ''} ${opponentOffline ? 'offline' : ''}" data-player-card="${color === 1 ? 'white' : 'black'}">
      <div class="player-avatar ${isUser ? '' : 'dark'}">${MC.escapeHtml(MC.initials(player.username))}</div>
      <div class="player-main">
        <div class="player-topline">
          <span class="player-name">${MC.escapeHtml(player.username)}</span>
          ${isUser ? '<span class="badge green">You</span>' : '<span class="connection-dot ' + (state.online.opponentOnline ? '' : 'off') + '"></span>'}
        </div>
        <div class="player-meta"><span>${MC.formatNumber(player.rating)} Elo</span><span class="sep">·</span><span>${color === 1 ? 'White' : 'Black'}</span></div>
        <div class="player-captured">${captured}</div>
      </div>
      <span class="clock ${active ? 'active' : ''} ${low ? 'low' : ''}" data-online-clock="${color === 1 ? 'white' : 'black'}">${MC.formatClock(clockMs)}</span>
    </div>`;
  }

  function onlineActionsHtml(game, my) {
    if (game.status === 'active') {
      if (!isPlayer(game)) {
        return `<div class="spectator-note">You are spectating this game. The board updates automatically.</div>
          <div class="game-actions" style="margin-top:8px"><button type="button" class="btn btn-secondary wide" data-action="online-flip">⇅ Flip board</button></div>`;
      }
      return `<div class="game-actions">
        <button type="button" class="btn btn-secondary" data-action="online-draw" ${state.online.submitting ? 'disabled' : ''}>½ Offer draw</button>
        <button type="button" class="btn btn-danger" data-action="online-resign" ${state.online.submitting ? 'disabled' : ''}>⚑ Resign</button>
        ${game.moves.length < 2 ? `<button type="button" class="btn btn-ghost wide" data-action="online-abort" ${state.online.submitting ? 'disabled' : ''}>Abort game</button>` : ''}
        <button type="button" class="btn btn-ghost ${game.moves.length < 2 ? '' : 'wide'}" data-action="online-flip">⇅ Flip board</button>
      </div>`;
    }
    return `<div class="game-actions">
      <button type="button" class="btn btn-primary wide" data-action="review-online" data-id="${game.id}">▤ Game review</button>
      <a class="btn btn-secondary wide" href="#online">Find a new opponent</a>
      <button type="button" class="btn btn-ghost wide" data-action="online-flip">⇅ Flip board</button>
    </div>`;
  }

  function renderOnlineGame() {
    const game = state.online.game;
    if (!game) return;
    const boardState = E.fromFEN(game.fen);
    const my = myColor(game);
    const flipped = Boolean(state.online.flipped);
    const topColor = flipped ? 1 : -1;
    const bottomColor = flipped ? -1 : 1;
    const last = game.moves.length ? MC.uciToSquares(game.moves[game.moves.length - 1].uci) : null;
    const canMove = game.status === 'active' && my !== 0 && game.turn === my && !state.online.submitting;
    const inCheck = E.inCheck(boardState, boardState.turn);
    const previousChat = document.getElementById('chatInput') ? document.getElementById('chatInput').value : '';
    const chatFocused = document.activeElement && document.activeElement.id === 'chatInput';
    const statusText = game.status === 'active'
      ? my === 0 ? `${game.turn === 1 ? game.white.username : game.black.username} to move` : game.turn === my ? (inCheck ? 'Your move — you are in check.' : 'Your move.') : (inCheck ? 'Opponent is in check.' : "Opponent's move.")
      : game.result || MC.resultText(game);
    const moveStatus = game.status === 'active' ? (state.online.submitting ? 'Sending move…' : statusText) : statusText;
    const opponent = opponentPlayer(game, my);

    MC.setView(`
      <div class="online-page">
        <div class="page-topline">
          <div>
            <span class="eyebrow">Rated online game</span>
            <h1>${game.status === 'active' ? 'Live game' : 'Game complete'} <span class="muted" style="font-size:.78rem;font-weight:600">#${game.id}</span></h1>
            <p>${MC.escapeHtml(MC.timeControlLabel(game.timeControl))} ${MC.timeControlName(game.timeControl)} · ${my ? 'You are ' + (my === 1 ? 'White' : 'Black') : 'Spectating'}</p>
          </div>
          <div class="row wrap">
            ${isPlayer(game) && opponent ? `<span class="badge ${state.online.opponentOnline ? 'green' : 'red'}">${state.online.opponentOnline ? 'Opponent online' : 'Opponent offline'}</span>` : ''}
            <a class="btn btn-ghost btn-sm" href="#online">← Lobby</a>
          </div>
        </div>

        <div class="online-game-layout">
          <div class="online-board-column">
            ${onlinePlayerCard(topColor, game, flipped)}
            <div class="board-shell"><div id="onlineBoard"></div></div>
            ${onlinePlayerCard(bottomColor, game, flipped)}
            <div class="game-info-line">
              <span class="left">${game.status === 'active' ? `<span class="connection-dot ${state.online.opponentOnline ? '' : 'off'}"></span>${MC.escapeHtml(moveStatus)}` : `Game over · ${MC.escapeHtml(statusText)}`}</span>
              <span>${game.moves.length} move${game.moves.length === 1 ? '' : 's'} · ${MC.timeControlLabel(game.timeControl)}</span>
            </div>
          </div>

          <aside class="online-side">
            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title"><span class="dot"></span>${game.status === 'active' ? 'Game clock' : 'Result'}</h2><span class="badge ${game.status === 'active' ? 'green' : 'orange'}">${MC.escapeHtml(MC.timeControlName(game.timeControl))}</span></div>
              <div class="game-status">${MC.escapeHtml(statusText)}</div>
              <div id="onlineDrawBanner" style="margin:8px 0 0">${drawBannerHtml(game)}</div>
              <div class="move-list" id="onlineMoveList" style="margin-top:9px">${MC.movesGridHtml(game.moves, game.moves.length)}</div>
              <div style="margin-top:11px">${onlineActionsHtml(game, my)}</div>
            </section>

            <section class="panel panel-pad chat-panel">
              <div class="panel-head"><h2 class="panel-title">Chat</h2><span class="badge grey">Visible to both players</span></div>
              <div class="chat-messages" id="chatMessages">${chatMessagesHtml()}</div>
              <form class="chat-form" data-form="chat">
                <input class="input" id="chatInput" name="text" maxlength="300" autocomplete="off" placeholder="Send a message…" aria-label="Chat message">
                <button class="btn btn-primary" type="submit">Send</button>
              </form>
            </section>

            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title">Game details</h2></div>
              <div class="stack" style="gap:7px;color:var(--muted);font-size:.78rem">
                <div class="row-between"><span>Time control</span><strong style="color:var(--text-soft)">${MC.timeControlLabel(game.timeControl)}</strong></div>
                <div class="row-between"><span>Rating</span><strong style="color:var(--text-soft)">${game.status === 'aborted' ? 'Unrated' : 'Rated'}</strong></div>
                <div class="row-between"><span>Opponent</span><strong style="color:var(--text-soft)">${MC.escapeHtml(opponent ? opponent.username : 'Spectator view')}</strong></div>
              </div>
            </section>
          </aside>
        </div>
      </div>`);

    const boardEl = MC.byId('onlineBoard');
    if (boardEl) {
      state.online.board = new MC.Board(boardEl, {
        state: boardState,
        flipped,
        interactive: canMove,
        lastMove: last,
        onMove: submitOnlineMove,
        onPromotion: MC.promotionModal,
        theme: state.settings.boardTheme
      });
    }
    updateOnlineClockDom();
    const moveList = MC.byId('onlineMoveList');
    if (moveList) moveList.scrollTop = moveList.scrollHeight;
    renderChat();
    const input = MC.byId('chatInput');
    if (input) {
      input.value = previousChat;
      if (chatFocused) input.focus({ preventScroll: true });
    }
  }

  async function renderOnlineGamePage(route, token) {
    const id = Number(route.param);
    if (!state.user) {
      state.auth.redirect = `#game/${id || ''}`;
      MC.navigate('#auth');
      return;
    }
    if (!id) {
      MC.navigate('#online');
      return;
    }
    const same = state.online.game && Number(state.online.game.id) === id;
    if (!same) MC.renderLoading('Connecting to the game…');
    if (same) {
      state.online.gameId = id;
      renderOnlineGame();
    }
    try {
      const data = await MC.api('/api/games/' + id);
      if (token !== state.pageToken) return;
      const game = data.game;
      if (!game) throw new Error('Game not found.');
      state.online.game = game;
      state.online.gameId = id;
      state.online.chat = game.chat || state.online.chat || [];
      state.online.resultShown = game.status !== 'active';
      state.online.submitting = false;
      state.online.flipped = myColor(game) === -1;
      state.online.zeroPollAt = 0;
      setGameClock(game);
      if (state.me) state.me.activeGameId = game.status === 'active' ? game.id : null;
      renderOnlineGame();
      if (MC.connectEvents) MC.connectEvents();
    } catch (e) {
      if (token !== state.pageToken) return;
      if (e.status === 401) {
        state.auth.redirect = `#game/${id}`;
        MC.navigate('#auth');
        return;
      }
      if (e.status === 404) MC.renderError('Game not found', 'That game may have been removed or the link is incorrect.', '♞');
      else MC.renderError('Could not open the game', e.message || 'Please try again.');
    }
  }

  // -------------------------------------------------------------------------
  // Game actions
  // -------------------------------------------------------------------------

  async function submitOnlineMove(move) {
    const game = state.online.game;
    if (!game || game.status !== 'active' || state.online.submitting) return;
    const color = myColor(game);
    if (!color || game.turn !== color) return;
    const uci = E.moveToUci(move);
    state.online.submitting = true;
    renderOnlineGame();
    try {
      const res = await MC.api(`/api/games/${game.id}/move`, { method: 'POST', body: { uci } });
      state.online.submitting = false;
      if (res.game) applyIncomingGame(res.game, { fromMove: true });
      else await reloadCurrentGame();
      MC.playSound('move');
    } catch (e) {
      state.online.submitting = false;
      if (e.data && e.data.game) applyIncomingGame(e.data.game, { fromMove: true });
      else await reloadCurrentGame();
      MC.toast(e.message || 'That move was not accepted.', 'error');
    }
  }

  async function reloadCurrentGame() {
    const game = state.online.game;
    if (!game) return;
    try {
      const data = await MC.api('/api/games/' + game.id);
      if (data.game) applyIncomingGame(data.game, { fromMove: false });
    } catch (e) {
      console.warn(e);
    }
  }

  async function gameAction(path, body) {
    const game = state.online.game;
    if (!game) return null;
    state.online.submitting = true;
    try {
      const res = await MC.api(`/api/games/${game.id}/${path}`, { method: 'POST', body });
      state.online.submitting = false;
      if (res.game) applyIncomingGame(res.game, { fromMove: true });
      return res;
    } catch (e) {
      state.online.submitting = false;
      if (e.data && e.data.game) applyIncomingGame(e.data.game, { fromMove: false });
      MC.toast(e.message || 'The action could not be completed.', 'error');
      return null;
    }
  }

  MC.actions.queue = async el => {
    if (!state.user) {
      state.auth.redirect = '#online';
      MC.navigate('#auth');
      return;
    }
    const tc = el.dataset.tc;
    if (!MC.TIME_MAP[tc]) return;
    el.disabled = true;
    try {
      const res = await MC.api('/api/online/queue', { method: 'POST', body: { timeControl: tc } });
      if (res.activeGameId) {
        state.online.queue = null;
        state.online.queueSince = 0;
        MC.navigate('#game/' + res.activeGameId);
        return;
      }
      if (res.queue) {
        state.online.queue = res.queue;
        state.online.queueSince = Date.now() - Number(res.queue.elapsed || 0) * 1000;
        MC.toast(res.queued ? `Searching for a ${MC.timeControl(tc).label} opponent…` : 'You are already in a game.', res.queued ? 'info' : 'error');
      } else {
        state.online.queue = null;
        state.online.queueSince = 0;
      }
      await refreshLobbyData();
    } catch (e) {
      MC.toast(e.message || 'Could not join the queue.', 'error');
      await refreshLobbyData();
    } finally {
      el.disabled = false;
    }
  };

  MC.actions['cancel-queue'] = async () => {
    try {
      await MC.api('/api/online/cancel', { method: 'POST' });
      state.online.queue = null;
      state.online.queueSince = 0;
      MC.toast('Search cancelled.', 'info');
      await refreshLobbyData();
    } catch (e) {
      MC.toast(e.message || 'Could not cancel the search.', 'error');
    }
  };

  MC.actions['refresh-online'] = () => refreshLobbyData();

  MC.actions['online-flip'] = () => {
    state.online.flipped = !state.online.flipped;
    if (state.route === 'game' && state.online.game) renderOnlineGame();
  };

  MC.actions['online-draw'] = async () => {
    const res = await gameAction('draw', { action: 'offer' });
    if (res) MC.toast('Draw offered.', 'info');
  };

  MC.actions['online-draw-accept'] = async () => {
    const res = await gameAction('draw', { action: 'accept' });
    if (res) MC.toast('Draw accepted.', 'success');
  };

  MC.actions['online-draw-decline'] = async () => {
    const res = await gameAction('draw', { action: 'decline' });
    if (res) MC.toast('Draw declined.', 'info');
  };

  MC.actions['online-resign'] = async () => {
    const ok = await MC.confirm({
      title: 'Resign this game?',
      message: 'Your opponent will receive the win and the game will be rated.',
      confirmLabel: 'Resign',
      danger: true
    });
    if (!ok) return;
    const res = await gameAction('resign');
    if (res) MC.playSound('end');
  };

  MC.actions['online-abort'] = async () => {
    const ok = await MC.confirm({
      title: 'Abort this game?',
      message: 'The game will be aborted and no rating will be awarded. This is only available before two moves.',
      confirmLabel: 'Abort game',
      danger: true
    });
    if (!ok) return;
    const res = await gameAction('abort');
    if (res) MC.playSound('end');
  };

  MC.actions['review-online'] = el => {
    const id = el.dataset.id || (state.online.game && state.online.game.id);
    if (!id) return;
    MC.closeModal();
    MC.navigate('#review/' + id);
  };

  MC.forms.chat = async form => {
    const game = state.online.game;
    if (!game) return;
    const input = form.querySelector('[name="text"]');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    if (text.length > 300) {
      MC.toast('Messages must be 300 characters or fewer.', 'error');
      return;
    }
    input.value = '';
    try {
      const res = await MC.api(`/api/games/${game.id}/chat`, { method: 'POST', body: { text } });
      if (res.message) addChatMessage(res.message);
    } catch (e) {
      input.value = text;
      MC.toast(e.message || 'Could not send the message.', 'error');
    }
  };

  // -------------------------------------------------------------------------
  // SSE / incoming games
  // -------------------------------------------------------------------------

  function applyIncomingGame(game, options) {
    if (!game) return;
    options = options || {};
    const routeGameId = state.route === 'game' ? Number(state.routeParam) : null;
    const isCurrent = routeGameId !== null && Number(game.id) === routeGameId;
    const previous = isCurrent && state.online.game && Number(state.online.game.id) === Number(game.id) ? state.online.game : null;
    const wasActive = previous && previous.status === 'active';

    if (state.me) {
      if (game.status === 'active') state.me.activeGameId = game.id;
      else if (Number(state.me.activeGameId) === Number(game.id)) state.me.activeGameId = null;
    }

    if (!isCurrent) {
      if (state.route === 'online' && game.status === 'active' && state.user) refreshLobbyData();
      if (game.status !== 'active') setTimeout(() => MC.refreshMe(), 300);
      return;
    }

    const chat = game.chat || state.online.chat;
    state.online.game = game;
    state.online.gameId = game.id;
    state.online.chat = chat || [];
    state.online.drawOffer = game.drawOfferBy ? game.drawOfferBy : null;
    state.online.submitting = false;
    state.online.zeroPollAt = 0;
    setGameClock(game);

    if (game.status !== 'active') {
      const shouldShow = wasActive && !state.online.resultShown;
      state.online.resultShown = true;
      if (shouldShow) {
        state.online.modalFor = game.id;
        setTimeout(() => showOnlineGameOver(game), 220);
      }
      setTimeout(() => MC.refreshMe(), 350);
    } else {
      state.online.resultShown = false;
    }
    renderOnlineGame();
  }

  function showOnlineGameOver(game) {
    if (!game) return;
    const my = myColor(game);
    const draw = game.status === 'draw';
    const aborted = game.status === 'aborted';
    const won = my === 1 ? game.status === 'white_win' : my === -1 ? game.status === 'black_win' : false;
    const lost = my === 1 ? game.status === 'black_win' : my === -1 ? game.status === 'white_win' : false;
    const title = aborted ? 'Game aborted.' : draw ? 'Draw — a fair result.' : won ? 'You won!' : lost ? 'You lost.' : MC.resultText(game);
    const icon = aborted ? '—' : draw ? '½' : won ? '♛' : '☄';
    const reason = game.reason ? ` by ${String(game.reason).replace(/-/g, ' ')}` : '';
    const myRating = my === 1 ? game.white && game.white.rating : my === -1 ? game.black && game.black.rating : null;
    MC.openModal(`
      <div class="result-title"><div class="result-icon">${icon}</div><div><h2>${MC.escapeHtml(title)}</h2><div class="result-score">${MC.escapeHtml(MC.resultText(game))}${game.reason ? '' : ''} · ${MC.moveCount(game.moves.length)}</div></div></div>
      <p style="margin-top:10px">${aborted ? 'No rating was awarded. Start another game when you are ready.' : draw ? 'Neither side broke through. Review the game to find the turning point.' : won ? 'Your rating has been updated. Review the game to see your best moves.' : 'Your rating has been updated. Review the game and find where it slipped away.'}</p>
      ${my && !aborted && myRating != null ? `<div class="review-result-strip" style="margin-top:12px"><span>New rating</span><strong>${MC.formatNumber(myRating)}</strong><span class="badge green">Rated</span></div>` : ''}
      <div class="result-actions">
        <button type="button" class="btn btn-primary" data-action="review-online" data-id="${game.id}">▤ Game review</button>
        <a class="btn btn-secondary" href="#online">Find a new opponent</a>
        <button type="button" class="btn btn-ghost" data-action="close-modal">Close</button>
      </div>`);
  }

  function handleSseGame(game) {
    if (!game) return;
    const routeGameId = state.route === 'game' ? Number(state.routeParam) : null;
    if (routeGameId !== null && Number(game.id) === routeGameId) {
      applyIncomingGame(game, { fromSse: true });
      return;
    }
    if (state.me) {
      if (game.status === 'active') state.me.activeGameId = game.id;
      else if (Number(state.me.activeGameId) === Number(game.id)) state.me.activeGameId = null;
    }
    if (state.route === 'online' && game.status === 'active') refreshLobbyData();
    if (game.status !== 'active') setTimeout(() => MC.refreshMe(), 300);
  }

  MC.connectEvents = function () {
    if (!state.user) return;
    if (state.sse && state.sse.readyState !== EventSource.CLOSED) return;
    if (state.sse) {
      try { state.sse.close(); } catch (e) {}
    }
    const source = new EventSource('/api/events');
    state.sse = source;
    source.addEventListener('connected', event => {
      const data = parseEvent(event);
      if (data.user) {
        state.user = Object.assign({}, state.user, data.user);
        MC.updateNav();
      }
    });
    source.addEventListener('online_count', event => {
      const data = parseEvent(event);
      updateOnlineCount(data.count);
    });
    source.addEventListener('queued', event => {
      const data = parseEvent(event);
      if (!data.queued) { state.online.queue = null; state.online.queueSince = 0; }
      else {
        state.online.queue = data;
        state.online.queueSince = Date.now() - Number(data.elapsed || 0) * 1000;
      }
      if (state.route === 'online') refreshLobbyData();
    });
    source.addEventListener('queue_cancelled', () => {
      state.online.queue = null;
      state.online.queueSince = 0;
      if (state.route === 'online') refreshLobbyData();
    });
    source.addEventListener('matched', event => {
      const data = parseEvent(event);
      if (!data.gameId) return;
      state.online.queue = null;
      state.online.queueSince = 0;
      state.online.resultShown = false;
      MC.toast('Opponent found. Game starting…', 'success');
      MC.navigate('#game/' + data.gameId);
    });
    source.addEventListener('game', event => handleSseGame(parseEvent(event)));
    source.addEventListener('game_over', event => handleSseGame(parseEvent(event)));
    source.addEventListener('draw_offer', event => {
      const data = parseEvent(event);
      const game = state.online.game;
      if (!game || Number(data.gameId) !== Number(game.id)) return;
      game.drawOfferBy = data.from ? data.from.id : null;
      state.online.drawOffer = data.from || null;
      const banner = MC.byId('onlineDrawBanner');
      if (banner) banner.innerHTML = drawBannerHtml(game);
      if (data.from && state.user && Number(data.from.id) !== Number(state.user.id)) {
        MC.toast('Your opponent offers a draw.', 'info');
      }
    });
    source.addEventListener('draw_declined', event => {
      const data = parseEvent(event);
      const game = state.online.game;
      if (!game || Number(data.gameId) !== Number(game.id)) return;
      game.drawOfferBy = null;
      state.online.drawOffer = null;
      const banner = MC.byId('onlineDrawBanner');
      if (banner) banner.innerHTML = '';
      MC.toast('Draw offer declined.', 'info');
    });
    source.addEventListener('chat', event => {
      const data = parseEvent(event);
      if (!state.online.game || Number(data.gameId) !== Number(state.online.game.id)) return;
      addChatMessage(data.message);
    });
    source.addEventListener('opponent_offline', event => {
      const data = parseEvent(event);
      if (state.route !== 'game' || !state.online.game || Number(data.gameId) !== Number(state.online.game.id)) return;
      state.online.opponentOnline = false;
      renderOnlineGame();
      MC.toast('Your opponent disconnected. The clock is still running.', 'info', 4200);
    });
    source.addEventListener('opponent_online', event => {
      const data = parseEvent(event);
      if (state.route !== 'game' || !state.online.game || Number(data.gameId) !== Number(state.online.game.id)) return;
      state.online.opponentOnline = true;
      renderOnlineGame();
      MC.toast('Your opponent is back online.', 'success');
    });
    source.onerror = () => {
      if (!state.user) return;
      if (Date.now() - (state.online.sseErrorAt || 0) > 12_000) {
        state.online.sseErrorAt = Date.now();
        MC.toast('Live connection interrupted. Reconnecting…', 'info', 2600);
      }
    };
  };

  MC.disconnectEvents = function () {
    if (state.sse) {
      try { state.sse.close(); } catch (e) {}
      state.sse = null;
    }
  };

  // -------------------------------------------------------------------------
  // Clock and polling tick
  // -------------------------------------------------------------------------

  function tickOnline() {
    updateQueueClockDom();
    const game = state.online.game;
    if (!game || state.route !== 'game') return;
    if (game.status === 'active') {
      updateOnlineClockDom();
      const values = onlineClockValues();
      const current = game.turn === 1 ? values.whiteMs : values.blackMs;
      if (current <= 0) {
        if (!state.online.zeroPollAt) state.online.zeroPollAt = Date.now();
        if (Date.now() - state.online.zeroPollAt > 1400) {
          state.online.zeroPollAt = Date.now() + 2500;
          reloadCurrentGame();
        }
      }
      if ((!state.sse || state.sse.readyState !== 1) && Date.now() - (state.online.pollAt || 0) > 4200) {
        state.online.pollAt = Date.now();
        reloadCurrentGame();
      }
    }
  }

  MC.initOnline = function () {
    MC.routes.online = renderOnlineLobbyPage;
    MC.routes.game = renderOnlineGamePage;
    const previousTick = MC.tickClocks;
    MC.tickClocks = function () {
      if (previousTick) previousTick();
      tickOnline();
    };
  };
})();
