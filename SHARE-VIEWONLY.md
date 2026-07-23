# Sharing a read-only, expiring link (for a mentor)

`share-viewonly.bat` creates a **public, read-only** link to the live engine that:
- shows the live dashboard (picks, who's-in-control, positions, NIFTY, performance),
- **hides every control** — no Take / Close / Reset / Scan, no Config or Data-Sources tabs,
- **exposes no source code** (production build, no source maps),
- refuses every write and blocks the credentials/bridge endpoints (server middleware),
- **auto-expires at 15:31 IST** (after market close).

Your own full dashboard on `http://localhost:3000` is untouched and keeps all controls.

## How to share (during market hours)
1. Make sure the engine is running (`start-odss.bat`).
2. Double-click **`share-viewonly.bat`**.
3. It builds the view-only site on **port 3001** and opens an **ngrok** window.
4. Copy the `https://….ngrok-free.dev` URL from the ngrok window → send it to your mentor.
5. Leave the two windows open. The link dies automatically at 15:31 IST.

Tomorrow, run it again for a **new** URL (also expires that day). To kill it early, close the ngrok window (or the launcher window).

## What the mentor can / can't do
| Can | Can't |
|-----|-------|
| Watch live picks, control reads, positions, NIFTF, market brief | Take/close trades, reset, scan |
| See how the engine performs in real time | See the source code or the engine internals |
| — | Open Config / Data Sources / credentials |
| — | Change anything (all writes return 403) |

## Notes
- Requires **ngrok** (already installed for the bridge) and a one-time `ngrok config add-authtoken <token>` if not done.
- Remote viewers get live data by polling the state API every 4s (no local socket needed), so a single `ngrok http 3001` is enough.
- Anyone with the URL can view while it's live — share it only with your mentor, and it expires the same day.
