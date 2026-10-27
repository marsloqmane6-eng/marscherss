/* MarsChess bot arena: local Stockfish games with clocks, hints, undo, and review. */
(function () {
  'use strict';

  const MC = window.MC;
  const E = MC.E;
  const state = MC.state;

  state.bot.moveToken = 0;

  function currentLevel() {
    return MC.BOT_MAP[state.bot.levelId] || MC.BOT_MAP.pilot || MC.BOT_LEVELS[3];
  }

  function gameLevel(game) {
    return MC.BOT_MAP[game && game.levelId] || currentLevel();
  }

  function aiMode() {
    return state.settings.brainMode === 'ai';
  }

  function aiEndpoint() {
    return String(state.settings.aiEndpoint || '').trim();
  }

  function aiConfigured() {
    if (!aiEndpoint() || !String(state.settings.aiModel || '').trim()) return false;
    if (String(state.settings.aiKey || '').trim()) return true;
    try {
      const host = new URL(aiEndpoint()).hostname;
      return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    } catch (e) {
      return false;
    }
  }

  function engineLabel(status) {
    if (aiMode()) {
      if (state.bot.aiStatus === 'thinking') return 'AI brain thinking…';
      if (state.bot.aiStatus === 'error') return 'AI brain · Stockfish fallback';
      if (state.bot.aiStatus === 'ready') return 'AI brain ready';
      return aiConfigured() ? 'AI brain ready' : 'AI brain needs a key';
    }
    if (status === 'ready') return 'Stockfish ready';
    if (status === 'loading') return 'Loading Stockfish…';
    if (status === 'error') return 'Built-in engine active';
    return 'Stockfish idle';
  }

  function engineClass(status) {
    if (aiMode()) {
      if (state.bot.aiStatus === 'thinking') return 'loading';
      if (state.bot.aiStatus === 'error' || !aiConfigured()) return 'error';
      return '';
    }
    return status === 'loading' ? 'loading' : status === 'error' ? 'error' : '';
  }

  function updateEngineUi() {
    MC.$$('[data-engine-state]').forEach(el => {
      el.classList.remove('loading', 'error');
      const cls = engineClass(state.bot.engineStatus);
      if (cls) el.classList.add(cls);
      el.innerHTML = `<span class="dot"></span><span>${MC.escapeHtml(engineLabel(state.bot.engineStatus))}</span>`;
    });
    const configured = aiConfigured();
    MC.$$('[data-ai-config]').forEach(el => {
      el.textContent = configured ? 'Configured' : 'Needs a key';
      el.classList.toggle('green', configured);
      el.classList.toggle('grey', !configured);
    });
  }

  function brainDescription() {
    if (!aiMode()) return 'Stockfish 10 · local worker';
    if (!aiConfigured()) return 'Add an endpoint, model, and API key to use your AI brain.';
    if (state.bot.aiError) return state.bot.aiError;
    return 'OpenAI-compatible · the key stays in this browser.';
  }

  function playerCardHtml(color, flipped, game) {
    const isGame = Boolean(game);
    const previewColor = state.bot.side === 'black' ? -1 : 1;
    const playerColor = isGame ? game.playerColor : previewColor;
    const isUser = color === playerColor;
    const level = isGame ? gameLevel(game) : currentLevel();
    const name = isUser ? (state.user ? state.user.username : 'You') : `${level.name} Bot`;
    const rating = isUser ? (state.user ? state.user.rating : 1200) : level.rating;
    const clock = isGame ? game.clock : null;
    const timeControl = isGame ? MC.timeControl(game.timeControl) : MC.timeControl(state.bot.timeControl);
    const clockMs = clock ? (color === 1 ? clock.whiteMs : clock.blackMs) : timeControl.baseMs;
    const colorName = color === 1 ? 'white' : 'black';
    const active = clock && !game.over && clock.active === colorName;
    const unlimited = timeControl.id === '0' || timeControl.baseMs === 0;
    const clockText = unlimited ? '∞' : MC.formatClock(clockMs);
    const low = !unlimited && clockMs < 20_000;
    const captured = isGame ? MC.capturedHtml(game.engineState, color) : '';
    return `<div class="player-card ${isUser ? 'you' : ''}" data-player-card="${colorName}">
      <div class="player-avatar ${isUser ? '' : 'bot'}">${isUser ? MC.escapeHtml(MC.initials(name)) : level.glyph}</div>
      <div class="player-main">
        <div class="player-topline">
          <span class="player-name">${MC.escapeHtml(name)}</span>
          ${isUser ? '<span class="badge green">You</span>' : '<span class="badge">Bot</span>'}
        </div>
        <div class="player-meta">
          <span>${MC.formatNumber(rating)} Elo</span><span class="sep">·</span>
          <span>${isUser ? (color === 1 ? 'White' : 'Black') : MC.escapeHtml(level.tag)}</span>
        </div>
        <div class="player-captured">${captured}</div>
      </div>
      <span class="clock ${active ? 'active' : ''} ${low ? 'low' : ''}" data-bot-clock="${colorName}">${clockText}</span>
    </div>`;
  }

  function statusLine(game) {
    if (!game) return 'Choose a level and start a game.';
    if (game.over) {
      const playerWon = game.status === 'white_win' ? game.playerColor === 1 : game.status === 'black_win' ? game.playerColor === -1 : false;
      if (game.status === 'draw') return 'The game ended in a draw.';
      return playerWon ? 'You won this game.' : 'The bot won this game.';
    }
    if (state.bot.thinking) return 'The bot is calculating…';
    if (game.engineState.turn === game.playerColor) return E.inCheck(game.engineState, game.engineState.turn) ? 'You are in check — find a way out.' : 'Your move.';
    return 'Waiting for the bot.';
  }

  function resultNote(game) {
    if (!game || !game.over) return '';
    const won = game.status === 'white_win' ? game.playerColor === 1 : game.status === 'black_win' ? game.playerColor === -1 : false;
    const reason = game.reason ? ` by ${String(game.reason).replace(/-/g, ' ')}` : '';
    const title = game.status === 'draw' ? 'Draw' : won ? 'You won!' : 'Bot wins';
    return `<div class="game-over-note ${won ? 'green' : ''}">
      <span class="go-icon">${game.status === 'draw' ? '½' : won ? '♛' : '☄'}</span>
      <span><strong>${title}</strong>${game.status === 'draw' ? 'The game ended in a draw' : (game.status === 'white_win' ? 'White wins' : 'Black wins')}${reason}.</span>
    </div>`;
  }

  function levelGrid() {
    return MC.BOT_LEVELS.map(level => `
      <button type="button" class="level-card ${state.bot.levelId === level.id ? 'active' : ''}" data-action="select-level" data-level="${level.id}">
        <span class="level-avatar">${level.glyph}</span>
        <span class="level-main"><span class="level-name">${MC.escapeHtml(level.name)}</span><span class="level-rating">${level.rating} Elo · ${MC.escapeHtml(level.tag)}</span></span>
        <span class="level-dot"></span>
      </button>`).join('');
  }

  function settingToggle(key, label, detail) {
    const on = Boolean(state.settings[key]);
    return `<button type="button" class="toggle-row" data-action="toggle-setting" data-key="${key}" style="width:100%;background:none;border:0;text-align:left;cursor:pointer">
      <span><span style="display:block;color:var(--text-soft)">${MC.escapeHtml(label)}</span>${detail ? `<span style="display:block;color:var(--faint);font-size:.68rem">${MC.escapeHtml(detail)}</span>` : ''}</span>
      <span class="switch ${on ? 'on' : ''}" aria-hidden="true"></span>
    </button>`;
  }

  function renderAiPanel() {
    const on = aiMode();
    const configured = aiConfigured();
    return `<section class="panel panel-pad">
      <div class="panel-head"><h2 class="panel-title">AI brain</h2><span class="badge ${on ? 'orange' : 'grey'}">${on ? 'On' : 'Optional'}</span></div>
      <p class="muted" style="margin:0 0 11px;font-size:.8rem;line-height:1.55">Switch the bot brain to any OpenAI-compatible chat endpoint. Stockfish remains the offline fallback.</p>
      <div class="segmented">
        <button type="button" class="${on ? '' : 'active'}" data-action="brain-mode" data-mode="stockfish">Stockfish</button>
        <button type="button" class="${on ? 'active' : ''}" data-action="brain-mode" data-mode="ai">AI brain</button>
      </div>
      ${on ? `
        <div class="field" style="margin-top:12px">
          <label for="aiEndpoint">Endpoint</label>
          <input class="input" id="aiEndpoint" data-setting="aiEndpoint" value="${MC.escapeHtml(state.settings.aiEndpoint || '')}" placeholder="https://api.openai.com/v1/chat/completions" autocomplete="off" spellcheck="false">
        </div>
        <div class="field">
          <label for="aiModel">Model</label>
          <input class="input" id="aiModel" data-setting="aiModel" value="${MC.escapeHtml(state.settings.aiModel || '')}" placeholder="gpt-4o-mini" autocomplete="off" spellcheck="false">
        </div>
        <div class="field">
          <label for="aiKey">API key</label>
          <input class="input" id="aiKey" data-setting="aiKey" type="password" value="${MC.escapeHtml(state.settings.aiKey || '')}" placeholder="sk-..." autocomplete="new-password" spellcheck="false">
        </div>
        <div class="row wrap" style="align-items:center;gap:8px;margin-top:2px">
          <button type="button" class="btn btn-secondary btn-sm" data-action="test-brain">Test connection</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="clear-ai-key">Clear key</button>
          <span class="badge ${configured ? 'green' : 'grey'}" data-ai-config>${configured ? 'Configured' : 'Needs a key'}</span>
        </div>
        <p class="form-hint" style="margin:9px 0 0">The key is stored only in this browser and is sent only to your chosen endpoint. Local endpoints may not require a key.</p>
        ${state.bot.aiError ? `<p class="form-hint" style="color:var(--danger);margin:6px 0 0">${MC.escapeHtml(state.bot.aiError)}</p>` : ''}
      ` : '<p class="form-hint" style="margin:8px 0 0">Stockfish 10 runs locally in a worker and needs no key or internet connection.</p>'}
    </section>`;
  }

  function readAiFields() {
    let changed = false;
    [['aiEndpoint', 'aiEndpoint'], ['aiModel', 'aiModel'], ['aiKey', 'aiKey']].forEach(([id, key]) => {
      const el = MC.byId(id);
      if (el && state.settings[key] !== el.value.trim()) {
        state.settings[key] = el.value.trim();
        changed = true;
      }
    });
    if (changed && MC.saveSettings) MC.saveSettings();
    updateEngineUi();
  }

  function setBrainMode(mode) {
    readAiFields();
    state.settings.brainMode = mode === 'ai' ? 'ai' : 'stockfish';
    state.bot.aiError = '';
    state.bot.aiStatus = state.settings.brainMode === 'ai' && aiConfigured() ? 'ready' : 'idle';
    MC.setSetting('brainMode', state.settings.brainMode);
    if (state.route === 'play') renderBotPage();
  }

  function renderSidePanel(game) {
    const level = game ? gameLevel(game) : currentLevel();
    const playerWon = game && game.status === 'white_win' ? game.playerColor === 1 : game && game.status === 'black_win' ? game.playerColor === -1 : false;
    const currentPanel = game ? `
      <section class="panel panel-pad">
        <div class="panel-head"><h2 class="panel-title"><span class="dot"></span>Current game</h2><span class="badge orange">${MC.escapeHtml(level.name)}</span></div>
        <div class="bot-identity">
          <div class="player-avatar bot">${level.glyph}</div>
          <div class="grow"><h3>${MC.escapeHtml(level.name)} Bot</h3><p>${level.rating} Elo · ${MC.escapeHtml(level.tag)}</p></div>
          <span class="badge">${game.timeControl === '0' ? 'Unlimited' : MC.timeControlLabel(game.timeControl)}</span>
        </div>
        ${resultNote(game)}
        <div class="game-info-line" style="margin-top:10px"><span class="left">${statusLine(game)}</span><span>${game.moves.length} move${game.moves.length === 1 ? '' : 's'}</span></div>
        <div class="move-list" id="botMoveList">${MC.movesGridHtml(game.moves, game.moves.length)}</div>
        <div class="control-grid" style="margin-top:12px">
          <button type="button" class="btn btn-secondary" data-action="bot-undo" ${game.over ? 'disabled' : ''}>↶ Undo</button>
          <button type="button" class="btn btn-secondary" data-action="bot-hint" ${game.over || state.bot.thinking ? 'disabled' : ''}>✦ Hint</button>
          <button type="button" class="btn btn-secondary" data-action="bot-flip">⇅ Flip</button>
          <button type="button" class="btn btn-danger" data-action="bot-resign" ${game.over ? 'disabled' : ''}>⚑ Resign</button>
          ${game.over ? `<button type="button" class="btn btn-primary" style="grid-column:1/-1" data-action="review-bot">▤ Game review</button>` : `<button type="button" class="btn btn-ghost" style="grid-column:1/-1" data-action="start-bot">＋ New game</button>`}
        </div>
      </section>` : `
      <section class="panel panel-pad">
        <div class="panel-head"><h2 class="panel-title"><span class="dot"></span>Ready for launch</h2></div>
        <p class="muted" style="margin:0 0 13px;font-size:.82rem;line-height:1.55">Pick a bot, choose your side, and start a game. Clocks run locally; the engine is tuned for quick, strong replies.</p>
        <div class="bot-identity">
          <div class="player-avatar bot">${level.glyph}</div>
          <div class="grow"><h3>${MC.escapeHtml(level.name)} Bot</h3><p>${level.rating} Elo · ${MC.escapeHtml(level.desc)}</p></div>
        </div>
        <button type="button" class="btn btn-primary btn-block" style="margin-top:12px" data-action="start-bot">Start game</button>
      </section>`;

    return `${currentPanel}
      <section class="panel panel-pad">
        <div class="panel-head"><h2 class="panel-title">New bot game</h2><span class="badge grey">Next game</span></div>
        <div class="bot-level-grid" id="botLevelGrid">${levelGrid()}</div>
        <div class="bot-config">
          <div>
            <div class="config-label">Your side</div>
            <div class="segmented">
              <button type="button" class="${state.bot.side === 'white' ? 'active' : ''}" data-action="bot-side" data-side="white">White</button>
              <button type="button" class="${state.bot.side === 'black' ? 'active' : ''}" data-action="bot-side" data-side="black">Black</button>
              <button type="button" class="${state.bot.side === 'random' ? 'active' : ''}" data-action="bot-side" data-side="random">Random</button>
            </div>
          </div>
          <div>
            <label class="config-label" for="botTime">Time control</label>
            <select class="input" id="botTime" data-setting="botTime">
              ${['0', '180+0', '300+0', '600+0', '180+2', '300+5'].map(id => {
                const tc = MC.timeControl(id);
                return `<option value="${id}" ${state.bot.timeControl === id ? 'selected' : ''}>${id === '0' ? 'Unlimited' : `${tc.label} · ${tc.name}`}</option>`;
              }).join('')}
            </select>
          </div>
          <button type="button" class="btn btn-primary btn-block" data-action="start-bot">${game ? 'Start new game' : 'Start game'}</button>
          ${game ? '<p class="form-hint" style="margin:0;text-align:center">Changing the level or side applies to the next game.</p>' : ''}
        </div>
      </section>
      <section class="panel panel-pad">
        <div class="panel-head"><h2 class="panel-title">Board settings</h2></div>
        <div class="field">
          <label for="boardTheme">Board theme</label>
          <select class="input" id="boardTheme" data-setting="boardTheme">
            ${[['green', 'Classic green'], ['mars', 'Mars clay'], ['ice', 'Ice blue'], ['night', 'Moonlit night']].map(([id, label]) => `<option value="${id}" ${state.settings.boardTheme === id ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
        <div style="margin-top:2px">
          ${settingToggle('showLegal', 'Legal move hints', 'Highlight destinations when a piece is selected.')}
          ${settingToggle('showLast', 'Last move highlight', 'Keep the previous move visible on the board.')}
          ${settingToggle('sound', 'Sound effects', 'Short audio cues for moves, captures, and checks.')}
          ${settingToggle('autoQueen', 'Auto-queen promotion', 'Promote to a queen without asking.')}
          ${settingToggle('showEval', 'Evaluation bar', 'Show the engine evaluation beside the board.')}
        </div>
        <div class="bot-engine-line">
          <span class="engine-state ${engineClass(state.bot.engineStatus)}" data-engine-state><span class="dot"></span><span>${MC.escapeHtml(engineLabel(state.bot.engineStatus))}</span></span>
          <span>${MC.escapeHtml(state.bot.engineError || brainDescription())}</span>
        </div>
      </section>
      ${renderAiPanel()}`;
  }

  function renderBotPage() {
    const game = state.bot.game;
    const previewColor = state.bot.side === 'black' ? -1 : 1;
    const playerColor = game ? game.playerColor : previewColor;
    const flipped = game ? state.bot.boardFlipped : previewColor === -1;
    const topColor = flipped ? 1 : -1;
    const bottomColor = flipped ? -1 : 1;
    const level = game ? gameLevel(game) : currentLevel();
    const boardState = game ? game.engineState : E.initialState();
    const canPlay = Boolean(game) && !game.over && !state.bot.thinking && boardState.turn === game.playerColor;
    const tc = MC.timeControl(game ? game.timeControl : state.bot.timeControl);
    const unlimited = tc.id === '0' || tc.baseMs === 0;
    const evalCp = game ? state.bot.eval : 0;
    const statusText = game ? statusLine(game) : 'Choose a level and start a game.';
    const resultTitle = game && game.over
      ? game.status === 'draw' ? 'Draw' : (game.status === 'white_win' ? (game.playerColor === 1 ? 'You won' : 'Bot wins') : (game.playerColor === -1 ? 'You won' : 'Bot wins'))
      : '';

    MC.setView(`
      <div class="bot-page">
        <div class="page-topline">
          <div>
            <span class="eyebrow">Bot arena</span>
            <h1>Play a bot</h1>
            <p>${game ? `${MC.escapeHtml(level.name)} · ${MC.moveCount(game.moves.length)} · ${tc.id === '0' ? 'Unlimited time' : tc.label + ' ' + tc.name}` : aiMode() ? 'Ten levels from Dust to Martian. Your API brain picks moves; Stockfish stays ready as the fallback.' : 'Ten levels from Dust to Martian. Stockfish thinks locally in your browser.'}</p>
          </div>
          <div class="row wrap">
            <span class="engine-state ${engineClass(state.bot.engineStatus)}" data-engine-state><span class="dot"></span><span>${MC.escapeHtml(engineLabel(state.bot.engineStatus))}</span></span>
            ${game ? `<button type="button" class="btn btn-secondary btn-sm" data-action="start-bot">↻ New game</button>` : ''}
            <button type="button" class="btn btn-ghost btn-sm" data-action="bot-flip">⇅ Flip</button>
          </div>
        </div>

        <div class="online-game-layout">
          <div class="online-board-column">
            <div id="botTopCard">${playerCardHtml(topColor, flipped, game)}</div>
            <div class="board-with-eval ${state.settings.showEval ? '' : 'no-eval'}">
              ${state.settings.showEval ? `<div class="eval-shell" data-eval-bar>
                <div class="eval-bar"><div class="eval-fill" id="botEvalFill"></div><div class="eval-label" id="botEvalLabel">${MC.formatEval(evalCp)}</div></div>
              </div>` : ''}
              <div class="board-shell"><div id="botBoard"></div></div>
            </div>
            <div id="botBottomCard">${playerCardHtml(bottomColor, flipped, game)}</div>
            <div class="game-info-line">
              <span class="left">${game && game.over ? `Game over · ${resultTitle}` : state.bot.thinking ? '<span class="spinner green" style="width:12px;height:12px;border-width:2px"></span> Bot thinking…' : canPlay ? (E.inCheck(boardState, boardState.turn) ? 'Your move · check!' : 'Your move') : 'Your turn is coming up'}</span>
              <span>${unlimited ? '∞' : `${tc.label} · ${tc.name}`} · ${game ? 'Unrated' : 'Bot game'}</span>
            </div>
          </div>
          <aside class="online-side">${renderSidePanel(game)}</aside>
        </div>
      </div>`);

    const boardEl = MC.byId('botBoard');
    if (boardEl) {
      state.bot.board = new MC.Board(boardEl, {
        state: boardState,
        flipped,
        interactive: canPlay,
        lastMove: game ? game.lastMove : null,
        hint: state.bot.hint,
        onMove: handlePlayerMove,
        onPromotion: MC.promotionModal,
        theme: state.settings.boardTheme
      });
    }
    const evalShell = document.querySelector('[data-eval-bar]');
    if (evalShell) MC.updateEvalBar(evalShell, evalCp);
    const evalLabel = MC.byId('botEvalLabel');
    if (evalLabel) evalLabel.textContent = MC.formatEval(evalCp);
    updateEngineUi();

    if (game && game.over && !state.bot.resultShown && state.route === 'play') {
      setTimeout(() => showBotGameOver(game), 220);
    }
  }

  function updateBotClockDom() {
    const game = state.bot.game;
    if (!game) return;
    const tc = MC.timeControl(game.timeControl);
    const unlimited = tc.id === '0' || tc.baseMs === 0;
    for (const color of ['white', 'black']) {
      const el = document.querySelector(`[data-bot-clock="${color}"]`);
      if (!el) continue;
      const ms = color === 'white' ? game.clock.whiteMs : game.clock.blackMs;
      el.textContent = unlimited ? '∞' : MC.formatClock(ms);
      el.classList.toggle('active', !game.over && game.clock.active === color);
      el.classList.toggle('low', !unlimited && ms < 20_000);
    }
  }

  function tickBotClock() {
    const game = state.bot.game;
    if (!game || game.over || !game.clock) return;
    const tc = MC.timeControl(game.timeControl);
    if (tc.id === '0' || tc.baseMs === 0) return;
    const now = Date.now();
    const elapsed = Math.max(0, now - game.clock.lastTick);
    if (elapsed <= 0) return;
    game.clock.lastTick = now;
    if (!game.clock.active) return;
    const key = game.clock.active === 'white' ? 'whiteMs' : 'blackMs';
    game.clock[key] = Math.max(0, game.clock[key] - elapsed);
    updateBotClockDom();
    if (game.clock[key] <= 0) {
      const flagged = game.clock.active;
      finishBotGame(flagged === 'white' ? 'black_win' : 'white_win', 'timeout');
    }
  }

  function snapshot(game) {
    return {
      state: E.cloneState(game.engineState),
      lastMove: game.lastMove,
      moves: game.moves.slice(),
      positionKeys: game.positionKeys.slice(),
      clock: { whiteMs: game.clock.whiteMs, blackMs: game.clock.blackMs, active: game.clock.active, lastTick: game.clock.lastTick }
    };
  }

  function applyBotMove(move, moverColor) {
    const game = state.bot.game;
    if (!game || game.over || !move) return;
    const before = game.engineState;
    if (before.turn !== moverColor) return;
    game.history.push(snapshot(game));
    const san = E.moveToSan(move, before);
    const after = E.applyMove(before, move);
    const uci = E.moveToUci(move);
    const tc = MC.timeControl(game.timeControl);
    if (tc.id !== '0' && tc.baseMs > 0) {
      const key = moverColor === 1 ? 'whiteMs' : 'blackMs';
      game.clock[key] = Math.max(0, game.clock[key]) + tc.incMs;
    }
    game.engineState = after;
    game.lastMove = move;
    game.moves.push({ uci, san, color: moverColor, from: move.from, to: move.to, promotion: move.promotion || null, fenAfter: E.toFEN(after) });
    game.positionKeys.push(E.positionKey(after));
    state.bot.eval = E.staticEval(after);
    state.bot.thinking = false;
    state.bot.hint = null;

    const end = MC.detectClientEnd(after, game.positionKeys);
    if (end) {
      game.clock.active = null;
      finishBotGame(end.status, end.reason);
      MC.playSound('end');
      return;
    }
    game.clock.active = after.turn === 1 ? 'white' : 'black';
    game.clock.lastTick = Date.now();
    if (E.inCheck(after, after.turn)) MC.playSound('check');
    else if (move.captured || move.epCapture) MC.playSound('capture');
    else MC.playSound('move');
    if (state.route === 'play') renderBotPage();
    if (after.turn !== game.playerColor) {
      setTimeout(() => requestBotMove(), 170);
    }
  }

  function handlePlayerMove(move) {
    const game = state.bot.game;
    if (!game || game.over || state.bot.thinking) return;
    if (game.engineState.turn !== game.playerColor) return;
    const legal = E.legalMoves(game.engineState).find(m => E.moveToUci(m) === E.moveToUci(move));
    if (!legal) return;
    applyBotMove(legal, game.playerColor);
  }

  function aiMovePrompt(game, level) {
    const boardState = game.engineState;
    const legal = E.legalMoves(boardState).map(m => ({
      uci: E.moveToUci(m),
      san: E.moveToSan(m, boardState)
    }));
    const prompt = [
      'You are MarsChess, a strong chess engine playing a casual game.',
      `You are playing ${boardState.turn === 1 ? 'White' : 'Black'} at a target strength of about ${level.rating} Elo.`,
      `FEN: ${E.toFEN(boardState)}`,
      `Legal moves (UCI and SAN): ${JSON.stringify(legal)}`,
      'Choose the best legal move for the side to move.',
      'Reply with JSON only, exactly like {"move":"e2e4"}. The move must be one of the supplied UCI moves.'
    ].join('\n');
    return { boardState, legal, prompt };
  }

  function contentText(data) {
    const choice = data && data.choices && data.choices[0];
    let content = choice && (choice.message ? choice.message.content : choice.text);
    if (Array.isArray(content)) {
      content = content.map(part => typeof part === 'string' ? part : (part && part.text) || '').join('');
    }
    if (!content && data && data.output_text) content = data.output_text;
    return typeof content === 'string' ? content : '';
  }

  function extractAiMove(text, boardState, legal) {
    let candidate = '';
    const jsonMatch = String(text || '').match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        candidate = parsed.move || parsed.uci || parsed.best_move || parsed.bestMove || '';
      } catch (e) {}
    }
    if (!candidate) {
      const uciMatch = String(text || '').match(/\b[a-h][1-8][a-h][1-8][qrbn]?\b/i);
      if (uciMatch) candidate = uciMatch[0];
    }
    candidate = String(candidate || '').trim().toLowerCase();
    if (candidate) {
      const byUci = legal.find(entry => entry.uci.toLowerCase() === candidate);
      if (byUci) return E.uciToMove(boardState, byUci.uci);
    }
    const words = String(text || '').toLowerCase();
    for (const entry of legal) {
      const escaped = entry.san.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i');
      if (re.test(words)) return E.uciToMove(boardState, entry.uci);
    }
    return null;
  }

  async function aiCompletion(messages, maxTokens) {
    const endpoint = aiEndpoint();
    let parsedUrl;
    try { parsedUrl = new URL(endpoint); } catch (e) { throw new Error('AI endpoint is not a valid URL.'); }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('AI endpoint must use http or https.');
    if (!aiConfigured()) throw new Error('Add an AI endpoint, model, and API key first.');
    const key = String(state.settings.aiKey || '').trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          key ? { Authorization: `Bearer ${key}` } : {}
        ),
        body: JSON.stringify({
          model: String(state.settings.aiModel || '').trim(),
          messages,
          temperature: 0.2,
          max_tokens: maxTokens || 80
        }),
        signal: controller.signal
      });
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error('AI brain timed out.');
      throw new Error('AI brain request failed. Check the endpoint, key, and CORS settings.');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.text();
        detail = body.replace(/\s+/g, ' ').slice(0, 180);
      } catch (e) {}
      throw new Error(`AI brain returned HTTP ${res.status}${detail ? ': ' + detail : ''}`);
    }
    try { return await res.json(); }
    catch (e) { throw new Error('AI brain returned a response that was not JSON.'); }
  }

  async function requestAiMove(game, level) {
    const { boardState, legal, prompt } = aiMovePrompt(game, level);
    state.bot.aiStatus = 'thinking';
    state.bot.aiError = '';
    updateEngineUi();
    if (state.route === 'play') renderBotPage();
    const data = await aiCompletion([
      { role: 'system', content: 'You choose legal chess moves and reply with JSON only.' },
      { role: 'user', content: prompt }
    ], 120);
    const move = extractAiMove(contentText(data), boardState, legal);
    if (!move) throw new Error('AI brain returned an illegal or unreadable move.');
    state.bot.aiStatus = 'ready';
    if (state.route === 'play') updateEngineUi();
    return { best: E.moveToUci(move), cp: 0, source: 'ai' };
  }

  async function testAiBrain() {
    const data = await aiCompletion([
      { role: 'system', content: 'Reply with exactly the word OK.' },
      { role: 'user', content: 'Connection test. Reply with OK.' }
    ], 12);
    const text = contentText(data).trim();
    state.bot.aiStatus = 'ready';
    state.bot.aiError = '';
    if (state.route === 'play') renderBotPage();
    MC.toast(text ? 'AI brain connected.' : 'AI brain replied, but the response was empty.', text ? 'success' : 'error');
  }

  async function requestBotMove() {
    const game = state.bot.game;
    if (!game || game.over) return;
    const botColor = -game.playerColor;
    if (game.engineState.turn !== botColor || state.bot.thinking) return;
    const level = gameLevel(game);
    const moveToken = ++state.bot.moveToken;
    state.bot.thinking = true;
    state.bot.hint = null;
    game.clock.active = botColor === 1 ? 'white' : 'black';
    game.clock.lastTick = Date.now();
    if (state.route === 'play') renderBotPage();

    let result = null;
    if (aiMode()) {
      if (aiConfigured()) {
        try {
          result = await requestAiMove(game, level);
        } catch (err) {
          state.bot.aiStatus = 'error';
          state.bot.aiError = err && err.message ? err.message : 'AI brain request failed.';
          console.warn('AI brain failed', err);
          updateEngineUi();
        }
      } else {
        state.bot.aiStatus = 'error';
        state.bot.aiError = 'Add an endpoint, model, and API key to use the AI brain.';
        updateEngineUi();
      }
    }
    if (!result) {
      try {
        result = await MC.botEngine.bestMove(E.toFEN(game.engineState), level.movetime, level.skill);
      } catch (e) {
        console.warn('Bot engine failed', e);
      }
    }
    if (moveToken !== state.bot.moveToken || state.bot.game !== game || game.over) return;
    if (result && result.source === 'ai') state.bot.engineError = '';

    let move = result && result.best ? MC.moveFromUci(game.engineState, result.best) : null;
    if (!move) {
      state.bot.engineError = aiMode()
        ? 'AI brain and Stockfish are unavailable — using the built-in engine.'
        : 'Stockfish unavailable — using the built-in engine.';
      try {
        move = E.findBestMove(game.engineState, {
          depth: level.fallbackDepth,
          timeLimit: level.fallbackTime,
          randomness: level.fallbackRandom || 0
        });
      } catch (e) {}
      updateEngineUi();
    }
    if (!move) {
      const legal = E.legalMoves(game.engineState);
      if (legal.length) move = legal[Math.floor(Math.random() * legal.length)];
    }
    if (!move) {
      finishBotGame('draw', 'stalemate', false);
      return;
    }
    applyBotMove(move, botColor);
  }

  function createBotGame() {
    MC.closeModal();
    const level = currentLevel();
    const side = state.bot.side === 'random' ? (Math.random() < 0.5 ? 1 : -1) : state.bot.side === 'black' ? -1 : 1;
    const tc = MC.timeControl(state.bot.timeControl);
    state.bot.token++;
    state.bot.moveToken++;
    MC.botEngine.cancel();
    const initial = E.initialState();
    const game = {
      engineState: initial,
      playerColor: side,
      levelId: level.id,
      timeControl: tc.id,
      moves: [],
      lastMove: null,
      over: false,
      status: 'active',
      reason: '',
      winner: null,
      history: [],
      positionKeys: [E.positionKey(initial)],
      startedAt: Date.now(),
      clock: {
        whiteMs: tc.baseMs,
        blackMs: tc.baseMs,
        active: initial.turn === 1 ? 'white' : 'black',
        lastTick: Date.now()
      }
    };
    state.bot.game = game;
    state.bot.clock = game.clock;
    state.bot.thinking = false;
    state.bot.hint = null;
    state.bot.eval = E.staticEval(initial);
    state.bot.resultShown = false;
    state.bot.engineError = '';
    state.bot.aiStatus = aiConfigured() ? 'ready' : 'idle';
    state.bot.aiError = '';
    state.bot.boardFlipped = side === -1;
    renderBotPage();
    MC.playSound('start');
    if (!aiMode()) {
      MC.botEngine.init().then(ok => {
        if (!ok) {
          state.bot.engineError = 'Stockfish is unavailable — using the built-in engine.';
          updateEngineUi();
        }
      });
    }
    if (initial.turn !== side) setTimeout(() => requestBotMove(), 320);
  }

  function finishBotGame(status, reason, doRender) {
    const game = state.bot.game;
    if (!game || game.over) return;
    game.over = true;
    game.status = status;
    game.reason = reason || '';
    game.winner = status === 'white_win' ? 1 : status === 'black_win' ? -1 : 0;
    game.clock.active = null;
    state.bot.thinking = false;
    state.bot.moveToken++;
    state.bot.hint = null;
    MC.botEngine.cancel();
    if (doRender !== false && state.route === 'play') renderBotPage();
  }

  function showBotGameOver(game) {
    if (!game || !game.over || state.bot.resultShown) return;
    if (state.route !== 'play') return;
    state.bot.resultShown = true;
    const playerWon = game.status === 'white_win' ? game.playerColor === 1 : game.status === 'black_win' ? game.playerColor === -1 : false;
    const draw = game.status === 'draw';
    const title = draw ? 'Draw — the dust settles.' : playerWon ? 'You won!' : 'The bot wins.';
    const icon = draw ? '½' : playerWon ? '♛' : '☄';
    const reason = game.reason ? ` by ${String(game.reason).replace(/-/g, ' ')}` : '';
    const resultLine = draw ? 'The game ended in a draw' : game.status === 'white_win' ? 'White wins' : 'Black wins';
    MC.openModal(`
      <div class="result-title"><div class="result-icon">${icon}</div><div><h2>${title}</h2><div class="result-score">${resultLine}${reason} · ${MC.moveCount(game.moves.length)}</div></div></div>
      <p style="margin-top:10px">${playerWon ? 'A clean finish. Want to see where the game turned?' : draw ? 'A balanced battle. Run the review to find the key moment.' : 'Every loss is data. Review the game and find the turning point.'}</p>
      <div class="result-actions">
        <button type="button" class="btn btn-primary" data-action="review-bot">▤ Game review</button>
        <button type="button" class="btn btn-secondary" data-action="bot-rematch">↻ Play again</button>
        <button type="button" class="btn btn-ghost" data-action="close-modal">Close</button>
      </div>`);
  }

  MC.actions['start-bot'] = async () => {
    const game = state.bot.game;
    if (game && !game.over && game.moves.length > 0) {
      const ok = await MC.confirm({
        title: 'Start a new bot game?',
        message: 'The current game will be abandoned. Its clock and position will not be saved.',
        confirmLabel: 'Start new game'
      });
      if (!ok) return;
    }
    createBotGame();
  };

  MC.actions['bot-rematch'] = () => {
    MC.closeModal();
    createBotGame();
  };

  MC.actions['select-level'] = el => {
    const id = el.dataset.level;
    if (!MC.BOT_MAP[id]) return;
    state.bot.levelId = id;
    MC.setSetting('botLevel', id);
    if (state.bot.game && !state.bot.game.over) MC.toast(`${MC.BOT_MAP[id].name} selected for your next game.`, 'info', 2200);
    if (MC.rerenderBotIfNeeded) MC.rerenderBotIfNeeded();
  };

  MC.actions['bot-side'] = el => {
    const side = el.dataset.side;
    if (!['white', 'black', 'random'].includes(side)) return;
    state.bot.side = side;
    MC.setSetting('botSide', side);
    if (!state.bot.game) state.bot.boardFlipped = side === 'black';
    if (state.bot.game && !state.bot.game.over) MC.toast('Side choice applies to your next game.', 'info', 2200);
    renderBotPage();
  };

  MC.actions['bot-flip'] = () => {
    if (!state.bot.game) {
      state.bot.side = state.bot.side === 'black' ? 'white' : 'black';
      MC.setSetting('botSide', state.bot.side);
    } else {
      state.bot.boardFlipped = !state.bot.boardFlipped;
    }
    renderBotPage();
  };

  MC.actions['bot-undo'] = async () => {
    const game = state.bot.game;
    if (!game) return;
    if (game.over) {
      MC.toast('Start a new game to use undo.', 'info');
      return;
    }
    if (!game.moves.some(m => m.color === game.playerColor)) {
      MC.toast('Make a move first.', 'info');
      return;
    }
    state.bot.moveToken++;
    MC.botEngine.cancel();
    state.bot.thinking = false;
    const popped = [];
    while (game.history.length) {
      const snap = game.history.pop();
      popped.push(snap);
      if (snap.state.turn === game.playerColor) break;
    }
    if (!popped.length) return;
    const snap = popped[popped.length - 1];
    game.engineState = snap.state;
    game.lastMove = snap.lastMove;
    game.moves = snap.moves;
    game.positionKeys = snap.positionKeys;
    game.clock = { whiteMs: snap.clock.whiteMs, blackMs: snap.clock.blackMs, active: snap.state.turn === 1 ? 'white' : 'black', lastTick: Date.now() };
    state.bot.clock = game.clock;
    state.bot.eval = E.staticEval(game.engineState);
    state.bot.hint = null;
    game.over = false;
    game.status = 'active';
    game.reason = '';
    game.winner = null;
    state.bot.resultShown = false;
    renderBotPage();
  };

  MC.actions['bot-hint'] = async () => {
    const game = state.bot.game;
    if (!game || game.over || state.bot.thinking) return;
    if (game.engineState.turn !== game.playerColor) {
      MC.toast('Wait for the bot to move.', 'info');
      return;
    }
    MC.toast('Finding a good move…', 'info', 1100);
    let move = null;
    try {
      const result = await MC.botEngine.bestMove(E.toFEN(game.engineState), 260, 20);
      if (result && result.best) move = MC.moveFromUci(game.engineState, result.best);
    } catch (e) {}
    if (!move) {
      try { move = E.findBestMove(game.engineState, { depth: 5, timeLimit: 320 }); } catch (e) {}
    }
    if (!move) {
      MC.toast('No hint available for this position.', 'error');
      return;
    }
    state.bot.hint = move;
    renderBotPage();
    MC.toast(`Hint: ${E.moveToSan(move, game.engineState)}`, 'success');
  };

  MC.actions['bot-resign'] = async () => {
    const game = state.bot.game;
    if (!game || game.over) return;
    const ok = await MC.confirm({
      title: 'Resign this game?',
      message: 'The bot will be awarded the win. You can start a new game immediately.',
      confirmLabel: 'Resign',
      danger: true
    });
    if (!ok) return;
    finishBotGame(game.playerColor === 1 ? 'black_win' : 'white_win', 'resignation');
    MC.playSound('end');
  };

  MC.actions['brain-mode'] = el => setBrainMode(el.dataset.mode);

  MC.actions['clear-ai-key'] = () => {
    state.settings.aiKey = '';
    state.bot.aiError = '';
    state.bot.aiStatus = 'idle';
    if (MC.saveSettings) MC.saveSettings();
    if (state.route === 'play') renderBotPage();
    MC.toast('API key removed from this browser.', 'info');
  };

  MC.actions['test-brain'] = async () => {
    readAiFields();
    state.bot.aiStatus = 'thinking';
    state.bot.aiError = '';
    updateEngineUi();
    MC.toast('Contacting the AI brain…', 'info', 1200);
    try {
      await testAiBrain();
    } catch (err) {
      state.bot.aiStatus = 'error';
      state.bot.aiError = err && err.message ? err.message : 'AI brain connection failed.';
      updateEngineUi();
      if (state.route === 'play') renderBotPage();
      MC.toast(state.bot.aiError, 'error', 5200);
    }
  };

  MC.initBot = function () {
    state.bot.moveToken = state.bot.moveToken || 0;
    const previousSettingChange = MC.changes.setting;
    MC.changes.setting = function (el) {
      if (previousSettingChange) previousSettingChange(el);
      const key = el && el.dataset ? el.dataset.setting : '';
      if (key === 'aiEndpoint' || key === 'aiModel' || key === 'aiKey') {
        state.bot.aiError = '';
        state.bot.aiStatus = aiConfigured() ? 'ready' : 'idle';
        updateEngineUi();
      }
    };
    MC.botEngine.statusHandler = status => {
      state.bot.engineStatus = status;
      updateEngineUi();
    };
    updateEngineUi();
    MC.routes.play = renderBotPage;
    MC.rerenderBotIfNeeded = function () {
      if (state.route === 'play') renderBotPage();
    };
    const previousTick = MC.tickClocks;
    MC.tickClocks = function () {
      if (previousTick) previousTick();
      tickBotClock();
    };
  };
})();
