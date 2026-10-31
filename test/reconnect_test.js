// Run with:  node --test test/*.test.js      (no dependencies)
// Reconnection behaviour: transient gateway errors are retried, the real failure reason is kept for the banner, and the banner clears on recovery.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

class FN {
  constructor(t = "div") { this.nodeType = 1; this.tag = t; this.kids = []; this.attrs = {}; this.dataset = {}; this.hidden = false; this.value = ""; this.className = ""; this._t = null; this._q = {};
    this.classList = { toggle() {}, contains: () => false, add() {}, remove() {} }; }
  setAttribute(k, v) { this.attrs[k] = v; } append(...k) { this.kids.push(...k); } replaceChildren(...k) { this.kids = [...k]; }
  querySelector(s) { return this._q[s] || (this._q[s] = new FN(s)); } querySelectorAll() { return []; } addEventListener() {}
  get textContent() { return this._t != null ? this._t : ""; } set textContent(v) { this._t = v; }
}
const cache = {}, node = k => cache[k] || (cache[k] = new FN());
globalThis.document = { hidden: false, createElement: t => new FN(t), createTextNode: t => ({ nodeType: 3, t: String(t) }), createElementNS: (_, t) => new FN(t),
  querySelector: s => node(s), querySelectorAll: () => [], addEventListener() {} };
const app = require("../app.js");
document.getElementById = id => node("#" + id);

const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
const CLOCK_OK = { server_epoch_ms: Date.now(), countdown: { state: "no_data" } };

test("a GET is retried once after a 503/504 (backend waking up) and then succeeds", async () => {
  let n = 0; globalThis.fetch = async () => (++n === 1 ? res(504, { error: "gateway timeout" }) : res(200, { ok: 1 }));
  assert.deepEqual(await app.api("/api/health"), { ok: 1 }); assert.equal(n, 2);
});

test("a GET is retried once after a dropped connection", async () => {
  let n = 0; globalThis.fetch = async () => { if (++n === 1) throw new TypeError("Failed to fetch"); return res(200, { ok: 2 }); };
  assert.deepEqual(await app.api("/api/health"), { ok: 2 }); assert.equal(n, 2);
});

test("a POST is never retried (no duplicate writes)", async () => {
  let n = 0; globalThis.fetch = async () => { n++; return res(503, { error: "down" }); };
  await assert.rejects(app.api("/api/sync/run", { method: "POST" }), /down/); assert.equal(n, 1);
});

test("a persistent outage surfaces the real reason, counts failures, and recovery clears the banner", async () => {
  globalThis.fetch = async () => res(504, null);
  for (let i = 0; i < 3; i++) await assert.rejects(app.fetchClock(), /HTTP 504/);
  assert.equal(app.CLOCK.failures, 3); assert.match(app.CLOCK.lastError, /HTTP 504/);
  const c = node("#conn"); c.className = "conn bad"; c.hidden = false;
  globalThis.fetch = async () => res(200, CLOCK_OK);
  await app.fetchClock();
  assert.equal(app.CLOCK.failures, 0); assert.equal(app.CLOCK.lastError, null); assert.equal(c.hidden, true, "Disconnected banner is hidden once the server answers");
});
