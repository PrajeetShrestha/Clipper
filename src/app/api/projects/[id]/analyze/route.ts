import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { queue } from '@/lib/queue';
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project || project.status !== 'ready' || !project.sourcePath) return NextResponse.json({ error: 'Project is not ready' }, { status: 400 });
  if (['queued','processing'].includes(project.analysisStatus)) return NextResponse.json({ error: 'Analysis is already running' }, { status: 409 });
  const active = await db.project.count({ where: { analysisStatus: { in: ['queued','processing'] } } });
  if (active >= 2) return NextResponse.json({ error: 'AI analysis is busy; try later' }, { status: 429 });
  await db.project.update({ where: { id }, data: { analysisStatus: 'queued', analysisProgress: 0, analysisError: null, suggestions: undefined } });
  try { await queue.add('analyze', { id }, { jobId: `analyze-${id}-${Date.now()}`, attempts: 1 }); }
  catch { await db.project.update({ where: { id }, data: { analysisStatus: 'failed', analysisError: 'Queue unavailable' } }); return NextResponse.json({ error: 'Queue unavailable' }, { status: 503 }); }
  return NextResponse.json({ ok: true }, { status: 202 });
}
