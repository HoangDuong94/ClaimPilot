# AGENT\_SPEC.md — LangGraph + MCP (M365 CLI) für CAP Chat

> **Ziel**
> In der bestehenden CAP‑App einen **LangGraph‑Agent** einführen, der **MCP‑Tools** nutzt (erster MCP: **CLI for Microsoft 365**), **ohne** das bestehende UI anzupassen. Der Agent streamt Antworten/Ereignisse weiterhin als **SSE** an das Frontend.

---

## 0) Kontext & Ist‑Stand

* **Frontend**: UI5‑Chat‑Sidepanel rendert SSE‑Streams (Pfad: `POST /ai/stream`).
* **Backend**:

  * `srv/server.js`: aktueller SSE‑Endpoint, streamt GPT‑4.1 (`AzureOpenAiChatClient` via BTP Destination).
  * `srv/service.js`: OData‑Action `callLLM` als Fallback.
* **LLM‑Zugriff**: SAP GenAI Hub Destination (`AI_DESTINATION_NAME`, `AI_MODEL_NAME`).
* **MCP (vorgebaut)**: **Schritt 4a ist erledigt** – d. h. **MCP‑Client/Verbindung** zum **CLI for Microsoft 365 MCP Server** per stdio ist eingerichtet und funktionsfähig (Tool‑Liste abrufbar).

> **Wichtiger Grundsatz:** Das bestehende UI **bleibt unberührt**. Sämtliche Integration erfolgt serverseitig, **SSE‑Framing** kompatibel zum jetzigen Client.

---

## 1) In‑Scope / Out‑of‑Scope

**In‑Scope**

* Einführen eines **Agent‑Layers** auf Basis **LangGraph**.
* **MCP‑Tools** (zunächst **M365 CLI**) für den Agent verfügbar machen.
* Neuer Streaming‑Pfad **`POST /ai/agent/stream`** (Agent‑Variante).
* **Guardrails/Policies** für M365‑Befehle (zunächst restriktiv).
* **Memory/Checkpointer** (session‑bezogen, in‑memory als Startpunkt).
* Logging & Telemetrie für Tool‑Calls.

**Out‑of‑Scope**

* UI‑Änderungen (außer optionalen micro‑Status‑Texten).
* Multi‑Tenant‑Isolierung (kann später ergänzt werden).
* Persistentes Conversation‑Memory (DB) – optionaler Folgeausbau.

---

## 2) Architekturbild (vereinfacht)

```mermaid
flowchart LR
    UI[UI5 Chat] -- SSE --> SSEEndpoint[/ai/agent/stream/]
    subgraph CAP Server (Node)
      SSEEndpoint --> AgentRunner[LangGraph Agent]
      AgentRunner --> LLM[AzureOpenAiChatClient (GPT-4.1)]
      AgentRunner --> MCPAdapter[MCP Adapter (stdio)]
      MCPAdapter --> M365MCP[CLI for Microsoft 365 MCP Server]
    end
```

**Beibehaltung:** Der bestehende Pfad **`/ai/stream`** (plain LLM) bleibt erhalten.
**Neu:** **`/ai/agent/stream`** bedient denselben Client, aber orchestriert Tools über den Agent.

---

## 3) Anforderungen (funktional)

1. **Neuer Endpoint** `POST /ai/agent/stream`

   * **Request (JSON)**:

     ```json
     { "prompt": "string", "threadId": "optional string", "mode": "optional string" }
     ```

     * `threadId`: zur Wiederaufnahme einer Unterhaltung (Memory).
     * `mode`: optional (`"readOnly" | "default" | "safeWrite"`), steuert Policies.
   * **Response**: `text/event-stream`

     * Tokens als `data: <text>`
     * Tool‑Ereignisse als **JSON** in `data:` (siehe **SSE Schema** unten).
     * Ende mit

       ```
       event: end
       data: [DONE]
       ```
2. **Agent‑Planung**

   * **ReAct‑Agent** aus LangGraph **prebuilt** einsetzen.
   * Tools via **MCP‑Adapter** einhängen (zunächst **M365**).
   * **Memory** (in‑memory Checkpointer) über `threadId`.
3. **Tool‑Policies** (initial strikt)

   * **Allow‑List**: nur **lesende** Kommandos (z. B. `* list/get/show`), **keine** `add|remove|delete|set`.
   * Option **`mode: "safeWrite"`** erlaubt schreibende Kommandos **nur**, wenn explizit whitelisted und im Prompt eindeutig beauftragt.
4. **Fallback**

   * Falls MCP/Agent fehlschlägt: sauberer Fallback auf **plain LLM** (aktuelles `streamGenAI`), ohne Prozessabbruch.
5. **Logging**

   * Je Tool‑Call: Zeitpunkt, Toolname, Eingabe‑Kurzform (max 200 Zeichen), Exit‑Status, Output‑Hash (z. B. sha256 über ersten 4 KB), Dauer (ms), `threadId`.

---

## 4) Anforderungen (nicht‑funktional)

* **Streaming‑Kompatibilität**: Der Client darf **ohne Anpassung** weiter streamen (UI hat bereits JSON‑Handling für `data:` mit `{ delta|content|text }`).
* **Stabilität**: **Singleton**‑MCP‑Verbindung mit Auto‑Restart/Health‑Check.
* **Sicherheit**: Least‑Privilege für M365‑Identität; Policies erzwingen Read‑Only default.
* **Konfigurierbarkeit**: Alle Schalter via **ENV** steuerbar.
* **Beobachtbarkeit**: Logs auf INFO/DEBUG‑Level, Fehlerpfad liefert klare Fehlermeldungen in SSE.

---

## 5) Schnittstellen

### 5.1 Neues API – `POST /ai/agent/stream`

* **Headers**:

  * `Content-Type: application/json`
* **Body**:

  ```json
  {
    "prompt": "Erstelle mir eine Übersicht aller Teams mit ...",
    "threadId": "c123-456",
    "mode": "readOnly"
  }
  ```
* **Antwort (SSE)**:

  * **Token‑Chunks**:

    ```
    data: Teiltext...

    ```
  * **Tool‑Start**:

    ```json
    data: { "text": "🔧 running: m365 ...", "event": "tool_start", "tool": "m365RunCommand" }

    ```
  * **Tool‑Ende**:

    ```json
    data: { "text": "✅ done", "event": "tool_end", "tool": "m365RunCommand" }

    ```
  * **Fehler (inline)**:

    ```json
    data: { "text": "⚠️ m365 failed: <kurz>", "event": "tool_error", "tool": "m365RunCommand" }

    ```
  * **Abschluss**:

    ```
    event: end
    data: [DONE]

    ```

> **Hinweis**: Das Frontend interpretiert JSON‑`data:` und extrahiert `delta|content|text`. Verwende deshalb **`"text"`** in Tool‑Events.

---

## 6) Komponenten & Dateien

> **Keine Implementierung hier – nur Struktur und Signaturen.**

```
srv/
  agent/
    graph.js            # Graph-Fabrik (LLM binden, Tools registrieren, Policies, Memory)
    mcpClient.js        # Verbindungs-Management zum MCP (stdio), Health/Restart
    policies.js         # Allow-/Deny-Listen, Mode->Policy Mapping
    sseBridge.js        # Agent-Events → SSE (Token/Tool-Events mappen)
    index.js            # Public API: runAgentStreaming({ prompt, threadId, mode, res })
server.js               # /ai/agent/stream Endpoint registrieren (bootstrap)
```

### 6.1 `agent/mcpClient.js` (Signaturen)

```ts
/** Startet/verbindet MCP-Server-Prozess (stdio) und liefert Adapter/Tools. */
async function connectM365Mcp(): Promise<{
  tools: Array<LangChainTool>;
  disconnect: () => Promise<void>;
  isHealthy: () => boolean;
}>;
```

**Anforderungen**

* **Singleton** Verbindung (nur eine pro Prozess).
* **Health‑Check** (z. B. Intervall: `m365GetCommands` pingbar).
* **Auto‑Reconnect** bei Exit.

### 6.2 `agent/policies.js`

```ts
type Mode = "readOnly" | "default" | "safeWrite";

/** Prüft, ob ein M365-Command + Optionen erlaubt sind. */
function isAllowed(command: string, args: string[], mode: Mode): boolean;

/** Sanitizer/Redactor für sensible Outputs (z. B. Token, GUIDs) */
function redact(output: string): string;
```

**Default‑Regeln**

* `readOnly`: **nur** `get|list|show|status|export`‑Kommandos.
* `default`: wie `readOnly`, plus wenige explizit erlaubte schreibende Tasks (Allow‑Liste).
* `safeWrite`: wie `default`, aber benötigt zusätzlich **LLM‑Bestätigung** (z. B. explizite Formulierung im Plan).

### 6.3 `agent/graph.js`

```ts
/** Erstellt/konfiguriert den ReAct-Agent mit LLM und Tools. */
async function createAgent(deps: {
  llm: ChatModel;            // AzureOpenAiChatClient Instanz
  tools: LangChainTool[];
  policies: PolicyFns;
  memory?: Checkpointer;     // in-memory für Start
}): Promise<AgentRunner>;
```

**Anforderungen**

* `llm.bindTools(tools)` verwenden.
* Memory via `threadId` (bereitgestellt beim Run).
* Vor jedem Tool‑Call `isAllowed` prüfen, sonst **ablehnen** und dem LLM ein kurzes “policy\_blocked” Result zurückgeben.

### 6.4 `agent/sseBridge.js`

```ts
/** Führt den Agent aus und streamt Tokens/Events ins SSE-Response. */
async function runAgentStreaming({
  prompt, threadId, mode, res
}: {
  prompt: string;
  threadId?: string;
  mode?: Mode;
  res: ServerResponse; // Express/Node response im SSE-Modus
}): Promise<void>;
```

**Mapping‑Regeln**

* **Token** → `data: <text>\n\n` (nur nicht‑leere Stücke).
* **Tool‑Start** → `data: {"text":"🔧 running: ...","event":"tool_start","tool": "<name>"}\n\n`
* **Tool‑Ende** → `data: {"text":"✅ done","event":"tool_end","tool":"<name>"}\n\n`
* **Tool‑Fehler** → `data: {"text":"⚠️ ...","event":"tool_error","tool":"<name>"}\n\n`
* Abschluss wie gehabt: `event: end` + `data: [DONE]`.

---

## 7) Konfiguration (ENV)

| Variable                      | Default              | Beschreibung                                                           |      |      |         |
| ----------------------------- | -------------------- | ---------------------------------------------------------------------- | ---- | ---- | ------- |
| `AI_DESTINATION_NAME`         | `aicore-destination` | SAP GenAI Hub Destination                                              |      |      |         |
| `AI_MODEL_NAME`               | `gpt-4.1`            | Modellname                                                             |      |      |         |
| `AGENT_ENABLE`                | `1`                  | Feature‑Flag zum Aktivieren                                            |      |      |         |
| `AGENT_DEFAULT_MODE`          | `readOnly`           | Fallback‑Mode, wenn keiner übergeben                                   |      |      |         |
| `MCP_M365_HEALTH_INTERVAL_MS` | `30000`              | Health‑Ping Intervall                                                  |      |      |         |
| `MCP_M365_START_CMD`          | –                    | Optional: eigener Start‑Befehl/Pfad (falls Prozess durch uns gemanagt) |      |      |         |
| `MCP_M365_STRICT_READONLY`    | `1`                  | Harter Read‑Only Zwang (übersteuert `mode`)                            |      |      |         |
| `AGENT_LOG_LEVEL`             | `info`               | \`debug                                                                | info | warn | error\` |

> **Auth‑Voraussetzung:** M365‑CLI **muss** im Server‑Kontext eingeloggt sein; MCP‑Server nutzt diese Session.

---

## 8) Betriebsverhalten

* **Bootstrap** (`cds.on('bootstrap')`):

  * MCP‑Verbindung aufbauen (falls `AGENT_ENABLE=1`).
  * Tools inventarisieren und loggen (Anzahl, Namen).
  * **Endpoint** `POST /ai/agent/stream` registrieren.
* **Shutdown**:

  * MCP‑Verbindung sauber schließen (`disconnect()`).
* **Recovery**:

  * Bei MCP‑Exit/Fehler: **Auto‑Reconnect** (Backoff).
  * Bei Agent‑Fehler: **Fallback** auf plain LLM‑Streaming.

---

## 9) Sicherheitsmaßnahmen

* **Deny‑Patterns**: `* remove|delete|set|add|grant|revoke|update|create|disable|enable`, solange **nicht** explizit freigeschaltet.
* **Output‑Redaction**: Maskiere Token/Secrets/IDs, wenn Muster erkannt.
* **Audit‑Log**: Tool‑Call‑Metadaten (siehe oben) in Server‑Log.
* **Rate‑Limit** (Optional): pro `threadId` und Zeitfenster.

---

## 10) Qualität & Tests

### 10.1 Akzeptanzkriterien

* **A1**: `POST /ai/agent/stream` streamt Tokens **ohne** UI‑Anpassung.
* **A2**: Bei einer lesenden M365‑Frage nutzt der Agent **mind. 1 Tool‑Call** und liefert ein natürliches Ergebnis.
* **A3**: Schreibende M365‑Anfrage wird **blockiert** (readOnly), mit verständlicher Antwort.
* **A4**: **Fallback** greift, wenn MCP nicht verfügbar ist (Antwort trotzdem gestreamt).
* **A5**: Logs enthalten Tool‑Call‑Metadaten.

### 10.2 Manuelle Tests (SSE‑Debug‑Script vorhanden)

1. **Lesen (erwartet Tool‑Start/Ende)**

   ```
   node scripts/sse-debug.js "Zeig mir alle Teams ..."
   ```

   * Erwartet: JSON‑Events `tool_start` / `tool_end` + finaler Text.
2. **Schreiben (erwartet Block)**

   ```
   node scripts/sse-debug.js "Lösche Team XYZ"
   ```

   * Erwartet: Erklärende Antwort, dass Aktion blockiert ist.
3. **MCP down (erwartet Fallback)**

   * MCP stoppen → Anfrage senden → trotzdem Antwort (plain LLM).
4. **Memory**

   * Zwei aufeinanderfolgende Prompts mit gleicher `threadId` → zweiter Prompt nutzt Kontext.

---

## 11) Edge‑Cases

* **Leerer Prompt** → sofort Fehler‑Text streamen und schließen.
* **Tool‑Timeout** → `tool_error` Event + Agent fährt mit Teilkenntnissen fort.
* **Große Outputs** → **Chunked** streamen; Logs nur Hash/Trunkation.
* **Abbruch (Client)** → `AbortController` greift; Tool‑Runs nicht erneut starten.

---

## 12) Deliverables (für diesen Inkrement)

1. **Neue Module** unter `srv/agent/*` (Struktur/Signaturen wie oben).
2. **Erweiterung `srv/server.js`**: Registrierung von `POST /ai/agent/stream`.
3. **Konfig‑Schalter** (ENV) dokumentiert.
4. **Logging** für Tool‑Calls implementiert.
5. **README‑Snippet** (kurz) in Projekt‑README zur Nutzung des neuen Endpoints.

---

## 13) Implementierungs‑Checkliste

* [ ] MCP‑Singleton‑Client betriebsbereit (Health, Reconnect).
* [ ] M365‑Tools via Adapter geladen (Liste im Log).
* [ ] Policies: Read‑Only Default, `mode`‑Mapping umgesetzt.
* [ ] ReAct‑Agent (LangGraph) mit `llm.bindTools(tools)` verdrahtet.
* [ ] `runAgentStreaming()` mappt **Tokens** & **Tool‑Events** → SSE.
* [ ] Endpoint `/ai/agent/stream` liefert identisches End‑Framing wie heute.
* [ ] Fallback‑Pfad (MCP down) → plain LLM streaming.
* [ ] Logs & Redaction aktiv.
* [ ] Manuelle Tests (A1–A5) grün.

---

## 14) Hinweise zur Paketlandschaft

* Stelle sicher, dass **alle LangChain‑Pakete** (langgraph/langchain/core) **kompatibel** sind (ggf. `overrides` in `package.json`).
* `@sap-ai-sdk/langchain` als LLM‑Client weiterverwenden (bietet `stream`/`invoke` und Tool‑Binding).

---

## 15) Zukunft (optional)

* Persistentes Memory (DB‑gestützter Checkpointer).
* Weitere MCP‑Server (z. B. GitHub, Jira) – einfach im Adapter hinzufügen.
* Benutzer‑gesteuerte **“Confirm to execute”**‑Prompts für schreibende Aktionen (UI‑Dialog).

---

**Ende der Spezifikation.**
Diese Datei ist die Arbeitsgrundlage für die Implementierung des **Codex‑Agents**. Bitte die **Signaturen**, **SSE‑Kontrakte** und **Policies** exakt einhalten, damit das Frontend unverändert funktioniert.
