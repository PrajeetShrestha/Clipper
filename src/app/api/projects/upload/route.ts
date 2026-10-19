import { NextRequest, NextResponse } from 'next/server';
import { createWriteStream, promises as fs, statfsSync } from 'node:fs';
import { once } from 'node:events';
import { basename } from 'node:path';
import { db } from '@/lib/db';
import { guard } from '@/lib/auth';
import { queue } from '@/lib/queue';
import { dataDir, sourceFile } from '@/lib/files';
import { maxSourceBytes } from '@/lib/direct-video';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  const denied = await guard(); if (denied) return denied;
  if (!req.body) return NextResponse.json({ error: 'Choose a video file' }, { status: 400 });
  const length = Number(req.headers.get('content-length') || 0);
  if (length > maxSourceBytes) return NextResponse.json({ error: 'File exceeds size limit' }, { status: 413 });
  const active = await db.project.count({ where: { status: { in: ['queued', 'importing'] } } });
  if (active >= 2) return NextResponse.json({ error: 'Two imports are already in progress' }, { status: 429 });
  if (statfsSync(dataDir).bavail * statfsSync(dataDir).bsize < maxSourceBytes * 2) return NextResponse.json({ error: 'Insufficient storage' }, { status: 507 });
  let title = 'Uploaded video';
  try { title = basename(decodeURIComponent(req.headers.get('x-filename') || title)).slice(0, 300) || title; } catch { /* use default */ }
  const project = await db.project.create({ data: { sourceUrl: '', title, status: 'importing' } });
  const destination = sourceFile(project.id);
  const writer = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  let size = 0;
  try {
    const reader = req.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxSourceBytes) throw new Error('File exceeds size limit');
      if (!writer.write(value)) await once(writer, 'drain');
    }
    if (!size) throw new Error('Choose a non-empty video file');
    writer.end(); await once(writer, 'finish');
    await queue.add('import', { id: project.id }, { jobId: `import-${project.id}` });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    writer.destroy();
    await fs.rm(destination, { force: true }).catch(() => {});
    const message = error instanceof Error ? error.message : 'Upload failed';
    await db.project.update({ where: { id: project.id }, data: { status: 'failed', error: message } });
    return NextResponse.json({ error: message }, { status: /size limit/.test(message) ? 413 : 400 });
  }
}
