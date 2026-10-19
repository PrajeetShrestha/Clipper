import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id }, include: { tracks: true, exports: { orderBy: { createdAt: 'desc' }, take: 10 } } });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { sourcePath, ...safe } = project;
  return NextResponse.json({ project: { ...safe, exports: safe.exports.map(({ outputPath, ...exp }) => exp) } });
}
