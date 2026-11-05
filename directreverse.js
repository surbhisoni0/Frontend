"use strict";
/* DIRECT vs REVERSE ANALYSIS tab. Uses the helpers from app.js ($, el, svg, api, pct, setBody, clear). All API text is rendered with textContent. */
const DR = { source: "backtest", from: "", to: "", win: 100, data: null, bound: false };
const DRC = { direct: "#3b4a6b", reverse: "#c0392b", coin: "#9a6a12" };
const DR_ALGO = (typeof NAMES !== "undefined") ? NAMES : {};

function drQuery() {
  const q = new URLSearchParams({ source: DR.source, window: String(DR.win) });
  if (DR.from) q.set("date_from", DR.from);
  if (DR.to) q.set("date_to", DR.to);
  return "/api/direct-reverse?" + q.toString();
}
const drP = p => (p == null ? "—" : p < 0.0001 ? "<0.0001" : p.toFixed(4));
const drCi = x => (x && x.n ? `${pct(x.lo)} – ${pct(x.hi)}` : "—");
function drCls(x) { return x.rate == null ? "dr-flat" : x.lo > 0.5 ? "dr-win" : x.hi < 0.5 ? "dr-lose" : "dr-flat"; }
const drCell = x => el("td", {}, el("span", { class: drCls(x) }, pct(x.rate)), " ", el("span", { class: "muted" }, `[${drCi(x)}]`));
const drTable = (head, rows) => el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, head.map(h => el("th", {}, h)))), el("tbody", {}, rows)));

/* ---------------------------------------------------------------- charts */
function drBars(host, s) {
  const W = 600, H = 230, L = 40, B = 28, T = 14, lo = 0.4, hi = 0.6;
  const y = v => T + (H - T - B) * (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo));
  const svgEl = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Direct versus reverse accuracy" });
  [0.4, 0.45, 0.5, 0.55, 0.6].forEach(v => svgEl.append(svg("line", { x1: L, x2: W, y1: y(v), y2: y(v), stroke: v === 0.5 ? DRC.coin : "#ddd5c4", "stroke-dasharray": v === 0.5 ? "5 4" : "" }), svg("text", { x: 2, y: y(v) + 3 }, pct(v))));
  [["Direct", s.direct, DRC.direct], ["Reverse", s.reverse, DRC.reverse]].forEach(([name, m, col], i) => {
    const bw = 110, x = L + 90 + i * 200, y0 = y(0.4), yt = y(m.rate);
    svgEl.append(svg("rect", { x, y: Math.min(yt, y(0.5)), width: bw, height: Math.abs(yt - y(0.5)) || 1, rx: 4, fill: col, opacity: 0.85 }));
    svgEl.append(svg("line", { x1: x + bw / 2, x2: x + bw / 2, y1: y(m.lo), y2: y(m.hi), stroke: "#2b2a27", "stroke-width": 2 }));
    [m.lo, m.hi].forEach(v => svgEl.append(svg("line", { x1: x + bw / 2 - 8, x2: x + bw / 2 + 8, y1: y(v), y2: y(v), stroke: "#2b2a27", "stroke-width": 2 })));
    svgEl.append(svg("text", { x: x + bw / 2, y: H - 9, "text-anchor": "middle", class: "lbl" }, name), svg("text", { x: x + bw / 2 + 14, y: y(m.hi) - 5, "text-anchor": "start" }, pct(m.rate)));
  });
  clear(host).append(svgEl, el("div", { class: "legend" }, el("span", {}, el("i", { style: `background:${DRC.coin}` }), "50% = coin flip (dashed). Bars start at 50%.")));
}

function drLines(host, points, { band = null, emptyMsg = "Not enough data for this window." } = {}) {
  if (!points.length) { clear(host).append(el("p", { class: "muted" }, emptyMsg)); return; }
  const W = 600, H = 230, L = 40, B = 20, T = 10;
  const vals = points.flatMap(p => [p.direct, p.reverse]);
  let lo = Math.min(0.5, ...vals), hi = Math.max(0.5, ...vals);
  if (band) { lo = Math.min(lo, 0.5 - band); hi = Math.max(hi, 0.5 + band); }
  const pad = Math.max(0.01, (hi - lo) * 0.12); lo -= pad; hi += pad;
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo)), n = points.length, x = i => L + (W - L) * (n === 1 ? 0.5 : i / (n - 1));
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img" });
  if (band) s.append(svg("rect", { x: L, y: y(0.5 + band), width: W - L, height: y(0.5 - band) - y(0.5 + band), fill: DRC.coin, opacity: 0.13 }));
  [lo + pad, 0.5, hi - pad].forEach(v => s.append(svg("line", { x1: L, x2: W, y1: y(v), y2: y(v), stroke: v === 0.5 ? DRC.coin : "#ddd5c4", "stroke-dasharray": v === 0.5 ? "5 4" : "" }), svg("text", { x: 2, y: y(v) + 3 }, pct(v))));
  [["direct", "Direct"], ["reverse", "Reverse"]].forEach(([k]) => s.append(svg("polyline", { fill: "none", stroke: DRC[k], "stroke-width": 2, points: points.map((p, i) => `${x(i)},${y(p[k])}`).join(" ") })));
  clear(host).append(s, el("div", { class: "legend" }, el("span", {}, el("i", { style: `background:${DRC.direct}` }), "Direct"), el("span", {}, el("i", { style: `background:${DRC.reverse}` }), "Reverse"),
    el("span", {}, `x-axis: rounds tested, ${points[0].n} → ${points[n - 1].n}`)));
}

/* ---------------------------------------------------------------- cards */
function drSummary(d) {
  const s = d.summary, r = d.range, t = s.test;
  const row = (label, f) => el("tr", {}, el("td", {}, label), el("td", {}, f(s.direct)), el("td", {}, f(s.reverse)));
  const sig = t.significant ? (s.direct.rate > 0.5 ? "dr-win" : "dr-lose") : "dr-flat";
  setBody($("#dr-sum"),
    drTable(["Metric", "Direct", "Reverse"], [
      row("Accuracy", m => el("b", {}, pct(m.rate))), row("Correct", m => m.correct), row("Incorrect", m => m.incorrect), row("Total tested", m => m.n),
      row("95% confidence interval", m => drCi(m))]),
    el("div", { class: "dr-verdict", "data-testid": "dr-verdict" }, el("b", { class: sig }, t.label), `. Direct ${pct(s.direct.rate)} vs a 50% coin flip: p = ${drP(t.p_two_sided)} (two-sided exact binomial). `,
      `Reverse − Direct = ${pp(s.difference_reverse_minus_direct)} points. `, "Big/Small has only two outcomes, so Reverse is always exactly 100% − Direct; reversal can only help if the model is reliably below 50%."),
    el("p", { class: "bar-note" }, `Rounds #${r.first_seq}–#${r.last_seq}${r.date_from ? ` · round-ID dates ${r.date_from} → ${r.date_to}` : ""} · source: ${d.source === "live" ? "live picks" : "walk-forward backtest (each round predicted from earlier rounds only)"}.`));
}

function drAlgo(d) {
  if (!d.algorithms || !d.algorithms.length) { setBody($("#dr-algo"), el("p", { class: "muted" }, "No algorithm detail.")); return; }
  const rows = d.algorithms.map(a => el("tr", {}, el("td", {}, a.algorithm.startsWith("Consensus") ? el("strong", {}, a.algorithm) : (DR_ALGO[a.algorithm] || a.algorithm)), el("td", {}, a.n),
    drCell(a.direct), drCell(a.reverse), el("td", {}, pct(a.big_share)), el("td", {}, drP(a.p_corrected)), el("td", {}, el("span", { class: a.significant ? "dr-lose" : "dr-flat" }, a.label))));
  setBody($("#dr-algo"), drTable(["Algorithm", "Tested", "Direct [95%]", "Reverse [95%]", "Picks Big", "p (Bonferroni)", "Verdict"], rows),
    el("p", { class: "bar-note" }, `p-values are corrected for the ${d.algorithms.length} algorithms compared: with that many looks, one will land a few points off 50% by luck alone.` + (d.note ? " " + d.note : "")));
}

function drSide(d) {
  const rows = ["Big", "Small"].map(k => { const x = d.by_side[k]; return el("tr", {}, el("td", {}, `Pick = ${k}`), el("td", {}, x.picks), drCell(x.direct), drCell(x.reverse)); });
  const pb = d.pick_bias || {};
  setBody($("#dr-side"), drTable(["When the model said", "Picks", "Direct", "Reverse"], rows),
    el("p", { class: "bar-note" }, `Model picks Big ${pct(pb.model_big_share)} of the time (p = ${drP(pb.model_big_p)}); the actual result was Big ${pct(pb.actual_big_share)} (p = ${drP(pb.actual_big_p)}). A fair game is 50 / 50.`));
}

function drBlocks(d) {
  if (!d.blocks.length) { setBody($("#dr-blocks"), el("p", { class: "muted" }, "Range too short to split into blocks.")); return; }
  const rows = d.blocks.map(b => el("tr", {}, el("td", {}, `#${b.from_seq}–#${b.to_seq}`), el("td", {}, b.direct.n), drCell(b.direct), el("td", {}, pct(b.reverse.rate))));
  setBody($("#dr-blocks"), drTable(["Rounds", "Tested", "Direct [95%]", "Reverse"], rows),
    el("p", { class: "bar-note" }, d.drift ? `Drift test (same accuracy in every block?): p = ${drP(d.drift.p)} — ${d.drift.label}.` : ""));
}

function drValidation(d) {
  const h = d.holdout, a = d.adaptive, kids = [];
  if (h && h.available) {
    kids.push(el("h3", {}, "Chronological holdout (60% choose · 40% unseen test)"), drTable(["", "Rounds", "Direct", "Reverse"], [
      el("tr", {}, el("td", {}, "Selection period"), el("td", {}, `#${h.train.from_seq}–#${h.train.to_seq}`), drCell(h.train.direct), drCell(h.train.reverse)),
      el("tr", {}, el("td", {}, "Unseen test period"), el("td", {}, `#${h.test.from_seq}–#${h.test.to_seq}`), drCell(h.test.direct), drCell(h.test.reverse))]),
      el("p", { class: "bar-note" }, `Strategy chosen on the selection period: ${h.chosen_on_train.toUpperCase()}. Its accuracy on the unseen period: ${pct(h.chosen_strategy_on_test.rate)} [${drCi(h.chosen_strategy_on_test)}] — ${h.verdict_on_test.label} (p = ${drP(h.verdict_on_test.p_two_sided)}).`));
    const b = h.best_algorithm_pick;
    if (b) kids.push(el("p", { class: "bar-note" }, `Cherry-pick test: the best of ${b.candidates_searched} (algorithm × direction) options on the selection period was ${DR_ALGO[b.algorithm] || b.algorithm} ${b.direction.toUpperCase()} (${pct(b.train_accuracy)} there). On unseen rounds it scored ${pct(b.test.rate)} [${drCi(b.test)}] — ${b.verdict_on_test.label}.`));
  } else kids.push(el("p", { class: "muted" }, (h && h.note) || "Not enough data for a holdout."));
  if (a) kids.push(el("h3", {}, "Best Historically Validated strategy (no look-ahead)"), el("p", { class: "bar-note" },
    `Rule: each round, look only at the last ${a.window} already-resolved rounds; reverse only if direct accuracy there is below 50% by more than ${a.z} standard errors, otherwise stay direct. Result over the range: ${pct(a.result.rate)} [${drCi(a.result)}] (${a.result.correct} ✓ / ${a.result.incorrect} ✗), reverse mode used on ${pct(a.reverse_share)} of rounds, ${a.switches} switches — ${a.verdict.label}.`));
  setBody($("#dr-val"), ...kids);
}

function drDiag(d) {
  const c = d.correlation || {}, p = d.predictability || {}, r = d.reachability || {}, kids = [];
  kids.push(el("dl", { class: "kv" },
    el("dt", {}, "Pick ↔ outcome correlation (phi)"), el("dd", {}, c.phi == null ? "—" : `${c.phi.toFixed(4)} (p = ${drP(c.p)}) · ${c.label || ""}`),
    el("dt", {}, "Runs test on actual Big/Small"), el("dd", {}, p.runs ? `z = ${p.runs.z.toFixed(2)} (p = ${drP(p.runs.p)})` : "—"),
    el("dt", {}, "Autocorrelation lag 1 / 2 / 3"), el("dd", {}, (p.autocorrelation || []).map(x => `${x.r.toFixed(3)} (p ${drP(x.p)})`).join(" · ") || "—"),
    el("dt", {}, "Next side depends on previous 1 / 2 / 3?"), el("dd", {}, (p.markov || []).map(x => `order ${x.order}: p = ${drP(x.p)}`).join(" · ") || "—"),
    el("dt", {}, `Chance a coin reaches ${pct(r.target)} on ${r.n || 0} rounds`), el("dd", {}, r.n ? `z = ${r.z_score_of_target.toFixed(1)} → p ≈ ${r.p_by_luck_alone.toExponential(1)}; a coin lands within ${pct(r.random_95pct_range[0])}–${pct(r.random_95pct_range[1])} 95% of the time` : "—"),
    el("dt", {}, "Rounds needed to detect a +1 point edge"), el("dd", {}, d.rounds_needed_to_detect_1pt_edge)));
  const q = d.data_quality || {};
  kids.push(el("p", { class: "bar-note" }, `Data quality: ${q.predictions_tested} predictions tested · ${q.duplicate_target_rounds} duplicate targets · ${q.missing_sequence_numbers_in_range} missing sequence numbers in range` +
    (q.stored_rounds != null ? ` · ${q.stored_rounds} stored rounds, ${q.duplicate_period_ids} duplicate period IDs, ${q.rounds_without_period_id} without a period ID, ${q.period_id_jumps} jumps in period IDs (skipped rounds in the source).` : ".")));
  setBody($("#dr-diag"), ...kids);
}

function renderDR(d) {
  DR.data = d;
  if (!d.available) {
    ["#dr-sum"].forEach(id => setBody($(id), el("p", { class: "muted" }, d.reason || "No data."), typeof runBtn === "function" ? runBtn() : null));
    ["#dr-bars", "#dr-cum", "#dr-roll", "#dr-algo", "#dr-side", "#dr-blocks", "#dr-val", "#dr-diag"].forEach(id => setBody($(id), el("p", { class: "muted" }, "—")));
    return;
  }
  drSummary(d);
  const barHost = el("div"); setBody($("#dr-bars"), barHost); drBars(barHost, d.summary);
  const cumHost = el("div"); setBody($("#dr-cum"), cumHost); drLines(cumHost, d.cumulative);
  const rollHost = el("div"); setBody($("#dr-roll"), rollHost);
  drLines(rollHost, d.rolling.points, { band: 1.96 * Math.sqrt(0.25 / d.rolling.window), emptyMsg: `Fewer than ${d.rolling.window} rounds in this range.` });
  drAlgo(d); drSide(d); drBlocks(d); drValidation(d); drDiag(d);
  if (!DR.from && !DR.to && d.range.date_from) { $("#dr-from").min = $("#dr-to").min = d.range.date_from; $("#dr-from").max = $("#dr-to").max = d.range.date_to; }
}

async function loadDR() {
  try { renderDR(await api(drQuery())); }
  catch (e) { setBody($("#dr-sum"), el("p", { class: "muted" }, "Could not load: " + e.message)); }
}

async function drShowPick() {
  const strat = (document.querySelector('input[name="dr-strat"]:checked') || {}).value || "direct", box = $("#dr-pick");
  box.textContent = "loading…";
  try {
    const p = await api("/api/prediction/strategy?strategy=" + encodeURIComponent(strat));
    if (!p.available) { box.textContent = p.reason || "No estimate available yet."; return; }
    const sel = p.selection;
    box.textContent = `Round ${p.target_period || "#" + p.target_seq}: ${p.final_pick.toUpperCase()}  (model said ${p.original_pick}; mode ${p.strategy}${p.strategy === "best" ? ` → used ${p.strategy_used}` : ""}). ` +
      (sel ? `Reason: ${sel.reason}. ` : "") + p.warning;
  } catch (e) { box.textContent = "Could not load: " + e.message; }
}

function bindDR() {
  if (DR.bound || typeof document === "undefined" || !$("#dr-apply")) return;
  DR.bound = true;
  $("#dr-apply").onclick = () => { DR.from = $("#dr-from").value; DR.to = $("#dr-to").value; DR.source = $("#dr-source").value; DR.win = Number($("#dr-win").value); loadDR(); };
  $("#dr-reset").onclick = () => { DR.from = DR.to = ""; $("#dr-from").value = $("#dr-to").value = ""; DR.source = $("#dr-source").value; DR.win = Number($("#dr-win").value); loadDR(); };
  $("#dr-source").onchange = $("#dr-win").onchange = $("#dr-apply").onclick;
  $("#dr-getpick").onclick = drShowPick;
}
if (typeof module !== "undefined" && module.exports) module.exports = { drQuery, DR, drCls };
