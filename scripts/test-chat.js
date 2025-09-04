#!/usr/bin/env node
/*
  Test the AI chat streaming endpoint with a prompt.
  - Posts to SSE endpoint (/ai/stream)
  - Parses SSE and aggregates text, interpreting empty data events as newlines
  - Prints final text and a quick structure summary

  Usage:
    node scripts/test-chat.js --prompt "Nenne mir Stuchpunkte über ANimes"
    SSE_URL=http://localhost:9999/ai/stream node scripts/test-chat.js
*/

const http = require('http');
const https = require('https');

function parseArgs(argv) {
  const out = { prompt: 'Nenne mir Stuchpunkte über ANimes' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--prompt' || a === '-p') && i + 1 < argv.length) { out.prompt = argv[++i]; continue; }
    if ((a === '--url' || a === '-u') && i + 1 < argv.length) { out.url = argv[++i]; continue; }
  }
  out.url = out.url || process.env.SSE_URL || 'http://localhost:9999/ai/stream';
  return out;
}

function postSSE(url, body, onEvent) {
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
      }
    }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', chunk => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          // Parse one SSE block
          const lines = raw.split(/\n/);
          let event = 'message';
          const dataLines = [];
          for (const line of lines) {
            if (!line) continue;
            if (line.startsWith(':')) continue; // comment
            if (line.startsWith('event:')) { event = line.slice(6).trim(); continue; }
            if (line.startsWith('data:')) {
              let d = line.slice(5);
              if (d.startsWith(' ')) d = d.slice(1);
              dataLines.push(d);
            }
          }
          const dataStr = dataLines.join('\n');
          onEvent && onEvent({ event, data: dataStr });
        }
      });
      res.on('end', resolve);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const { url, prompt } = parseArgs(process.argv);
  console.log('Testing SSE:', url);
  console.log('Prompt       :', prompt);
  let text = '';
  const started = Date.now();
  await postSSE(url, { prompt }, ({ event, data }) => {
    if (event === 'error') {
      console.error('SSE error:', data);
      return;
    }
    if (event === 'end') return; // ignore marker
    if (data === '[DONE]') return; // end chunk
    // Interpret empty data as a newline (common with token streams)
    text += (data === '' ? '\n' : data);
  });
  const ms = Date.now() - started;

  console.log('\n--- Final Text ---\n');
  console.log(text);
  console.log('\n--- Summary ---');
  const paragraphs = text.split(/\n\n+/).filter(Boolean);
  const lines = text.split(/\n/).length;
  const bullets = (text.match(/^\s*[-*]\s+/gm) || []).length + (text.match(/^\s*\d+\.\s+/gm) || []).length;
  console.log('Length     :', text.length, 'chars');
  console.log('Lines      :', lines);
  console.log('Paragraphs :', paragraphs.length);
  console.log('Bullets    :', bullets);
  console.log('Duration   :', ms + 'ms');
})();

