// New Agent implementation: LangGraph React-Agent + MCP tools (M365 only)
// CommonJS with dynamic imports for ESM-only packages

let agentExecutor = null;
let mcpClients = null;
let agentInfo = { toolNames: [], modelName: '' };
const { unwrapError, safeJson } = require('./helpers/logging');
const { enableHttpTrace } = require('./bootstrap/http-trace');

function sseWrite(res, data) {
  if (data == null) return;
  const s = String(data);
  const lines = s.split(/\r?\n/);
  let lastBlank = false;
  for (const line of lines) {
    const isBlank = line.length === 0;
    if (isBlank && lastBlank) continue; // collapse multiple blank lines into one
    res.write(`data: ${line}\n`);
    lastBlank = isBlank;
  }
  res.write(`\n`);
}
// Emit smaller SSE chunks to improve incremental rendering in the UI
function sseWriteChunked(res, text) {
  const enable = process.env.AGENT_SSE_SPLIT !== '0';
  const chunkSize = Math.max(16, Number(process.env.AGENT_SSE_CHUNK_SIZE || 80));
  if (!enable) return sseWrite(res, text);
  const str = String(text || '');
  if (!str) return;
  const lines = str.split(/\r?\n/);
  for (const line of lines) {
    if (line.length <= chunkSize) { sseWrite(res, line); continue; }
    let i = 0;
    const n = line.length;
    while (i < n) {
      let end = Math.min(i + chunkSize, n);
      // try to break at a pleasant boundary within the window
      let j = line.lastIndexOf('.', end);
      if (j < i) j = line.lastIndexOf('!', end);
      if (j < i) j = line.lastIndexOf('?', end);
      if (j < i) j = line.lastIndexOf(' ', end);
      if (j < i) j = end;
      const piece = line.slice(i, j).trimStart();
      if (piece) sseWrite(res, piece);
      i = (j === i ? i + chunkSize : j);
    }
    // send an explicit newline between long logical lines to help UI paragraphing
    sseWrite(res, '');
  }
}
function sseJson(res, obj) { sseWrite(res, JSON.stringify(obj)); }
function sseEnd(res) { res.write('event: end\n'); res.write('data: [DONE]\n\n'); res.end(); }
function sseError(res, obj) {
  try {
    res.write('event: error\n');
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  } catch (_) {}
}

async function initAgent() {
  if (agentExecutor) return agentExecutor;

  // Optional HTTP tracing for fetch
  try { enableHttpTrace(); } catch (_) {}

  const { initAllMCPClients } = require('./mcp-clients');
  const { loadMcpTools } = await import('@langchain/mcp-adapters');
  const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
  const { MemorySaver } = await import('@langchain/langgraph-checkpoint');
  const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/langchain');

  // 1) MCP Clients (only M365 for now)
  mcpClients = await initAllMCPClients();

  // 2) Load tools from M365 MCP (all available)
  const allTools = [];
  if (mcpClients.m365) {
    try {
      const toolsResp = await mcpClients.m365.listTools();
      const names = (toolsResp.tools || []).map(t => t.name).join(',');
      if (names) {
        const m365 = await loadMcpTools(names, mcpClients.m365);
        allTools.push(...m365);
      }
    } catch (e) {
      // If listing tools fails, continue without tools
    }
  }

  // 3) LLM + in-memory checkpointing
  const llm = new AzureOpenAiChatClient(
    {
      modelName: process.env.AI_MODEL_NAME || 'gpt-4.1',
      temperature: Number(process.env.AI_TEMPERATURE || 1),
      maxCompletionTokens: Number(500),
    },
    { destinationName: process.env.AI_DESTINATION_NAME || 'aicore-destination' }
  );
  const checkpointer = new MemorySaver();

  // Log effective LLM config + optional diag ping
  try {
    const kw = (llm && llm.lc_serializable && llm.lc_serializable.kwargs) || {};
    console.log('[AGENT][llm_config]', {
      model: kw.model || kw.modelName,
      temperature: kw.temperature,
      maxTokens: kw.maxTokens,
      maxCompletionTokens: kw.maxCompletionTokens,
      topP: kw.topP,
      frequencyPenalty: kw.frequencyPenalty,
    });
  } catch (_) {}
  if (process.env.AGENT_DIAG === '1' || process.env.AGENT_DIAG === 'true') {
    try {
      const r = await llm.invoke([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'ping' },
      ], { maxCompletionTokens: 8 });
      try {
        const out = typeof r === 'string' ? r : (r && r.content ? r.content : r);
        console.log('[AGENT][diag_llm_ok]', typeof out === 'string' ? out.slice(0, 120) : out);
      } catch (_) {}
    } catch (e) {
      try {
        const chain = unwrapError(e);
        console.error('[AGENT][diag_llm_err]', safeJson(chain, 4000));
      } catch (_) {}
      throw e; // fail fast in diag mode for visibility
    }
  }

  // 4) Create agent
  agentExecutor = createReactAgent({
    llm,
    tools: allTools,
    checkpointSaver: checkpointer,
  });

  // capture agent info for diagnostics
  try {
    agentInfo.toolNames = (allTools || []).map(t => t?.name || 'unknown');
    agentInfo.modelName = llm?.lc_serializable?.kwargs?.model || process.env.AI_MODEL_NAME || 'gpt-4.1';
    console.log('[AGENT][init]', {
      model: agentInfo.modelName,
      tools: agentInfo.toolNames,
      m365Enabled: !!mcpClients.m365,
    });
  } catch (_) {}
  return agentExecutor;
}

async function runAgentStreaming({ prompt, threadId, res }) {
  if (!prompt || !String(prompt).trim()) {
    res.statusCode = 400;
    sseJson(res, { error: 'Prompt is required' });
    return sseEnd(res);
  }
  const executor = await initAgent();

  const { randomUUID } = require('crypto');
  const reqId = (() => { try { return randomUUID(); } catch (_) { return 'req-' + Date.now(); } })();
  const traceEnabled = process.env.AGENT_TRACE === '1' || process.env.AGENT_TRACE === 'true';
  const trace = traceEnabled ? [] : null;
  const startedAt = Date.now();
  let sentChars = 0;
  let sentPreview = '';
  const logOutput = process.env.AGENT_LOG_OUTPUT !== '0';
  const logSteps = process.env.AGENT_LOG_STEPS !== '0';
  let step = 0;                // ReAct round number
  let awaitingTool = false;    // currently waiting for tool output
  let phase = 'init';          // 'init' | 'reason' | 'tool' | 'observation'
  try {
    console.log('[AGENT][start]', {
      reqId,
      threadId: String(threadId || 'default'),
      model: agentInfo.modelName || (process.env.AI_MODEL_NAME || 'gpt-4.1'),
      tools: agentInfo.toolNames,
      promptPreview: String(prompt).slice(0, 200)
    });
    if (traceEnabled) trace.push({ t: Date.now(), type: 'start', reqId, threadId: String(threadId || 'default'), prompt: String(prompt) });
  } catch (_) {}

  const systemMessage = {
    role: 'system',
    content:
      'You are a helpful assistant. You can use MCP tools (Microsoft 365 etc.). ' +
      'Explain briefly what you are doing when invoking tools.',
  };
  const userMessage = { role: 'user', content: String(prompt) };

  try {
    // Stream agent events as SSE
    const callbacks = [{
      handleLLMStart: (_llm, prompts) => {
        try {
          const first = Array.isArray(prompts) && prompts.length ? prompts[0] : undefined;
          const preview = first ? (typeof first === 'string' ? first : JSON.stringify(first)).slice(0, 400) : undefined;
          console.log('[AGENT][llm_start]', { reqId, prompts: Array.isArray(prompts) ? prompts.length : undefined, preview });
          if (traceEnabled) trace.push({ t: Date.now(), type: 'llm_start', preview });
        } catch (_) {}
      },
      handleLLMEnd: () => {
        try { console.log('[AGENT][llm_end]', { reqId }); if (traceEnabled) trace.push({ t: Date.now(), type: 'llm_end' }); } catch (_) {}
      },
      handleLLMError: (err) => {
        try { console.error('[AGENT][llm_error]', { reqId, message: err && err.message, name: err && err.name }); if (traceEnabled) trace.push({ t: Date.now(), type: 'llm_error', message: err && err.message }); } catch (_) {}
      },
      handleToolStart: (tool, input) => {
        try {
          const prev = typeof input === 'string' ? input : JSON.stringify(input || '');
          console.log('[AGENT][cb_tool_start]', { reqId, tool, inputPreview: prev.slice(0, 200) });
          if (traceEnabled) trace.push({ t: Date.now(), type: 'tool_start', tool, inputPreview: prev.slice(0, 400) });
        } catch (_) {}
      },
      handleToolEnd: (output) => {
        try {
          const prev = typeof output === 'string' ? output : JSON.stringify(output || '');
          console.log('[AGENT][cb_tool_end]', { reqId, outputPreview: prev.slice(0, 200) });
          if (traceEnabled) trace.push({ t: Date.now(), type: 'tool_end', outputPreview: prev.slice(0, 400) });
        } catch (_) {}
      },
      handleToolError: (err) => {
        try { console.error('[AGENT][cb_tool_error]', { reqId, message: err && err.message, name: err && err.name }); if (traceEnabled) trace.push({ t: Date.now(), type: 'tool_error', message: err && err.message }); } catch (_) {}
      }
    }];

    const stream = await executor.stream(
      { messages: [systemMessage, userMessage] },
      {
        recursionLimit: Number(process.env.AGENT_RECURSION_LIMIT || 100),
        configurable: { thread_id: String(threadId || 'default') },
        callbacks
      }
    );

    for await (const chunk of stream) {
      // Agent text tokens
      if (chunk && chunk.agent && Array.isArray(chunk.agent.messages)) {
        const msg = chunk.agent.messages[chunk.agent.messages.length - 1];
        if (msg && msg.content) {
          const text = typeof msg.content === 'string'
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
              : '';
          if (text) {
            if (logOutput) {
              try {
                sentChars += text.length;
                if (sentPreview.length < 800) {
                  const needed = 800 - sentPreview.length;
                  sentPreview += text.slice(0, needed);
                }
                // per-chunk live log (short preview)
                const live = text.length > 160 ? text.slice(0, 160) + ' �' : text;
                console.log('[AGENT][send]', live);
              } catch (_) {}
            }
            sseWriteChunked(res, text);
            // Step logging: reasoning (no tool call in this message)
            try {
              const msgHasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
              if (logSteps && !msgHasToolCalls && !awaitingTool) {
                if (phase !== 'reason') {
                  step += 1;
                  console.log('[AGENT][step]', { step, action: 'reason', preview: text.slice(0, 200) });
                }
                phase = 'reason';
              }
            } catch (_) {}
          }
          if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            const call = msg.tool_calls[0];
            try { console.log('[AGENT][tool_start]', { tool: call.name, args: call.args || {} }); } catch (_) {}
            if (logSteps) {
              try { if (phase !== 'tool') { /* keep same step for this round */ } console.log('[AGENT][step]', { step: Math.max(step, 1), action: 'tool_call', tool: call.name }); } catch (_) {}
            }
            awaitingTool = true;
            phase = 'tool';
          }
        }
      }

      // Tool outputs
      if (chunk && chunk.tools && Array.isArray(chunk.tools.messages) && chunk.tools.messages.length > 0) {
        const toolMsg = chunk.tools.messages[0];
        const toolText = typeof toolMsg?.content === 'string'
          ? toolMsg.content
          : Array.isArray(toolMsg?.content)
            ? toolMsg.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
            : '';
        if (toolText) {
          const preview = String(toolText).slice(0, 500);
          try { console.log('[AGENT][tool_output]', preview + (toolText.length > 500 ? ' ...[truncated]' : '')); } catch (_) {}
          if (logSteps) {
            try { if (step === 0) step = 1; console.log('[AGENT][step]', { step, action: 'observation', preview: String(toolText).slice(0, 200) }); } catch (_) {}
          }
        }
        awaitingTool = false;
        phase = 'observation';
      }
    }

    const tookMs = Date.now() - startedAt;
    try {
      console.log('[AGENT][end]', { threadId: String(threadId || 'default'), ms: tookMs });
      if (logOutput) {
        const prev = sentPreview.replace(/\s+/g, ' ').slice(0, 400);
        console.log('[AGENT][response_end]', { chars: sentChars, preview: prev + (sentChars > prev.length ? ' …' : '') });
      }
    } catch (_) {}
    sseEnd(res);
  } catch (e) {
    // Enhanced error logging with deep unwrap and sanitized SSE response
    try {
      const chain = unwrapError(e);

      // concise console summary
      try {
        const summary = chain.map((c, i) => ({
          i,
          name: c.name,
          code: c.code,
          responseStatus: c.responseStatus,
          message: (c?.message || '').slice(0, 500),
        }));
        console.error('[AGENT][error]', { reqId, summary });
      } catch (_) {}

      if (traceEnabled) {
        try { console.error('[AGENT][error_detail]', safeJson(chain, 8000)); } catch (_) {}
      }

      // extract Azure/AICore error if present
      const primary = chain.find(c => c.responseData) || chain[0] || {};
      let azureError;
      try {
        const d = typeof primary.responseData === 'string'
          ? JSON.parse(primary.responseData)
          : primary.responseData;
        const err = (d && d.error) || d || {};
        azureError = {
          code: err.code,
          message: err.message,
          inner: err.innererror || err.details || undefined,
        };
      } catch (_) {}

      const clientErr = {
        reqId,
        status: primary.responseStatus || primary.code || 500,
        code: (azureError && azureError.code) || (chain[0] && chain[0].code) || 'ERR',
        message: (azureError && azureError.message) || (chain[0] && chain[0].message) || 'Agent failed',
        inner: azureError && azureError.inner,
      };
      sseError(res, clientErr);
    } catch (_) {
      try { sseError(res, { message: 'Agent failed' }); } catch (_) {}
    }
    try { sseEnd(res); } catch (_) {}
  }
}

module.exports = { runAgentStreaming };

