````markdown
# Backend-Anforderung – Token-sparsamer M365-Agent **mit History** (LangGraph + MCP)

**Version:** 1.0  
**Stand:** 2025-09-15  
**Autor:** Hoang  
**Adressat:** Backend-Entwicklung  
**Zielsystem:** Node.js / CAP / LangGraph / MCP (M365 CLI)  
**Repos/Filer:** `agent/index.js`, `agent/mcp-clients.js`, optional `agent/helpers/logging.js`

---

## Hintergrund / Problem
- Der Agent nutzt MCP-Tools für M365 (Primär: `m365_run_command`).  
- Bei Mail-Lesen kommt es zu **Token-Explosionen** (z. B. `context_length_exceeded ~500k tokens`), weil:
  1) Unlimitierte CLI-Calls (z. B. `outlook message list` ohne Filter) riesige JSONs liefern.  
  2) Tool-Outputs 1:1 als ToolMessages im LLM-Kontext landen.  
  3) System-Prompt wird mehrfach eingespeist; History bläht sich auf.

**Wunsch:** Historie (Kontext) **beibehalten**, aber die Token-Last **strict** begrenzen – ohne Funktionsverlust (Status, neueste Mail, Termine per Graph/CLI).

---

## Ziele
1. **Nur** das benötigte MCP-Tool verfügbar machen (sichtbar für das LLM): `m365_run_command`.  
2. **Guarded Tool Proxy**: Ein lokales Tool mit gleichem Namen, das
   - unlimitierte/gefährliche Aufrufe **umschreibt** (Mail-Listen),
   - Tool-Outputs **reduziert & zusammenfasst**, bevor sie ans LLM gehen.
3. **History behalten**, aber:
   - System-Message je Thread **nur einmal**,
   - ältere Runden **kompakt** halten (Rolling-Summary/Reducer),
   - große Tool-Blobs nie erneut vollständig in Messages einspeisen.
4. **Diagnostik**: Logging von geladenen Tools, geschätzten Prompt-Tokens, Größe der Tool-Outputs.

**Nicht-Ziele**
- Keine Änderung an CAP-Services/Fiori.  
- Kein Entfernen der History.  
- Keine Abhängigkeit von zusätzlichen externen Services.

---

## Technischer Ansatz (High-Level)
- MCP-Tool-Laden **hart whitelisten**.  
- **Eigenes LangChain-Tool** `m365_run_command` registrieren (Proxy) und intern über `mcpClients.m365.callTool(...)` an den MCP-Server delegieren.
- Vor dem Delegieren:
  - **Command-Policy** erzwingen (z. B. bei `outlook message list` → immer Zeitfenster `--startTime/--endTime` setzen; nie unlimitiert).
- Nach dem Delegieren:
  - **Reducer**: Nur relevante Felder extrahieren + auf feste Zeichen-Budgets kürzen, Rest als `…[truncated]`.
  - Große Roh-Payloads **nicht** ins LLM zurückspeisen; stattdessen kurze Zusammenfassung + Hash/ID für Trace (nur im Server-Log vollständig).
- **History-Policy**:
  - Checkpointer weiter verwenden (History bleibt).  
  - Pro `threadId` System-Message **nur beim ersten Turn** anhängen.  
  - Alte Tool-Outputs in der History **kompakt ersetzen** (Reducer/„rolling summary“), nicht als Volltext speichern.

---

## Konkrete Änderungen

### 1) MCP-Tools wirklich auf Whitelist beschränken
**Datei:** `agent/index.js` (in `initAgent()`)

```diff
- // bisher: alle Tools dynamisch laden
- const toolsResp = await mcpClients.m365.listTools();
- const names = (toolsResp.tools || []).map(t => t.name).join(',');
- const m365 = await loadMcpTools(names, mcpClients.m365);
- allTools.push(...m365);

+ // nur explizite Whitelist (Default: m365_run_command)
+ const allowed = (process.env.MCP_M365_TOOLS || 'm365_run_command')
+   .split(',').map(s => s.trim()).filter(Boolean);
+ console.log('[AGENT][tools_whitelist]', { allowed });
+ // wir registrieren gleich unseren Proxy (siehe Punkt 2) – MCP-Original nicht direkt exposen
````

> **Hinweis:** Wir **nicht** das MCP-Originaltool direkt exposen, sondern unseren **Proxy** gleichen Namens registrieren (Punkt 2).

---

### 2) Guarded Proxy-Tool (gleicher Name `m365_run_command`)

**Datei:** `agent/index.js`

```js
// am Anfang der Datei
const crypto = require('crypto');
function hash(s=''){ return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0,10); }

function cap(str, n=4000) {
  const s = String(str || '');
  return s.length > n ? s.slice(0, n) + ' …[truncated]' : s;
}

// Spezifischer Reducer für bekannte Kommandos
function reduceOutput(cmd, raw) {
  // Versuche JSON zu parsen
  let data = raw;
  try { data = JSON.parse(raw); } catch (_) {}

  // 1) m365 status
  if (/m365\s+status\b/i.test(cmd)) {
    const o = typeof data === 'object' ? data : {};
    const slim = {
      connectedAs: o.connectedAs, cloudType: o.cloudType, authType: o.authType,
      connectionName: o.connectionName, appId: o.appId, appTenant: o.appTenant
    };
    return JSON.stringify(slim);
  }

  // 2) outlook message list – Liste stark eindampfen
  if (/m365\s+outlook\s+message\s+list\b/i.test(cmd)) {
    const arr = Array.isArray(data) ? data : [];
    // nur 3 neueste Items, je nur wenige Felder
    const slim = arr.slice(0, 3).map(x => ({
      id: x.id,
      subject: x.subject,
      fromName: x.from?.emailAddress?.name,
      fromAddress: x.from?.emailAddress?.address,
      receivedDateTime: x.receivedDateTime,
      preview: (x.bodyPreview || '').slice(0, 120)
    }));
    return JSON.stringify(slim);
  }

  // 3) outlook event add – kompaktes Echo
  if (/m365\s+outlook\s+event\s+add\b/i.test(cmd)) {
    if (typeof data === 'object') {
      const slim = {
        id: data.id, subject: data.subject,
        start: data.start?.dateTime || data.start, end: data.end?.dateTime || data.end,
        attendees: Array.isArray(data.attendees) ? data.attendees.length : undefined
      };
      return JSON.stringify(slim);
    }
  }

  // default – als String, gekappt
  return cap(typeof data === 'string' ? data : JSON.stringify(data), 4000);
}

// Policy: gefährliche/unlimitierte Kommandos umschreiben
function rewriteCommandSafely(cmd) {
  // outlook message list: sicherstellen, dass Zeitfenster vorhanden ist
  if (/m365\s+outlook\s+message\s+list\b/i.test(cmd)) {
    const hasStart = /--startTime\s+"/i.test(cmd);
    const hasEnd   = /--endTime\s+"/i.test(cmd);

    if (!hasStart || !hasEnd) {
      const now = new Date();
      const from = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2h zurück
      const isoNow = now.toISOString();
      const isoFrom = from.toISOString();

      // füge Zeitfenster an, falls nicht vorhanden
      cmd += ` --startTime "${isoFrom}" --endTime "${isoNow}"`;
    }
    // unsichere/ungültige Optionen entfernen
    cmd = cmd.replace(/\s--(?:top|pageSize|orderby)\b[^\s"]*(\s+"[^"]*")?/gi, '');
  }
  return cmd;
}
```

Proxy-Tool registrieren (statt MCP-Original):

```js
const { DynamicStructuredTool } = await import('@langchain/core/tools');
const { z } = await import('zod');

const guardedRun = new DynamicStructuredTool({
  name: 'm365_run_command',
  description: 'Sicherer Proxy für Microsoft 365 CLI Kommandos über MCP.',
  schema: z.object({ command: z.string() }),
  func: async ({ command }) => {
    const safeCmd = rewriteCommandSafely(command);
    const out = await mcpClients.m365.callTool({
      name: 'm365_run_command',
      arguments: { command: safeCmd }
    });
    const raw = typeof out === 'string' ? out : JSON.stringify(out);
    const slim = reduceOutput(safeCmd, raw);

    // Server-Trace (vollständig), aber LLM bekommt nur 'slim'
    console.log('[M365][proxy]', {
      cmd: safeCmd, rawBytes: raw.length, slimBytes: slim.length, rawHash: hash(raw)
    });
    return slim; // <<— nur reduziertes Ergebnis ans LLM!
  }
});

// Jetzt nur unseren Proxy exposen
allTools.push(guardedRun);
```

---

### 3) System-Message nur einmal je Thread

**Datei:** `agent/index.js` (in `runAgentStreaming()`)

```diff
- const systemMessage = { role: 'system', content: '...PROMPT...' };
- const userMessage   = { role: 'user', content: String(prompt) };
- const stream = await executor.stream(
-   { messages: [systemMessage, userMessage] },
-   { recursionLimit: Number(process.env.AGENT_RECURSION_LIMIT || 100), configurable: { thread_id: String(threadId || 'default') }, callbacks }
- );

+ const systemMessage = { role: 'system', content: '...PROMPT...' };
+ const userMessage   = { role: 'user', content: String(prompt) };
+ const msgs = [];
+ // System nur beim ersten Turn in einem Thread mitsenden
+ const tid = String(threadId || 'default');
+ const isFirstTurn = !global.__threadsWithSystem; 
+ global.__threadsWithSystem ??= new Set();
+ if (!global.__threadsWithSystem.has(tid)) {
+   msgs.push(systemMessage);
+   global.__threadsWithSystem.add(tid);
+ }
+ msgs.push(userMessage);
+ const stream = await executor.stream(
+   { messages: msgs },
+   { recursionLimit: Number(process.env.AGENT_RECURSION_LIMIT || 4), configurable: { thread_id: tid }, callbacks }
+ );
```

> `recursionLimit` defensiv auf `4` reduzieren (History bleibt, aber keine endlosen ReAct-Runden).

---

### 4) History kompakt halten (Rolling-Summary light)

**Optional, aber empfohlen.** Nach jedem Tool-Output die **im Checkpointer gespeicherte** Nachricht ersetzen durch die **reduzierte** Form (`reduceOutput`), **nicht** durch das Roh-JSON.
Falls im aktuellen Setup schwierig: Reicht fürs Erste, dass unser Proxy dem LLM **nur** `slim` gibt. (Rohdaten bleiben im Server-Log.)

---

### 5) Diagnostik & Token-Schätzung

**Datei:** `agent/index.js` – bestehende Callback-Logs erweitern:

```js
handleLLMStart: (_llm, prompts) => {
  try {
    const s = JSON.stringify(prompts);
    const approxTokens = Math.ceil(s.length / 4);
    console.log('[AGENT][llm_start]', { reqId, prompts: Array.isArray(prompts)?prompts.length:undefined, approxTokens });
  } catch {}
},
handleToolEnd: (output) => {
  try {
    const text = typeof output === 'string' ? output : JSON.stringify(output||'');
    console.log('[AGENT][cb_tool_end]', { reqId, bytes: text.length, preview: text.slice(0, 200) });
  } catch {}
},
```

---

## Akzeptanzkriterien

1. **Loaded Tools**: Log meldet nach Start **nur** `['m365_run_command']`.
2. **Mail-Listen-Call**: Im Log ist **immer** ein Zeitfenster (`--startTime/--endTime`) sichtbar; keine `--top/--pageSize/--orderby`.
3. **Tool-Output im LLM**: Die an das LLM gehende Tool-Nachricht (der Proxy-Return) ist **kompakt** (≤ 4 KB). Server-Log zeigt zusätzlich `rawBytes` und `slimBytes`.
4. **System-Message**: Pro `threadId` wird die System-Message **max. einmal** an `messages` angehängt.
5. **Keine `context_length_exceeded`** bei:

   * „Status prüfen“
   * „Zeige neueste Mail“
   * „Erstelle Termin …“
6. **Recursion**: Max. 4 ReAct-Runden pro Auftrag.
7. **History bleibt**: Folgefragen (innerhalb gleicher `threadId`) funktionieren kontextsensitiv.

---

## Tests (manuell)

1. **Status**

   * Prompt: „Status prüfen“ → Antwort enthält `connectedAs` & `Cloud`.
   * Prüfe Logs: `tools: ['m365_run_command']`, `approxTokens` < 10k.

2. **Neueste Mail**

   * Prompt: „Zeig mir meine neueste Mail“
   * Logs: Command zeigt **Zeitfenster**; `cb_tool_end.bytes` moderat (< 250 KB), **Proxy-Return** `slimBytes` < 4000.
   * Kein `context_length_exceeded`.

3. **Termin anlegen**

   * Prompt: „Erstelle Termin heute 16–17 Uhr mit [a@b.com](mailto:a@b.com)“
   * Antwort: kompakt mit ID/Betreff/Zeiten; keine Doku-Calls.

4. **History**

   * Gleiche `threadId`: Folgeprompt referenziert vorherige Antwort.
   * System-Message erscheint nicht erneut bei `llm_start`.

---

## Konfiguration

* `MCP_M365_TOOLS=m365_run_command` (Default)
* Optional: `AGENT_RECURSION_LIMIT=4`
* Optional: `AGENT_LOG_STEPS=1`, `AGENT_LOG_OUTPUT=1`

---

## Backout-Plan

* Proxy-Tool auskommentieren, MCP-Original wieder direkt exposen.
* `recursionLimit` wieder erhöhen.
* Zeitfenster-Rewrite deaktivieren (nur für Debug; **nicht** empfohlen im Betrieb).

---

---

```
```
