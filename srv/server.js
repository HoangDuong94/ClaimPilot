const cds = require('@sap/cds');

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

cds.on('bootstrap', (app) => {
  // Server-Sent Events endpoint for streaming chat responses
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


