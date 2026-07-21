#!/usr/bin/env python3
"""
Dhan Access Token Generator
============================
Run this on the SANDBOX (cloud) terminal every morning before market open.
It generates a fresh access token valid for 24 hours.

PREREQUISITE:
  1. You created /home/z/odss-data/dhan-config.json with your API key + secret
  2. You have your Dhan Client ID ready

USAGE:
  python3 /home/z/my-project/nse-bridge/dhan-login.py

WHAT IT DOES:
  1. Reads your API key + secret from dhan-config.json
  2. Opens the Dhan login URL in your browser
  3. You login with your Dhan credentials
  4. Copy the redirect URL back here
  5. Script extracts the auth code + exchanges for access token
  6. Saves access token to dhan-config.json (valid 24 hours)
"""
import json
import requests
import webbrowser
import urllib.parse
from datetime import datetime

CONFIG_FILE = '/home/z/odss-data/dhan-config.json'

def load_config():
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"ERROR: {CONFIG_FILE} not found.")
        print("Create it first with your API key + secret (see instructions).")
        return None
    except Exception as e:
        print(f"Error reading config: {e}")
        return None

def save_config(config):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)

def main():
    print("=" * 60)
    print("  Dhan Access Token Generator")
    print("=" * 60)
    print()

    config = load_config()
    if not config:
        return

    api_key = config.get('apiKey', '')
    api_secret = config.get('apiSecret', '')
    client_id = config.get('clientId', '')

    if not api_key or not api_secret:
        print("ERROR: apiKey and apiSecret must be in dhan-config.json")
        print('Format: {"clientId": "123456", "apiKey": "xxx", "apiSecret": "xxx"}')
        return

    print(f"Client ID: {client_id}")
    print(f"API Key:   {api_key[:8]}...{api_key[-4:]}")
    print()

    # Step 1: Build the OAuth URL
    redirect_uri = "https://127.0.0.1/"
    auth_url = f"https://api.dhan.in/oauth/authorize?client_id={api_key}&redirect_uri={urllib.parse.quote(redirect_uri)}&response_type=code"

    print("STEP 1: Opening Dhan login page in your browser...")
    print(f"  URL: {auth_url}")
    print()
    try:
        webbrowser.open(auth_url)
    except:
        pass

    print("STEP 2: Login with your Dhan credentials in the browser.")
    print("        After login, you'll be redirected to a URL like:")
    print("        https://127.0.0.1/?code=AUTHORIZATION_CODE")
    print()

    # Step 2: Get the redirect URL from user
    redirect_url = input("STEP 3: Paste the FULL redirect URL here:\n> ").strip()

    if not redirect_url:
        print("ERROR: No URL provided")
        return

    # Extract auth code
    parsed = urllib.parse.urlparse(redirect_url)
    params = urllib.parse.parse_qs(parsed.query)
    auth_code = params.get('code', [None])[0]

    if not auth_code:
        print("ERROR: Could not find 'code' in the URL")
        print(f"Parsed URL: {redirect_url}")
        return

    print(f"\nExtracted auth code: {auth_code[:10]}...")
    print()

    # Step 3: Exchange auth code for access token
    print("STEP 4: Exchanging auth code for access token...")

    token_url = "https://api.dhan.in/oauth/token"
    token_data = {
        "client_id": api_key,
        "client_secret": api_secret,
        "code": auth_code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }

    try:
        r = requests.post(token_url, json=token_data, timeout=15)
        if r.status_code != 200:
            print(f"ERROR: Token exchange failed (HTTP {r.status_code})")
            print(f"Response: {r.text}")
            return

        token_response = r.json()
        access_token = token_response.get('access_token')

        if not access_token:
            print(f"ERROR: No access_token in response: {token_response}")
            return

        # Save to config
        config['accessToken'] = access_token
        config['tokenGeneratedAt'] = datetime.now().isoformat()
        config['tokenExpiresAt'] = token_response.get('expires_in', '86400')
        save_config(config)

        print()
        print("=" * 60)
        print("  SUCCESS! Access token saved to dhan-config.json")
        print("=" * 60)
        print(f"  Token: {access_token[:10]}...{access_token[-4:]}")
        print(f"  Valid: 24 hours")
        print(f"  File:  {CONFIG_FILE}")
        print()
        print("  The engine will automatically use this token for market data.")
        print("  Run this script again tomorrow morning for a fresh token.")
        print("=" * 60)

    except Exception as e:
        print(f"ERROR: Token exchange failed: {e}")

if __name__ == '__main__':
    main()
