import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { spawn } from 'child_process';
import { promises as fs, statfsSync } from 'fs';
import path from 'path';
import { db } from '../lib/db';
import { dataDir, sourceFile, exportFile, tempFile } from '../lib/files';

type Cue = { start: number; end: number; text: string };
const ytdlp = process.env.YTDLP_PATH || '/opt/clipper/.venv/bin/yt-dlp';
const ytArgs = ['--js-runtimes', 'node:/usr/bin/node'];
if (process.env.YTDLP_COOKIES_FILE) ytArgs.push('--cookies', process.env.YTDLP_COOKIES_FILE);
const ffmpeg = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

function run(bin: string, args: string[], timeoutMs: number, onLine?: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let error = ''; let settled = false;
    const finish = (err?: Error) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(output); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error(`${path.basename(bin)} timed out`)); }, timeoutMs);
    child.stdout.on('data', b => { const s = b.toString(); output += s; if (output.length > 25_000_000) { child.kill('SIGKILL'); finish(new Error('Command output too large')); } s.split(/\r?\n/).forEach((line: string) => line && onLine?.(line)); });
    child.stderr.on('data', b => { error = (error + b.toString()).slice(-4000); });
    child.on('error', e => finish(e));
    child.on('close', code => finish(code === 0 ? undefined : new Error(`${path.basename(bin)} failed: ${error.slice(-700)}`)));
  });
}
function importError(error: unknown): string {
  const message = String(error);
  if (/Sign in to confirm you.re not a bot/i.test(message)) return 'YouTube requires sign-in for this video from our server. Ask the administrator to configure YouTube cookies, then import the URL again. Other public videos may still work.';
  if (/cookies? (?:are|is) no longer valid|cookies? have expired/i.test(message)) return 'The configured YouTube cookies have expired. Ask the administrator to refresh them, then import again.';
  return message.slice(0, 700);
}
function time(raw: string): number { const parts = raw.replace(',', '.').split(':').map(Number); return parts.reduce((a, n) => a * 60 + n, 0); }
export function parseVtt(input: string): Cue[] {
  const blocks = input.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const n = lines.findIndex(x => x.includes('-->'));
    if (n < 0) continue;
    const match = lines[n].match(/([\d:.]+)\s*-->\s*([\d:.]+)/); if (!match) continue;
    const start = time(match[1]); const end = time(match[2]);
    const text = lines.slice(n + 1).join(' ').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) cues.push({ start, end, text });
  }
  return cues;
}
function chooseLanguage(info: any): { lang: string; source: string } | null {
  const candidates = [info.subtitles, info.automatic_captions];
  for (let i = 0; i < candidates.length; i++) {
    const tracks = candidates[i] || {};
    const langs = Object.keys(tracks).filter(k => Array.isArray(tracks[k]) && tracks[k].length);
    const lang = langs.find(k => k === 'en') || langs.find(k => k.startsWith('en-')) || langs[0];
    if (lang) return { lang, source: i === 0 ? 'YouTube captions' : 'YouTube auto-captions' };
  }
  return null;
}
async function importProject(id: string) {
  const project = await db.project.findUniqueOrThrow({ where: { id } });
  await db.project.update({ where: { id }, data: { status: 'importing', error: null } });
  const info = JSON.parse(await run(ytdlp, [...ytArgs, '--dump-single-json', '--skip-download', '--no-playlist', project.sourceUrl], 120000));
  const duration = Number(info.duration || 0);
  const maxDuration = Number(process.env.MAX_SOURCE_DURATION || 1800);
  if (!duration || duration > maxDuration) throw new Error(`Video must be under ${Math.round(maxDuration / 60)} minutes`);
  if (info.is_live || info.live_status === 'is_live') throw new Error('Live streams are not supported');
  const track = chooseLanguage(info);
  const available = statfsSync(dataDir); const free = available.bavail * available.bsize;
  const maxBytes = Number(process.env.MAX_SOURCE_BYTES || 536870912);
  if (free < maxBytes * 2) throw new Error('Insufficient storage for import and export');
  await db.project.update({ where: { id }, data: { title: String(info.title || 'Untitled').slice(0, 300), duration, thumbnailUrl: typeof info.thumbnail === 'string' ? info.thumbnail : null, language: track?.lang || null } });
  const template = path.join(dataDir, 'sources', `${id}.%(ext)s`);
  await run(ytdlp, [...ytArgs, '--no-playlist', '--max-filesize', String(maxBytes), '-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]', '--merge-output-format', 'mp4', '-o', template, project.sourceUrl], 900000);
  let media = sourceFile(id);
  try { await fs.stat(media); } catch {
    const files = await fs.readdir(path.join(dataDir, 'sources'));
    const found = files.find(f => f.startsWith(`${id}.`) && !f.endsWith('.part'));
    if (!found) throw new Error('YouTube download produced no media file');
    media = path.join(dataDir, 'sources', found);
  }
  if ((await fs.stat(media)).size > maxBytes) { await fs.rm(media); throw new Error('Source exceeds storage limit'); }
  if (track) {
    try {
      await run(ytdlp, [...ytArgs, '--skip-download', '--no-playlist', '--write-subs', '--write-auto-subs', '--sub-langs', track.lang, '--sub-format', 'vtt', '-o', template, project.sourceUrl], 120000);
      const files = await fs.readdir(path.join(dataDir, 'sources'));
      const vtt = files.find(f => f.startsWith(`${id}.`) && f.endsWith('.vtt'));
      if (vtt) {
        const cues = parseVtt(await fs.readFile(path.join(dataDir, 'sources', vtt), 'utf8'));
        await fs.rm(path.join(dataDir, 'sources', vtt));
        if (cues.length) await db.captionTrack.upsert({ where: { projectId_language: { projectId: id, language: track.lang } }, update: { cues, source: track.source }, create: { projectId: id, language: track.lang, source: track.source, cues } });
      }
    } catch (e) { console.error('Caption retrieval failed:', id, e); }
  }
  await db.project.update({ where: { id }, data: { sourcePath: media, status: 'ready' } });
}
function assTime(seconds: number) { const cs = Math.round(seconds * 100); const h = Math.floor(cs / 360000); const m = Math.floor(cs / 6000) % 60; const s = Math.floor(cs / 100) % 60; return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; }
function assText(text: string) { return text.replace(/[{}]/g, '').replace(/\\/g, '／').replace(/\r?\n/g, '\\N').slice(0, 500); }
function makeAss(cues: Cue[], start: number, end: number, width: number, height: number) {
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,${Math.round(width / 22)},&H00FFFFFF,&H000000FF,&H00000000,&H99000000,-1,0,0,0,100,100,0,0,1,2,1,2,50,50,${Math.round(height * 0.08)},1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return header + cues.filter(c => c.end > start && c.start < end).map(c => `Dialogue: 0,${assTime(Math.max(c.start, start) - start)},${assTime(Math.min(c.end, end) - start)},Default,,0,0,0,,${assText(c.text)}`).join('\n') + '\n';
}
async function exportClip(id: string) {
  const exp = await db.export.findUniqueOrThrow({ where: { id }, include: { project: { include: { tracks: true } } } });
  if (!exp.project.sourcePath) throw new Error('Source video missing');
  await db.export.update({ where: { id }, data: { status: 'processing', progress: 0, error: null } });
  const size = exp.ratio === '9:16' ? [720, 1280] : exp.ratio === '1:1' ? [1080, 1080] : exp.ratio === '16:9' ? [1280, 720] : [1280, 720];
  const filters = exp.ratio === 'original' ? ['scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2', 'setsar=1'] : [`scale=${size[0]}:${size[1]}:force_original_aspect_ratio=increase`, `crop=${size[0]}:${size[1]}`, 'setsar=1'];
  const assPath = tempFile(id, 'ass'); const output = exportFile(id); const partial = tempFile(id, 'mp4');
  try {
    if (exp.captions) {
      const track = exp.project.tracks.find(t => t.language === exp.project.language) || exp.project.tracks[0];
      if (!track) throw new Error('No captions available; disable captions to export');
      await fs.writeFile(assPath, makeAss(track.cues as Cue[], exp.start, exp.end, size[0], size[1]));
      filters.push(`subtitles=${assPath.replace(/:/g, '\\:')}`);
    }
    const duration = exp.end - exp.start;
    await run(ffmpeg, ['-hide_banner', '-y', '-ss', String(exp.start), '-i', exp.project.sourcePath, '-t', String(duration), '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', partial], 900000, line => {
      if (line.startsWith('out_time_ms=')) {
        const pct = Math.min(99, Math.floor(Number(line.slice(12)) / (duration * 1e6) * 100));
        if (Number.isFinite(pct)) void db.export.update({ where: { id }, data: { progress: pct } }).catch(() => {});
      }
    });
    await fs.rename(partial, output);
    await db.export.update({ where: { id }, data: { status: 'complete', progress: 100, outputPath: output } });
  } finally { await Promise.all([fs.rm(assPath, { force: true }), fs.rm(partial, { force: true })]); }
}
const heartbeat = () => { void connection.set('clipper:worker:alive', String(Date.now()), 'EX', 90).catch(e => console.error('Heartbeat failed', e)); };
heartbeat();
setInterval(heartbeat, 30000).unref();
const worker = new Worker('clipper', async (job: Job) => {
  if (job.name === 'import') {
    try { await importProject(job.data.id); } catch (e) { await db.project.update({ where: { id: job.data.id }, data: { status: 'failed', error: importError(e) } }); throw e; }
  } else if (job.name === 'export') {
    try { await exportClip(job.data.id); } catch (e) { await db.export.update({ where: { id: job.data.id }, data: { status: 'failed', error: String(e).slice(0, 700) } }); throw e; }
  }
}, { connection, concurrency: 1 });
worker.on('completed', job => console.log('Completed', job.name, job.id));
worker.on('failed', (job, err) => console.error('Failed', job?.name, job?.id, err.message));
console.log('Clipper worker started');
