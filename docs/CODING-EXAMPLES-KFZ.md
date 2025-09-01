# ClaimPilot – CODING EXAMPLES – Kfz-Schaden (POC)

Diese Datei liefert konkrete, referenzierbare Beispiele für ClaimPilot. Sie führen Schritt für Schritt durch CAP, Fiori Elements, das Chat-Sidepanel sowie die Agent-Integration mit Excel und Microsoft 365 CLI MCP (m365GetCommands, m365GetCommandDocs, m365RunCommand).

Wichtig: Die UI und der `callLLM`-Flow funktionieren in diesem Projekt bereits. Die Beispiele zeigen, wie du minimal ergänzen/konfigurieren kannst, ohne das Grundgerüst zu ändern.


## 1) Ungebundene Action in CAP verwenden (bereits vorhanden)

- Datei: `srv/service.cds`

```cds
using { sap.kfz as KfzModel } from '../db/schema';
using from '../app/annotations';

service KfzService @(path: '/service/kfz') {
  // ... Entities ...
  action callLLM (prompt: String) returns { response: String };
}
```

- Datei: `srv/service.js` – Handler der Action (stark gekürzt auf die Essenz):

```js
export default class KfzService extends cds.ApplicationService {
  async init() {
    await super.init();

    // Agent initialisieren (siehe unten – Tools laden)
    const initializeAgent = async () => { /* ... */ };
    await initializeAgent();

    this.on('callLLM', async (req) => {
      const { prompt: userPrompt } = req.data;
      const executor = await initializeAgent();

      const systemMessage = { role: 'system', content: `... dein Systemprompt ...` };
      const userMessage = { role: 'user', content: userPrompt };

      const stream = await executor.stream({ messages: [systemMessage, userMessage] }, { configurable: { thread_id: `session_test}` } });
      const finalResponseParts = [];
      for await (const chunk of stream) {
        // streaming & tool logging (siehe Repo)
      }
      const rawResponse = finalResponseParts.join("");
      const htmlResponse = MarkdownConverter.convertForStammtischAI(rawResponse);
      return { response: htmlResponse };
    });
  }
}
```

Verständnis: Der Agent produziert Text (Markdown), der über `MarkdownConverter` in HTML für das UI5-`FormattedText` gewandelt wird.


## 2) Frontend: Fiori Elements + Chat-Sidepanel (bereits vorhanden)

- Datei: `app/claims/webapp/main.js` – OData-Action-Aufruf und Rendering der AI-Antwort:

```js
async callLLMViaOperationBinding(prompt) {
  const oDataModel = this.feAppComponentInstance.getModel();
  const oOperationBinding = oDataModel.bindContext("/callLLM(...)");
  oOperationBinding.setParameter("prompt", prompt);
  await oOperationBinding.execute();
  const result = oOperationBinding.getBoundContext().getObject();
  return result.response; // HTML vom Backend
}

// Senden aus dem Chat-Panel
async function onSend() {
  chatManager.addMessage("user", userInput);
  chatManager.addMessage("assistant", "Thinking...");
  const html = await chatManager.callLLMViaOperationBinding(userInput);
  chatManager.handleAIResponseEnhanced(html);
}
```

- Datei: `app/claims/webapp/ext/ChatSidePanelContent.fragment.xml` – UI-Fragment mit `<FormattedText htmlText="{chat>text}"/>`.

Damit ist die End-to-End-Kette UI → OData → Agent → HTML → UI bereits gegeben.


## 3) Excel MCP in Aktion (aus Backend-Sicht)

In `srv/service.js` werden Excel-Tools bereits geladen (siehe `loadMcpTools` Aufrufe). So nutzt der Agent sie (über Prompting), typischer Schritt:

```text
1) excel_describe_sheets(fileAbsolutePath: 'C:/path/tmp/claim.xlsx')
2) excel_read_sheet(fileAbsolutePath: 'C:/path/tmp/claim.xlsx', sheetName: 'Schadenmeldung', knownPagingRanges: ...)
3) Mapping in Standard-JSON: { policyNumber, claimNumber?, plate, lossDate, description, claimantName, claimantEmail }
```

Tipp: Erzwinge im Systemprompt (siehe Abschnitt 6) genau diese Reihenfolge, um Halluzinationen zu vermeiden.


## 4) Microsoft 365 CLI MCP integrieren (POC)

Schritt 4.1 – MCP-Client anlegen (analog Excel/Filesystem) in `srv/lib/mcp-client.js`:

```js
// PSEUDO-CODE – Package/Befehl ggf. anpassen
let m365Client = null;
export async function initM365MCPClient() {
  if (m365Client) return m365Client;
  console.log(`Initializing M365 CLI MCP client...`);
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "<m365-mcp-server-command-or-package>"] // TODO: konkreten Server angeben
  });
  m365Client = new Client({ name: "m365-client", version: "1.0.0" }, {});
  await m365Client.connect(transport);
  console.log("✔ M365 MCP Client initialized successfully.");
  return m365Client;
}

// in initAllMCPClients():
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

Schritt 4.2 – Tools im Service laden (`srv/service.js`):

```js
// bereits vorhandene Tool-Ladungen
const [postgresTools, braveSearchTools, playwrightTools, filesystemTools, excelTools, m365Tools] = await Promise.all([
  loadMcpTools("query", mcpClients.postgres),
  loadMcpTools("brave_web_search,brave_local_search", mcpClients.braveSearch),
  loadMcpTools("take_screenshot,goto_page,click_element,fill_input,execute_javascript,get_page_content,wait_for_element,generate_test_code", mcpClients.playwright),
  loadMcpTools("read_file,write_file,edit_file,create_directory,list_directory,move_file,search_files,get_file_info,list_allowed_directories", mcpClients.filesystem),
  loadMcpTools("excel_describe_sheets,excel_read_sheet,excel_screen_capture,excel_write_to_sheet,excel_create_table,excel_copy_sheet", mcpClients.excel),
  // NEU: Microsoft 365 CLI MCP – nur 3 Tools im POC
  loadMcpTools("m365GetCommands,m365GetCommandDocs,m365RunCommand", mcpClients.m365)
]);

const allTools = [
  ...postgresTools,
  ...braveSearchTools,
  ...playwrightTools,
  ...filesystemTools,
  ...excelTools,
  ...m365Tools // hinzufügen
];
```

Schritt 4.3 – Systemprompt präzise erweitern (beispielhaft):

```js
const systemMessage = { role: "system", content: `
DU BIST EIN DETERMINISTISCHER KFZ-SCHADEN-AGENT.

MICROSOFT 365 CLI (IMMER IN DIESER REIHENFOLGE):
1) m365GetCommands: Suche das passende Kommando (z. B. outlook message list/get, attachment list/get, message move).
2) m365GetCommandDocs: Prüfe Parameter/Beispiele und bestätige die Syntax.
3) m365RunCommand: Führe das Kommando mit den verifizierten Parametern aus.

EXCEL (IMMER): excel_describe_sheets → excel_read_sheet → JSON-Mapping.
ANTWORT: Kompakte HTML-Zusammenfassung (Abschnitte: Aktionen, Extrahierte Daten, Nächste Schritte, Referenzen).
KONTEXT: inboxFolder={{inboxFolder}}, processedFolder={{processedFolder}}, tempDir={{tempDir}}
` };
```


## 5) Beispiel: End-to-End Prompt für den Agenten

User Prompt (aus dem Chat):

```text
Lies die neueste Schadenmail aus dem Ordner Eingang, lade den Excel-Anhang, lies das Blatt „Schadenmeldung“ und gib mir policyNumber, Kennzeichen und Schadendatum aus. Danach verschiebe die Mail in „Verarbeitet“ und fasse alles kompakt als HTML zusammen.
```

Erwartete Tool-Sequenz (vom Agenten):

```text
1) m365GetCommands  → mögliche „outlook message list“ Kommandos
2) m365GetCommandDocs → Syntax (Ordnerfilter, --top, --output json) prüfen
3) m365RunCommand    → Mails auflisten (Eingang)
4) m365GetCommands   → „message get“
5) m365GetCommandDocs
6) m365RunCommand    → Details der ausgewählten Mail
7) m365GetCommands   → „message attachment list“ + „attachment get“
8) m365GetCommandDocs
9) m365RunCommand    → Attachment herunterladen nach {{tempDir}}/claim.xlsx
10) excel_describe_sheets → Blattnamen bestätigen
11) excel_read_sheet      → Daten lesen
12) (Mapping → JSON)
13) m365GetCommands   → „message move“
14) m365GetCommandDocs
15) m365RunCommand    → Mail nach {{processedFolder}} verschieben
16) HTML ausgeben
```

Beispiel-HTML (kompakt):

## 6) FE V4 – CUD + Draft + Facets (Code-Snippets)

- service.cds (Draft + Projektion auf Basisentität):

```cds
using { sap.kfz as kfz } from '../db/schema';

service KfzService @(path:'/service/kfz') {
  @odata.draft.enabled
  entity Claim as projection on kfz.Claim;
  entity Email     as projection on kfz.Email;
  entity Document  as projection on kfz.Document;
  entity Task      as projection on kfz.Task;
}
```

- fe-annotations.cds (Spalten, Facets, CUD, ValueHelp):

```cds
using KfzService as service from './service';

annotate service.Claim with @(
  UI.HeaderInfo : {
    TypeName       : 'Schaden',
    TypeNamePlural : 'Schaeden',
    Title          : { Value : claimNumber },
    Description    : { Value : status }
  },
  UI.SelectionFields : [ claimNumber, status, severity, lossDate ],
  UI.LineItem : [
    { $Type: 'UI.DataField', Value: claimNumber,           Label: 'Claim'        },
    { $Type: 'UI.DataField', Value: policy.policyNumber,   Label: 'Police'       },
    { $Type: 'UI.DataField', Value: vehicle.plate,         Label: 'Kennzeichen'  },
    { $Type: 'UI.DataField', Value: lossDate,              Label: 'Schadendatum' },
    { $Type: 'UI.DataField', Value: status,                Label: 'Status'       }
  ],
  UI.Facets : [
    { $Type: 'UI.ReferenceFacet', Label: 'Allgemeine Informationen', Target: '@UI.FieldGroup#General' },
    { $Type: 'UI.ReferenceFacet', Label: 'Beschreibung',             Target: '@UI.FieldGroup#Description' },
    { $Type: 'UI.ReferenceFacet', Label: 'E-Mails',                  Target: 'emails/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', Label: 'Dokumente',                Target: 'documents/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', Label: 'Aufgaben',                 Target: 'tasks/@UI.LineItem' }
  ],
  UI.FieldGroup #General : {
    Data: [
      { Value: claimNumber,           Label: 'Claim' },
      { Value: status,                Label: 'Status' },
      { Value: severity,              Label: 'Schadenschwere' },
      { Value: lossDate,              Label: 'Schadendatum' },
      { Value: reportedDate,          Label: 'Meldedatum' },
      { Value: policy.policyNumber,   Label: 'Police' },
      { Value: vehicle.plate,         Label: 'Kennzeichen' },
      { Value: reserveAmount,         Label: 'Reserve' }
    ]
  },
  UI.FieldGroup #Description : { Data: [ { Value: description, Label: 'Beschreibung' } ] }
);

annotate service.Claim with {
  description   @title: 'Beschreibung' @UI.MultiLineText;
  claimNumber   @title: 'Claim';
  status        @title: 'Status';
  severity      @title: 'Schadenschwere';
  lossDate      @title: 'Schadendatum';
  reportedDate  @title: 'Meldedatum';
  reserveAmount @title: 'Reserve';
};

// CUD
annotate service.Claim with @(
  Capabilities.InsertRestrictions: { Insertable: true },
  Capabilities.UpdateRestrictions: { Updatable:  true },
  Capabilities.DeleteRestrictions: { Deletable:  true }
);

// Value Help
annotate service.Claim with {
  policy @Common.ValueList: {
    $Type: 'Common.ValueListType', CollectionPath: 'Policy', Parameters: [
      { $Type: 'Common.ValueListParameterInOut',  LocalDataProperty: policy_ID,  ValueListProperty: 'ID' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'policyNumber' }
    ]
  };
  vehicle @Common.ValueList: {
    $Type: 'Common.ValueListType', CollectionPath: 'Vehicle', Parameters: [
      { $Type: 'Common.ValueListParameterInOut',  LocalDataProperty: vehicle_ID, ValueListProperty: 'ID' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'plate' }
    ]
  };
};
```

- manifest.json (List Report Tabelle):

```json
{
  "sap.ui5": {
    "routing": {
      "targets": {
        "ClaimList": {
          "options": { "settings": {
            "controlConfiguration": {
              "@com.sap.vocabularies.UI.v1.LineItem": {
                "tableSettings": {
                  "type": "ResponsiveTable",
                  "creationMode": { "name": "NewPage" },
                  "initialVisibleFields": "claimNumber,policy.policyNumber,vehicle.plate,lossDate,status,severity,reportedDate"
                }
              }
            }
          } }
        }
      }
    }
  }
}
```

Tipps
- Nach Modelländerungen: `npx cds deploy --to sqlite:sqlite.db` (Views/Draft aktualisieren).
- Wenn Spalten/Aktionen fehlen: Tabellen‑/Seitenvariante zurücksetzen (Personalisierung kann Defaults übersteuern).

```html
<h2 class="ai-header-2">Aktionen</h2>
<ul class="ai-unordered-list">
  <li class="ai-list-item">Outlook: 1 Mail gelesen, 1 Anhang geladen</li>
  <li class="ai-list-item">Excel: Sheet „Schadenmeldung“ analysiert</li>
  <li class="ai-list-item">Outlook: Mail nach „Verarbeitet“ verschoben</li>
  </ul>
<h2 class="ai-header-2">Extrahierte Daten</h2>
<ul class="ai-unordered-list">
  <li class="ai-list-item">policyNumber: 4711-ABC</li>
  <li class="ai-list-item">plate: M‑AB 1234</li>
  <li class="ai-list-item">lossDate: 2025-08-30</li>
</ul>
<h2 class="ai-header-2">Nächste Schritte</h2>
<ul class="ai-unordered-list">
  <li class="ai-list-item">Triage ausführen (Schweregrad/Reserve)</li>
</ul>
<h2 class="ai-header-2">Referenzen</h2>
<ul class="ai-unordered-list">
  <li class="ai-list-item">messageId: ...</li>
  <li class="ai-list-item">attachment: claim.xlsx (Sheet: Schadenmeldung)</li>
</ul>
```


## 6) Markdown → HTML Konventionen (für das UI5 Panel)

- Datei: `srv/utils/markdown-converter.js` erweitert Markdown zu HTML und fügt CSS‑Klassen hinzu:
  - Codeblöcke: `.ai-code-block` + `.ai-copy-button`
  - Listen: `.ai-unordered-list`/`.ai-list-item`
  - Links: `.ai-link` (werden im Frontend mit Confirm-Dialog behandelt)

Beachte: Wenn der Agent Markdown schreibt, wird es automatisch in diese HTML‑Form gebracht. Du kannst auch direkt HTML liefern.


## 7) Optionale DB-Beispiele (nur POC, frei anpassbar)

Wenn du Daten persistieren willst (Claim/Email/Document), verwende `query` (Postgres MCP) parametrisiert. Beispiel-SQL (im Agenten-Prompt, nicht im Code hart hinterlegen):

```sql
-- Prüfen, ob E-Mail bereits verarbeitet (idempotent)
SELECT 1 FROM email WHERE message_id = $1;
-- Claim anlegen
INSERT INTO claim(policy_number, plate, loss_date) VALUES ($1, $2, $3)
ON CONFLICT (policy_number, loss_date) DO UPDATE SET plate = EXCLUDED.plate
RETURNING id;
-- Document/Email-Referenzen
INSERT INTO document(file_name, claim_id) VALUES ($1, $2);
INSERT INTO email(message_id, claim_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;
```

Hinweis: Dieses Repo hat aktuell das Stammtisch‑Datenmodell. Für POC kann die Persistenz entfallen; die HTML‑Antwort reicht, um den Nutzen zu zeigen.


## 8) Troubleshooting & Tipps

- Tools werden in `srv/service.js` geloggt („Available tools:“). Prüfe, ob `m365GetCommands,m365GetCommandDocs,m365RunCommand` auftauchen.
- Wenn `m365RunCommand` fehlschlägt: zuerst mit `m365GetCommandDocs` die Parameter validieren und ggf. Alternativkommando über `m365GetCommands` suchen.
- Excel: Wenn das Blatt unklar ist, gib die Liste der Sheetnamen aus und frage nach Auswahl.
- UI: Wenn das Chatpanel kein HTML rendert, prüfe, ob `result.response` im Frontend ankommt und `FormattedText` verwendet wird.


## 9) Mini-Checkliste für den Coding-Agenten

- [ ] `initM365MCPClient()` in `srv/lib/mcp-client.js` ergänzen und in `initAllMCPClients()` aufnehmen
- [ ] In `srv/service.js` die M365‑Tools laden und `allTools` erweitern
- [ ] Systemprompt mit strenger Reihenfolge (GetCommands → GetCommandDocs → RunCommand) ergänzen
- [ ] Manuell mit einem Prompt testen (siehe Abschnitt 5) – Konsole beobachten
- [ ] Ergebnis im Chatpanel prüfen (HTML‑Abschnitte)

Fertig. Diese Beispiele referenzieren die echten Stellen im Repo und können 1:1 als Vorlage genutzt werden.
