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
  // Lazy-init MCP only on first use via endpoints; avoid noisy startup failures

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

  // --- M365 MCP helper endpoints ---
  app.get('/mcp/m365/health', async (req, res) => {
    try {
      const { initM365MCPClient } = require('./lib/mcp-client');
      await initM365MCPClient();
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  app.get('/mcp/m365/tools', async (req, res) => {
    try {
      const { listM365Tools, initM365MCPClient } = require('./lib/mcp-client');
      await initM365MCPClient();
      const tools = await listM365Tools();
      res.status(200).json({ tools });
    } catch (e) {
      res.status(500).json({ error: e && e.message ? e.message : String(e) });
    }
  });

  app.post('/mcp/m365/run', expressJson(), async (req, res) => {
    try {
      const { runM365Tool, initM365MCPClient } = require('./lib/mcp-client');
      const body = req.body || {};
      const name = body.name || body.tool || body.toolName;
      const args = body.args || body.arguments || body.parameters || {};
      if (!name) return res.status(400).json({ error: 'Missing tool name (name/tool/toolName)' });
      await initM365MCPClient();
      const result = await runM365Tool(name, args);
      res.status(200).json({ tool: name, args, result });
    } catch (e) {
      res.status(500).json({ error: e && e.message ? e.message : String(e) });
    }
  });

  // AI Agent endpoint using M365 MCP tools (non-streaming)
  app.post('/ai/agent', expressJson(), async (req, res) => {
    try {
      const startedAt = Date.now();
      const { initM365MCPClient, getM365Client } = require('./lib/mcp-client');
      const MarkdownConverter = require('./utils/markdown-converter');
      const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/langchain');
      const { loadMcpTools } = await import('@langchain/mcp-adapters');
      const { createReactAgent } = await import('@langchain/langgraph/prebuilt');

      // Initialize MCP and list available tools
      console.log('[ai/agent] Initializing M365 MCP client ...');
      await initM365MCPClient();
      const mcpClient = await getM365Client();
      let toolNames = [];
      try {
        if (typeof mcpClient.listTools === 'function') {
          console.log('[ai/agent] Listing tools via mcpClient.listTools() ...');
          const listed = await mcpClient.listTools();
          const arr = Array.isArray(listed) ? listed : (listed?.tools || []);
          toolNames = arr.map(t => t?.name || t?.id).filter(Boolean);
        } else if (mcpClient.tools && typeof mcpClient.tools.list === 'function') {
          console.log('[ai/agent] Listing tools via mcpClient.tools.list() ...');
          const listed = await mcpClient.tools.list();
          const arr = Array.isArray(listed) ? listed : (listed?.tools || []);
          toolNames = arr.map(t => t?.name || t?.id).filter(Boolean);
        }
        console.log(`[ai/agent] MCP tools discovered: ${toolNames.length} -> ${toolNames.join(', ')}`);
      } catch (e) {
        console.warn('[ai/agent] Tool listing failed, will attempt wildcard load. Error:', e && e.message ? e.message : e);
      }

      let tools = [];
      try {
        const names = toolNames.length ? toolNames.join(',') : '*';
        console.log(`[ai/agent] Loading MCP tools via adapters for: ${names}`);
        tools = await loadMcpTools(names, mcpClient);
      } catch (e) {
        console.warn('[ai/agent] loadMcpTools failed:', e && e.message ? e.message : e);
        tools = [];
      }

      const destinationName = process.env.AI_DESTINATION_NAME || 'aicore-destination';
      const modelName = process.env.AI_MODEL_NAME || 'gpt-4.1';
      console.log(`[ai/agent] Creating LLM client model=${modelName}, destination=${destinationName}`);
      const llm = new AzureOpenAiChatClient({ modelName, temperature: 0.2 }, { destinationName });

      console.log(`[ai/agent] Creating agent with ${tools.length} tool(s)`);
      const agent = createReactAgent({ llm, tools });

      const b = req.body || {};
      let convo = Array.isArray(b.messages) ? b.messages : [];
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
      const userMsgs = convo.map(m => ({ role: toRole(m), content: toContent(m) })).filter(m => m.content);
      const preview = (userMsgs[0]?.content || '').slice(0, 120).replace(/\s+/g,' ');
      console.log(`[ai/agent] Prepared messages: ${userMsgs.length}, first: ${JSON.stringify(preview)}`);

      const systemMsg = {
        role: 'system',
        content: [
          'You are an assistant with access to the Microsoft 365 CLI MCP server.',
          'Use available tools to query documentation or run commands as appropriate.',
          'Explain before running tools and summarize results clearly.'
        ].join(' ')
      };

      const input = { messages: [systemMsg, ...userMsgs] };
      // Prefer robust streaming aggregation for final text
      console.log('[ai/agent] Streaming agent to aggregate final text ...');
      let aggregated = '';
      try {
        const stream = await agent.stream(input, { configurable: { thread_id: `m365-${Date.now()}` } });
        for await (const chunk of stream) {
          if (chunk && chunk.agent && Array.isArray(chunk.agent.messages)) {
            const m = chunk.agent.messages[chunk.agent.messages.length - 1];
            const c = m && m.content;
            const piece = typeof c === 'string' ? c : (Array.isArray(c) ? c.map(p => (typeof p === 'string' ? p : p?.text || '')).join('') : '');
            if (piece) aggregated += piece;
          }
        }
      } catch (e) {
        console.warn('[ai/agent] Streaming aggregation failed; will try single invoke. Error:', e && e.message ? e.message : e);
      }

      let finalText = String(aggregated || '').trim();
      if (!finalText) {
        console.log('[ai/agent] Invoking agent (single) to obtain final message ...');
        const result = await agent.invoke(input, { configurable: { thread_id: `m365-${Date.now()}` } });
        const allMsgs = result?.messages || [];
        try { console.log(`[ai/agent] Agent returned ${allMsgs.length} message(s).`); } catch(_) {}
        const last = [...allMsgs].reverse().find(m => m?.role === 'assistant');
        const content = last?.content || '';
        const text = typeof content === 'string' ? content
          : Array.isArray(content) ? content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
          : '';
        finalText = String(text || '').trim();
      }

      // Fallback: if still empty, optionally query LLM directly (no tools)
      if (!finalText) {
        const disableFallback = String(process.env.PUREAI_DISABLE_AGENT_FALLBACK || '').toLowerCase() === '1' || String(process.env.PUREAI_DISABLE_AGENT_FALLBACK || '').toLowerCase() === 'true';
        if (disableFallback) {
          console.warn('[ai/agent] Empty agent text and fallback DISABLED');
        } else {
          console.warn('[ai/agent] Empty agent text — invoking direct LLM fallback');
          try {
            const directMsgs = userMsgs.length ? userMsgs : [{ role: 'user', content: '' }];
            const direct = await llm.invoke(directMsgs);
            const directContent = typeof direct.content === 'string'
              ? direct.content
              : Array.isArray(direct.content)
                ? direct.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
                : '';
            finalText = String(directContent || '').trim();
            console.log(`[ai/agent] Direct LLM produced ${finalText.length} chars`);
          } catch (e) {
            console.error('[ai/agent] Direct LLM fallback failed:', e && e.message ? e.message : e);
            // keep empty; error will be conveyed via html formatting below
          }
        }
      }

      const html = MarkdownConverter.convertToHTML(finalText || '');
      console.log(`[ai/agent] Responding with text(${(finalText||'').length}) html(${(html||'').length})`);
      res.status(200).json({ model: modelName, tools: toolNames, text: finalText, html });
    } catch (e) {
      console.error('[ai/agent] Error:', e && e.stack ? e.stack : (e && e.message ? e.message : e));
      res.status(500).json({ error: e && e.message ? e.message : String(e) });
    }
  });

  // AI Agent endpoint (SSE streaming) using M365 MCP tools
  app.post('/ai/agent/stream', expressJson(), async (req, res) => {
    try {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders && res.flushHeaders();

      const { initM365MCPClient, getM365Client } = require('./lib/mcp-client');
      const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/langchain');
      const { loadMcpTools } = await import('@langchain/mcp-adapters');
      const { createReactAgent } = await import('@langchain/langgraph/prebuilt');

      await initM365MCPClient();
      const mcpClient = await getM365Client();
      let toolNames = [];
      try {
        if (typeof mcpClient.listTools === 'function') {
          const listed = await mcpClient.listTools();
          const arr = Array.isArray(listed) ? listed : (listed?.tools || []);
          toolNames = arr.map(t => t?.name || t?.id).filter(Boolean);
        } else if (mcpClient.tools && typeof mcpClient.tools.list === 'function') {
          const listed = await mcpClient.tools.list();
          const arr = Array.isArray(listed) ? listed : (listed?.tools || []);
          toolNames = arr.map(t => t?.name || t?.id).filter(Boolean);
        }
      } catch (_) {}

      let tools = [];
      try {
        tools = await loadMcpTools(toolNames.length ? toolNames.join(',') : '*', mcpClient);
      } catch (_) { tools = []; }

      const destinationName = process.env.AI_DESTINATION_NAME || 'aicore-destination';
      const modelName = process.env.AI_MODEL_NAME || 'gpt-4.1';
      const llm = new AzureOpenAiChatClient({ modelName, temperature: 0.2 }, { destinationName });
      const agent = createReactAgent({ llm, tools });

      const b = req.body || {};
      let convo = Array.isArray(b.messages) ? b.messages : [];
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
      const userMsgs = convo.map(m => ({ role: toRole(m), content: toContent(m) })).filter(m => m.content);

      const systemMsg = {
        role: 'system',
        content: [
          'You are an assistant with access to the Microsoft 365 CLI MCP server.',
          'Use available tools to query documentation or run commands as appropriate.',
          'Explain before running tools and summarize results clearly.'
        ].join(' ')
      };

      const input = { messages: [systemMsg, ...userMsgs] };
      const stream = await agent.stream(input, { configurable: { thread_id: `m365-${Date.now()}` } });

      let producedAny = false;
      try {
        for await (const chunk of stream) {
          // Agent text output
          if (chunk && chunk.agent && Array.isArray(chunk.agent.messages)) {
            const m = chunk.agent.messages[chunk.agent.messages.length - 1];
            const c = m && m.content;
            const piece = typeof c === 'string' ? c : (Array.isArray(c) ? c.map(p => (typeof p === 'string' ? p : p?.text || '')).join('') : '');
            if (piece) { writeSSE(res, piece); producedAny = true; }
          }
          // Tool outputs (optional: prefix for clarity)
          if (chunk && chunk.tools && Array.isArray(chunk.tools.messages)) {
            const t = chunk.tools.messages[0];
            const c = t && t.content;
            const piece = typeof c === 'string' ? c : (Array.isArray(c) ? c.map(p => (typeof p === 'string' ? p : p?.text || '')).join('') : '');
            if (piece) { writeSSE(res, `\n${piece}\n`); producedAny = true; }
          }
        }
      } catch (e) {
        // If streaming fails mid-way, fall back to a single invoke for a final answer
        try {
          const result = await agent.invoke(input, { configurable: { thread_id: `m365-${Date.now()}` } });
          const allMsgs = result?.messages || [];
          const last = [...allMsgs].reverse().find(m => m?.role === 'assistant');
          const content = last?.content || '';
          const text = typeof content === 'string' ? content
            : Array.isArray(content) ? content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
            : '';
          if (text) { writeSSE(res, text); producedAny = true; }
        } catch (_) { /* ignore */ }
      }

      if (!producedAny) writeSSE(res, '');
      res.write(`data: [DONE]\n\n`);
      res.end();
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
