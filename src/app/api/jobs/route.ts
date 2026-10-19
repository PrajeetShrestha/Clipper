import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
export async function GET() {
  const [projects, exports] = await Promise.all([db.project.count({ where: { status: { in: ['queued', 'importing'] } } }), db.export.count({ where: { status: { in: ['queued', 'processing'] } } })]);
  return NextResponse.json({ importing: projects, exporting: exports });
}
