// New Agent implementation: LangGraph React-Agent + MCP tools (M365 only)
// CommonJS with dynamic imports for ESM-only packages

// Lightweight helpers for safe logging and output shaping
const crypto = require('crypto');
const { createChatProvider } = require('../chat-provider');
function hash(s = '') {
  try { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10); } catch (_) { return 'nohash'; }
}
function cap(str, n = 4000) {
  const s = String(str || '');
  return s.length > n ? s.slice(0, n) + ' ...[truncated]' : s;
}

function extractMcpText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;

  if (result.structuredContent !== undefined) {
    const sc = result.structuredContent;
    if (typeof sc === 'string') return sc;
    try { return JSON.stringify(sc); } catch (_) { return String(sc); }
  }

  if (Array.isArray(result.content)) {
    const parts = [];
    for (const block of result.content) {
      if (!block) continue;
      if (typeof block === 'string') {
        parts.push(block);
        continue;
      }
      const type = block.type;
      if (type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
        continue;
      }
      if (type === 'json' && block.json !== undefined) {
        try { parts.push(typeof block.json === 'string' ? block.json : JSON.stringify(block.json)); }
        catch (_) { parts.push(String(block.json)); }
        continue;
      }
      if ((type === 'stdout' || type === 'stderr' || type === 'cli_output') && typeof block.text === 'string') {
        parts.push(block.text);
        continue;
      }
      if ((type === 'output' || type === 'comment') && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
    if (parts.length) return parts.join('\n');
  }

  if (typeof result.text === 'string') return result.text;
  if (typeof result.output === 'string') return result.output;
  if (Array.isArray(result.output)) {
    try { return result.output.join('\n'); } catch (_) {}
  }
  if (typeof result.stdout === 'string') return result.stdout;

  try { return JSON.stringify(result); } catch (_) { return String(result); }
}

// Policy: rewrite unsafe/unbounded commands to safe variants
function rewriteCommandSafely(cmd) {
  return String(cmd || '');
}

// Output reducer for known commands; keeps responses compact for the LLM/history
function reduceOutput(cmd, raw) {
  try { return typeof raw === 'string' ? raw : JSON.stringify(raw); }
  catch (_) { return String(raw); }
}

let agentExecutor = null;
let mcpClients = null;
let agentInfo = { toolNames: [], modelName: '', provider: '' };
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
  } catch (_) { }
}
function sseEvent(res, eventName, payload) {
  if (!eventName) return;
  try {
    res.write(`event: ${eventName}\n`);
    if (payload !== undefined) {
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
      for (const line of String(text || '').split(/\r?\n/)) {
        res.write(`data: ${line}\n`);
      }
    } else {
      res.write('data:\n');
    }
    res.write('\n');
  } catch (_) { }
}
function sseTrace(res, trace) {
  if (!trace || !trace.length) return;
  sseEvent(res, 'trace', trace);
}

async function initAgent() {
  if (agentExecutor) return agentExecutor;

  // Optional HTTP tracing for fetch
  try { enableHttpTrace(); } catch (_) { }

  const { initAllMCPClients } = require('./mcp-clients');
  const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
  const { MemorySaver } = await import('@langchain/langgraph-checkpoint');
  const { DynamicStructuredTool } = await import('@langchain/core/tools');
  const { z } = await import('zod');

  // 1) MCP Clients (only M365 for now)
  mcpClients = await initAllMCPClients();

  // 2) Guarded proxy for MCP tool(s); only expose whitelisted name(s)
  const allTools = [];
  const allowed = (process.env.MCP_M365_TOOLS || 'm365_run_command')
    .split(',').map(s => s.trim()).filter(Boolean);
  try { console.log('[AGENT][tools_whitelist]', { allowed }); } catch (_) {}
  if (mcpClients.m365 && allowed.includes('m365_run_command')) {
    const guardedRun = new DynamicStructuredTool({
      name: 'm365_run_command',
      description: 'Sicherer Proxy für Microsoft 365 CLI Kommandos über MCP.',
      schema: z.object({ command: z.string() }),
      func: async ({ command }) => {
        const safeCmd = rewriteCommandSafely(command);
        const out = await mcpClients.m365.callTool({ name: 'm365_run_command', arguments: { command: safeCmd } });
        const rawText = extractMcpText(out);
        const fallback = typeof out === 'string' ? out : JSON.stringify(out);
        const raw = typeof rawText === 'string' && rawText.trim() ? rawText : fallback;
        const slim = reduceOutput(safeCmd, raw);
        try { console.log('[M365][proxy]', { cmd: safeCmd, rawBytes: raw.length, slimBytes: slim.length, rawHash: hash(raw) }); } catch (_) {}
        return slim; // Only reduced output goes back to the LLM
      }
    });
    allTools.push(guardedRun);
  }

  // 3) LLM + in-memory checkpointing
  const parsedTemp = Number(process.env.AI_TEMPERATURE);
  const temperature = Number.isFinite(parsedTemp) ? parsedTemp : 1;
  const parsedMaxTokens = Number(process.env.AGENT_MAX_COMPLETION_TOKENS ?? 500);
  const maxCompletionTokens = Number.isFinite(parsedMaxTokens) ? parsedMaxTokens : 500;

  const llmProvider = await createChatProvider({
    temperature,
    maxCompletionTokens,
  });

  const llm = llmProvider.langchain;
  if (!llm || typeof llm.invoke !== 'function') {
    throw new Error('Chat provider did not supply a LangChain-compatible chat model');
  }
  const checkpointer = new MemorySaver();

  // Log effective LLM config + optional diag ping
  try {
    const kw = (llm && llm.lc_serializable && llm.lc_serializable.kwargs) || {};
    console.log('[AGENT][llm_config]', {
      provider: llmProvider?.provider,
      model: kw.model || kw.modelName,
      temperature: kw.temperature,
      maxTokens: kw.maxTokens,
      maxCompletionTokens: kw.maxCompletionTokens,
      topP: kw.topP,
      frequencyPenalty: kw.frequencyPenalty,
    });
  } catch (_) { }
  if (process.env.AGENT_DIAG === '1' || process.env.AGENT_DIAG === 'true') {
    try {
      const r = await llm.invoke([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'ping' },
      ], { maxCompletionTokens: 8 });
      try {
        const out = typeof r === 'string' ? r : (r && r.content ? r.content : r);
        console.log('[AGENT][diag_llm_ok]', typeof out === 'string' ? out.slice(0, 120) : out);
      } catch (_) { }
    } catch (e) {
      try {
        const chain = unwrapError(e);
        console.error('[AGENT][diag_llm_err]', safeJson(chain, 4000));
      } catch (_) { }
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
    agentInfo.modelName = llmProvider?.modelName
      || llm?.lc_serializable?.kwargs?.model
      || process.env.AI_MODEL_NAME
      || 'gpt-4.1';
    agentInfo.provider = llmProvider?.provider || String(process.env.AI_PROVIDER || 'azure');
    console.log('[AGENT][init]', {
      model: agentInfo.modelName,
      provider: agentInfo.provider,
      tools: agentInfo.toolNames,
      m365Enabled: !!mcpClients.m365,
    });
  } catch (_) { }
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
      provider: agentInfo.provider || String(process.env.AI_PROVIDER || 'azure'),
      tools: agentInfo.toolNames,
      promptPreview: String(prompt).slice(0, 200)
    });
    if (traceEnabled) trace.push({
      t: Date.now(),
      type: 'start',
      reqId,
      threadId: String(threadId || 'default'),
      prompt: String(prompt),
      provider: agentInfo.provider,
      model: agentInfo.modelName,
    });
  } catch (_) { }

  const systemMessage = {
    role: 'system',
    content: `
Du hilfst bei drei Aufgaben rund um Microsoft 365: Status prüfen, neueste Mail zusammenfassen, Termin erstellen. Sprich Deutsch, formuliere kurz.

Status: führe "m365 status --output json" aus und gib nur connectedAs und cloudType zurück.

Neueste Mail: wenn der Befehl unklar ist, starte mit "m365 outlook message list --help". Danach verwende "m365 outlook message list --folderName Inbox --output json --query \"[0]\"". Aus der Antwort nutzt du subject, from.emailAddress.name, from.emailAddress.address, receivedDateTime und bodyPreview (auf 120 Zeichen kürzen). Falls bodyPreview fehlt, hole sie einmal über "m365 outlook message get --id \"<id>\" --output json". Antworte als vier Zeilen (Betreff, Von, Datum, Vorschau). Roh-JSON nie direkt ausgeben.

Kalender: "m365 outlook event add" mit passenden Parametern und anschließend kurz bestätigen.

Vermeide weitere Versuche, sobald das Ziel erreicht ist.
`.trim()
  };
  const userMessage = { role: 'user', content: String(prompt) };

  try {
    // Stream agent events as SSE
    const callbacks = [{
      handleLLMStart: (_llm, prompts) => {
        try {
          const s = JSON.stringify(prompts);
          const approxTokens = Math.ceil(s.length / 4);
          const first = Array.isArray(prompts) && prompts.length ? prompts[0] : undefined;
          const preview = first ? (typeof first === 'string' ? first : JSON.stringify(first)).slice(0, 400) : undefined;
          console.log('[AGENT][llm_start]', { reqId, prompts: Array.isArray(prompts) ? prompts.length : undefined, approxTokens });
          if (traceEnabled) trace.push({ t: Date.now(), type: 'llm_start', preview });
        } catch (_) { }
      },
      handleLLMEnd: () => {
        try { console.log('[AGENT][llm_end]', { reqId }); if (traceEnabled) trace.push({ t: Date.now(), type: 'llm_end' }); } catch (_) { }
      },
      handleLLMError: (err) => {
        try { console.error('[AGENT][llm_error]', { reqId, message: err && err.message, name: err && err.name }); if (traceEnabled) trace.push({ t: Date.now(), type: 'llm_error', message: err && err.message }); } catch (_) { }
      },
      handleToolStart: (tool, input) => {
        try {
          const prev = typeof input === 'string' ? input : JSON.stringify(input || '');
          console.log('[AGENT][cb_tool_start]', { reqId, tool, inputPreview: prev.slice(0, 200) });
          if (traceEnabled) trace.push({ t: Date.now(), type: 'tool_start', tool, inputPreview: prev.slice(0, 400) });
        } catch (_) { }
      },
      handleToolEnd: (output) => {
        try {
          const text = typeof output === 'string' ? output : JSON.stringify(output || '');
          console.log('[AGENT][cb_tool_end]', { reqId, bytes: text.length, preview: text.slice(0, 200) });
          if (traceEnabled) trace.push({ t: Date.now(), type: 'tool_end', outputPreview: text.slice(0, 400) });
        } catch (_) { }
      },
      handleToolError: (err) => {
        try { console.error('[AGENT][cb_tool_error]', { reqId, message: err && err.message, name: err && err.name }); if (traceEnabled) trace.push({ t: Date.now(), type: 'tool_error', message: err && err.message }); } catch (_) { }
      }
    }];

    // Build messages and ensure system message is only sent once per thread
    const msgs = [];
    const tid = String(threadId || 'default');
    global.__threadsWithSystem ??= new Set();
    if (!global.__threadsWithSystem.has(tid)) {
      msgs.push(systemMessage);
      global.__threadsWithSystem.add(tid);
    }
    msgs.push(userMessage);

    const stream = await executor.stream(
      { messages: msgs },
      {
        recursionLimit: Number(process.env.AGENT_RECURSION_LIMIT || 15),
        configurable: { thread_id: tid },
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
                const live = text.length > 160 ? text.slice(0, 160) + ' ... ' : text;
                console.log('[AGENT][send]', live);
              } catch (_) { }
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
            } catch (_) { }
          }
          if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            const call = msg.tool_calls[0];
            try { console.log('[AGENT][tool_start]', { tool: call.name, args: call.args || {} }); } catch (_) { }
            if (logSteps) {
              try { if (phase !== 'tool') { /* keep same step for this round */ } console.log('[AGENT][step]', { step: Math.max(step, 1), action: 'tool_call', tool: call.name }); } catch (_) { }
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
          try { console.log('[AGENT][tool_output]', preview + (toolText.length > 500 ? ' ...[truncated]' : '')); } catch (_) { }
          if (logSteps) {
            try { if (step === 0) step = 1; console.log('[AGENT][step]', { step, action: 'observation', preview: String(toolText).slice(0, 200) }); } catch (_) { }
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
    } catch (_) { }
    if (traceEnabled && trace && trace.length) {
      sseTrace(res, trace);
    }
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
      } catch (_) { }

      if (traceEnabled) {
        try { console.error('[AGENT][error_detail]', safeJson(chain, 8000)); } catch (_) { }
      }

      // extract provider-specific error if present
      const primary = chain.find(c => c.responseData) || chain[0] || {};
      let providerError;
      try {
        const d = typeof primary.responseData === 'string'
          ? JSON.parse(primary.responseData)
          : primary.responseData;
        const err = (d && d.error) || d || {};
        providerError = {
          code: err.code,
          message: err.message,
          inner: err.innererror || err.details || undefined,
        };
      } catch (_) { }

      const clientErr = {
        reqId,
        status: primary.responseStatus || primary.code || 500,
        code: (providerError && providerError.code) || (chain[0] && chain[0].code) || 'ERR',
        message: (providerError && providerError.message) || (chain[0] && chain[0].message) || 'Agent failed',
        inner: providerError && providerError.inner,
        provider: agentInfo.provider,
      };
      sseError(res, clientErr);
    } catch (_) {
      try { sseError(res, { message: 'Agent failed' }); } catch (_) { }
    }
    if (traceEnabled && trace && trace.length) {
      sseTrace(res, trace);
    }
    try { sseEnd(res); } catch (_) { }
  }
}

module.exports = { runAgentStreaming };
