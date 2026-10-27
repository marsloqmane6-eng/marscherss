/* MarsChess shared rules engine — works in the browser and in Node.js */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarsEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EMPTY = 0, WP = 1, WN = 2, WB = 3, WR = 4, WQ = 5, WK = 6;
  const BP = -1, BN = -2, BB = -3, BR = -4, BQ = -5, BK = -6;
  const PIECE_VAL = { 1: 100, 2: 320, 3: 330, 4: 500, 5: 900, 6: 20000 };
  const INF = 1e9, MATE = 100000;
  const GLYPHS = { 1: '\u265F', 2: '\u265E', 3: '\u265D', 4: '\u265C', 5: '\u265B', 6: '\u265A' };

  const PST = {
    1: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
    2: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    3: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    4: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
    5: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
    6: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20]
  };
  const KING_EG = [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];

  function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function sq(r, c) { return r * 8 + c; }
  function idxToAlg(i) { return String.fromCharCode(97 + (i & 7)) + (8 - (i >> 3)); }
  function algToIdx(a) { return (8 - parseInt(a[1], 10)) * 8 + (a.charCodeAt(0) - 97); }
  function cloneState(s) { return { b: new Int8Array(s.b), turn: s.turn, castle: s.castle, ep: s.ep, hm: s.hm, fm: s.fm }; }
  function pieceChar(p) { return ['', 'p', 'n', 'b', 'r', 'q', 'k'][Math.abs(p)]; }

  function initialState() {
    const s = { b: new Int8Array(64), turn: 1, castle: 15, ep: -1, hm: 0, fm: 1 };
    const back = [WR, WN, WB, WQ, WK, WB, WN, WR];
    for (let c = 0; c < 8; c++) {
      s.b[c] = -back[c];
      s.b[8 + c] = BP;
      s.b[48 + c] = WP;
      s.b[56 + c] = back[c];
    }
    return s;
  }

  function fromFEN(fen) {
    const parts = String(fen).trim().split(/\s+/);
    const rows = parts[0].split('/');
    const s = { b: new Int8Array(64), turn: parts[1] === 'b' ? -1 : 1, castle: 0, ep: -1, hm: parseInt(parts[4] || '0', 10) || 0, fm: parseInt(parts[5] || '1', 10) || 1 };
    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') c += Number(ch);
        else {
          const lower = ch.toLowerCase();
          const type = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 }[lower];
          if (type) s.b[r * 8 + c] = ch === lower ? -type : type;
          c++;
        }
      }
    }
    const rights = parts[2] || '-';
    if (rights.includes('K')) s.castle |= 1;
    if (rights.includes('Q')) s.castle |= 2;
    if (rights.includes('k')) s.castle |= 4;
    if (rights.includes('q')) s.castle |= 8;
    if (parts[3] && parts[3] !== '-') s.ep = algToIdx(parts[3]);
    return s;
  }

  function addPawnMove(moves, from, to, turn, isDouble, captured) {
    const promoRow = turn === 1 ? 0 : 7;
    const promos = (to >> 3) === promoRow ? (turn === 1 ? [WQ, WR, WB, WN] : [BQ, BR, BB, BN]) : [null];
    for (const promo of promos) {
      moves.push({
        from, to, piece: turn === 1 ? WP : BP, captured: captured || 0, promotion: promo,
        epTarget: isDouble ? (turn === 1 ? from - 8 : from + 8) : -1,
        epCapture: false, epSquare: -1, castle: false
      });
    }
  }

  function genPseudo(state) {
    const moves = [], b = state.b, turn = state.turn;
    for (let from = 0; from < 64; from++) {
      const p = b[from];
      if (p === 0 || Math.sign(p) !== turn) continue;
      const type = Math.abs(p), r = from >> 3, c = from & 7;
      if (type === 1) {
        const dir = turn === 1 ? -1 : 1, nr = r + dir, startRow = turn === 1 ? 6 : 1;
        if (inBounds(nr, c) && b[sq(nr, c)] === 0) {
          addPawnMove(moves, from, sq(nr, c), turn, false, 0);
          if (r === startRow) {
            const nr2 = r + dir * 2;
            if (b[sq(nr2, c)] === 0) addPawnMove(moves, from, sq(nr2, c), turn, true, 0);
          }
        }
        for (const dc of [-1, 1]) {
          const nc = c + dc;
          if (!inBounds(nr, nc)) continue;
          const to = sq(nr, nc), target = b[to];
          if (target !== 0 && Math.sign(target) === -turn) addPawnMove(moves, from, to, turn, false, target);
          if (state.ep === to && target === 0) {
            moves.push({
              from, to, piece: turn === 1 ? WP : BP, captured: turn === 1 ? BP : WP,
              promotion: null, epTarget: -1, epCapture: true, epSquare: sq(r, nc), castle: false
            });
          }
        }
      } else if (type === 2) {
        for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
          const rr = r + dr, cc = c + dc;
          if (!inBounds(rr, cc)) continue;
          const to = sq(rr, cc), target = b[to];
          if (target === 0 || Math.sign(target) === -turn) moves.push({ from, to, piece: p, captured: target, promotion: null, epTarget: -1, epCapture: false, epSquare: -1, castle: false });
        }
      } else if (type === 3 || type === 4 || type === 5) {
        const dirs = type === 3 ? [[-1,-1],[-1,1],[1,-1],[1,1]] : type === 4 ? [[-1,0],[1,0],[0,-1],[0,1]] : [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (inBounds(rr, cc)) {
            const to = sq(rr, cc), target = b[to];
            if (target === 0) moves.push({ from, to, piece: p, captured: 0, promotion: null, epTarget: -1, epCapture: false, epSquare: -1, castle: false });
            else {
              if (Math.sign(target) === -turn) moves.push({ from, to, piece: p, captured: target, promotion: null, epTarget: -1, epCapture: false, epSquare: -1, castle: false });
              break;
            }
            rr += dr; cc += dc;
          }
        }
      } else if (type === 6) {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = r + dr, cc = c + dc;
          if (!inBounds(rr, cc)) continue;
          const to = sq(rr, cc), target = b[to];
          if (target === 0 || Math.sign(target) === -turn) moves.push({ from, to, piece: p, captured: target, promotion: null, epTarget: -1, epCapture: false, epSquare: -1, castle: false });
        }
        if (turn === 1 && from === 60) {
          if ((state.castle & 1) && b[61] === 0 && b[62] === 0 && b[63] === WR && !inCheck(state, 1) && !isAttacked(state, 61, -1) && !isAttacked(state, 62, -1))
            moves.push({ from: 60, to: 62, piece: WK, captured: 0, promotion: null, epTarget: -1, epCapture: false, epSquare: -1, castle: true });
          if ((state.castle & 2) && b[59] === 0 && b[58] === 0 && b[57] === 0 && b[56] === WR && !inCheck(state, 1) && !isAttacked(state, 59, -1) && !isAttacked(state, 58, -1))
            moves.push({ from: 60, to: 58, piece: WK, captured: 0, promotion: null, epTarget: -1, epCapture: false, epSquare: -1, castle: true });
        } else if (turn === -1 && from === 4) {
          if ((state.castle & 4) && b[5] === 0 && b[6] === 0 && b[7] === BR && !inCheck(state, -1) && !isAttacked(state, 5, 1) && !isAttacked(state, 6, 1))
            moves.push({ from: 4, to: 6, piece: BK, captured: 0, promotion: null, epTarget: -1, epCapture: false, epSquare: -1, castle: true });
          if ((state.castle & 8) && b[3] === 0 && b[2] === 0 && b[1] === 0 && b[0] === BR && !inCheck(state, -1) && !isAttacked(state, 3, 1) && !isAttacked(state, 2, 1))
            moves.push({ from: 4, to: 2, piece: BK, captured: 0, promotion: null, epTarget: -1, epCapture: false, epSquare: -1, castle: true });
        }
      }
    }
    return moves;
  }

  function isAttacked(state, target, by) {
    const b = state.b, r = target >> 3, c = target & 7;
    const pawnRow = by === 1 ? r + 1 : r - 1;
    for (const dc of [-1, 1]) {
      const pc = c + dc;
      if (inBounds(pawnRow, pc) && b[sq(pawnRow, pc)] === (by === 1 ? WP : BP)) return true;
    }
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      const rr = r + dr, cc = c + dc;
      if (inBounds(rr, cc) && b[sq(rr, cc)] === (by === 1 ? WN : BN)) return true;
    }
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr, cc = c + dc;
      if (inBounds(rr, cc) && b[sq(rr, cc)] === (by === 1 ? WK : BK)) return true;
    }
    const bishopDirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
    const rookDirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dirs, types] of [[bishopDirs, [WB, WQ]], [rookDirs, [WR, WQ]]]) {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (inBounds(rr, cc)) {
          const p = b[sq(rr, cc)];
          if (p !== 0) {
            if (by === 1 && types.includes(p)) return true;
            if (by === -1 && types.map(x => -x).includes(p)) return true;
            break;
          }
          rr += dr; cc += dc;
        }
      }
    }
    return false;
  }

  function inCheck(state, color) {
    const king = color === 1 ? WK : BK;
    for (let i = 0; i < 64; i++) if (state.b[i] === king) return isAttacked(state, i, -color);
    return true;
  }

  function applyMove(state, m) {
    const s = cloneState(state);
    const p = state.b[m.from];
    let castle = s.castle;
    if (Math.abs(p) === 6) castle &= p > 0 ? ~3 : ~12;
    if (m.from === 63 || m.to === 63) castle &= ~1;
    if (m.from === 56 || m.to === 56) castle &= ~2;
    if (m.from === 7 || m.to === 7) castle &= ~4;
    if (m.from === 0 || m.to === 0) castle &= ~8;
    s.castle = castle;
    if (m.epCapture) s.b[m.epSquare] = 0;
    if (m.castle) {
      if (m.to === m.from + 2) { s.b[m.from + 1] = s.b[m.from + 3]; s.b[m.from + 3] = 0; }
      else { s.b[m.from - 1] = s.b[m.from - 4]; s.b[m.from - 4] = 0; }
    }
    s.b[m.from] = 0;
    s.b[m.to] = m.promotion || p;
    s.ep = m.epTarget >= 0 ? m.epTarget : -1;
    s.hm = (Math.abs(p) === 1 || m.captured || m.epCapture) ? 0 : state.hm + 1;
    s.turn = -state.turn;
    if (s.turn === 1) s.fm = state.fm + 1;
    return s;
  }

  function legalMoves(state) {
    const out = [];
    for (const m of genPseudo(state)) {
      const ns = applyMove(state, m);
      if (!inCheck(ns, state.turn)) out.push(m);
    }
    return out;
  }

  function toFEN(state) {
    let fen = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = state.b[sq(r, c)];
        if (p === 0) { empty++; continue; }
        if (empty) { fen += empty; empty = 0; }
        const ch = pieceChar(p);
        fen += p > 0 ? ch.toUpperCase() : ch;
      }
      if (empty) fen += empty;
      if (r < 7) fen += '/';
    }
    let cas = '';
    if (state.castle & 1) cas += 'K';
    if (state.castle & 2) cas += 'Q';
    if (state.castle & 4) cas += 'k';
    if (state.castle & 8) cas += 'q';
    return fen + ' ' + (state.turn === 1 ? 'w' : 'b') + ' ' + (cas || '-') + ' ' + (state.ep >= 0 ? idxToAlg(state.ep) : '-') + ' ' + state.hm + ' ' + state.fm;
  }

  function positionKey(state) { return toFEN(state).split(' ').slice(0, 4).join(' '); }
  function moveToUci(m) { return idxToAlg(m.from) + idxToAlg(m.to) + (m.promotion ? pieceChar(m.promotion) : ''); }
  function uciToMove(state, uci) { return legalMoves(state).find(m => moveToUci(m) === uci) || null; }

  function moveToSan(move, state) {
    if (move.castle) {
      const base = move.to > move.from ? 'O-O' : 'O-O-O';
      const ns = applyMove(state, move);
      return base + (inCheck(ns, ns.turn) ? (legalMoves(ns).length ? '+' : '#') : '');
    }
    const type = Math.abs(move.piece);
    const letters = ['', '', 'N', 'B', 'R', 'Q', 'K'];
    let san = '';
    if (type === 1) {
      if (move.captured) san += String.fromCharCode(97 + (move.from & 7)) + 'x';
    } else {
      san += letters[type];
      const rivals = legalMoves(state).filter(m => m.from !== move.from && m.to === move.to && Math.abs(m.piece) === type);
      if (rivals.length) {
        const sameFile = rivals.some(m => (m.from & 7) === (move.from & 7));
        const sameRank = rivals.some(m => (m.from >> 3) === (move.from >> 3));
        if (!sameFile) san += String.fromCharCode(97 + (move.from & 7));
        else if (!sameRank) san += (8 - (move.from >> 3));
        else san += idxToAlg(move.from);
      }
      if (move.captured) san += 'x';
    }
    san += idxToAlg(move.to);
    if (move.promotion) san += '=' + letters[Math.abs(move.promotion)];
    const ns = applyMove(state, move);
    if (inCheck(ns, ns.turn)) san += legalMoves(ns).length ? '+' : '#';
    return san;
  }

  function hasQueens(state) {
    for (let i = 0; i < 64; i++) if (Math.abs(state.b[i]) === 5) return true;
    return false;
  }

  function staticEval(state) {
    let score = 0;
    const eg = !hasQueens(state);
    let wb = 0, bb = 0;
    for (let i = 0; i < 64; i++) {
      const p = state.b[i];
      if (p === 0) continue;
      const t = Math.abs(p), idx = p > 0 ? i : 63 - i;
      const pst = (t === 6 && eg) ? KING_EG : PST[t];
      const v = PIECE_VAL[t] + pst[idx];
      if (p > 0) { score += v; if (t === 3) wb++; }
      else { score -= v; if (t === 3) bb++; }
    }
    if (wb >= 2) score += 28;
    if (bb >= 2) score -= 28;
    return score;
  }
  function sideEval(state) { const e = staticEval(state); return state.turn === 1 ? e : -e; }

  function insufficientMaterial(state) {
    const pieces = [];
    for (let i = 0; i < 64; i++) {
      const p = state.b[i];
      if (p === 0) continue;
      const t = Math.abs(p);
      if (t === 1 || t === 4 || t === 5) return false;
      pieces.push({ p, i });
    }
    if (pieces.length <= 2) return true;
    if (pieces.length === 3 && pieces.some(x => Math.abs(x.p) === 2 || Math.abs(x.p) === 3)) return true;
    if (pieces.length === 4) {
      const bishops = pieces.filter(x => Math.abs(x.p) === 3);
      if (bishops.length === 2 && Math.sign(bishops[0].p) !== Math.sign(bishops[1].p)) {
        const colors = bishops.map(x => ((x.i >> 3) % 2) === ((x.i & 7) % 2) ? 0 : 1);
        if (colors[0] === colors[1]) return true;
      }
    }
    return false;
  }

  function perft(state, depth) {
    if (depth === 0) return 1;
    let n = 0;
    for (const m of legalMoves(state)) n += perft(applyMove(state, m), depth - 1);
    return n;
  }

  let searchDeadline = 0;

  function orderMoves(moves) {
    for (const m of moves) {
      let s = 0;
      if (m.captured) s += 10 * PIECE_VAL[Math.abs(m.captured)] - PIECE_VAL[Math.abs(m.piece)];
      if (m.promotion) s += 800;
      if (m.castle) s += 60;
      m._score = s;
    }
    moves.sort((a, b) => b._score - a._score);
  }

  function quiescence(state, alpha, beta, ply) {
    const stand = sideEval(state);
    if (stand >= beta) return beta;
    if (alpha < stand) alpha = stand;
    const moves = legalMoves(state).filter(m => m.captured || m.promotion);
    orderMoves(moves);
    for (const m of moves) {
      if (performance.now() > searchDeadline) return alpha;
      const ns = applyMove(state, m);
      const score = -quiescence(ns, -beta, -alpha, ply + 1);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(state, depth, alpha, beta, ply) {
    if (performance.now() > searchDeadline) return alpha;
    if (state.hm >= 100) return 0;
    const moves = legalMoves(state);
    if (moves.length === 0) return inCheck(state, state.turn) ? -MATE + ply : 0;
    if (depth <= 0) return quiescence(state, alpha, beta, ply);
    orderMoves(moves);
    let best = -INF;
    for (const m of moves) {
      const ns = applyMove(state, m);
      const score = -negamax(ns, depth - 1, -beta, -alpha, ply + 1);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  function findBestMove(state, opts) {
    opts = opts || {};
    const legal = legalMoves(state);
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];
    const maxDepth = opts.depth || 6, timeLimit = opts.timeLimit || 1000;
    searchDeadline = performance.now() + timeLimit;
    let ordered = legal.slice();
    orderMoves(ordered);
    let best = ordered[0];
    for (let d = 1; d <= maxDepth; d++) {
      let alpha = -INF, beta = INF, curBest = null, curScore = -INF, aborted = false;
      for (const m of ordered) {
        if (performance.now() > searchDeadline) { aborted = true; break; }
        const ns = applyMove(state, m);
        const score = -negamax(ns, d - 1, -beta, -alpha, 1);
        if (score > curScore) { curScore = score; curBest = m; }
        if (score > alpha) alpha = score;
      }
      if (aborted) break;
      if (curBest) {
        best = curBest;
        ordered = ordered.filter(x => x !== curBest);
        ordered.unshift(curBest);
      }
      if (performance.now() > searchDeadline) break;
    }
    if (opts.randomness && Math.random() < opts.randomness) {
      return legal[Math.floor(Math.random() * Math.min(4, legal.length))];
    }
    return best;
  }

  return {
    EMPTY, WP, WN, WB, WR, WQ, WK, BP, BN, BB, BR, BQ, BK,
    PIECE_VAL, INF, MATE, GLYPHS, PST,
    inBounds, sq, idxToAlg, algToIdx, cloneState, pieceChar,
    initialState, fromFEN, genPseudo, isAttacked, inCheck, applyMove, legalMoves,
    toFEN, positionKey, moveToUci, uciToMove, moveToSan, staticEval, sideEval,
    insufficientMaterial, perft, findBestMove
  };
});
