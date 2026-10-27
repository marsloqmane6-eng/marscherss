/* MarsChess core: shared state, helpers, navigation, modals, and events. */
(function () {
  'use strict';

  const MC = window.MC = window.MC || {};
  const E = MC.E = window.MarsEngine;

  MC.STOCKFISH_URL = '/stockfish.js';
  MC.SETTINGS_KEY = 'marschess_settings_v1';
  MC.boards = new Set();
  MC.routes = {};
  MC.actions = {};
  MC.forms = {};
  MC.changes = {};

  MC.TIME_CONTROLS = [
    { id: '60+0', label: '1+0', name: 'Bullet', baseMs: 60_000, incMs: 0, icon: '⚡' },
    { id: '180+0', label: '3+0', name: 'Blitz', baseMs: 180_000, incMs: 0, icon: '♞' },
    { id: '300+0', label: '5+0', name: 'Blitz', baseMs: 300_000, incMs: 0, icon: '♞' },
    { id: '600+0', label: '10+0', name: 'Rapid', baseMs: 600_000, incMs: 0, icon: '⏳' },
    { id: '180+2', label: '3+2', name: 'Blitz', baseMs: 180_000, incMs: 2_000, icon: '♞' },
    { id: '300+5', label: '5+5', name: 'Blitz', baseMs: 300_000, incMs: 5_000, icon: '♞' },
    { id: '900+10', label: '15+10', name: 'Rapid', baseMs: 900_000, incMs: 10_000, icon: '⏳' }
  ];
  MC.TIME_MAP = Object.fromEntries(MC.TIME_CONTROLS.map(t => [t.id, t]));
  MC.TIME_MAP['0'] = { id: '0', label: '∞', name: 'Unlimited', baseMs: 0, incMs: 0, icon: '∞' };

  MC.BOT_LEVELS = [
    { id: 'dust', name: 'Dust', rating: 400, skill: 0, movetime: 110, fallbackDepth: 2, fallbackTime: 70, glyph: '♟', tag: 'First steps', desc: 'A friendly first opponent. Learns the moves.' },
    { id: 'rover', name: 'Rover', rating: 700, skill: 2, movetime: 160, fallbackDepth: 2, fallbackTime: 90, glyph: '♟', tag: 'Beginner', desc: 'Knows the basics and will punish free pieces.' },
    { id: 'cadet', name: 'Cadet', rating: 1000, skill: 4, movetime: 230, fallbackDepth: 3, fallbackTime: 120, glyph: '♞', tag: 'Casual', desc: 'A steady club beginner with simple plans.' },
    { id: 'pilot', name: 'Pilot', rating: 1300, skill: 6, movetime: 320, fallbackDepth: 3, fallbackTime: 160, glyph: '♞', tag: 'Intermediate', desc: 'Tactics are starting to click. Watch your pieces.' },
    { id: 'settler', name: 'Settler', rating: 1600, skill: 8, movetime: 450, fallbackDepth: 4, fallbackTime: 220, glyph: '♝', tag: 'Club', desc: 'A solid club player who finds most tactics.' },
    { id: 'veteran', name: 'Veteran', rating: 1900, skill: 11, movetime: 650, fallbackDepth: 4, fallbackTime: 300, glyph: '♜', tag: 'Advanced', desc: 'Positional pressure, accurate calculation, fewer gifts.' },
    { id: 'expert', name: 'Expert', rating: 2200, skill: 14, movetime: 900, fallbackDepth: 5, fallbackTime: 400, glyph: '♛', tag: 'Expert', desc: 'Strong tactical vision and deep opening knowledge.' },
    { id: 'master', name: 'Master', rating: 2500, skill: 17, movetime: 1200, fallbackDepth: 5, fallbackTime: 500, glyph: '♛', tag: 'Master', desc: 'A master-strength engine. Every inaccuracy counts.' },
    { id: 'grandmaster', name: 'Grandmaster', rating: 2800, skill: 19, movetime: 1600, fallbackDepth: 6, fallbackTime: 700, glyph: '♚', tag: 'Grandmaster', desc: 'Near-perfect play with a relentless attack.' },
    { id: 'martian', name: 'Martian', rating: 3200, skill: 20, movetime: 2200, fallbackDepth: 6, fallbackTime: 900, glyph: '♚', tag: 'Unbeatable', desc: 'The final boss. Full-power Stockfish with no mercy.' }
  ];
  MC.BOT_MAP = Object.fromEntries(MC.BOT_LEVELS.map(b => [b.id, b]));

  MC.CLASS_META = {
    brilliant: { label: 'Brilliant', icon: '!!', order: 1 },
    great: { label: 'Great', icon: '!', order: 2 },
    best: { label: 'Best', icon: '★', order: 3 },
    excellent: { label: 'Excellent', icon: '✓', order: 4 },
    good: { label: 'Good', icon: '·', order: 5 },
    book: { label: 'Book', icon: '▤', order: 6 },
    inaccuracy: { label: 'Inaccuracy', icon: '?!', order: 7 },
    mistake: { label: 'Mistake', icon: '?', order: 8 },
    blunder: { label: 'Blunder', icon: '??', order: 9 }
  };

  function loadSettings() {
    const defaults = {
      boardTheme: 'green',
      showLegal: true,
      showLast: true,
      sound: true,
      autoQueen: true,
      showEval: true,
      botLevel: 'martian',
      botSide: 'white',
      botTime: '600+0',
      brainMode: 'stockfish',
      aiEndpoint: 'https://api.openai.com/v1/chat/completions',
      aiModel: 'gpt-4o-mini',
      aiKey: ''
    };
    try {
      const raw = JSON.parse(localStorage.getItem(MC.SETTINGS_KEY) || '{}');
      return Object.assign(defaults, raw);
    } catch (e) {
      return defaults;
    }
  }

  function saveSettings() {
    try { localStorage.setItem(MC.SETTINGS_KEY, JSON.stringify(MC.state.settings)); } catch (e) {}
  }

  MC.state = {
    user: null,
    me: null,
    route: '',
    routeParam: null,
    pageToken: 0,
    settings: loadSettings(),
    sse: null,
    stats: null,
    auth: { mode: 'login', redirect: null, error: '', busy: false },
    bot: {
      game: null, levelId: loadSettings().botLevel, side: loadSettings().botSide,
      timeControl: loadSettings().botTime, thinking: false, token: 0, clock: null,
      hint: null, eval: 0, board: null, engineStatus: 'idle', resultShown: false,
      boardFlipped: false, engineError: '', aiStatus: 'idle', aiError: ''
    },
    online: {
      queue: null, queueSince: 0, game: null, gameId: null, chat: [], drawOffer: null,
      opponentOnline: true, clock: null, submitting: false, resultShown: false,
      board: null, loadedToken: 0, lobby: null, onlineUsers: [], lobbyError: ''
    },
    review: {
      token: 0, source: '', gameId: null, meta: null, moves: [], positions: [],
      analysis: null, index: 0, flipped: false, analyzing: false, progress: 0,
      done: false, error: '', gameOverShown: false, pgn: ''
    },
    modalOpen: false,
    modalOnClose: null,
    audioCtx: null
  };

  // -------------------------------------------------------------------------
  // DOM and text helpers
  // -------------------------------------------------------------------------

  const $ = MC.$ = (sel, root) => (root || document).querySelector(sel);
  const $$ = MC.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  MC.escapeHtml = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  MC.escapeAttr = MC.escapeHtml;

  MC.formatNumber = function (n) {
    try { return new Intl.NumberFormat().format(Number(n) || 0); } catch (e) { return String(n || 0); }
  };

  MC.initials = function (name) {
    const s = String(name || '?').trim();
    return (s ? s[0] : '?').toUpperCase();
  };

  MC.formatDate = function (ts) {
    const d = new Date(Number(ts) || Date.now());
    try {
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
    } catch (e) {
      return d.toLocaleDateString();
    }
  };

  MC.formatShortDate = function (ts) {
    const d = new Date(Number(ts) || Date.now());
    try {
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
    } catch (e) {
      return d.toLocaleDateString();
    }
  };

  MC.formatClock = function (ms) {
    if (ms == null || !Number.isFinite(Number(ms))) return '--:--';
    const safe = Math.max(0, Number(ms));
    if (safe < 20_000) {
      const secs = Math.floor(safe / 100) / 10;
      const m = Math.floor(secs / 60);
      const s = secs - m * 60;
      return `${m}:${s.toFixed(1).padStart(4, '0')}`;
    }
    const total = Math.max(0, Math.ceil(safe / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  MC.clockClass = function (ms) {
    if (ms == null) return '';
    return Number(ms) < 20_000 ? 'low' : '';
  };

  MC.timeControl = function (id) {
    return MC.TIME_MAP[id] || MC.TIME_MAP['600+0'];
  };

  MC.timeControlLabel = function (id) {
    if (!id) return '10+0';
    return MC.timeControl(id).label;
  };

  MC.timeControlName = function (id) {
    return MC.timeControl(id).name;
  };

  MC.formatDuration = function (seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  MC.formatEval = function (cp) {
    if (cp == null || !Number.isFinite(Number(cp))) return '0.0';
    const value = Number(cp) / 100;
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
  };

  MC.sleep = function (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  };

  MC.byId = id => document.getElementById(id);
  MC.moveCount = n => `${Number(n) || 0} move${Number(n) === 1 ? '' : 's'}`;

  MC.movesGridHtml = function (moves, currentPly) {
    const list = Array.isArray(moves) ? moves : [];
    if (!list.length) return '<div class="move-list empty">No moves yet</div>';
    let html = '<div class="moves-grid">';
    for (let i = 0; i < list.length; i += 2) {
      const row = Math.floor(i / 2);
      const white = list[i];
      const black = list[i + 1];
      const whiteSan = white == null ? '' : (typeof white === 'string' ? white : white.san);
      const blackSan = black == null ? '' : (typeof black === 'string' ? black : black.san);
      const whitePly = i + 1;
      const blackPly = i + 2;
      const fill = row % 2 === 1 ? 'row-fill' : '';
      html += `<div class="num">${row + 1}.</div>`;
      html += `<div class="mv ${fill} ${currentPly === whitePly ? 'current' : ''}" data-ply="${whitePly}" title="${MC.escapeHtml(whiteSan)}">${MC.escapeHtml(whiteSan)}</div>`;
      html += `<div class="mv ${fill} ${currentPly === blackPly ? 'current' : ''}" data-ply="${blackPly}" title="${MC.escapeHtml(blackSan)}">${MC.escapeHtml(blackSan)}</div>`;
    }
    return html + '</div>';
  };

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------

  MC.api = async function (path, options) {
    const opts = Object.assign({ credentials: 'same-origin' }, options || {});
    opts.headers = Object.assign({}, opts.headers || {});
    if (opts.body !== undefined && opts.body !== null && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data || {};
  };

  // -------------------------------------------------------------------------
  // Toasts, modals, sounds
  // -------------------------------------------------------------------------

  MC.toast = function (message, type, timeout) {
    const root = MC.byId('toastRoot');
    if (!root) return;
    const icon = type === 'success' ? '✓' : type === 'error' ? '!' : type === 'info' ? 'i' : '•';
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.innerHTML = `<span class="toast-icon">${icon}</span><span>${MC.escapeHtml(message)}</span>`;
    root.appendChild(el);
    const ms = timeout || (type === 'error' ? 4600 : 3200);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 220);
    }, ms);
  };

  MC.openModal = function (html, opts) {
    opts = opts || {};
    const root = MC.byId('modalRoot');
    if (!root) return;
    root.innerHTML = `<div class="modal-backdrop" data-modal-backdrop>
      <div class="modal ${opts.wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
        ${opts.hideClose ? '' : '<button type="button" class="btn btn-ghost btn-icon btn-sm modal-close" data-action="close-modal" aria-label="Close">✕</button>'}
        ${html}
      </div>
    </div>`;
    MC.state.modalOpen = true;
    MC.state.modalOnClose = opts.onClose || null;
    document.body.classList.add('modal-open');
    if (!opts.sticky) {
      const backdrop = root.querySelector('[data-modal-backdrop]');
      backdrop.addEventListener('click', event => {
        if (event.target === backdrop) MC.closeModal();
      });
    }
    setTimeout(() => {
      const focus = root.querySelector('input, select, textarea, .btn-primary, .btn');
      if (focus && typeof focus.focus === 'function') focus.focus({ preventScroll: true });
    }, 30);
  };

  MC.closeModal = function () {
    const root = MC.byId('modalRoot');
    const cb = MC.state.modalOnClose;
    MC.state.modalOnClose = null;
    MC.state.modalOpen = false;
    document.body.classList.remove('modal-open');
    if (root) root.innerHTML = '';
    if (cb) {
      try { cb(); } catch (e) { console.error(e); }
    }
  };

  MC.confirm = function (options) {
    options = options || {};
    return new Promise(resolve => {
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        MC.closeModal();
        resolve(value);
      };
      MC.openModal(`
        <h2>${MC.escapeHtml(options.title || 'Are you sure?')}</h2>
        <p>${MC.escapeHtml(options.message || '')}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="confirmNo">${MC.escapeHtml(options.cancelLabel || 'Cancel')}</button>
          <button type="button" class="btn ${options.danger ? 'btn-danger' : 'btn-primary'}" id="confirmYes">${MC.escapeHtml(options.confirmLabel || 'Confirm')}</button>
        </div>
      `, { sticky: false, onClose: () => finish(false) });
      const yes = MC.byId('confirmYes');
      const no = MC.byId('confirmNo');
      if (yes) yes.onclick = () => finish(true);
      if (no) no.onclick = () => finish(false);
    });
  };

  MC.promotionModal = function (candidates, callback) {
    const order = { 5: 0, 4: 1, 3: 2, 2: 3, 1: 4, 6: 5 };
    const sorted = candidates.slice().sort((a, b) => order[Math.abs(a.promotion)] - order[Math.abs(b.promotion)]);
    const names = { 5: 'Queen', 4: 'Rook', 3: 'Bishop', 2: 'Knight' };
    const buttons = sorted.map((move, i) => {
      const t = Math.abs(move.promotion);
      return `<button type="button" class="btn btn-secondary" data-promo-index="${i}" style="flex-direction:column; min-height:72px; font-size:.75rem">
        <span style="font-family:'Segoe UI Symbol',serif;font-size:2rem;color:${move.piece > 0 ? '#fff8ee' : '#221814'}">${E.GLYPHS[t]}</span>
        <span>${names[t] || 'Piece'}</span>
      </button>`;
    }).join('');
    MC.openModal(`<h2>Choose promotion</h2><p>Your pawn reached the last rank.</p><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:18px">${buttons}</div>`, { hideClose: true, sticky: true });
    const root = MC.byId('modalRoot');
    root.querySelectorAll('[data-promo-index]').forEach(btn => {
      btn.addEventListener('click', () => {
        const move = sorted[Number(btn.dataset.promoIndex)];
        MC.closeModal();
        callback(move);
      });
    });
  };

  MC.playSound = function (kind) {
    if (!MC.state.settings.sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!MC.state.audioCtx) MC.state.audioCtx = new AC();
      const ctx = MC.state.audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      const configs = {
        move: [420, 0.055, 'sine', 0.06],
        capture: [230, 0.09, 'triangle', 0.09],
        check: [720, 0.12, 'square', 0.055],
        start: [520, 0.13, 'sine', 0.07],
        end: [190, 0.3, 'sine', 0.085]
      };
      const cfg = configs[kind] || configs.move;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = cfg[2];
      osc.frequency.value = cfg[0];
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(cfg[3], ctx.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + cfg[1]);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + cfg[1] + 0.03);
    } catch (e) {}
  };

  // -------------------------------------------------------------------------
  // Navigation and account chrome
  // -------------------------------------------------------------------------

  MC.parseHash = function () {
    let raw = String(location.hash || '').replace(/^#\/?/, '');
    if (!raw) return { name: 'home', param: null };
    const parts = raw.split('/').filter(Boolean);
    const name = parts[0] || 'home';
    if (name === 'game') return { name: 'game', param: parts[1] || null };
    if (name === 'review') return { name: 'review', param: parts[1] || null };
    if (name === 'auth') return { name: 'auth', param: parts[1] || 'login' };
    return { name, param: parts[1] || null };
  };

  MC.navigate = function (path) {
    if (!path) return;
    const hash = path.startsWith('#') ? path : '#' + path.replace(/^\/+/, '');
    if (location.hash === hash) MC.renderRoute();
    else location.hash = hash;
  };

  MC.renderRoute = async function () {
    const route = MC.parseHash();
    MC.state.route = route.name;
    MC.state.routeParam = route.param || null;
    MC.state.pageToken++;
    const token = MC.state.pageToken;
    MC.closeModal();
    MC.closeAccountMenu();
    MC.closeMobileMenu();
    MC.updateNav();
    window.scrollTo({ top: 0, behavior: 'auto' });
    const titles = {
      home: 'MarsChess — Play Chess Online',
      play: 'Play a Bot — MarsChess',
      online: 'Play Online — MarsChess',
      game: 'Online Game — MarsChess',
      review: 'Game Review — MarsChess',
      leaderboard: 'Leaderboard — MarsChess',
      account: 'Your Account — MarsChess',
      auth: 'Sign In — MarsChess',
      learn: 'How to Play — MarsChess'
    };
    document.title = titles[route.name] || 'MarsChess';
    const renderer = MC.routes[route.name] || MC.routes.notfound;
    if (!renderer) {
      MC.renderError('Page not found', 'That page has not landed yet.');
      return;
    }
    try {
      await renderer(route, token);
    } catch (e) {
      console.error(e);
      if (token !== MC.state.pageToken) return;
      if (e && e.status === 401) {
        MC.state.user = null;
        MC.state.me = null;
        MC.updateNav();
        MC.state.auth.redirect = '#' + route.name;
        MC.renderAuthPage({ name: 'auth', param: 'login' }, token);
        return;
      }
      MC.renderError('Something went wrong', e && e.message ? e.message : 'Please try again.');
    }
  };

  MC.renderLoading = function (message) {
    const view = MC.byId('view');
    if (view) view.innerHTML = `<div class="loading-page"><span class="spinner"></span><span>${MC.escapeHtml(message || 'Loading…')}</span></div>`;
  };

  MC.renderError = function (title, message, code) {
    const view = MC.byId('view');
    if (!view) return;
    view.innerHTML = `<div class="error-page">
      <div class="error-code">${MC.escapeHtml(code || '♞')}</div>
      <h1>${MC.escapeHtml(title || 'Something went wrong')}</h1>
      <p>${MC.escapeHtml(message || 'Please try again.')}</p>
      <div class="row" style="justify-content:center;flex-wrap:wrap">
        <a class="btn btn-primary" href="#home">Back to home</a>
        <a class="btn btn-secondary" href="#online">Play online</a>
      </div>
    </div>`;
  };

  MC.setView = function (html) {
    const view = MC.byId('view');
    if (view) view.innerHTML = html;
    // Board instances in the old view are now detached. Drop their listeners
    // and references so long games and repeated analysis do not leak memory.
    for (const board of Array.from(MC.boards)) {
      if (!board.el || !board.el.isConnected) board.destroy();
    }
    return view;
  };

  MC.updateNav = function () {
    const route = MC.state.route;
    const active = route === 'play' ? 'play' : (route === 'online' || route === 'game' || route === 'review') ? 'online' : route === 'leaderboard' ? 'leaderboard' : route === 'learn' ? 'learn' : route === 'account' || route === 'auth' ? 'account' : '';
    $$('#navLinks a[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === active));
    const box = MC.byId('navAccount');
    if (!box) return;
    const user = MC.state.user;
    if (user) {
      const activeGame = MC.state.me && MC.state.me.activeGameId;
      box.innerHTML = `
        <button type="button" class="account-btn" data-action="toggle-account-menu" aria-expanded="false">
          <span class="account-avatar">${MC.escapeHtml(MC.initials(user.username))}</span>
          <span><span class="account-name" style="display:block">${MC.escapeHtml(user.username)}</span><span class="account-rating" style="display:block">${MC.formatNumber(user.rating)} Elo</span></span>
        </button>
        <div class="account-menu" id="accountMenu">
          <div class="account-menu-head"><strong>${MC.escapeHtml(user.username)}</strong><span>${MC.formatNumber(user.rating)} rating · ${user.wins}W ${user.losses}L ${user.draws}D</span></div>
          <a href="#account" data-close-menu>Your profile</a>
          ${activeGame ? `<a href="#game/${activeGame}" data-close-menu>Resume active game</a>` : '<a href="#online" data-close-menu>Find a game</a>'}
          <a href="#play" data-close-menu>Play a bot</a>
          <a href="#leaderboard" data-close-menu>Leaderboard</a>
          <button type="button" data-action="logout">Sign out</button>
        </div>`;
    } else {
      box.innerHTML = `
        <a class="btn btn-ghost btn-sm" href="#auth">Sign in</a>
        <a class="btn btn-primary btn-sm" href="#auth/register">Create account</a>`;
    }
  };

  MC.closeAccountMenu = function () {
    const menu = MC.byId('accountMenu');
    if (menu) menu.classList.remove('open');
    const btn = $('[data-action="toggle-account-menu"]');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  };

  MC.closeMobileMenu = function () {
    const links = MC.byId('navLinks');
    const btn = MC.byId('menuBtn');
    if (links) links.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  };

  MC.refreshMe = async function () {
    try {
      const data = await MC.api('/api/me');
      MC.state.user = data.user;
      MC.state.me = data;
      if (data.queue && MC.state.online) MC.state.online.queue = data.queue;
      MC.updateNav();
      return data;
    } catch (e) {
      if (e.status === 401) {
        MC.state.user = null;
        MC.state.me = null;
        MC.updateNav();
      }
      return null;
    }
  };

  MC.logout = async function () {
    try { await MC.api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    MC.state.user = null;
    MC.state.me = null;
    MC.state.online.queue = null;
    MC.state.online.queueSince = 0;
    MC.state.online.game = null;
    MC.state.online.gameId = null;
    if (MC.disconnectEvents) MC.disconnectEvents();
    MC.updateNav();
    MC.closeAccountMenu();
    MC.closeMobileMenu();
    MC.toast('Signed out.', 'info');
    MC.navigate('#home');
  };

  // -------------------------------------------------------------------------
  // Settings and board registry
  // -------------------------------------------------------------------------

  MC.applySettings = function () {
    for (const board of Array.from(MC.boards)) {
      if (!board || !board.el || !document.body.contains(board.el)) {
        MC.boards.delete(board);
        continue;
      }
      board.theme = MC.state.settings.boardTheme;
      board.showLegal = MC.state.settings.showLegal;
      board.showLast = MC.state.settings.showLast;
      board.autoQueen = MC.state.settings.autoQueen;
      board.applyTheme();
      board.render();
    }
    document.querySelectorAll('[data-eval-bar]').forEach(el => {
      el.classList.toggle('hidden', !MC.state.settings.showEval);
    });
  };

  MC.saveSettings = saveSettings;

  MC.copyText = async function (text) {
    const value = String(text == null ? '' : text);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (e) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return Boolean(ok);
    } catch (e) {
      return false;
    }
  };

  MC.setSetting = function (key, value) {
    MC.state.settings[key] = value;
    saveSettings();
    MC.applySettings();
  };

  MC.toggleSetting = function (key) {
    MC.setSetting(key, !MC.state.settings[key]);
    MC.rerenderBotIfNeeded && MC.rerenderBotIfNeeded();
  };

  // -------------------------------------------------------------------------
  // Result helpers
  // -------------------------------------------------------------------------

  MC.resultForUser = function (game, userId) {
    if (!game) return 'draw';
    if (game.status === 'aborted') return 'aborted';
    if (game.status === 'draw') return 'draw';
    const isWhite = game.white && Number(game.white.id) === Number(userId);
    const isBlack = game.black && Number(game.black.id) === Number(userId);
    if (!isWhite && !isBlack) return game.status === 'white_win' ? 'white' : 'black';
    if (game.status === 'white_win') return isWhite ? 'win' : 'loss';
    if (game.status === 'black_win') return isBlack ? 'win' : 'loss';
    return 'draw';
  };

  MC.resultText = function (game) {
    if (!game) return '';
    if (game.status === 'white_win') return 'White wins' + (game.reason ? ' by ' + String(game.reason).replace(/-/g, ' ') : '');
    if (game.status === 'black_win') return 'Black wins' + (game.reason ? ' by ' + String(game.reason).replace(/-/g, ' ') : '');
    if (game.status === 'draw') return 'Draw' + (game.reason ? ' by ' + String(game.reason).replace(/-/g, ' ') : '');
    if (game.status === 'aborted') return 'Game aborted';
    return 'Game in progress';
  };

  MC.playerAtBottom = function (game, user) {
    if (!user) return 'white';
    return Number(game.white.id) === Number(user.id) ? 'white' : 'black';
  };

  // -------------------------------------------------------------------------
  // Global events
  // -------------------------------------------------------------------------

  MC.registerAction = function (name, fn) {
    MC.actions[name] = fn;
  };

  MC.registerForm = function (name, fn) {
    MC.forms[name] = fn;
  };

  MC.registerChange = function (name, fn) {
    MC.changes[name] = fn;
  };

  MC.actions['close-modal'] = () => MC.closeModal();
  MC.actions['nav'] = el => MC.navigate(el.dataset.href || '#home');
  MC.actions['toggle-account-menu'] = el => {
    const menu = MC.byId('accountMenu');
    if (!menu) return;
    const open = menu.classList.toggle('open');
    if (el) el.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  MC.actions['logout'] = () => MC.logout();
  MC.actions['toggle-setting'] = el => {
    MC.setSetting(el.dataset.key, !MC.state.settings[el.dataset.key]);
    if (MC.rerenderBotIfNeeded) MC.rerenderBotIfNeeded();
  };
  MC.actions['set-board-theme'] = el => {
    MC.setSetting('boardTheme', el.dataset.theme || 'green');
    if (MC.rerenderBotIfNeeded) MC.rerenderBotIfNeeded();
  };

  MC.changes['setting'] = function (el) {
    const key = el.dataset.setting;
    if (!key) return;
    const value = el.type === 'checkbox' ? el.checked : el.value;
    MC.setSetting(key, value);
    if (key === 'botLevel' || key === 'botSide' || key === 'botTime') {
      if (MC.state.bot) {
        if (key === 'botLevel') MC.state.bot.levelId = value;
        if (key === 'botSide') MC.state.bot.side = value;
        if (key === 'botTime') MC.state.bot.timeControl = value;
      }
      if (MC.rerenderBotIfNeeded) MC.rerenderBotIfNeeded();
    }
  };

  function handleActionClick(event) {
    const el = event.target.closest('[data-action]');
    if (el) {
      const fn = MC.actions[el.dataset.action];
      if (fn) {
        event.preventDefault();
        try {
          const result = fn(el, event);
          if (result && typeof result.catch === 'function') result.catch(err => {
            console.error(err);
            MC.toast(err && err.message ? err.message : 'Something went wrong.', 'error');
          });
        } catch (err) {
          console.error(err);
          MC.toast(err && err.message ? err.message : 'Something went wrong.', 'error');
        }
        return;
      }
    }
    if (!event.target.closest('#navAccount')) MC.closeAccountMenu();
  }

  function handleFormSubmit(event) {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    const fn = MC.forms[form.dataset.form];
    if (!fn) return;
    event.preventDefault();
    try {
      const result = fn(form, event);
      if (result && typeof result.catch === 'function') result.catch(err => {
        console.error(err);
        MC.toast(err && err.message ? err.message : 'Something went wrong.', 'error');
      });
    } catch (err) {
      console.error(err);
      MC.toast(err && err.message ? err.message : 'Something went wrong.', 'error');
    }
  }

  function handleChange(event) {
    const el = event.target;
    if (!el || !el.matches) return;
    if (el.matches('[data-setting]')) {
      MC.changes.setting(el);
      return;
    }
    const key = el.dataset.change;
    if (key && MC.changes[key]) {
      try { MC.changes[key](el, event); } catch (err) { console.error(err); MC.toast(err.message || 'Unable to change that.', 'error'); }
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && MC.state.modalOpen) {
      MC.closeModal();
      return;
    }
    if (MC.onKeyDown) MC.onKeyDown(event);
  }

  document.addEventListener('click', handleActionClick);
  document.addEventListener('submit', handleFormSubmit);
  document.addEventListener('change', handleChange);
  document.addEventListener('keydown', handleKeyDown);
  window.addEventListener('hashchange', () => MC.renderRoute());

  // -------------------------------------------------------------------------
  // Startup
  // -------------------------------------------------------------------------

  MC.init = async function () {
    const year = MC.byId('footerYear');
    if (year) year.textContent = new Date().getFullYear();
    const menuBtn = MC.byId('menuBtn');
    if (menuBtn) {
      menuBtn.addEventListener('click', () => {
        const links = MC.byId('navLinks');
        const open = links.classList.toggle('open');
        menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    const navLinks = MC.byId('navLinks');
    if (navLinks) navLinks.addEventListener('click', () => MC.closeMobileMenu());
    document.addEventListener('click', event => {
      if (!event.target.closest('#navLinks') && !event.target.closest('#menuBtn')) MC.closeMobileMenu();
    });
    if (MC.initBot) MC.initBot();
    if (MC.initOnline) MC.initOnline();
    if (MC.initReview) MC.initReview();
    if (MC.initPages) MC.initPages();
    await MC.refreshMe();
    if (MC.state.user && MC.connectEvents) MC.connectEvents();
    if (!location.hash) {
      try { history.replaceState(null, '', '#home'); } catch (e) { location.hash = '#home'; }
    }
    await MC.renderRoute();
    if (MC.tickClocks) setInterval(() => MC.tickClocks(), 100);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      MC.init().catch(err => console.error(err));
    });
  } else {
    MC.init().catch(err => console.error(err));
  }
})();
