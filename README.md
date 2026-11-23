# Do I Go?

A 1–17 player co-op defense game about racing a drill-ship to the center of the earth (6,371 km down). Rumor says there's treasure there.

This is the **base project**: a lobby of persistent ships ("rooms"), drop-in/drop-out multiplayer, host controls, and a placeholder gameplay loop (drill down, hazards damage the hull, crew repairs it). The game itself is meant to be built on top of this.

## Run it

Needs Node 22+. There are no dependencies, so you don't need `npm install`.

```bash
npm start            # http://localhost:3000
npm run dev          # drill 40x faster and auto-restart on file changes
npm test             # unit + end-to-end tests
```

Open the URL in several browser windows (or incognito windows) to play as several players. Other people on your network can join at `http://<your-ip>:3000`.

Environment: `PORT` (3000), `HOST`, `BASE_PATH` (e.g. `/dig`), `DIG_SPEED` (1, which only fast-forwards travel), `DATA_DIR` (`./data`).

**Deploying** (commanderstitch.com/dig): see [DEPLOY.md](DEPLOY.md). It covers the Dockerfile, `docker-compose.yml`, a systemd unit and the nginx/Apache configs in `deploy/`.

## How the persistent world works

| Concept | Behavior |
|---|---|
| **Ship / world** | One saved game. Stored as `data/worlds/<id>.json`. Saved every 2 s while it changes, on every join/leave, and on shutdown (Ctrl-C). Writes are atomic. |
| **Host** | Whoever commissioned the ship. Host status is tied to a player identity (id + secret token in the browser's localStorage), so the host is still the host after closing the browser or restarting the server. |
| **Drop in** | Anyone can board any ship from the lobby until it reaches its crew size (1–17). Reloading the page or a dropped connection puts you straight back on your ship. |
| **Drop out** | Closing the tab or clicking *Leave* takes you off the ship. Your crew record (name, repairs) stays on it. |
| **Ticking** | The world only advances while the host is aboard. If the host ticked *"Crew can keep drilling while I'm away"*, any crew member aboard keeps it going. With nobody aboard it is frozen, with no offline progress. |
| **Win / lose** | Reach 6,371 km → **won**. Hull hits 0 → **lost**. Either way the ship stays in the lobby until the host restarts or destroys it. |

### Host controls
- **End run & restart**: ends the current run (early, or after a win or loss) and starts run #N+1 from the surface. Crew and run history are kept.
- **Leave as is**: saves and freezes the ship and sends everyone back to the lobby. Resume it any time from the lobby.
- **Exit & destroy ship**: sends everyone to the lobby and deletes the save permanently.

## Layout

```
server/
  index.js         entry point (env config, graceful save on shutdown)
  game-server.js   HTTP static files, WebSocket protocol, lobby, tick/broadcast/save loops
  world.js         World model: crew, run state, simulation tick, host actions, snapshots
  store.js         JSON-file persistence (atomic writes)
  ws.js            minimal zero-dependency WebSocket server
shared/
  constants.js     layers, limits, statuses (imported by server AND browser)
client/
  index.html, style.css
  main.js          screens: name → lobby → ship; host panel
  net.js           WebSocket client, auto-reconnect, saved identity
  render.js        canvas cross-section + depth minimap (placeholder art)
test/              node:test unit + end-to-end tests
```

## Wire protocol (JSON over `/ws`)

Client → server: `hello {name, playerId?, token?}`, `create {name, maxPlayers, allowPlayWithoutHost}`, `join {worldId}`, `leave`, `repair`, `chat {text}`, and host-only `restart`, `shelve`, `destroy`.

Server → client: `welcome {playerId, token, name}`, `lobby {worlds[]}`, `world {world}` (full snapshot, 5×/s), `left {reason}`, `error {message}`.

## Where to build next
- **Gameplay**: replace `World.tick` hazards with real enemies, turrets and stations. Snapshots are full-state for now, so switch to deltas once state gets large.
- **Story**: `LAYERS` in `shared/constants.js` are the chapters. Hook beats onto layer transitions (`event('story', …)`).
- **Upgrades between runs**: add a `meta` block to the world save next to `history`.
- **Private ships / invite codes**: add a `code` to the world and check it in the `join` handler.
- **Hosting**: put it behind any reverse proxy that supports WebSockets. For many servers, swap `Store` for a database.
