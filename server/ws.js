// Minimal RFC 6455 WebSocket server (text frames, ping/pong, close).
// Zero dependencies so the project runs with nothing but Node. Swap for `ws`
// later if you need compression or binary streaming.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024;

export class Socket extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.open = true;
    this.buffer = Buffer.alloc(0);
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this.#onData(chunk));
    socket.on('close', () => this.#closed());
    socket.on('error', () => this.#closed());
  }

  /** Bytes queued but not yet sent (a slow client's backlog). */
  get buffered() { return this.socket.writableLength; }

  send(obj) {
    if (!this.open) return;
    const payload = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
    this.socket.write(encodeFrame(0x1, payload));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this.socket.write(encodeFrame(0x8, body));
    this.socket.end();
    this.#closed();
  }

  #closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const frame = decodeFrame(this.buffer);
      if (frame === null) return; // need more bytes
      if (frame === false) return this.close(1009, 'frame too large');
      this.buffer = this.buffer.subarray(frame.length);
      if (!frame.fin) return this.close(1003, 'fragmented frames unsupported');
      switch (frame.opcode) {
        case 0x1: {
          let msg;
          try { msg = JSON.parse(frame.payload.toString('utf8')); } catch { continue; }
          this.emit('message', msg);
          break;
        }
        case 0x8: return this.close();
        case 0x9: this.socket.write(encodeFrame(0xA, frame.payload)); break; // ping -> pong
        default: break; // pong / binary ignored
      }
    }
  }
}

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** @returns frame | null (incomplete) | false (too big) */
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2); offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const big = buf.readBigUInt64BE(2);
    if (big > BigInt(MAX_PAYLOAD)) return false;
    len = Number(big); offset = 10;
  }
  if (len > MAX_PAYLOAD) return false;
  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + len) return null;
  const mask = masked ? buf.subarray(offset, offset + 4) : null;
  offset += maskLen;
  const payload = Buffer.from(buf.subarray(offset, offset + len));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  return { fin, opcode, payload, length: offset + len };
}

/** Attach to an http.Server. `paths` = accepted URL paths. `onConnect(socket, req)` fires per client. */
export function attachWebSocket(server, paths, onConnect) {
  const accepted = new Set([paths].flat());
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (!accepted.has(url.pathname) || !key || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    onConnect(new Socket(socket), req, url);
  });
}
