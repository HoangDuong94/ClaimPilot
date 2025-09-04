#!/usr/bin/env node
// Quick SSE debug client for /ai/stream
// Usage: node scripts/sse-debug.js "Your prompt"

const http = require('http');
const https = require('https');

function fetchSSE(url, body) {
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
          console.log('RAW:', JSON.stringify(raw));
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
  const prompt = process.argv.slice(2).join(' ') || 'Sag Hallo.';
  const url = process.env.SSE_URL || 'http://localhost:9999/ai/stream';
  console.log('Posting to', url, 'prompt=', prompt);
  await fetchSSE(url, { prompt });
})();

