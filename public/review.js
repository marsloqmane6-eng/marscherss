/* MarsChess game review: Stockfish analysis, accuracy, eval graph, and move-by-move replay. */
(function () {
  'use strict';

  const MC = window.MC;
  const E = MC.E;
  const state = MC.state;

  const CLASS_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];
  const BOOK = new Set([
    'e2e4', 'd2d4', 'c2c4', 'g1f3', 'b2b3', 'f2f4',
    'e7e5', 'c7c5', 'e7e6', 'c7c6', 'd7d5', 'g8f6', 'd7d6', 'b8c6',
    'f1b5', 'f1c4', 'b1c3', 'c2c3', 'd2d3', 'g2g3',
    'b8c6', 'g8f6', 'f8b4', 'f8e7', 'f8c5', 'c8g4', 'c8f5',
    'e1g1', 'e1c1', 'e8g8', 'e8c8'
  ]);

  function isReviewRoute(review) {
    if (state.route !== 'review') return false;
    if (!state.routeParam) return true;
    return review.gameId && Number(state.routeParam) === Number(review.gameId);
  }

  function prepareNewReview(review) {
    if (state.review && state.review.analyzing) {
      state.review.analysisToken = (state.review.analysisToken || 0) + 1;
      MC.reviewEngine.cancel();
    }
    state.review = review;
  }

  // -------------------------------------------------------------------------
  // Building review records
  // -------------------------------------------------------------------------

  function replay(uciMoves, initialFen) {
    let current = E.fromFEN(initialFen || E.toFEN(E.initialState()));
    const result = [];
    for (const item of uciMoves || []) {
      const uci = typeof item === 'string' ? item : item.uci;
      const move = E.uciToMove(current, uci);
      if (!move) break;
      const beforeFen = E.toFEN(current);
      const color = current.turn;
      const san = (item && item.san) || E.moveToSan(move, current);
      const after = E.applyMove(current, move);
      result.push({
        uci,
        san,
        color,
        from: move.from,
        to: move.to,
        promotion: move.promotion || null,
        fenBefore: beforeFen,
        fenAfter: E.toFEN(after)
      });
      current = after;
    }
    return { moves: result, finalState: current };
  }

  function baseReview(source, gameId, meta, moves, initialFen, flipped) {
    return {
      source,
      gameId,
      meta,
      moves,
      initialFen: initialFen || E.toFEN(E.initialState()),
      flipped: Boolean(flipped),
      index: 0,
      analysis: null,
      analyzing: false,
      done: false,
      progress: 0,
      progressText: '',
      error: '',
      analysisToken: 0
    };
  }

  function buildBotReview() {
    const game = state.bot.game;
    if (!game) return null;
    const level = MC.BOT_MAP[game.levelId] || MC.BOT_LEVELS[3];
    const replayResult = replay(game.moves.map(m => ({ uci: m.uci, san: m.san })), E.toFEN(E.initialState()));
    const playerColor = game.playerColor;
    const userName = state.user ? state.user.username : 'You';
    const meta = {
      whiteName: playerColor === 1 ? userName : `${level.name} Bot`,
      blackName: playerColor === -1 ? userName : `${level.name} Bot`,
      whiteRating: playerColor === 1 ? (state.user ? state.user.rating : 1200) : level.rating,
      blackRating: playerColor === -1 ? (state.user ? state.user.rating : 1200) : level.rating,
      status: game.status,
      reason: game.reason,
      result: game.status === 'draw' ? 'Draw' : game.status === 'white_win' ? 'White wins' : game.status === 'black_win' ? 'Black wins' : 'Game aborted',
      timeControl: game.timeControl,
      date: game.startedAt,
      userColor: playerColor,
      sourceLabel: 'Bot game'
    };
    if (game.reason && game.status !== 'aborted') meta.result += ` by ${String(game.reason).replace(/-/g, ' ')}`;
    return baseReview('bot', null, meta, replayResult.moves, E.toFEN(E.initialState()), playerColor === -1);
  }

  function buildOnlineReview(game) {
    const replayResult = replay(game.moves.map(m => ({ uci: m.uci, san: m.san })), E.toFEN(E.initialState()));
    let userColor = 0;
    if (state.user) {
      if (Number(game.white.id) === Number(state.user.id)) userColor = 1;
      else if (Number(game.black.id) === Number(state.user.id)) userColor = -1;
    }
    const meta = {
      whiteName: game.white.username,
      blackName: game.black.username,
      whiteRating: game.white.rating,
      blackRating: game.black.rating,
      status: game.status,
      reason: game.reason,
      result: game.result || MC.resultText(game),
      timeControl: game.timeControl,
      date: game.createdAt,
      userColor,
      sourceLabel: 'Online game'
    };
    return baseReview('online', game.id, meta, replayResult.moves, E.toFEN(E.initialState()), userColor === -1);
  }

  // -------------------------------------------------------------------------
  // Analysis
  // -------------------------------------------------------------------------

  function detectOpening(moves) {
    const u = moves.map(m => m.uci);
    const at = i => u[i] || '';
    if (at(0) === 'e2e4') {
      if (at(1) === 'c7c5') {
        if (at(2) === 'g1f3' && at(3) === 'd7d6') return 'Sicilian Defense';
        return 'Sicilian Defense';
      }
      if (at(1) === 'e7e5') {
        if (at(2) === 'g1f3') {
          if (at(3) === 'b8c6') {
            if (at(4) === 'f1b5') return 'Ruy López';
            if (at(4) === 'f1c4') return 'Italian Game';
            if (at(4) === 'd2d4') return 'Scotch Game';
          }
          return "King's Knight Opening";
        }
        if (at(2) === 'f1c4') return "Bishop's Opening";
        if (at(2) === 'b1c3') return 'Vienna Game';
        return "King's Pawn Game";
      }
      if (at(1) === 'e7e6') return 'French Defense';
      if (at(1) === 'c7c6') return 'Caro-Kann Defense';
      if (at(1) === 'd7d5') return 'Scandinavian Defense';
      if (at(1) === 'g8f6') return 'Alekhine Defense';
      return "King's Pawn Game";
    }
    if (at(0) === 'd2d4') {
      if (at(1) === 'd7d5') {
        if (at(2) === 'c2c4') return "Queen's Gambit";
        return "Queen's Pawn Game";
      }
      if (at(1) === 'g8f6') {
        if (at(2) === 'c2c4') {
          if (at(3) === 'g7g6') return "King's Indian Defense";
          if (at(3) === 'e7e6') return 'Nimzo-Indian Defense';
          return 'Indian Game';
        }
        return 'Indian Defense';
      }
      return "Queen's Pawn Game";
    }
    if (at(0) === 'c2c4') return 'English Opening';
    if (at(0) === 'g1f3') return 'Réti Opening';
    if (at(0) === 'b2b3') return 'Nimzo-Larsen Attack';
    if (at(0) === 'f2f4') return "Bird's Opening";
    return 'Standard game';
  }

  function fallbackAnalysis(stateBefore, time) {
    let best = null;
    try {
      best = E.findBestMove(stateBefore, { depth: 3, timeLimit: time || 45 });
    } catch (e) {}
    return {
      best: best ? E.moveToUci(best) : null,
      cp: E.sideEval(stateBefore),
      mate: null,
      depth: 0
    };
  }

  function positionRecord(stateBefore, result) {
    const cp = result && Number.isFinite(Number(result.cp)) ? Number(result.cp) : 0;
    const mate = result && result.mate != null ? Number(result.mate) : null;
    const evalWhite = stateBefore.turn === 1 ? cp : -cp;
    return {
      fen: E.toFEN(stateBefore),
      evalWhite,
      best: result && result.best ? result.best : null,
      depth: result && result.depth ? Number(result.depth) : 0,
      mate: stateBefore.turn === 1 ? mate : (mate == null ? null : -mate)
    };
  }

  async function runReviewAnalysis(review) {
    if (!review || review.analyzing) return;
    const token = ++review.analysisToken;
    review.analyzing = true;
    review.done = false;
    review.error = '';
    review.analysis = null;
    review.progress = 0;
    review.progressText = 'Preparing the engine…';
    review.index = 0;
    if (isReviewRoute(review)) renderReviewProgress(review);

    const total = review.moves.length + 1;
    let engineReady = false;
    let fallbackUsed = false;
    const positions = [];
    try {
      review.progressText = 'Loading Stockfish…';
      updateProgressUI(review);
      engineReady = await MC.reviewEngine.init();
      if (token !== review.analysisToken) return;
      if (!engineReady) {
        fallbackUsed = true;
        review.progressText = 'Using the built-in analysis engine…';
        updateProgressUI(review);
      }
      const movetime = review.moves.length > 100 ? 55 : review.moves.length > 60 ? 70 : 100;
      for (let i = 0; i < total; i++) {
        if (token !== review.analysisToken) return;
        const fen = i === 0 ? review.initialFen : review.moves[i - 1].fenAfter;
        const stateBefore = E.fromFEN(fen);
        let result = null;
        const legal = E.legalMoves(stateBefore);
        if (!legal.length) {
          result = { best: null, cp: E.inCheck(stateBefore, stateBefore.turn) ? -100000 : 0, mate: null, depth: 0 };
        } else if (engineReady) {
          result = await MC.reviewEngine.analyze(fen, movetime);
          if (token !== review.analysisToken) return;
          if (!result || !result.best) {
            fallbackUsed = true;
            result = fallbackAnalysis(stateBefore, 45);
          }
        } else {
          fallbackUsed = true;
          result = fallbackAnalysis(stateBefore, 45);
        }
        positions.push(positionRecord(stateBefore, result));
        review.progress = Math.round(((i + 1) / total) * 100);
        review.progressText = `Position ${i + 1} of ${total} · ${stateBefore.turn === 1 ? 'White' : 'Black'} to move`;
        updateProgressUI(review);
        if (!engineReady) await MC.sleep(0);
      }
      if (token !== review.analysisToken) return;

      const moves = [];
      const counts = {
        white: Object.fromEntries(CLASS_ORDER.map(k => [k, 0])),
        black: Object.fromEntries(CLASS_ORDER.map(k => [k, 0]))
      };
      const accuracyStats = { white: { sum: 0, count: 0 }, black: { sum: 0, count: 0 } };
      for (let i = 0; i < review.moves.length; i++) {
        const m = review.moves[i];
        const before = positions[i];
        const after = positions[i + 1];
        if (!before || !after) continue;
        const stateBefore = E.fromFEN(m.fenBefore);
        const stateAfter = E.fromFEN(m.fenAfter);
        const moveObj = E.uciToMove(stateBefore, m.uci);
        const sign = m.color === 1 ? 1 : -1;
        const exactBest = Boolean(before.best && before.best === m.uci);
        let cpLoss = exactBest ? 0 : sign * (before.evalWhite - after.evalWhite);
        cpLoss = Math.max(0, Math.min(2000, cpLoss));
        // Opening-book labels should never turn a game-losing move into a
        // perfect "book" move just because the same UCI move appears in the
        // opening table.
        const isBook = i < 8 && BOOK.has(m.uci) && cpLoss <= 130;
        if (isBook) cpLoss = 0;
        const bestMoveObj = before.best ? E.uciToMove(stateBefore, before.best) : null;
        const bestSan = bestMoveObj ? E.moveToSan(bestMoveObj, stateBefore) : '';
        const givesCheck = moveObj ? E.inCheck(stateAfter, stateAfter.turn) : false;
        const captureValue = moveObj && moveObj.captured ? (E.PIECE_VAL[Math.abs(moveObj.captured)] || 0) : 0;
        const matBefore = sign * MC.materialBalance(stateBefore);
        const matAfter = sign * MC.materialBalance(stateAfter);
        const sacrifice = matAfter - matBefore <= -1.5;
        const stillGood = sign * after.evalWhite >= 120;
        let cls;
        if (isBook) cls = 'book';
        else if (exactBest && sacrifice && stillGood) cls = 'brilliant';
        else if (exactBest && (givesCheck || captureValue >= 300)) cls = 'great';
        else if (exactBest) cls = 'best';
        else if (cpLoss <= 8) cls = 'excellent';
        else if (cpLoss <= 25) cls = 'good';
        else if (cpLoss <= 60) cls = 'inaccuracy';
        else if (cpLoss <= 130) cls = 'mistake';
        else cls = 'blunder';
        const accuracy = isBook || exactBest ? 100 : Math.max(0, 100 * Math.exp(-cpLoss / 300));
        const key = m.color === 1 ? 'white' : 'black';
        counts[key][cls]++;
        accuracyStats[key].sum += accuracy;
        accuracyStats[key].count++;
        moves.push({
          ply: i + 1,
          color: m.color,
          san: m.san,
          uci: m.uci,
          bestUci: before.best,
          bestSan,
          cpLoss,
          class: cls,
          accuracy,
          evalWhiteBefore: before.evalWhite,
          evalWhiteAfter: after.evalWhite,
          fenBefore: m.fenBefore,
          fenAfter: m.fenAfter
        });
      }

      const accuracy = {
        white: accuracyStats.white.count ? accuracyStats.white.sum / accuracyStats.white.count : 100,
        black: accuracyStats.black.count ? accuracyStats.black.sum / accuracyStats.black.count : 100
      };
      const keyMoments = moves
        .filter(m => m.class !== 'book' && m.cpLoss >= 40 && m.bestSan && m.bestSan !== m.san)
        .sort((a, b) => b.cpLoss - a.cpLoss)
        .slice(0, 5);
      review.analysis = {
        positions,
        moves,
        accuracy,
        counts,
        keyMoments,
        opening: detectOpening(review.moves),
        fallbackUsed,
        engineReady,
        analyzedAt: Date.now()
      };
      review.analyzing = false;
      review.done = true;
      review.progress = 100;
      review.progressText = 'Analysis complete.';
      review.index = review.moves.length;
      if (isReviewRoute(review)) renderReviewPage();
    } catch (e) {
      console.error(e);
      if (token !== review.analysisToken) return;
      review.analyzing = false;
      review.error = e.message || 'Analysis failed.';
      review.progressText = 'Analysis failed.';
      if (isReviewRoute(review)) renderReviewPage();
    }
  }

  function startAnalysis(review) {
    if (!review) return;
    if (review.analyzing) {
      if (isReviewRoute(review)) renderReviewProgress(review);
      return;
    }
    if (review.analysis && review.done) {
      if (isReviewRoute(review)) renderReviewPage();
      return;
    }
    runReviewAnalysis(review);
  }

  // -------------------------------------------------------------------------
  // Progress UI
  // -------------------------------------------------------------------------

  function progressHeader(review) {
    const meta = review.meta;
    return `<div class="review-header">
      <div>
        <span class="eyebrow">Game review</span>
        <h1>${MC.escapeHtml(meta.whiteName)} <span class="muted" style="font-weight:500">vs</span> ${MC.escapeHtml(meta.blackName)}</h1>
        <p>${MC.escapeHtml(meta.result)} · ${MC.escapeHtml(MC.timeControlLabel(meta.timeControl))} ${MC.escapeHtml(MC.timeControlName(meta.timeControl))} · ${MC.moveCount(review.moves.length)}</p>
      </div>
      <div class="review-actions">
        <a class="btn btn-ghost btn-sm" href="${review.source === 'online' ? '#game/' + review.gameId : '#play'}">← Back</a>
      </div>
    </div>`;
  }

  function renderReviewProgress(review) {
    MC.setView(`
      <div class="review-page">
        ${progressHeader(review)}
        <div class="panel review-progress">
          <span class="spinner"></span>
          <h2>Analyzing every move…</h2>
          <p>Stockfish is evaluating both sides of the board. Accuracy, best moves, mistakes, and the evaluation graph will appear when it is done.</p>
          <div class="progress-track"><div class="progress-fill" id="reviewProgressFill" style="width:${review.progress || 0}%"></div></div>
          <div class="progress-meta"><span id="reviewProgressText">${MC.escapeHtml(review.progressText || 'Preparing…')}</span><span id="reviewProgressPct">${Math.round(review.progress || 0)}%</span></div>
          <button type="button" class="btn btn-ghost btn-sm" data-action="review-cancel">Cancel analysis</button>
        </div>
      </div>`);
  }

  function updateProgressUI(review) {
    if (!isReviewRoute(review)) return;
    const fill = MC.byId('reviewProgressFill');
    const text = MC.byId('reviewProgressText');
    const pct = MC.byId('reviewProgressPct');
    if (fill) fill.style.width = `${review.progress || 0}%`;
    if (text) text.textContent = review.progressText || 'Analyzing…';
    if (pct) pct.textContent = `${Math.round(review.progress || 0)}%`;
  }

  // -------------------------------------------------------------------------
  // Review UI
  // -------------------------------------------------------------------------

  function classIcon(cls, extra) {
    const meta = MC.CLASS_META[cls] || MC.CLASS_META.good;
    return `<span class="class-icon ${cls} ${extra || ''}" title="${meta.label}" aria-label="${meta.label}">${meta.icon}</span>`;
  }

  function evalGraph(review) {
    const analysis = review.analysis;
    if (!analysis || analysis.positions.length === 0) return '';
    const positions = analysis.positions;
    const n = positions.length;
    const xAt = i => n > 1 ? (i / (n - 1)) * 100 : 50;
    const yAt = cp => 23 - Math.max(-1, Math.min(1, Number(cp) / 600)) * 19;
    const pts = positions.map((p, i) => ({ x: xAt(i), y: yAt(p.evalWhite) }));
    const line = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    const area = `M ${pts[0].x.toFixed(2)} 23 ` + pts.map(p => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ` L ${pts[pts.length - 1].x.toFixed(2)} 23 Z`;
    const dots = pts.map((p, i) => {
      const cls = i > 0 && analysis.moves[i - 1] ? analysis.moves[i - 1].class : '';
      const active = i === review.index ? 'active' : '';
      const title = i === 0 ? 'Starting position' : `Move ${analysis.moves[i - 1].ply}: ${analysis.moves[i - 1].san} (${MC.CLASS_META[analysis.moves[i - 1].class].label})`;
      return `<circle class="graph-point ${cls} ${active}" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="1.5" data-action="review-goto" data-ply="${i}"><title>${MC.escapeHtml(title)}</title></circle>`;
    }).join('');
    return `<svg class="review-graph" viewBox="0 0 100 46" preserveAspectRatio="none" role="img" aria-label="Evaluation graph">
      <rect class="graph-bg" x="0" y="0" width="100" height="46" rx="2"></rect>
      <line class="graph-mid" x1="0" y1="23" x2="100" y2="23"></line>
      <path class="graph-area" d="${area}"></path>
      <path class="graph-line" d="${line}"></path>
      ${dots}
      <text class="graph-axis" x="98" y="6" text-anchor="end">White</text>
      <text class="graph-axis" x="98" y="43" text-anchor="end">Black</text>
    </svg>`;
  }

  function classificationColumn(name, counts) {
    const rows = CLASS_ORDER.filter(k => counts[k] > 0).map(k => `<div class="review-class-row">${classIcon(k)}<span>${MC.CLASS_META[k].label}</span><span class="count">${counts[k]}</span></div>`).join('');
    return `<div class="review-class-col"><div class="review-class-heading">${MC.escapeHtml(name)}</div>${rows || '<div class="review-class-row muted">No moves</div>'}</div>`;
  }

  function moveRows(review) {
    const analysis = review.analysis;
    return analysis.moves.map((m, i) => {
      const num = Math.ceil(m.ply / 2);
      const active = review.index === m.ply ? 'active' : '';
      const meta = MC.CLASS_META[m.class];
      const loss = m.cpLoss > 0 ? `−${(m.cpLoss / 100).toFixed(1)}` : '—';
      const rowTitle = m.class === 'book' ? 'Book move' : `Best: ${MC.escapeHtml(m.bestSan || '—')} · Loss: ${loss}`;
      return `<div class="review-move-row ${active}" data-action="review-goto" data-ply="${m.ply}" title="${rowTitle}">
        <span class="rm-num">${num}${m.ply % 2 === 1 ? '.' : '…'}</span>
        ${classIcon(m.class)}
        <span class="rm-san">${MC.escapeHtml(m.san)}</span>
        <span class="rm-meta ${m.class === 'blunder' || m.class === 'mistake' ? 'rm-loss' : ''}">${meta.label}</span>
      </div>`;
    }).join('');
  }

  function keyMoments(review) {
    const moments = review.analysis.keyMoments;
    if (!moments.length) return '<div class="lobby-empty">No major mistakes found. A clean game.</div>';
    return moments.map(m => `<button type="button" class="keymoment" data-action="review-goto" data-ply="${m.ply}">
      ${classIcon(m.class)}
      <span class="km-main"><strong>${Math.ceil(m.ply / 2)}${m.ply % 2 ? '.' : '…'} ${MC.escapeHtml(m.san)}</strong><span>${MC.CLASS_META[m.class].label} · best ${MC.escapeHtml(m.bestSan || '—')}</span></span>
    </button>`).join('');
  }

  function reviewBoardState(review) {
    const pos = review.analysis.positions[review.index] || review.analysis.positions[0];
    const before = E.fromFEN(pos.fen);
    let arrow = null;
    if (review.index < review.moves.length && pos.best) {
      const move = E.uciToMove(before, pos.best);
      if (move) arrow = move;
    }
    const prev = review.index > 0 ? review.moves[review.index - 1] : null;
    return {
      state: before,
      arrow,
      lastMove: prev ? { from: prev.from, to: prev.to } : null,
      current: review.index > 0 ? review.analysis.moves[review.index - 1] : null,
      next: review.index < review.moves.length ? review.analysis.moves[review.index] : null
    };
  }

  function bestLineHtml(review, boardInfo) {
    if (boardInfo.next) {
      if (boardInfo.next.class === 'book') {
        return `<span class="best-icon">▤</span><span>Book move: <strong>${MC.escapeHtml(boardInfo.next.san)}</strong></span>`;
      }
      const matches = boardInfo.next.san === boardInfo.next.bestSan;
      return `<span class="best-icon">✦</span><span>Best move here: <strong>${MC.escapeHtml(boardInfo.next.bestSan || '—')}</strong>${!matches ? ` <span class="muted">· played ${MC.escapeHtml(boardInfo.next.san)}</span>` : ' <span class="muted">· matches the game</span>'}</span>`;
    }
    if (boardInfo.current && boardInfo.current.class === 'book') {
      return `<span class="best-icon">▤</span><span>Book move: <strong>${MC.escapeHtml(boardInfo.current.san)}</strong></span>`;
    }
    if (boardInfo.current && boardInfo.current.bestSan && boardInfo.current.bestSan !== boardInfo.current.san) {
      return `<span class="best-icon">✦</span><span>Best was: <strong>${MC.escapeHtml(boardInfo.current.bestSan)}</strong> <span class="muted">· played ${MC.escapeHtml(boardInfo.current.san)}</span></span>`;
    }
    return '';
  }

  function pgnForReview(review) {
    const meta = review.meta;
    const result = meta.status === 'white_win' ? '1-0' : meta.status === 'black_win' ? '0-1' : meta.status === 'draw' ? '1/2-1/2' : '*';
    const date = new Date(Number(meta.date) || Date.now());
    const dateText = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
    const headers = [
      '[Event "MarsChess Game Review"]',
      '[Site "MarsChess"]',
      `[Date "${dateText}"]`,
      `[White "${meta.whiteName}"]`,
      `[Black "${meta.blackName}"]`,
      `[Result "${result}"]`,
      `[TimeControl "${meta.timeControl}"]`
    ].join('\n');
    let body = '';
    for (let i = 0; i < review.moves.length; i += 2) {
      body += `${Math.floor(i / 2) + 1}. ${review.moves[i].san}`;
      if (review.moves[i + 1]) body += ` ${review.moves[i + 1].san}`;
      body += ' ';
    }
    return `${headers}\n\n${body}${result}\n`;
  }

  function renderReviewPage() {
    const review = state.review;
    if (!review) { renderReviewEmpty(); return; }
    if (review.analyzing) { renderReviewProgress(review); return; }
    if (review.error) { renderReviewError(review); return; }
    if (!review.analysis) {
      if (review.moves && review.moves.length) startAnalysis(review);
      else renderReviewEmpty();
      return;
    }
    const analysis = review.analysis;
    if (review.index < 0) review.index = 0;
    if (review.index >= analysis.positions.length) review.index = analysis.positions.length - 1;
    const boardInfo = reviewBoardState(review);
    const meta = review.meta;
    const userColor = meta.userColor;
    const accuracyWhite = Math.round(analysis.accuracy.white);
    const accuracyBlack = Math.round(analysis.accuracy.black);
    const engineNote = analysis.fallbackUsed ? 'Built-in engine' : 'Stockfish 10';
    const current = boardInfo.current;
    const moveLabel = current ? `${MC.CLASS_META[current.class].label} · move ${current.ply}` : 'Starting position';
    const currentLine = current
      ? `<span class="current-class">${classIcon(current.class)}<span>${moveLabel}</span></span><span>${MC.escapeHtml(current.san)} · ${current.color === 1 ? 'White' : 'Black'}</span>`
      : `<span>Starting position</span><span>${MC.escapeHtml(analysis.opening)}</span>`;

    MC.setView(`
      <div class="review-page">
        <div class="review-header">
          <div>
            <span class="eyebrow">Game review</span>
            <h1>${MC.escapeHtml(meta.whiteName)} <span class="muted" style="font-weight:500">vs</span> ${MC.escapeHtml(meta.blackName)}</h1>
            <p>${MC.escapeHtml(analysis.opening)} · ${MC.escapeHtml(meta.result)} · ${MC.escapeHtml(MC.timeControlLabel(meta.timeControl))} ${MC.escapeHtml(MC.timeControlName(meta.timeControl))} · ${MC.moveCount(review.moves.length)}</p>
          </div>
          <div class="review-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-action="review-copy-pgn">▣ Copy PGN</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="review-flip">⇅ Flip board</button>
            ${review.source === 'online' ? `<a class="btn btn-ghost btn-sm" href="#game/${review.gameId}">← Back to game</a>` : `<a class="btn btn-ghost btn-sm" href="#play">← Bot arena</a>`}
            <button type="button" class="btn btn-primary btn-sm" data-action="review-play-again">Play again</button>
          </div>
        </div>

        <div class="review-layout">
          <div class="review-board-column">
            <div class="review-board-wrap">
              <div class="review-result-strip"><span class="badge ${meta.status === 'draw' ? 'orange' : 'green'}">${MC.escapeHtml(meta.result)}</span><span>${MC.escapeHtml(meta.whiteName)} (${meta.whiteRating}) vs ${MC.escapeHtml(meta.blackName)} (${meta.blackRating})</span><span class="badge grey">${engineNote}</span></div>
              <div id="reviewBoard"></div>
            </div>
            <div class="review-nav">
              <button type="button" class="btn btn-secondary btn-sm" data-action="review-first" aria-label="First move">⏮</button>
              <button type="button" class="btn btn-secondary btn-sm" data-action="review-prev" aria-label="Previous move">◀</button>
              <button type="button" class="btn btn-secondary btn-sm" data-action="review-next" aria-label="Next move">▶</button>
              <button type="button" class="btn btn-secondary btn-sm" data-action="review-last" aria-label="Last move">⏭</button>
              <span class="muted tiny" style="margin-left:7px">${review.index} / ${review.moves.length}</span>
            </div>
            <div class="review-current" id="reviewCurrent">${currentLine}</div>
            <div class="review-best-line" id="reviewBestLine">${bestLineHtml(review, boardInfo)}</div>
          </div>

          <aside class="review-side">
            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title">Accuracy</h2><span class="badge grey">${engineNote}</span></div>
              <div class="review-accuracy-grid">
                <div class="accuracy-card white"><div class="acc-player"><span class="acc-dot"></span><span class="acc-name">${MC.escapeHtml(meta.whiteName)}</span></div><div class="acc-value">${accuracyWhite}<small>%</small></div><span class="badge green acc-badge">White</span></div>
                <div class="accuracy-card black"><div class="acc-player"><span class="acc-dot"></span><span class="acc-name">${MC.escapeHtml(meta.blackName)}</span></div><div class="acc-value">${accuracyBlack}<small>%</small></div><span class="badge acc-badge">Black</span></div>
              </div>
              <div class="review-graph-wrap">${evalGraph(review)}</div>
            </section>

            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title">Move classification</h2></div>
              <div class="review-class-summary">
                ${classificationColumn(meta.whiteName, analysis.counts.white)}
                ${classificationColumn(meta.blackName, analysis.counts.black)}
              </div>
            </section>

            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title">Moves</h2><span class="badge grey">${review.moves.length}</span></div>
              <div class="review-move-list" id="reviewMoveList">${moveRows(review)}</div>
            </section>

            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title">Key moments</h2></div>
              <div class="review-keymoments">${keyMoments(review)}</div>
            </section>
          </aside>
        </div>
      </div>`);

    const boardEl = MC.byId('reviewBoard');
    if (boardEl) {
      state.review.board = new MC.Board(boardEl, {
        state: boardInfo.state,
        flipped: review.flipped,
        interactive: false,
        lastMove: boardInfo.lastMove,
        arrow: boardInfo.arrow,
        arrowKind: 'best',
        theme: state.settings.boardTheme,
        showLegal: false
      });
    }
    setTimeout(() => {
      const active = document.querySelector('.review-move-row.active');
      const list = active && active.closest('.review-move-list');
      if (!active || !list) return;
      // Keep the active move visible inside the move list without shifting
      // the whole review page away from the board on phones.
      const listRect = list.getBoundingClientRect();
      const rowRect = active.getBoundingClientRect();
      if (rowRect.top < listRect.top) list.scrollTop -= listRect.top - rowRect.top;
      else if (rowRect.bottom > listRect.bottom) list.scrollTop += rowRect.bottom - listRect.bottom;
    }, 30);
  }

  function renderReviewEmpty() {
    MC.setView(`
      <div class="review-page review-empty">
        <div class="panel panel-pad" style="text-align:center;padding:34px 24px">
          <div style="font-size:2.6rem;margin-bottom:9px">▤</div>
          <span class="eyebrow">Game review</span>
          <h1 style="font-size:clamp(1.7rem,4vw,2.4rem)">No game on the analysis table.</h1>
          <p class="muted" style="max-width:520px;margin:9px auto 18px">Finish a bot game or an online game, then open the game review to see accuracy, best moves, blunders, key moments, and an evaluation graph.</p>
          <div class="row wrap" style="justify-content:center">
            <a class="btn btn-primary" href="#play">Play a bot</a>
            <a class="btn btn-secondary" href="#online">Play online</a>
          </div>
        </div>
      </div>`);
  }

  function renderReviewError(review) {
    MC.setView(`
      <div class="review-page review-empty">
        <div class="panel panel-pad" style="text-align:center;padding:34px 24px">
          <div style="font-size:2.6rem;margin-bottom:9px">☄</div>
          <span class="eyebrow">Game review</span>
          <h1 style="font-size:clamp(1.7rem,4vw,2.4rem)">The analysis engine lost the signal.</h1>
          <p class="muted" style="max-width:520px;margin:9px auto 18px">${MC.escapeHtml(review.error || 'The review could not be completed. Try again, or use the built-in analysis fallback.')}</p>
          <div class="row wrap" style="justify-content:center">
            <button type="button" class="btn btn-primary" data-action="review-retry">Try again</button>
            <a class="btn btn-secondary" href="${review.source === 'online' ? '#game/' + review.gameId : '#play'}">Back</a>
          </div>
        </div>
      </div>`);
  }

  // -------------------------------------------------------------------------
  // Route
  // -------------------------------------------------------------------------

  async function renderReviewRoute(route, token) {
    if (route.param) {
      if (!state.user) {
        state.auth.redirect = `#review/${route.param}`;
        MC.navigate('#auth');
        return;
      }
      const id = Number(route.param);
      const current = state.review;
      if (current && current.source === 'online' && Number(current.gameId) === id) {
        if (current.analysis || current.analyzing || current.error) {
          if (current.analyzing) renderReviewProgress(current);
          else renderReviewPage();
          return;
        }
        startAnalysis(current);
        return;
      }
      MC.renderLoading('Loading the game for review…');
      try {
        const data = await MC.api('/api/games/' + id);
        if (token !== state.pageToken) return;
        const game = data.game;
        if (!game) throw new Error('Game not found.');
        if (game.status === 'active') {
          MC.setView(`<div class="review-page review-empty"><div class="panel panel-pad" style="text-align:center;padding:34px 24px">
            <div style="font-size:2.6rem;margin-bottom:9px">⌛</div>
            <span class="eyebrow">Game review</span>
            <h1 style="font-size:clamp(1.7rem,4vw,2.4rem)">This game is still in progress.</h1>
            <p class="muted" style="max-width:520px;margin:9px auto 18px">Finish the game first, then the review will be ready.</p>
            <a class="btn btn-primary" href="#game/${game.id}">Return to the game</a>
          </div></div>`);
          return;
        }
        const review = buildOnlineReview(game);
        prepareNewReview(review);
        startAnalysis(review);
      } catch (e) {
        if (token !== state.pageToken) return;
        if (e.status === 401) {
          state.auth.redirect = `#review/${id}`;
          MC.navigate('#auth');
          return;
        }
        if (e.status === 404) MC.renderError('Game not found', 'That game may have been removed or the link is incorrect.', '♞');
        else MC.renderError('Could not load the game', e.message || 'Please try again.');
      }
      return;
    }

    if (state.review) {
      if (state.review.analyzing) renderReviewProgress(state.review);
      else if (state.review.error) renderReviewError(state.review);
      else if (state.review.analysis) renderReviewPage();
      else if (state.review.moves && state.review.moves.length) startAnalysis(state.review);
      else renderReviewEmpty();
      return;
    }
    renderReviewEmpty();
  }

  function gotoReview(ply) {
    const review = state.review;
    if (!review || !review.analysis) return;
    const max = review.analysis.positions.length - 1;
    review.index = Math.max(0, Math.min(max, Number(ply) || 0));
    renderReviewPage();
  }

  MC.actions['review-bot'] = () => {
    const game = state.bot.game;
    if (!game) {
      MC.toast('Play a bot game first.', 'info');
      return;
    }
    if (!game.over) {
      MC.toast('Finish the game before opening the review.', 'info');
      return;
    }
    if (!game.moves.length) {
      MC.toast('There are no moves to review yet.', 'info');
      return;
    }
    const review = buildBotReview();
    if (!review) return;
    prepareNewReview(review);
    MC.closeModal();
    MC.navigate('#review');
  };

  MC.actions['review-goto'] = el => gotoReview(el.dataset.ply);
  MC.actions['review-first'] = () => gotoReview(0);
  MC.actions['review-prev'] = () => gotoReview((state.review && state.review.index || 0) - 1);
  MC.actions['review-next'] = () => gotoReview((state.review && state.review.index || 0) + 1);
  MC.actions['review-last'] = () => {
    if (!state.review || !state.review.analysis) return;
    gotoReview(state.review.analysis.positions.length - 1);
  };
  MC.actions['review-flip'] = () => {
    if (!state.review) return;
    state.review.flipped = !state.review.flipped;
    renderReviewPage();
  };
  MC.actions['review-play-again'] = () => {
    if (state.review && state.review.source === 'online') MC.navigate('#online');
    else MC.navigate('#play');
  };
  MC.actions['review-retry'] = () => {
    const review = state.review;
    if (!review) return;
    review.error = '';
    review.analysis = null;
    review.done = false;
    startAnalysis(review);
  };
  MC.actions['review-cancel'] = () => {
    const review = state.review;
    if (!review) return;
    review.analysisToken = (review.analysisToken || 0) + 1;
    MC.reviewEngine.cancel();
    review.analyzing = false;
    if (review.source === 'online') MC.navigate('#game/' + review.gameId);
    else MC.navigate('#play');
  };
  MC.actions['review-copy-pgn'] = async () => {
    if (!state.review) return;
    const text = pgnForReview(state.review);
    const ok = await MC.copyText(text);
    MC.toast(ok ? 'PGN copied to the clipboard.' : 'Could not copy the PGN.', ok ? 'success' : 'error');
  };

  MC.onKeyDown = event => {
    if (state.route !== 'review' || !state.review || !state.review.analysis) return;
    const tag = (event.target && event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (event.target && event.target.isContentEditable)) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      MC.actions['review-prev']();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      MC.actions['review-next']();
    } else if (event.key === 'Home') {
      event.preventDefault();
      MC.actions['review-first']();
    } else if (event.key === 'End') {
      event.preventDefault();
      MC.actions['review-last']();
    }
  };

  MC.routes.review = renderReviewRoute;

  MC.initReview = function () {
    MC.routes.review = renderReviewRoute;
  };
})();
