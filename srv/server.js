const cds = require('@sap/cds');
const { spawn } = require('child_process');

async function streamGenAI(prompt, res, opts = {}) {
  function sseWrite(res, data) {
    if (data == null) return;
    const s = String(data);
    const lines = s.split(/\r?\n/);
    for (const line of lines) {
      res.write(`data: ${line}\n`);
    }
    res.write(`\n`);
  }
  const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/langchain');
  const destinationName = process.env.AI_DESTINATION_NAME || 'aicore-destination';
  const modelName = process.env.AI_MODEL_NAME || 'gpt-4.1';

  const client = new AzureOpenAiChatClient({ modelName, temperature: 0.3 }, { destinationName });

  const forceFallback = !!opts.forceFallback;
  try {
    if (forceFallback) throw new Error('forced-fallback');
    const stream = await client.stream([
      { role: 'user', content: String(prompt || '') }
    ]);

    for await (const chunk of stream) {
      const piece = typeof chunk.content === 'string'
        ? chunk.content
        : Array.isArray(chunk.content)
          ? chunk.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
          : '';
      if (piece) sseWrite(res, piece);
    }
  } catch (e) {
    const result = await client.invoke([
      { role: 'user', content: String(prompt || '') }
    ]);
    const content = typeof result.content === 'string'
      ? result.content
      : Array.isArray(result.content)
        ? result.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
        : '';
    const text = String(content || '');
    const chunkSize = 64;
    for (let i = 0; i < text.length; i += chunkSize) {
      const piece = text.slice(i, i + chunkSize);
      if (piece) sseWrite(res, piece);
      await new Promise(r => setTimeout(r, 10));
    }
  }
  res.write(`event: end\n`);
  res.write(`data: [DONE]\n\n`);
  res.end();
}

function cliSseWrite(res, data) {
  if (data == null) return;
  const s = String(data);
  const lines = s.split(/\r?\n/);
  for (const line of lines) {
    res.write(`data: ${line}\n`);
  }
  res.write('\n');
}
function cliSseError(res, obj) {
  res.write('event: error\n');
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}
function cliSseEnd(res) {
  res.write('event: end\n');
  res.write('data: [DONE]\n\n');
  res.end();
}
function splitArgs(raw) {
  if (!raw) return [];
  const out = [];
  let current = '';
  let quote = null;
  let escape = false;
  for (const ch of raw) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}
async function streamCli(prompt, res) {
  const cmd = (process.env.LLM_CMD || '').trim();
  if (!cmd) {
    cliSseError(res, { message: 'LLM_CMD not set' });
    cliSseEnd(res);
    return;
  }
  const rawArgs = (process.env.LLM_ARGS || '').trim();
  const baseArgs = splitArgs(rawArgs);
  const mode = (process.env.LLM_INPUT_MODE || 'stdin').toLowerCase();
  let finalArgs = baseArgs.slice();
  const promptStr = String(prompt || '');
  if (mode === 'arg') {
    const hasPlaceholder = finalArgs.some(a => a.includes('{PROMPT}'));
    if (!hasPlaceholder) {
      cliSseError(res, { message: 'LLM_INPUT_MODE=arg but {PROMPT} missing in LLM_ARGS' });
      cliSseEnd(res);
      return;
    }
    finalArgs = finalArgs.map(a => a.replace('{PROMPT}', promptStr));
  }
  const encoding = process.env.LLM_ENCODING || 'utf8';
  const fenceLang = process.env.CLI_FENCE_LANG || 'text';
  const timeoutMs = Math.max(0, Number(process.env.CLI_TIMEOUT_MS || 10000));
  let timeoutId = null;
  const cancelTimeout = () => { if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; } };
  let child;
  try {
    child = spawn(cmd, finalArgs, { shell: true, windowsHide: true });
  } catch (err) {
    cliSseError(res, { message: err && err.message ? err.message : String(err) });
    cliSseEnd(res);
    return;
  }
  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timeoutId = null;
      cliSseError(res, { message: `CLI process timed out after ${timeoutMs}ms` });
      try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
      safeCloseFence();
      safeEnd();
    }, timeoutMs);
    if (timeoutId && typeof timeoutId.unref === 'function') timeoutId.unref();
  }
  let fenceClosed = false;
  let ended = false;
  const safeCloseFence = () => {
    if (fenceClosed) return;
    fenceClosed = true;
    cliSseWrite(res, '\n```');
  };
  const safeEnd = () => {
    if (ended) return;
    ended = true;
    cliSseEnd(res);
  };
  if (child.stdout && typeof child.stdout.setEncoding === 'function') {
    try { child.stdout.setEncoding(encoding); } catch (_) { /* ignore */ }
  }
  if (child.stderr && typeof child.stderr.setEncoding === 'function') {
    try { child.stderr.setEncoding(encoding); } catch (_) { /* ignore */ }
  }
  cliSseWrite(res, '```' + fenceLang + '\n');
  if (child.stdout) {
    child.stdout.on('data', chunk => cliSseWrite(res, chunk));
  }
  if (child.stderr) {
    child.stderr.on('data', chunk => cliSseWrite(res, chunk));
  }
  child.on('error', err => {
    cancelTimeout();
    cliSseError(res, { message: err && err.message ? err.message : String(err) });
    safeCloseFence();
    safeEnd();
  });
  child.on('close', code => {
    cancelTimeout();
    if (process.env.LLM_LOG === '1') {
      try { console.log('[CLI][exit]', { code }); } catch (_) { /* ignore */ }
    }
    safeCloseFence();
    safeEnd();
  });
  if (mode !== 'arg') {
    try {
      if (child.stdin) {
        child.stdin.write(promptStr);
        child.stdin.end();
      }
    } catch (_) { /* ignore */ }
  }
  res.on('close', () => {
    cancelTimeout();
    try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
  });
}
cds.on('bootstrap', (app) => {
  // Server-Sent Events endpoint for streaming chat responses
  app.post('/ai/cli/stream', expressJson(), async (req, res) => {
    try {
      const prompt = (req.body && req.body.prompt) || '';
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders && res.flushHeaders();
      await streamCli(prompt, res);
    } catch (e) {
      try {
        cliSseError(res, { message: e && e.message ? e.message : String(e) });
        cliSseEnd(res);
      } catch (_) { /* ignore */ }
    }
  });
  app.post('/ai/stream', expressJson(), async (req, res) => {
    try {
      const prompt = (req.body && req.body.prompt) || '';
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders && res.flushHeaders();
      const forceFallback = req.headers['x-use-fallback'] === '1' || req.query.fallback === '1';
      await streamGenAI(prompt, res, { forceFallback });
    } catch (e) {
      try {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: e && e.message ? e.message : String(e) })}\n\n`);
        res.end();
      } catch (_) { /* ignore */ }
    }
  });
  // Agent endpoint: LangGraph + MCP tools (no fallback)
  app.post('/ai/agent/stream', expressJson(), async (req, res) => {
    try {
      const { runAgentStreaming } = require('./agent');
      const prompt = (req.body && req.body.prompt) || '';
      const threadId = (req.body && req.body.threadId) || undefined;
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders && res.flushHeaders();
      await runAgentStreaming({ prompt, threadId, res });
    } catch (e) {
      try {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: e && e.message ? e.message : String(e) })}\n\n`);
        res.end();
      } catch (_) { /* ignore */ }
    }
  });
});

function expressJson() {
  const express = require('express');
  return express.json();
}

module.exports = {};
