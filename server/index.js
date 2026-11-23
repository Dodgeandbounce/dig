import { createGameServer } from './game-server.js';

const port = Number(process.env.PORT) || 3000;
const speed = Number(process.env.DIG_SPEED) || 1; // >1 compresses time for testing

const basePath = process.env.BASE_PATH || '';          // e.g. "/dig" when served at example.com/dig

const game = createGameServer({ speed, basePath, dataDir: process.env.DATA_DIR || undefined });
await game.listen(port, process.env.HOST);
console.log(`Do I Go? — server on http://localhost:${port}${basePath}/  (${game.worlds.size} saved ships, speed x${speed})`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log('\nSaving all ships…');
    await game.close();
    process.exit(0);
  });
}
