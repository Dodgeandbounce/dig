// WebSocket client with auto-reconnect. Identity (playerId + token) lives in
// localStorage so you're the same player — and the same host — every visit.
const KEY = 'doigo.identity';

export function loadIdentity() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
export function saveIdentity(id) { localStorage.setItem(KEY, JSON.stringify(id)); }

export class Net extends EventTarget {
  constructor() { super(); this.ws = null; this.retry = 500; this.queue = []; }

  connect() {
    // Relative to the page, so it works at "/" and under a prefix like "/dig/".
    const url = new URL('ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = ''; url.hash = '';
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.retry = 500;
      this.dispatchEvent(new Event('open'));
      for (const m of this.queue.splice(0)) this.send(m);
    };
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      this.dispatchEvent(new CustomEvent(msg.t, { detail: msg }));
    };
    this.ws.onclose = () => {
      this.dispatchEvent(new Event('close'));
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 8000);
    };
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  on(type, fn) { this.addEventListener(type, (e) => fn(e.detail)); }
}
