"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { researchSummary } = require("../research.js");

const row = (model, acc, pb, sel = false) => ({ model, selected_on_dev: sel, dev: { direct: 0.5 }, final: { direct: acc, reverse: 1 - acc, lo: acc - 0.03, hi: acc + 0.03 }, final_p_bonferroni_two_sided: pb });
const rep = (rows, luck = 0.545) => ({ available: true, final_n_actual: 1000, model_table: rows, luck_benchmark: { best_of_K_coin_flips_95pct: luck } });

test("unavailable or empty report gives available:false", () => {
  assert.equal(researchSummary(null).available, false);
  assert.equal(researchSummary({ available: false }).available, false);
  assert.equal(researchSummary({ available: true, model_table: [] }).available, false);
});
test("noise-level results are never called significant", () => {
  const s = researchSummary(rep([row("A", 0.529, 1), row("B", 0.467, 0.8, true)]));
  assert.equal(s.significant, false); assert.equal(s.withinLuck, true); assert.equal(s.best.model, "A");
  assert.ok(Math.abs(s.targetGap - 0.271) < 1e-9);
});
test("a corrected p below 0.05 is flagged significant", () => {
  assert.equal(researchSummary(rep([row("A", 0.62, 0.001)])).significant, true);
});
