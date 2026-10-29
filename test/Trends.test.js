"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { trendStats, runsOf, streakInfo } = require("../app.js");

const newestFirst = nums => nums.slice().reverse().map((number, i) => ({ number, seq: nums.length - i }));

test("trendStats returns null for no data", () => assert.equal(trendStats([]), null));

test("counts: big/small, odd/even, colours (0 and 5 are violet too)", () => {
  const t = trendStats(newestFirst([0, 5, 1, 2, 9, 4]));          // oldest -> newest
  assert.equal(t.n, 6); assert.equal(t.big, 2); assert.equal(t.small, 4);
  assert.equal(t.odd, 3); assert.equal(t.even, 3); assert.equal(t.violet, 2);
  assert.equal(t.green, 3); assert.equal(t.red, 3);
});

test("missing = rounds since the number last appeared (0 = latest round), null = not in window", () => {
  const t = trendStats(newestFirst([7, 3, 3, 8, 2]));              // newest is 2
  assert.equal(t.missing[2], 0); assert.equal(t.missing[8], 1); assert.equal(t.missing[3], 2); assert.equal(t.missing[7], 4);
  assert.equal(t.missing[0], null);
  assert.equal(t.freq[3], 2);
});

test("streaks are measured at the newest end; longest per side", () => {
  const t = trendStats(newestFirst([1, 2, 6, 7, 8, 9, 9]));        // Small Small Big Big Big Big Big
  assert.deepEqual(t.sizeStreak.current, { key: "Big", len: 5 });
  assert.equal(t.sizeStreak.longest.Small, 2);
  assert.equal(t.sizeStreak.longest.Big, 5);
});

test("hot / cold list ties instead of picking one arbitrarily", () => {
  const t = trendStats(newestFirst([1, 1, 2, 2, 3]));
  assert.deepEqual(t.hot, [1, 2]); assert.ok(t.cold.includes(0) && t.cold.length === 7);
});

test("runsOf builds roadmap columns in order", () => {
  assert.deepEqual(runsOf(["a", "a", "b", "a"]), [{ key: "a", len: 2 }, { key: "b", len: 1 }, { key: "a", len: 1 }]);
  assert.deepEqual(streakInfo([]), { current: null, longest: {} });
});

test("input order matters: the first element is the NEWEST round", () => {
  const t = trendStats([{ number: 9 }, { number: 1 }, { number: 1 }]);   // newest = 9
  assert.equal(t.missing[9], 0); assert.deepEqual(t.sizeStreak.current, { key: "Big", len: 1 });
});