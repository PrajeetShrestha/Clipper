import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { guard } from '@/lib/auth';
import { queue } from '@/lib/queue';
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(); if (denied) return denied;
  const { id } = await params; const body = await req.json().catch(() => ({}));
  const project = await db.project.findUnique({ where: { id }, include: { tracks: true } });
  if (!project || project.status !== 'ready') return NextResponse.json({ error: 'Project is not ready' }, { status: 400 });
  const start = Number(body.start); const end = Number(body.end); const ratio = String(body.ratio || 'original'); const captions = body.captions !== false;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > project.duration + 0.1 || end - start > 600) return NextResponse.json({ error: 'Choose a clip up to 10 minutes within the video' }, { status: 400 });
  if (!['original', '16:9', '9:16', '1:1'].includes(ratio)) return NextResponse.json({ error: 'Invalid aspect ratio' }, { status: 400 });
  if (captions && !project.tracks.length) return NextResponse.json({ error: 'No captions available; disable captions to export' }, { status: 400 });
  const active = await db.export.count({ where: { status: { in: ['queued', 'processing'] } } });
  if (active >= 3) return NextResponse.json({ error: 'Three exports are already in progress' }, { status: 429 });
  const exp = await db.export.create({ data: { projectId: id, start, end, ratio, captions } });
  try { await queue.add('export', { id: exp.id }, { jobId: `export-${exp.id}` }); }
  catch { await db.export.update({ where: { id: exp.id }, data: { status: 'failed', error: 'Queue unavailable' } }); return NextResponse.json({ error: 'Queue unavailable' }, { status: 503 }); }
  return NextResponse.json({ export: exp }, { status: 201 });
}
