import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const ENV_PATH = path.join(process.cwd(), '.env');

// Credential field definitions (which fields exist for each provider)
const CREDENTIAL_FIELDS = {
  angelone: [
    { key: 'ANGEL_API_KEY', label: 'API Key', required: true, type: 'text' },
    { key: 'ANGEL_API_SECRET', label: 'API Secret', required: true, type: 'password' },
    { key: 'ANGEL_CLIENT_CODE', label: 'Client Code', required: true, type: 'text' },
    { key: 'ANGEL_PIN', label: 'MPIN / PIN', required: true, type: 'password' },
  ],
  upstox: [
    { key: 'UPSTOX_API_KEY', label: 'API Key', required: true, type: 'text' },
    { key: 'UPSTOX_API_SECRET', label: 'API Secret', required: true, type: 'password' },
    { key: 'UPSTOX_ACCESS_TOKEN', label: 'Access Token', required: true, type: 'password' },
    { key: 'UPSTOX_REDIRECT_URI', label: 'Redirect URI', required: false, type: 'text' },
  ],
  server: [
    { key: 'SERVER_PUBLIC_IP', label: 'Server Public IP', required: true, type: 'text' },
  ],
  nse_proxy: [
    { key: 'NSE_PROXY_URL', label: 'NSE Proxy URL (Vercel/Cloudflare)', required: false, type: 'text' },
    { key: 'NSE_PROXY_SECRET', label: 'NSE Proxy Secret', required: false, type: 'password' },
  ],
};

function readEnvFile(): Record<string, string> {
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function writeEnvFile(env: Record<string, string>): void {
  const lines: string[] = [
    'DATABASE_URL=file:/home/z/my-project/db/custom.db',
    '',
    '# ===========================================================================',
    '# ODSS Data Provider Credentials',
    '# ===========================================================================',
    '# These are YOUR credentials, stored locally. Never shared or logged.',
    '# ===========================================================================',
    '',
    '# --- Angel One SmartAPI ---',
  ];

  for (const field of CREDENTIAL_FIELDS.angelone) {
    lines.push(`${field.key}=${env[field.key] ?? ''}`);
  }
  lines.push('');
  lines.push('# --- Server IP ---');
  for (const field of CREDENTIAL_FIELDS.server) {
    lines.push(`${field.key}=${env[field.key] ?? ''}`);
  }
  lines.push('');
  lines.push('# --- Upstox API v2 ---');
  for (const field of CREDENTIAL_FIELDS.upstox) {
    lines.push(`${field.key}=${env[field.key] ?? ''}`);
  }
  lines.push('');
  lines.push('# --- NSE Proxy (Vercel/Cloudflare in Mumbai region) ---');
  lines.push('# Optional but recommended. Bypasses NSE geo-block on non-Indian servers.');
  for (const field of CREDENTIAL_FIELDS.nse_proxy) {
    lines.push(`${field.key}=${env[field.key] ?? ''}`);
  }
  lines.push('');
  lines.push('# --- Data Source Selection ---');
  lines.push('DATA_PROVIDER=AUTO');
  lines.push('');

  fs.writeFileSync(ENV_PATH, lines.join('\n'));
}

// GET /api/odss/credentials — returns field definitions + whether each is set (NOT the values)
export async function GET() {
  const env = readEnvFile();
  const providers = Object.entries(CREDENTIAL_FIELDS).map(([provider, fields]) => ({
    provider,
    fields: fields.map((f) => ({
      ...f,
      isSet: !!(env[f.key] && env[f.key].length > 0),
      // Return masked preview — never the actual value
      maskedValue: env[f.key]
        ? env[f.key].slice(0, 4) + '••••••••' + env[f.key].slice(-2)
        : '',
    })),
  }));

  return NextResponse.json({ providers });
}

// PUT /api/odss/credentials — updates credentials in .env
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { credentials } = body as { credentials: Record<string, string> };

    if (!credentials || typeof credentials !== 'object') {
      return NextResponse.json({ error: 'credentials object required' }, { status: 400 });
    }

    // Read current env, merge with new credentials
    const env = readEnvFile();
    for (const [key, value] of Object.entries(credentials)) {
      // Only update known credential fields (security: prevent arbitrary env writes)
      const allKeys = [
        ...CREDENTIAL_FIELDS.angelone,
        ...CREDENTIAL_FIELDS.upstox,
        ...CREDENTIAL_FIELDS.server,
        ...CREDENTIAL_FIELDS.nse_proxy,
      ].map((f) => f.key);
      if (allKeys.includes(key)) {
        env[key] = value;
      }
    }

    writeEnvFile(env);

    return NextResponse.json({
      ok: true,
      message: 'Credentials saved. Restart the market service to apply changes.',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/odss/credentials — clears a specific provider's credentials
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const provider = searchParams.get('provider');
    if (!provider || !CREDENTIAL_FIELDS[provider as keyof typeof CREDENTIAL_FIELDS]) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    const env = readEnvFile();
    for (const field of CREDENTIAL_FIELDS[provider as keyof typeof CREDENTIAL_FIELDS]) {
      env[field.key] = '';
    }
    writeEnvFile(env);

    return NextResponse.json({ ok: true, message: `${provider} credentials cleared.` });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
