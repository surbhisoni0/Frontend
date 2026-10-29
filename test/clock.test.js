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

/* ---- the three timer options: every second shows a real value, the countdown restarts for the chosen duration, periods advance ---- */
const { clockView, CLOCK } = require("../app.js");
const T0 = Date.parse("2026-10-29T10:00:00Z");
const feedClock = P => ({ schedule: { verified: false, period_seconds: P },
  countdown: { state: "open", source: "feed", period_seconds: P, current_period: "20261029100050100", round_ends_at: new Date(T0 + P * 1000).toISOString(), awaiting_results: [] } });
const assumedClock = P => ({ schedule: { verified: false, period_seconds: P },
  countdown: { state: "assumed", period_seconds: P, round_ends_at: new Date(T0 + P * 1000).toISOString(), reason: "assumed" } });
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

for (const [P, make, name] of [[30, feedClock, "30s feed"], [60, feedClock, "1min feed"]]) {
  test(`${name}: counts down every second, never shows 00:00, restarts at ${mmss(P)} and rolls the period`, () => {
    Object.assign(CLOCK, { data: make(P), samples: [], failures: 0 });
    const shown = new Set();
    for (let ms = 0; ms < P * 3 * 1000; ms += 100) {
      const v = clockView(T0 + ms); shown.add(v.big);
      assert.notEqual(v.big, "00:00", `00:00 flashed at +${ms}ms`);
    }
    for (let sec = 1; sec <= P; sec++) assert.ok(shown.has(mmss(sec)), `${mmss(sec)} never displayed`);      // one tick per second, full duration each cycle
    assert.equal(clockView(T0).big, mmss(P));                                                              // starts at the full duration
    assert.equal(clockView(T0 + P * 1000 + 50).big, mmss(P));                                              // reset for the next period
    if (make === feedClock) {
      assert.equal(localCountdown(CLOCK.data, T0 + 1000).current, "20261029100050100");
      assert.equal(localCountdown(CLOCK.data, T0 + P * 1000 + 1000).current, "20261029100050101");
      assert.equal(localCountdown(CLOCK.data, T0 + P * 2000 + 1000).current, "20261029100050102");
      assert.equal(clockView(T0 + 1000).badge, "Live · synced to feed");
    } else assert.equal(clockView(T0 + 1000).badge, "Assumed schedule");                                    // never presented as verified
  });
}

test("a server that has not answered yet is 'Connecting…', and only repeated failures read 'Reconnecting…'", () => {
  Object.assign(CLOCK, { data: null, samples: [], failures: 0 });
  assert.equal(clockView(T0).badge, "Connecting…");
  CLOCK.failures = 2; assert.equal(clockView(T0).badge, "Connecting…");
  CLOCK.failures = 3; assert.equal(clockView(T0).badge, "Reconnecting…");
  Object.assign(CLOCK, { data: null, samples: [], failures: 0 });
});

/* ---- the stuck-00:00 fix: the timer runs by itself on the selected duration, with or without a new result ---- */
const { cycleAt, roundTick, ROUND, TIMER_MODES, MODE_SECONDS, MODE_LABEL } = require("../app.js");

test("the two timer options exist, 30 Sec first", () => {
  assert.deepEqual(TIMER_MODES, ["30s", "1min"]);
  assert.deepEqual(TIMER_MODES.map(k => MODE_LABEL[k]), ["30 Sec", "1 Min"]);
  assert.deepEqual(TIMER_MODES.map(k => MODE_SECONDS[k]), [30, 60]);
});

test("cycleAt: remaining is always 1 ms .. full duration (never 0, never negative), full duration right at a boundary, any anchor works", () => {
  for (const P of [30, 60, 120]) for (const anchor of [T0, T0 - 7 * 3600 * 1000 - 333, T0 + 90_000]) for (let ms = -250_000; ms < 400_000; ms += 137) {
    const c = cycleAt(anchor, P, T0 + ms);
    assert.ok(c.remainingMs >= 1 && c.remainingMs <= P * 1000, `${P}s ${ms}: ${c.remainingMs}`);
  }
  assert.equal(cycleAt(T0, 30, T0 + 30_000).remainingMs, 30_000);                  // boundary: reset to the full duration
  assert.equal(cycleAt(T0, 30, T0 + 29_999).remainingMs, 1);
  assert.equal(cycleAt(T0, 30, T0 + 30_000).cycle, cycleAt(T0, 30, T0 + 29_999).cycle + 1);
});

for (const P of [30, 60, 120]) {
  for (const [name, mk] of [
    ["result overdue ('late'): no new result ever arrives", () => ({ schedule: { verified: true, period_seconds: P, late_grace_seconds: 20 }, countdown: { state: "open", round_ends_at: new Date(T0).toISOString() } })],
    ["unverified", () => ({ schedule: { verified: false, reason: "no timestamps" }, countdown: { state: "unverified", reason: "no timestamps" }, next_round: { label: "#5" } })],
    ["no_data", () => ({ countdown: { state: "no_data" } })],
  ]) {
    test(`${P}s, ${name}: counts down every second, resets to ${mmss(P)}, never shows 00:00 or --:--`, () => {
      Object.assign(CLOCK, { data: mk(), samples: [], failures: 0 }); Object.assign(ROUND, { seconds: P, startedAt: T0, end: null });
      const shown = new Set();
      for (let ms = 0; ms < P * 4 * 1000 + 95_000; ms += 100) {                 // includes 95 s past the stale end: the reported stuck case
        const v = clockView(T0 + 95_000 + ms); shown.add(v.big);
        assert.match(v.big, /^\d\d:\d\d$/); assert.notEqual(v.big, "00:00", `00:00 at +${ms}ms`);
        assert.ok(v.endsAt > T0 + 95_000 + ms, "end instant is always in the future");
      }
      for (let sec = 1; sec <= P; sec++) assert.ok(shown.has(mmss(sec)), `${mmss(sec)} never displayed`);
      assert.ok(!/overdue/i.test(clockView(T0 + 95_000).badge), "no stuck 'Result overdue' badge");
    });
  }
}

test("roundTick fires exactly once per elapsed boundary, however often it is called, and once after a long sleep", () => {
  const r = { end: null, ends: 0 }; let fired = 0, now = T0;
  const view = t => cycleAt(T0, 30, t);
  for (; now < T0 + 30_000 * 5 + 1; now += 50) if (roundTick(r, now + view(now).remainingMs, now)) fired += 1;
  assert.equal(fired, 5);                                                          // 30,60,90,120,150 s: five boundaries, five refreshes
  const s = { end: null, ends: 0 }; roundTick(s, T0 + 30_000, T0);
  assert.equal(roundTick(s, T0 + 30_000 * 10, T0 + 30_000 * 9 + 5), true);          // tab slept through 8 rounds: one refresh, not eight
  assert.equal(roundTick(s, T0 + 30_000 * 10, T0 + 30_000 * 9 + 55), false);
  const m = { end: null, ends: 0 };
  assert.equal(roundTick(m, T0 + 10_000, T0), false);                              // first tick never fires
  assert.equal(roundTick(m, T0 + 5_000, T0 + 100), false);                         // a re-sync that moves the end earlier does not fire either
});

test("no jump: when the server round ends and the state flips open -> awaiting -> late, the display keeps counting on the same phase", () => {
  for (const P of [30, 60, 120]) {
    Object.assign(CLOCK, { data: { schedule: { verified: true, period_seconds: P, late_grace_seconds: 20 },
      countdown: { state: "open", round_ends_at: new Date(T0 + 7_000).toISOString() }, next_round: { label: "X" } }, samples: [], failures: 0 });
    Object.assign(ROUND, { seconds: P, startedAt: T0 - 5_000, end: null, ends: 0 });
    let prev = null, fires = 0;
    for (let ms = 0; ms < P * 3 * 1000 + 60_000; ms += 100) {
      const now = T0 + ms, v = clockView(now); if (roundTick(ROUND, v.endsAt, now)) fires += 1;
      const secs = (([m, s]) => m * 60 + s)(v.big.split(":").map(Number));
      if (prev != null) assert.ok(secs === prev || secs === prev - 1 || (prev === 1 && secs === P), `${P}s: jump ${mmss(prev)} -> ${v.big} at +${ms}ms (${v.badge})`);
      prev = secs;
    }
    assert.ok(fires >= 3 && fires <= 6, `${P}s: ${fires} boundaries`);
  }
});
