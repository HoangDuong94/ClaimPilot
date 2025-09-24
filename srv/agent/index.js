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

function flattenPossibleText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = [];
    for (const entry of value) {
      const text = flattenPossibleText(entry);
      if (text) parts.push(text);
    }
    return parts.join('');
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.output_text === 'string') return value.output_text;
    if (typeof value.value === 'string') return value.value;
    if (typeof value.content === 'string') return value.content;
    if (Array.isArray(value.content)) {
      const nested = flattenPossibleText(value.content);
      if (nested) return nested;
    }
  }
  return '';
}

function extractMessageText(message) {
  if (!message) return '';
  return flattenPossibleText(message.content ?? message);
}

function extractReturnValuesText(payload) {
  if (!payload || typeof payload === 'number' || typeof payload === 'boolean') return '';
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) return flattenPossibleText(payload);
  if (typeof payload === 'object') {
    const keys = ['output_text', 'output', 'response', 'content', 'text', 'value', 'final', 'message'];
    for (const key of keys) {
      if (payload[key] !== undefined) {
        const text = flattenPossibleText(payload[key]);
        if (text) return text;
      }
    }
    if (Array.isArray(payload.messages) && payload.messages.length) {
      const last = payload.messages[payload.messages.length - 1];
      const text = extractMessageText(last);
      if (text) return text;
    }
  }
  return '';
}

function extractFinalChunkText(chunk) {
  if (!chunk || typeof chunk !== 'object') return '';
  const direct = extractReturnValuesText(chunk.returnValues)
    || extractReturnValuesText(chunk.final)
    || extractReturnValuesText(chunk.finalOutput)
    || extractReturnValuesText(chunk.data);
  if (direct) return direct;
  if (chunk.output !== undefined) {
    const text = extractReturnValuesText(chunk.output);
    if (text) return text;
  }
  if (chunk.agentOutcome && typeof chunk.agentOutcome === 'object') {
    const text = extractReturnValuesText(chunk.agentOutcome.returnValues || chunk.agentOutcome.output);
    if (text) return text;
  }
  return '';
}

function normaliseDateTimeInput(value) {
  if (!value) return { iso: '', tz: '' };
  if (typeof value === 'string') {
    return { iso: value, tz: value.endsWith('Z') ? 'UTC' : '' };
  }
  if (typeof value === 'object') {
    const iso = value.dateTime || value.date || value.iso || '';
    const tz = value.timeZone || value.tz || '';
    return { iso, tz };
  }
  return { iso: String(value), tz: '' };
}

function splitIsoToParts(iso) {
  const str = String(iso || '');
  const result = { iso: str, date: '', time: '' };
  if (!str) return result;
  const trimmed = str.replace(/\.(\d+)(Z)?$/, '$2');
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))/);
  if (match) {
    result.date = match[1];
    result.time = match[2] || '';
  }
  return result;
}

function buildIsoSegment(parts) {
  if (!parts) return '';
  if (parts.date) {
    return parts.time ? `${parts.date} ${parts.time}` : parts.date;
  }
  return parts.iso || '';
}

function formatDateRangeForSummary(startInput, endInput) {
  const start = normaliseDateTimeInput(startInput);
  const end = normaliseDateTimeInput(endInput);
  const startParts = splitIsoToParts(start.iso);
  const endParts = splitIsoToParts(end.iso);
  const startSegment = buildIsoSegment(startParts);
  const endSegment = buildIsoSegment(endParts);
  let range = '';
  if (startSegment && endSegment) {
    if (startParts.date && endParts.date && startParts.date === endParts.date) {
      if (startParts.time && endParts.time) {
        range = `${startParts.date} ${startParts.time}–${endParts.time}`;
      } else {
        range = startSegment;
      }
    } else {
      range = `${startSegment} → ${endSegment}`;
    }
  } else {
    range = startSegment || endSegment;
  }
  const tzFallback = (start.iso && start.iso.endsWith('Z') && end.iso && end.iso.endsWith('Z')) ? 'UTC' : '';
  const tz = start.tz || end.tz || tzFallback;
  return range && tz ? `${range} (${tz})` : range;
}

function summariseToolResult({ toolName, toolMessage, toolArgs, rawText }) {
  let payload;
  if (toolMessage && typeof toolMessage === 'object') {
    const extra = toolMessage.additional_kwargs;
    if (extra && typeof extra === 'object') {
      if (extra.output !== undefined) payload = extra.output;
      else if (extra.data !== undefined) payload = extra.data;
      else if (extra.content !== undefined) payload = extra.content;
    }
    if (payload === undefined && toolMessage.output !== undefined) payload = toolMessage.output;
    if (payload === undefined && toolMessage.result !== undefined) payload = toolMessage.result;
    if (payload === undefined && typeof toolMessage.content === 'object' && !Array.isArray(toolMessage.content)) {
      payload = toolMessage.content;
    }
  }
  if (payload === undefined && typeof rawText === 'string') {
    const trimmed = rawText.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { payload = JSON.parse(trimmed); }
      catch (_) { payload = undefined; }
    }
  }

  if (toolName === 'calendar.event.createOrUpdate') {
    let args = toolArgs;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); }
      catch (_) { args = {}; }
    }
    const subject = typeof args?.subject === 'string' && args.subject.trim() ? args.subject.trim() : 'Termin';
    const range = formatDateRangeForSummary(args?.start, args?.end);
    const status = typeof payload?.status === 'string'
      ? payload.status
      : (args && args.eventId ? 'updated' : 'created');
    const eventId = payload && typeof payload.eventId === 'string' ? payload.eventId : undefined;
    const statusVerb = status === 'updated' ? 'aktualisiert' : 'erstellt';
    let sentence = `Termin ${statusVerb}: '${subject}'`;
    if (range) sentence += ` (${range})`;
    if (eventId) sentence += ` [${eventId}]`;
    return sentence;
  }

  if (payload && typeof payload === 'object') {
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();
    if (typeof payload.text === 'string' && payload.text.trim()) return payload.text.trim();
    if (typeof payload.summary === 'string' && payload.summary.trim()) return payload.summary.trim();
    if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
    if (typeof payload.status === 'string') {
      const extraKeys = ['eventId', 'draftId', 'internetMessageId', 'attachmentId', 'driveItemId', 'filePath', 'feature'];
      const extras = [];
      for (const key of extraKeys) {
        const val = payload[key];
        if (val === undefined || val === null || val === '') continue;
        extras.push(`${key}: ${val}`);
      }
      return extras.length ? `${payload.status}: ${extras.join(', ')}` : payload.status;
    }
  }

  if (typeof rawText === 'string' && rawText.trim()) return rawText.trim();
  if (payload !== undefined) {
    try { return JSON.stringify(payload); }
    catch (_) { }
  }
  return '';
}

let agentExecutor = null;
let mcpClients = null;
let agentInfo = { toolNames: [], modelName: '', provider: '' };
const { unwrapError, safeJson } = require('./helpers/logging');
const { enableHttpTrace } = require('./bootstrap/http-trace');
const { createInProcessToolDefinitions } = require('./mcp-tool-registry');

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
      const end = Math.min(i + chunkSize, n);
      // try to break at a pleasant boundary within the window
      const searchWindowEnd = Math.max(i + 1, end - 1);
      const idxPeriod = line.lastIndexOf('.', searchWindowEnd);
      const idxExclaim = line.lastIndexOf('!', searchWindowEnd);
      const idxQuestion = line.lastIndexOf('?', searchWindowEnd);
      const idxSpace = line.lastIndexOf(' ', searchWindowEnd);
      let j = Math.max(idxPeriod, idxExclaim, idxQuestion);
      if (j < i && idxSpace >= i + Math.floor(chunkSize / 2)) {
        j = idxSpace;
      }
      if (j < i) {
        j = end;
      } else {
        j = Math.min(j + 1, n); // include boundary character
      }
      const piece = line.slice(i, j).trimStart();
      if (piece) sseWrite(res, piece);
      i = j;
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
  try {
    console.log('[AGENT][mcp_clients]', { available: Object.keys(mcpClients || {}) });
  } catch (_) { }

  // 2) Guarded proxy for MCP tool(s); only expose whitelisted name(s)
  const allTools = [];
  const m365AllowRaw = process.env.MCP_M365_TOOLS || '';
  const m365AllowList = m365AllowRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const allowAllM365 = m365AllowList.length === 0 || m365AllowList.includes('*') || m365AllowList.includes('all');
  if (mcpClients.m365 && typeof mcpClients.m365.callTool === 'function') {
    try {
      const manifest = typeof mcpClients.m365.listTools === 'function'
        ? await mcpClients.m365.listTools()
        : null;
      if (manifest && Array.isArray(manifest.tools) && manifest.tools.length) {
        const defs = createInProcessToolDefinitions({
          manifest,
          callTool: async ({ name, args }) => mcpClients.m365.callTool({ name, arguments: args }),
          z,
        });
        for (const def of defs) {
          if (!allowAllM365 && !m365AllowList.includes(def.name)) continue;
          const tool = new DynamicStructuredTool({
            name: def.name,
            description: def.description,
            schema: def.zodSchema,
            func: async (input) => {
              const output = await def.invoke(input);
              const text = typeof output === 'string' ? output : safeJson(output);
              const slim = reduceOutput(def.name, text);
              try {
                console.log('[M365][tool]', {
                  tool: def.name,
                  rawBytes: text.length,
                  slimBytes: slim.length,
                  rawHash: hash(text),
                });
              } catch (_) { }
              return output;
            },
            metadata: def.metadata,
          });
          allTools.push(tool);
        }
      }
    } catch (err) {
      try {
        console.warn('[M365][tools]', 'Registrierung fehlgeschlagen', err?.message || String(err));
      } catch (_) {}
    }
  }

  if (mcpClients.postgres) {
    const callPostgres = async (toolName, args) => {
      const out = await mcpClients.postgres.callTool({ name: toolName, arguments: args });
      let raw;
      try {
        const text = extractMcpText(out);
        const fallback = typeof out === 'string' ? out : JSON.stringify(out);
        raw = text && text.trim() ? text : fallback;
      } catch (_) {
        raw = String(out || '');
      }
      const slim = reduceOutput(toolName, raw);
      try {
        console.log('[PG][proxy]', { tool: toolName, rawBytes: raw.length, slimBytes: slim.length, rawHash: hash(raw) });
      } catch (_) { }
      return slim;
    };

    const allowedPostgres = (process.env.MCP_POSTGRES_TOOLS
      || 'postgres_execute_sql,postgres_list_schemas,postgres_list_objects,postgres_get_object_details,postgres_explain_query,postgres_get_top_queries,postgres_analyze_db_health')
      .split(',').map(s => s.trim()).filter(Boolean);
    try { console.log('[AGENT][tools_whitelist]', { postgres: allowedPostgres }); } catch (_) {}

    if (allowedPostgres.includes('postgres_execute_sql')) {
      allTools.push(new DynamicStructuredTool({
        name: 'postgres_execute_sql',
        description: 'Führt SQL (CRUD) auf der ClaimPilot-Datenbank aus. Erwartet reines SQL, keine zusätzliche Kontextantwort.',
        schema: z.object({ sql: z.string().min(1, 'SQL ist erforderlich') }),
        func: async ({ sql }) => callPostgres('execute_sql', { sql }),
      }));
    }

    if (allowedPostgres.includes('postgres_list_schemas')) {
      allTools.push(new DynamicStructuredTool({
        name: 'postgres_list_schemas',
        description: 'Listet verfügbare Schemas im aktuellen PostgreSQL-Cluster.',
        schema: z.object({}).optional(),
        func: async () => callPostgres('list_schemas', {}),
      }));
    }

    if (allowedPostgres.includes('postgres_list_objects')) {
      allTools.push(new DynamicStructuredTool({
        name: 'postgres_list_objects',
        description: 'Listet Tabellen, Views, Sequenzen oder Erweiterungen in einem Schema.',
        schema: z.object({
          schema_name: z.string().min(1, 'Schema benötigt'),
          object_type: z.enum(['table', 'view', 'sequence', 'extension']).default('table'),
        }),
        func: async ({ schema_name, object_type }) => callPostgres('list_objects', { schema_name, object_type }),
      }));
    }

    if (allowedPostgres.includes('postgres_get_object_details')) {
      allTools.push(new DynamicStructuredTool({
        name: 'postgres_get_object_details',
        description: 'Zeigt Spalten, Constraints und Indizes für Tabellen/Views sowie Details für Sequenzen oder Erweiterungen.',
        schema: z.object({
          schema_name: z.string().min(1, 'Schema benötigt'),
          object_name: z.string().min(1, 'Objektname benötigt'),
          object_type: z.enum(['table', 'view', 'sequence', 'extension']).default('table'),
        }),
        func: async ({ schema_name, object_name, object_type }) => callPostgres('get_object_details', { schema_name, object_name, object_type }),
      }));
    }

    if (allowedPostgres.includes('postgres_explain_query')) {
      allTools.push(new DynamicStructuredTool({
        name: 'postgres_explain_query',
        description: 'Erzeugt Explain-Plan für eine SQL-Abfrage. Optional mit ANALYZE oder hypothetischen Indizes.',
        schema: z.object({
          sql: z.string().min(1, 'SQL ist erforderlich'),
          analyze: z.boolean().optional(),
          hypothetical_indexes: z.array(z.object({
            table: z.string(),
            columns: z.array(z.string()).nonempty(),
            using: z.string().optional(),
          })).optional(),
        }),
        func: async ({ sql, analyze, hypothetical_indexes }) => callPostgres('explain_query', {
          sql,
          analyze: analyze ?? false,
          hypothetical_indexes: hypothetical_indexes || [],
        }),
      }));
    }

    if (allowedPostgres.includes('postgres_get_top_queries')) {
      allTools.push(new DynamicStructuredTool({
        name: 'postgres_get_top_queries',
        description: 'Zeigt auffällige SQLs basierend auf Ausführungszeit oder Ressourcenverbrauch.',
        schema: z.object({
          sort_by: z.enum(['resources', 'mean_time', 'total_time']).default('resources'),
          limit: z.number().int().min(1).max(50).optional(),
        }),
        func: async ({ sort_by, limit }) => callPostgres('get_top_queries', {
          sort_by: sort_by || 'resources',
          limit: limit ?? 10,
        }),
      }));
    }

    if (allowedPostgres.includes('postgres_analyze_db_health')) {
      allTools.push(new DynamicStructuredTool({
        name: 'postgres_analyze_db_health',
        description: 'Führt die integrierten Health-Checks (Index, Vacuum, Sequenzen usw.) aus.',
        schema: z.object({
          health_type: z.string().optional(),
        }),
        func: async ({ health_type }) => callPostgres('analyze_db_health', {
          health_type: health_type || 'all',
        }),
      }));
    }

    if (allowedPostgres.includes('postgres_analyze_workload_indexes')) {
      allTools.push(new DynamicStructuredTool({
        name: 'postgres_analyze_workload_indexes',
        description: 'Sucht Indexempfehlungen für das Gesamtsystem (nutzt pg_stat_statements).',
        schema: z.object({
          max_index_size_mb: z.number().int().min(1).optional(),
          method: z.enum(['dta', 'llm']).optional(),
        }),
        func: async ({ max_index_size_mb, method }) => callPostgres('analyze_workload_indexes', {
          max_index_size_mb: max_index_size_mb ?? 10000,
          method: method || 'dta',
        }),
      }));
    }

    if (allowedPostgres.includes('postgres_analyze_query_indexes')) {
      allTools.push(new DynamicStructuredTool({
        name: 'postgres_analyze_query_indexes',
        description: 'Analysiert benannte SQL-Statements und schlägt Indizes vor.',
        schema: z.object({
          queries: z.array(z.string().min(1)).min(1).max(10),
          max_index_size_mb: z.number().int().min(1).optional(),
          method: z.enum(['dta', 'llm']).optional(),
        }),
        func: async ({ queries, max_index_size_mb, method }) => callPostgres('analyze_query_indexes', {
          queries,
          max_index_size_mb: max_index_size_mb ?? 10000,
          method: method || 'dta',
        }),
      }));
    }
  }

  const toolNames = allTools.map(t => t?.name || 'unknown');
  if (toolNames.length) {
    try { console.log('[AGENT][tools_loaded]', { count: toolNames.length, names: toolNames }); } catch (_) { }
  } else {
    try { console.warn('[AGENT][tools_loaded]', { count: 0, reason: 'keine Tools konfiguriert' }); } catch (_) { }
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
    agentInfo.toolNames = toolNames;
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
  let pendingToolCall = null;  // last tool call issued by the LLM
  let lastObservationText = '';
  let lastObservationSource = '';
  const emitAgentText = (rawText, { allowReasonStep = true, source = '' } = {}) => {
    const text = typeof rawText === 'string' ? rawText : String(rawText || '');
    if (!text) return false;
    if (logOutput) {
      try {
        sentChars += text.length;
        if (sentPreview.length < 800) {
          const needed = 800 - sentPreview.length;
          if (needed > 0) sentPreview += text.slice(0, needed);
        }
        const live = text.length > 160 ? text.slice(0, 160) + ' ... ' : text;
        const label = source ? `[AGENT][send:${source}]` : '[AGENT][send]';
        console.log(label, live);
      } catch (_) { }
    }
    sseWriteChunked(res, text);
    if (allowReasonStep && logSteps && !awaitingTool) {
      try {
        if (phase !== 'reason') {
          step += 1;
          console.log('[AGENT][step]', { step, action: 'reason', preview: text.slice(0, 200) });
        }
        phase = 'reason';
      } catch (_) { }
    }
    return true;
  };
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

  const systemMessage = (() => {
    let nowUtc;
    try {
      nowUtc = new Date().toISOString();
    } catch (_) {
      nowUtc = null;
    }
    const header = nowUtc ? `Aktuelle UTC-Zeit: ${nowUtc}` : 'Aktuelle Zeit: unbekannt';
    return {
      role: 'system',
      content: [
        header,
        '',
        'Du bist ein technischer Assistent für die ClaimPilot-Plattform. Sprich Deutsch, antworte kurz und strukturiert.',
        '',
        'Verfügbare Werkzeuge:',
        '- Microsoft 365 (MCP): nutze sie deterministisch und mit expliziten IDs.',
        '  • "mail.latestMessage.get" und "mail.message.fetch" liefern Posteingangsdaten.',
        '  • Antworten/Weiterleiten erfolgen über "mail.message.replyDraft" bzw. "mail.message.send".',
        '  • Anhänge bearbeitest du mit "mail.attachment.download" oder "mail.attachment.uploadAndAttach".',
        '  • Termine verwaltest du mit den "calendar.*"-Tools.',
        '  • Excel-Daten liest/schreibst du via "excel.workbook.*" (Sheet-Namen angeben; Session-ID nur nutzen, wenn Graph sie explizit liefert).',
        '  • Prüfe Verfügbarkeit/Token per "graph.health.check" oder "graph.token.acquire" bei Fehlern.',
        '- Datenbankaufgaben (PostgreSQL):',
        '  • Schema- und Objektübersicht über "postgres_list_schemas" / "postgres_list_objects".',
        '  • CRUD mit "postgres_execute_sql" und Änderungen knapp beschreiben (z. B. "Schadensfall 4711 geschlossen"), aber keine riesigen Roh-Resultsets zurückgeben.',
        '  • Performanceanalyse über "postgres_explain_query", "postgres_get_top_queries", "postgres_analyze_db_health" und die Index-Tools.',
        '',
        'Arbeitsweise:',
        '- Nutze nur freigegebene Tools, prüfe Parameter sorgfältig, und halte die Antworten prägnant.',
        '- Beschreibe Fehlermeldungen knapp und schlage konkrete nächste Schritte vor.',
        '- Stoppe, sobald die Nutzeranforderung erfüllt ist.'
      ].join('\n')
    };
  })();
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

    let lastReturnText = '';
    for await (const chunk of stream) {
      // Agent text tokens
      let chunkProvidedText = false;
      if (chunk && chunk.agent && Array.isArray(chunk.agent.messages)) {
        const msg = chunk.agent.messages[chunk.agent.messages.length - 1];
        if (msg && msg.content) {
          const msgHasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
          const text = extractMessageText(msg);
          if (text) {
            if (emitAgentText(text, { allowReasonStep: !msgHasToolCalls })) {
              chunkProvidedText = true;
            }
          }
          if (msgHasToolCalls) {
            const call = msg.tool_calls[0];
            try { console.log('[AGENT][tool_start]', { tool: call.name, args: call.args || {} }); } catch (_) { }
            if (logSteps) {
              try { if (phase !== 'tool') { /* keep same step for this round */ } console.log('[AGENT][step]', { step: Math.max(step, 1), action: 'tool_call', tool: call.name }); } catch (_) { }
            }
            let callArgs = call.args;
            if (typeof callArgs === 'string') {
              try { callArgs = JSON.parse(callArgs); }
              catch (_) { callArgs = call.args; }
            }
            pendingToolCall = { name: call.name, args: callArgs };
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
        const toolName = toolMsg?.name || pendingToolCall?.name || '';
        const summary = summariseToolResult({
          toolName,
          toolMessage: toolMsg,
          toolArgs: pendingToolCall ? pendingToolCall.args : undefined,
          rawText: toolText,
        });
        const nextObservation = summary || (toolText && toolText.trim()) || '';
        if (nextObservation) {
          lastObservationText = nextObservation;
          lastObservationSource = toolName || 'tool';
        }
        pendingToolCall = null;
        awaitingTool = false;
        phase = 'observation';
      }

      const fallbackText = extractFinalChunkText(chunk);
      if (fallbackText) {
        lastReturnText = fallbackText;
        if (!chunkProvidedText) {
          if (emitAgentText(fallbackText, { source: 'return_values' })) {
            chunkProvidedText = true;
          }
        }
      }
    }

    if (sentChars === 0 && lastReturnText) {
      awaitingTool = false;
      emitAgentText(lastReturnText, { source: 'return_values_final' });
    } else if (sentChars === 0 && lastObservationText) {
      awaitingTool = false;
      emitAgentText(lastObservationText, { source: `observation:${lastObservationSource || 'tool'}`, allowReasonStep: false });
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

module.exports = { runAgentStreaming, initAgent };
