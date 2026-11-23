// WebSocket client with auto-reconnect. Identity (playerId + token) lives in
// localStorage so you're the same player — and the same host — every visit.
const KEY = 'doigo.identity';

export function loadIdentity() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
export function saveIdentity(id) { localStorage.setItem(KEY, JSON.stringify(id)); }

// Testing aid: ?lag=150 adds 150 ms of round trip (half each way) to see how online play feels far away.
const LAG = Math.max(0, Math.min(2000, Number(new URLSearchParams(location.search).get('lag')) || 0));

export class Net extends EventTarget {
  constructor() { super(); this.ws = null; this.retry = 500; this.queue = []; }

  #raw(json) {
    if (LAG) { const ws = this.ws; setTimeout(() => { if (ws.readyState === WebSocket.OPEN) ws.send(json); }, LAG / 2); }
    else this.ws.send(json);
  }

  connect() {
    // Relative to the page, so it works at "/" and under a prefix like "/dig/".
    const url = new URL('ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = ''; url.hash = '';
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.retry = 500;
      // Drop game actions queued while offline; hello/join etc. are re-sent on 'open' anyway.
      this.queue = this.queue.filter((m) => m.t !== 'cmd' && m.t !== 'chat');
      this.dispatchEvent(new Event('open'));
      for (const m of this.queue.splice(0)) this.send(m);
    };
    this.ws.onmessage = (e) => {
      const deliver = () => { const msg = JSON.parse(e.data); this.dispatchEvent(new CustomEvent(msg.t, { detail: msg })); };
      if (LAG) setTimeout(deliver, LAG / 2); else deliver();
    };
    this.ws.onclose = () => {
      this.dispatchEvent(new Event('close'));
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 8000);
    };
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.#raw(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  /** For messages that are useless if late (controls): send now or drop, never queue. */
  sendVolatile(msg) {
    if (this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 64 * 1024) this.#raw(JSON.stringify(msg));
  }

  on(type, fn) { this.addEventListener(type, (e) => fn(e.detail)); }
}
