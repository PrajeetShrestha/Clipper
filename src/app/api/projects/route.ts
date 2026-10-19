import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { guard } from '@/lib/auth';
import { queue } from '@/lib/queue';
import { directVideoUrl } from '@/lib/direct-video';
export async function GET() {
  const denied = await guard(); if (denied) return denied;
  const projects = await db.project.findMany({ orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, title: true, duration: true, thumbnailUrl: true, status: true, error: true, language: true, youtubeId: true, createdAt: true } });
  return NextResponse.json({ projects });
}
export async function POST(req: NextRequest) {
  const denied = await guard(); if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const url = directVideoUrl(String(body.url || ''));
  if (!url) return NextResponse.json({ error: 'Enter a direct video file URL (.mp4, .m4v, .mov, .webm, or .mkv). For YouTube or streaming sites, upload a video file instead.' }, { status: 400 });
  const active = await db.project.count({ where: { status: { in: ['queued', 'importing'] } } });
  if (active >= 2) return NextResponse.json({ error: 'Two imports are already in progress' }, { status: 429 });
  const project = await db.project.create({ data: { sourceUrl: url.toString(), title: url.pathname.split('/').pop()?.slice(0, 300) || 'Video' } });
  try { await queue.add('import', { id: project.id }, { jobId: `import-${project.id}` }); }
  catch { await db.project.update({ where: { id: project.id }, data: { status: 'failed', error: 'Queue unavailable' } }); return NextResponse.json({ error: 'Queue unavailable' }, { status: 503 }); }
  return NextResponse.json({ project }, { status: 201 });
}
