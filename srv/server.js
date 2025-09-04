const cds = require('@sap/cds');

function writeSSE(res, text) {
  try {
    const str = String(text ?? '');
    const lines = str.split(/\r?\n+/).filter(l => l.length > 0);
    if (!lines.length) return;
    for (const line of lines) {
      res.write(`data: ${line}\n\n`);
    }
  } catch (e) { /* ignore */ }
}


async function streamGenAI(prompt, res, opts = {}) {
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
      if (piece) writeSSE(res, piece);
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
      if (piece) writeSSE(res, piece);
      await new Promise(r => setTimeout(r, 10));
    }
  }
  // Signal stream end in a way compatible with Deep Chat
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

  // Deep Chat adapter: accepts Deep Chat requests and proxies to SSE stream
  app.post('/ai/deepchat', expressJson(), async (req, res) => {
    try {
      // Extract prompt from common Deep Chat request shapes
      let prompt = '';
      const b = req.body || {};
      if (typeof b.text === 'string') {
        prompt = b.text;
      } else if (typeof b.prompt === 'string') {
        prompt = b.prompt;
      } else if (typeof b.message === 'string') {
        prompt = b.message;
      } else if (Array.isArray(b.messages) && b.messages.length) {
        // Prefer the last user message with text/html
        const lastUser = [...b.messages].reverse().find(m => (m && (m.role === 'user' || m.sender === 'user')));
        if (lastUser) {
          prompt = lastUser.text || lastUser.html || lastUser.content || '';
        } else {
          // Fallback: concatenate all text fields
          prompt = b.messages.map(m => m && (m.text || m.html || m.content || '')).filter(Boolean).join('\n');
        }
      }

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

  // Compare AzureOpenAI responses: streaming vs non-streaming
  app.post('/ai/compare', expressJson(), async (req, res) => {
    try {
      const prompt = (req.body && (req.body.prompt || req.body.text || '')) || '';
      const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/langchain');
      const destinationName = process.env.AI_DESTINATION_NAME || 'aicore-destination';
      const modelName = process.env.AI_MODEL_NAME || 'gpt-4.1';
      const client = new AzureOpenAiChatClient({ modelName, temperature: 0.3 }, { destinationName });

      const messages = [ { role: 'user', content: String(prompt || '') } ];

      // Streaming: accumulate full text
      let streamingText = '';
      try {
        const stream = await client.stream(messages);
        for await (const chunk of stream) {
          const piece = typeof chunk.content === 'string'
            ? chunk.content
            : Array.isArray(chunk.content)
              ? chunk.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
              : '';
          if (piece) streamingText += piece;
        }
      } catch (e) {
        streamingText = `[stream error] ${e && e.message ? e.message : String(e)}`;
      }

      // Non-streaming: single invoke
      let nonStreamingText = '';
      try {
        const result = await client.invoke(messages);
        const content = typeof result.content === 'string'
          ? result.content
          : Array.isArray(result.content)
            ? result.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
            : '';
        nonStreamingText = String(content || '');
      } catch (e) {
        nonStreamingText = `[invoke error] ${e && e.message ? e.message : String(e)}`;
      }

      const tokenize = (t) => String(t || '').toLowerCase().split(/\s+/).filter(Boolean);
      const tokensA = tokenize(streamingText);
      const tokensB = tokenize(nonStreamingText);
      const setA = new Set(tokensA);
      const setB = new Set(tokensB);
      let inter = 0;
      for (const tok of setA) if (setB.has(tok)) inter++;
      const union = setA.size + setB.size - inter;
      const jaccard = union ? inter / union : 1;

      res.status(200).json({
        model: modelName,
        prompt,
        streaming: { length: streamingText.length, tokens: tokensA.length, text: streamingText },
        nonStreaming: { length: nonStreamingText.length, tokens: tokensB.length, text: nonStreamingText },
        metrics: { jaccardSimilarity: jaccard }
      });
    } catch (e) {
      res.status(500).json({ error: e && e.message ? e.message : String(e) });
    }
  });

  // Convert AI answer to HTML (server-side Markdown -> HTML), non-streaming
  app.post('/ai/format', expressJson(), async (req, res) => {
    try {
      const MarkdownConverter = require('./utils/markdown-converter');
      const b = req.body || {};
      const text = typeof b.text === 'string' ? b.text : (typeof b.markdown === 'string' ? b.markdown : '');
      const html = MarkdownConverter.convertToHTML(String(text || ''));
      res.status(200).json({ html, text: String(text || '') });
    } catch (e) {
      res.status(500).json({ error: e && e.message ? e.message : String(e) });
    }
  });

  // Generate AI response without streaming, then convert to HTML and return JSON
  app.post('/ai/formatFromAI', expressJson(), async (req, res) => {
    try {
      const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/langchain');
      const MarkdownConverter = require('./utils/markdown-converter');
      const destinationName = process.env.AI_DESTINATION_NAME || 'aicore-destination';
      const modelName = process.env.AI_MODEL_NAME || 'gpt-4.1';
      const client = new AzureOpenAiChatClient({ modelName, temperature: 0.3 }, { destinationName });

      // Build full conversation messages (history + current), mapping roles
      const b = req.body || {};
      let convo = Array.isArray(b.messages) ? b.messages : [];
      // Fallback shapes
      if (!convo.length) {
        const single = (typeof b.text === 'string') ? b.text
          : (typeof b.prompt === 'string') ? b.prompt
          : (typeof b.message === 'string') ? b.message
          : '';
        if (single) convo = [{ role: 'user', text: single }];
      }

      const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const toContent = (m) => {
        if (typeof m?.text === 'string' && m.text.trim()) return m.text;
        if (typeof m?.content === 'string' && m.content.trim()) return m.content;
        if (typeof m?.html === 'string' && m.html.trim()) return stripHtml(m.html);
        return '';
      };
      const toRole = (m) => (m?.role === 'user' || m?.sender === 'user') ? 'user' : 'assistant';

      const llmMessages = convo
        .map(m => ({ role: toRole(m), content: toContent(m) }))
        .filter(x => x.content && typeof x.content === 'string');

      // Ensure last message is from user; if not, do nothing extra
      let result;
      try {
        result = await client.invoke(llmMessages.length ? llmMessages : [{ role: 'user', content: '' }]);
      } catch (e) {
        // If invoke fails due to empty content, try minimal fallback
        const fallbackMsg = (llmMessages[llmMessages.length - 1]?.content) || 'Bitte gib eine hilfreiche Antwort.';
        result = await client.invoke([{ role: 'user', content: fallbackMsg }]);
      }
      const content = typeof result.content === 'string'
        ? result.content
        : Array.isArray(result.content)
          ? result.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
          : '';
      const plain = String(content || '');
      const html = MarkdownConverter.convertToHTML(plain);
      res.status(200).json({ model: modelName, messages: llmMessages, text: plain, html });
    } catch (e) {
      res.status(500).json({ error: e && e.message ? e.message : String(e) });
    }
  });
});

function expressJson() {
  const express = require('express');
  return express.json();
}

module.exports = {};
