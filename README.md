# Do I Go?

A 1–17 player co-op defense game about racing a drill-ship to the center of the earth (6,371 km down). Zap is coming of age. His brother Joe went first and left notes. Do I go?

There are two ways to play right now:

- **▶ Play solo** — the full game. You play one crew member; bots play everyone else. 17 classes, a ship that keeps growing room by room, enemy dig-ships that dock and board you, creatures, ports, Joe's notes, the transponder, the brother path, and the thing at the core. It runs entirely in the browser (no server needed). See [GAME.md](GAME.md) for how it all works.
- **Online ships (lobby)** — the same full game, together. The server runs it; every player who boards takes over one crew member (bots play the rest, and take back over when you leave). Ships are saved mid-run and survive server restarts.

## Run it

Needs Node 22+. There are no dependencies, so you don't need `npm install`.

```bash
npm start            # http://localhost:3000
npm run dev          # drill 40x faster and auto-restart on file changes
npm test             # unit + end-to-end tests (incl. a headless playthrough of the game)
```

Click **▶ Play solo**, or open `http://localhost:3000/?solo=engineer` (any class id) to jump straight in.

Open the URL in several browser windows (or incognito windows) to play online ships as several players. Other people on your network can join at `http://<your-ip>:3000`.

Environment: `PORT` (3000), `HOST`, `BASE_PATH` (e.g. `/dig`), `DIG_SPEED` (1, which only fast-forwards travel), `DATA_DIR` (`./data`).

**Deploying** (commanderstitch.com/dig): see [DEPLOY.md](DEPLOY.md). Every push to `main` runs the tests and uploads to cPanel over FTP.

## How the persistent world works (online ships)

| Concept | Behavior |
|---|---|
| **Ship / world** | One saved game. Ship info is `data/worlds/<id>.json` (saved every 2 s while it changes, on every join/leave, and on shutdown); the running game itself is `data/worlds/<id>.game` (saved every 10 s, on every leave and on shutdown). Writes are atomic. A hard kill can lose up to 10 s of play. |
| **Host** | Whoever commissioned the ship, starting as Zap the Pilot or Angie the Engineer. Host status is tied to a player identity (id + secret token in the browser's localStorage), so the host is still the host after closing the browser or restarting the server. |
| **Drop in** | Anyone can board any ship from the lobby until it reaches its crew size (1–17). You take over a crew member: the one you had last time if it's free, otherwise any bot, otherwise a new engineer signs on. Reloading the page or a dropped connection puts you straight back on your ship, in the same crew member. |
| **Drop out** | Closing the tab or *Leave the ship* (Esc menu) hands your crew member back to a bot. Your seat is kept for when you come back. |
| **Ticking** | The world only advances while the host is aboard. If the host ticked *"Crew can keep drilling while I'm away"*, any crew member aboard keeps it going. With nobody aboard it is frozen, with no offline progress. Menus don't pause an online game. |
| **Shared choices** | Anyone aboard can pick the route, press story buttons, shop, and undock. Each player spends their own crew member's money. Switching class at a port switches which crew member you control. |
| **Win / lose** | Reach the core and beat what's there → **won**. Hull hits 0 → **lost**. Either way the ship stays in the lobby until the host restarts or destroys it. |
| **Chat** | Press Enter in game. |

### Host controls (Esc menu)
- **End run & restart**: ends the current run (early, or after a win or loss) and starts run #N+1 from the surface. Players and run history are kept.
- **Save & send everyone to the lobby**: saves and freezes the ship. Resume it any time from the lobby.
- **Destroy this ship**: sends everyone to the lobby and deletes the save permanently.

### How online play works
The server runs `shared/sim/Game` at 30 steps a second and sends each ship's players a snapshot 10 times a second (`shared/sim/netcode.js`): the game's own fields as JSON, with parts that didn't change replaced by a `keep` list and the tile map sent as base64 once, then as diffs. The browser turns each snapshot back into a Game-shaped object (same prototype), so the solo renderer and UI draw it unchanged. Your own crew member is **predicted** (moves the instant you press a key; the server's position is replayed with the inputs it hasn't seen yet). Everything else is drawn from an **interpolation buffer**: the last few snapshots, stamped with the server's game clock, drawn ~130 ms in the past and slid between two real snapshots, so uneven network timing doesn't show up as stutter. A **heartbeat** (`ping`/`pong` every 2 s) measures the round trip; the browser reconnects if the server goes quiet for 6 s, and the server drops a connection that's been silent for 30 s. Controls go up about 20 times a second.

Saved online ships carry a game version. A save from an older version (different map) can't be continued: the ship stays in the lobby and starts a fresh run.

### Leaderboard
Every run that ends goes on a shared leaderboard (`data/leaderboard.json`, best 300 kept): online runs when they're won, lost or restarted past the first couple of stops, and solo runs posted by the browser when they end (if it's connected). `GET /api/leaderboard` returns the top 50; the first screen and the lobby show them, and clicking one shows who played, how deep they got, and the crew.

## Layout

```
server/
  index.js         entry point (env config, graceful save on shutdown)
  game-server.js   HTTP static files, WebSocket protocol, lobby, tick/broadcast/save loops
  world.js         an online ship: host, players, seats (player -> crew member), the running Game, network frames
  persist.js       saving and restoring a running Game (node:v8)
  store.js         file persistence (atomic writes), including the leaderboard
  ws.js            minimal zero-dependency WebSocket server
shared/
  constants.js     layers, limits, statuses (imported by server AND browser)
  sim/             THE GAME — pure ES modules, no DOM, no Node APIs (runs in the browser and on the server)
    data.js        every number and every word: classes, rooms, weapons, abilities, upgrades, recipes, research, story text
    game.js        the Game: levels, descent, routes, dockings, ship-vs-ship duel, ports, shop, recruiting, story, endings
    grid.js        tile world, rooms, doors, line of sight, Dijkstra flow fields
    combat.js      movement/collision, damage, projectiles, explosions, destructible tiles & systems, pickups, bubbles
    classes.js     each class's kit: primary fire, abilities, passives, E-interactions, repairs
    ai.js          bot crew (each plays its class's job), boarders, defenders, creatures, captured monsters, gadgets
    pilot.js       the descent: steering through the tunnel, obstacles, gem veins, fuel, auto-feeders
    roster.js      the per-run random enemy roster and per-level enemy mix
    netcode.js     snapshots: encode a Game for the wire, decode it in the browser, grid diffs
    rng.js, util.js
client/
  index.html, style.css
  main.js          screens: name → lobby → game (online ship or solo)
  net.js           WebSocket client, auto-reconnect, saved identity
  game/            the game client (solo and online)
    app.js         splash, class select, solo/online sessions, game loop, input, smoothing, sound, high scores
    render.js      canvas renderer: ships, doors, breaches, fog of war, effects, pilot's tunnel view
    sprites.js     procedural art: a fox for every class, random enemy bodies, stations
    ui.js          HUD, ability bar, crew list, duel bars, route picker, stories, port shop, station panels
    audio.js       synthesized sound effects and music (no audio files)
    game.css
test/              node:test unit + end-to-end tests
```

## Wire protocol (JSON over `/ws`) — online ships

Client → server: `hello {name, playerId?, token?}`, `create {name, maxPlayers, allowPlayWithoutHost, playerClass}`, `join {worldId}`, `leave`, `in {i: {mx, my, ax, ay, fire, rmb, e, shift, pressed, seq}}` (controls), `cmd {c}` (any Game command except `pause`), `chat {text}`, `ping {c}` (heartbeat), `score {entry}` (a finished solo run, for the leaderboard), and host-only `restart`, `shelve`, `destroy`.

Server → client: `welcome {playerId, token, name}`, `lobby {worlds[]}`, `world {world}` (ship info, when it changes), `g {s, keep?, grid?, d?, dr?, dd?, v?, seats, fx, join?}` (game frames, 10×/s), `pong {c}`, `left {reason}`, `error {message}`.

## Where to build next
- **Smaller frames**: send only the entity fields that changed (positions, HP) instead of whole entities.
- **Pick your class when you board** (right now you get a free crew member and can switch any time with C).
- **Saves for solo runs** (continue later): `server/persist.js` already does this for online ships.
- **Art**: everything is procedural canvas drawing in `client/game/sprites.js`; swap in sprites any time.
