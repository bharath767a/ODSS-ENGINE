#!/usr/bin/env python3
"""
ODSS Secure Data Bridge Server v4 — with Dhan API Integration
==============================================================
Run on your India laptop. Connects to:
  - Dhan Market Data API (primary — real option chains + greeks)
  - AngelOne SmartAPI (secondary — real-time quotes)
  - Yahoo Finance (fallback — always available)

SECURITY:
- Credentials read from environment variables OR config file
- Bridge only fetches market data (quotes, candles, option chains)
- Bridge NEVER places orders or accesses account info
- Token authentication required for all data endpoints

SETUP:
1. pip install fastapi uvicorn requests pyotp
2. Set credentials (environment variables OR config file)
3. python bridge_server.py
4. In separate terminal: ngrok http 8765
5. Tell the cloud engine the ngrok URL

SUPPORTS: All NSE F&O stocks + indices + Dhan option chains with greeks
"""

import os
import sys
import time
import json
import logging
import requests
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

# ============================================================
# CONFIG - CREDENTIALS FROM CONFIG FILE OR ENVIRONMENT
# ============================================================

BRIDGE_TOKEN = os.getenv("BRIDGE_TOKEN", "odss-bridge-secure-2026")
HOST = "0.0.0.0"
PORT = int(os.getenv("BRIDGE_PORT", "8765"))
DATA_TRANSMISSION = True

# Dhan credentials — read from config file (secure, not in code)
DHAN_CONFIG_FILE = os.getenv("DHAN_CONFIG_FILE", "dhan-creds.json")

def load_dhan_config():
    """Load Dhan credentials from config file."""
    try:
        with open(DHAN_CONFIG_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        log.warning(f"Dhan config file not found: {DHAN_CONFIG_FILE}")
        log.warning("Create dhan-creds.json with your API key + access token")
        return None
    except Exception as e:
        log.error(f"Error loading Dhan config: {e}")
        return None

# AngelOne credentials (optional — for secondary quote source)
ANGELONE_API_KEY = os.getenv("ANGELONE_API_KEY", "")
ANGELONE_CLIENT_CODE = os.getenv("ANGELONE_CLIENT_CODE", "")
ANGELONE_PIN = os.getenv("ANGELONE_PIN", "")
ANGELONE_TOTP_SECRET = os.getenv("ANGELONE_TOTP_SECRET", "")

# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler()]
)
log = logging.getLogger("bridge")

# ============================================================
# DHAN API CLIENT
# ============================================================

class DhanClient:
    """Direct Dhan Market Data API client."""

    BASE_URL = "https://api.dhan.co"   # DhanHQ v2 REST base (NOT api.dhan.in)

    # Index underlyings for the option chain (IDX_I segment security ids).
    INDEX_IDS = {"NIFTY": 13, "BANKNIFTY": 25, "FINNIFTY": 27, "MIDCPNIFTY": 442}

    def __init__(self):
        self.config = load_dhan_config()
        self.security_id_map = {}  # {SYMBOL: securityId}
        self.last_config_check = 0
        self._oc_cache = {}          # {underlying: {"ts":..., "data":...}}
        self._expiry_cache = {}      # {"scrip:seg": {"ts":..., "expiry":...}}
        self._last_oc_call = 0.0     # Dhan option chain limit ~1 request / 3s

    def reload_config(self):
        """Reload config every 60s (in case user updated token)."""
        if time.time() - self.last_config_check < 60:
            return
        self.last_config_check = time.time()
        self.config = load_dhan_config()

    def is_configured(self):
        self.reload_config()
        return bool(self.config and self.config.get("accessToken"))

    def get_headers(self):
        self.reload_config()
        if not self.config:
            return {}
        return {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "access-token": self.config.get("accessToken", ""),
            "client-id": self.config.get("clientId", ""),   # required by DhanHQ v2
        }

    def load_security_ids(self):
        """Download Dhan instrument master to map symbols → security IDs."""
        try:
            log.info("Downloading Dhan instrument master...")
            r = requests.get(
                "https://images.dhan.co/api-data/api-scrip-master.csv",
                timeout=30
            )
            if r.status_code != 200:
                log.error(f"Instrument master HTTP {r.status_code}")
                return

            # CSV columns: SEM_EXM_EXCH_ID(0), SEM_SEGMENT(1), SEM_SMST_SECURITY_ID(2),
            # SEM_INSTRUMENT_NAME(3), SEM_EXPIRY_CODE(4), SEM_TRADING_SYMBOL(5), ...
            lines = r.text.split('\n')
            count = 0
            for line in lines:
                parts = line.split(',')
                if len(parts) < 6:
                    continue
                exchange = parts[0].strip()
                segment = parts[1].strip()
                sec_id = parts[2].strip()
                instrument = parts[3].strip()
                symbol = parts[5].strip().upper()
                # NSE cash equities only (segment 'E', instrument 'EQUITY').
                if exchange == 'NSE' and segment == 'E' and instrument == 'EQUITY' and symbol and sec_id:
                    if symbol not in self.security_id_map:
                        self.security_id_map[symbol] = sec_id
                        count += 1
            log.info(f"Loaded {count} NSE equity security IDs from Dhan")
        except Exception as e:
            log.error(f"Failed to load instrument master: {e}")

    def get_security_id(self, symbol):
        """Get Dhan security ID for a symbol."""
        if not self.security_id_map:
            self.load_security_ids()
        return self.security_id_map.get(symbol.upper())

    def _parse_quote_node(self, symbol, node):
        """Parse a single DhanHQ v2 marketfeed/quote node (OHLC is nested)."""
        ltp = float(node.get("last_price", 0) or 0)
        ohlc = node.get("ohlc", {}) or {}
        prev_close = float(ohlc.get("close", 0) or 0) or ltp
        open_price = float(ohlc.get("open", 0) or 0) or ltp
        high = float(ohlc.get("high", 0) or 0) or ltp
        low = float(ohlc.get("low", 0) or 0) or ltp
        volume = int(node.get("volume", 0) or 0)
        vwap = float(node.get("average_price", 0) or 0) or ltp
        change_pct = ((ltp - prev_close) / prev_close * 100) if prev_close > 0 else 0
        return {
            "symbol": symbol, "ltp": ltp, "open": open_price, "high": high, "low": low,
            "close": prev_close, "volume": volume, "vwap": vwap,
            "changePct": change_pct, "source": "DHAN",
        }

    def get_quote(self, symbol):
        """Get real-time quote from Dhan (DhanHQ v2 marketfeed/quote)."""
        if not self.is_configured():
            return None
        sec_id = self.get_security_id(symbol)
        if not sec_id:
            log.warning(f"No security ID found for {symbol}")
            return None
        try:
            r = requests.post(
                f"{self.BASE_URL}/v2/marketfeed/quote",
                headers=self.get_headers(),
                json={"NSE_EQ": [int(sec_id)]},
                timeout=8,
            )
            if r.status_code == 401:
                log.error("Dhan token invalid/expired — regenerate via dhan-login.py")
                return None
            if r.status_code != 200:
                log.warning(f"Dhan quote HTTP {r.status_code} for {symbol}: {r.text[:120]}")
                return None
            node = (r.json().get("data", {}).get("NSE_EQ", {}) or {}).get(str(sec_id))
            if not node:
                return None
            return self._parse_quote_node(symbol, node)
        except Exception as e:
            log.warning(f"Dhan quote failed for {symbol}: {e}")
            return None

    # ---- Option-chain helpers (DhanHQ v2) ----
    def _underlying_ref(self, underlying):
        """Return (UnderlyingScrip, UnderlyingSeg) for an index or stock."""
        u = underlying.upper()
        if u in self.INDEX_IDS:
            return self.INDEX_IDS[u], "IDX_I"
        sec_id = self.get_security_id(u)
        return (int(sec_id), "NSE_EQ") if sec_id else (None, None)

    def _nearest_expiry(self, scrip, seg):
        """Nearest expiry for an underlying, cached for the trading day."""
        key = f"{scrip}:{seg}"
        cached = self._expiry_cache.get(key)
        if cached and time.time() - cached["ts"] < 3600:
            return cached["expiry"]
        try:
            self._respect_oc_rate()
            r = requests.post(
                f"{self.BASE_URL}/v2/optionchain/expirylist",
                headers=self.get_headers(),
                json={"UnderlyingScrip": scrip, "UnderlyingSeg": seg},
                timeout=10,
            )
            if r.status_code != 200:
                log.warning(f"Dhan expirylist HTTP {r.status_code} for {scrip}: {r.text[:120]}")
                return None
            expiries = r.json().get("data", [])
            if not expiries:
                return None
            self._expiry_cache[key] = {"ts": time.time(), "expiry": expiries[0]}
            return expiries[0]
        except Exception as e:
            log.warning(f"Dhan expirylist failed for {scrip}: {e}")
            return None

    def _respect_oc_rate(self):
        """Space option-chain calls ~3s apart (Dhan limit)."""
        wait = 3.5 - (time.time() - self._last_oc_call)
        if wait > 0:
            time.sleep(wait)
        self._last_oc_call = time.time()

    def get_option_chain(self, underlying):
        """Get full option chain with OI + Greeks from Dhan (DhanHQ v2)."""
        if not self.is_configured():
            return None

        underlying = underlying.upper()
        # Short cache to respect Dhan's ~1 request / 3s option-chain limit.
        cached = self._oc_cache.get(underlying)
        if cached and time.time() - cached["ts"] < 4:
            return cached["data"]

        try:
            scrip, seg = self._underlying_ref(underlying)
            if scrip is None:
                log.warning(f"No underlying scrip for {underlying}")
                return None
            expiry = self._nearest_expiry(scrip, seg)
            if not expiry:
                return None

            self._respect_oc_rate()
            r = requests.post(
                f"{self.BASE_URL}/v2/optionchain",
                headers=self.get_headers(),
                json={"UnderlyingScrip": scrip, "UnderlyingSeg": seg, "Expiry": expiry},
                timeout=15,
            )
            if r.status_code == 401:
                log.error("Dhan token invalid/expired — regenerate via dhan-login.py")
                return None
            if r.status_code != 200:
                log.warning(f"Dhan option chain HTTP {r.status_code} for {underlying}: {r.text[:120]}")
                return None

            data = r.json().get("data", {}) or {}
            spot = float(data.get("last_price", 0) or 0)
            oc_map = data.get("oc", {}) or {}
            if not oc_map:
                return None
            # Normalise the {strike: {ce, pe}} map into a list the code below expects.
            strikes = [
                {"strike": float(k), "ce": v.get("ce", {}) or {}, "pe": v.get("pe", {}) or {}}
                for k, v in oc_map.items()
            ]

            # Calculate PCR, max pain, find max OI strikes
            total_call_oi = 0
            total_put_oi = 0
            max_call_oi = 0
            max_call_strike = 0
            max_put_oi = 0
            max_put_strike = 0

            for s in strikes:
                call_oi = int(s.get("ce", {}).get("oi", 0))
                put_oi = int(s.get("pe", {}).get("oi", 0))
                total_call_oi += call_oi
                total_put_oi += put_oi
                if call_oi > max_call_oi:
                    max_call_oi = call_oi
                    max_call_strike = float(s.get("strike", 0))
                if put_oi > max_put_oi:
                    max_put_oi = put_oi
                    max_put_strike = float(s.get("strike", 0))

            pcr = (total_put_oi / total_call_oi) if total_call_oi > 0 else 1.0

            # Max pain calculation
            max_pain_strike = 0
            min_loss = float('inf')
            for test_s in strikes:
                test_price = float(test_s.get("strike", 0))
                total_loss = 0
                for s in strikes:
                    strike_price = float(s.get("strike", 0))
                    if test_price > strike_price:
                        total_loss += (test_price - strike_price) * int(s.get("ce", {}).get("oi", 0))
                    if test_price < strike_price:
                        total_loss += (strike_price - test_price) * int(s.get("pe", {}).get("oi", 0))
                if total_loss < min_loss:
                    min_loss = total_loss
                    max_pain_strike = test_price

            # Build strikes array (limit to 30 strikes around ATM)
            atm_strike = spot
            if strikes:
                atm_strike = min(
                    [float(s.get("strike", 0)) for s in strikes],
                    key=lambda x: abs(x - spot)
                )

            # Sort by distance from ATM, take 30 nearest
            sorted_strikes = sorted(strikes, key=lambda s: abs(float(s.get("strike", 0)) - atm_strike))[:30]
            sorted_strikes = sorted(sorted_strikes, key=lambda s: float(s.get("strike", 0)))

            option_rows = []
            for s in sorted_strikes:
                strike = float(s.get("strike", 0))
                ce = s.get("ce", {})
                pe = s.get("pe", {})
                option_rows.append({
                    "strike": strike,
                    "callLTP": float(ce.get("last_price", 0)),
                    "callOI": int(ce.get("oi", 0)),
                    "callVolume": int(ce.get("volume", 0)),
                    "callIV": float(ce.get("implied_volatility", 0)),
                    "callDelta": float(ce.get("greeks", {}).get("delta", 0)),
                    "callGamma": float(ce.get("greeks", {}).get("gamma", 0)),
                    "callTheta": float(ce.get("greeks", {}).get("theta", 0)),
                    "callVega": float(ce.get("greeks", {}).get("vega", 0)),
                    "putLTP": float(pe.get("last_price", 0)),
                    "putOI": int(pe.get("oi", 0)),
                    "putVolume": int(pe.get("volume", 0)),
                    "putIV": float(pe.get("implied_volatility", 0)),
                    "putDelta": float(pe.get("greeks", {}).get("delta", 0)),
                    "putGamma": float(pe.get("greeks", {}).get("gamma", 0)),
                    "putTheta": float(pe.get("greeks", {}).get("theta", 0)),
                    "putVega": float(pe.get("greeks", {}).get("vega", 0)),
                    "callOIChange": int(ce.get("oi", 0) or 0) - int(ce.get("previous_oi", 0) or 0),
                    "putOIChange": int(pe.get("oi", 0) or 0) - int(pe.get("previous_oi", 0) or 0),
                    "callPrevClose": float(ce.get("previous_close_price", 0) or 0),
                    "putPrevClose": float(pe.get("previous_close_price", 0) or 0),
                })

            total_call_oi_chg = sum(r["callOIChange"] for r in option_rows)
            total_put_oi_chg = sum(r["putOIChange"] for r in option_rows)
            result = {
                "symbol": underlying,
                "spot": spot,
                "atmStrike": atm_strike,
                "pcr": pcr,
                "maxPainStrike": max_pain_strike,
                "maxCallOIStrike": max_call_strike,
                "maxPutOIStrike": max_put_strike,
                "totalCallOI": total_call_oi,
                "totalPutOI": total_put_oi,
                "totalCallOIChange": total_call_oi_chg,
                "totalPutOIChange": total_put_oi_chg,
                "strikes": option_rows,
                "expiry": expiry,
                "source": "DHAN",
            }
            self._oc_cache[underlying] = {"ts": time.time(), "data": result}
            return result
        except Exception as e:
            log.warning(f"Dhan option chain failed for {underlying}: {e}")
            return None

    def get_batch_quotes(self, symbols):
        """Get quotes for multiple symbols in one API call (max 50)."""
        if not self.is_configured():
            return {}

        sec_ids = []
        sym_to_id = {}
        for sym in symbols:
            sec_id = self.get_security_id(sym)
            if sec_id:
                sec_ids.append(int(sec_id))
                sym_to_id[sym] = int(sec_id)

        if not sec_ids:
            return {}

        try:
            r = requests.post(
                f"{self.BASE_URL}/v2/marketfeed/quote",
                headers=self.get_headers(),
                json={"NSE_EQ": sec_ids[:1000]},
                timeout=12,
            )
            if r.status_code != 200:
                log.warning(f"Dhan batch quotes HTTP {r.status_code}: {r.text[:120]}")
                return {}

            nodes = r.json().get("data", {}).get("NSE_EQ", {}) or {}
            result = {}
            id_to_sym = {v: k for k, v in sym_to_id.items()}
            for id_str, node in nodes.items():
                try:
                    sec_id = int(id_str)
                except (TypeError, ValueError):
                    continue
                sym = id_to_sym.get(sec_id)
                if sym:
                    result[sym] = self._parse_quote_node(sym, node)
            return result
        except Exception as e:
            log.warning(f"Dhan batch quotes failed: {e}")
            return {}


# ============================================================
# ANGELONE SESSION (secondary quote source)
# ============================================================

class AngelOneSession:
    """Manages AngelOne API session (secondary quote source)."""

    def __init__(self):
        self.api_key = ANGELONE_API_KEY
        self.client_code = ANGELONE_CLIENT_CODE
        self.pin = ANGELONE_PIN
        self.totp_secret = ANGELONE_TOTP_SECRET
        self.jwt_token = None
        self.connected = False
        self.last_connect = None
        self.base_url = "https://apiconnect.angelone.in"

    def is_configured(self):
        return all([self.api_key, self.client_code, self.pin, self.totp_secret])

    def connect(self):
        if not self.is_configured():
            return False
        try:
            import pyotp
            totp = pyotp.TOTP(self.totp_secret.strip().replace(" ", "").upper()).now()

            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "X-UserType": "USER",
                "X-SourceID": "WEB",
                "X-PrivateKey": self.api_key,
                "X-ClientLocalIP": "127.0.0.1",
                "X-ClientPublicIP": "127.0.0.1",
                "X-MACAddress": "00:00:00:00:00:00",
            }

            r = requests.post(
                f"{self.base_url}/rest/auth/angelbroking/user/v1/loginByPassword",
                json={"clientcode": self.client_code, "password": self.pin, "totp": totp},
                headers=headers,
                timeout=15
            )

            if r.status_code != 200:
                return False

            data = r.json()
            if data.get("status") is False:
                return False

            self.jwt_token = data["data"]["jwtToken"]
            self.connected = True
            self.last_connect = datetime.now()
            log.info("AngelOne CONNECTED (secondary)")
            return True
        except Exception as e:
            log.warning(f"AngelOne connect failed: {e}")
            return False

    def ensure_connected(self):
        if self.connected and self.last_connect:
            elapsed = (datetime.now() - self.last_connect).total_seconds()
            if elapsed < 7 * 3600:
                return True
        return self.connect()


# ============================================================
# YAHOO FINANCE FALLBACK
# ============================================================

YAHOO_MAP = {
    'NIFTY': '^NSEI', 'BANKNIFTY': '^NSEBANK', 'FINNIFTY': '^CNXFIN',
    'MIDCPNIFTY': '^CNXMIDCAP', 'SENSEX': '^BSESN',
}

def ysym(s):
    return YAHOO_MAP.get(s, f"{s}.NS")

def yahoo_quote(symbol):
    try:
        r = requests.get(
            f"https://query2.finance.yahoo.com/v8/finance/chart/{ysym(symbol)}?interval=1d&range=1d",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            timeout=10
        )
        if r.status_code != 200:
            return None
        m = r.json()["chart"]["result"][0]["meta"]
        ltp = m.get("regularMarketPrice", 0)
        prev = m.get("chartPreviousClose", ltp)
        return {
            "symbol": symbol,
            "ltp": ltp,
            "open": m.get("regularMarketOpen", ltp),
            "high": m.get("regularMarketDayHigh", ltp),
            "low": m.get("regularMarketDayLow", ltp),
            "close": prev,
            "volume": m.get("regularMarketVolume", 0),
            "vwap": ltp,
            "changePct": ((ltp - prev) / prev) * 100 if prev > 0 else 0,
            "source": "YAHOO"
        }
    except:
        return None


# ============================================================
# INITIALIZE
# ============================================================

dhan = DhanClient()
angelone = AngelOneSession()

app = FastAPI(title="ODSS Secure Data Bridge v4")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"]
)

@app.middleware("http")
async def verify_token(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    token = request.headers.get("X-Bridge-Token")
    if not token or token != BRIDGE_TOKEN:
        return JSONResponse(status_code=401, content={"error": "Invalid or missing bridge token"})
    return await call_next(request)


# ============================================================
# ENDPOINTS
# ============================================================

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "dhan": {
            "configured": dhan.is_configured(),
            "security_ids_loaded": len(dhan.security_id_map),
        },
        "angelone": {
            "connected": angelone.connected,
            "configured": angelone.is_configured(),
        },
        "yahoo_fallback": True,
        "data_transmission": "ON" if DATA_TRANSMISSION else "OFF",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/quote/{symbol}")
async def get_quote(symbol: str):
    """Get live quote. Tries Dhan first, then AngelOne, then Yahoo."""
    if not DATA_TRANSMISSION:
        raise HTTPException(503, "Data transmission paused")

    symbol = symbol.upper()

    # Try Dhan first
    if dhan.is_configured():
        q = dhan.get_quote(symbol)
        if q:
            return q

    # Fallback to Yahoo
    q = yahoo_quote(symbol)
    if q:
        return q

    raise HTTPException(503, f"No data available for {symbol}")


@app.post("/quotes/batch")
async def get_batch_quotes(symbols: List[str]):
    """Get quotes for multiple symbols. Dhan batch (max 50), Yahoo fallback."""
    if not DATA_TRANSMISSION:
        raise HTTPException(503, "Data transmission paused")

    result = {}

    # Try Dhan batch first
    if dhan.is_configured():
        dhan_quotes = dhan.get_batch_quotes(symbols[:50])
        result.update(dhan_quotes)

    # Fallback to Yahoo for any missing
    missing = [s for s in symbols if s.upper() not in result]
    for sym in missing:
        q = yahoo_quote(sym)
        if q:
            result[sym.upper()] = q

    return {"quotes": result, "count": len(result), "source": "DHAN" if dhan.is_configured() else "YAHOO"}


@app.get("/options/{underlying}")
async def get_options(underlying: str):
    """Get option chain with OI + Greeks from Dhan."""
    if not DATA_TRANSMISSION:
        raise HTTPException(503, "Data transmission paused")

    underlying = underlying.upper()

    if dhan.is_configured():
        oc = dhan.get_option_chain(underlying)
        if oc:
            return oc

    return {"error": "Option chain not available (Dhan not configured or token expired)", "symbol": underlying}


@app.get("/indices")
async def get_indices():
    """Get major index values."""
    if not DATA_TRANSMISSION:
        raise HTTPException(503, "Data transmission paused")

    indices = {}
    for name in ['NIFTY', 'BANKNIFTY', 'FINNIFTY']:
        q = None
        if dhan.is_configured():
            q = dhan.get_quote(name)
        if not q:
            q = yahoo_quote(name)
        if q:
            indices[name] = q

    return {"indices": indices}


# ============================================================
# REAL FII/DII cash-market flows (NSE publishes daily, ~post-close)
# ============================================================
_fiidii_cache = {"ts": 0.0, "data": None}

@app.get("/fiidii")
async def get_fiidii():
    """Real FII/DII provisional cash-market numbers from NSE.
    Returns null data (200) when NSE is unreachable - the dashboard shows an
    honest 'unavailable' instead of fabricated numbers."""
    now = time.time()
    if _fiidii_cache["data"] is not None and now - _fiidii_cache["ts"] < 1800:
        return {"source": "NSE", "cached": True, "data": _fiidii_cache["data"]}
    try:
        ses = requests.Session()
        ua = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
              "Accept-Language": "en-US,en;q=0.9"}
        # NSE requires a cookie warm-up hit before its JSON APIs respond.
        ses.get("https://www.nseindia.com", headers=ua, timeout=8)
        r = ses.get("https://www.nseindia.com/api/fiidiiTradeReact", headers={**ua, "Referer": "https://www.nseindia.com/reports/fii-dii"}, timeout=8)
        r.raise_for_status()
        rows = r.json()
        out = {}
        for row in rows:
            cat = str(row.get("category", "")).upper()
            item = {
                "date": row.get("date"),
                "buyCrore": float(row.get("buyValue") or 0),
                "sellCrore": float(row.get("sellValue") or 0),
                "netCrore": float(row.get("netValue") or 0),
            }
            if "FII" in cat or "FPI" in cat:
                out["fii"] = item
            elif "DII" in cat:
                out["dii"] = item
        if "fii" in out or "dii" in out:
            _fiidii_cache["ts"] = now
            _fiidii_cache["data"] = out
            return {"source": "NSE", "cached": False, "data": out}
        return {"source": "NSE", "data": None, "error": "unexpected response shape"}
    except Exception as e:
        logging.warning(f"fiidii fetch failed: {e}")
        # Serve a stale cache (up to 12h) rather than nothing - still real data.
        if _fiidii_cache["data"] is not None and now - _fiidii_cache["ts"] < 43200:
            return {"source": "NSE", "cached": True, "stale": True, "data": _fiidii_cache["data"]}
        return {"source": "NSE", "data": None, "error": str(e)}


@app.get("/control/status")
async def control_status():
    return {
        "data_transmission": "ON" if DATA_TRANSMISSION else "OFF",
        "paused": not DATA_TRANSMISSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    print()
    print("=" * 60)
    print("  ODSS Secure Data Bridge Server v4 (Dhan + AngelOne + Yahoo)")
    print("=" * 60)
    print(f"  Token:          {BRIDGE_TOKEN}")
    print(f"  Dhan:           {'CONFIGURED' if dhan.is_configured() else 'NOT CONFIGURED'}")
    print(f"  AngelOne:       {'CONFIGURED' if angelone.is_configured() else 'NOT CONFIGURED'}")
    print(f"  Yahoo fallback: ENABLED")
    print(f"  Port:           {PORT}")
    print("=" * 60)
    print()

    # Load Dhan security IDs on startup
    if dhan.is_configured():
        dhan.load_security_ids()

    # Connect AngelOne (secondary)
    if angelone.is_configured():
        angelone.connect()

    print("  SETUP:")
    print("  1. Make sure dhan-creds.json has your access token")
    print("  2. Run: python bridge_server.py")
    print("  3. Run: ngrok http 8765")
    print("  4. Tell the cloud engine the ngrok URL")
    print("=" * 60)
    print()

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
