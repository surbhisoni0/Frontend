// Run with:  node --test        (Node 18+, no dependencies; auto-discovers test/*.test.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const { localCountdown, pollDelay, pickOffset, fmtClock, clockKey } = require("../app.js");

const END = Date.parse("2026-10-23T10:01:00Z");
const clock = (state, extra = {}) => ({
  schedule: { verified: true, period_seconds: 60, late_grace_seconds: 20 },
  countdown: { state, round_ends_at: new Date(END).toISOString(), reason: null, ...extra },
});

test("countdown is derived from an absolute end time, so any call order gives the same answer", () => {
  const c = clock("open");
  assert.equal(localCountdown(c, END - 45000).remainingMs, 45000);
  assert.equal(localCountdown(c, END - 5000).remainingMs, 5000);
  assert.equal(localCountdown(c, END - 45000).remainingMs, 45000);
});

test("reaching zero means 'awaiting result', never a new period, never negative", () => {
  const c = clock("open");
  for (const dt of [0, 1, 500, 19999]) {
    const r = localCountdown(c, END + dt);
    assert.equal(r.state, "awaiting_result"); assert.equal(r.remainingMs, 0); assert.equal(r.ended, 1);
  }
});

test("after the grace period, or after several missed rounds, the state is 'late' with an honest round count", () => {
  assert.equal(localCountdown(clock("open"), END + 25000).state, "late");
  const r = localCountdown(clock("open"), END + 60000 * 3 + 1000);          // tab was asleep for ~3 minutes
  assert.equal(r.state, "late"); assert.equal(r.ended, 4); assert.equal(r.remainingMs, 0);
});

test("server-reported unverified / no_data pass through with no countdown", () => {
  const u = localCountdown({ countdown: { state: "unverified", reason: "no timestamps" } }, END);
  assert.deepEqual([u.state, u.remainingMs, u.reason], ["unverified", null, "no timestamps"]);
  assert.equal(localCountdown({ countdown: { state: "no_data" } }, END).state, "no_data");
  assert.equal(localCountdown(null, END).state, "no_data");
});

test("an unparseable end time degrades to 'unverified' instead of NaN", () => {
  assert.equal(localCountdown(clock("open", { round_ends_at: "garbage" }), END).state, "unverified");
});

test("server-clock offset comes from the lowest-latency sample", () => {
  assert.equal(pickOffset([{ rtt: 400, offset: 900 }, { rtt: 40, offset: 120 }, { rtt: 90, offset: 200 }]), 120);
  assert.equal(pickOffset([]), 0);
});

test("a skewed client clock is corrected by the offset", () => {
  const clientAhead = 90_000, offset = -clientAhead;                         // client clock 90 s fast
  const nowServerAligned = (END - 30000) + clientAhead + offset;
  assert.equal(localCountdown(clock("open"), nowServerAligned).remainingMs, 30000);
});

test("polling: back-off on errors, fast while awaiting, aligned to the boundary, never a busy loop", () => {
  const base = { pollMs: 10000 };
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(f => pollDelay({ ...base, failures: f, local: { state: "open", remainingMs: 1 } })), [2000, 4000, 8000, 16000, 30000, 30000]);
  assert.equal(pollDelay({ ...base, failures: 0, local: { state: "awaiting_result" } }), 3000);
  assert.equal(pollDelay({ ...base, failures: 0, local: { state: "open", remainingMs: 4000 } }), 5500);   // just after the boundary
  assert.equal(pollDelay({ ...base, failures: 0, local: { state: "open", remainingMs: 55000 } }), 10000);
  assert.equal(pollDelay({ ...base, failures: 0, local: { state: "open", remainingMs: 0 } }), 1500);
  assert.equal(pollDelay({ ...base, failures: 0, local: { state: "late" } }), 10000);                    // do not hammer when long overdue
  assert.equal(pollDelay({ ...base, failures: 0, local: { state: "unverified" } }), 10000);
});

test("formatting never shows a negative time", () => {
  assert.equal(fmtClock(-5000), "00:00"); assert.equal(fmtClock(0), "00:00");
  assert.equal(fmtClock(59200), "01:00"); assert.equal(fmtClock(1000), "00:01"); assert.equal(fmtClock(60000), "01:00");
});

test("change detection key moves only when a new confirmed result or next round appears", () => {
  const d = (seq, label) => ({ latest_confirmed: { seq }, next_round: { label } });
  assert.equal(clockKey(d(130, "700131")), clockKey(d(130, "700131")));
  assert.notEqual(clockKey(d(130, "700131")), clockKey(d(131, "700132")));
  assert.equal(clockKey({ latest_confirmed: null }), "none");
});
