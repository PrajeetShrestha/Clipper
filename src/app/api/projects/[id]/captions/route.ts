import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { guard } from '@/lib/auth';
import { z } from 'zod';
const cue = z.object({ start: z.number().finite().min(0), end: z.number().finite().positive(), text: z.string().min(1).max(500) }).refine(c => c.end > c.start);
const bodySchema = z.object({ language: z.string().min(1), cues: z.array(cue).max(10000) });
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(); if (denied) return denied;
  const { id } = await params; const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid caption data' }, { status: 400 });
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (parsed.data.cues.some(c => c.end > project.duration + 0.1)) return NextResponse.json({ error: 'Caption exceeds video duration' }, { status: 400 });
  const existing = await db.captionTrack.findUnique({ where: { projectId_language: { projectId: id, language: parsed.data.language } } });
  if (!existing) return NextResponse.json({ error: 'Caption track not found' }, { status: 404 });
  const track = await db.captionTrack.update({ where: { id: existing.id }, data: { cues: parsed.data.cues } });
  return NextResponse.json({ track });
}
