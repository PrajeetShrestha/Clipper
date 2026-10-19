export function parseYouTubeUrl(raw: string): string | null {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else if (/^\/(shorts|embed|live)\//.test(u.pathname)) id = u.pathname.split('/')[2];
  }
  return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
}
export const canonicalUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
