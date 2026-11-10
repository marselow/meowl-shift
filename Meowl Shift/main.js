"use strict";

const { app, BrowserWindow, ipcMain, clipboard, session, nativeTheme, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { HttpsProxyAgent } = require("https-proxy-agent");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const COOKIE = ".ROBLOSECURITY";
const ITER = 200000;

let vault = { key: null, salt: null, globalProxy: "", accounts: [] };
const APP_ICON = path.join(__dirname, "renderer", "assets", "icon.ico");
const DATA_DIR = path.join(app.getPath("appData"), "Meowl Shift");
const LEGACY_DATA_DIR = path.join(app.getPath("appData"), "gerenciador-contas-roblox");

function migrateDataDir(from, to) {
  const vaultFile = (dir) => path.join(dir, "accounts.dat");
  if (fs.existsSync(vaultFile(to)) || !fs.existsSync(vaultFile(from))) return "skip";
  if (!fs.existsSync(to)) {
    try {
      fs.renameSync(from, to);
      return "moved";
    } catch (_) {}
  }
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(vaultFile(from), vaultFile(to));
  for (const sub of ["Local Storage", "Partitions"]) {
    try {
      if (fs.existsSync(path.join(from, sub)) && !fs.existsSync(path.join(to, sub))) {
        fs.cpSync(path.join(from, sub), path.join(to, sub), { recursive: true });
      }
    } catch (_) {}
  }
  return "copied";
}
try {
  migrateDataDir(LEGACY_DATA_DIR, DATA_DIR);
} catch (_) {}
app.setName("Meowl Shift");
app.setPath("userData", DATA_DIR);
const STORE_FILE = () => path.join(app.getPath("userData"), "accounts.dat");

function effectiveProxy(acc) {
  return acc && acc.proxy && acc.proxy.trim() ? acc.proxy : vault.globalProxy || "";
}
const winProxyCreds = new Map();

function deriveKey(pw, salt) {
  return crypto.pbkdf2Sync(pw, salt, ITER, 32, "sha256");
}
function saveVault() {
  const payload = { globalProxy: vault.globalProxy || "", accounts: vault.accounts };
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-256-cbc", vault.key, iv);
  const enc = Buffer.concat([c.update(json), c.final()]);
  fs.writeFileSync(STORE_FILE(), Buffer.concat([vault.salt, iv, enc]));
}
function loadVault(pw) {
  const raw = fs.readFileSync(STORE_FILE());
  const salt = raw.slice(0, 16);
  const iv = raw.slice(16, 32);
  const data = raw.slice(32);
  const key = deriveKey(pw, salt);
  const d = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const json = Buffer.concat([d.update(data), d.final()]).toString("utf8");
  const parsed = JSON.parse(json);
  if (Array.isArray(parsed)) vault = { key, salt, globalProxy: "", accounts: parsed };
  else vault = { key, salt, globalProxy: parsed.globalProxy || "", accounts: parsed.accounts || [] };
}
function createVault(pw) {
  const salt = crypto.randomBytes(16);
  vault = { key: deriveKey(pw, salt), salt, globalProxy: "", accounts: [] };
  saveVault();
}
function nextId() {
  return vault.accounts.reduce((m, a) => Math.max(m, a.id), 0) + 1;
}
function getAcc(id) {
  return vault.accounts.find((a) => a.id === id);
}

function parseProxy(proxy) {
  if (!proxy || !proxy.trim()) return null;
  let p = proxy.trim();
  if (!p.includes("://")) p = "http://" + p;
  return p;
}

function httpReq(urlStr, { method = "GET", headers = {}, proxy = "", body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      method,
      headers: { ...headers },
      host: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
    };
    const px = parseProxy(proxy);
    if (px) opts.agent = new HttpsProxyAgent(px);
    if (body) opts.headers["Content-Length"] = Buffer.byteLength(body);
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })
      );
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

function httpPlainViaProxy(targetUrl, proxy) {
  return new Promise((resolve, reject) => {
    const p = new URL(parseProxy(proxy));
    const t = new URL(targetUrl);
    const headers = { Host: t.host, "User-Agent": UA };
    if (p.username) {
      const cred = decodeURIComponent(p.username) + ":" + decodeURIComponent(p.password);
      headers["Proxy-Authorization"] = "Basic " + Buffer.from(cred).toString("base64");
    }
    const req = http.request(
      { host: p.hostname, port: p.port || 80, method: "GET", path: targetUrl, headers },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

function cookieHeader(cookie) {
  return { Cookie: COOKIE + "=" + cookie, "User-Agent": UA };
}

async function validateCookie(cookie, proxy) {
  try {
    const r = await httpReq("https://users.roblox.com/v1/users/authenticated", {
      headers: cookieHeader(cookie),
      proxy,
    });
    if (r.status === 200) {
      const d = JSON.parse(r.body);
      let robux = "";
      try {
        const rr = await httpReq("https://economy.roblox.com/v1/user/currency", {
          headers: cookieHeader(cookie),
          proxy,
        });
        if (rr.status === 200) robux = String(JSON.parse(rr.body).robux ?? "");
      } catch (_) {}
      return { status: "Active", username: d.name, userid: String(d.id), robux };
    }
    if (r.status === 401) return { status: "Invalid/401", username: "", userid: "", robux: "" };
    return { status: "HTTP " + r.status, username: "", userid: "", robux: "" };
  } catch (e) {
    return { status: "Network error", username: "", userid: "", robux: "", error: String(e) };
  }
}

function parseSecurity(setc) {
  if (!setc) return null;
  const arr = Array.isArray(setc) ? setc : [setc];
  for (const c of arr) {
    const m = /\.ROBLOSECURITY=([^;]+)/.exec(c);
    if (m && m[1] && m[1].length > 50) return m[1];
  }
  return null;
}

async function refreshCookie(cookie, proxy) {
  try {
    const base = {
      ...cookieHeader(cookie),
      "Content-Type": "application/json",
      Referer: "https://www.roblox.com/",
      Origin: "https://www.roblox.com",
    };
    const url = "https://auth.roblox.com/v1/authentication-ticket/";
    let r = await httpReq(url, { method: "POST", headers: base, proxy });
    const csrf = r.headers["x-csrf-token"];
    if (!csrf) return { ok: false, error: "Could not get a CSRF token (invalid cookie or blocked proxy?)" };
    r = await httpReq(url, { method: "POST", headers: { ...base, "x-csrf-token": csrf }, proxy });
    const ticket = r.headers["rbx-authentication-ticket"];
    if (!ticket) return { ok: false, error: "Could not get an authentication ticket (HTTP " + r.status + ")" };
    r = await httpReq("https://auth.roblox.com/v1/authentication-ticket/redeem", {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        RBXAuthenticationNegotiation: "1",
        "rbx-authentication-ticket": ticket,
      },
      proxy,
      body: JSON.stringify({ authenticationTicket: ticket }),
    });
    const nc = parseSecurity(r.headers["set-cookie"]);
    if (!nc) return { ok: false, error: "Redeem returned no new cookie (HTTP " + r.status + ")" };
    return { ok: true, cookie: nc };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function checkProxy(proxy) {
  let httpsOk = false;
  let data = null;
  try {
    const r = await httpReq("https://ipinfo.io/json", { proxy });
    if (r.status === 200) {
      httpsOk = true;
      data = JSON.parse(r.body);
    }
  } catch (_) {}
  if (!data && proxy) {
    try {
      const r = await httpPlainViaProxy("http://ipinfo.io/json", proxy);
      if (r.status === 200) data = JSON.parse(r.body);
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
  if (!data) return { ok: false, error: "The proxy did not respond (is it offline or are the credentials wrong?)" };
  const org = data.org || "";
  const dc = org && !/residential|fiber|telecom|broadband|comcast|spectrum|at&t|verizon/i.test(org);
  return {
    ok: true,
    ip: data.ip || "?",
    country: data.country || "?",
    region: data.region || "",
    city: data.city || "",
    org,
    httpsOk,
    datacenter: !!dc,
  };
}

async function openBrowser(acc) {
  const part = "persist:acct-" + acc.id;
  const ses = session.fromPartition(part);
  const px = effectiveProxy(acc);
  if (px) {
    const u = new URL(parseProxy(px));
    await ses.setProxy({ proxyRules: `${u.protocol}//${u.host}` });
    ses._cred = u.username ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } : null;
  } else {
    await ses.setProxy({ mode: "direct" });
    ses._cred = null;
  }
  try {
    await ses.cookies.set({
      url: "https://www.roblox.com",
      name: COOKIE,
      value: acc.cookie,
      domain: ".roblox.com",
      path: "/",
      secure: true,
      httpOnly: true,
    });
  } catch (e) {
    return { ok: false, error: "Could not set the cookie in the browser: " + e };
  }
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: acc.username || acc.nickname,
    backgroundColor: "#0c0c10",
    icon: APP_ICON,
    webPreferences: { partition: part },
  });
  const wcId = win.webContents.id;
  if (ses._cred) winProxyCreds.set(wcId, ses._cred);
  win.on("closed", () => winProxyCreds.delete(wcId));
  await win.loadURL("https://www.roblox.com/home").catch(() => {});
  return { ok: true };
}

app.on("login", (event, webContents, details, authInfo, callback) => {
  if (authInfo.isProxy) {
    const cred = winProxyCreds.get(webContents.id);
    if (cred) {
      event.preventDefault();
      callback(cred.user, cred.pass);
      return;
    }
  }
});

ipcMain.handle("vault:status", () => ({ exists: fs.existsSync(STORE_FILE()) }));

ipcMain.handle("vault:unlock", (_e, pw) => {
  try {
    loadVault(pw);
    return { ok: true, accounts: vault.accounts, globalProxy: vault.globalProxy };
  } catch (e) {
    return { ok: false, error: "wrong password" };
  }
});

ipcMain.handle("vault:create", (_e, pw) => {
  createVault(pw);
  return { ok: true, accounts: vault.accounts, globalProxy: vault.globalProxy };
});

ipcMain.handle("vault:setGlobalProxy", (_e, proxy) => {
  vault.globalProxy = (proxy || "").trim();
  saveVault();
  return { ok: true, globalProxy: vault.globalProxy };
});

ipcMain.handle("proxy:test", async (_e, proxy) => {
  return await checkProxy((proxy || "").trim());
});

ipcMain.handle("app:info", () => ({ version: app.getVersion(), dataDir: app.getPath("userData") }));
ipcMain.handle("app:openDataFolder", () => shell.openPath(app.getPath("userData")));

ipcMain.handle("avatar:headshots", async (_e, ids) => {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((s) => /^\d{1,20}$/.test(s)))].slice(0, 100);
  if (!list.length) return {};
  try {
    const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${list.join(",")}&size=150x150&format=Png&isCircular=false`;
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return {};
    const j = await r.json();
    const out = {};
    for (const t of j.data || []) {
      if (t && t.state === "Completed" && /^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\//i.test(t.imageUrl || "")) out[t.targetId] = t.imageUrl;
    }
    return out;
  } catch {
    return {};
  }
});

ipcMain.handle("accounts:add", (_e, d) => {
  vault.accounts.push({
    id: nextId(),
    nickname: (d.nickname || "no-name").trim(),
    cookie: (d.cookie || "").trim(),
    proxy: (d.proxy || "").trim(),
    username: "",
    userid: "",
    status: "?",
    robux: "",
  });
  saveVault();
  return vault.accounts;
});

ipcMain.handle("accounts:update", (_e, { id, data }) => {
  const a = getAcc(id);
  if (a) Object.assign(a, data);
  saveVault();
  return vault.accounts;
});

ipcMain.handle("accounts:delete", (_e, ids) => {
  vault.accounts = vault.accounts.filter((a) => !ids.includes(a.id));
  saveVault();
  return vault.accounts;
});

ipcMain.handle("accounts:get", () => vault.accounts);

ipcMain.handle("account:validate", async (_e, id) => {
  const a = getAcc(id);
  if (!a) return { error: "account not found" };
  const res = await validateCookie(a.cookie, effectiveProxy(a));
  Object.assign(a, {
    status: res.status,
    username: res.username,
    userid: res.userid,
    robux: res.robux,
  });
  saveVault();
  return { account: a, result: res };
});

ipcMain.handle("account:identify", async (_e, id) => {
  const a = getAcc(id);
  if (!a) return { error: "account not found" };
  const res = await validateCookie(a.cookie, "");
  Object.assign(a, {
    status: res.status,
    username: res.username,
    userid: res.userid,
    robux: res.robux,
  });
  saveVault();
  return { account: a, result: res };
});

ipcMain.handle("account:refresh", async (_e, id) => {
  const a = getAcc(id);
  if (!a) return { ok: false, error: "account not found" };
  const res = await refreshCookie(a.cookie, effectiveProxy(a));
  if (res.ok) {
    a.cookie = res.cookie;
    a.status = "Refreshed";
    saveVault();
  }
  return { ...res, account: a };
});

ipcMain.handle("account:testproxy", async (_e, id) => {
  const a = getAcc(id);
  if (!a) return { ok: false, error: "account not found" };
  return await checkProxy(effectiveProxy(a));
});

ipcMain.handle("account:copy", (_e, id) => {
  const a = getAcc(id);
  if (!a) return { ok: false };
  clipboard.writeText(a.cookie);
  return { ok: true };
});

ipcMain.handle("account:openbrowser", async (_e, id) => {
  const a = getAcc(id);
  if (!a) return { ok: false, error: "account not found" };
  return await openBrowser(a);
});

function createWindow() {
  nativeTheme.themeSource = "dark";
  const win = new BrowserWindow({
    width: 1040,
    height: 620,
    minWidth: 820,
    minHeight: 460,
    backgroundColor: "#0c0c10",
    title: "Meowl Shift",
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
