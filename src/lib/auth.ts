import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
const token = () => createHmac('sha256', process.env.SESSION_SECRET || '').update('clipper-admin-v1').digest('hex');
export function validPassword(value: string) {
  const actual = Buffer.from(process.env.ADMIN_PASSWORD || '');
  const supplied = Buffer.from(value);
  return actual.length > 0 && actual.length === supplied.length && timingSafeEqual(actual, supplied);
}
export async function authorized() {
  const value = (await cookies()).get('clipper_session')?.value || '';
  const expected = token();
  return value.length === expected.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
export function sessionToken() { return token(); }
export async function guard() { return (await authorized()) ? null : NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
