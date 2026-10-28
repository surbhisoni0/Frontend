"use strict";
/* WinGo Analysis Platform - dashboard. All API text is rendered with textContent (never innerHTML). */
const $ = (s, r = document) => r.querySelector(s);
const NS = "http://www.w3.org/2000/svg";
const NAMES = { CumFreq: "Frequency", Recent50: "Recent pattern (50)", Markov1: "Transition (order 1)", Markov2: "Transition (order 2)",
  LogReg: "ML · Logistic regression", RandForest: "ML · Random forest", HistGB: "ML · Gradient boosting", Consensus: "Ensemble (unweighted consensus)" };
const METRICS = [["bs", "Big / Small"], ["color", "Colour"], ["top1", "Number (Top-1)"], ["top3", "Number (Top-3)"]];
const LINE_COLORS = { top1: "#2dd4bf", top3: "#5aa2ff", bs: "#f5b84b", color: "#b58cff" };
const COLOR_DETAIL = ["red+violet", "green", "red", "green", "red", "green+violet", "red", "green", "red", "green"];

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) e[k] = v; else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
function svg(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}
const ballClass = n => (n === 0 ? "rv" : n === 5 ? "gv" : [1, 3, 7, 9].includes(n) ? "g" : "r");
const ball = (n, cls = "") => el("span", { class: `ball ${ballClass(n)} ${cls}`.trim(), title: `${n} · ${COLOR_DETAIL[n]} · ${n >= 5 ? "Big" : "Small"}` }, n);
const pct = x => (x == null ? "—" : (100 * x).toFixed(1) + "%");
const pp = x => (x >= 0 ? "+" : "") + (100 * x).toFixed(1);
const clear = e => { e.replaceChildren(); return e; };
const setBody = (card, ...kids) => { const h = card.querySelector("h2"); card.replaceChildren(h, ...kids.flat().filter(k => k != null)); };

let API_KEY = () => $("#key").value.trim();
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.method === "POST" && API_KEY()) headers["X-API-Key"] = API_KEY();
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 60000);
  let r;
  try { r = await fetch(path, { ...opts, headers, signal: ctl.signal, cache: "no-store" }); }
  catch (e) { throw new Error(e && e.name === "AbortError" ? "the server did not answer in time" : "network error"); }
  finally { clearTimeout(timer); }
  let body = null;
  try { body = await r.json(); } catch (_) { /* non-JSON */ }
  if (!r.ok) {
    const d = body && (body.error || body.detail);
    throw new Error(Array.isArray(d) ? d.map(x => x.msg).join("; ") : d || `HTTP ${r.status}`);
  }
  return body;
}

/* ---------------------------------------------------------------- charts */
function barChart(host, labels, values, { expected = null, fmt = pct, colors = null, max = null } = {}) {
  const W = 600, H = 220, L = 34, B = 26, T = 12, n = values.length;
  const top = max || Math.max(...values, expected || 0) * 1.18 || 1;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img" });
  const bw = (W - L) / n, y = v => T + (H - T - B) * (1 - v / top);
  [0, .5, 1].forEach(f => { s.append(svg("line", { x1: L, x2: W, y1: y(top * f), y2: y(top * f), stroke: "#1f2c4d" }), svg("text", { x: 2, y: y(top * f) + 3 }, fmt(top * f))); });
  values.forEach((v, i) => {
    s.append(svg("rect", { x: L + i * bw + bw * .18, y: y(v), width: bw * .64, height: Math.max(0, H - B - y(v)), rx: 4, fill: colors ? colors[i] : "#2dd4bf" }));
    s.append(svg("text", { x: L + i * bw + bw / 2, y: H - 9, "text-anchor": "middle", class: "lbl" }, labels[i]));
    s.append(svg("text", { x: L + i * bw + bw / 2, y: y(v) - 4, "text-anchor": "middle" }, fmt(v)));
  });
  if (expected != null) s.append(svg("line", { x1: L, x2: W, y1: y(expected), y2: y(expected), stroke: "#f5b84b", "stroke-dasharray": "5 4" }));
  clear(host).append(s);
}
function lineChart(host, series, emptyMsg) {
  const pts = series.flatMap(s => s.points);
  if (!pts.length) { clear(host).append(el("p", { class: "muted" }, emptyMsg)); return; }
  const W = 600, H = 230, L = 40, B = 20, T = 10, m = Math.max(0.02, ...pts.map(Math.abs)) * 1.15;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img" });
  const y = v => T + (H - T - B) * (1 - (v + m) / (2 * m));
  [-m, 0, m].forEach(v => s.append(svg("line", { x1: L, x2: W, y1: y(v), y2: y(v), stroke: v === 0 ? "#f5b84b" : "#1f2c4d", "stroke-dasharray": v === 0 ? "5 4" : "" }), svg("text", { x: 2, y: y(v) + 3 }, pp(v))));
  series.forEach(sr => {
    const n = sr.points.length, x = i => L + (W - L) * (n === 1 ? .5 : i / (n - 1));
    s.append(svg("polyline", { fill: "none", stroke: sr.color, "stroke-width": 2, points: sr.points.map((v, i) => `${x(i)},${y(v)}`).join(" ") }));
  });
  clear(host).append(s, el("div", { class: "legend" }, series.map(sr => el("span", {}, el("i", { style: `background:${sr.color}` }), sr.name)), el("span", {}, "y-axis: points above (+) or below (−) the random baseline")));
}

/* ---------------------------------------------------------------- period clock
   The SERVER decides which round is next and whether the schedule is verified (/api/clock). The browser only converts the
   server's absolute end-of-round timestamp into a countdown using a measured server-clock offset. It never advances a period
   number by itself: a round counts only once its result is confirmed by the server. */
const CLOCK = { data: null, samples: [], failures: 0, lastOkAt: null, reconcile: false, timer: null, built: null };
const fmtClock = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const fmtTs = v => { const t = Date.parse(v); return Number.isNaN(t) ? String(v) : new Date(t).toLocaleString(); };

/* offset of the server clock = the sample with the smallest round trip (least network-delay error) */
function pickOffset(samples) { return samples.length ? samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset : 0; }

/* Everything the UI shows about the countdown, derived from the server snapshot and a server-aligned "now" (ms).
   Never returns a negative time. 'open' -> 'awaiting_result' when the timer hits zero; the next round starts only when the server confirms. */
function localCountdown(clock, nowMs) {
  const c = clock && clock.countdown;
  if (!c) return { state: "no_data", remainingMs: null };
  if (c.state === "no_data" || c.state === "unverified") return { state: c.state, remainingMs: null, reason: c.reason };
  const end = Date.parse(c.round_ends_at);
  if (Number.isNaN(end)) return { state: "unverified", remainingMs: null, reason: "the server sent an invalid round end time" };
  const P = (c.period_seconds || (clock.schedule && clock.schedule.period_seconds) || 60) * 1000;
  if (c.state === "assumed") {                       // OPT-IN assumed schedule: rolls over every period by itself, never "verified"
    let left = end - nowMs;
    if (left <= 0) left += (Math.floor(-left / P) + 1) * P;
    return { state: "assumed", remainingMs: left };
  }
  const grace = ((clock.schedule && clock.schedule.late_grace_seconds) || 20) * 1000;
  const left = end - nowMs;
  if (left > 0) return { state: "open", remainingMs: left };
  const overdue = -left, ended = 1 + Math.floor(overdue / P);       // rounds finished since the last CONFIRMED one
  return { state: ended === 1 && overdue <= grace ? "awaiting_result" : "late", remainingMs: 0, overdueMs: overdue, ended };
}

/* when to ask the server again (ms): quickly while a result is expected, right after a boundary, backing off on errors */
function pollDelay({ failures, local, pollMs }) {
  if (failures > 0) return Math.min(30000, 2000 * 2 ** (failures - 1));
  if (local.state === "awaiting_result") return 3000;
  if (local.state === "open") return Math.max(1000, Math.min(pollMs, local.remainingMs + 1500));
  return pollMs;
}

const clockKey = d => (d && d.latest_confirmed ? `${d.latest_confirmed.seq}|${d.next_round ? d.next_round.label : "-"}` : "none");

async function fetchClock() {
  const t0 = Date.now();
  try {
    const d = await api("/api/clock", { timeoutMs: 8000 }), t1 = Date.now();
    CLOCK.samples = [...CLOCK.samples.slice(-5), { rtt: t1 - t0, offset: d.server_epoch_ms - (t0 + t1) / 2 }];
    CLOCK.data = d; CLOCK.failures = 0; CLOCK.lastOkAt = t1;
    return d;
  } catch (e) { CLOCK.failures += 1; throw e; }
}

function clockView(now = Date.now()) {
  const d = CLOCK.data, off = CLOCK.failures >= 3 || (typeof navigator !== "undefined" && navigator.onLine === false);
  if (!d) return CLOCK.failures
    ? { badge: off ? "Disconnected" : "Reconnecting…", cls: "bad", big: "--:--", note: "Cannot reach the server. Retrying automatically." }
    : { badge: "Connecting…", cls: "wait", big: "--:--", note: "Waiting for the server. A sleeping server can take up to a minute to wake up." };
  const lbl = d.next_round ? d.next_round.label : "—", loc = localCountdown(d, now + pickOffset(CLOCK.samples));
  const stale = CLOCK.failures > 0 ? ` Offline since ${new Date(CLOCK.lastOkAt).toLocaleTimeString()}: whether a newer result exists is unknown.` : "";
  const conn = CLOCK.failures > 0 ? { badge: off ? "Disconnected" : "Reconnecting…", cls: "bad" } : null;
  const v = {
    open: { badge: "Round open", cls: "ok", big: fmtClock(loc.remainingMs), note: `Timer to the end of round ${lbl}. A round only counts once its result is confirmed.` },
    awaiting_result: { badge: "Awaiting result", cls: "warn", big: "00:00", note: `Timer reached zero. The verified result of round ${lbl} is not confirmed yet.` },
    late: { badge: "Result overdue", cls: "warn", big: "00:00", note: `The result of round ${lbl} is ${fmtAge(Math.round((loc.overdueMs || 0) / 1000))} overdue; ${loc.ended} round(s) have ended since the last confirmed result. Period numbers do not advance until results are confirmed.` },
    assumed: { badge: "Assumed schedule", cls: "warn", big: fmtClock(loc.remainingMs), note: "NOT VERIFIED: this timer counts to every full minute on the clock, not to your data source. It may not match the game's own timer. Connect a live source (SYNC_* in .env) to verify it." },
    unverified: { badge: "Timing unverified", cls: "mut", big: "--:--", note: `No countdown: ${loc.reason || (d.schedule && d.schedule.reason) || "the schedule could not be verified"}` },
    no_data: { badge: "No data", cls: "mut", big: "--:--", note: "No confirmed results are stored yet." },
  }[loc.state];
  return conn ? { ...v, ...conn, note: v.note + stale } : v;
}

function renderClock() {
  const d = CLOCK.data, card = $("#clock"); if (!card) return;
  if (!d) { tick(); return; }
  const lc = d.latest_confirmed, nr = d.next_round, sc = d.schedule || {};
  const fact = (k, ...v) => el("div", { class: "fact" }, el("span", {}, k), el("div", {}, ...v));
  const schedLine = sc.verified
    ? `Schedule verified from the last ${sc.samples} consecutive rounds (timing spread ${sc.spread_seconds}s${sc.outliers ? `, ${sc.outliers} off-schedule timestamp(s) ignored` : ""}). Timestamps are read as ${sc.time_means === "end" ? "draw times" : "round start times"} in ${sc.source_tz}. The countdown follows your data source's timestamps, not the official site's clock.`
    : `Schedule not verified: ${sc.reason || "unknown"}`;
  setBody(card,
    el("div", { class: "facts" },
      fact("Latest verified result", lc ? [el("b", {}, lc.period_id || "#" + lc.seq), " ", numPill(lc.number)] : "—",
        lc && lc.timestamp ? el("div", { class: "bar-note" }, fmtTs(lc.timestamp)) : null),
      fact("Next round", el("b", {}, nr ? nr.label : "—"), nr && nr.id_kind === "sequence" ? el("div", { class: "bar-note" }, "row number: the stored data has no period IDs") : null),
      fact("Time left", el("div", { class: "cd", id: "cd-big", role: "timer" }, "--:--"))),
    el("p", { class: "bar-note", id: "cd-note", "aria-live": "polite" }, ""),
    el("p", { class: "bar-note" }, schedLine));
  tick();
}

function tick() {
  const v = clockView(), set = (id, txt) => { const n = document.getElementById(id); if (n && n.textContent !== txt) n.textContent = txt; };
  set("cd-big", v.big); set("cd-note", v.note);
  const b = document.getElementById("cd-badge"); if (b) { b.textContent = v.badge; b.className = `badge ${v.cls}`; }
  updateEstimateNote();
  const u = document.getElementById("updated");
  if (u && CLOCK.lastOkAt) u.textContent = `${CLOCK.failures ? "Last updated" : "Updated"} ${new Date(CLOCK.lastOkAt).toLocaleTimeString()}`;
}

async function pollOnce() {
  if (document.hidden) return;                                        // resumes on visibilitychange
  try {
    const d = await fetchClock();
    if (CLOCK.reconcile || (lastSeen !== null && clockKey(d) !== lastSeen)) await refreshAll();   // new result, or we were offline: re-read everything
    else { renderClock(); }
  } catch (e) {
    CLOCK.reconcile = true; tick();
    showConn("bad", CLOCK.failures >= 3 ? "Disconnected from the server. Showing the last data received; retrying automatically." : "Connection problem. Retrying…");
  }
  schedulePoll();
}
function schedulePoll() {
  clearTimeout(CLOCK.timer);
  if (document.hidden) return;
  const loc = localCountdown(CLOCK.data, Date.now() + pickOffset(CLOCK.samples));
  CLOCK.timer = setTimeout(pollOnce, pollDelay({ failures: CLOCK.failures, local: loc, pollMs }));
}
function wakeUp() { clearTimeout(CLOCK.timer); CLOCK.reconcile = true; pollOnce(); }     // tab shown again / network back: reconcile now

/* ---------------------------------------------------------------- dashboard (colour-first) */
let perfCache = null;
const GROUPS = ["Green", "Red", "Violet"], GROUP_OF = [2, 0, 1, 0, 1, 2, 1, 0, 1, 0];   // same mapping as the backend (index = number)
const GROUP = n => GROUPS[GROUP_OF[n]];
const DOT = n => (n === 0 ? "rv" : n === 5 ? "gv" : GROUP(n).toLowerCase());
const dot = n => el("span", { class: `dot ${DOT(n)}`, title: `${n} · ${COLOR_DETAIL[n]} · ${n >= 5 ? "Big" : "Small"}` });
const groupDot = g => el("span", { class: `dot ${g.toLowerCase()}` });
const pill = (g, text) => el("span", { class: "pill" }, groupDot(g), text || g);
function signalBadge(sig) { return el("span", { class: `sig ${sig.level}` }, sig.label); }
function meter(label, value, cls, note) {
  const w = value == null ? 0 : Math.max(0, Math.min(100, value * 100));
  return el("div", { class: "meter" }, el("div", { class: "mlabel" }, el("span", {}, label), el("b", {}, pct(value))),
    el("div", { class: "track" }, el("i", { class: cls || "", style: `width:${w}%` })), note ? el("div", { class: "bar-note" }, note) : null);
}
function pickFromScores(sc) {
  const t = [0, 0, 0]; sc.forEach((v, n) => { t[GROUP_OF[n]] += v; });
  return GROUPS[t.indexOf(Math.max(...t))];
}

const SIZES = ["Small", "Big"];
const sizeOf = n => (n >= 5 ? "Big" : "Small");
const chip = n => el("span", { class: `chip ${sizeOf(n).toLowerCase()}`, title: `${n} · ${COLOR_DETAIL[n]} · ${sizeOf(n)}` }, String(n));
const sizeChip = sz => el("span", { class: `chip wide ${sz.toLowerCase()}` }, sz);
function pickSize(sc) { let sm = 0, bg = 0; sc.forEach((v, n) => { if (n >= 5) bg += v; else sm += v; }); return bg > sm ? "Big" : "Small"; }

/* The "round ended" notice is driven by the LIVE clock (tick), not by the moment this card was last rendered, so the estimate
   can never look current after its round has finished. It only speaks about the round this estimate is bound to. */
function estimateNote(p) {
  const kind = p.target_id_kind === "sequence"
    ? el("p", { class: "bar-note" }, "The stored data has no period IDs, so this is a row number (#…), not an official period.") : null;
  return [el("div", { id: "est-note", class: "nosig", hidden: true, "data-target": p.target_label }), kind];
}
/* Assumed schedule only: results do not arrive by themselves, so when the assumed minute rolls over the estimate stays frozen.
   `track` remembers when the page first saw this estimate and the end of the assumed round it was seen in. */
let EST_TRACK = { label: null, end: null };
function assumedNote(track, label, nowMs, remainingMs) {
  const t = track.label === label ? track : { label, end: nowMs + remainingMs };
  const rolled = nowMs >= t.end;
  return { track: t, msg: rolled ? `A new minute has started, but the result of round ${label} has not been added. This Big/Small estimate is frozen and changes only after that result arrives (live sync, or the Add rounds tab).` : "" };
}
function updateEstimateNote() {
  const n = document.getElementById("est-note"), d = CLOCK.data; if (!n) return;
  const lbl = n.dataset.target; let msg = "";
  if (d && d.next_round && d.next_round.label === lbl) {
    const st = localCountdown(d, Date.now() + pickOffset(CLOCK.samples)).state;
    if (st === "assumed") { const loc = localCountdown(d, Date.now() + pickOffset(CLOCK.samples)), r = assumedNote(EST_TRACK, lbl, Date.now() + pickOffset(CLOCK.samples), loc.remainingMs); EST_TRACK = r.track; msg = r.msg; }
    else if (st === "awaiting_result" || st === "late") msg = `Round ${lbl} has ended and its verified result is not confirmed yet. This estimate is frozen and will be scored against that result, never replaced.`;
    else if (st === "unverified") msg = "Round timing is not verified, so this page cannot tell whether this round is still open.";
  }
  n.hidden = !msg; if (n.textContent !== msg) n.textContent = msg;
}

function renderNext(p, perf, stats) {
  const pick = $("#pick"), reality = $("#reality"), models = $("#models");
  if (!p.available) { [pick, reality, models].forEach(c => setBody(c, el("p", { class: "muted" }, p.reason))); return; }
  const sig = p.signal, none = sig.level === "none", bt = perf && perf.backtest, c = bt && bt.consensus.bs;
  setBody(pick,
    el("div", { class: "pickrow" }, el("span", { class: `orb size ${p.size.toLowerCase()} ${none ? "dim" : ""}` }, p.size.toUpperCase()),
      el("div", {}, el("div", { class: "pickname" }, p.size), el("div", { class: "muted" }, `estimate for round ${p.target_label} · Big = 5–9, Small = 0–4`),
        el("div", { style: "margin-top:8px" }, signalBadge(sig)))),
    estimateNote(p),
    p.size_probs ? el("div", {}, el("div", { class: "bar-note" }, "Estimated chance (an uncertain estimate, not a validated forecast):"),
      SIZES.map(g => meter(g, p.size_probs[g], g.toLowerCase()))) : null,
    el("p", { class: "bar-note" }, `Model v${p.engine_version} · trained on ${p.n_history} rounds · built after confirmed round ${p.latest_result ? (p.latest_result.period_id || "#" + p.latest_result.seq) : "—"} · status: ${p.status === "pending" ? "waiting for result" : p.status}${p.created_at ? " · generated " + fmtTs(p.created_at) : ""}`),
    none ? el("div", { class: "nosig" }, el("strong", {}, "No proven edge. "), "On rounds it had not seen, this pick did no better than flipping a coin.") : null,
    el("details", {}, el("summary", { class: "muted" }, "Why this label?"),
      el("ul", { class: "muted" }, (sig.reasons.length ? sig.reasons : ["Evidence rules satisfied — see the Accuracy tab."]).map(r => el("li", {}, r)),
        sig.validated_on ? el("li", {}, `Tested on ${sig.validated_on.data_n} rounds (${sig.validated_on.run_at}).`) : null)),
    el("p", { class: "bar-note" }, p.disclaimer));
  const live = perf && perf.live.metrics.bs;
  setBody(reality,
    meter(c ? `Measured on ${c.n} unseen rounds` : "Measured", c && c.rate, "", c ? `95% range ${pct(c.lo)} – ${pct(c.hi)}` : "No test yet — open the Accuracy tab and run the walk-forward test."),
    meter("Coin flip (always Big, or always Small)", 0.5, "b", "what you get with no information at all"),
    live && live.n ? meter(`Live picks (${live.n})`, live.rate, "", live.n < 100 ? "fewer than 100 — too few to mean anything" : null) : null,
    c ? el("div", { class: "verdict" }, `${pct(c.rate)} measured. ${c.hi < 0.8 ? "80% is far outside that range. " : ""}${stats && stats.interpretation ? stats.interpretation : ""}`) : null);
  const rows = Object.entries(p.model_scores).map(([k, sc]) => el("tr", {}, el("td", {}, NAMES[k] || k), el("td", {}, sizeChip(pickSize(sc))),
    el("td", {}, bt && bt.models[k] ? pct(bt.models[k].bs.rate) : "—")));
  rows.push(el("tr", {}, el("td", {}, el("strong", {}, NAMES.Consensus)), el("td", {}, sizeChip(p.size)), el("td", {}, c ? pct(c.rate) : "—")));
  setBody(models, el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Model"), el("th", {}, "Picks"), el("th", {}, "Past accuracy"))), el("tbody", {}, rows))),
    el("p", { class: "bar-note" }, "Past accuracy is on unseen rounds. A coin flip scores 50%."));
  if (stats && stats.big_share != null) setBody($("#mix"), meter("Small", 1 - stats.big_share, "small", "expected 50%"), meter("Big", stats.big_share, "big", "expected 50%"));
}

const SYNC_TEXT = { ok: "Connected and up to date", stale: "Connected, but no new data for a while", error: "Cannot read the data source",
  disabled: "Automatic sync is off", not_configured: "No data source configured", needs_anchor: "Needs a starting round ID",
  gap_blocked: "Paused: rounds are missing", rejected: "Data rejected by validation", starting: "Starting…" };
const fmtAge = sec => (sec < 90 ? `${sec} s` : sec < 5400 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`);
const numPill = n => el("span", { class: "pill" }, chip(n), `${n} · ${sizeOf(n)}`);
function showConn(kind, text) { const c = $("#conn"); c.className = `conn ${kind}`; c.textContent = text; c.hidden = false; }
function hideConn() { $("#conn").hidden = true; }
function stateBanner(st) {
  const warn = ["stale", "error", "gap_blocked", "needs_anchor", "rejected"];
  if (st && st.enabled && warn.includes(st.state)) showConn("warn", `${SYNC_TEXT[st.state]}${st.last_error ? ": " + st.last_error : ""}`);
  else hideConn();
}
async function syncNow() {
  try { await api("/api/sync/run", { method: "POST" }); } catch (e) { showConn("warn", e.message); return; }
  refreshAll();
}
function renderSync(st, latest) {
  const lc = st.latest_confirmed, age = st.seconds_since_success;
  const rows = [["Status", SYNC_TEXT[st.state] || st.state], ["Latest confirmed round", lc ? (lc.period_id || "#" + lc.seq) : "—"],
    ["Latest actual result", latest ? numPill(latest.number) : "—"], ["Next expected round", st.expected_next_round || "—"],
    ["Last successful sync", age == null ? "never" : `${fmtAge(age)} ago`], ["Rounds synced so far", String(st.ingested_total)]];
  setBody($("#sync"), el("dl", { class: "kv" }, rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
    st.last_error ? el("div", { class: "verdict" }, st.last_error) : null,
    st.enabled ? el("button", { class: "btn ghost", type: "button", onclick: syncNow }, "Sync now")
      : el("p", { class: "bar-note" }, "Automatic sync is off. Add rounds by hand on the Add rounds tab, or configure an authorized source in backend/.env (see README)."));
}

function renderSizeEval(bt) {
  const card = $("#sizeeval"), e = bt && bt.size_eval;
  if (!e) { setBody(card, el("p", { class: "muted" }, "Not computed yet. Press “Re-run validation on all stored data” in the box above.")); return; }
  const k = (label, value, note) => el("div", { class: "kpi" }, el("span", {}, label), el("b", {}, value), el("i", {}, note));
  const table = (head, rows) => el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, head.map(h => el("th", {}, h)))),
    el("tbody", {}, rows.map(r => el("tr", {}, r.map(c => el("td", {}, c)))))));
  const skill = e.brier_skill;
  setBody(card,
    el("div", { class: "kpis" }, k("Accuracy", pct(e.accuracy), `coin flip: 50% · ${e.n} unseen rounds`),
      k("Brier score", e.brier.toFixed(4), `fair coin: ${e.brier_prior.toFixed(4)}`),
      k("Brier skill", (skill * 100).toFixed(2) + "%", skill > 0 ? "better than a coin" : "not better than a coin"),
      k("Calibration error", pct(e.ece), "average gap between confidence and hit rate")),
    el("p", { class: "bar-note" }, "Skill below 0% means the stated chances were worse than simply saying 50 / 50."),
    el("h3", {}, "Per class"), table(["Class", "Precision", "Recall", "Rounds"], e.classes.map((c, i) => [c, pct(e.precision[i]), pct(e.recall[i]), String(e.support[i])])),
    el("h3", {}, "Confusion matrix (rows = actual, columns = picked)"), table(["", ...e.classes], e.confusion.map((r, i) => [e.classes[i], ...r.map(String)])),
    el("h3", {}, "Calibration (lowest to highest confidence)"), table(["Rounds", "Average confidence", "Actually correct"], e.calibration.map(b => [String(b.n), pct(b.mean_confidence), pct(b.observed_accuracy)])));
}

let lastSeen = null, lastLatest = null, pollMs = 10000;
async function loadDash() {
  try {
    const [p, r, perf, stats, sync, clk] = await Promise.all([api("/api/prediction/next"), api("/api/results?limit=40"), api("/api/model-performance"),
      api("/api/data/stats").catch(() => null), api("/api/sync/status").catch(() => null), fetchClock()]);
    perfCache = perf; renderNext(p, perf, stats); lastLatest = r.results[0] || null;
    lastSeen = clockKey(clk); CLOCK.reconcile = false;
    if (sync) { renderSync(sync, lastLatest); stateBanner(sync); } else hideConn();
    renderClock();
    clear($("#strip")).append(...r.results.slice().reverse().map(x => chip(x.number)));
    loadStats().catch(() => {});
    if ($("#tab-trends").classList.contains("on")) loadTrends().catch(() => {});      // new round arrived while this tab is open
  } catch (e) { CLOCK.reconcile = true; tick(); showConn("bad", `Cannot load data: ${e.message}. Showing the last data received.`); }
}
async function refreshAll() {
  const b = $("#refresh"); b.disabled = true; b.textContent = "Refreshing…";
  try { await Promise.all([loadStatus(), loadDash()]); } finally { b.disabled = false; b.textContent = "Refresh"; }
}
async function startPolling() {
  try { const h = await api("/api/health", { timeoutMs: 8000 }); pollMs = Math.max(10, h.poll_seconds || 10) * 1000; } catch (_) { /* keep default */ }
  setInterval(tick, 250);                                             // display only: no network, derived from timestamps
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wakeUp(); });
  window.addEventListener("online", wakeUp);
  window.addEventListener("offline", tick);
  schedulePoll();
}

function renderSizeAnalysis(c) {
  const tbl = (head, rows) => el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, head.map(h => el("th", {}, h)))),
    el("tbody", {}, rows.map(r => el("tr", {}, r.map(x => el("td", {}, x)))))));
  const W = Object.values(c.windows);
  setBody($("#size-windows"), tbl(["Rounds", "Small", "Big", "p vs fair coin"],
    [["all " + c.n, ...c.overall_share.map(pct), "—"], ...W.map(w => ["last " + w.n, ...w.share.map(pct), w.p_vs_fair.toFixed(3)])]),
    el("p", { class: "bar-note" }, "A fair game gives Big 50% / Small 50%. A p-value under 0.05 is unusual, but with several windows checked one or two are expected by chance. A side that has been absent for a while is not “due”."));
  const t = c.transitions, st = c.streaks;
  setBody($("#size-trans"), tbl(["After ↓ / next →", ...c.classes], t.probabilities.map((row, i) => [c.classes[i], ...(row || [null, null]).map((v, j) => `${pct(v)} (${t.counts[i][j]})`)])),
    el("p", { class: "bar-note" }, t.p_independent == null ? "Not enough data for an independence test."
      : `Independence test p = ${t.p_independent.toFixed(3)} — ${t.p_independent < 0.05 ? "the next side may depend on the previous one; check it on new data before trusting it" : "no evidence that the next side depends on the previous one"}.`),
    el("p", { class: "bar-note" }, `Current streak: ${st.current.length} × ${st.current.colour}. Longest streaks: ${Object.entries(st.longest).map(([k, v]) => `${k} ${v}`).join(", ")}.`));
}

/* ---------------------------------------------------------------- history */
let histOffset = 0; const PAGE = 25;
async function loadHistory(reset) {
  if (reset) { histOffset = 0; clear($("#hist tbody")); }
  const h = await api(`/api/prediction/history?limit=${PAGE}&offset=${histOffset}`); histOffset += h.predictions.length;
  $("#hist tbody").append(...h.predictions.map(r => el("tr", {}, el("td", {}, r.round), el("td", {}, sizeChip(r.size)), el("td", { class: "muted" }, r.created_at ? fmtTs(r.created_at) : "—"),
    el("td", {}, r.actual == null ? "—" : el("span", { class: "pill" }, chip(r.actual), sizeOf(r.actual))),
    el("td", {}, r.actual == null ? el("span", { class: "pend" }, "PENDING") : r.bs_hit ? el("span", { class: "ok" }, "HIT ✓") : el("span", { class: "no" }, "MISS ✗")))));
  $("#more").style.display = histOffset >= h.total ? "none" : "";
}

/* ---------------------------------------------------------------- performance */
function kpi(label, m) {
  return el("div", { class: "kpi" }, el("span", {}, label), el("b", {}, pct(m.rate)),
    el("i", {}, m.n ? `baseline ${pct(m.baseline)} · 95% CI ${pct(m.lo)}–${pct(m.hi)}` : `baseline ${pct(m.baseline)}`));
}
function verdict(m) {
  const above = ["top1", "top3", "bs", "color"].filter(k => m[k].lo > m[k].baseline);
  return above.length ? el("span", { class: "pend" }, "nominal edge on " + above.join(", ") + " — check corrected p") : el("span", { class: "muted" }, "within noise of baseline");
}
function renderPerf(perf) {
  const live = perf.live;
  setBody($("#perf-live"), el("div", { class: "kpis" }, el("div", { class: "kpi" }, el("span", {}, "Total predictions"), el("b", {}, live.total_predictions), el("i", {}, live.note)),
    METRICS.map(([k, n]) => kpi(n, live.metrics[k]))), el("p", { class: "bar-note" }, `Current signal: ${perf.signal.label}. ${perf.signal.reasons[0] || ""}`));
  const bt = perf.backtest, card = $("#perf-bt");
  if (!bt) { setBody(card, el("p", { class: "muted" }, "No walk-forward validation stored yet."), runBtn()); return; }
  const rows = Object.entries(bt.models).map(([k, m]) => el("tr", {}, el("td", {}, k === "Consensus" ? el("strong", {}, NAMES[k]) : NAMES[k] || k),
    METRICS.map(([mk]) => el("td", {}, `${pct(m[mk].rate)} `, el("span", { class: "muted" }, `[${pct(m[mk].lo)}–${pct(m[mk].hi)}]`))), el("td", {}, m.top1.n), el("td", {}, verdict(m))));
  rows.unshift(el("tr", {}, el("td", {}, el("em", {}, "Random baseline")), METRICS.map(([mk]) => el("td", {}, pct(bt.baselines[mk]))), el("td", {}, "—"), el("td", {}, "reference")));
  setBody(card, el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Model"), METRICS.map(([, n]) => el("th", {}, n + " [95% CI]")), el("th", {}, "Predictions"), el("th", {}, "vs baseline"))), el("tbody", {}, rows))),
    el("p", { class: "bar-note" }, `Backtest on ${bt.data_n} stored rounds · ${bt.n_predictions} predictions · ${bt.K} model×metric tests (used for multiple-testing correction) · run ${bt.created_at}. Color baseline = best constant guess (40%).`), runBtn());
  const names = { top1: "Top-1", top3: "Top-3", bs: "Big/Small", color: "Color" };
  lineChart($("#chart-roll"), METRICS.map(([k]) => ({ name: names[k], color: LINE_COLORS[k], points: (bt.consensus_rolling[k] || []).map(v => v - bt.baselines[k]) })), "Not enough backtest data.");
  lineChart($("#chart-live"), METRICS.map(([k]) => ({ name: names[k], color: LINE_COLORS[k], points: live.series[k].map(p => p.rate - perf.baselines[k]) })), "No live predictions have been resolved yet. Add new results to build this.");
}
function runBtn() {
  const b = el("button", { class: "btn ghost", onclick: async () => {
    b.disabled = true; try { await api("/api/backtest/run", { method: "POST" }); b.textContent = "Running… (1–2 min)"; pollStatus(); } catch (e) { b.disabled = false; alert(e.message); } } }, "Re-run validation on all stored data");
  return b;
}
async function loadPerf() { perfCache = await api("/api/model-performance"); renderPerf(perfCache); renderSizeEval(perfCache.backtest); }

/* ---------------------------------------------------------------- analysis */
let statsCache = null;
function renderRecentFreq() {
  const a = statsCache; if (!a || !a.recent_frequency) return;
  const w = $("#win").value; barChart($("#chart-recent"), [...Array(10).keys()], a.recent_frequency[w], { expected: 0.1, colors: [...Array(10).keys()].map(barColor) });
}
const barColor = n => (n === 0 ? "#a45bd6" : n === 5 ? "#5cae8f" : [1, 3, 7, 9].includes(n) ? "#22a45d" : "#d63b3b");
async function loadAnalysis() {
  const a = statsCache = await api("/api/data/stats");
  if (!a.counts) { $("#tests").textContent = a.message; return; }
  barChart($("#chart-dist"), [...Array(10).keys()], a.frequency, { expected: 0.1, colors: [...Array(10).keys()].map(barColor) });
  renderRecentFreq();
  const bs = a.big_small; barChart($("#chart-bs"), ["Small (0-4)", "Big (5-9)"], [bs.Small / a.n, bs.Big / a.n], { expected: 0.5, colors: ["#5aa2ff", "#f5b84b"] });
  const cg = a.color_groups; barChart($("#chart-color"), ["Green", "Red", "Violet (0,5)"], [cg.Green / a.n, cg.Red / a.n, cg.Violet / a.n], { expected: null, colors: ["#22a45d", "#d63b3b", "#8b5cf6"] });
  setBody($("#tests").closest(".card"), el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Test"), el("th", {}, "p-value / value"), el("th", {}, "Reading"))),
    el("tbody", {}, Object.values(a.tests).map(t => el("tr", {}, el("td", {}, t.name), el("td", {}, t.p != null ? t.p.toFixed(3) : `${t.value.toFixed(3)} (±${t.band.toFixed(3)})`),
      el("td", {}, t.verdict || (t.within_band ? "consistent with random" : "unusual - verify data"), t.note ? el("div", { class: "muted", style: "font-size:11px" }, t.note) : null)))))),
    el("p", { class: "bar-note" }, a.interpretation), el("div", { id: "tests" }));
  if (a.size && a.size.windows) renderSizeAnalysis(a.size);
  const q = a.data_quality;
  clear($("#dq")).append(el("dl", { class: "kv" }, ...Object.entries({ "Total records": q.total, "Unique period IDs": q.unique_periods ?? "—", "Missing period IDs": q.missing_period ?? "—", "Missing timestamps": q.missing_timestamp ?? "—",
    "Duplicate periods": q.duplicate_periods ?? "—", "Chronological (by period)": q.chronological == null ? "cannot verify (no period IDs)" : q.chronological ? "yes" : "NO", "Longest same-number streak": a.max_same_number_streak }).flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])));
}

/* ---------------------------------------------------------------- trends (descriptive statistics of STORED results only)
   Everything below is computed in the browser from /api/results. Nothing is invented and nothing here predicts anything. */
function runsOf(keys) {                                   // keys oldest -> newest; returns columns of equal consecutive keys
  const cols = [];
  for (const k of keys) { const c = cols[cols.length - 1]; if (c && c.key === k) c.len += 1; else cols.push({ key: k, len: 1 }); }
  return cols;
}
function streakInfo(keys) {                               // current streak (at the newest end) and longest streak per key
  const cols = runsOf(keys), longest = {};
  cols.forEach(c => { longest[c.key] = Math.max(longest[c.key] || 0, c.len); });
  const cur = cols[cols.length - 1];
  return { current: cur ? { key: cur.key, len: cur.len } : null, longest };
}
/* rows: newest first, each {number}. Returns null when there is nothing to describe. */
function trendStats(rows) {
  const n = rows.length; if (!n) return null;
  const nums = rows.map(r => r.number), oldest = nums.slice().reverse();
  const freq = Array(10).fill(0), missing = Array(10).fill(null);
  nums.forEach((v, i) => { freq[v] += 1; if (missing[v] === null) missing[v] = i; });      // i = draws since it last appeared
  const count = f => nums.filter(f).length, big = count(v => v >= 5), odd = count(v => v % 2 === 1);
  const order = [...Array(10).keys()].sort((a, b) => freq[b] - freq[a] || a - b);
  const maxF = freq[order[0]], minF = freq[order[9]];
  return {
    n, freq, missing, big, small: n - big, odd, even: n - odd,
    green: count(v => v % 2 === 1), red: count(v => v % 2 === 0), violet: count(v => v === 0 || v === 5),
    hot: order.filter(v => freq[v] === maxF), cold: order.filter(v => freq[v] === minF),
    sizeStreak: streakInfo(oldest.map(v => (v >= 5 ? "Big" : "Small"))),
    parityStreak: streakInfo(oldest.map(v => (v % 2 === 1 ? "Odd" : "Even"))),
    colourStreak: streakInfo(oldest.map(v => (v % 2 === 1 ? "Green" : "Red"))),
    sizeRuns: runsOf(oldest.map(v => (v >= 5 ? "Big" : "Small"))),
    colourRuns: runsOf(oldest.map(v => (v % 2 === 1 ? "Green" : "Red"))),
  };
}

function trendChart(host, rowsNewestFirst) {
  const pts = rowsNewestFirst.slice(0, 40).reverse();
  if (!pts.length) { clear(host).append(el("p", { class: "muted" }, "No results stored yet.")); return; }
  const W = 600, H = 200, L = 24, B = 14, T = 10, n = pts.length, x = i => L + (W - L - 8) * (n === 1 ? .5 : i / (n - 1)), y = v => T + (H - T - B) * (1 - v / 9);
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": `Winning number over the last ${n} rounds` });
  [0, 5, 9].forEach(v => s.append(svg("line", { x1: L, x2: W, y1: y(v), y2: y(v), stroke: "#1f2c4d", "stroke-dasharray": v === 5 ? "4 4" : "" }), svg("text", { x: 4, y: y(v) + 3 }, String(v))));
  s.append(svg("polyline", { fill: "none", stroke: "#9a9486", "stroke-width": 1.5, points: pts.map((p, i) => `${x(i)},${y(p.number)}`).join(" ") }));
  pts.forEach((p, i) => { const c = svg("circle", { cx: x(i), cy: y(p.number), r: 4.5, fill: barColor(p.number) }); c.append(svg("title", {}, `${p.period_id || "#" + p.seq} · ${p.number} · ${sizeOf(p.number)}`)); s.append(c); });
  clear(host).append(s);
}

function roadmap(host, runs, colorOf) {
  if (!runs.length) { clear(host).append(el("p", { class: "muted" }, "No results stored yet.")); return; }
  clear(host).append(el("div", { class: "road" }, runs.map(c => el("div", { class: "rcol", title: `${c.key} × ${c.len}` },
    Array.from({ length: c.len }, () => el("i", { style: `background:${colorOf(c.key)}` }))))));
}

let trendWin = 100;
async function loadTrends() {
  const r = await api(`/api/results?limit=${trendWin}`), rows = r.results, t = trendStats(rows);
  const card = id => document.getElementById(id);
  if (!t) { ["tr-sum", "tr-trend", "tr-missing", "tr-pat", "tr-road", "tr-table"].forEach(id => setBody(card(id), el("p", { class: "muted" }, "No results stored yet."))); return; }
  const share = (a, b) => `${a} (${pct(a / t.n)}) · ${b} (${pct(b / t.n)})`;
  setBody(card("tr-sum"), el("dl", { class: "kv" },
    el("dt", {}, "Rounds in window"), el("dd", {}, `${t.n}${r.total > t.n ? ` of ${r.total} stored` : ""}`),
    el("dt", {}, "Big · Small"), el("dd", {}, share(t.big, t.small)), el("dt", {}, "Odd · Even"), el("dd", {}, share(t.odd, t.even)),
    el("dt", {}, "Green · Red · Violet"), el("dd", {}, `${t.green} · ${t.red} · ${t.violet} (0 and 5 also count as violet)`)),
    el("p", { class: "bar-note" }, "Descriptive counts only. In a fair game each side is expected near 50% over time; short-window swings are normal and do not predict the next round."));
  trendChart(card("tr-trend-chart"), rows);
  setBody(card("tr-missing"), el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, ["Number", "Seen", "Share", "Rounds since last seen"].map(h => el("th", {}, h)))),
    el("tbody", {}, [...Array(10).keys()].map(v => el("tr", {}, el("td", {}, ball(v, "sm")), el("td", {}, t.freq[v]), el("td", {}, pct(t.freq[v] / t.n)),
      el("td", {}, t.missing[v] === null ? `more than ${t.n}` : t.missing[v] === 0 ? "latest round" : t.missing[v]))))) ),
    el("p", { class: "bar-note" }, "A number that has been absent for a while is not “due”: every round is an independent draw."));
  const sk = (label, s) => [el("dt", {}, label), el("dd", {}, s.current ? `${s.current.len} × ${s.current.key} now · longest ${Object.entries(s.longest).map(([k, v]) => `${k} ${v}`).join(", ")}` : "—")];
  setBody(card("tr-pat"), el("dl", { class: "kv" }, sk("Big / Small streak", t.sizeStreak), sk("Odd / Even streak", t.parityStreak), sk("Green / Red streak", t.colourStreak),
    el("dt", {}, "Most frequent"), el("dd", {}, t.hot.join(", ")), el("dt", {}, "Least frequent"), el("dd", {}, t.cold.join(", "))),
    el("p", { class: "bar-note" }, "“Most / least frequent” describe this window only."));
  const sizeCol = k => (k === "Big" ? "#2f6f73" : "#b5812b"), colCol = k => (k === "Green" ? "#22a45d" : "#d63b3b");
  roadmap(card("tr-road-size"), t.sizeRuns.slice(-30), sizeCol); roadmap(card("tr-road-col"), t.colourRuns.slice(-30), colCol);
  setBody(card("tr-table"), el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, ["Round", "Number", "Big / Small", "Colour", "Time"].map(h => el("th", {}, h)))),
    el("tbody", {}, rows.slice(0, 20).map(x => el("tr", {}, el("td", {}, x.period_id || "#" + x.seq), el("td", {}, ball(x.number, "sm")), el("td", {}, sizeChip(sizeOf(x.number))),
      el("td", {}, COLOR_DETAIL[x.number]), el("td", { class: "muted" }, x.timestamp ? fmtTs(x.timestamp) : "—")))))));
}

/* ---------------------------------------------------------------- add result / import */
let picked = null;
function buildPad() {
  const pad = $("#pad"), submit = el("button", { class: "btn", id: "submit", disabled: true }, "Submit result");
  for (let n = 0; n < 10; n++) pad.append(el("button", { type: "button", "aria-label": `number ${n}`, onclick: () => { picked = n; submit.disabled = false; submit.textContent = `Submit result ${n}`;
    pad.querySelectorAll(".ball").forEach((b, i) => { b.style.outline = i === n ? "3px solid #2dd4bf" : "none"; }); } }, ball(n, "big")));
  pad.after(submit);
  submit.onclick = async () => {
    const msg = $("#addmsg"); msg.className = "msg"; msg.textContent = "";
    const body = { number: picked }; if ($("#period").value.trim()) body.period_id = $("#period").value.trim(); if ($("#ts").value) body.timestamp = $("#ts").value;
    submit.disabled = true;
    try {
      const r = await api("/api/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const o = r.resolved_prediction && r.resolved_prediction.outcome;
      msg.className = "msg good";
      msg.textContent = `Saved as round #${r.result.seq}. ` + (o ? `Previous pick ${r.resolved_prediction.color} vs actual ${GROUP(o.actual)} (${o.actual}): ${o.color_hit ? "hit" : "miss"}.` : "No pending pick to compare.");
      picked = null; $("#period").value = ""; submit.textContent = "Submit result"; pad.querySelectorAll(".ball").forEach(b => { b.style.outline = "none"; });
      loadStatus(); loadDash();
    } catch (e) { msg.className = "msg err"; msg.textContent = e.message; submit.disabled = false; }
  };
  $("#dopaste").onclick = async () => {
    const msg = $("#pastemsg"); msg.className = "msg"; msg.textContent = "";
    const text = $("#paste").value;
    if (!text.trim()) { msg.className = "msg err"; msg.textContent = "Paste at least one round first."; return; }
    try {
      const r = await api(`/api/data/import/paste?newest_first=${$("#pnewest").checked}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: text });
      msg.className = "msg good"; msg.textContent = `Imported ${r.imported} rounds (total ${r.total}). Re-run the test on the Accuracy tab to include them.`;
      $("#paste").value = ""; loadStatus(); loadDash();
    } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
  };
  $("#doimport").onclick = async () => {
    const f = $("#csv").files[0], msg = $("#impmsg"); msg.className = "msg"; msg.textContent = "";
    if (!f) { msg.className = "msg err"; msg.textContent = "Choose a CSV file first."; return; }
    try {
      const r = await api(`/api/data/import/csv?newest_first=${$("#newest").checked}`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: await f.text() });
      msg.className = "msg good"; msg.textContent = `Imported ${r.imported} rows (total ${r.total}). Re-run validation from the Performance tab.`; loadStatus(); loadDash();
    } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
  };
}

/* ---------------------------------------------------------------- shell */
async function loadStatus() {
  try {
    const s = await api("/api/status"), b = s.backtest;
    $("#status").textContent = `${s.results} rounds · engine v${s.engine_version} · validation: ${b.status}${b.status === "running" ? ` ${b.progress}/${b.total}` : ""}`;
    return b.status;
  } catch (e) { $("#status").textContent = "API unreachable"; }
}
async function pollStatus() {
  const st = await loadStatus();
  if (st === "running") setTimeout(pollStatus, 4000); else { loadPerf(); loadDash(); }
}
const COLOUR_CLS = { Green: "green", Red: "red", Violet: "violet" };
const rateTxt = r => (r && r.n ? `${pct(r.rate)} (${r.hits}/${r.n})` : "—");
function accRows(title, block, base, keyName) {
  return el("table", { "data-testid": `acc-table-${keyName}` }, el("thead", {}, el("tr", {}, el("th", {}, title), el("th", {}, "Accuracy"), el("th", {}, "vs guessing"))),
    el("tbody", {}, [["All picks", block.all], ...Object.entries(block.by_pick).map(([k, v]) => [`When it picked ${k}`, v])].map(([lab, r]) =>
      el("tr", {}, el("td", {}, lab), el("td", { "data-testid": `acc-${keyName}-${lab.split(" ").pop().toLowerCase()}` }, rateTxt(r)),
        el("td", { class: r && r.n && r.rate > base ? "ok" : "no" }, r && r.n ? pp(r.rate - base) + " pts" : "—")))));
}
function accBlock(a, full) {
  if (!a.available) return [el("p", { class: "muted", "data-testid": "acc-unavailable" }, a.message)];
  if (!full) return [el("div", { class: "kpis" },
    el("div", { class: "kpi", "data-testid": "mini-acc-size" }, el("span", {}, "Big / Small accuracy"), el("b", {}, pct(a.size.all.rate)), el("i", {}, `guessing = ${pct(a.baselines.size)}`)),
    el("div", { class: "kpi", "data-testid": "mini-acc-colour" }, el("span", {}, "Colour accuracy"), el("b", {}, pct(a.colour.all.rate)), el("i", {}, `guessing = ${pct(a.baselines.colour)}`)))];
  return [el("p", { class: "muted" }, `${a.rounds_tested} rounds tested (#${a.first_seq} – #${a.last_seq}).`),
    el("div", { class: "grid two" }, el("div", { class: "tablewrap" }, accRows("Big / Small", a.size, a.baselines.size, "size")),
      el("div", { class: "tablewrap" }, accRows("Colour", a.colour, a.baselines.colour, "colour")))];
}
function hcBlock(h, w) {
  if (!h) return [el("p", { class: "muted" }, `Need ${w} stored rounds.`)];
  const line = (lab, list, id) => el("div", { class: "hcrow", "data-testid": `hc-${id}-${w}` }, el("span", { class: "hclab" }, lab),
    list.map(x => el("span", { class: "hcitem" }, ball(x.number, "sm"), el("small", {}, `${x.count}×`))));
  return [line("Hot", h.hot, "hot"), line("Cold", h.cold, "cold"),
    el("div", { class: "hcrow", "data-testid": `hc-colours-${w}` }, el("span", { class: "hclab" }, "Colours"),
      h.colours.map(c => el("span", { class: "pill" }, el("i", { class: `dot ${COLOUR_CLS[c.colour]}` }), `${c.colour} ${c.count}`))),
    el("div", { class: "hcrow", "data-testid": `hc-size-${w}` }, el("span", { class: "hclab" }, "Size"),
      el("span", { class: "chip big wide" }, `Big ${h.size.Big}`), el("span", { class: "chip small wide" }, `Small ${h.size.Small}`)),
    el("p", { class: "bar-note" }, `Each number is expected about ${h.expected_per_number} times. Past frequency does not change the next draw.`)];
}
function renderStatsMini(d) { setBody($("#stats-mini"), ...accBlock(d.accuracy, false), ...hcBlock(d.hot_cold["50"], 50)); }
function renderStreak(s) {
  const b = $("#streak-alert"), on = [s.size, s.colour].filter(x => x && x.alert);
  b.hidden = !on.length;
  b.replaceChildren(el("strong", {}, "Streak alert. "), on.map(x => `${x.value} has come up ${x.length} times in a row. `).join(""),
    el("span", { class: "muted" }, "A long run does not make the opposite result more likely next round."));
}
function renderDaily(days) {
  const balls = list => el("span", { class: "hcrow tight" }, list.map(x => el("span", { class: "hcitem" }, ball(x.number, "sm"), el("small", {}, `${x.count}×`))));
  setBody($("#st-daily"), days.length ? el("div", { class: "tablewrap" }, el("table", { "data-testid": "daily-table" },
    el("thead", {}, el("tr", {}, ["Day", "Rounds", "Hot", "Cold", "Green / Red / Violet", "Big / Small"].map(h => el("th", {}, h)))),
    el("tbody", {}, days.map(d => el("tr", { "data-testid": `daily-row-${d.date}` }, el("td", {}, d.date), el("td", {}, d.rounds),
      el("td", {}, balls(d.hot)), el("td", {}, balls(d.cold)),
      el("td", {}, `${d.colours.Green} / ${d.colours.Red} / ${d.colours.Violet}`), el("td", {}, `${d.size.Big} / ${d.size.Small}`))))))
    : el("p", { class: "muted" }, "No rounds with dated period IDs stored yet."));
}
function renderStatsPage(d) {
  setBody($("#st-acc"), ...accBlock(d.accuracy, true));
  ["50", "100"].forEach(w => setBody($(`#st-hc-${w}`), ...hcBlock(d.hot_cold[w], w)));
  renderDaily(d.daily);
}
async function loadStats() { const d = await api("/api/stats/report"); renderStatsMini(d); renderStreak(d.streaks); renderStatsPage(d); return d; }
function showTab(name) {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach(s => s.classList.toggle("on", s.id === "tab-" + name));
  ({ history: () => loadHistory(true), trends: loadTrends, perf: loadPerf, analysis: loadAnalysis, stats: loadStats })[name]?.();
}
function init() {
  $("#open-stats").onclick = () => showTab("stats");
  $("#tabs").addEventListener("click", e => {
    const t = e.target.closest("button"); if (t) showTab(t.dataset.tab);
  });
  $("#more").onclick = () => loadHistory(false);
  $("#win").onchange = renderRecentFreq;
  $("#trwin").onchange = () => { trendWin = Number($("#trwin").value); loadTrends(); };
  $("#refresh").onclick = () => refreshAll();
  buildPad(); pollStatus(); loadDash(); startPolling();
}
if (typeof document !== "undefined" && document.getElementById) init();

if (typeof module !== "undefined" && module.exports) module.exports = { localCountdown, pollDelay, pickOffset, fmtClock, clockKey, trendStats, runsOf, streakInfo, assumedNote };
