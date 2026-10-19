import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { redis } from '@/lib/queue';
import { statfsSync } from 'fs';
import { dataDir } from '@/lib/files';
export async function GET() {
  try { await db.$queryRaw`SELECT 1`; await redis.ping(); const worker = await redis.get('clipper:worker:alive'); const disk = statfsSync(dataDir); const freeBytes = disk.bavail * disk.bsize; if (!worker || freeBytes < 1073741824) throw new Error('Worker unavailable or disk low'); return NextResponse.json({ status: 'ok', freeBytes }); }
  catch { return NextResponse.json({ status: 'unhealthy' }, { status: 503 }); }
}
