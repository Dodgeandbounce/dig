// Disk persistence. One JSON file per world + one file for player identities.
// Writes are atomic (write temp file, then rename) so a crash never leaves a
// half-written save.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.worldDir = join(dataDir, 'worlds');
    mkdirSync(this.worldDir, { recursive: true });
  }

  #write(file, data) {
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
  }

  #read(file, fallback) {
    if (!existsSync(file)) return fallback;
    try { return JSON.parse(readFileSync(file, 'utf8')); }
    catch (err) { console.error(`[store] could not read ${file}:`, err.message); return fallback; }
  }

  loadPlayers() { return this.#read(join(this.dir, 'players.json'), {}); }
  savePlayers(players) { this.#write(join(this.dir, 'players.json'), players); }

  loadWorlds() {
    return readdirSync(this.worldDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.#read(join(this.worldDir, f), null))
      .filter(Boolean);
  }
  saveWorld(data) { this.#write(join(this.worldDir, `${data.id}.json`), data); }
  deleteWorld(id) {
    rmSync(join(this.worldDir, `${id}.json`), { force: true });
    rmSync(join(this.worldDir, `${id}.game`), { force: true });
  }

  // The running game itself (binary, node:v8 serialization). Missing or unreadable = start a fresh run.
  saveGame(id, buf) {
    const file = join(this.worldDir, `${id}.game`);
    writeFileSync(file + '.tmp', buf);
    renameSync(file + '.tmp', file);
  }
  loadGame(id) {
    const file = join(this.worldDir, `${id}.game`);
    if (!existsSync(file)) return null;
    try { return readFileSync(file); }
    catch (err) { console.error(`[store] could not read ${file}:`, err.message); return null; }
  }
}
