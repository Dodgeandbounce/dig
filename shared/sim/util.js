export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const dist = (a, b) => Math.sqrt(dist2(a, b));
export const angTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
export const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
export function norm(x, y) { const l = Math.hypot(x, y); return l > 1e-6 ? { x: x / l, y: y / l, l } : { x: 0, y: 0, l: 0 }; }
let nextId = 1;
export const uid = () => nextId++;
export const setUidBase = (n) => { nextId = Math.max(nextId, n); };
