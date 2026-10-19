import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
type Part = { start: number; end: number; text: string };
function stamp(n: number) { const ms = Math.round(n * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; }
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id }, select: { analysisStatus: true, analysisTranscript: true } });
  if (!project || project.analysisStatus !== 'complete' || !Array.isArray(project.analysisTranscript)) return NextResponse.json({ error: 'Transcript unavailable' }, { status: 404 });
  const parts = project.analysisTranscript as Part[];
  const srt = req.nextUrl.searchParams.get('format') === 'srt';
  const text = srt ? parts.map((p, i) => `${i + 1}\n${stamp(p.start)} --> ${stamp(p.end)}\n${p.text}\n`).join('\n') : parts.map(p => `[${stamp(p.start)}–${stamp(p.end)}] ${p.text}`).join('\n');
  return new NextResponse(text, { headers: { 'Content-Type': srt ? 'application/x-subrip; charset=utf-8' : 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="clipper-${id}.${srt ? 'srt' : 'txt'}"` } });
}
