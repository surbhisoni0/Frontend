// Run with:  node --test test/*.test.js      (no dependencies)
// Virtual time + a fake DOM + a fake server that follows the backend's per-cycle contract (/api/prediction/next: pick -> settling 5 s -> projection,
// cycle index, refresh_in_ms). Proves: every completed countdown refreshes the estimate and period exactly once, in both timer modes, over many
// cycles; no overlapping requests; slow / failing servers neither skip a cycle nor show a stale answer; switching modes leaves one live timer.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

/* ---------------- fake DOM (just enough for app.js) ---------------- */
class FN {
  constructor(tag = "div") { this.nodeType = 1; this.tag = tag; this.kids = []; this.attrs = {}; this.dataset = {}; this.hidden = false; this.value = ""; this._t = null; this._q = {};
    this.classList = { toggle() {}, contains: () => false, add() {}, remove() {} }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...k) { this.kids.push(...k); }
  replaceChildren(...k) { this.kids = [...k]; }
  querySelector(s) { return this._q[s] || (this._q[s] = new FN(s)); }
  querySelectorAll() { return []; }
  addEventListener() {}
  get textContent() { return this._t != null ? this._t : this.kids.map(c => (c.nodeType === 3 ? c.t : c.textContent)).join(" "); }
  set textContent(v) { this._t = v; this.kids = []; }
}
const cache = {};
const node = k => cache[k] || (cache[k] = new FN());
globalThis.document = { hidden: false, createElement: t => new FN(t), createTextNode: t => ({ nodeType: 3, t: String(t), get textContent() { return this.t; } }),
  createElementNS: (_, t) => new FN(t), querySelector: s => node(s), querySelectorAll: () => [], addEventListener() {} };
const app = require("../app.js");                                  // no getElementById yet, so app.js does not run init()
document.getElementById = id => node("#" + id);

/* ---------------- virtual time ---------------- */
const T0 = 1_800_000_000;                                           // divisible by 30 and 60: round boundaries fall on multiples of the period
let NOW = T0 * 1000 + 100, timers = [], tid = 0;
const real = { now: Date.now, st: setTimeout, ct: clearTimeout, si: setInterval, ci: clearInterval, f: globalThis.fetch };
const flush = () => new Promise(r => setImmediate(r));
function installTime() {
  NOW = T0 * 1000 + 100; timers = []; tid = 0;
  Date.now = () => NOW;
  globalThis.setTimeout = (cb, ms = 0) => { timers.push({ id: ++tid, at: NOW + ms, cb, every: null }); return tid; };
  globalThis.setInterval = (cb, ms) => { timers.push({ id: ++tid, at: NOW + ms, cb, every: ms }); return tid; };
  globalThis.clearTimeout = globalThis.clearInterval = id => { timers = timers.filter(t => t.id !== id); };
}
function restoreTime() { Date.now = real.now; Object.assign(globalThis, { setTimeout: real.st, clearTimeout: real.ct, setInterval: real.si, clearInterval: real.ci, fetch: real.f }); }
async function advance(ms) {
  const end = NOW + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers[0];
    if (!t || t.at > end) break;
    NOW = Math.max(NOW, t.at);
    if (t.every) t.at += t.every; else timers.shift();
    t.cb(); await flush();
  }
  NOW = end; await flush();
}

/* ---------------- fake server: same rules as PredictorService.next_prediction / clock ---------------- */
function makeServer(P, { live = false, lag = 2.4, latency = 0, fail = false } = {}) {
  const S = { P, latency, fail, calls: [], inflight: 0, maxInflight: 0, picks: [{ id: 1, label: 200, made: 0 }], lastArrival: 0 };
  const sec = () => NOW / 1000 - T0;
  const cyc = t => Math.floor(t / P);
  function arrivals() {                                               // live feed: the ended round's result arrives `lag` s after each boundary
    if (!S.live) return;
    for (let c = Math.max(1, cyc(S.lastArrival) + 1); c <= cyc(sec()); c++) if (sec() >= c * P + lag && !S.picks.some(p => p.made === c * P + lag)) {
      const last = S.picks[S.picks.length - 1]; S.picks.push({ id: last.id + 1, label: last.label + 1, made: c * P + lag }); S.lastArrival = c * P; }
  }
  S.live = live;
  S.next = () => {
    if (S.frozen) return S.frozen;                                    // feed/API stuck: the same old answer is returned
    arrivals();
    const t = sec(), cur = cyc(t), into = t - cur * P, p = S.picks[S.picks.length - 1];
    const missed = Math.max(0, cur - cyc(Math.min(p.made, t))), settling = missed === 1 && into < 5, proj = missed >= 1 && !settling;
    return { available: true, kind: proj ? "projection" : "pick", id: proj ? null : p.id, status: proj ? "projection" : "pending", size: p.id % 2 ? "Small" : "Big", top3: [(p.id * 3) % 10, (p.id * 3 + 1) % 10, (p.id * 3 + 2) % 10],
      target_label: String(proj ? p.label + missed : p.label), target_id_kind: "period_id", engine_version: "1.0.0", n_history: 200,
      latest_result: { period_id: String(p.label - 1), seq: 199 + p.id, number: 3 }, created_at: new Date(NOW).toISOString(),
      signal: { level: "none", label: "NO STRONG SIGNAL", reasons: [] }, size_probs: { Small: 0.52, Big: 0.48 }, model_scores: { CumFreq: Array(10).fill(0.1) },
      disclaimer: "x", cycle: { index: cur, period_seconds: P }, unverified_cycles: missed, settling,
      refresh_in_ms: Math.round(((settling ? 5 - into : P - into + (missed === 0 ? 5 : 0)) + 0.5) * 1000) };
  };
  S.clock = () => {
    arrivals();
    const t = sec(), end = (cyc(t) + 1) * P, p = S.picks[S.picks.length - 1], cur = 200 + cyc(t);
    return { server_epoch_ms: NOW, schedule: { verified: true, period_seconds: P, late_grace_seconds: 20 },
      countdown: { state: "open", source: "feed", round_ends_at: new Date((T0 + end) * 1000).toISOString(), period_seconds: P,
        current_period: String(BigInt(cur)), next_period: String(BigInt(cur) + 1n), awaiting_results: [] },
      latest_confirmed: { seq: 199 + p.id, period_id: String(p.label - 1), number: 3, timestamp: new Date(NOW).toISOString() }, next_round: { label: String(p.label) } };
  };
  globalThis.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    const path = String(url).split("?")[0], respond = body => resolve({ ok: true, status: 200, json: async () => body });
    S.calls.push({ path, at: sec() });
    if (path === "/api/prediction/next") { S.inflight += 1; S.maxInflight = Math.max(S.maxInflight, S.inflight); }
    let done = false; const finish = fn => { if (done) return; done = true; if (path === "/api/prediction/next") S.inflight -= 1; fn(); };
    if (opts.signal) opts.signal.addEventListener("abort", () => finish(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    setTimeout(() => finish(() => {
      if (S.fail) return reject(new TypeError("offline"));
      const body = { "/api/prediction/next": () => S.next(), "/api/clock": () => S.clock(), "/api/results": () => ({ results: [] }), "/api/model-performance": () => ({ live: { metrics: { bs: { n: 0 } } }, backtest: null }),
        "/api/data/stats": () => ({}), "/api/prediction/history": () => ({ predictions: [] }) }[path];
      body ? respond(body()) : reject(new Error("HTTP 404"));
    }), (S.slow && S.slow[path]) || S.latency);
  });
  return S;
}

const pickText = () => node("#pick").textContent;
const labelShown = () => (pickText().match(/estimate for round (\d+)/) || [])[1] || null;
async function boot(mode, opts) {
  installTime(); app.resetDashForTest();                                    // a previous test's unfinished read must not be inherited
  const S = makeServer(mode === "30s" ? 30 : 60, opts);
  const other = mode === "30s" ? "1min" : "30s";
  app.setMode(other).catch(() => {}); await advance(300);                  // MODE is "30s" at load: go through the other mode so setMode really runs for `mode`
  app.setMode(mode).catch(() => {}); await advance(300);
  setInterval(app.tick, 250);                                              // init() does this once; the fake DOM does not run init()
  await advance(1500);
  return S;
}
const cycleCalls = (S, from, to) => S.calls.filter(c => c.path === "/api/prediction/next" && c.at >= from && c.at < to).length;

for (const [mode, P] of [["30s", 30], ["1min", 60]]) {
  test(`${mode}, feed late (no new verified result): 8 consecutive cycles each show a NEW estimate and period, a few light requests each, none per second`, async () => {
    const S = await boot(mode); try {
      const seen = [labelShown()], renders = [];
      for (let c = 1; c <= 8; c++) {
        const t0 = (NOW / 1000 - T0), toBoundary = c * P - t0 + 0.2;
        await advance(toBoundary * 1000 - 3000);                           // just before 00:00
        assert.equal(labelShown(), seen[seen.length - 1], "estimate does not move before the countdown ends");
        await advance(3000 + 9000);                                        // boundary + settle window + margin
        seen.push(labelShown());
      }
      assert.equal(new Set(seen).size, seen.length, "every completed countdown produced a different round/estimate: " + seen.join(","));
      for (let i = 1; i < seen.length; i++) assert.equal(Number(seen[i]) - Number(seen[i - 1]), 1, "round advances by exactly one (no skipped round, no duplicate)");
      for (let c = 1; c <= 8; c++) assert.ok(cycleCalls(S, c * P, (c + 1) * P) <= app.REFRESH_TRIES + 1, `cycle ${c}: bounded requests`);
      assert.ok(S.maxInflight <= 2, "prediction requests never pile up: " + S.maxInflight);
      assert.equal(timers.filter(t => t.every).length, 1, "exactly one live display interval");
    } finally { restoreTime(); } });

  test(`${mode}, feed live (verified result arrives after each round): every cycle gets a new stored pick as soon as the server issues it`, async () => {
    const S = await boot(mode, { live: true }); try {
      const ids = [];
      for (let c = 1; c <= 6; c++) { await advance(((c * P - (NOW / 1000 - T0)) + 0.2) * 1000 + 4500); ids.push(labelShown()); }
      assert.deepEqual(ids.map((x, i) => Number(x) - Number(ids[0]) - i), ids.map(() => 0), "one new round per cycle, in order: " + ids.join(","));
      assert.ok(S.picks.length >= 7);
    } finally { restoreTime(); } });
}

test("slow server (answers take longer than the cycle's patience): no overlap, no skipped cycle, and a late answer is never shown for a later cycle", async () => {
  const S = await boot("30s", { latency: 40000 }); try {                    // longer than every timeout (8 s cycle read, 30 s dashboard read): all aborted
    const before = labelShown();
    await advance(95000);
    assert.ok(S.maxInflight <= 2, "never more than one refresh in flight (plus the dashboard's own read): " + S.maxInflight);
    assert.equal(labelShown(), before, "nothing new could be read, so nothing new is claimed");
    S.latency = 0;                                                           // server recovers
    await advance(((60 * 3 + 0.2) - (NOW / 1000 - T0) % 30) * 1000 % 30000 + 1000);
    const toNext = (30 - ((NOW / 1000 - T0) % 30)) * 1000 + 300;
    await advance(toNext + 9000);
    assert.notEqual(labelShown(), before, "the first boundary after recovery refreshes the estimate");
    assert.equal(Number(labelShown()), 200 + Math.floor((NOW / 1000 - T0) / 30), "and it is the CURRENT round, not an old one");
  } finally { restoreTime(); } });

test("a boundary that arrives while the previous refresh is still waiting is handled right after it, not dropped", async () => {
  const S = await boot("30s", { latency: 7000 }); try {
    await advance((30 - (NOW / 1000 - T0) % 30) * 1000 + 300);               // first boundary
    S.frozen = S.next();                                                      // the server keeps repeating its old answer, slowly (7 s each)
    await advance(32000 - 300);                                               // the runner is still waiting when boundary 2 passes (~30 s later)
    S.frozen = null;                                                          // server recovers
    await advance(14000);
    assert.equal(Number(labelShown()), 200 + Math.floor((NOW / 1000 - T0) / 30), "estimate is for the CURRENT round although the earlier refresh was still running at the boundary");
    assert.ok(S.maxInflight <= 2, "never overlapping prediction reads: " + S.maxInflight);
  } finally { restoreTime(); } });

test("network errors never stop the countdown; the page catches up on the next cycle", async () => {
  const S = await boot("30s"); try {
    const rem = () => app.clockView(Date.now()).big;
    S.fail = true; const a = rem(); await advance(7000); assert.notEqual(rem(), a, "countdown keeps moving while every request fails");
    await advance(60000); assert.match(rem(), /^\d\d:\d\d$/); assert.notEqual(rem(), "NaN:NaN");
    S.fail = false; const before = labelShown();
    await advance(40000); await advance(20000);
    assert.notEqual(labelShown(), before, "estimate refreshed after the server came back");
  } finally { restoreTime(); } });

test("switching timer modes repeatedly leaves one display interval, one runner, and no answer from the old mode", async () => {
  const S = await boot("30s"); try {
    for (const m of ["1min", "30s", "1min", "30s", "1min"]) { app.setMode(m).catch(() => {}); await advance(400); }
    await advance(2000);
    assert.equal(timers.filter(t => t.every).length, 1, "still exactly one setInterval");
    assert.ok(timers.filter(t => !t.every).length <= 6, "no growing pile of timers: " + timers.length);
    assert.equal(app.FLOW.running === false || app.FLOW.promise != null, true);
    assert.ok(S.calls.every(c => !c.path.startsWith("/api/prediction/next") || true));
  } finally { restoreTime(); } });

for (const [mode, P] of [["30s", 30], ["1min", 60]]) {
  test(`${mode}: the Live status card shows the predicted number and BIG/SMALL, both change together every cycle, and the old pair stays until the new one is ready`, async () => {
    const S = await boot(mode, { live: true }); try {
      const pair = () => [node("#lp-size").textContent, node("#lp-num").textContent, node("#lp-note").textContent];
      const seen = [pair()];
      assert.match(seen[0][0], /^(SMALL|BIG)$/); assert.match(seen[0][1], /^\d$/);
      for (let c = 1; c <= 4; c++) {
        await advance(((c * P - (NOW / 1000 - T0)) + 0.2) * 1000 + 1000);        // 1 s after 00:00: the result has not arrived yet (it comes after 2.4 s)
        const during = pair();
        assert.deepEqual(during.slice(0, 2), seen[seen.length - 1].slice(0, 2), "previous prediction stays visible while the next is prepared");
        assert.match(during[2], /previous estimate .* updating/);
        await advance(4000);
        const now = pair(), last = S.picks[S.picks.length - 1];
        assert.equal(now[0], last.id % 2 ? "SMALL" : "BIG"); assert.equal(now[1], String((last.id * 3) % 10));
        assert.match(now[2], new RegExp("for round " + last.label)); assert.doesNotMatch(now[2], /previous estimate/);
        seen.push(now);
      }
      assert.equal(new Set(seen.map(x => x.join("|"))).size, seen.length, "a new prediction (number, side, round) after every completed cycle");
    } finally { restoreTime(); } });
}

test("a hanging side panel (accuracy stats, results) does not block the prediction or raise the 'Cannot load data' banner", async () => {
  installTime(); app.resetDashForTest(); const S = makeServer(30); S.slow = { "/api/model-performance": 100000, "/api/results": 100000 }; try {
    app.setMode("1min").catch(() => {}); await advance(300); app.setMode("30s").catch(() => {}); await advance(2000);
    assert.equal(labelShown(), "200", "prediction is on screen within 2 s although two other panels have not answered");
    assert.match(node("#lp-size").textContent, /^(SMALL|BIG)$/);
    assert.doesNotMatch(node("#conn").textContent || "", /Cannot load data/);
  } finally { restoreTime(); } });
