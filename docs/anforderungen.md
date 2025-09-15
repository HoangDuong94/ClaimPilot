**refactor-ai-agent.md**
*Vereinfachung von `/ai/agent/stream` auf LangGraph + MCP*

---

## TL;DR

Der aktuelle Agent-Endpoint ist zu komplex und nutzt eine Eigenbau-Planung/Streaming-Bridge. Ziel ist ein **einfacher, robuster** Agent-Aufruf, der **LangGraph** (React-Agent) mit **MCP-Tools** nutzt – ähnlich dem von dir gezeigten Beispiel.

**Kernänderungen:**

* **Löschen**: `agent/graph.js`, `agent/sseBridge.js`, alter `agent/mcpClient.js` (Wrapper/Fallback-CLI)
* **Neu**: `agent/mcp-clients.js` (klare Initialisierung konfigurierbarer MCP-Clients)
* **Neu**: stark vereinfachtes `agent/index.js` mit `createReactAgent`, `MemorySaver`, `loadMcpTools`, sauberer SSE-Ausgabe
* **Anpassen**: `server.js` ruft nur noch den neuen Agent auf (kein eigener Planner/Fallback nötig)
* **Aufräumen**: keine eigene Memory/Plan-Logik, keine CLI-Fallbacks; stattdessen MCP + LangGraph

---

## Probleme im aktuellen Stand

1. **Doppeltes Orchestrieren**: `sseBridge.js` plant/entscheidet Aktionen selbst (Mini-Planner) und streamt; **LangGraph wird gar nicht genutzt**.
2. **Zwei Pfade für Tools**: eigener MCP-Wrapper + mögliche CLI-Fallbacks → inkonsistent, schwer zu debuggen.
3. **In-Memory Memory** ohne Checkpointing; Thread-Verwaltung ist custom und fragil.
4. **Komplexe SSE-Logik** verteilt über mehrere Dateien.

---

## Zielbild

* **Ein einziger ReAct-Agent** via **LangGraph**:

  * LLM: `AzureOpenAiChatClient` (SAP GenAI Hub)
  * Tools: **MCP**-Tools via `@langchain/mcp-adapters` (`loadMcpTools`)
  * State: **`MemorySaver`** (LangGraph-Checkpoint)
* **Einfache SSE-Bridge**: streamt direkt die Agent-Events (Agent-Messages, Tool-Calls, Tool-Outputs, Final)
* **Konfigurierbare MCP-Server** per ENV (Brave, Filesystem, Playwright, Excel, M365, …)

---

## Akzeptanzkriterien

* `POST /ai/agent/stream` mit `{ "prompt": "...", "threadId": "..." }`
  → **SSE-Stream** startet **innerhalb des ersten Tokens** und enthält:

  * Zwischentexte des Agents
  * Tool-Start/Ende-Events mit Namen und Argumenten
  * Tool-Ausgaben (gekürzt, wenn sehr lang)
  * Finales Ende-Event `end [DONE]`
* Agent verwendet **nur** LangGraph + MCP-Tools (kein eigener Planner).
* **Thread-übergreifendes Gedächtnis** via `MemorySaver` (Kontext bleibt pro `threadId` erhalten).
* **Keine CLI-Fallbacks** mehr (Fehler sind klar und kurz sichtbar; Logging vorhanden).

---

## To-Do (Schritte für den Umbau)

### 1) Entfernen (löschen)

* `agent/graph.js` (PoC-Stubs ungenutzt)
* `agent/sseBridge.js` (eigene Planner-/Streaming-Logik)
* `agent/mcpClient.js` (Custom-Wrapper & CLI-Fallbacks)

> Begründung: Diese Dateien duplizieren bzw. ersetzen die Funktionalität, die **LangGraph** und **mcp-adapters** out-of-the-box bieten.

---

### 2) Neu anlegen: `agent/mcp-clients.js`

Zentrale Initialisierung der gewünschten MCP-Server. **Nur** was per ENV eingeschaltet ist, wird gestartet.
Gemeinsame Utility-Funktion, die für Stdio-Server einen MCP-Client startet.

```js
// agent/mcp-clients.js (CommonJS)
const process = require('process');

function parseCommandLine(cmd) {
  const tokens = [];
  let cur = '', q = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (ch === ' ') { if (cur) { tokens.push(cur); cur=''; } }
    else cur += ch;
  }
  if (cur) tokens.push(cur);
  const command = tokens.shift();
  return { command, args: tokens };
}

async function startMcpClient(name, command, args, env) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({ command, args, env: { ...process.env, ...env } });
  const client = new Client({ name: `mcp-${name}`, version: '1.0.0' }, {});
  await client.connect(transport);
  return { client, transport };
}

async function initAllMCPClients() {
  const clients = {};

  // Brave Search MCP
  if (process.env.MCP_BRAVE === '1') {
    const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
    if (!BRAVE_API_KEY) throw new Error('BRAVE_API_KEY fehlt (für MCP_BRAVE=1)');
    const { client } = await startMcpClient(
      'brave',
      'npx',
      ['-y', '@modelcontextprotocol/server-brave-search'],
      { BRAVE_API_KEY }
    );
    clients.brave = client;
  }

  // Filesystem MCP
  if (process.env.MCP_FILESYSTEM === '1') {
    const allowedDir = process.env.MCP_FS_DIR || process.cwd();
    const extraDir   = process.env.MCP_FS_EXTRA_DIR; // optional
    const args = extraDir
      ? ['-y', '@modelcontextprotocol/server-filesystem', allowedDir, extraDir]
      : ['-y', '@modelcontextprotocol/server-filesystem', allowedDir];
    const { client } = await startMcpClient('filesystem', 'npx', args, {});
    clients.filesystem = client;
  }

  // Playwright MCP (optional)
  if (process.env.MCP_PLAYWRIGHT === '1') {
    const { client } = await startMcpClient(
      'playwright',
      'npx',
      ['-y', '@executeautomation/playwright-mcp-server'],
      {
        PLAYWRIGHT_BROWSER: process.env.PLAYWRIGHT_BROWSER || 'chromium',
        PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS || 'true',
      }
    );
    clients.playwright = client;
  }

  // Excel MCP (Windows)
  if (process.env.MCP_EXCEL === '1') {
    const { client } = await startMcpClient(
      'excel',
      'cmd',
      ['/c', 'npx', '--yes', '@negokaz/excel-mcp-server'],
      { EXCEL_MCP_PAGING_CELLS_LIMIT: process.env.EXCEL_MCP_PAGING_CELLS_LIMIT || '4000' }
    );
    clients.excel = client;
  }

  // Generischer benutzerdefinierter MCP Server (z.B. M365)
  // Beispiel: MCP_M365_CMD='npx m365-mcp-server'
  if (process.env.MCP_M365_CMD) {
    const { command, args } = parseCommandLine(process.env.MCP_M365_CMD);
    if (!command) throw new Error('MCP_M365_CMD leer/ungültig');
    const { client } = await startMcpClient('m365', command, args, {});
    clients.m365 = client;
  }

  return clients;
}

async function closeMCPClients(clients = {}) {
  const all = Object.values(clients);
  await Promise.all(all.map(async (c) => {
    try { await c.close(); } catch (_) {}
  }));
}

module.exports = { initAllMCPClients, closeMCPClients };
```

**Warum?**

* Ein Ort für alle MCP-Initialisierungen, **klar konfigurierbar** per ENV.
* Keine Tool- oder Server-seitige Business-Logik hier; das ist Aufgabe des Agents.

---

### 3) Neu schreiben: `agent/index.js` (LangGraph + MCP, SSE simpel)

```js
// agent/index.js (CommonJS)
let agentExecutor = null;
let mcpClients = null;

function sseWrite(res, data) {
  if (!data) return;
  res.write(`data: ${data}\n\n`);
}
function sseJson(res, obj) { sseWrite(res, JSON.stringify(obj)); }
function sseEnd(res) { res.write('event: end\n'); res.write('data: [DONE]\n\n'); res.end(); }

async function initAgent() {
  if (agentExecutor) return agentExecutor;

  const { initAllMCPClients } = require('./mcp-clients');
  const { loadMcpTools } = await import('@langchain/mcp-adapters');
  const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
  const { MemorySaver } = await import('@langchain/langgraph-checkpoint');
  const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/langchain');

  // 1) MCP Clients laden
  mcpClients = await initAllMCPClients();

  // 2) Tools von den Clients holen (explizit, simpel, erweiterbar)
  const allTools = [];

  if (mcpClients.brave) {
    const brave = await loadMcpTools('brave_web_search,brave_local_search', mcpClients.brave);
    allTools.push(...brave);
  }
  if (mcpClients.filesystem) {
    const fs = await loadMcpTools(
      'read_file,write_file,edit_file,create_directory,list_directory,move_file,search_files,get_file_info,list_allowed_directories',
      mcpClients.filesystem
    );
    allTools.push(...fs);
  }
  if (mcpClients.playwright) {
    const pw = await loadMcpTools(
      'take_screenshot,goto_page,click_element,fill_input,execute_javascript,get_page_content,wait_for_element,generate_test_code',
      mcpClients.playwright
    );
    allTools.push(...pw);
  }
  if (mcpClients.excel) {
    const xlsx = await loadMcpTools(
      'excel_describe_sheets,excel_read_sheet,excel_screen_capture,excel_write_to_sheet,excel_create_table,excel_copy_sheet',
      mcpClients.excel
    );
    allTools.push(...xlsx);
  }
  if (mcpClients.m365) {
    // Generisch: ALLE Tools des Servers dynamisch laden (falls Namen unbekannt)
    const toolsResp = await mcpClients.m365.listTools();
    const names = (toolsResp.tools || []).map(t => t.name).join(',');
    if (names) {
      const m365 = await loadMcpTools(names, mcpClients.m365);
      allTools.push(...m365);
    }
  }

  // 3) LLM + Checkpointing
  const llm = new AzureOpenAiChatClient(
    {
      modelName: process.env.AI_MODEL_NAME || 'gpt-4.1',
      temperature: Number(process.env.AI_TEMPERATURE || 0.2),
    },
    { destinationName: process.env.AI_DESTINATION_NAME || 'aicore-destination' }
  );
  const checkpointer = new MemorySaver();

  // 4) Agent bauen
  agentExecutor = createReactAgent({ llm, tools: allTools, checkpointSaver: checkpointer });
  return agentExecutor;
}

async function runAgentStreaming({ prompt, threadId, res }) {
  if (!prompt || !String(prompt).trim()) {
    res.statusCode = 400;
    sseJson(res, { error: 'Prompt is required' });
    return sseEnd(res);
  }
  const executor = await initAgent();

  const systemMessage = {
    role: 'system',
    content:
      'You are a helpful assistant. You can use MCP tools (web search, filesystem, browser, excel, m365 etc.). ' +
      'When using filesystem: you are sandboxed to the allowed directories. ' +
      'When using Excel tools: always start with excel_describe_sheets; be careful writing. ' +
      'Explain briefly what you are doing when invoking tools.',
  };

  const userMessage = { role: 'user', content: String(prompt) };

  // Stream vom Agent: wir mappen relevante Events auf SSE
  const stream = await executor.stream(
    { messages: [systemMessage, userMessage] },
    { configurable: { thread_id: String(threadId || 'default') } }
  );

  const finalChunks = [];

  for await (const chunk of stream) {
    // Agent-Text (Token-Stream)
    if (chunk.agent?.messages) {
      const msg = chunk.agent.messages[chunk.agent.messages.length - 1];
      if (msg?.content) {
        const text = typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
            : '';
        if (text) {
          finalChunks.push(text);
          sseWrite(res, text);
        }
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          const call = msg.tool_calls[0];
          sseJson(res, {
            event: 'tool_start',
            tool: call.name,
            args: call.args || {},
          });
        }
      }
    }

    // Tool-Ausgaben
    if (chunk.tools?.messages) {
      const toolMsg = chunk.tools.messages[0];
      const toolText = typeof toolMsg?.content === 'string'
        ? toolMsg.content
        : Array.isArray(toolMsg?.content)
          ? toolMsg.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
          : '';

      if (toolText) {
        sseJson(res, { event: 'tool_output', output: String(toolText).slice(0, 2000) });
      }
      sseJson(res, { event: 'tool_end' });
    }
  }

  sseEnd(res);
}

module.exports = { runAgentStreaming };
```

**Warum?**

* **Ein Einstiegspunkt**, der LangGraph initialisiert und Tools via MCP nachlädt.
* **Keine** eigene Planner- oder Memory-Implementierung – das übernimmt LangGraph.
* **SSE** ist minimal, klar und robust.

---

### 4) `server.js` anpassen

Im Agent-Endpoint **nur** noch den neuen Agent verwenden. Die bestehende Fallback-LLM-Streaming-Route `/ai/stream` kann bleiben.

```diff
 app.post('/ai/agent/stream', expressJson(), async (req, res) => {
-  const enabled = process.env.AGENT_ENABLE !== '0';
   try {
-    const { runAgentStreaming } = require('./agent');
-    const prompt = (req.body && req.body.prompt) || '';
-    const threadId = (req.body && req.body.threadId) || undefined;
-    const mode = (req.body && req.body.mode) || undefined; // ignored in PoC
+    const { runAgentStreaming } = require('./agent');
+    const prompt   = (req.body && req.body.prompt)   || '';
+    const threadId = (req.body && req.body.threadId) || undefined;

     res.status(200);
     res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
     res.setHeader('Cache-Control', 'no-cache, no-transform');
     res.setHeader('Connection', 'keep-alive');
     res.setHeader('X-Accel-Buffering', 'no');
     res.flushHeaders && res.flushHeaders();

-    if (!enabled) {
-      // Feature disabled -> fallback to plain LLM streaming
-      await streamGenAI(prompt, res);
-      return;
-    }
-    await runAgentStreaming({ prompt, threadId, mode, res });
+    await runAgentStreaming({ prompt, threadId, res });
   } catch (e) {
-    // On any error, fallback to plain LLM (still streamed)
-    try {
-      const prompt = (req.body && req.body.prompt) || '';
-      await streamGenAI(prompt, res, { forceFallback: true });
-    } catch (_) {
-      try {
-        res.write(`event: error\n`);
-        res.write(`data: ${JSON.stringify({ message: e && e.message ? e.message : String(e) })}\n\n`);
-        res.end();
-      } catch (_) { /* ignore */ }
-    }
+    try {
+      res.write(`event: error\n`);
+      res.write(`data: ${JSON.stringify({ message: e && e.message ? e.message : String(e) })}\n\n`);
+      res.end();
+    } catch (_) { /* ignore */ }
   }
 });
```

**Warum?**

* `/ai/agent/stream` ist explizit **Agent-only**.
* Das generische `/ai/stream` (reines LLM) bleibt separat.

---

## ENV & Dependencies

### Neue/benötigte Pakete

```json
{
  "dependencies": {
    "@sap-ai-sdk/langchain": "^<neuste>",
    "@langchain/langgraph": "^<neuste>",
    "@langchain/langgraph-checkpoint": "^<neuste>",
    "@langchain/mcp-adapters": "^<neuste>",
    "@modelcontextprotocol/sdk": "^<neuste>"
  }
}
```

> **Hinweis:** LangChain-/LangGraph-Pakete sind **ESM-only**. In CommonJS-Dateien daher wie oben gezeigt **dynamisch mit `await import()`** laden. Node **>= 18**.

### Beispiel-ENV

```bash
# SAP GenAI Hub / Azure OpenAI
export AI_DESTINATION_NAME=aicore-destination
export AI_MODEL_NAME=gpt-4.1
export AI_TEMPERATURE=0.2

# MCP Server toggles
export MCP_BRAVE=1
export BRAVE_API_KEY=...your key...
export MCP_FILESYSTEM=1
export MCP_FS_DIR=/path/to/project
export MCP_PLAYWRIGHT=0
export MCP_EXCEL=0

# Beispiel für M365 / Custom MCP Server:
# startet einen beliebigen MCP-Server via Stdio
export MCP_M365_CMD="npx m365-mcp-server"
```

---

## Entwickler-Notizen

* **Kein** eigener Planner mehr: Tool-Auswahl macht die ReAct-Schleife des LangGraph-Agents.
* **Tool-Namen**: Für bekannte MCP-Server (Brave, Filesystem, Playwright, Excel) laden wir **explizit** die Tools (klare Whitelist). Für **custom** Servers (z. B. M365) ziehen wir via `listTools()` die Namen und laden **alle** (sicher, aber generisch).
* **Threading/Memory**: `MemorySaver` nutzt `thread_id`; bitte `threadId` vom Client durchreichen (z. B. Konversation pro Ticket/Claim/Benutzer).
* **SSE**: Bewusst minimal. Frontend kann die Events `tool_start`, `tool_output`, `tool_end` nutzen, um UI-States zu zeigen.
* **Fehlerbilder** werden als `event: error` mit JSON-Message zurückgegeben (kein Fallback auf Plain-LLM mehr, das hat bisher Debugging verschleiert).

---

## Entfernte/ersetzte Verantwortung

| Alt                                                   | Neu                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `sseBridge.js` streamt Tokens und plant Tool-Schritt  | **LangGraph** streamt Tokens & Tool-Aufrufe, `agent/index.js` übersetzt nur die Events → SSE |
| `mcpClient.js` kapselt CLI & MCP (inkl. CLI-Fallback) | **Nur** MCP via `agent/mcp-clients.js`, **keine** CLI-Fallbacks                              |
| `agent/graph.js` (PoC-Stub)                           | entfällt                                                                                     |

---

## Beispiel: cURL-Test

```bash
curl -N -X POST http://localhost:4004/ai/agent/stream \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Suche die letzten News zu SAP und speichere die Titel in eine Datei titles.txt.","threadId":"session_demo"}'
```

Erwartung (gekürzt): fortlaufender Text, dann JSON-Blöcke wie

```json
{"event":"tool_start","tool":"brave_web_search","args":{"q":"..."}}
{"event":"tool_output","output":"..."}
{"event":"tool_end"}
```

und am Ende:

```
event: end
data: [DONE]
```

---

## Risiken & Hinweise

* **ESM/CommonJS-Mix**: Unbedingt die Imports wie oben gezeigt (dynamisch) lassen.
* **MCP-Server Lebenszyklus**: In diesem MVP starten wir sie pro Prozess und lassen sie laufen. Falls Lifecycle-Management nötig ist, `closeMCPClients()` an `process.on('SIGTERM')`/`srv.on('shutdown')` hängen.
* **Excel MCP**: Funktioniert offiziell auf Windows (wie im Beispiel); in CI/Linux deaktivieren.
* **Security**: Filesystem-Server unbedingt auf Projektverzeichnis begrenzen (`MCP_FS_DIR`)!
* **M365**: Sicherstellen, dass es einen stabilen MCP-Server gibt (oder via Custom-MCP) – die Tool-Namen werden dynamisch geladen.

---

## Nice to have (später)

* **Tool-Whitelist aus ENV** (z. B. `MCP_M365_TOOLS=m365,spo,graph`), statt alle Tools dynamisch zu laden.
* **Structured Outputs** für bestimmte Aufgaben (z. B. Tabellen) → bessere Frontend-Darstellung.
* **Persistenter Checkpoint-Store** (z. B. Redis oder Filesystem) statt In-Memory.

---

## Zusammenfassung

Mit diesem Refactor wird `/ai/agent/stream` **übersichtlich, stabil und erweiterbar**:

* **LangGraph** übernimmt die Orchestrierung,
* **MCP-Tools** werden sauber und konfigurierbar angebunden,
* **SSE** bleibt simpel, die UI bekommt klare Tool-Events,
* **Wartbarkeit** steigt, weil Eigenbau-Komponenten entfallen.

Bitte gemäß den obigen Schritten umsetzen.
