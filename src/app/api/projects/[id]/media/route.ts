import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, promises as fs } from 'fs';
import { Readable } from 'stream';
import { db } from '@/lib/db';
import { guard } from '@/lib/auth';
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(); if (denied) return denied;
  const { id } = await params; const project = await db.project.findUnique({ where: { id } });
  if (!project?.sourcePath) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let size: number; try { size = (await fs.stat(project.sourcePath)).size; } catch { return NextResponse.json({ error: 'Media unavailable' }, { status: 404 }); }
  const range = req.headers.get('range'); const match = range?.match(/^bytes=(\d+)-(\d*)$/);
  if (range && !match) return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const start = match ? Number(match[1]) : 0; const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : (match ? Math.min(start + 4 * 1024 * 1024 - 1, size - 1) : size - 1);
  if (start >= size || end < start) return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const stream = Readable.toWeb(createReadStream(project.sourcePath, { start, end })) as ReadableStream;
  const extension = project.title.toLowerCase().match(/\.(webm|mov|m4v|mkv)$/)?.[1];
  const mime = extension === 'webm' ? 'video/webm' : extension === 'mov' ? 'video/quicktime' : extension === 'm4v' ? 'video/x-m4v' : extension === 'mkv' ? 'video/x-matroska' : 'video/mp4';
  return new NextResponse(stream, { status: match ? 206 : 200, headers: { 'Content-Type': mime, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Cache-Control': 'private, no-store' } });
}
