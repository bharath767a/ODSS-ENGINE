# Connecting Dhan → Bridge → ODSS Engine

Real quotes, option chains, OI and greeks come from **Dhan**. Because a cloud/PC
can't call Dhan's API directly with your session, the data flows through a small
**bridge** that runs on your India laptop and is exposed to the engine via
**ngrok**:

```
   Dhan API  ←→  bridge_server_v4.py (laptop, port 8765)  ←→  ngrok (https)  ←→  ODSS engine
                     ▲ reads dhan-creds.json                       ▲ reads bridge-config.json
```

There are **three connection points**. Do them in order.

> **Running everything on ONE PC (your current setup)?** Then you don't need
> ngrok at all — the bridge runs on `localhost:8765` and the engine points
> straight to it. `start-odss.bat` already launches the bridge for you. Skip the
> ngrok step (2) and in step (3) use `"url": "http://localhost:8765"`.

> ⚠️ **The credentials file is `nse-bridge\dhan-creds.json` — NOT
> `dhan-creds-template.json`.** The template is only a sample. Every script and
> the bridge read `dhan-creds.json`. If you edit the template, nothing happens.
> (Copy the template to `dhan-creds.json` once, then keep the token updated in
> `dhan-creds.json`.)

---

## 1. Connect Dhan → Bridge  (on your India laptop)

**File:** `nse-bridge\dhan-creds.json`  (git-ignored — you create it once)

```json
{
  "clientId":    "1111422127",
  "apiKey":      "YOUR_API_KEY",
  "apiSecret":   "YOUR_API_SECRET",
  "accessToken": "PASTE_TODAYS_TOKEN_HERE"
}
```

Start the bridge (once per day, keep the window open):

```bat
cd nse-bridge
python dhan-login.py          REM generates today's access token into dhan-creds.json
python bridge_server_v4.py    REM starts the bridge on port 8765
```

> The bridge prints `Dhan: CONFIGURED`. It re-reads `dhan-creds.json` **every 60
> seconds**, so if you refresh the token you do NOT need to restart it.

---

## 2. Connect Bridge → Internet  (ngrok, on the laptop)

```bat
ngrok http 8765
```

Copy the HTTPS forwarding URL it shows, e.g. `https://xxxx-xxxx.ngrok-free.dev`.
On the **free** tier this URL **changes every time you restart ngrok** — whenever
it changes you must update step 3.

---

## 3. Connect Bridge → ODSS Engine  (on the machine running the engine)

**File (EXACT path):** `C:\Users\<your-windows-username>\.odss-data\bridge-config.json`

> `.odss-data` is the engine's data dir (`ODSS_DATA_DIR`). On this PC it is
> `C:\Users\eswar\.odss-data`. On Replit set `ODSS_DATA_DIR` to a persistent dir
> and put the file there.

```json
{
  "url":     "https://xxxx-xxxx.ngrok-free.dev",
  "token":   "odss-bridge-secure-2026",
  "enabled": true
}
```

- `url` = the ngrok HTTPS URL from step 2 (no trailing slash).
- `token` = the bridge's `X-Bridge-Token` (default `odss-bridge-secure-2026`; only
  change it if you changed `BRIDGE_TOKEN` in the bridge server).

The engine re-reads this file automatically (cached ~30s), so a URL update takes
effect within about half a minute — no engine restart needed.

---

## THE DAILY TOKEN (the thing that expires)

- **What expires:** the Dhan **access token** (roughly every 24h).
- **Where it lives:** `nse-bridge\dhan-creds.json` → the `"accessToken"` field. **This exact file — not the `-template` one.**
- **How to refresh:** paste a fresh token into `"accessToken"` in `dhan-creds.json`, or run `python dhan-login.py` in `nse-bridge` (it opens the Dhan login and rewrites the file).
- **No restart needed:** the bridge reloads it within 60 seconds.

### Verify it actually worked (this is important)

`configured: true` in `/health` only means a token *exists* — not that it's valid.
Confirm real Dhan data with:

```bat
curl -H "X-Bridge-Token: odss-bridge-secure-2026" -H "ngrok-skip-browser-warning: true" https://YOUR-NGROK-URL/quote/RELIANCE
```

- `"source":"DHAN"`  → real Dhan is live ✅
- `"source":"YAHOO"` → token is stale/expired → refresh it (see above)

Option chains only populate during market hours (09:15–15:30 IST).

---

## Every-morning checklist

1. **Laptop:** `cd nse-bridge` → `python dhan-login.py` → `python bridge_server_v4.py`
2. **Laptop:** `ngrok http 8765` → copy the HTTPS URL
3. **If the ngrok URL changed:** update `url` in `C:\Users\<you>\.odss-data\bridge-config.json`
4. **Engine PC:** double-click **`start-odss.bat`** (opens Market Service + Web + browser)
5. Verify a quote shows `"source":"DHAN"` (command above). Done — dashboard at http://localhost:3000

**First-time only** (before the first `start-odss.bat`): from the repo folder run
`bun install`, then `npm install socket.io`, then `npx prisma db push`.
