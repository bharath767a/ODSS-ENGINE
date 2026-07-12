import { NextRequest, NextResponse } from 'next/server';
import { getConfig, updateConfig, type ODSSConfig } from '@/lib/odss/config';

export const dynamic = 'force-dynamic';

// GET /api/odss/config — current configuration
export async function GET() {
  const config = await getConfig();
  return NextResponse.json(config);
}

// PUT /api/odss/config — update configuration
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ODSSConfig>;
    const updated = await updateConfig(body);
    return NextResponse.json({ ok: true, config: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
