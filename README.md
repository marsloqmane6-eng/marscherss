# MarsChess

MarsChess is a self-contained, Mars-themed chess site with:

- Ten local Stockfish bot levels from 400 to 3200 Elo, with Martian 3200 as the default.
- An optional switchable AI brain for bot games using any OpenAI-compatible chat-completions endpoint and API key.
- Username/password accounts stored in SQLite.
- Rated human-vs-human matchmaking with server-authoritative clocks.
- Live chat, draw offers, resignations, and aborts.
- A post-game review with accuracy, move classifications, an evaluation graph, best moves, and key moments.
- Responsive layouts for phones, tablets, and desktop.

The legacy MarsPass C++ project at the repository root is untouched. This website lives in `marscherss/`.

## Requirements

- Node.js 24 or newer. The server uses the built-in `node:sqlite` module.
- No npm packages are required.
- A browser with JavaScript and EventSource support.
- The Stockfish 10 JavaScript worker is bundled at `public/stockfish.js`, so bots and game review work without an internet connection.

## Start

From this directory:

```powershell
node server.js
```

or:

```powershell
npm start
```

The site is served at <http://localhost:3000>.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `./data/marscherss.db` | SQLite database file path |

The SQLite database is created automatically at `data/marscherss.db`.

## Play online against a human

1. Open the site in two different browsers or private windows.
2. Create two accounts with different usernames.
3. On both accounts, open **Play Online** and choose the same time control.
4. The server pairs the two players and starts a rated game.
5. Moves, clocks, draw offers, resignations, aborts, and results are validated by the server. Chat is visible to both players.
6. After the game, open **Game review** from the result popup or the game panel.

## Bot brain options

Bot Arena supports two brains. Switch between them in the **AI brain** panel on the Play Bot page.

- **Stockfish** (default): runs locally in a Web Worker, needs no key, and works offline. The default level is Martian 3200.
- **AI brain**: sends the position and legal-move list to the OpenAI-compatible endpoint you configure, validates the returned move, and falls back to Stockfish if the request fails.

For the AI brain, enter:

- Endpoint, for example `https://api.openai.com/v1/chat/completions`
- Model, for example `gpt-4o-mini`
- API key (optional for local endpoints such as Ollama or LM Studio)

The key is stored in this browser's local settings, never sent to the MarsChess server, and sent only to the endpoint you choose. Use a revocable key and do not use a production key on a shared computer. Some endpoints must allow browser CORS requests.

## Project layout

```
marscherss/
  server.js          zero-dependency HTTP server, SQLite schema, auth, SSE, matchmaking
  package.json
  public/
    index.html       SPA shell
    styles.css       base design system and board styles
    pages.css        page-specific and review styles
    engine.js        shared UMD chess rules/search engine
    core.js          state, API, router, modals, settings, clock loop
    board.js         board renderer, arrows, Stockfish worker wrapper
    pages.js         home, auth, leaderboard, account, learn routes
    bot.js           bot arena, levels, clocks, hints, undo, AI brain
    online.js        lobby, matchmaking, SSE games, clocks, chat
    review.js        game review analysis and UI
    stockfish.js     bundled Stockfish 10 worker (GPL-3.0)
    stockfish-LICENSE.txt  full GPL-3.0 license text
  data/              generated SQLite database
```

## Notes

- Passwords are salted and hashed with scrypt.
- Sessions use HTTP-only cookies.
- Online play is server-authoritative for legality, clocks, results, and Elo (K=24).
- Bot games are local to the browser and unrated.
- Stockfish is GPL-3.0 software; the bundled Stockfish 10 JavaScript build retains its upstream copyright header, and the full license text is included at `public/stockfish-LICENSE.txt`.
- MarsChess is an independent chess platform.
