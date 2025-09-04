#!/usr/bin/env node
/*
  Usage:
    node scripts/compare-responses.js "Dein Prompt hier"
  or with env PORT if not 4004
*/

const http = require('http');

const PORT = process.env.PORT || 4004;
const prompt = process.argv.slice(2).join(' ') || 'Nenne mir ein paar Stichpunkte zu UI5.';

function postJson(path, data) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(data));
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length
      }
    }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { out += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(out)); } catch { resolve(out); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log(`Comparing streaming vs non-streaming on http://localhost:${PORT}/ai/compare`);
  const result = await postJson('/ai/compare', { prompt });
  if (typeof result === 'string') {
    console.log(result);
    return;
  }
  const { model, metrics, streaming, nonStreaming } = result;
  console.log('Model:', model);
  console.log('Jaccard similarity:', metrics && metrics.jaccardSimilarity);
  console.log('\n--- Streaming (first 600 chars) ---\n');
  console.log((streaming && streaming.text || '').slice(0, 600));
  console.log('\n--- Non-Streaming (first 600 chars) ---\n');
  console.log((nonStreaming && nonStreaming.text || '').slice(0, 600));
})();

