#!/usr/bin/env node
/*
  Test the non-streaming AI Agent endpoint (/ai/agent) with a prompt.
  - Posts JSON with either { text } or { messages: [...] }
  - Prints a compact summary (model, tools, text/html preview)

  Usage:
    node scripts/test-agent.js --prompt "Sag 2 Sätze auf Deutsch"
    AGENT_URL=http://localhost:9999/ai/agent node scripts/test-agent.js -p "Hallo"
*/

const http = require('http');
const https = require('https');

function parseArgs(argv) {
  const out = { prompt: 'Sag 2 Sätze auf Deutsch' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--prompt' || a === '-p') && i + 1 < argv.length) { out.prompt = argv[++i]; continue; }
    if ((a === '--url' || a === '-u') && i + 1 < argv.length) { out.url = argv[++i]; continue; }
    if (a === '--messages') { out.useMessages = true; continue; }
  }
  out.url = out.url || process.env.AGENT_URL || 'http://localhost:9999/ai/agent';
  return out;
}

function postJson(url, body) {
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
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => buf += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(buf)); } catch (e) { resolve({ raw: buf }); }
        } else {
          resolve({ status: res.statusCode, error: buf });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const { url, prompt, useMessages } = parseArgs(process.argv);
  console.log('Testing Agent:', url);
  console.log('Prompt       :', prompt);
  const body = useMessages
    ? { messages: [ { role: 'user', text: prompt } ] }
    : { text: prompt };
  const started = Date.now();
  const resp = await postJson(url, body);
  const ms = Date.now() - started;

  if (resp && resp.text != null || resp && resp.html != null) {
    const t = String(resp.text || '').slice(0, 200);
    const htmlLen = (resp.html || '').length;
    console.log('\n--- Result ---');
    console.log('model  :', resp.model);
    console.log('tools  :', Array.isArray(resp.tools) ? resp.tools.length : resp.tools);
    console.log('text   :', t + (t.length === 200 ? '…' : ''));
    console.log('html   :', htmlLen, 'chars');
    console.log('time   :', ms + 'ms');
  } else if (resp && resp.error) {
    console.log('\n--- Error ---');
    console.log(typeof resp.error === 'string' ? resp.error : JSON.stringify(resp, null, 2));
  } else {
    console.log('\n--- Raw ---');
    console.log(typeof resp === 'string' ? resp : JSON.stringify(resp, null, 2));
  }
})();

