# ClaimPilot – TECH IMPLEMENTATION – Kfz-Schaden (POC)

Diese Anleitung führt Schritt für Schritt durch den Aufbau einer Kfz‑Schadenmeldungs‑Variante auf Basis dieser Codebasis. Sie deckt CAP‑Setup, Fiori Elements, Chat‑Sidepanel, OData‑Action, Agent‑Integration (Excel + Microsoft 365 CLI MCP) und die GenAI‑Anbindung (package.json/Destination) ab.

Ziel: Ein funktionsfähiger POC, der E‑Mails (Microsoft 365 CLI) findet, Excel‑Anhänge liest (Excel MCP) und die extrahierten Daten kompakt als HTML im Chat‑Panel ausgibt. Persistenz ist optional.


## 0) Überblick der bestehenden Bausteine (aus diesem Repo)
- OData‑Service: `srv/service.cds` mit Action `callLLM(prompt)` → Pfad `/service/stammtisch`.
- Service‑Handler: `srv/service.js` initialisiert einen Agenten (LangGraph) mit MCP‑Tools (Postgres, Brave, Playwright, Filesystem, Excel) und beantwortet `callLLM` mit HTML.
- Markdown → HTML: `srv/utils/markdown-converter.js` (optimiert für UI5 `FormattedText`).
- UI5 App: `app/webapp/manifest.json`, `app/webapp/main.js`, Chat‑Fragment `app/webapp/ext/ChatSidePanelContent.fragment.xml`.

Diese Strukturen bleiben erhalten. Für Kfz fügen wir M365‑MCP hinzu und passen den System‑Prompt (Agent) an.


## 1) Entwicklungsumgebung
- Node.js LTS, npm
- PostgreSQL (nur falls Persistenz gewünscht; das Projekt ist bereits auf Postgres konfiguriert)
- Netzwerkzugriff für MCP‑Server via `npx`

Installieren/Starten:
- `npm install`
- `npm start` (oder `cds watch`)
- Frontend: `http://localhost:9999/app/webapp/index.html`
- Service: `http://localhost:9999/service/stammtisch/`


## 2) Fiori Elements: Setup und Chat‑Integration (bestehendes Muster)
- Manifest: `app/webapp/manifest.json` – OData‑Quelle "/service/stammtisch/", Routen/Targets, Actions.
- Component: `app/webapp/Component.js` – hält Referenzen auf Chat‑Model/SideContent; Methode `invokeAIActionOnCurrentPage`.
- Bootstrap/Chat: `app/webapp/main.js`
  - Erstellt `DynamicSideContent` und lädt `ext/ChatSidePanelContent.fragment.xml`.
  - OData‑Action‑Call: `callLLMViaOperationBinding(prompt)` nutzt `bindContext("/callLLM(...)")` und liefert `result.response` (HTML) zurück.
  - Anzeige: `handleAIResponseEnhanced(html)` schreibt die HTML‑Antwort ins Chat‑Model.

Dieses Pattern 1:1 für Kfz verwenden. UI‑seitig ist keine Änderung nötig, die Action bleibt gleich.


## 3) CAP‑Service: Action und Agent (Anpassung für Kfz)
- `srv/service.cds`: Action `callLLM` ist vorhanden – keine Änderung nötig.
- `srv/service.js`: Hier ergänzen wir die M365‑Tools und präzisieren den System‑Prompt.

Schritt 3.1 – M365 MCP Client in `srv/lib/mcp-client.js` hinzufügen (analog Excel):

```js
// srv/lib/mcp-client.js (Ergänzung – PSEUDO CODE, MCP Server anpassen)
let m365Client = null;
export async function initM365MCPClient() {
  if (m365Client) return m365Client;
  console.log(`Initializing M365 CLI MCP client...`);
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "<m365-mcp-server-package-or-command>"] // hier den tatsächlichen MCP Server angeben
  });
  m365Client = new Client({ name: "m365-client", version: "1.0.0" }, {});
  await m365Client.connect(transport);
  console.log("✔ M365 MCP Client initialized successfully.");
  return m365Client;
}

// in initAllMCPClients(): ergänzen
const [pgClient, braveClient, playwrightClient, fsClient, xlsxClient, m365] = await Promise.all([
  initPostgresMCPClient(),
  initBraveSearchMCPClient(),
  initPlaywrightMCPClient(),
  initFilesystemMCPClient(),
  initExcelMCPClient(),
  initM365MCPClient() // neu
]);
return { postgres: pgClient, braveSearch: braveClient, playwright: playwrightClient, filesystem: fsClient, excel: xlsxClient, m365 };
```

Schritt 3.2 – `srv/service.js`: M365‑Tools laden und zum Agenten hinzufügen:

```js
// Ergänzung in initializeAgent():
const [postgresTools, braveSearchTools, playwrightTools, filesystemTools, excelTools, m365Tools] = await Promise.all([
  loadMcpTools("query", mcpClients.postgres),
  loadMcpTools("brave_web_search,brave_local_search", mcpClients.braveSearch),
  loadMcpTools("take_screenshot,goto_page,click_element,fill_input,execute_javascript,get_page_content,wait_for_element,generate_test_code", mcpClients.playwright),
  loadMcpTools("read_file,write_file,edit_file,create_directory,list_directory,move_file,search_files,get_file_info,list_allowed_directories", mcpClients.filesystem),
  loadMcpTools("excel_describe_sheets,excel_read_sheet,excel_screen_capture,excel_write_to_sheet,excel_create_table,excel_copy_sheet", mcpClients.excel),
  // POC: Microsoft 365 CLI MCP – exakt diese drei Tools
  loadMcpTools("m365GetCommands,m365GetCommandDocs,m365RunCommand", mcpClients.m365)
]);

const allTools = [
  ...postgresTools,
  ...braveSearchTools,
  ...playwrightTools,
  ...filesystemTools,
  ...excelTools,
  ...m365Tools
];
```

Schritt 3.3 – System‑Prompt für Kfz (anti‑halluzinatorisch, feste Reihenfolge):

```js
const systemMessage = { role: "system", content: `
Du bist ein deterministischer Kfz‑Schaden‑Agent. Du hast Zugriff auf Microsoft 365 CLI (nur m365GetCommands, m365GetCommandDocs, m365RunCommand), Excel (excel_describe_sheets, excel_read_sheet) und Filesystem.

Vorgehen (IMMER):
1) Microsoft 365: m365GetCommands (Kommando suchen) → m365GetCommandDocs (Syntax verifizieren) → m365RunCommand (ausführen).
2) Excel: Zuerst excel_describe_sheets, dann excel_read_sheet, anschließend Mapping nach JSON { policyNumber, claimNumber?, plate, lossDate, description, claimantName, claimantEmail }.
3) Ergebnis IMMER als kompaktes HTML (Abschnitte: Aktionen, Extrahierte Daten, Nächste Schritte, Referenzen) für UI5 FormattedText.
KONFIG: inboxFolder={{inboxFolder}}, processedFolder={{processedFolder}}, tempDir={{tempDir}}
` };
```


## 4) Microsoft 365 CLI – Nutzungsmuster (innerhalb des Agenten)
- Mails auflisten: via `m365GetCommands` das passende „outlook message list“ Kommando finden; mit `m365GetCommandDocs` Parameter prüfen; dann `m365RunCommand` mit `--folder {{inboxFolder}} --top 5 --output json`.
- Maildetails/Anhänge: analog „message get“, „message attachment list/get“ → Excel nach `{{tempDir}}/claim.xlsx` speichern.
- Excel lesen: `excel_describe_sheets` → `excel_read_sheet` → Mapping.
- Mail verschieben: „message move“ via GetCommands/Docs finden → `m365RunCommand` nach `{{processedFolder}}`.

Beispiele für HTML‑Antwort siehe `docs/CODING-EXAMPLES-KFZ.md`.


## 5) GenAI‑Anbindung – package.json und Optionen

Dieses Repo verwendet SAP AI SDK und enthält bereits eine GenAI‑Konfiguration in `package.json` (Ausschnitt):

```json
{
  "dependencies": {
    "@sap-ai-sdk/langchain": "^1.15.0",
    "@sap-ai-sdk/orchestration": "^1.13.0",
    "@sap-cloud-sdk/connectivity": "^4.0.2",
    "@sap/cds": "^8.9.4"
  },
  "cds": {
    "requires": {
      "gen-ai-hub": {
        "claude-3.5": {
          "destinationName": "GenAIHubDestination",
          "deploymentUrl": "/v2/inference/deployments/dfddf56cb9d349b0",
          "resourceGroup": "default",
          "apiVersion": "2024-08-06",
          "modelName": "anthropic--claude-3.5-sonnet"
        }
      },
      "GenAIHubDestination": {
        "kind": "rest",
        "credentials": {
          "destination": "aicore-destination",
          "requestTimeout": "300000"
        }
      }
    }
  }
}
```

Zwei praktikable Varianten für den POC:

- Variante A – GenAI Hub (empfohlen, da bereits konfiguriert):
  - In BTP eine Destination `aicore-destination` auf AI Core/GenAI Hub anlegen.
  - Sicherstellen, dass die im Abschnitt `gen-ai-hub` referenzierte Deployment‑URL/ResourceGroup/ModelName gültig ist.
  - Optional statt `AzureOpenAiChatClient` den `OrchestrationClient` verwenden (siehe Doku), um direkt gegen das Hub‑Deployment zu sprechen.

- Variante B – Direkter Azure OpenAI:
  - Umgebungsvariablen setzen (z. B. `AZURE_OPENAI_API_KEY`, Endpoint, Deployment). `AzureOpenAiChatClient` entsprechend initialisieren (siehe `@sap-ai-sdk/langchain` Doku).

Zusatz‑Hinweise zu `package.json` (MCP):
- Stelle sicher, dass die MCP‑Server via `npx` verfügbar sind:
  - Excel: `@negokaz/excel-mcp-server` (bereits im Projekt verwendet)
  - Filesystem: `@modelcontextprotocol/server-filesystem`
  - M365 CLI MCP: Dein M365 MCP Server (als devDependency hinzufügen, z. B. `m365-mcp-server` Platzhalter)

Beispiel (optional):
```json
{
  "devDependencies": {
    "@modelcontextprotocol/server-filesystem": "^1",
    "@negokaz/excel-mcp-server": "^0.2.0",
    "m365-mcp-server": "^0.1.0"
  }
}
```


## 6) End‑to‑End Test (manuell)
1) Start: `cds watch` (oder `npm start`).
2) Öffne UI: `http://localhost:9999/app/webapp/index.html`.
3) Chat‑Panel öffnen (Button im ObjectPage Kontext verfügbar, siehe Manifest‑Action).
4) Prompt im Panel:
   - „Lies die neueste Schadenmail aus dem Ordner Eingang, lade den Excel‑Anhang, … und fasse als HTML zusammen.“
5) Konsole beobachten: `srv/service.js` loggt verfügbare Tools und Tool‑Calls (inkl. Arguments/Tool‑Outputs im Stream).
6) Ergebnis prüfen: HTML ist im Chat‑Panel sichtbar (Abschnitte, Listen, Links/Copy‑Buttons funktionieren).


## 7) Optional: Minimal‑Persistenz (nur wenn gewünscht)
- CDS‑Model für Claim/Email/Document hinzufügen (analog `db/schema.cds`).
- Postgres MCP `query` im Prompt verwenden (INSERT/UPSERT), um idempotent anzulegen (siehe Beispiele in `docs/CODING-EXAMPLES-KFZ.md`).


## 8) Zusammenfassung
- UI und Action‑Flow stehen bereits.
- Backend: Nur M365 MCP ergänzen, Tools laden, System‑Prompt für feste Reihenfolge/HTML‑Antwort schärfen.
- GenAI‑Hub ist in `package.json` konfiguriert – Ziel ist, die Connection über BTP Destination sicherzustellen oder alternativ Azure direkt zu setzen.

Damit kann ein Coding‑Agent die Kfz‑Schaden‑Variante deterministisch umsetzen und testen.
