// Run with:  node --test        (no dependencies; a tiny fake DOM and fake timers stand in for the browser)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

/* ---- minimal fake DOM: just enough for el()/setBody()/renderNext(); app.js must see `document` WITHOUT getElementById so init() does not run */
class TextN { constructor(t) { this.nodeType = 3; this.t = t; } get textContent() { return this.t; } }
class N {
  constructor(tag) { this.nodeType = 1; this.tag = tag; this.attrs = {}; this.kids = []; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...k) { this.kids.push(...k); }
  replaceChildren(...k) { this.kids = [...k]; }
  querySelector(sel) { return this.kids.find(c => c.tag === sel) || null; }
  get textContent() { return this.kids.map(c => c.textContent).join(" "); }
}
const cards = {};
globalThis.document = {
  createElement: t => new N(t), createTextNode: t => new TextN(t), createElementNS: (_, t) => new N(t),
  querySelector: sel => cards[sel] || null, hidden: false,
};
const app = require("../app.js");
for (const id of ["#pick", "#reality", "#models", "#mix"]) { const c = new N("article"); c.append(new N("h2")); cards[id] = c; }

const ZERO = Array(10).fill(0.1);
const answer = (over = {}) => ({
  available: true, kind: "pick", id: 5, status: "pending", size: "Big", target_label: "20261029100010201", target_id_kind: "period_id",
  engine_version: "1.0.0", n_history: 200, latest_result: { period_id: "20261029100010200", seq: 200, number: 7 }, created_at: "2026-10-29T10:00:03Z",
  signal: { level: "none", label: "NO STRONG SIGNAL", reasons: [] }, size_probs: { Small: 0.48, Big: 0.52 }, model_scores: { CumFreq: ZERO },
  disclaimer: "Model-generated statistical candidates.", cycle: { index: 100, period_seconds: 30 }, unverified_cycles: 0, settling: false, refresh_in_ms: 34500, ...over });
const projection = (n, over = {}) => answer({ kind: "projection", id: null, status: "projection", target_label: String(20261029100010200 + n), unverified_cycles: n,
  cycle: { index: 100 + n, period_seconds: 30 }, created_at: `2026-10-29T10:0${n}:06Z`, refresh_in_ms: 30500, ...over });
const text = () => cards["#pick"].textContent;

/* fake timers: record what the page schedules, fire it by hand */
function withTimers(fn) {
  return async () => {
    const real = { st: globalThis.setTimeout, ct: globalThis.clearTimeout, f: globalThis.fetch };
    const timers = [];
    let id = 0;
    globalThis.setTimeout = (cb, ms) => { const t = { id: ++id, cb, ms, live: true }; timers.push(t); return t.id; };
    globalThis.clearTimeout = i => { const t = timers.find(x => x.id === i); if (t) t.live = false; };
    const fire = t => { t.live = false; return t.cb(); };                 // like a real timer: it is gone once it has fired
    try { await fn({ pending: () => timers.filter(t => t.live), timers, fire }); } finally { Object.assign(globalThis, { setTimeout: real.st, clearTimeout: real.ct, fetch: real.f }); }
  };
}

test("pickRefreshDelay: only when the server says when the answer can next change; never faster than 0.5 s", () => {
  assert.equal(app.pickRefreshDelay(null), null);
  assert.equal(app.pickRefreshDelay({ available: false, refresh_in_ms: 5000 }), null);
  assert.equal(app.pickRefreshDelay({ available: true }), null);
  assert.equal(app.pickRefreshDelay({ available: true, refresh_in_ms: 34500 }), 34500);
  assert.equal(app.pickRefreshDelay({ available: true, refresh_in_ms: 3 }), 500);
});

test("a stored pick is labelled a prediction (scored later); a projection is labelled not-a-result and not scored", () => {
  const pick = app.pickNote(answer());
  assert.match(pick, /Prediction for round 20261029100010201, made before its result/); assert.match(pick, /scored against that round's verified result/);
  assert.doesNotMatch(pick, /Projection/);
  assert.match(app.pickNote(answer({ settling: true })), /waiting a few seconds for its verified result/);
  const proj = app.pickNote(projection(3));
  assert.match(proj, /^Projection, not a result and not scored/); assert.match(proj, /3 30-second round\(s\) have ended since the last verified result \(round 20261029100010200\)/);
  assert.match(proj, /changes only when new verified results change the data/);
  assert.doesNotMatch(proj, /made before its result/);
});

test("renderNext shows the right label for each kind and arms exactly one re-read", withTimers(async ({ pending }) => {
  app.renderNext(answer(), null, null);
  assert.match(text(), /BIG/); assert.match(text(), /Prediction for round 20261029100010201/); assert.match(text(), /status: waiting for result/);
  assert.equal(pending().length, 1); assert.equal(pending()[0].ms, 34500);
  app.renderNext(projection(2), null, null);                          // a re-render replaces the pending timer, it never adds a second one
  assert.match(text(), /Projection, not a result and not scored/); assert.match(text(), /status: projection, not scored/); assert.doesNotMatch(text(), /cycle \d{3}/);   // the raw cycle counter is not shown to people
  assert.equal(pending().length, 1); assert.equal(pending()[0].ms, 30500);
  app.renderNext({ available: false, reason: "Need at least 100 results (have 0)." }, null, null);
  assert.match(text(), /Need at least 100 results/);                  // nothing is invented when there is no verified history
}));

for (const [mode, secs] of [["30s", 30], ["1min", 60], ["2min", 120]]) {
  test(`${mode}: over 6 consecutive cycles the page re-reads exactly once per cycle and never per second`, withTimers(async ({ pending, fire }) => {
    const calls = []; let n = 0;
    globalThis.fetch = async url => { calls.push(url); n += 1;
      return { ok: true, json: async () => projection(n, { cycle: { index: 100 + n, period_seconds: secs }, refresh_in_ms: secs * 1000 + 500 }) }; };
    app.renderNext(answer({ cycle: { index: 100, period_seconds: secs }, refresh_in_ms: (secs + 5.5) * 1000 }), null, null);
    const seen = [text()];
    for (let c = 1; c <= 6; c++) {
      assert.equal(pending().length, 1, `exactly one timer is pending during cycle ${c - 1}`);   // nothing else runs while the countdown ticks
      assert.equal(calls.length, c - 1, "no request before the timer fires");
      await fire(pending()[0]);                                                                    // the cycle rolls over: the one timer fires
      assert.equal(calls.length, c); seen.push(text());
    }
    assert.ok(calls.every(u => u === "/api/prediction/next?mode=" + app.__mode()), "requests go to the selected mode only");
    assert.equal(new Set(seen).size, seen.length, "each cycle renders its own calculation (round, cycle number and time differ)");
    assert.equal(pending().length, 1, "the chain is still armed for the next cycle");
  }));
}

test("a hidden tab does not fetch when the timer fires; a failed read asks the poll loop to reconcile instead of showing stale data", withTimers(async ({ pending, fire }) => {
  let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error("offline"); };
  app.renderNext(answer(), null, null);
  document.hidden = true; await fire(pending()[0]); assert.equal(calls, 0); document.hidden = false;
  app.renderNext(answer(), null, null); await fire(pending()[0]); assert.equal(calls, 1);
  assert.equal(app.CLOCK.reconcile, true);
}));
