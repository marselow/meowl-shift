"use strict";

let accounts = [];
let globalProxy = "";
let editingId = null;
let statusFilter = "all";
const $ = (id) => document.getElementById(id);
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function initLock() {
  const st = await window.api.vaultStatus();
  const creating = !st.exists;
  if (creating) {
    $("lock-title").textContent = "Create master password";
    $("lock-sub").textContent = "It encrypts your cookies on disk. If you forget it, there is no recovery.";
    $("pw2").style.display = "block";
    $("lock-btn").textContent = "Create";
  }
  const submit = async () => {
    const p1 = $("pw1").value;
    $("lock-err").textContent = "";
    if (creating) {
      if (p1.length < 4) return ($("lock-err").textContent = "Use at least 4 characters.");
      if (p1 !== $("pw2").value) return ($("lock-err").textContent = "Passwords do not match.");
      afterUnlock(await window.api.create(p1));
    } else {
      const r = await window.api.unlock(p1);
      if (!r.ok) return ($("lock-err").textContent = "Wrong password. Try again.");
      afterUnlock(r);
    }
  };
  $("lock-btn").onclick = submit;
  [$("pw1"), $("pw2")].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); }));
  $("pw1").focus();
}

function afterUnlock(r) {
  accounts = r.accounts || [];
  globalProxy = r.globalProxy || "";
  $("gproxy").value = globalProxy;
  $("kpi-proxy").textContent = globalProxy ? "Set, not tested" : "Not set";
  setProxyIndicators(globalProxy ? "Saved · not tested yet" : "Used when no own proxy", "");
  $("lock").style.display = "none";
  $("app").style.display = "flex";
  render();
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function kind(a) {
  const s = a.status;
  if (s === "Ativo" || s === "Active" || s === "Refrescado" || s === "Refreshed") return "ok";
  if (s === "?" || !s) return "un";
  return "bad";
}
function statusLabel(a) {
  const k = kind(a);
  if (k === "ok") return `<span class="status-pill ok"><i class="dot"></i>Active</span>`;
  if (k === "un") return `<span class="status-pill un"><i class="dot"></i>Unchecked</span>`;
  return `<span class="status-pill bad"><i class="dot"></i>${esc(STATUS_EN[a.status] || a.status)}</span>`;
}
const STATUS_EN = { "Invalido/401": "Invalid/401", "Erro rede": "Network error" };
function icon(id, cls = "") {
  return `<svg class="ic ${cls}"><use href="#${id}"/></svg>`;
}
const fmtInt = (n) => Number(n).toLocaleString("en-US");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const DAY = 864e5;

const PLACEHOLDER_NICKS = new Set(["", "sem-nome", "no-name"]);
const isPlaceholder = (n) => PLACEHOLDER_NICKS.has(String(n ?? "").trim());
const customNick = (a) => (!isPlaceholder(a.nickname) && a.nickname !== a.username ? a.nickname : "");
const displayName = (a) => a.username || (isPlaceholder(a.nickname) ? "" : a.nickname) || "Unidentified account";
const identifying = new Set();

function readStore(key) {
  try { const o = JSON.parse(localStorage.getItem(key) || "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}
function writeStore(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch {} }

const PREF_KEY = "am.prefs";
const prefs = Object.assign({ avatars: true, reduceMotion: false, recheckHours: 24 }, readStore(PREF_KEY));
const recheckMs = () => (Number(prefs.recheckHours) || 24) * 36e5;
function recheckLabel() {
  const h = Number(prefs.recheckHours) || 24;
  return h >= 48 && h % 24 === 0 ? `${h / 24} days` : `${h} h`;
}
const reducedMotion = () => REDUCED_MOTION || !!prefs.reduceMotion;
function applyPrefs() { document.documentElement.classList.toggle("reduce-motion", !!prefs.reduceMotion); }
function savePrefs() { writeStore(PREF_KEY, prefs); applyPrefs(); }
applyPrefs();

const LV_KEY = "am.lastVerified";
let lastVerified = readStore(LV_KEY);

function markVerified(ids) {
  const now = Date.now();
  ids.forEach((id) => (lastVerified[id] = now));
  writeStore(LV_KEY, lastVerified);
  renderLastVerified();
}
let pcGeo = null;
async function pcCountry() {
  if (pcGeo) return pcGeo;
  try {
    const r = await window.api.testProxyValue("");
    if (r && r.ok) pcGeo = { cc: r.country, city: r.city || "" };
  } catch {}
  return pcGeo;
}
async function setRegion(id, geo, via) {
  const region = { cc: geo && geo.cc && geo.cc !== "?" ? geo.cc : "", city: (geo && geo.city) || "", via, at: Date.now() };
  accounts = await window.api.update(id, { region });
}
async function recordRefreshRegion(id) {
  try {
    const r = await window.api.testProxy(id);
    await setRegion(id, r && r.ok ? { cc: r.country, city: r.city } : null, "refresh");
  } catch {}
}
function regionTag(a, tag = "span") {
  const g = a.region;
  if (!g || !g.cc) return `<${tag} class="rg un" title="Cookie origin unknown. Refresh it through the proxy to know for sure.">?</${tag}>`;
  const us = g.cc === "US";
  const where = g.cc + (g.city ? ` (${g.city})` : "");
  const title = g.via === "refresh"
    ? `Cookie generated through ${where} on ${whenLabel(g.at)}${us ? "" : ". Refresh recommended."}`
    : `Cookie added over this PC's connection, ${where}${us ? "" : ". Refresh it through the US proxy."}`;
  return `<${tag} class="rg ${us ? "us" : "warn"}" title="${esc(title)}">${esc(g.cc)}</${tag}>`;
}

function forgetVerified(ids) {
  ids.forEach((id) => delete lastVerified[id]);
  writeStore(LV_KEY, lastVerified);
  renderLastVerified();
}
function pruneStores() {
  const ids = new Set(accounts.map((a) => String(a.id)));
  const uids = new Set(accounts.map((a) => String(a.userid || "")));
  let a = false, b = false;
  for (const k of Object.keys(lastVerified)) if (!ids.has(k)) { delete lastVerified[k]; a = true; }
  for (const k of Object.keys(avatarCache)) if (!uids.has(k)) { delete avatarCache[k]; b = true; }
  if (a) writeStore(LV_KEY, lastVerified);
  if (b) writeStore(AV_KEY, avatarCache);
}
function relTime(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return "Just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function whenLabel(ts) {
  const d = new Date(ts), now = new Date(), y = new Date();
  y.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = d.toDateString() === now.toDateString() ? "Today"
    : d.toDateString() === y.toDateString() ? "Yesterday"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${day}, ${time}`;
}
function renderLastVerified() {
  const box = $("lastcheck");
  const total = accounts.length;
  const now = Date.now();
  const stamps = accounts.map((a) => lastVerified[a.id]).filter(Boolean);
  const latest = stamps.length ? Math.max(...stamps) : 0;
  const recheck = accounts.filter((a) => {
    const t = lastVerified[a.id];
    return !t || now - t > recheckMs() || kind(a) === "un";
  }).length;
  box.classList.toggle("never", !latest);
  box.classList.toggle("stale", !!latest && now - latest > recheckMs());
  $("lv-when").textContent = !total ? "—" : latest ? relTime(latest) : "Never";
  const sub = $("lv-sub");
  if (!total) sub.textContent = "No accounts yet";
  else if (!latest) sub.textContent = "Not checked yet";
  else if (recheck) sub.innerHTML = `<span class="lv-warn">${recheck} to recheck</span>`;
  else sub.textContent = whenLabel(latest);
  box.title = !total ? "" : latest
    ? `Last verified ${whenLabel(latest)} · ${total - recheck} of ${total} checked within ${recheckLabel()}`
    : "Run Validate all to check every cookie";
}

const AV_KEY = "am.avatars";
const AV_TTL = 3 * DAY;
let avatarCache = readStore(AV_KEY);
const avatarTried = new Set();
const avatarLoaded = new Set();
let avatarBusy = false;

const avatarUrl = (uid) => (uid && avatarCache[uid] ? avatarCache[uid].u : "");
function avatarHtml(a) {
  const uid = /^\d+$/.test(String(a.userid || "")) ? String(a.userid) : "";
  const url = prefs.avatars ? avatarUrl(uid) : "";
  const name = a.username || customNick(a);
  const letter = name ? name[0].toUpperCase() : "?";
  return `<div class="acct-av${url && avatarLoaded.has(url) ? " has-img" : ""}" data-uid="${uid}">` +
    `<span class="av-l">${esc(letter)}</span>` +
    (url ? `<img class="av-img" src="${esc(url)}" alt="" draggable="false">` : "") +
    `<i class="${kind(a)}"></i></div>`;
}
async function loadAvatars() {
  if (!prefs.avatars || avatarBusy || !window.api || typeof window.api.headshots !== "function") return;
  const now = Date.now();
  const need = [...new Set(accounts.map((a) => String(a.userid || "")))].filter((u) =>
    /^\d+$/.test(u) && !avatarTried.has(u) && !(avatarCache[u] && now - avatarCache[u].t < AV_TTL));
  if (!need.length) return;
  avatarBusy = true;
  need.forEach((u) => avatarTried.add(u));
  try {
    const got = (await window.api.headshots(need)) || {};
    for (const u of need) if (got[u]) avatarCache[u] = { u: got[u], t: Date.now() };
    writeStore(AV_KEY, avatarCache);
    paintAvatars();
  } catch { } finally {
    avatarBusy = false;
  }
}
function paintAvatars() {
  if (!prefs.avatars) return;
  document.querySelectorAll("#rows .acct-av[data-uid]").forEach((av) => {
    const url = avatarUrl(av.dataset.uid);
    if (!url || av.querySelector(".av-img")) return;
    const img = document.createElement("img");
    img.className = "av-img";
    img.alt = "";
    img.draggable = false;
    img.src = url;
    av.insertBefore(img, av.querySelector("i"));
  });
}

function countTo(el, to) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  cancelAnimationFrame(el._raf);
  if (reducedMotion() || from === to) { el.textContent = fmtInt(to); return; }
  const t0 = performance.now();
  const dur = 700;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtInt(Math.round(from + (to - from) * e));
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

function render() {
  renderTable($("search").value.trim().toLowerCase());
  renderKpis();
  loadAvatars();
}

function renderTable(filter) {
  const tb = $("rows");
  tb.innerHTML = "";
  const searched = accounts.filter((a) =>
    !filter ||
    (a.nickname || "").toLowerCase().includes(filter) ||
    (a.username || "").toLowerCase().includes(filter) ||
    (a.userid || "").toLowerCase().includes(filter)
  );
  const list = statusFilter === "all" ? searched : searched.filter((a) => kind(a) === statusFilter);

  const c = { all: searched.length, ok: 0, bad: 0, un: 0 };
  searched.forEach((a) => c[kind(a)]++);
  Object.keys(c).forEach((k) => ($("fc-" + k).textContent = c[k]));
  $("showing").textContent = `Showing ${list.length} of ${accounts.length}`;

  $("empty").style.display = list.length ? "none" : "flex";
  if (!list.length) {
    const none = !accounts.length;
    $("empty-title").textContent = none ? "No accounts yet" : "No matching accounts";
    $("empty-sub").innerHTML = none
      ? "Click <b>Add account</b> to store your first cookie."
      : "Try a different search or status filter.";
    $("empty-add").style.display = none ? "" : "none";
  }

  for (const a of list) {
    const k = kind(a);
    const proxyCell = a.proxy && a.proxy.trim()
      ? `<span class="pill own">${icon("i-shield")}Own proxy</span>`
      : `<span class="pill g">${icon("i-globe")}Global</span>`;
    const busy = identifying.has(a.id);
    const custom = customNick(a);
    const meta = busy
      ? `<span class="nil">Reading account from cookie&hellip;</span>`
      : regionTag(a, "b") +
        (custom && a.username ? `<span>${esc(custom)}</span>` : "") +
        (a.username ? "" : `<span class="nil">not identified &middot; validate</span>`) +
        (a.userid ? `<span class="mono">ID ${esc(a.userid)}</span>` : "");
    const nameHtml = busy
      ? `<div class="acct-name shimmer">Identifying&hellip;</div>`
      : `<div class="acct-name"><span class="nm">${esc(displayName(a))}</span>${regionTag(a)}</div>`;
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td><div class="acct">${avatarHtml(a)}` +
        `<div class="acct-txt">${nameHtml}<div class="acct-meta">${meta}</div></div></div></td>` +
      `<td>${statusLabel(a)}</td>` +
      `<td>${a.robux ? '<span class="robux"><em>R$</em>' + esc(a.robux) + "</span>" : '<span class="nil">&mdash;</span>'}</td>` +
      `<td>${proxyCell}</td>` +
      `<td><div class="rowacts">` +
        mini("validate", a.id, "i-check", "Validate", busy ? "busy" : "") +
        mini("refresh", a.id, "i-refresh", "Refresh (US)") +
        mini("copy", a.id, "i-copy", "Copy cookie") +
        mini("browser", a.id, "i-monitor", "Open browser") +
        `<span class="sep"></span>` +
        mini("edit", a.id, "i-edit", "Edit") +
        mini("delete", a.id, "i-trash", "Delete", "del") +
      `</div></td>`;
    tb.appendChild(tr);
  }
}
function mini(act, id, ic, title, extra = "") {
  return `<button type="button" class="mini ${extra}" data-act="${act}" data-id="${id}" data-tip="${title}" aria-label="${title}">${icon(ic)}</button>`;
}

function setArc(el, pct, offset) {
  const len = pct > 0 && pct < 100 ? Math.max(0, pct - 1) : pct;
  el.style.strokeDasharray = `${len} ${100 - len}`;
  el.style.strokeDashoffset = `${offset}`;
}

function renderKpis() {
  const total = accounts.length;
  const ok = accounts.filter((a) => kind(a) === "ok").length;
  const bad = accounts.filter((a) => kind(a) === "bad").length;
  const un = accounts.filter((a) => kind(a) === "un").length;
  const own = accounts.filter((a) => a.proxy && a.proxy.trim()).length;
  const pct = total ? Math.round((ok / total) * 100) : 0;

  countTo($("kpi-total"), total);
  countTo($("kpi-active"), ok);
  countTo($("kpi-dead"), bad);
  $("kpi-pct").textContent = pct + "%";
  $("kpi-meter").style.width = pct + "%";
  $("kpi-total-sub").textContent = total ? `${own} own proxy · ${total - own} global` : "Add your first account";
  $("kpi-dead-sub").textContent = bad
    ? `${bad} invalid${un ? ` · ${un} unchecked` : ""}`
    : un ? `${un} unchecked · validate` : "All cookies healthy";
  $("kpi-dead-card").classList.toggle("alert", bad > 0);

  const okPct = total ? (ok / total) * 100 : 0;
  const badPct = total ? (bad / total) * 100 : 0;
  setArc($("arc-ok"), okPct, 25);
  setArc($("arc-bad"), badPct, 25 - okPct);
  countTo($("donut-n"), total);
  $("lg-ok").textContent = ok;
  $("lg-bad").textContent = bad;
  $("lg-un").textContent = un;
  const p = (n) => (total ? Math.round((n / total) * 100) : 0) + "%";
  $("lg-ok-p").textContent = p(ok);
  $("lg-bad-p").textContent = p(bad);
  $("lg-un-p").textContent = p(un);

  pruneStores();
  renderLastVerified();

  $("btn-delete-all").style.display = total ? "" : "none";
  $("nav-count").textContent = total;
  $("acc-count").textContent = total;
  $("bell-dot").classList.toggle("on", bad > 0);
  $("bell").title = bad ? `${plural(bad, "account")} need attention` : "No alerts";
}

function setStatus(t) {
  $("status").textContent = t;
  $("statusbar").classList.toggle("busy", /\.\.\.$/.test(t));
}
let toastT;
const TOAST_ICON = { ok: "i-check", bad: "i-alert" };
function toast(msg, kindc = "") {
  const el = $("toast");
  el.innerHTML = `<span class="t-ic">${icon(TOAST_ICON[kindc] || "i-info")}</span><span>${esc(msg)}</span>`;
  el.className = "toast show " + kindc;
  clearTimeout(toastT);
  toastT = setTimeout(() => (el.className = "toast " + kindc), 3200);
}
const DLG_ICON = { info: "i-info", warn: "i-alert", bad: "i-trash" };
function dialog(title, msg, buttons, tone = "info") {
  return new Promise((resolve) => {
    $("dlg-title").textContent = title;
    $("dlg-msg").textContent = msg;
    $("dlg-icon").className = "mh-icon" + (tone === "bad" ? " bad" : "");
    $("dlg-icon").innerHTML = icon(DLG_ICON[tone] || "i-info");
    const foot = $("dlg-foot");
    foot.innerHTML = "";
    buttons.forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "btn " + (b.kind || "btn-ghost");
      btn.textContent = b.label;
      btn.onclick = () => { $("dlg").style.display = "none"; resolve(b.value); };
      foot.appendChild(btn);
    });
    $("dlg").style.display = "flex";
    const focusBtn = tone === "bad" ? foot.firstChild : foot.lastChild;
    if (focusBtn) focusBtn.focus();
  });
}
const confirmDlg = (t, m, o = {}) => dialog(t, m, [
  { label: "Cancel", value: false },
  { label: o.confirm || "Continue", kind: o.danger ? "btn-danger" : "btn-primary", value: true },
], o.danger ? "bad" : "warn");
const alertDlg = (t, m) => dialog(t, m, [{ label: "OK", kind: "btn-primary", value: true }], "info");

function setProxyIndicators(sub, state) {
  $("kpi-proxy-sub").textContent = sub;
  $("nav-proxy-dot").className = "nav-dot" + (state ? " " + state : "");
}
async function saveGlobalProxy() {
  const r = await window.api.setGlobalProxy($("gproxy").value);
  globalProxy = r.globalProxy || "";
  $("gproxy").value = globalProxy;
  $("kpi-proxy").textContent = globalProxy ? "Set, not tested" : "Not set";
  setProxyIndicators(globalProxy ? "Saved · not tested yet" : "Used when no own proxy", "");
  toast("Global proxy saved.", "ok");
  setStatus("Global proxy saved.");
}
async function testGlobalProxy() {
  setStatus("Testing global proxy...");
  const value = $("gproxy").value.trim();
  const r = await window.api.testProxyValue(value);
  applyProxyResult(r);
  if (!r || !r.ok) return;
  const where = r.country + (r.city ? ` · ${r.city}` : "");
  if (!value) return toast(`No proxy set: this is your PC's own connection (${where}).`, "bad");
  const issues = [];
  if (r.country !== "US") issues.push("it is not in the US");
  if (!r.httpsOk) issues.push("it has no HTTPS");
  if (r.datacenter) issues.push("it is a datacenter IP");
  if (!issues.length) toast(`Proxy works: ${where} · HTTPS OK · residential IP.`, "ok");
  else toast(`Proxy works (${where}), but ${issues.join(" and ")}.`, issues.length === 1 && r.datacenter ? "" : "bad");
}
function applyProxyResult(r) {
  const chip = $("region-chip");
  if (!r.ok) {
    $("proxy-badge").className = "pill bad";
    $("proxy-badge").textContent = "Failed";
    chip.className = "chip bad";
    chip.querySelector("span").textContent = "Proxy failed";
    $("p-country").textContent = "-"; $("p-https").textContent = "-"; $("p-type").textContent = "-";
    setProxyIndicators("Last test failed", "bad");
    setStatus("Proxy failed.");
    return alertDlg("Proxy test", r.error || "error");
  }
  const serve = r.country === "US" && r.httpsOk && !r.datacenter;
  $("p-country").textContent = r.country + (r.city ? " (" + r.city + ")" : "");
  $("p-https").textContent = r.httpsOk ? "Supported" : "No";
  $("p-https").style.color = r.httpsOk ? "var(--ok)" : "var(--bad)";
  $("p-type").textContent = r.datacenter ? "Datacenter" : "Residential";
  $("kpi-proxy").textContent = r.country + (r.city ? " / " + r.city : "");
  $("proxy-badge").className = "pill " + (serve ? "ok" : "bad");
  $("proxy-badge").textContent = serve ? "Healthy" : "Check it";
  chip.className = "chip " + (r.country === "US" && r.httpsOk ? "ok" : "bad");
  chip.querySelector("span").textContent = `${r.country} ${r.httpsOk ? "· HTTPS OK" : "· no HTTPS"}`;
  setProxyIndicators(`${r.httpsOk ? "HTTPS OK" : "No HTTPS"} · ${r.datacenter ? "Datacenter" : "Residential"}`, serve ? "ok" : "bad");
  setStatus(`Proxy: ${r.country} | HTTPS ${r.httpsOk ? "ok" : "no"} | ${r.datacenter ? "datacenter" : "residential"}`);
}

const cookieLines = (text) => String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

function openModal(acc) {
  editingId = acc ? acc.id : null;
  $("modal-title").textContent = acc ? `Edit ${displayName(acc)}` : "Add accounts";
  $("f-cookie-lbl").textContent = acc ? "Cookie (.ROBLOSECURITY), full value" : "Cookies (.ROBLOSECURITY), one per line";
  $("f-proxy-lbl").textContent = acc ? "Proxy for this account" : "Proxy for these accounts";
  $("f-cookie").rows = acc ? 4 : 6;
  $("f-cookie").value = acc ? acc.cookie : "";
  $("f-proxy").value = acc ? acc.proxy : "";
  updateCookieCount();
  $("modal").style.display = "flex";
  $("f-cookie").focus();
}
function updateCookieCount() {
  const n = cookieLines($("f-cookie").value).length;
  const adding = editingId == null;
  $("f-count").textContent = adding && n ? plural(n, "cookie") : "";
  $("modal-save-t").textContent = adding && n > 1 ? `Add ${n} accounts` : "Save";
}
function closeModal() { $("modal").style.display = "none"; }
async function saveModal() {
  const lines = cookieLines($("f-cookie").value);
  if (!lines.length) return toast("Paste the .ROBLOSECURITY cookie.", "bad");
  const proxy = $("f-proxy").value.trim();

  if (editingId != null) {
    if (lines.length > 1) return toast("Editing takes a single cookie.", "bad");
    const cookie = lines[0];
    const prev = accounts.find((x) => x.id === editingId);
    accounts = await window.api.update(editingId, { nickname: prev ? prev.nickname : "", cookie, proxy });
    closeModal();
    render();
    setStatus("Account updated.");
    if (prev && prev.cookie !== cookie) identify(prev.id);
    return;
  }

  const known = new Set(accounts.map((a) => String(a.cookie || "").trim()));
  const fresh = [...new Set(lines)].filter((c) => !known.has(c));
  const skipped = lines.length - fresh.length;
  if (!fresh.length) return toast(lines.length === 1 ? "This cookie is already in the vault." : "All these cookies are already in the vault.", "bad");
  closeModal();
  const ids = [];
  for (const [i, cookie] of fresh.entries()) {
    if (fresh.length > 1) setStatus(`Adding ${i + 1} of ${fresh.length}...`);
    const before = new Set(accounts.map((x) => x.id));
    accounts = await window.api.add({ nickname: "", cookie, proxy });
    const added = accounts.find((x) => !before.has(x.id));
    if (added) ids.push(added.id);
  }
  render();
  if (ids.length === 1 && !skipped) return identify(ids[0]);
  identifyMany(ids, skipped);
}

async function identify(id, quiet = false) {
  identifying.add(id);
  render();
  if (!quiet) setStatus("Identifying account (PC network, no proxy)...");
  let ok = false;
  try {
    const r = await window.api.identify(id);
    if (r && r.account) { replace(id, r.account); markVerified([id]); }
    await adoptUsernames([id]);
    await setRegion(id, await pcCountry(), "pc");
    const a = accounts.find((x) => x.id === id);
    ok = !!(a && a.username);
    if (!quiet && ok) {
      toast(`Identified as ${a.username}.`, "ok");
      setStatus(`Account identified: ${a.username}.`);
    } else if (!quiet) {
      toast("Saved, but this cookie could not be identified.", "bad");
      setStatus(`Could not identify the account${a && a.status && a.status !== "?" ? ` (${a.status})` : ""}. Check the cookie.`);
    }
  } catch {
    if (!quiet) setStatus("Could not identify the account.");
  } finally {
    identifying.delete(id);
    render();
  }
  return ok;
}
async function identifyMany(ids, skipped = 0) {
  ids.forEach((id) => identifying.add(id));
  render();
  let ok = 0;
  for (const [i, id] of ids.entries()) {
    setStatus(`Identifying ${i + 1} of ${ids.length} (PC network, no proxy)...`);
    if (await identify(id, true)) ok++;
  }
  const failed = ids.length - ok;
  const msg = `${plural(ids.length, "account")} added · ${ok} identified` +
    (failed ? ` · ${failed} not identified` : "") +
    (skipped ? ` · ${plural(skipped, "duplicate")} skipped` : "") + ".";
  toast(msg, failed ? "bad" : "ok");
  setStatus(msg);
}

async function deleteAll() {
  if (!accounts.length) return toast("There are no accounts to delete.", "bad");
  const n = accounts.length;
  const ok = await confirmDlg("Delete all accounts",
    `Delete all ${plural(n, "account")} from the vault?\n\nTheir cookies are removed from this PC and cannot be recovered. Copy any cookie you still need first.`,
    { danger: true, confirm: `Delete ${n}` });
  if (!ok) return;
  accounts = await window.api.remove(accounts.map((a) => a.id));
  render();
  toast(`${plural(n, "account")} deleted.`, "ok");
  setStatus("All accounts deleted.");
}
async function adoptUsernames(ids) {
  for (const id of ids) {
    const a = accounts.find((x) => x.id === id);
    if (a && a.username && isPlaceholder(a.nickname)) accounts = await window.api.update(id, { nickname: a.username });
  }
}
async function afterValidated(ids) {
  markVerified(ids);
  await adoptUsernames(ids);
  render();
}

async function actValidate(id) {
  setStatus("Validating...");
  const r = await window.api.validate(id);
  if (r && r.account) { replace(id, r.account); render(); setStatus("Validation done."); }
}
async function actRefresh(id) {
  const a = accounts.find((x) => x.id === id);
  const eff = a.proxy && a.proxy.trim() ? a.proxy : globalProxy;
  if (!eff) {
    const go = await confirmDlg("No proxy", "No proxy for this account and no global proxy set. The refresh will use YOUR current IP (probably Brazil), so the new cookie will be born Brazilian.\n\nContinue?");
    if (!go) return;
  }
  const ok = await confirmDlg("Confirm refresh", "This creates a NEW cookie and INVALIDATES the current one. Anywhere the current cookie is in use, it stops working until you paste the new one.\n\nContinue?");
  if (!ok) return;
  setStatus("Refreshing through the proxy...");
  const r = await window.api.refresh(id);
  if (r.ok) {
    replace(id, r.account); render();
    setStatus("Cookie refreshed through the proxy IP. The old one was invalidated.");
    alertDlg("Refresh OK", "A new cookie was generated through the proxy IP and saved. The old cookie was invalidated by Roblox.\n\nNow Validate and then Copy cookie.");
  } else { setStatus("Refresh failed."); alertDlg("Refresh failed", r.error || "unknown error"); }
}
async function actCopy(id) {
  await window.api.copy(id);
  const a = accounts.find((x) => x.id === id);
  toast(`Cookie of "${a ? displayName(a) : ""}" copied.`, "ok");
  setStatus("Cookie copied.");
}
async function actBrowser(id) {
  const a = accounts.find((x) => x.id === id);
  setStatus(`Opening browser for "${a ? displayName(a) : ""}"...`);
  const r = await window.api.openBrowser(id);
  if (r.ok) setStatus("Browser opened (isolated session).");
  else { setStatus("Failed to open browser."); alertDlg("Error", r.error || "error"); }
}
function actEdit(id) { openModal(accounts.find((x) => x.id === id)); }
async function actDelete(id) {
  const a = accounts.find((x) => x.id === id);
  const ok = await confirmDlg("Delete", `Delete "${a ? displayName(a) : ""}"?`, { danger: true, confirm: "Delete" });
  if (!ok) return;
  accounts = await window.api.remove([id]);
  render();
  setStatus("Account deleted.");
}
function replace(id, acc) { const i = accounts.findIndex((x) => x.id === id); if (i >= 0) accounts[i] = acc; }

async function validateAll() {
  if (!accounts.length) return toast("No accounts to validate.", "bad");
  setStatus(`Validating ${accounts.length} account(s)...`);
  for (const a of [...accounts]) {
    const r = await window.api.validate(a.id);
    if (r && r.account) { replace(a.id, r.account); render(); }
  }
  setStatus("Validation done.");
}

async function refreshAll() {
  const targets = accounts.filter((a) => kind(a) !== "bad");
  if (!targets.length) return toast(accounts.length ? "No valid accounts to refresh." : "No accounts to refresh.", "bad");
  const skipped = accounts.length - targets.length;
  const noProxy = globalProxy ? 0 : targets.filter((a) => !(a.proxy && a.proxy.trim())).length;
  const ok = await confirmDlg("Refresh all",
    `This creates a NEW cookie for ${plural(targets.length, "account")} and INVALIDATES the current ones. Anywhere the current cookies are in use, they stop working until you paste the new ones.` +
    (skipped ? `\n\n${plural(skipped, "invalid account")} will be skipped.` : "") +
    (noProxy ? `\n\nWARNING: ${plural(noProxy, "account")} ${noProxy === 1 ? "has" : "have"} no proxy and no global proxy is set, so ${noProxy === 1 ? "it" : "they"} will be refreshed with YOUR current IP.` : "") +
    "\n\nContinue?",
    { confirm: "Refresh all" });
  if (!ok) return;
  $("btn-refresh-all").classList.add("loading");
  let done = 0;
  const failed = [];
  for (const [i, a] of targets.entries()) {
    setStatus(`Refreshing ${i + 1} of ${targets.length} through the proxy...`);
    try {
      const r = await window.api.refresh(a.id);
      if (r && r.ok) {
        replace(a.id, r.account);
        forgetVerified([a.id]);
        await recordRefreshRegion(a.id);
        done++;
        render();
      }
      else failed.push(`${displayName(a)}: ${(r && r.error) || "unknown error"}`);
    } catch (e) {
      failed.push(`${displayName(a)}: ${e && e.message ? e.message : e}`);
    }
  }
  render();
  setStatus(`Refresh done: ${done} of ${targets.length} refreshed${failed.length ? `, ${failed.length} failed` : ""}.`);
  if (!failed.length) {
    return alertDlg("Refresh all", `${plural(done, "new cookie")} generated through the proxy and saved. The old cookies were invalidated by Roblox.\n\nNow Validate all and then copy the new cookies.`);
  }
  const list = failed.slice(0, 8).join("\n") + (failed.length > 8 ? `\n...and ${failed.length - 8} more` : "");
  alertDlg("Refresh all", `${done} of ${targets.length} refreshed.\n\nFailed:\n${list}`);
}

const ROW = { validate: actValidate, refresh: actRefresh, copy: actCopy, browser: actBrowser, edit: actEdit, delete: actDelete };
const SPIN_ACTS = new Set(["validate", "browser"]);

$("rows").addEventListener("click", (e) => {
  const m = e.target.closest(".mini");
  if (!m) return;
  const fn = ROW[m.dataset.act];
  if (!fn) return;
  const id = Number(m.dataset.id);
  const before = accounts.find((x) => x.id === id);
  if (SPIN_ACTS.has(m.dataset.act)) m.classList.add("busy");
  const p = Promise.resolve(fn(id));
  p.finally(() => m.classList.remove("busy"));
  if (m.dataset.act === "validate") p.then(() => afterValidated([id])).catch(() => {});
  if (m.dataset.act === "refresh") {
    p.then(async () => {
      if (accounts.find((x) => x.id === id) === before) return;
      forgetVerified([id]);
      await recordRefreshRegion(id);
      render();
    }).catch(() => {});
  }
});
$("rows").addEventListener("load", (e) => {
  const img = e.target;
  if (!img.classList || !img.classList.contains("av-img")) return;
  avatarLoaded.add(img.getAttribute("src"));
  img.parentElement.classList.add("has-img");
}, true);
$("rows").addEventListener("error", (e) => {
  const img = e.target;
  if (!img.classList || !img.classList.contains("av-img")) return;
  delete avatarCache[img.parentElement.dataset.uid];
  img.remove();
}, true);
$("search").addEventListener("input", () => renderTable($("search").value.trim().toLowerCase()));
$("btn-add").onclick = () => openModal(null);
$("btn-delete-all").onclick = () => runBatch(deleteAll);
$("f-cookie").addEventListener("input", updateCookieCount);
$("empty-add").onclick = () => openModal(null);
let batchBusy = false;
async function runBatch(fn) {
  if (batchBusy) return toast("Wait for the current batch to finish.", "bad");
  batchBusy = true;
  try { await fn(); } finally { batchBusy = false; }
}
$("btn-validate-all").onclick = () => runBatch(async () => {
  const b = $("btn-validate-all");
  const ids = accounts.map((a) => a.id);
  b.classList.add("loading");
  $("lv-run").classList.add("busy");
  try {
    await validateAll();
    if (ids.length) await afterValidated(ids);
  } finally {
    b.classList.remove("loading");
    $("lv-run").classList.remove("busy");
  }
});
$("btn-refresh-all").onclick = () => runBatch(async () => {
  try { await refreshAll(); } finally { $("btn-refresh-all").classList.remove("loading"); }
});
$("lv-run").onclick = () => $("btn-validate-all").click();
setInterval(() => { if (accounts.length) renderLastVerified(); }, 30000);
$("gproxy-save").onclick = saveGlobalProxy;
$("gproxy-test").onclick = testGlobalProxy;
$("gproxy").addEventListener("keydown", (e) => { if (e.key === "Enter") saveGlobalProxy(); });
$("modal-x").onclick = closeModal;
$("modal-cancel").onclick = closeModal;
$("modal-save").onclick = saveModal;
$("modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

function setFilter(f) {
  statusFilter = f;
  document.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x.dataset.filter === f));
  renderTable($("search").value.trim().toLowerCase());
}
$("filter").addEventListener("click", (e) => {
  const b = e.target.closest(".seg-btn");
  if (b) setFilter(b.dataset.filter);
});

$("bell").onclick = () => {
  const hasBad = accounts.some((a) => kind(a) === "bad");
  if (hasBad) setFilter("bad");
  $("sec-accounts").scrollIntoView({ behavior: "smooth", block: "start" });
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("modal").style.display === "flex") closeModal();
  if (e.key === "Escape" && $("settings").style.display === "flex") closeSettings();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && $("app").style.display !== "none") {
    e.preventDefault();
    $("search").focus();
    $("search").select();
  }
});

new MutationObserver(() => {
  if (!$("lock-err").textContent) return;
  const card = document.querySelector(".lock-card");
  card.classList.remove("shake");
  void card.offsetWidth;
  card.classList.add("shake");
}).observe($("lock-err"), { childList: true, characterData: true, subtree: true });

$("today").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

(() => {
  const name = (window.api && window.api.userName) || "User";
  $("uc-name").textContent = name;
  $("uc-name").title = "Windows user";
  $("uc-av").textContent = $("top-av").textContent = name[0].toUpperCase();
  $("top-av").title = name;
})();

const content = $("main").querySelector(".content");
let spyLockUntil = 0;
function setActiveNav(target) {
  document.querySelectorAll(".nav").forEach((x) => x.classList.toggle("active", x.dataset.scroll === target));
}
document.querySelectorAll(".nav[data-scroll]").forEach((n) => {
  n.onclick = () => {
    spyLockUntil = Date.now() + 800;
    document.querySelectorAll(".nav").forEach((x) => x.classList.remove("active"));
    n.classList.add("active");
    const t = n.dataset.scroll;
    if (t === "top") content.scrollTo({ top: 0, behavior: "smooth" });
    else $(t).scrollIntoView({ behavior: "smooth", block: "start" });
  };
});
content.addEventListener("scroll", () => {
  if (Date.now() < spyLockUntil) return;
  const y = content.scrollTop;
  let cur = "top";
  if (y > 0 && y + content.clientHeight >= content.scrollHeight - 4) cur = "sec-proxy";
  else ["sec-accounts", "sec-proxy"].forEach((id) => { if ($(id).offsetTop - 140 <= y) cur = id; });
  setActiveNav(cur);
}, { passive: true });
async function openSettings() {
  $("pref-avatars").checked = !!prefs.avatars;
  $("pref-motion").checked = !!prefs.reduceMotion;
  $("pref-recheck").value = String(prefs.recheckHours);
  $("settings").style.display = "flex";
  $("settings-done").focus({ preventScroll: true });
  document.querySelector(".modal-settings").scrollTop = 0;
  let version = "";
  try {
    const info = window.api && window.api.appInfo ? await window.api.appInfo() : null;
    if (info) {
      version = info.version;
      $("set-path").textContent = info.dataDir;
      $("set-path").title = info.dataDir;
    }
  } catch {}
  const electron = window.api && window.api.electronVersion;
  $("set-about").textContent = `Meowl Shift${version ? ` · v${version}` : ""}${electron ? ` · Electron ${electron}` : ""}`;
}
function closeSettings() { $("settings").style.display = "none"; }
$("nav-settings").onclick = openSettings;
$("settings-x").onclick = closeSettings;
$("settings-done").onclick = closeSettings;
$("settings").addEventListener("click", (e) => { if (e.target.id === "settings") closeSettings(); });
$("pref-avatars").onchange = (e) => { prefs.avatars = e.target.checked; savePrefs(); render(); };
$("pref-motion").onchange = (e) => { prefs.reduceMotion = e.target.checked; savePrefs(); };
$("pref-recheck").onchange = (e) => { prefs.recheckHours = Number(e.target.value) || 24; savePrefs(); renderLastVerified(); };
$("set-open").onclick = () => { if (window.api && window.api.openDataFolder) window.api.openDataFolder(); };

initLock();
