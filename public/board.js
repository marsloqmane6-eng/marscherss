/* MarsChess board renderer, chess-piece helpers, and Stockfish worker wrapper. */
(function () {
  'use strict';

  const MC = window.MC;
  const E = MC.E;

  // -------------------------------------------------------------------------
  // Position helpers
  // -------------------------------------------------------------------------

  MC.uciToSquares = function (uci) {
    if (!uci || uci.length < 4) return null;
    return {
      from: E.algToIdx(uci.slice(0, 2)),
      to: E.algToIdx(uci.slice(2, 4)),
      promotion: uci.length > 4 ? { q: 5, r: 4, b: 3, n: 2 }[uci[4].toLowerCase()] || null : null
    };
  };

  MC.moveFromUci = function (state, uci) {
    return E.legalMoves(state).find(m => E.moveToUci(m) === uci) || null;
  };

  MC.materialCounts = function (state) {
    const counts = { white: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, black: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } };
    for (let i = 0; i < 64; i++) {
      const p = state.b[i];
      if (!p) continue;
      const side = p > 0 ? 'white' : 'black';
      counts[side][Math.abs(p)]++;
    }
    return counts;
  };

  MC.materialBalance = function (state) {
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = state.b[i];
      if (!p) continue;
      score += (p > 0 ? 1 : -1) * (E.PIECE_VAL[Math.abs(p)] || 0);
    }
    return score / 100;
  };

  MC.capturedHtml = function (state, color) {
    const initial = { 1: 8, 2: 2, 3: 2, 4: 2, 5: 1, 6: 1 };
    const counts = MC.materialCounts(state);
    const opponent = color === 1 ? 'black' : 'white';
    const parts = [];
    for (let t = 1; t <= 5; t++) {
      const missing = Math.max(0, initial[t] - counts[opponent][t]);
      for (let i = 0; i < missing; i++) {
        const glyph = E.GLYPHS[t];
        if (opponent === 'black') {
          parts.push(`<span style="color:#241a16;text-shadow:0 0 1px rgba(255,255,255,.4)">${glyph}</span>`);
        } else {
          parts.push(`<span style="color:#fff8ee;text-shadow:0 0 1px rgba(0,0,0,.55)">${glyph}</span>`);
        }
      }
    }
    if (!parts.length) return '';
    let advantage = 0;
    const diff = MC.materialBalance(state);
    if (color === 1 && diff > 0) advantage = Math.round(diff);
    if (color === -1 && diff < 0) advantage = Math.round(-diff);
    return parts.join('') + (advantage > 0 ? ` <span style="font-family:var(--font);font-size:.62rem;color:#9fcf72;letter-spacing:0">+${advantage}</span>` : '');
  };

  MC.detectClientEnd = function (state, positionKeys) {
    const legal = E.legalMoves(state);
    if (!legal.length) {
      if (E.inCheck(state, state.turn)) {
        return { status: state.turn === 1 ? 'black_win' : 'white_win', reason: 'checkmate' };
      }
      return { status: 'draw', reason: 'stalemate' };
    }
    if (state.hm >= 100) return { status: 'draw', reason: '50-move rule' };
    if (E.insufficientMaterial(state)) return { status: 'draw', reason: 'insufficient material' };
    if (positionKeys && positionKeys.length) {
      const key = E.positionKey(state);
      let count = 0;
      for (const k of positionKeys) if (k === key) count++;
      if (count >= 3) return { status: 'draw', reason: 'threefold repetition' };
    }
    return null;
  };

  MC.resultWords = function (status, reason) {
    if (status === 'white_win') return 'White wins';
    if (status === 'black_win') return 'Black wins';
    if (status === 'draw') return 'Draw';
    if (status === 'aborted') return 'Game aborted';
    return 'Game in progress';
  };

  // -------------------------------------------------------------------------
  // Arrow overlay
  // -------------------------------------------------------------------------

  function squareCenter(idx, flipped) {
    const file = idx & 7;
    const rank = idx >> 3;
    const col = flipped ? 7 - file : file;
    const row = flipped ? 7 - rank : rank;
    return { x: (col + 0.5) * 12.5, y: (row + 0.5) * 12.5 };
  }

  MC.arrowSvg = function (move, flipped, kind) {
    if (!move) return '';
    const from = squareCenter(move.from, flipped);
    const to = squareCenter(move.to, flipped);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return '';
    const ux = dx / len;
    const uy = dy / len;
    const start = { x: from.x + ux * 4.2, y: from.y + uy * 4.2 };
    const end = { x: to.x - ux * 4.5, y: to.y - uy * 4.5 };
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const headSize = 4.4;
    const left = {
      x: end.x - headSize * Math.cos(angle - 0.52),
      y: end.y - headSize * Math.sin(angle - 0.52)
    };
    const right = {
      x: end.x - headSize * Math.cos(angle + 0.52),
      y: end.y - headSize * Math.sin(angle + 0.52)
    };
    const style = kind === 'hint' ? ' style="stroke:#7dd3fc;fill:#7dd3fc"' : '';
    return `<svg class="board-arrows" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <circle class="arrow-start" cx="${start.x}" cy="${start.y}" r="1.45"${style} />
      <line class="arrow-line" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}"${style} />
      <polygon class="arrow-head" points="${end.x},${end.y} ${left.x},${left.y} ${right.x},${right.y}"${style} />
    </svg>`;
  };

  // -------------------------------------------------------------------------
  // Board
  // -------------------------------------------------------------------------

  class Board {
    constructor(element, options) {
      this.el = typeof element === 'string' ? document.querySelector(element) : element;
      if (!this.el) throw new Error('Board container is missing');
      this.options = options || {};
      this.interactive = this.options.interactive !== false;
      this.onMove = this.options.onMove || null;
      this.onPromotion = this.options.onPromotion || null;
      this.onSelect = this.options.onSelect || null;
      this.state = this.options.state || E.initialState();
      this.flipped = !!this.options.flipped;
      this.lastMove = this.options.lastMove || null;
      this.hint = this.options.hint || null;
      this.arrow = this.options.arrow || null;
      this.arrowKind = this.options.arrowKind || 'best';
      this.selected = -1;
      this.targets = [];
      this.theme = this.options.theme || MC.state.settings.boardTheme || 'green';
      this.showLegal = this.options.showLegal !== undefined ? this.options.showLegal : MC.state.settings.showLegal;
      this.showLast = this.options.showLast !== undefined ? this.options.showLast : MC.state.settings.showLast;
      this.autoQueen = this.options.autoQueen !== undefined ? this.options.autoQueen : MC.state.settings.autoQueen;
      this.el.classList.add('board');
      this.el.setAttribute('role', 'grid');
      this.applyTheme();
      this.el.classList.toggle('noninteractive', !this.interactive);
      this._click = event => this.handleClick(event);
      this.el.addEventListener('click', this._click);
      MC.boards.add(this);
      this.render();
    }

    destroy() {
      if (!this.el) return;
      try { this.el.removeEventListener('click', this._click); } catch (e) {}
      MC.boards.delete(this);
      this.el = null;
    }

    applyTheme() {
      if (!this.el) return;
      for (const cls of ['theme-green', 'theme-mars', 'theme-ice', 'theme-night']) this.el.classList.remove(cls);
      this.el.classList.add('theme-' + (this.theme || 'green'));
    }

    setTheme(theme) {
      this.theme = theme;
      this.applyTheme();
    }

    setPosition(state, options) {
      options = options || {};
      this.state = state;
      if (options.flipped !== undefined) this.flipped = !!options.flipped;
      if (options.lastMove !== undefined) this.lastMove = options.lastMove;
      if (options.hint !== undefined) this.hint = options.hint;
      if (options.arrow !== undefined) this.arrow = options.arrow;
      if (options.arrowKind !== undefined) this.arrowKind = options.arrowKind;
      if (options.interactive !== undefined) {
        this.interactive = !!options.interactive;
        this.el.classList.toggle('noninteractive', !this.interactive);
      }
      this.selected = -1;
      this.targets = [];
      this.render();
    }

    setInteractive(value) {
      this.interactive = !!value;
      this.el.classList.toggle('noninteractive', !this.interactive);
      this.render();
    }

    setFlipped(value) {
      this.flipped = !!value;
      this.selected = -1;
      this.targets = [];
      this.render();
    }

    setHint(move) {
      this.hint = move || null;
      this.render();
    }

    setArrow(move, kind) {
      this.arrow = move || null;
      this.arrowKind = kind || 'best';
      this.render();
    }

    handleClick(event) {
      if (!this.interactive || !this.state) return;
      const square = event.target.closest('.sq');
      if (!square || !this.el.contains(square)) return;
      const idx = Number(square.dataset.idx);
      if (!Number.isInteger(idx)) return;
      const legal = E.legalMoves(this.state);
      if (this.selected >= 0) {
        const options = legal.filter(m => m.from === this.selected && m.to === idx);
        if (options.length) {
          this.chooseMove(options);
          return;
        }
      }
      const piece = this.state.b[idx];
      if (piece && Math.sign(piece) === this.state.turn) {
        if (idx === this.selected) {
          this.selected = -1;
          this.targets = [];
        } else {
          this.selected = idx;
          this.targets = legal.filter(m => m.from === idx);
          if (this.onSelect) this.onSelect(idx, this.targets);
        }
        this.render();
      } else {
        this.selected = -1;
        this.targets = [];
        this.render();
      }
    }

    chooseMove(candidates) {
      if (!candidates || !candidates.length) return;
      const isPromotion = candidates.length > 1 && candidates.some(m => m.promotion);
      if (isPromotion && !this.autoQueen && this.onPromotion) {
        this.onPromotion(candidates, move => {
          this.selected = -1;
          this.targets = [];
          this.render();
          if (this.onMove) this.onMove(move);
        });
        return;
      }
      let move = candidates[0];
      if (isPromotion) move = candidates.find(m => Math.abs(m.promotion) === 5) || candidates[0];
      this.selected = -1;
      this.targets = [];
      this.render();
      if (this.onMove) this.onMove(move);
    }

    render() {
      if (!this.el) return;
      const state = this.state || E.initialState();
      const legal = this.interactive ? E.legalMoves(state) : [];
      const selectedMoves = this.selected >= 0 ? legal.filter(m => m.from === this.selected) : [];
      let checkSquare = -1;
      if (E.inCheck(state, state.turn)) {
        const king = state.turn === 1 ? E.WK : E.BK;
        for (let i = 0; i < 64; i++) {
          if (state.b[i] === king) { checkSquare = i; break; }
        }
      }
      const lastFrom = this.lastMove ? (this.lastMove.from !== undefined ? this.lastMove.from : MC.uciToSquares(this.lastMove.uci || '')?.from) : undefined;
      const lastTo = this.lastMove ? (this.lastMove.to !== undefined ? this.lastMove.to : MC.uciToSquares(this.lastMove.uci || '')?.to) : undefined;
      const pieces = [];
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const idx = this.flipped ? (7 - row) * 8 + (7 - col) : row * 8 + col;
          const file = idx & 7;
          const rank = 7 - (idx >> 3);
          const isDark = (file + rank) % 2 === 0;
          const classes = ['sq', isDark ? 'dark' : 'light'];
          if (this.showLast && idx === lastFrom) classes.push('last-move');
          if (this.showLast && idx === lastTo) classes.push('last-move');
          if (idx === this.selected) classes.push('selected');
          const target = selectedMoves.find(m => m.to === idx);
          if (target) {
            classes.push('target');
            if (target.captured || target.epCapture) classes.push('capture');
          }
          if (this.hint && (idx === this.hint.from || idx === this.hint.to)) classes.push('hint');
          if (idx === checkSquare) classes.push('check');
          const p = state.b[idx];
          const piece = p ? `<span class="piece ${p > 0 ? 'white' : 'black'}" aria-hidden="true">${E.GLYPHS[Math.abs(p)]}</span>` : '';
          const coordFile = row === 7 ? `<span class="coord file">${String.fromCharCode(97 + file)}</span>` : '';
          const coordRank = col === 0 ? `<span class="coord rank">${rank + 1}</span>` : '';
          const label = `${E.idxToAlg(idx)}${p ? ' ' + (p > 0 ? 'white ' : 'black ') + E.pieceChar(p) : ' empty'}`;
          pieces.push(`<div class="${classes.join(' ')}" data-idx="${idx}" role="gridcell" aria-label="${label}">${coordFile}${coordRank}${piece}</div>`);
        }
      }
      const arrow = this.arrow ? MC.arrowSvg(this.arrow, this.flipped, this.arrowKind) : '';
      this.el.innerHTML = pieces.join('') + arrow;
    }
  }

  MC.Board = Board;

  // -------------------------------------------------------------------------
  // Stockfish 10 worker wrapper
  // -------------------------------------------------------------------------

  class StockfishEngine {
    constructor(label) {
      this.label = label || 'engine';
      this.worker = null;
      this.ready = false;
      this.initializing = null;
      this.failed = false;
      this.failedAt = 0;
      this.pending = null;
      this.waiters = [];
      this.lastInfo = { cp: 0, mate: null, depth: 0, pv: null };
      this.statusValue = 'idle';
      this.statusHandler = null;
    }

    status(value) {
      this.statusValue = value;
      if (this.statusHandler) {
        try { this.statusHandler(value); } catch (e) {}
      }
    }

    send(command) {
      if (this.worker) {
        try { this.worker.postMessage(command); } catch (e) { this.fail('Stockfish worker is not responding.'); }
      }
    }

    waitFor(regex, timeout) {
      return new Promise(resolve => {
        const waiter = { regex, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          resolve(false);
        }, timeout || 8000);
        this.waiters.push(waiter);
      });
    }

    onLine(line) {
      const text = String(line || '').trim();
      if (!text) return;
      for (const waiter of Array.from(this.waiters)) {
        if (waiter.regex.test(text)) {
          clearTimeout(waiter.timer);
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(true);
        }
      }
      if (text.startsWith('info ')) {
        const depth = text.match(/\bdepth (\d+)/);
        const cp = text.match(/\bscore cp (-?\d+)/);
        const mate = text.match(/\bscore mate (-?\d+)/);
        const pv = text.match(/\bpv (.+)$/);
        if (depth) this.lastInfo.depth = Number(depth[1]);
        if (cp) {
          this.lastInfo.cp = Number(cp[1]);
          this.lastInfo.mate = null;
        }
        if (mate) {
          this.lastInfo.mate = Number(mate[1]);
          this.lastInfo.cp = Number(mate[1]) > 0 ? 100000 - Number(mate[1]) * 100 : -100000 + Math.abs(Number(mate[1])) * 100;
        }
        if (pv) this.lastInfo.pv = pv[1].split(' ').slice(0, 8).join(' ');
        return;
      }
      if (text.startsWith('bestmove')) {
        const parts = text.split(/\s+/);
        const best = parts[1] && parts[1] !== '(none)' && parts[1] !== '0000' ? parts[1] : null;
        const pending = this.pending;
        if (pending) {
          this.pending = null;
          clearTimeout(pending.timer);
          pending.resolve(Object.assign({ best }, this.lastInfo));
        }
      }
    }

    onMessage(data) {
      const raw = String(data || '');
      for (const line of raw.split(/\r?\n/)) this.onLine(line);
    }

    fail(message) {
      this.failed = true;
      this.failedAt = Date.now();
      this.ready = false;
      this.status('error');
      if (this.pending) {
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        pending.resolve(null);
      }
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.resolve(false);
      }
      if (this.worker) {
        try { this.worker.terminate(); } catch (e) {}
        this.worker = null;
      }
      console.warn(`[${this.label}] ${message || 'Stockfish unavailable'}`);
    }

    async init() {
      if (this.ready) return true;
      if (this.initializing) return this.initializing;
      if (this.failed && Date.now() - this.failedAt < 45_000) return false;
      this.failed = false;
      this.status('loading');
      this.initializing = (async () => {
        try {
          const res = await fetch(MC.STOCKFISH_URL, { mode: 'cors', cache: 'force-cache' });
          if (!res.ok) throw new Error('Could not download the chess engine.');
          const source = await res.text();
          const blob = new Blob([source], { type: 'application/javascript' });
          const url = URL.createObjectURL(blob);
          const worker = new Worker(url);
          this.worker = worker;
          worker.onmessage = event => this.onMessage(event.data);
          worker.onerror = event => {
            console.error('Stockfish worker error', event);
            this.fail('The chess engine stopped unexpectedly.');
          };
          this.send('uci');
          const uciOk = await this.waitFor(/^uciok/, 12_000);
          if (!uciOk) throw new Error('The chess engine did not start.');
          // This asm.js build aborts if Hash or Threads are reconfigured after
          // startup, so keep the defaults and only set the playing strength.
          this.send('setoption name Skill Level value 20');
          this.send('isready');
          const readyOk = await this.waitFor(/^readyok/, 8000);
          if (!readyOk) throw new Error('The chess engine did not respond.');
          this.ready = true;
          this.status('ready');
          return true;
        } catch (error) {
          console.warn(`[${this.label}]`, error);
          this.fail(error.message || 'Stockfish unavailable');
          return false;
        } finally {
          this.initializing = null;
        }
      })();
      return this.initializing;
    }

    cancel() {
      const pending = this.pending;
      if (pending) {
        this.pending = null;
        clearTimeout(pending.timer);
        if (this.ready) this.send('stop');
        pending.resolve(Object.assign({ best: null }, this.lastInfo));
      }
    }

    _go(fen, movetime, skill) {
      if (!this.ready) return Promise.resolve(null);
      this.cancel();
      this.lastInfo = { cp: 0, mate: null, depth: 0, pv: null };
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          if (!this.pending) return;
          this.send('stop');
          const pending = this.pending;
          this.pending = null;
          clearTimeout(pending.timer);
          pending.resolve(Object.assign({ best: null }, this.lastInfo));
        }, Math.max(1500, movetime + 8000));
        this.pending = { resolve, timer };
        this.send(`setoption name Skill Level value ${skill == null ? 20 : skill}`);
        this.send(`position fen ${fen}`);
        this.send(`go movetime ${Math.max(20, movetime)}`);
      });
    }

    async bestMove(fen, movetime, skill) {
      const ok = await this.init();
      if (!ok) return null;
      return this._go(fen, movetime, skill);
    }

    async analyze(fen, movetime) {
      const ok = await this.init();
      if (!ok) return null;
      return this._go(fen, movetime, 20);
    }

    newGame() {
      this.cancel();
      if (this.ready) {
        this.send('ucinewgame');
        this.send('isready');
      }
    }

    quit() {
      this.cancel();
      if (this.worker) {
        try { this.worker.terminate(); } catch (e) {}
      }
      this.worker = null;
      this.ready = false;
      this.status('idle');
    }
  }

  MC.StockfishEngine = StockfishEngine;
  MC.botEngine = new StockfishEngine('bot');
  MC.reviewEngine = new StockfishEngine('review');

  // -------------------------------------------------------------------------
  // Evaluation bar
  // -------------------------------------------------------------------------

  MC.evalPercent = function (cp) {
    const value = Math.max(-1000, Math.min(1000, Number(cp) || 0));
    return 100 / (1 + Math.exp(-value / 320));
  };

  MC.updateEvalBar = function (container, cp) {
    if (!container) return;
    const fill = container.querySelector('.eval-fill');
    if (fill) fill.style.height = Math.max(4, Math.min(96, MC.evalPercent(cp))) + '%';
  };
})();
