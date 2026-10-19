import http from 'node:http';
export async function openclawAI(endpoint: 'transcribe' | 'analyze', data: object): Promise<string> {
  const payload = JSON.stringify(data);
  return await new Promise((resolve, reject) => {
    const req = http.request({ socketPath: '/run/clipper-ai/openclaw.sock', path: `/${endpoint}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 150000 }, res => {
      let body = '';
      res.on('data', c => { body += c; if (body.length > 4_000_000) req.destroy(new Error('AI response too large')); });
      res.on('end', () => { try { const result = JSON.parse(body); if (res.statusCode !== 200) throw new Error(result.error || 'AI unavailable'); resolve(result.text); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('AI timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}
