const cds = require('@sap/cds');

async function streamGenAI(prompt, res) {
  const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/langchain');
  const destinationName = process.env.AI_DESTINATION_NAME || 'aicore-destination';
  const modelName = process.env.AI_MODEL_NAME || 'gpt-4.1';

  const client = new AzureOpenAiChatClient({ modelName, temperature: 0.3 }, { destinationName });

  // Start streaming
  const stream = await client.stream([
    { role: 'user', content: String(prompt || '') }
  ]);

  let finalChunk;
  for await (const chunk of stream) {
    const piece = typeof chunk.content === 'string'
      ? chunk.content
      : Array.isArray(chunk.content)
        ? chunk.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
        : '';
    if (piece) res.write(`data: ${piece}\n\n`);
    finalChunk = finalChunk ? finalChunk.concat(chunk) : chunk;
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
      await streamGenAI(prompt, res);
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
  // lightweight JSON parser to avoid extra deps; Express is present already
  const express = require('express');
  return express.json();
}

module.exports = {}; // keep module shape

