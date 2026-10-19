import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { createWriteStream, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export const maxSourceBytes = Number(process.env.MAX_SOURCE_BYTES || 1073741824);
const extensions = /\.(mp4|m4v|mov|webm|mkv)$/i;
export function directVideoUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !extensions.test(url.pathname)) return null;
    return url;
  } catch { return null; }
}
function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const a = address.split('.').map(Number);
    return !(a[0] === 0 || a[0] === 10 || a[0] === 127 || a[0] >= 224 || a[0] === 169 && a[1] === 254 || a[0] === 172 && a[1] >= 16 && a[1] <= 31 || a[0] === 192 && a[1] === 168 || a[0] === 100 && a[1] >= 64 && a[1] <= 127 || a[0] === 192 && a[1] === 0 && a[2] === 0 || a[0] === 192 && a[1] === 0 && a[2] === 2 || a[0] === 198 && a[1] >= 18 && a[1] <= 19 || a[0] === 198 && a[1] === 51 && a[2] === 100 || a[0] === 203 && a[1] === 0 && a[2] === 113);
  }
  if (isIP(address) === 6) return !(/^(::|::1$|f[c-d]|fe[89ab]|ff|2001:db8:)/i.test(address) || address.toLowerCase().startsWith('::ffff:'));
  return false;
}
async function request(url: URL): Promise<http.IncomingMessage> {
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Video URL must resolve to a public address');
  const chosen = addresses[0];
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.get(url, { lookup: (_host, opts, cb) => { if (opts.all) (cb as (...args: unknown[]) => void)(null, [chosen]); else cb(null, chosen.address, chosen.family); }, headers: { 'User-Agent': 'Clipper/1.0', Accept: 'video/*,application/octet-stream' }, timeout: 30000 }, resolve);
    req.on('timeout', () => req.destroy(new Error('Video server timed out')));
    req.on('error', reject);
  });
}
export async function downloadDirectVideo(raw: string, destination: string): Promise<void> {
  const initial = directVideoUrl(raw);
  if (!initial) throw new Error('Enter a direct .mp4, .m4v, .mov, .webm, or .mkv file URL');
  let url: URL = initial;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await request(url);
    const status = response.statusCode || 0;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers.location; response.resume();
      if (!location || redirects === 3) throw new Error('Too many video URL redirects');
      const next: URL = new URL(location, url);
      if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password || next.port) throw new Error('Invalid video redirect');
      url = next; continue;
    }
    if (status !== 200) { response.resume(); throw new Error(`Video server returned HTTP ${status}`); }
    if (Number(response.headers['content-length'] || 0) > maxSourceBytes) { response.destroy(); throw new Error('Source exceeds size limit'); }
    let bytes = 0;
    const limit = new Transform({ transform(chunk, _encoding, cb) { bytes += chunk.length; cb(bytes > maxSourceBytes ? new Error('Source exceeds size limit') : null, chunk); } });
    try { await pipeline(response, limit, createWriteStream(destination, { flags: 'wx', mode: 0o600 })); }
    catch (error) { await fs.rm(destination, { force: true }); throw error; }
    if (!bytes) { await fs.rm(destination, { force: true }); throw new Error('Video server returned an empty file'); }
    return;
  }
}
