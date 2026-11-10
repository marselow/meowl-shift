"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  vaultStatus: () => ipcRenderer.invoke("vault:status"),
  unlock: (pw) => ipcRenderer.invoke("vault:unlock", pw),
  create: (pw) => ipcRenderer.invoke("vault:create", pw),
  add: (d) => ipcRenderer.invoke("accounts:add", d),
  update: (id, data) => ipcRenderer.invoke("accounts:update", { id, data }),
  remove: (ids) => ipcRenderer.invoke("accounts:delete", ids),
  get: () => ipcRenderer.invoke("accounts:get"),
  setGlobalProxy: (proxy) => ipcRenderer.invoke("vault:setGlobalProxy", proxy),
  testProxyValue: (proxy) => ipcRenderer.invoke("proxy:test", proxy),
  validate: (id) => ipcRenderer.invoke("account:validate", id),
  identify: (id) => ipcRenderer.invoke("account:identify", id),
  refresh: (id) => ipcRenderer.invoke("account:refresh", id),
  testProxy: (id) => ipcRenderer.invoke("account:testproxy", id),
  copy: (id) => ipcRenderer.invoke("account:copy", id),
  openBrowser: (id) => ipcRenderer.invoke("account:openbrowser", id),
  headshots: (userIds) => ipcRenderer.invoke("avatar:headshots", userIds),
  userName: process.env.USERNAME || process.env.USER || "",
  electronVersion: process.versions.electron,
  appInfo: () => ipcRenderer.invoke("app:info"),
  openDataFolder: () => ipcRenderer.invoke("app:openDataFolder"),
});
