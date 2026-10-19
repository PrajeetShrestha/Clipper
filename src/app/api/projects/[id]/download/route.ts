import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, promises as fs } from 'fs';
import { Readable } from 'stream';
import { db } from '@/lib/db';
import { guard } from '@/lib/auth';
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(); if (denied) return denied;
  const { id } = await params; const exportId = req.nextUrl.searchParams.get('export');
  if (!exportId) return NextResponse.json({ error: 'Export ID required' }, { status: 400 });
  const exp = await db.export.findFirst({ where: { id: exportId, projectId: id, status: 'complete' } });
  if (!exp?.outputPath) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let size: number; try { size = (await fs.stat(exp.outputPath)).size; } catch { return NextResponse.json({ error: 'Export unavailable' }, { status: 404 }); }
  const stream = Readable.toWeb(createReadStream(exp.outputPath)) as ReadableStream;
  return new NextResponse(stream, { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Content-Disposition': `attachment; filename="clip-${exportId}.mp4"`, 'Cache-Control': 'private, no-store' } });
}
