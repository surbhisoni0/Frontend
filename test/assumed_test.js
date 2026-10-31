"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { localCountdown, pollDelay } = require("../app.js");

const END = Date.parse("2026-10-24T10:01:00Z");
const clock = (extra = {}) => ({ schedule: { verified: false, reason: "no ids" },
  countdown: { state: "assumed", round_ends_at: new Date(END).toISOString(), period_seconds: 60, ...extra } });

test("assumed: counts down to the boundary and is never reported as 'open' (verified)", () => {
  const r = localCountdown(clock(), END - 45000);
  assert.equal(r.state, "assumed"); assert.equal(r.remainingMs, 45000);
});

test("assumed: rolls over to the next minute by itself, never negative, never 'awaiting result'", () => {
  for (const dt of [0, 1, 500, 59999, 60000, 125000]) {
    const r = localCountdown(clock(), END + dt);
    assert.equal(r.state, "assumed"); assert.ok(r.remainingMs > 0 && r.remainingMs <= 60000, `dt=${dt} -> ${r.remainingMs}`);
  }
  assert.equal(localCountdown(clock(), END + 20000).remainingMs, 40000);
  assert.equal(localCountdown(clock(), END + 60000).remainingMs, 60000);
});

test("assumed: honours a different period length", () => {
  assert.equal(localCountdown(clock({ period_seconds: 30 }), END + 10000).remainingMs, 20000);
});

test("assumed: normal polling (no fast polling, no back-off)", () => {
  assert.equal(pollDelay({ failures: 0, local: { state: "assumed", remainingMs: 30000 }, pollMs: 10000 }), 10000);
});

test("assumed: estimate note appears only after the minute it was seen in has ended, and resets when a result changes the round", () => {
  const { assumedNote } = require("../app.js");
  let r = assumedNote({ label: null, end: null }, "#131", 1000, 40000);        // first seen, 40 s left
  assert.equal(r.msg, ""); assert.equal(r.track.end, 41000);
  r = assumedNote(r.track, "#131", 40999, 1);  assert.equal(r.msg, "");
  r = assumedNote(r.track, "#131", 41000, 60000); assert.match(r.msg, /result of round #131 has not been added/);
  assert.match(r.msg, /frozen/);
  r = assumedNote(r.track, "#132", 100000, 25000);                              // a result arrived: new round label, new baseline
  assert.equal(r.msg, ""); assert.equal(r.track.label, "#132");
});
