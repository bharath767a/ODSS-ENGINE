# NSE Proxy — Deployment Guide

## Why You Need This

NSE India geo-blocks all non-Indian IP addresses. If your ODSS server is outside India
(this sandbox is in Hong Kong), NSE returns 403 "Access Denied."

The solution: Deploy a tiny proxy function in an Indian region. It fetches NSE data
locally (no geo-block) and relays it to your ODSS server.

**Cost: FREE** (both Vercel and Cloudflare have free tiers)

**Setup time: 5 minutes**

---

## Option A: Vercel (Recommended)

### Prerequisites
- A free Vercel account (sign up at https://vercel.com with GitHub/Google)

### Steps

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Login**
   ```bash
   vercel login
   ```

3. **Deploy the proxy**
   ```bash
   cd /home/z/my-project/nse-proxy/vercel
   vercel
   ```
   - When asked "Link to existing project?" → No
   - Project name: `odss-nse-proxy` (or any name)
   - Framework preset: Other
   - Keep all other defaults

4. **Set a secret (recommended)**
   ```bash
   vercel env add NSE_PROXY_SECRET
   # Enter a random string like: mySecretProxyKey2024
   # Select: Production
   vercel --prod
   ```

5. **Copy the URL**
   After deployment, you'll see:
   ```
   Production: https://odss-nse-proxy-xxx.vercel.app
   ```

6. **Add to ODSS**
   - Open the ODSS dashboard
   - Go to **Data Sources** tab
   - In the "NSE Proxy" section:
     - **NSE Proxy URL**: `https://odss-nse-proxy-xxx.vercel.app`
     - **NSE Proxy Secret**: `mySecretProxyKey2024` (the one you set)
   - Click **Save Credentials**
   - Restart the market service

7. **Verify**
   The NSE provider should now show status `ACTIVE` in the Provider Status panel.

---

## Option B: Cloudflare Worker (Alternative)

### Prerequisites
- A free Cloudflare account (sign up at https://dash.cloudflare.com)

### Steps

1. **Go to Workers & Pages**
   - Login to Cloudflare dashboard
   - Left sidebar → Workers & Pages
   - Click "Create" → "Worker"

2. **Create the worker**
   - Name: `odss-nse-proxy`
   - Click "Deploy"
   - Click "Edit code"

3. **Paste the proxy code**
   - Open `/home/z/my-project/nse-proxy/cloudflare-worker/nse-proxy.js`
   - Copy the entire contents
   - Paste it into the Cloudflare editor (replacing the default code)
   - Click "Deploy"

4. **Copy the URL**
   ```
   https://odss-nse-proxy.<your-subdomain>.workers.dev
   ```

5. **(Optional) Add a secret**
   - Go to Settings → Variables
   - Add `NSE_PROXY_SECRET` = your secret string
   - Click "Save and Deploy"

6. **Add to ODSS**
   - Same as Vercel step 6 above

---

## How It Works

```
Your ODSS Server (Hong Kong)
        │
        │  GET https://your-proxy.vercel.app/?path=/api/option-chain-indices?symbol=NIFTY
        ▼
Vercel Function (Mumbai, India)
        │
        │  GET https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY
        │  (Indian IP — no geo-block)
        ▼
NSE India Servers
        │
        │  JSON response
        ▼
Vercel Function relays JSON back to ODSS
```

## Rate Limits

The proxy enforces:
- **20 requests per minute** (matches NSE's limit)
- **3-second cache** (reduces duplicate calls)

ODSS's RateLimitManager adds another layer of protection.

## Security

- The proxy only allows `/api/` and `/market-data/` paths (no arbitrary URLs)
- Optional `NSE_PROXY_SECRET` header prevents unauthorized use
- No credentials are stored in the proxy — it just relays public NSE data

## Troubleshooting

**Problem**: Proxy returns 401 Unauthorized
**Fix**: The `NSE_PROXY_SECRET` in ODSS's .env must match the one set on Vercel/Cloudflare

**Problem**: Proxy returns 429 Too Many Requests
**Fix**: You're calling NSE too fast. The RateLimitManager should handle this, but if not, increase the cache TTL

**Problem**: Proxy returns 502/504
**Fix**: NSE is temporarily down or blocking. Wait 5 minutes and retry

**Problem**: NSE returns 403 even through the proxy
**Fix**: Make sure your Vercel function is deployed to `bom1` (Mumbai) region. Check `vercel.json` has `"regions": ["bom1"]`

---

## Which Should You Choose?

| Feature | Vercel | Cloudflare Worker |
|---------|--------|-------------------|
| Free tier | ✅ 100GB bandwidth | ✅ 100K requests/day |
| Indian region | ✅ Mumbai (bom1) | ✅ Edge (auto-routes to India) |
| Setup difficulty | Easy (CLI) | Easiest (dashboard) |
| Cold start | ~200ms | ~0ms (no cold starts) |
| Best for | Most users | Simpler setup |

**Recommendation**: Use Cloudflare Worker if you want the simplest setup.
Use Vercel if you already have a Vercel account or want more control.
