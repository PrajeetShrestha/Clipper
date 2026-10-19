import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { guard } from '@/lib/auth';
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(); if (denied) return denied;
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id }, include: { tracks: true, exports: { orderBy: { createdAt: 'desc' }, take: 10 } } });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { sourcePath, ...safe } = project;
  return NextResponse.json({ project: { ...safe, exports: safe.exports.map(({ outputPath, ...exp }) => exp) } });
}
