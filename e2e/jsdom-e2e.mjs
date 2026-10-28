// Optional end-to-end check: real backend (uvicorn, in-memory DB) + this frontend in jsdom. Not part of `node --test`.
//   npm i jsdom           (anywhere; run from that folder)
//   BACKEND_DIR=/path/to/backend FRONTEND_DIR=/path/to/frontend node jsdom-e2e.mjs
// BACKEND_DIR must contain app/ and have FRONTEND_DIR as its sibling named "frontend" (that is where main.py serves it from).
import { JSDOM } from "jsdom";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const BACKEND = process.env.BACKEND_DIR || "/tmp/e2e/backend";
let port = 8770, results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, what = "condition") {
  const t0 = Date.now();
  for (;;) { try { const v = await fn(); if (v) return v; } catch (_) { /* retry */ } if (Date.now() - t0 > ms) throw new Error("timeout waiting for " + what); await sleep(100); }
}

async function startServer(endedAgoSec) {
  const base = `http://127.0.0.1:${++port}`;
  const env = { ...process.env, DATABASE_URL: "memory://", AUTO_SEED: "false", AUTO_BACKTEST: "false", SYNC_ENABLED: "false", ADMIN_API_KEY: "k", UI_POLL_SECONDS: "10", LATE_GRACE_SECONDS: "20" };
  const proc = spawn("python", ["-m", "uvicorn", "app.main:app", "--port", String(port), "--log-level", "warning"], { cwd: BACKEND, env, stdio: "inherit" });
  await until(() => fetch(base + "/api/health").then(r => r.ok), 30000, "server start");
  const end = Date.now() / 1000 - endedAgoSec;
  const rows = Array.from({ length: 130 }, (_, i) => ({ number: (i * 7 + Math.floor(i / 3)) % 10, period_id: String(700001 + i), timestamp: new Date((end - (129 - i) * 60) * 1000).toISOString() }));
  const r = await fetch(base + "/api/data/import", { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k" }, body: JSON.stringify({ rows }) });
  assert.equal(r.status, 200, await r.text());
  // a draw-time provider reports the NOMINAL end of the round (end + 60 s * rounds after the seeded ones), not the moment it was received
  const post = (period, number) => fetch(base + "/api/results", { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k" },
    body: JSON.stringify({ number, period_id: period, timestamp: new Date((end + 60 * (Number(period) - 700130)) * 1000).toISOString() }) }).then(x => x.json());
  return { base, proc, post, stop: () => proc.kill() };
}

async function openPage(base) {
  const net = { down: false, calls: [] };
  const dom = await JSDOM.fromURL(base + "/", { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    beforeParse(w) { w.fetch = (u, o = {}) => { net.calls.push(String(u)); return net.down ? Promise.reject(new TypeError("offline")) : fetch(new URL(u, base), { ...o, signal: undefined }); }; } });
  const d = dom.window.document, q = s => d.querySelector(s), txt = s => (q(s) ? q(s).textContent : "");
  return { dom, net, d, q, txt, close: () => dom.window.close() };
}
const scenario = async (name, fn) => { const t0 = Date.now(); try { await fn(); results.push(["PASS", name, Date.now() - t0]); } catch (e) { results.push(["FAIL", name + " :: " + e.message, Date.now() - t0]); } };

await scenario("startup: connects, verified schedule, next round bound to the exact period, countdown ticks from timestamps", async () => {
  const s = await startServer(10), p = await openPage(s.base);
  try {
    await until(() => p.txt("#cd-badge") === "Round open", 20000, "Round open badge");
    assert.match(p.txt("#clock"), /700130/); assert.match(p.txt("#clock"), /700131/);
    assert.match(p.txt("#pick"), /estimate for round 700131/); assert.match(p.txt("#clock"), /Schedule verified/);
    const secs = t => { const [m, s2] = t.split(":").map(Number); return m * 60 + s2; };
    const a = secs(p.txt("#cd-big")); await sleep(3000); const b = secs(p.txt("#cd-big"));
    assert.ok(a - b >= 2 && a - b <= 4, `countdown moved ${a}->${b}`); assert.ok(a <= 50 && a >= 45, "starts near 60-10-elapsed: " + a);
    assert.match(p.txt("#updated"), /Updated/);
  } finally { p.close(); s.stop(); }
});

await scenario("period transition: zero = awaiting (period NOT advanced) -> confirmed result advances to next period, estimate scored", async () => {
  const s = await startServer(56), p = await openPage(s.base);          // round ends in ~4 s
  try {
    await until(() => p.txt("#cd-badge") === "Round open", 20000, "open");
    await until(() => p.txt("#cd-badge") === "Awaiting result", 15000, "awaiting");
    assert.equal(p.txt("#cd-big"), "00:00"); assert.match(p.txt("#clock"), /700131/); assert.doesNotMatch(p.txt("#clock"), /700132/);
    assert.match(p.txt("#pick"), /has ended and its verified result is not confirmed/);
    const before = p.txt("#pick").match(/generated [^\n·]*/)?.[0];
    const r = await s.post("700131", 4);                                   // the official result arrives
    assert.equal(r.resolved_prediction.target_period, "700131");
    await until(() => /700132/.test(p.txt("#clock")) && p.txt("#cd-badge") === "Round open", 15000, "advance after confirmation");
    assert.match(p.txt("#pick"), /estimate for round 700132/); assert.doesNotMatch(p.txt("#pick"), /has ended and its verified/);
    const after = p.txt("#pick").match(/generated [^\n·]*/)?.[0]; assert.notEqual(after, before, "new estimate generated for the new period");
    const hist = await (await fetch(s.base + "/api/prediction/history?limit=5")).json();
    assert.equal(hist.predictions[0].round, "700132"); assert.equal(hist.predictions[1].round, "700131"); assert.equal(hist.predictions[1].actual, 4);
    assert.equal(hist.predictions.filter(h => h.round === "700131").length, 1, "no duplicate record for a period");
  } finally { p.close(); s.stop(); }
});

await scenario("late result: 'Awaiting' -> 'Result overdue' after grace, frozen estimate, number never advances; result then arrives", async () => {
  const s = await startServer(58), p = await openPage(s.base);          // ends in ~2 s
  try {
    await until(() => p.txt("#cd-badge") === "Awaiting result", 20000, "awaiting");
    await until(() => p.txt("#cd-badge") === "Result overdue", 40000, "overdue");
    assert.match(p.txt("#cd-note"), /overdue/); assert.doesNotMatch(p.txt("#clock"), /700132/);
    await s.post("700131", 9);
    await until(() => /700132/.test(p.txt("#clock")), 15000, "advance after late result");
    assert.equal(p.txt("#cd-badge"), "Round open", "late-but-nominally-timestamped result re-syncs to the true schedule");
  } finally { p.close(); s.stop(); }
});

await scenario("network drop: shows reconnecting/disconnected, keeps last data, never invents a result; recovers and reconciles", async () => {
  const s = await startServer(30), p = await openPage(s.base);
  try {
    await until(() => p.txt("#cd-badge") === "Round open", 20000, "open");
    const snapshot = p.txt("#clock").match(/7001\d\d/g).join(",");
    p.net.down = true;
    await until(() => /Reconnecting|Disconnected/.test(p.txt("#cd-badge")), 20000, "reconnecting badge");
    assert.match(p.txt("#conn"), /Retrying|Disconnected|Connection problem/);
    assert.equal(p.txt("#clock").match(/7001\d\d/g).join(","), snapshot, "period numbers unchanged while offline");
    assert.match(p.txt("#cd-note"), /Offline since/); assert.match(p.txt("#cd-big"), /^\d\d:\d\d$/);
    await until(() => p.txt("#cd-badge") === "Disconnected", 20000, "disconnected");
    await s.post("700131", 2);                                              // a result arrives while the browser is offline
    p.net.down = false;
    await until(() => /700132/.test(p.txt("#clock")) && /Round open|Awaiting|overdue/.test(p.txt("#cd-badge")), 30000, "reconcile after reconnect");
    assert.ok(p.d.querySelector("#conn").hidden, "error banner cleared");
  } finally { p.close(); s.stop(); }
});

await scenario("background tab: no polling while hidden; on return it reconciles immediately and shows the missed round", async () => {
  const s = await startServer(20), p = await openPage(s.base);
  try {
    await until(() => p.txt("#cd-badge") === "Round open", 20000, "open");
    await sleep(1500);
    Object.defineProperty(p.d, "hidden", { configurable: true, get: () => true }); p.d.dispatchEvent(new p.dom.window.Event("visibilitychange"));
    await sleep(1500); const n0 = p.net.calls.filter(u => u.includes("/api/clock")).length;
    await s.post("700131", 6);                                           // a round completes while the tab is in the background
    await sleep(6000);
    assert.ok(p.net.calls.filter(u => u.includes("/api/clock")).length - n0 <= 1, "polling paused while hidden");
    assert.doesNotMatch(p.txt("#clock"), /700132/, "page does not pretend to know about the missed round");
    Object.defineProperty(p.d, "hidden", { configurable: true, get: () => false }); p.d.dispatchEvent(new p.dom.window.Event("visibilitychange"));
    await until(() => /700132/.test(p.txt("#clock")), 4000, "reconcile on return");
  } finally { p.close(); s.stop(); }
});

await scenario("page refresh mid-period: same estimate (not regenerated), countdown consistent with the first load", async () => {
  const s = await startServer(15), a = await openPage(s.base);
  try {
    await until(() => a.txt("#cd-badge") === "Round open", 20000, "open");
    const estA = (await (await fetch(s.base + "/api/prediction/next")).json()), secs = t => { const [m, x] = t.split(":").map(Number); return m * 60 + x; };
    const cdA = secs(a.txt("#cd-big")); a.close(); await sleep(2000);
    const b = await openPage(s.base);
    try {
      await until(() => b.txt("#cd-badge") === "Round open", 20000, "open after refresh");
      const estB = (await (await fetch(s.base + "/api/prediction/next")).json());
      assert.deepEqual([estB.id, estB.created_at, estB.size, estB.target_period], [estA.id, estA.created_at, estA.size, estA.target_period]);
      const cdB = secs(b.txt("#cd-big")); assert.ok(cdA - cdB >= 1 && cdA - cdB <= 6, `countdown continued from ${cdA} to ${cdB}, not restarted`);
    } finally { b.close(); }
  } finally { s.stop(); }
});

await scenario("unverified timing: no timestamps -> no countdown, estimate labelled as a row number, nothing invented", async () => {
  const s = await startServer(10); s.stop(); await sleep(300);
  const base = `http://127.0.0.1:${++port}`;
  const env = { ...process.env, DATABASE_URL: "memory://", AUTO_SEED: "false", AUTO_BACKTEST: "false", SYNC_ENABLED: "false", ADMIN_API_KEY: "k" };
  const proc = spawn("python", ["-m", "uvicorn", "app.main:app", "--port", String(port), "--log-level", "warning"], { cwd: BACKEND, env, stdio: "inherit" });
  try {
    await until(() => fetch(base + "/api/health").then(r => r.ok), 30000, "server");
    const rows = Array.from({ length: 130 }, (_, i) => ({ number: (i * 7 + Math.floor(i / 3)) % 10 }));
    await fetch(base + "/api/data/import", { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k" }, body: JSON.stringify({ rows }) });
    const p = await openPage(base);
    try {
      await until(() => p.txt("#cd-badge") === "Timing unverified", 20000, "unverified badge");
      assert.equal(p.txt("#cd-big"), "--:--"); assert.match(p.txt("#clock"), /row number/); assert.match(p.txt("#pick"), /not an official period/);
      assert.match(p.txt("#pick"), /estimate for round #131/);
    } finally { p.close(); }
  } finally { proc.kill(); }
});

for (const [st, name, ms] of results) console.log(`${st}  ${name}  (${(ms / 1000).toFixed(1)}s)`);
process.exit(results.some(r => r[0] === "FAIL") ? 1 : 0);
