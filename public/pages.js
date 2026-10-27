/* MarsChess marketing, authentication, leaderboard, account, and learn pages. */
(function () {
  'use strict';

  const MC = window.MC;
  const E = MC.E;
  const state = MC.state;

  // -------------------------------------------------------------------------
  // Home
  // -------------------------------------------------------------------------

  async function renderHome(route, token) {
    MC.renderLoading('Preparing the arena…');
    let stats = state.stats;
    let leaderboard = null;
    try {
      const [statsData, leaderboardData] = await Promise.all([
        MC.api('/api/stats'),
        MC.api('/api/leaderboard')
      ]);
      stats = statsData;
      leaderboard = leaderboardData;
      state.stats = statsData;
    } catch (e) {
      stats = state.stats || { users: 0, games: 0, activeGames: 0, online: 0, queued: 0 };
    }
    if (token !== state.pageToken) return;

    const activeGameId = state.me && state.me.activeGameId;
    const top = leaderboard && leaderboard.players ? leaderboard.players.slice(0, 3) : [];
    const levelCards = MC.BOT_LEVELS.slice(0, 5).map(b => `
      <div class="level-chip">
        <span class="lc-icon">${b.glyph}</span>
        <span style="min-width:0"><span class="lc-name">${MC.escapeHtml(b.name)}</span><span class="lc-rating">${b.rating} Elo</span></span>
      </div>`).join('');

    const html = `
      <div class="home-page">
        <section class="hero">
          <div class="hero-copy">
            <span class="eyebrow">${state.user ? 'Welcome back, ' + MC.escapeHtml(state.user.username) : 'Welcome to MarsChess'}</span>
            <h1>Chess that plays<br><span class="mars">at Mars speed.</span></h1>
            <p class="hero-lead">Challenge ten bots from Dust to Martian — or find a real opponent online. A fast, beautiful chess arena built for phones, tablets, and desktops across every world.</p>
            <div class="hero-actions">
              <a class="btn btn-primary btn-lg" href="#play">♞ Play a bot</a>
              <a class="btn btn-secondary btn-lg" href="#online">Find an opponent</a>
              ${!state.user ? '<a class="btn btn-ghost btn-lg" href="#auth/register">Create account</a>' : ''}
            </div>
            <div class="hero-stats">
              <div class="hero-stat"><span class="live-dot"></span><b data-online-count>${MC.formatNumber(stats.online || 0)}</b> online</div>
              <div class="hero-stat"><b>${MC.formatNumber(stats.users || 0)}</b> players</div>
              <div class="hero-stat"><b>${MC.formatNumber(stats.games || 0)}</b> games played</div>
              <div class="hero-stat"><b>10</b> bot levels</div>
            </div>
            ${activeGameId ? `
              <div class="active-game-banner" style="margin-top:22px">
                <div class="ag-icon">♞</div>
                <div class="ag-copy"><h3>You have a game in progress</h3><p>Jump back in before your clock runs out.</p></div>
                <a class="btn btn-green btn-sm" href="#game/${activeGameId}">Resume</a>
              </div>` : ''}
          </div>
          <div class="hero-visual">
            <div class="hero-planet" aria-hidden="true"></div>
            <div class="hero-board-frame"><div id="heroBoard"></div></div>
            <div class="hero-badge one"><span class="badge-icon">♚</span><span><strong>3200 Elo</strong> Martian bot</span></div>
            <div class="hero-badge two"><span class="badge-icon">♞</span><span class="hero-badge-text"><strong>Live</strong> online games</span></div>
          </div>
        </section>

        <section class="home-section">
          <div class="section-head">
            <div><span class="eyebrow">Built for every device</span><h2>One arena. Every screen.</h2><p>Click or tap to move. The board, clocks, chat, and analysis all adapt from a phone in your pocket to a desktop monitor.</p></div>
            <a class="btn btn-secondary" href="#learn">How it works</a>
          </div>
          <div class="feature-grid">
            <a class="feature-card" href="#play">
              <div class="feature-icon">♞</div>
              <h3>Ten bot brains</h3>
              <p>From a friendly 400 Elo Dust bot to the 3200 Elo Martian. Faster thinking, deeper calculation, and a level for every mood.</p>
              <span class="feature-link">Choose your rival →</span>
            </a>
            <a class="feature-card" href="#online">
              <div class="feature-icon">◉</div>
              <h3>Real online opponents</h3>
              <p>Create an account, pick a time control, and get matched with another human. Every move is validated and every clock is server-authoritative.</p>
              <span class="feature-link">Find a game →</span>
            </a>
            <a class="feature-card" href="${state.user ? '#account' : '#auth/register'}">
              <div class="feature-icon">▤</div>
              <h3>Game review, built in</h3>
              <p>After every game, run a Stockfish review: accuracy scores, best moves, blunders, key moments, and an interactive eval graph.</p>
              <span class="feature-link">${state.user ? 'Review your games →' : 'Create a free account →'}</span>
            </a>
          </div>
        </section>

        <section class="home-section">
          <div class="section-head">
            <div><span class="eyebrow">The bot ladder</span><h2>Ten brains. One board.</h2><p>Every bot has its own personality, rating, and thinking speed.</p></div>
            <a class="btn btn-outline" href="#play">See all levels</a>
          </div>
          <div class="level-strip">${levelCards}</div>
        </section>

        ${top.length ? `
        <section class="home-section">
          <div class="section-head">
            <div><span class="eyebrow">Mars leaderboard</span><h2>The strongest on the surface.</h2></div>
            <a class="btn btn-ghost" href="#leaderboard">Full leaderboard →</a>
          </div>
          <div class="leader-side home-leader-side">
            ${top.map(p => `<div class="panel panel-pad"><div class="row"><span class="leader-avatar">${MC.escapeHtml(MC.initials(p.username))}</span><div class="grow"><div class="leader-user-name">${MC.escapeHtml(p.username)}</div><div class="muted tiny">${p.wins}W ${p.losses}L ${p.draws}D</div></div><span class="leader-rating">${MC.formatNumber(p.rating)}</span></div></div>`).join('')}
          </div>
        </section>` : ''}

        <section class="cta-band">
          <div>
            <span class="eyebrow">Your next move</span>
            <h2>Ready to land on the board?</h2>
            <p>Play instantly against a bot, or create an account and challenge the world.</p>
          </div>
          <div class="cta-actions">
            <a class="btn btn-primary btn-lg" href="#play">Play a bot</a>
            <a class="btn btn-secondary btn-lg" href="#online">Play online</a>
          </div>
        </section>
      </div>`;

    MC.setView(html);
    const heroEl = MC.byId('heroBoard');
    if (heroEl) {
      const preview = E.fromFEN('r1bqkbnr/pp1ppppp/2n5/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
      new MC.Board(heroEl, {
        state: preview,
        interactive: false,
        theme: 'mars',
        showLegal: false,
        showLast: true
      });
    }
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  function authError(form, message) {
    const box = form.querySelector('.form-error');
    if (!box) return;
    box.textContent = message;
    box.classList.toggle('show', Boolean(message));
  }

  function setBusy(form, busy) {
    const btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    btn.disabled = busy;
    if (!btn.dataset.label) btn.dataset.label = btn.innerHTML;
    btn.innerHTML = busy ? '<span class="spinner"></span><span>Please wait…</span>' : btn.dataset.label;
  }

  async function renderAuth(route, token) {
    if (state.user) {
      const target = state.auth.redirect || '#account';
      state.auth.redirect = null;
      MC.navigate(target);
      return;
    }
    const mode = route.param === 'register' ? 'register' : 'login';
    state.auth.mode = mode;
    state.auth.error = '';
    const redirect = state.auth.redirect;
    const redirectNote = redirect === '#online' ? 'Sign in to play against real people.' : redirect ? 'Sign in to continue.' : '';

    MC.setView(`
      <div class="auth-page">
        <section class="panel auth-panel">
          <div class="auth-tabs">
            <a href="#auth" class="${mode === 'login' ? 'active' : ''}">Sign in</a>
            <a href="#auth/register" class="${mode === 'register' ? 'active' : ''}">Create account</a>
          </div>
          <h1 class="auth-title">${mode === 'login' ? 'Welcome back.' : 'Join the mission.'}</h1>
          <p class="auth-sub">${mode === 'login' ? 'Sign in with your MarsChess username and password.' : 'Create a username and password. No email, no Google, no fuss.'} ${redirectNote ? `<span class="accent">${MC.escapeHtml(redirectNote)}</span>` : ''}</p>

          <form class="auth-form" data-form="${mode === 'login' ? 'login' : 'register'}" novalidate>
            <div class="form-error" role="alert"></div>
            <div class="field">
              <label for="authUsername">Username</label>
              <input class="input" id="authUsername" name="username" type="text" autocomplete="username" maxlength="20" placeholder="e.g. red_rover" required>
            </div>
            ${mode === 'register' ? '<p class="form-hint">3–20 characters: letters, numbers, or underscore.</p>' : ''}
            <div class="field">
              <label for="authPassword">Password</label>
              <div class="password-wrap">
                <input class="input" id="authPassword" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" maxlength="128" placeholder="At least 8 characters" required>
                <button class="password-toggle" type="button" data-action="toggle-password" aria-label="Show password">Show</button>
              </div>
            </div>
            ${mode === 'register' ? `
              <div class="field">
                <label for="authConfirm">Confirm password</label>
                <div class="password-wrap">
                  <input class="input" id="authConfirm" name="confirm" type="password" autocomplete="new-password" maxlength="128" placeholder="Repeat your password" required>
                  <button class="password-toggle" type="button" data-action="toggle-password" aria-label="Show password">Show</button>
                </div>
              </div>` : ''}
            <button class="btn btn-primary btn-lg btn-block" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
            <p class="form-note">${mode === 'login' ? 'New to MarsChess? <a class="link-btn" href="#auth/register">Create an account</a>.' : 'Already have an account? <a class="link-btn" href="#auth">Sign in</a>.'}</p>
          </form>
        </section>

        <aside class="auth-side">
          <div>
            <span class="eyebrow">Mission profile</span>
            <h2>Your name, your rating, your legend.</h2>
            <p style="margin-top:10px">Accounts are stored in the MarsChess database with securely hashed passwords. Sign in to unlock online play, saved history, and game review.</p>
          </div>
          <ul class="auth-benefits">
            <li><span class="benefit-icon">◉</span><span>Play rated games against real people online.</span></li>
            <li><span class="benefit-icon">✦</span><span>Track wins, losses, draws, and your Elo rating.</span></li>
            <li><span class="benefit-icon">▤</span><span>Review finished games move by move with Stockfish.</span></li>
            <li><span class="benefit-icon">♞</span><span>Your account works on every device with a browser.</span></li>
          </ul>
          <p class="auth-side-note">Passwords are salted and hashed with scrypt. Your API key is never needed for online play.</p>
        </aside>
      </div>`);

    const form = document.querySelector('form[data-form]');
    if (!form) return;
    setTimeout(() => {
      const input = form.querySelector('input[name="username"]');
      if (input) input.focus({ preventScroll: true });
    }, 60);
  }

  MC.actions['toggle-password'] = el => {
    const wrap = el.closest('.password-wrap');
    const input = wrap && wrap.querySelector('input');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.textContent = show ? 'Hide' : 'Show';
    el.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  };

  MC.forms.login = async form => {
    authError(form, '');
    const username = form.querySelector('[name="username"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    if (!username || !password) {
      authError(form, 'Enter your username and password.');
      return;
    }
    setBusy(form, true);
    try {
      const data = await MC.api('/api/auth/login', { method: 'POST', body: { username, password } });
      state.user = data.user;
      state.auth.error = '';
      await MC.refreshMe();
      if (MC.connectEvents) MC.connectEvents();
      MC.toast(`Welcome back, ${data.user.username}.`, 'success');
      const target = state.auth.redirect || '#home';
      state.auth.redirect = null;
      MC.navigate(target);
    } catch (e) {
      authError(form, e.message || 'Could not sign in.');
    } finally {
      setBusy(form, false);
    }
  };

  MC.forms.register = async form => {
    authError(form, '');
    const username = form.querySelector('[name="username"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    const confirm = form.querySelector('[name="confirm"]').value;
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      authError(form, 'Username must be 3–20 characters using letters, numbers, or underscore.');
      return;
    }
    if (password.length < 8) {
      authError(form, 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      authError(form, 'The passwords do not match.');
      return;
    }
    setBusy(form, true);
    try {
      const data = await MC.api('/api/auth/register', { method: 'POST', body: { username, password } });
      state.user = data.user;
      state.auth.error = '';
      await MC.refreshMe();
      if (MC.connectEvents) MC.connectEvents();
      MC.toast(`Account created. Welcome, ${data.user.username}!`, 'success');
      const target = state.auth.redirect || '#online';
      state.auth.redirect = null;
      MC.navigate(target);
    } catch (e) {
      authError(form, e.message || 'Could not create your account.');
    } finally {
      setBusy(form, false);
    }
  };

  // -------------------------------------------------------------------------
  // Leaderboard
  // -------------------------------------------------------------------------

  async function renderLeaderboard(route, token) {
    MC.renderLoading('Loading the leaderboard…');
    let players = [];
    try {
      const data = await MC.api('/api/leaderboard');
      players = data.players || [];
    } catch (e) {
      if (token === state.pageToken) MC.toast(e.message || 'Could not load the leaderboard.', 'error');
    }
    if (token !== state.pageToken) return;
    const rows = players.map(p => {
      const medal = p.rank === 1 ? 'gold' : p.rank === 2 ? 'silver' : p.rank === 3 ? 'bronze' : '';
      const mine = state.user && Number(state.user.id) === Number(p.id);
      return `<tr class="${mine ? 'me' : ''}">
        <td class="rank"><span class="rank-medal ${medal}">${p.rank}</span></td>
        <td><div class="leader-user"><span class="leader-avatar">${MC.escapeHtml(MC.initials(p.username))}</span><span class="leader-user-name">${MC.escapeHtml(p.username)}${mine ? ' <span class="badge green">You</span>' : ''}</span></div></td>
        <td><span class="leader-rating">${MC.formatNumber(p.rating)}</span></td>
        <td><div class="record"><span class="w">${p.wins}W</span><span class="l">${p.losses}L</span><span class="d">${p.draws}D</span></div></td>
      </tr>`;
    }).join('');

    MC.setView(`
      <div class="leaderboard-page">
        <section class="page-hero">
          <span class="eyebrow">Mars leaderboard</span>
          <h1>The strongest on the surface.</h1>
          <p>Online results update your Elo rating. Beat stronger opponents to climb faster. The top 50 commanders are listed here.</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="#online">Play a rated game</a>
            <a class="btn btn-secondary" href="#account">Your profile</a>
          </div>
        </section>
        ${players.length ? `<div class="table-wrap">
          <table class="leader-table">
            <thead><tr><th>Rank</th><th>Player</th><th>Rating</th><th>Record</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>` : `<div class="empty-state"><div><div class="empty-icon">♛</div><h3>No rated games yet</h3><p>Be the first to finish an online game and claim the top spot.</p><a class="btn btn-primary" href="#online">Play online</a></div></div>`}
        <div class="leader-side">
          <div class="panel leader-note"><h3>How ratings work</h3><p>Every online game is rated with a standard Elo formula. Winning against a higher-rated player earns more points; losing to a lower-rated player costs more.</p></div>
          <div class="panel leader-note"><h3>Want to climb?</h3><p>Play longer controls, review your losses, and use the bot ladder to practice. The Martian bot is always available for a humbling.</p></div>
        </div>
      </div>`);
  }

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------

  async function renderAccount(route, token) {
    if (!state.user) {
      state.auth.redirect = '#account';
      MC.navigate('#auth');
      return;
    }
    MC.renderLoading('Loading your profile…');
    let me = null;
    let history = [];
    try {
      const [meData, gamesData] = await Promise.all([
        MC.api('/api/me'),
        MC.api('/api/account/games')
      ]);
      me = meData;
      state.me = meData;
      state.user = meData.user;
      history = gamesData.games || [];
    } catch (e) {
      if (token !== state.pageToken) return;
      if (e.status === 401) {
        state.user = null;
        state.me = null;
        MC.updateNav();
        state.auth.redirect = '#account';
        MC.navigate('#auth');
        return;
      }
      MC.toast(e.message || 'Could not load your profile.', 'error');
    }
    if (token !== state.pageToken) return;
    const user = me ? me.user : state.user;
    if (!user) return;
    const total = user.wins + user.losses + user.draws;
    const winRate = total ? Math.round((user.wins / total) * 100) : 0;
    const activeGameId = me && me.activeGameId;
    const rows = history.map(g => {
      const cls = g.result === 'win' ? 'win' : g.result === 'loss' ? 'loss' : g.result === 'draw' ? 'draw' : 'aborted';
      const label = g.result === 'aborted' ? '—' : g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D';
      return `<div class="history-row">
        <span class="history-result ${cls}">${label}</span>
        <div class="history-main"><strong>vs ${MC.escapeHtml(g.opponent)}</strong><span>${g.color === 'white' ? 'White' : 'Black'} · ${MC.escapeHtml(MC.timeControlLabel(g.timeControl))} · ${MC.formatDate(g.date)}</span></div>
        <div class="history-actions"><button class="btn btn-ghost btn-sm" type="button" data-action="review-online" data-id="${g.id}">Review</button></div>
        <div class="history-side">${MC.escapeHtml(g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : g.result === 'draw' ? 'Draw' : 'Aborted')}</div>
      </div>`;
    }).join('');

    MC.setView(`
      <div class="account-page">
        <section class="profile-hero">
          <div class="profile-avatar">${MC.escapeHtml(MC.initials(user.username))}</div>
          <div class="profile-main">
            <span class="eyebrow">MarsChess profile</span>
            <h1>${MC.escapeHtml(user.username)}</h1>
            <div class="profile-meta">
              <span class="badge green">${MC.formatNumber(user.rating)} Elo</span>
              <span class="badge">${total} rated game${total === 1 ? '' : 's'}</span>
              <span class="badge grey">Joined ${MC.formatDate(user.createdAt)}</span>
            </div>
          </div>
          <div class="profile-side">
            <div class="profile-rating">${MC.formatNumber(user.rating)}</div>
            <div class="profile-rating-label">Current rating</div>
          </div>
        </section>

        ${activeGameId ? `<div class="active-game-banner"><div class="ag-icon">♞</div><div class="ag-copy"><h3>Your game is still live</h3><p>Return to the board before your clock runs out.</p></div><a class="btn btn-green btn-sm" href="#game/${activeGameId}">Resume game</a></div>` : ''}

        <div class="stat-grid">
          <div class="stat-card"><div class="stat-label">Games</div><div class="stat-value">${total}</div></div>
          <div class="stat-card"><div class="stat-label">Wins</div><div class="stat-value win">${user.wins}</div></div>
          <div class="stat-card"><div class="stat-label">Losses</div><div class="stat-value loss">${user.losses}</div></div>
          <div class="stat-card"><div class="stat-label">Win rate</div><div class="stat-value draw">${winRate}%</div></div>
        </div>

        <div class="account-grid">
          <section class="panel panel-pad">
            <div class="panel-head"><h2 class="panel-title">Recent games</h2><a class="btn btn-ghost btn-sm" href="#online">Play online</a></div>
            ${rows ? `<div class="history-list">${rows}</div>` : `<div class="empty-state"><div><div class="empty-icon">♜</div><h3>No finished online games yet</h3><p>Your rated games and reviews will appear here.</p><a class="btn btn-primary btn-sm" href="#online">Find an opponent</a></div></div>`}
          </section>

          <aside class="stack">
            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title">Next move</h2></div>
              <div class="account-actions">
                <a class="btn btn-primary" href="#online">◉ Play online</a>
                <a class="btn btn-secondary" href="#play">♞ Challenge a bot</a>
                <a class="btn btn-ghost" href="#leaderboard">♛ View leaderboard</a>
              </div>
            </section>
            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title">Change password</h2></div>
              <form data-form="change-password">
                <div class="form-error" role="alert"></div>
                <div class="field"><label for="currentPassword">Current password</label><input class="input" id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required></div>
                <div class="field"><label for="newPassword">New password</label><input class="input" id="newPassword" name="newPassword" type="password" autocomplete="new-password" placeholder="At least 8 characters" required></div>
                <div class="field"><label for="confirmNewPassword">Confirm new password</label><input class="input" id="confirmNewPassword" name="confirm" type="password" autocomplete="new-password" required></div>
                <button class="btn btn-secondary btn-block" type="submit">Update password</button>
              </form>
            </section>
            <section class="panel panel-pad">
              <div class="panel-head"><h2 class="panel-title">Session</h2></div>
              <button class="btn btn-ghost btn-block" type="button" data-action="logout">Sign out</button>
            </section>
          </aside>
        </div>
      </div>`);
  }

  MC.forms['change-password'] = async form => {
    const err = form.querySelector('.form-error');
    const show = msg => { if (err) { err.textContent = msg; err.classList.toggle('show', Boolean(msg)); } };
    show('');
    const currentPassword = form.querySelector('[name="currentPassword"]').value;
    const newPassword = form.querySelector('[name="newPassword"]').value;
    const confirm = form.querySelector('[name="confirm"]').value;
    if (newPassword.length < 8) return show('New password must be at least 8 characters.');
    if (newPassword !== confirm) return show('The new passwords do not match.');
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await MC.api('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
      form.reset();
      MC.toast('Password updated. Your other sessions were signed out.', 'success');
    } catch (e) {
      show(e.message || 'Could not update your password.');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  // -------------------------------------------------------------------------
  // Learn
  // -------------------------------------------------------------------------

  function renderLearn() {
    const ladder = MC.BOT_LEVELS.map(b => `<div class="ladder-row"><span class="ladder-dot"></span><span class="ladder-name">${MC.escapeHtml(b.name)}</span><span class="ladder-elo">${b.rating} Elo</span></div>`).join('');
    const values = [
      ['♟', 'Pawn', '1'], ['♞', 'Knight', '3'], ['♝', 'Bishop', '3'],
      ['♜', 'Rook', '5'], ['♛', 'Queen', '9'], ['♚', 'King', '∞']
    ].map(([g, n, v]) => `<div class="piece-value"><span class="pv-piece">${g}</span><span>${n}</span><span class="pv-num">${v}</span></div>`).join('');
    MC.setView(`
      <div class="learn-page">
        <section class="page-hero">
          <span class="eyebrow">Flight manual</span>
          <h1>Learn the game. Then take the board.</h1>
          <p>MarsChess uses standard chess rules. Move your pieces, protect your king, and checkmate your opponent. Here is the short version.</p>
          <div class="hero-actions"><a class="btn btn-primary" href="#play">Practice vs a bot</a><a class="btn btn-secondary" href="#online">Play online</a></div>
        </section>
        <div class="learn-grid">
          <section class="panel lesson-card">
            <h3>The objective</h3>
            <p>Checkmate the enemy king. The king is in checkmate when it is attacked and has no legal way to escape, block, or capture the attacker. You never capture the king itself.</p>
          </section>
          <section class="panel lesson-card">
            <h3>How the pieces move</h3>
            <ul>
              <li><strong>Pawns</strong> move one square forward and capture diagonally. On their first move they can advance two squares. Reach the last rank to promote.</li>
              <li><strong>Knights</strong> jump in an L-shape: two squares one way and one square sideways.</li>
              <li><strong>Bishops</strong> move diagonally any distance.</li>
              <li><strong>Rooks</strong> move horizontally or vertically any distance.</li>
              <li><strong>Queens</strong> combine rook and bishop movement.</li>
              <li><strong>Kings</strong> move one square in any direction.</li>
            </ul>
          </section>
          <section class="panel lesson-card">
            <h3>Piece values</h3>
            <p>These are guidelines, not laws. Position, activity, and king safety often matter more than raw material.</p>
            <div class="piece-value-grid">${values}</div>
          </section>
          <section class="panel lesson-card">
            <h3>Special moves</h3>
            <ul>
              <li><strong>Castling:</strong> the king moves two squares toward a rook, and the rook jumps to the other side. You cannot castle through check or after the king or that rook has moved.</li>
              <li><strong>En passant:</strong> a pawn that just advanced two squares can be captured as if it had moved only one.</li>
              <li><strong>Promotion:</strong> a pawn reaching the last rank becomes a queen, rook, bishop, or knight.</li>
            </ul>
          </section>
          <section class="panel lesson-card">
            <h3>The bot ladder</h3>
            <p>Ten levels, from a friendly 400 Elo beginner to the 3200 Elo Martian. Higher levels think longer and calculate deeper. The Martian is effectively unbeatable.</p>
            <div class="bot-ladder">${ladder}</div>
          </section>
          <section class="panel lesson-card">
            <h3>Online play and review</h3>
            <p>Create an account to play rated games against real people. Every online move is checked by the server, and both clocks are authoritative. After a game, open the review to see accuracy, best moves, blunders, and an evaluation graph.</p>
            <p style="margin-top:10px"><a class="link-btn" href="#auth/register">Create your free account →</a></p>
          </section>
        </div>
      </div>`);
  }

  function renderNotFound() {
    MC.renderError('Lost in space', 'The page you are looking for does not exist. The board is still waiting.', '404');
  }

  MC.routes.home = renderHome;
  MC.routes.auth = renderAuth;
  MC.routes.leaderboard = renderLeaderboard;
  MC.routes.account = renderAccount;
  MC.routes.learn = renderLearn;
  MC.routes.notfound = renderNotFound;
})();
