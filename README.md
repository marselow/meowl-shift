# Meowl Shift

A Windows desktop app (Electron) for managing several of **your own** Roblox
accounts. It keeps each account's `.ROBLOSECURITY` cookie encrypted, checks
which cookies still work, and opens each account in its own isolated browser
session, so you never have to log out of one account to use another.

## Features

- **Encrypted vault**: cookies are stored locally with AES-256-CBC, using a key
  derived from your master password (PBKDF2-SHA256, 200k iterations). Nothing
  is uploaded anywhere.
- **Validate / Validate all**: checks each cookie against the official Roblox
  API and shows the username, user ID and Robux balance.
- **Isolated sessions**: every account opens in its own persistent browser
  partition, so switching accounts never logs out the others.
- **Proxies**: set one global proxy, or a separate proxy for each account
  (`http://user:pass@host:port`). **Test proxy** shows the exit country, city,
  HTTPS support and whether the IP looks like a datacenter.
- **Refresh / Refresh all**: gets a fresh cookie through the account's proxy,
  using Roblox's `authentication-ticket` flow (see the warning below).
- **Copy cookie** in one click, and **cookie origin tags** that record where
  each cookie was created.
- **Bulk add**: paste many cookies at once, one per line. Each account is
  identified automatically (username, ID and avatar) and duplicates are skipped.
- **Last verified**, **Delete all** and a **Settings** screen (avatars, reduced
  motion, how often cookies should be rechecked).

## A note on "region-free" cookies

There is no such thing as a region-free or global cookie. A cookie is only a
session token: Roblox decides on its servers which region it trusts, based on
the IP the cookie was created on and the IP it is used from. What this app does
is keep each session isolated and its IP consistent.

## Download

Get the portable `MeowlShift.exe` from the
[Releases](../../releases) page. It is not code-signed, so Windows SmartScreen
will warn you the first time: click **More info → Run anyway**.

## Build from source

Requires Windows and Node.js 18 or newer.

```bash
cd "Meowl Shift"
npm install
npm start          # run in development
npm run dist       # build MeowlShift.exe into "Meowl Shift/dist/"
```

If `npm start` fails because the Electron binary is missing (some npm versions
skip install scripts), run `node node_modules/electron/install.js` and try
again.

## Where data is stored

The vault is saved as `accounts.dat` in `%APPDATA%\Meowl Shift`. You can open
that folder from **Settings** inside the app. If you forget the master
password, the vault cannot be recovered.

## Network requests

The app only talks to:

- `users.roblox.com`, `economy.roblox.com`, `auth.roblox.com`,
  `thumbnails.roblox.com`: validation, refresh and avatars
- `ipinfo.io`: proxy testing
- whatever proxy you configure yourself

## Important

- **Refreshing a cookie invalidates the old one.** Anywhere the old cookie is
  pasted will stop working until you paste the new one.
- When you add an account, the app checks the cookie over your own connection,
  not through a proxy, so the cookie stays tied to its original location.
- Only use proxies you trust: a malicious proxy can read your traffic.
- This project is not affiliated with or endorsed by Roblox Corporation. Use it
  only with accounts you own, and follow the Roblox Terms of Use. You are
  responsible for how you use it.

## License

[MIT](LICENSE)
