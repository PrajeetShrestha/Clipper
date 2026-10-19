import { NextRequest, NextResponse } from 'next/server';
import { sessionToken, validPassword } from '@/lib/auth';
import { redis } from '@/lib/queue';
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ip = req.headers.get('x-real-ip') || 'local';
  const key = `clipper:login:${ip}`;
  const attempts = await redis.incr(key);
  if (attempts === 1) await redis.expire(key, 900);
  if (attempts > 10) return NextResponse.json({ error: 'Too many attempts; try again later' }, { status: 429 });
  if (!validPassword(String(body.password || ''))) return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  await redis.del(key);
  const res = NextResponse.json({ ok: true });
  res.cookies.set('clipper_session', sessionToken(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return res;
}
