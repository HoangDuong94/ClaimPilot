#!/usr/bin/env node
// Compare SSE output and UI-like aggregation for /ai/agent/stream vs /ai/stream

const http = require('http');
const https = require('https');

function postSSE(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const lib = isHttps ? https : http;
    const u = new URL(url);
    const data = JSON.stringify(body || {});
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Accept': 'text/event-stream',
        ...headers,
      }
    }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      const events = [];
      res.on('data', chunk => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (raw) events.push(raw);
        }
      });
      res.on('end', () => resolve(events));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function normalizeBulletsStreaming(prev, chunk) {
  if (!chunk) return chunk;
  let s = String(chunk);
  try {
    if (prev && !/\n$/.test(prev) && /^(\s*)(?:[-*•]\s+|\d+\.\s+)/.test(s)) {
      s = "\n" + s;
    }
    s = s.replace(/([^\n])(?=(?:[-*•]\s+))/g, '$1\n');
    s = s.replace(/([^\n])(?=\d+\.\s+)/g, '$1\n');
  } catch {}
  return s;
}

function uiAccumulate(events) {
  let acc = '';
  for (const e of events) {
    if (!e.startsWith('data:')) continue;
    let data = e.slice(5);
    if (data.startsWith(' ')) data = data.slice(1);
    if (data.trim() === '[DONE]') break;
    let toAppend = null;
    if (data.startsWith('{') || data.startsWith('[')) {
      try {
        const obj = JSON.parse(data);
        toAppend = obj.delta || obj.content || obj.text || obj.output || null;
      } catch {}
    }
    let piece = (toAppend != null ? toAppend : data);
    piece = normalizeBulletsStreaming(acc, piece);
    acc += (piece === '' ? '\n' : piece);
  }
  return acc;
}

(async () => {
  const prompt = process.argv.slice(2).join(' ') || 'Gib bitte 6 Microsoft 365 Tools als Markdown-Liste (- Bullet).';
  const base = process.env.BASE_URL || 'http://localhost:9999';
  const agentUrl = base + '/ai/agent/stream';
  const plainUrl = base + '/ai/stream';

  console.log('Comparing SSE outputs for prompt:', prompt, '\n');

  const agentEvents = await postSSE(agentUrl, { prompt, threadId: 'compare-session' });
  const plainEvents = await postSSE(plainUrl, { prompt });

  const agentUI = uiAccumulate(agentEvents);
  const plainUI = uiAccumulate(plainEvents);

  console.log('=== /ai/agent/stream — RAW (first 12 events) ===');
  agentEvents.slice(0, 12).forEach((e, i) => console.log(`#${i+1}`, e));
  console.log('\n=== /ai/agent/stream — UI Aggregated ===\n' + agentUI);

  console.log('\n=== /ai/stream — RAW (first 12 events) ===');
  plainEvents.slice(0, 12).forEach((e, i) => console.log(`#${i+1}`, e));
  console.log('\n=== /ai/stream — UI Aggregated ===\n' + plainUI);
})();

