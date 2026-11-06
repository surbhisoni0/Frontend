"use strict";
/* RESEARCH tab: strict DEV/FINAL walk-forward model comparison from /api/research/report.
   Uses helpers from app.js ($, el, api, pct, setBody). All API text is rendered with textContent. */

/* Pure helper (unit-tested): turns the report into the plain-language verdict. Never invents an edge. */
function researchSummary(rep) {
  if (!rep || !rep.available || !Array.isArray(rep.model_table) || !rep.model_table.length) return { available: false };
  const rows = rep.model_table;
  const best = rows.reduce((a, b) => (b.final.direct > a.final.direct ? b : a));
  const minP = Math.min(...rows.map(r => r.final_p_bonferroni_two_sided));
  const target = 0.8, sel = rows.find(r => r.selected_on_dev) || null;
  return {
    available: true, n: rep.final_n_actual, models: rows.length,
    best: { model: best.model, acc: best.final.direct }, selected: sel ? { model: sel.model, acc: sel.final.direct, reverse: sel.final.reverse } : null,
    minPBonferroni: minP, significant: minP < 0.05,
    luck95: rep.luck_benchmark ? rep.luck_benchmark.best_of_K_coin_flips_95pct : null,
    withinLuck: rep.luck_benchmark ? best.final.direct <= rep.luck_benchmark.best_of_K_coin_flips_95pct : null,
    targetGap: target - best.final.direct,
  };
}

const rsP = p => (p == null ? "—" : p < 0.0001 ? "<0.0001" : p.toFixed(3));

async function loadResearch() {
  const host = $("#rs-body"); if (!host) return;
  let rep;
  try { rep = await api("/api/research/report"); } catch (e) { host.replaceChildren(el("p", { class: "muted" }, "Could not load the report: " + e.message)); return; }
  const s = researchSummary(rep);
  if (!s.available) { host.replaceChildren(el("p", { class: "muted" }, "No research report has been generated yet. Run: python -m app.backtesting.research --out data/research_report.json")); return; }
  const verdict = s.significant
    ? `At least one model is significant after correcting for ${s.models} tests — confirm it on newly arriving live rounds before trusting it.`
    : `No model shows a statistically significant edge. Best final-test accuracy is ${pct(s.best.acc)} (${s.best.model}); pure luck across ${s.models} strategies reaches about ${pct(s.luck95)}. The 80% target is ${(100 * s.targetGap).toFixed(1)} points away.`;
  const head = ["Model", "Dev acc.", "Final acc.", "Reverse", "95% CI", "p (corrected)"];
  const rows = rep.model_table.slice().sort((a, b) => b.final.direct - a.final.direct).map(r => el("tr", {},
    el("td", {}, r.model, r.selected_on_dev ? " (picked on dev)" : ""), el("td", {}, pct(r.dev.direct)), el("td", {}, pct(r.final.direct)),
    el("td", {}, pct(r.final.reverse)), el("td", {}, `${pct(r.final.lo)} – ${pct(r.final.hi)}`), el("td", {}, rsP(r.final_p_bonferroni_two_sided))));
  const dq = rep.data_quality || {};
  host.replaceChildren(
    el("p", { class: "note", "data-testid": "research-verdict" }, verdict),
    el("p", { class: "muted" }, `Tested on ${s.n} consecutive unseen rounds (final), models and thresholds chosen on earlier rounds only. Experimental estimates, not confirmed results.`),
    el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, head.map(h => el("th", {}, h)))), el("tbody", {}, rows))),
    el("p", { class: "muted" }, `Reverse accuracy is always 100% − direct accuracy on a two-outcome game. Data: ${dq.rounds ?? "?"} rounds, ${dq.period_id_jumps ?? "?"} gaps (≈${dq.rounds_missing_in_jumps ?? "?"} missing rounds).`));
}
if (typeof module !== "undefined") module.exports = { researchSummary };
