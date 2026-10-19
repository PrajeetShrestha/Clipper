'use strict';
// Dedicated Unix-socket bridge: Clipper never receives OpenClaw credentials.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const socket = '/run/clipper-ai/openclaw.sock';
const cli = '/root/.openclaw/tmp/agent-cli/openclaw';
const agent = 'clipper_dev';
function run(args, timeout) {
  return new Promise((resolve, reject) => execFile(cli, args, { timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' } }, (error, stdout) => {
    if (error) return reject(new Error(`OpenClaw inference failed: ${error.message.slice(0, 250)}`));
    const first = stdout.indexOf('{');
    if (first < 0) return reject(new Error('OpenClaw returned no JSON'));
    try { const result = JSON.parse(stdout.slice(first)); if (!result.ok) throw new Error('Inference unavailable'); resolve(result.outputs?.[0]?.text || ''); }
    catch (e) { reject(e); }
  }));
}
let active = 0;
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !['/transcribe','/analyze'].includes(req.url)) { res.writeHead(404).end(); return; }
  if (active >= 2) { res.writeHead(429).end(JSON.stringify({ error: 'AI busy' })); return; }
  active++;
  let temp;
  try {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 4_000_000) throw new Error('Request too large'); }
    const input = JSON.parse(body);
    let output;
    if (req.url === '/transcribe') {
      if (typeof input.audio !== 'string' || input.audio.length > 3_000_000) throw new Error('Invalid audio');
      temp = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'clipper-ai-')), 'audio.mp3');
      await fsp.writeFile(temp, Buffer.from(input.audio, 'base64'), { mode: 0o600 });
      output = await run(['infer','audio','transcribe','--agent',agent,'--file',temp,'--json'], 120000);
    } else {
      if (typeof input.prompt !== 'string' || input.prompt.length > 120000) throw new Error('Invalid prompt');
      output = await run(['infer','model','run','--agent',agent,'--thinking','low','--prompt',input.prompt,'--json'], 120000);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ text: output }));
  } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(e.message || e).slice(0, 250) })); }
  finally { active--; if (temp) await fsp.rm(path.dirname(temp), { recursive: true, force: true }).catch(() => {}); }
});
try { fs.unlinkSync(socket); } catch (e) { if (e.code !== 'ENOENT') throw e; }
server.listen(socket, () => { fs.chownSync(socket, 0, process.getgid()); fs.chmodSync(socket, 0o660); console.log('Clipper OpenClaw broker ready'); });
