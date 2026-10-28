'use strict';

/*
 * MarsChess server
 * A zero-dependency Node.js web server: accounts, SQLite, SSE matchmaking,
 * authoritative online chess, and static hosting for the MarsChess client.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { Pool } = require('pg');
const Engine = require('./public/engine.js');

const scryptAsync = promisify(crypto.scrypt);

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'marscherss.db');
const DATABASE_URL = process.env.DATABASE_URL || '';
const USE_POSTGRES = Boolean(DATABASE_URL);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY = 32 * 1024;

let sqlite = null;
let pool = null;
let DatabaseSync = null;
let sqliteWriteQueue = Promise.resolve();
let dbReady = null;

const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    rating INTEGER NOT NULL DEFAULT 1200,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    white_id INTEGER NOT NULL REFERENCES users(id),
    black_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'active',
    reason TEXT,
    fen TEXT NOT NULL,
    turn INTEGER NOT NULL DEFAULT 1,
    time_control TEXT NOT NULL,
    base_ms INTEGER NOT NULL,
    inc_ms INTEGER NOT NULL,
    white_ms INTEGER NOT NULL,
    black_ms INTEGER NOT NULL,
    last_move_at INTEGER NOT NULL,
    draw_offer_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    ply INTEGER NOT NULL,
    uci TEXT NOT NULL,
    san TEXT NOT NULL,
    fen_after TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(game_id, ply)
  );

  CREATE TABLE IF NOT EXISTS chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS queue (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    time_control TEXT NOT NULL,
    rating INTEGER NOT NULL,
    joined_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_games_active ON games(status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_id, status);
  CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_id, status);
  CREATE INDEX IF NOT EXISTS idx_moves_game ON moves(game_id, ply);
  CREATE INDEX IF NOT EXISTS idx_chat_game ON chat(game_id, id);
  CREATE INDEX IF NOT EXISTS idx_queue_tc ON queue(time_control, joined_at);
`;

const PG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    rating INTEGER NOT NULL DEFAULT 1200,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    last_seen BIGINT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    white_id INTEGER NOT NULL REFERENCES users(id),
    black_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'active',
    reason TEXT,
    fen TEXT NOT NULL,
    turn INTEGER NOT NULL DEFAULT 1,
    time_control TEXT NOT NULL,
    base_ms INTEGER NOT NULL,
    inc_ms INTEGER NOT NULL,
    white_ms INTEGER NOT NULL,
    black_ms INTEGER NOT NULL,
    last_move_at BIGINT NOT NULL,
    draw_offer_by INTEGER,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS moves (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    ply INTEGER NOT NULL,
    uci TEXT NOT NULL,
    san TEXT NOT NULL,
    fen_after TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    UNIQUE(game_id, ply)
  );

  CREATE TABLE IF NOT EXISTS chat (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS queue (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    time_control TEXT NOT NULL,
    rating INTEGER NOT NULL,
    joined_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_games_active ON games(status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_id, status);
  CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_id, status);
  CREATE INDEX IF NOT EXISTS idx_moves_game ON moves(game_id, ply);
  CREATE INDEX IF NOT EXISTS idx_chat_game ON chat(game_id, id);
  CREATE INDEX IF NOT EXISTS idx_queue_tc ON queue(time_control, joined_at);
`;

function toPgSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function enqueueSqliteWrite(fn) {
  const task = sqliteWriteQueue.then(fn, fn);
  sqliteWriteQueue = task.catch(() => {});
  return task;
}

async function dbGet(sql, ...params) {
  if (USE_POSTGRES) {
    const result = await pool.query(toPgSql(sql), params);
    return result.rows[0] || null;
  }
  return sqlite.prepare(sql).get(...params) || null;
}

async function dbAll(sql, ...params) {
  if (USE_POSTGRES) {
    const result = await pool.query(toPgSql(sql), params);
    return result.rows;
  }
  return sqlite.prepare(sql).all(...params);
}

async function dbRun(sql, ...params) {
  if (USE_POSTGRES) {
    const result = await pool.query(toPgSql(sql), params);
    return { changes: result.rowCount };
  }
  return enqueueSqliteWrite(() => {
    const info = sqlite.prepare(sql).run(...params);
    return { changes: Number(info.changes) };
  });
}

async function dbInsert(sql, ...params) {
  if (USE_POSTGRES) {
    const result = await pool.query(toPgSql(sql + ' RETURNING id'), params);
    return Number(result.rows[0].id);
  }
  return enqueueSqliteWrite(() => {
    const row = sqlite.prepare(sql + ' RETURNING id').get(...params);
    return Number(row.id);
  });
}

function makeSqliteTx() {
  return {
    async get(sql, ...params) { return sqlite.prepare(sql).get(...params) || null; },
    async all(sql, ...params) { return sqlite.prepare(sql).all(...params); },
    async run(sql, ...params) {
      const info = sqlite.prepare(sql).run(...params);
      return { changes: Number(info.changes) };
    },
    async insert(sql, ...params) {
      const row = sqlite.prepare(sql + ' RETURNING id').get(...params);
      return Number(row.id);
    }
  };
}

function makePgTx(client) {
  return {
    async get(sql, ...params) {
      const result = await client.query(toPgSql(sql), params);
      return result.rows[0] || null;
    },
    async all(sql, ...params) {
      const result = await client.query(toPgSql(sql), params);
      return result.rows;
    },
    async run(sql, ...params) {
      const result = await client.query(toPgSql(sql), params);
      return { changes: result.rowCount };
    },
    async insert(sql, ...params) {
      const result = await client.query(toPgSql(sql + ' RETURNING id'), params);
      return Number(result.rows[0].id);
    }
  };
}

async function withTransaction(fn) {
  if (USE_POSTGRES) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(makePgTx(client));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (err) {}
      throw e;
    } finally {
      client.release();
    }
  }
  const task = enqueueSqliteWrite(async () => {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(makeSqliteTx());
      sqlite.exec('COMMIT');
      return result;
    } catch (e) {
      try { sqlite.exec('ROLLBACK'); } catch (err) {}
      throw e;
    }
  });
  return task;
}

async function initDb() {
  if (USE_POSTGRES) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 10,
      ssl: /sslmode=require/i.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined
    });
    pool.on('error', (err) => console.error('Postgres pool error:', err.message));
    await pool.query(PG_SCHEMA);
    console.log('Database: PostgreSQL');
  } else {
    if (!DatabaseSync) DatabaseSync = require('node:sqlite').DatabaseSync;
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    sqlite = new DatabaseSync(DB_PATH);
    sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    sqlite.exec(SQLITE_SCHEMA);
    console.log('Database:', DB_PATH);
  }
}

// Serverless instances are reused, so initialize the schema once per process.
function ensureDb() {
  if (!dbReady) {
    dbReady = initDb().catch((err) => {
      dbReady = null;
      throw err;
    });
  }
  return dbReady;
}

async function closeDb() {
  if (USE_POSTGRES) await pool.end();
  else if (sqlite) sqlite.close();
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const now = () => Date.now();

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function isSecure(req) {
  return Boolean(req.socket.encrypted) || req.headers['x-forwarded-proto'] === 'https';
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendError(res, status, message, extra) {
  sendJson(res, status, Object.assign({ error: message }, extra || {}));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch (e) {
    return false;
  }
}

function normalizeUsername(value) {
  return String(value || '').trim();
}

function validUsername(username) {
  return /^[A-Za-z0-9_]{3,20}$/.test(username);
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return { salt, hash: derived.toString('hex') };
}

async function verifyPassword(password, salt, expectedHex) {
  const derived = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    rating: Number(row.rating),
    wins: Number(row.wins),
    losses: Number(row.losses),
    draws: Number(row.draws),
    createdAt: Number(row.created_at)
  };
}

function publicPlayer(row, prefix) {
  return {
    id: Number(row[prefix + '_id']),
    username: row[prefix + '_name'],
    rating: Number(row[prefix + '_rating'])
  };
}

// ---------------------------------------------------------------------------
// Sessions and authentication
// ---------------------------------------------------------------------------

function setSessionCookie(req, res, token) {
  const maxAge = Math.floor(SESSION_MS / 1000);
  const secure = isSecure(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `mc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function clearSessionCookie(req, res) {
  const secure = isSecure(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `mc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

async function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  const created = now();
  await dbRun('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    tokenHash, userId, created + SESSION_MS, created);
  setSessionCookie(req, res, token);
  return token;
}

async function getSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.mc_session;
  if (!token) return null;
  const row = await dbGet(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `, sha256(token), now());
  if (!row) return null;
  if (now() - Number(row.last_seen) > 60_000) {
    await dbRun('UPDATE users SET last_seen = ? WHERE id = ?', now(), row.id);
  }
  return row;
}

async function requireUser(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    sendError(res, 401, 'Sign in to continue.');
    return null;
  }
  return user;
}

async function destroySession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.mc_session) {
    await dbRun('DELETE FROM sessions WHERE token_hash = ?', sha256(cookies.mc_session));
  }
  clearSessionCookie(req, res);
}

const loginAttempts = new Map();
function checkRateLimit(key, limit, windowMs) {
  const t = now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.reset < t) {
    loginAttempts.set(key, { count: 1, reset: t + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}
function clearRateLimit(key) {
  loginAttempts.delete(key);
}

// ---------------------------------------------------------------------------
// Live connections (Server-Sent Events)
// ---------------------------------------------------------------------------

const sseClients = new Map(); // userId -> Set<ServerResponse>

function sseSend(res, event, data) {
  if (!res || res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendToUser(userId, event, data) {
  const set = sseClients.get(Number(userId));
  if (!set) return;
  for (const res of set) sseSend(res, event, data);
}

function broadcast(event, data) {
  for (const set of sseClients.values()) {
    for (const res of set) sseSend(res, event, data);
  }
}

function onlineCount() {
  return sseClients.size;
}

function broadcastOnlineCount() {
  broadcast('online_count', { count: onlineCount() });
}

function sseConnected(userId) {
  return sseClients.has(Number(userId)) && sseClients.get(Number(userId)).size > 0;
}

async function handleSse(req, res, user) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff'
  });
  res.write('retry: 3000\n\n');

  const userId = Number(user.id);
  let set = sseClients.get(userId);
  if (!set) {
    set = new Set();
    sseClients.set(userId, set);
  }
  set.add(res);
  sseSend(res, 'connected', { user: publicUser(user) });
  sseSend(res, 'online_count', { count: onlineCount() });
  broadcastOnlineCount();

  const queuedRow = await dbGet('SELECT time_control FROM queue WHERE user_id = ?', userId);
  if (queuedRow) sseSend(res, 'queued', await queueStatus(userId, queuedRow.time_control));

  const active = await getActiveGameId(userId);
  if (active) {
    const game = await getGame(active);
    if (game) {
      sseSend(res, 'game', withServerNow(game));
      const opponentId = Number(game.white.id) === userId ? Number(game.black.id) : Number(game.white.id);
      sendToUser(opponentId, 'opponent_online', { gameId: active });
    }
  }

  const cleanup = async () => {
    const clients = sseClients.get(userId);
    if (!clients) return;
    clients.delete(res);
    if (clients.size > 0) return;
    sseClients.delete(userId);
    broadcastOnlineCount();
    const queued = await dbGet('SELECT time_control FROM queue WHERE user_id = ?', userId);
    if (queued) await removeFromQueue(userId, false);
    const gameId = await getActiveGameId(userId);
    if (gameId) {
      const game = await getGame(gameId);
      if (game) {
        const opponentId = Number(game.white.id) === userId ? Number(game.black.id) : Number(game.white.id);
        sendToUser(opponentId, 'opponent_offline', { gameId });
      }
    }
  };
  const onClose = () => { cleanup().catch(err => console.error('SSE cleanup failed:', err.message)); };
  req.on('close', onClose);
  req.on('error', onClose);
}

// ---------------------------------------------------------------------------
// Game helpers
// ---------------------------------------------------------------------------

const TIME_CONTROLS = {
  '60+0': { baseMs: 60_000, incMs: 0, label: '1+0' },
  '180+0': { baseMs: 180_000, incMs: 0, label: '3+0' },
  '300+0': { baseMs: 300_000, incMs: 0, label: '5+0' },
  '600+0': { baseMs: 600_000, incMs: 0, label: '10+0' },
  '180+2': { baseMs: 180_000, incMs: 2_000, label: '3+2' },
  '300+5': { baseMs: 300_000, incMs: 5_000, label: '5+5' },
  '900+10': { baseMs: 900_000, incMs: 10_000, label: '15+10' }
};

function parseTimeControl(tc) {
  return TIME_CONTROLS[tc] || null;
}

async function getGameRow(id) {
  return dbGet(`
    SELECT g.*, w.username AS white_name, w.rating AS white_rating,
           b.username AS black_name, b.rating AS black_rating
    FROM games g
    JOIN users w ON w.id = g.white_id
    JOIN users b ON b.id = g.black_id
    WHERE g.id = ?
  `, Number(id));
}

async function getActiveGameId(userId) {
  const row = await dbGet(`
    SELECT id FROM games
    WHERE status = 'active' AND (white_id = ? OR black_id = ?)
    ORDER BY id DESC LIMIT 1
  `, Number(userId), Number(userId));
  return row ? Number(row.id) : null;
}

function serializeGame(row, moves) {
  if (!row) return null;
  let result = '';
  if (row.status === 'white_win') result = 'White wins';
  else if (row.status === 'black_win') result = 'Black wins';
  else if (row.status === 'draw') result = 'Draw';
  else if (row.status === 'aborted') result = 'Game aborted';
  return {
    id: Number(row.id),
    status: row.status,
    reason: row.reason || '',
    result: result ? result + (row.status !== 'aborted' && row.reason ? ' by ' + row.reason.replace(/-/g, ' ') : '') : '',
    fen: row.fen,
    turn: Number(row.turn),
    timeControl: row.time_control,
    baseMs: Number(row.base_ms),
    incMs: Number(row.inc_ms),
    whiteMs: Number(row.white_ms),
    blackMs: Number(row.black_ms),
    lastMoveAt: Number(row.last_move_at),
    drawOfferBy: row.draw_offer_by ? Number(row.draw_offer_by) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    white: publicPlayer(row, 'white'),
    black: publicPlayer(row, 'black'),
    moves: (moves || []).map(m => ({ ply: Number(m.ply), uci: m.uci, san: m.san }))
  };
}

async function getGame(id, includeChat) {
  const row = await getGameRow(id);
  if (!row) return null;
  const moves = await dbAll('SELECT ply, uci, san, fen_after FROM moves WHERE game_id = ? ORDER BY ply', Number(id));
  const game = serializeGame(row, moves);
  if (includeChat) {
    const chatRows = await dbAll(`
      SELECT c.id, c.text, c.created_at, u.id AS user_id, u.username
      FROM chat c JOIN users u ON u.id = c.user_id
      WHERE c.game_id = ? ORDER BY c.id ASC LIMIT 100
    `, Number(id));
    game.chat = chatRows.map(m => ({
      id: Number(m.id), text: m.text, createdAt: Number(m.created_at),
      user: { id: Number(m.user_id), username: m.username }
    }));
  }
  return game;
}

function withServerNow(game) {
  return game ? Object.assign({}, game, { serverNow: now() }) : null;
}

function pushGame(game) {
  if (!game) return;
  const payload = withServerNow(game);
  sendToUser(game.white.id, 'game', payload);
  sendToUser(game.black.id, 'game', payload);
}

function pushGameOver(game) {
  if (!game) return;
  const payload = withServerNow(game);
  sendToUser(game.white.id, 'game_over', payload);
  sendToUser(game.black.id, 'game_over', payload);
}

function pushDrawOffer(game, fromUser) {
  if (!game) return;
  const payload = { gameId: game.id, from: { id: Number(fromUser.id), username: fromUser.username } };
  sendToUser(game.white.id, 'draw_offer', payload);
  sendToUser(game.black.id, 'draw_offer', payload);
}

async function finishGame(gameId, status, reason) {
  const row = await getGameRow(gameId);
  if (!row || row.status !== 'active') return null;
  let skipped = false;
  const ratingExpr = USE_POSTGRES ? 'GREATEST(100, rating + ?)' : 'MAX(100, rating + ?)';
  try {
    await withTransaction(async (tx) => {
      const update = await tx.run(`
        UPDATE games SET status = ?, reason = ?, updated_at = ?
        WHERE id = ? AND status = 'active'
      `, status, reason, now(), Number(gameId));
      if (Number(update.changes) === 0) {
        skipped = true;
        return;
      }
      if (status !== 'aborted') {
        const white = await tx.get('SELECT id, rating FROM users WHERE id = ?', Number(row.white_id));
        const black = await tx.get('SELECT id, rating FROM users WHERE id = ?', Number(row.black_id));
        if (white && black) {
          const whiteScore = status === 'white_win' ? 1 : status === 'black_win' ? 0 : 0.5;
          const expectedWhite = 1 / (1 + Math.pow(10, (Number(black.rating) - Number(white.rating)) / 400));
          const expectedBlack = 1 - expectedWhite;
          const k = 24;
          const whiteDelta = Math.round(k * (whiteScore - expectedWhite));
          const blackDelta = Math.round(k * ((1 - whiteScore) - expectedBlack));
          await tx.run(`UPDATE users SET rating = ${ratingExpr}, wins = wins + ?, losses = losses + ?, draws = draws + ? WHERE id = ?`,
            whiteDelta, status === 'white_win' ? 1 : 0, status === 'black_win' ? 1 : 0, status === 'draw' ? 1 : 0, Number(white.id));
          await tx.run(`UPDATE users SET rating = ${ratingExpr}, wins = wins + ?, losses = losses + ?, draws = draws + ? WHERE id = ?`,
            blackDelta, status === 'black_win' ? 1 : 0, status === 'white_win' ? 1 : 0, status === 'draw' ? 1 : 0, Number(black.id));
        }
      }
    });
  } catch (e) {
    console.error('finishGame failed', e);
  }
  if (skipped) return await getGame(gameId);
  const game = await getGame(gameId);
  if (game) {
    pushGame(game);
    pushGameOver(game);
  }
  return game;
}

async function refreshGame(row) {
  if (!row || row.status !== 'active') return row;
  const turn = Number(row.turn);
  const elapsed = Math.max(0, now() - Number(row.last_move_at));
  const remaining = turn === 1 ? Number(row.white_ms) : Number(row.black_ms);
  if (remaining - elapsed <= 0) {
    await finishGame(Number(row.id), turn === 1 ? 'black_win' : 'white_win', 'timeout');
    return await getGameRow(row.id);
  }
  return row;
}

async function isThreefold(gameId, state) {
  const key = Engine.positionKey(state);
  let count = Engine.positionKey(Engine.initialState()) === key ? 1 : 0;
  const rows = await dbAll('SELECT fen_after FROM moves WHERE game_id = ?', Number(gameId));
  for (const row of rows) {
    if (Engine.positionKey(Engine.fromFEN(row.fen_after)) === key) count++;
  }
  return count >= 3;
}

async function detectGameEnd(gameId, state) {
  const moves = Engine.legalMoves(state);
  if (moves.length === 0) {
    if (Engine.inCheck(state, state.turn)) {
      return { status: state.turn === 1 ? 'black_win' : 'white_win', reason: 'checkmate' };
    }
    return { status: 'draw', reason: 'stalemate' };
  }
  if (state.hm >= 100) return { status: 'draw', reason: '50-move rule' };
  if (Engine.insufficientMaterial(state)) return { status: 'draw', reason: 'insufficient material' };
  if (await isThreefold(gameId, state)) return { status: 'draw', reason: 'threefold repetition' };
  return null;
}

async function createGameRecord(whiteId, blackId, tc, tx) {
  const cfg = parseTimeControl(tc);
  if (!cfg) throw new Error('Invalid time control');
  const fen = Engine.toFEN(Engine.initialState());
  const t = now();
  const sql = `
    INSERT INTO games (white_id, black_id, status, reason, fen, turn, time_control,
      base_ms, inc_ms, white_ms, black_ms, last_move_at, created_at, updated_at)
    VALUES (?, ?, 'active', '', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [Number(whiteId), Number(blackId), fen, tc, cfg.baseMs, cfg.incMs, cfg.baseMs, cfg.baseMs, t, t, t];
  if (tx) return tx.insert(sql, ...params);
  return dbInsert(sql, ...params);
}

// ---------------------------------------------------------------------------
// Matchmaking
// ---------------------------------------------------------------------------

// The queue lives in the database so matchmaking works across serverless
// instances. Position and waiting time are derived from the joined_at values.
async function queueStatus(userId, tc) {
  const row = await dbGet('SELECT time_control, joined_at FROM queue WHERE user_id = ?', Number(userId));
  if (!row || row.time_control !== tc) return { queued: false, online: onlineCount() };
  const before = await dbGet(`
    SELECT COUNT(*) AS c FROM queue
    WHERE time_control = ? AND joined_at <= ?
  `, tc, Number(row.joined_at));
  const total = await dbGet('SELECT COUNT(*) AS c FROM queue WHERE time_control = ?', tc);
  return {
    queued: true,
    timeControl: tc,
    position: Number(before.c),
    queueLength: Number(total.c),
    elapsedSeconds: Math.floor((now() - Number(row.joined_at)) / 1000),
    online: onlineCount()
  };
}

async function removeFromQueue(userId, notify) {
  const id = Number(userId);
  const row = await dbGet('SELECT time_control FROM queue WHERE user_id = ?', id);
  if (!row) return false;
  await dbRun('DELETE FROM queue WHERE user_id = ?', id);
  if (notify) sendToUser(id, 'queue_cancelled', { timeControl: row.time_control });
  return true;
}

async function tryMatch(tc) {
  if (!parseTimeControl(tc)) return false;
  const t = now();
  // Drop abandoned entries. A polling client refreshes last_seen every few
  // seconds, so two minutes without activity means the tab is gone.
  await dbRun(`
    DELETE FROM queue
    WHERE time_control = ? AND (
      joined_at < ? OR user_id NOT IN (SELECT id FROM users WHERE last_seen >= ?)
    )
  `, tc, t - 5 * 60_000, t - 2 * 60_000);

  const rows = await dbAll(`
    SELECT q.user_id, q.rating, q.joined_at, u.last_seen
    FROM queue q JOIN users u ON u.id = q.user_id
    WHERE q.time_control = ? ORDER BY q.joined_at ASC
  `, tc);
  if (rows.length < 2) return false;

  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    if (await getActiveGameId(a.user_id)) {
      await removeFromQueue(a.user_id, true);
      continue;
    }
    const waitA = t - Number(a.joined_at);
    const windowA = Math.min(1200, 200 + Math.floor(waitA / 10_000) * 100);
    let best = null;
    let bestDiff = Infinity;
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j];
      if (await getActiveGameId(b.user_id)) {
        await removeFromQueue(b.user_id, true);
        continue;
      }
      const waitB = t - Number(b.joined_at);
      const windowB = Math.min(1200, 200 + Math.floor(waitB / 10_000) * 100);
      const diff = Math.abs(Number(a.rating) - Number(b.rating));
      if (diff <= Math.max(windowA, windowB) && diff < bestDiff) {
        bestDiff = diff;
        best = b;
      }
    }
    if (!best) continue;

    const aWhite = crypto.randomInt(2) === 0;
    const whiteId = aWhite ? a.user_id : best.user_id;
    const blackId = aWhite ? best.user_id : a.user_id;
    let gameId = null;
    await withTransaction(async (tx) => {
      const deleted = await tx.run('DELETE FROM queue WHERE user_id IN (?, ?)', Number(a.user_id), Number(best.user_id));
      if (Number(deleted.changes) !== 2) return;
      gameId = await createGameRecord(whiteId, blackId, tc, tx);
    });
    if (!gameId) return false;

    const game = await getGame(gameId);
    sendToUser(a.user_id, 'matched', { gameId, color: aWhite ? 'white' : 'black' });
    sendToUser(best.user_id, 'matched', { gameId, color: aWhite ? 'black' : 'white' });
    pushGame(game);
    return true;
  }
  return false;
}

async function joinQueue(userId, user, tc) {
  const id = Number(userId);
  if (!parseTimeControl(tc)) throw Object.assign(new Error('Unsupported time control.'), { status: 400 });
  if (await getActiveGameId(id)) throw Object.assign(new Error('You already have an active game.'), { status: 409 });
  await removeFromQueue(id, false);
  await dbRun('INSERT INTO queue (user_id, time_control, rating, joined_at) VALUES (?, ?, ?, ?)',
    id, tc, Number(user.rating), now());
  await tryMatch(tc);
  const row = await dbGet('SELECT time_control FROM queue WHERE user_id = ?', id);
  return {
    queued: Boolean(row && row.time_control === tc),
    queue: row ? await queueStatus(id, row.time_control) : null,
    activeGameId: await getActiveGameId(id)
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // ---- auth ----
  if (pathname === '/api/auth/register' && method === 'POST') {
    if (!checkRateLimit('register:' + clientIp(req), 20, 60 * 60 * 1000)) {
      return sendError(res, 429, 'Too many accounts created from this location. Try again later.');
    }
    const body = await readJson(req);
    const username = normalizeUsername(body.username);
    const password = body.password;
    if (!validUsername(username)) {
      return sendError(res, 400, 'Username must be 3–20 characters: letters, numbers, or underscore.');
    }
    if (!validPassword(password)) {
      return sendError(res, 400, 'Password must be between 8 and 128 characters.');
    }
    const existing = await dbGet('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', username);
    if (existing) return sendError(res, 409, 'That username is already registered.');
    const { salt, hash } = await hashPassword(password);
    const t = now();
    let userId;
    try {
      userId = await dbInsert(`
        INSERT INTO users (username, password_salt, password_hash, rating, created_at, last_seen)
        VALUES (?, ?, ?, 1200, ?, ?)
      `, username, salt, hash, t, t);
    } catch (e) {
      return sendError(res, 409, 'That username is already registered.');
    }
    clearRateLimit('register:' + clientIp(req));
    const row = await dbGet('SELECT * FROM users WHERE id = ?', userId);
    await createSession(req, res, userId);
    return sendJson(res, 201, { user: publicUser(row) });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readJson(req);
    const username = normalizeUsername(body.username);
    const password = body.password;
    if (!username || !password) return sendError(res, 400, 'Enter your username and password.');
    const rateKey = 'login:' + clientIp(req) + ':' + username.toLowerCase();
    if (!checkRateLimit(rateKey, 10, 10 * 60 * 1000)) {
      return sendError(res, 429, 'Too many sign-in attempts. Wait a few minutes and try again.');
    }
    const row = await dbGet('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', username);
    if (!row) return sendError(res, 401, 'Incorrect username or password.');
    const ok = await verifyPassword(String(password), row.password_salt, row.password_hash);
    if (!ok) return sendError(res, 401, 'Incorrect username or password.');
    clearRateLimit(rateKey);
    await dbRun('UPDATE users SET last_seen = ? WHERE id = ?', now(), row.id);
    await createSession(req, res, row.id);
    return sendJson(res, 200, { user: publicUser(row) });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    await destroySession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/auth/password' && method === 'POST') {
    const user = await requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    if (!validPassword(body.newPassword)) return sendError(res, 400, 'New password must be between 8 and 128 characters.');
    const ok = await verifyPassword(String(body.currentPassword || ''), user.password_salt, user.password_hash);
    if (!ok) return sendError(res, 401, 'Current password is incorrect.');
    const { salt, hash } = await hashPassword(body.newPassword);
    await dbRun('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?', salt, hash, user.id);
    await dbRun('DELETE FROM sessions WHERE user_id = ?', user.id);
    await createSession(req, res, user.id);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/me' && method === 'GET') {
    const user = await requireUser(req, res);
    if (!user) return;
    const activeGameId = await getActiveGameId(user.id);
    const queued = await dbGet('SELECT time_control FROM queue WHERE user_id = ?', user.id);
    return sendJson(res, 200, {
      user: publicUser(user),
      activeGameId,
      queue: queued ? await queueStatus(user.id, queued.time_control) : null,
      online: onlineCount()
    });
  }

  // ---- public stats ----
  if (pathname === '/api/leaderboard' && method === 'GET') {
    const rows = await dbAll(`
      SELECT id, username, rating, wins, losses, draws
      FROM users ORDER BY rating DESC, wins DESC, username ASC LIMIT 50
    `);
    return sendJson(res, 200, {
      players: rows.map((r, i) => ({
        rank: i + 1, id: Number(r.id), username: r.username, rating: Number(r.rating),
        wins: Number(r.wins), losses: Number(r.losses), draws: Number(r.draws)
      }))
    });
  }

  if (pathname === '/api/stats' && method === 'GET') {
    const users = await dbGet('SELECT COUNT(*) AS c FROM users');
    const games = await dbGet("SELECT COUNT(*) AS c FROM games WHERE status != 'active'");
    const active = await dbGet("SELECT COUNT(*) AS c FROM games WHERE status = 'active'");
    const queued = await dbGet('SELECT COUNT(*) AS c FROM queue');
    const online = await dbGet('SELECT COUNT(*) AS c FROM users WHERE last_seen >= ?', now() - 2 * 60_000);
    return sendJson(res, 200, {
      users: Number(users.c),
      games: Number(games.c),
      activeGames: Number(active.c),
      online: Number(online.c),
      queued: Number(queued.c)
    });
  }

  if (pathname === '/api/online' && method === 'GET') {
    // Reading the session refreshes last_seen so the lobby's live count stays accurate.
    await getSessionUser(req).catch(() => null);
    const rows = await dbAll(`
      SELECT id, username, rating FROM users
      WHERE last_seen >= ? ORDER BY last_seen DESC LIMIT 100
    `, now() - 2 * 60_000);
    const queueRows = await dbAll('SELECT time_control, COUNT(*) AS c FROM queue GROUP BY time_control');
    const timeControls = {};
    for (const row of queueRows) timeControls[row.time_control] = Number(row.c);
    return sendJson(res, 200, {
      online: rows.map(row => ({ id: Number(row.id), username: row.username, rating: Number(row.rating) })),
      count: rows.length,
      queues: timeControls
    });
  }

  // ---- live events ----
  if (pathname === '/api/events' && method === 'GET') {
    const user = await requireUser(req, res);
    if (!user) return;
    return handleSse(req, res, user);
  }

  // ---- matchmaking ----
  if (pathname === '/api/online/queue' && method === 'POST') {
    const user = await requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const tc = String(body.timeControl || '');
    try {
      const status = await joinQueue(user.id, user, tc);
      return sendJson(res, 200, status);
    } catch (e) {
      return sendError(res, e.status || 400, e.message);
    }
  }

  if (pathname === '/api/online/cancel' && method === 'POST') {
    const user = await requireUser(req, res);
    if (!user) return;
    await removeFromQueue(user.id, true);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/online/status' && method === 'GET') {
    const user = await requireUser(req, res);
    if (!user) return;
    const queued = await dbGet('SELECT time_control FROM queue WHERE user_id = ?', user.id);
    if (queued) await tryMatch(queued.time_control);
    const activeGameId = await getActiveGameId(user.id);
    const stillQueued = await dbGet('SELECT time_control FROM queue WHERE user_id = ?', user.id);
    return sendJson(res, 200, {
      activeGameId,
      queue: stillQueued ? await queueStatus(user.id, stillQueued.time_control) : null,
      online: onlineCount()
    });
  }

  // ---- games ----
  const gameMatch = pathname.match(/^\/api\/games\/(\d+)(?:\/(move|resign|abort|draw|chat))?$/);
  if (gameMatch) {
    const user = await requireUser(req, res);
    if (!user) return;
    const gameId = Number(gameMatch[1]);
    const action = gameMatch[2] || '';
    let row = await getGameRow(gameId);
    if (!row) return sendError(res, 404, 'Game not found.');
    row = await refreshGame(row);

    if (method === 'GET' && !action) {
      const game = await getGame(gameId, true);
      if (game) {
        const opponentId = Number(row.white_id) === Number(user.id) ? Number(row.black_id) : Number(row.white_id);
        const opponent = await dbGet('SELECT last_seen FROM users WHERE id = ?', opponentId);
        game.opponentOnline = Boolean(opponent && now() - Number(opponent.last_seen) < 90_000);
      }
      return sendJson(res, 200, { game: withServerNow(game) });
    }

    const isWhite = Number(row.white_id) === Number(user.id);
    const isBlack = Number(row.black_id) === Number(user.id);
    if (!isWhite && !isBlack) return sendError(res, 403, 'You are not a player in this game.');
    const color = isWhite ? 1 : -1;

    if (method === 'POST' && action === 'move') {
      if (row.status !== 'active') return sendError(res, 409, 'This game is not active.', { game: withServerNow(await getGame(gameId)) });
      if (Number(row.turn) !== color) return sendError(res, 409, 'It is not your turn.');
      const body = await readJson(req);
      const uci = String(body.uci || '').toLowerCase();
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return sendError(res, 400, 'Invalid move format.');
      const state = Engine.fromFEN(row.fen);
      const move = Engine.uciToMove(state, uci);
      if (!move) return sendError(res, 400, 'That move is not legal.');
      const t = now();
      const elapsed = Math.max(0, t - Number(row.last_move_at));
      const currentMs = color === 1 ? Number(row.white_ms) : Number(row.black_ms);
      if (currentMs - elapsed <= 0) {
        await finishGame(gameId, color === 1 ? 'black_win' : 'white_win', 'timeout');
        return sendError(res, 409, 'Your time expired.', { game: withServerNow(await getGame(gameId)) });
      }
      const next = Engine.applyMove(state, move);
      const san = Engine.moveToSan(move, state);
      const nextMs = Math.max(0, currentMs - elapsed) + Number(row.inc_ms);
      const plyRow = await dbGet('SELECT COALESCE(MAX(ply), 0) AS p FROM moves WHERE game_id = ?', gameId);
      const ply = Number(plyRow.p) + 1;
      const updated = await dbRun(`
        UPDATE games SET fen = ?, turn = ?, white_ms = ?, black_ms = ?, last_move_at = ?,
          draw_offer_by = NULL, updated_at = ? WHERE id = ? AND status = 'active'
      `,
        Engine.toFEN(next), next.turn,
        color === 1 ? nextMs : Number(row.white_ms),
        color === -1 ? nextMs : Number(row.black_ms),
        t, t, gameId
      );
      if (Number(updated.changes) === 0) {
        return sendError(res, 409, 'This game is not active.', { game: withServerNow(await getGame(gameId)) });
      }
      await dbRun('INSERT INTO moves (game_id, ply, uci, san, fen_after, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        gameId, ply, uci, san, Engine.toFEN(next), t);
      const end = await detectGameEnd(gameId, next);
      if (end) {
        const game = await finishGame(gameId, end.status, end.reason);
        return sendJson(res, 200, { game: withServerNow(game || await getGame(gameId)), ended: true });
      }
      const game = await getGame(gameId);
      pushGame(game);
      return sendJson(res, 200, { game: withServerNow(game), ended: false });
    }

    if (method === 'POST' && action === 'resign') {
      if (row.status !== 'active') return sendError(res, 409, 'This game is not active.');
      const game = await finishGame(gameId, isWhite ? 'black_win' : 'white_win', 'resignation');
      return sendJson(res, 200, { game: withServerNow(game) });
    }

    if (method === 'POST' && action === 'abort') {
      if (row.status !== 'active') return sendError(res, 409, 'This game is not active.');
      const plyRow = await dbGet('SELECT COALESCE(MAX(ply), 0) AS p FROM moves WHERE game_id = ?', gameId);
      if (Number(plyRow.p) >= 2) return sendError(res, 409, 'A game can only be aborted before two moves.');
      const game = await finishGame(gameId, 'aborted', 'aborted');
      return sendJson(res, 200, { game: withServerNow(game) });
    }

    if (method === 'POST' && action === 'draw') {
      if (row.status !== 'active') return sendError(res, 409, 'This game is not active.');
      const body = await readJson(req);
      const drawAction = String(body.action || '');
      if (drawAction === 'offer') {
        await dbRun('UPDATE games SET draw_offer_by = ?, updated_at = ? WHERE id = ?', user.id, now(), gameId);
        const game = await getGame(gameId);
        pushGame(game);
        pushDrawOffer(game, user);
        return sendJson(res, 200, { game: withServerNow(game), offered: true });
      }
      if (drawAction === 'accept') {
        if (!row.draw_offer_by) return sendError(res, 400, 'There is no draw offer to accept.');
        if (Number(row.draw_offer_by) === Number(user.id)) return sendError(res, 400, 'You cannot accept your own draw offer.');
        const game = await finishGame(gameId, 'draw', 'agreement');
        return sendJson(res, 200, { game: withServerNow(game) });
      }
      if (drawAction === 'decline') {
        if (!row.draw_offer_by) return sendError(res, 400, 'There is no draw offer to decline.');
        if (Number(row.draw_offer_by) === Number(user.id)) return sendError(res, 400, 'You cannot decline your own draw offer.');
        await dbRun('UPDATE games SET draw_offer_by = NULL, updated_at = ? WHERE id = ?', now(), gameId);
        const game = await getGame(gameId);
        pushGame(game);
        sendToUser(Number(row.white_id), 'draw_declined', { gameId });
        sendToUser(Number(row.black_id), 'draw_declined', { gameId });
        return sendJson(res, 200, { game: withServerNow(game), declined: true });
      }
      return sendError(res, 400, 'Invalid draw action.');
    }

    if (method === 'POST' && action === 'chat') {
      const body = await readJson(req);
      const text = String(body.text || '').trim();
      if (!text || text.length > 300) return sendError(res, 400, 'Message must be 1-300 characters.');
      const t = now();
      const id = await dbInsert('INSERT INTO chat (game_id, user_id, text, created_at) VALUES (?, ?, ?, ?)',
        gameId, user.id, text, t);
      const msg = {
        id, text, createdAt: t,
        user: { id: Number(user.id), username: user.username }
      };
      sendToUser(Number(row.white_id), 'chat', { gameId, message: msg });
      sendToUser(Number(row.black_id), 'chat', { gameId, message: msg });
      return sendJson(res, 201, { message: msg });
    }

    return sendError(res, 405, 'Unsupported game action.');
  }

  // ---- account history ----
  if (pathname === '/api/account/games' && method === 'GET') {
    const user = await requireUser(req, res);
    if (!user) return;
    const rows = await dbAll(`
      SELECT g.*, w.username AS white_name, b.username AS black_name
      FROM games g
      JOIN users w ON w.id = g.white_id
      JOIN users b ON b.id = g.black_id
      WHERE (g.white_id = ? OR g.black_id = ?) AND g.status != 'active'
      ORDER BY g.updated_at DESC LIMIT 25
    `, user.id, user.id);
    const games = rows.map(row => {
      const white = Number(row.white_id) === Number(user.id);
      let result = 'draw';
      if (row.status === 'aborted') result = 'aborted';
      else if (row.status !== 'draw') {
        result = (row.status === 'white_win' && white) || (row.status === 'black_win' && !white) ? 'win' : 'loss';
      }
      return {
        id: Number(row.id),
        opponent: white ? row.black_name : row.white_name,
        color: white ? 'white' : 'black',
        result,
        status: row.status,
        reason: row.reason,
        timeControl: row.time_control,
        date: Number(row.updated_at)
      };
    });
    return sendJson(res, 200, { games, activeGameId: await getActiveGameId(user.id) });
  }

  return sendError(res, 404, 'API endpoint not found.');
}

// ---------------------------------------------------------------------------
// Static hosting
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (e) {
    res.writeHead(400); res.end('Bad request'); return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (pathname.includes('\0')) { res.writeHead(400); res.end('Bad request'); return; }
  let file = path.resolve(PUBLIC_DIR, '.' + pathname);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (!path.extname(pathname)) {
        file = path.join(PUBLIC_DIR, 'index.html');
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
    }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const data = fs.readFileSync(file);
    const cache = ['.html', '.js', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=86400';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'SAMEORIGIN',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    });
    if (req.method === 'HEAD') res.end(); else res.end(data);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal server error');
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  await ensureDb();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !checkOrigin(req)) {
      return sendError(res, 403, 'Request origin not allowed.');
    }
    await handleApi(req, res, url);
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, url);
    return;
  }
  res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method not allowed');
}

function requestListener(req, res) {
  handleRequest(req, res).catch(err => {
    console.error('Request failed:', err);
    if (!res.headersSent) sendError(res, err.status || 500, err.status ? err.message : 'Internal server error.');
    else { try { res.end(); } catch (e) {} }
  });
}

const server = http.createServer(requestListener);

// Long-running timers only run in the traditional Node server. Serverless
// deployments rely on client polling and the per-request clock refresh.
let backgroundStarted = false;
function startBackgroundJobs() {
  if (backgroundStarted) return;
  backgroundStarted = true;

  // Heartbeat keeps proxies and browsers from dropping idle SSE streams.
  setInterval(() => {
    for (const set of sseClients.values()) {
      for (const res of set) {
        if (!res.writableEnded) res.write(': ping\n\n');
      }
    }
  }, 15_000).unref();

  // Expired session cleanup.
  setInterval(() => {
    dbRun('DELETE FROM sessions WHERE expires_at <= ?', now()).catch(() => {});
  }, 60 * 60 * 1000).unref();

  // Authoritative clock checks. A game can end on time even if both clients are closed.
  let clockTickBusy = false;
  setInterval(async () => {
    if (clockTickBusy) return;
    clockTickBusy = true;
    try {
      const rows = await dbAll("SELECT id FROM games WHERE status = 'active'");
      for (const row of rows) {
        const game = await getGameRow(row.id);
        if (game) await refreshGame(game);
      }
    } catch (e) {
      console.error('Clock tick failed:', e.message);
    } finally {
      clockTickBusy = false;
    }
  }, 1000).unref();

  // Rating windows expand while players wait, so re-attempt every few seconds.
  setInterval(async () => {
    try {
      const rows = await dbAll('SELECT DISTINCT time_control FROM queue');
      for (const row of rows) await tryMatch(row.time_control);
    } catch (e) {
      console.error('Matchmaking tick failed:', e.message);
    }
  }, 3000).unref();
}

function localAddresses(port) {
  const os = require('node:os');
  const out = [`http://localhost:${port}`];
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) out.push(`http://${net.address}:${port}`);
      }
    }
  } catch (e) {}
  return [...new Set(out)];
}

async function start() {
  await ensureDb();
  startBackgroundJobs();
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  \u265E  MarsChess is live');
    for (const u of localAddresses(PORT)) console.log('     ' + u);
    console.log('  Database:', USE_POSTGRES ? 'PostgreSQL' : DB_PATH);
    console.log('  Press Ctrl+C to stop.');
    console.log('');
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start MarsChess:', err);
    process.exit(1);
  });

  server.on('error', (err) => {
    console.error('Server error:', err.message);
    process.exitCode = 1;
  });

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    console.log('\nStopping MarsChess...');
    for (const set of sseClients.values()) {
      for (const res of set) {
        try { res.end(); } catch (e) {}
      }
    }
    server.close(() => {
      closeDb().catch(() => {}).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 2500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { handleRequest, requestListener, ensureDb, server };
