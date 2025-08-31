# ClaimPilot – Projektübersicht und Leitfaden

ClaimPilot ist ein POC für Kfz‑Schadenmeldungen auf Basis von SAP CAP (Node.js, OData v4, PostgreSQL) und einer Fiori Elements App mit integriertem AI‑Agent (LangChain/LangGraph + MCP‑Tools). Ziel ist es, E‑Mails und Excel‑Anhänge praxisnah zu verarbeiten, Kerndaten zu extrahieren und Workflows zu erleichtern.

## Inhalte dieser Dokumentation
- Agentik & Prompting: siehe `docs/Agent.md`
- Technische Implementierung (End‑to‑End): `docs/TECH-IMPLEMENTATION-KFZ.md`
- Konkrete Coding‑Beispiele: `docs/CODING-EXAMPLES-KFZ.md`
- Mockdaten‑Plan (inkl. Excel‑Design): `docs/MOCK-DATA-PLAN-KFZ.md`
- DB‑Validierungskonzept (MCP/SQL): `docs/DB-VALIDATION-PLAN-KFZ.md`
- Prompt‑Bibliothek (getestete Prompts): `docs/PROMPT-LIBRARY.md`

## Quick Start (lokal)
1) Abhängigkeiten installieren: `npm install`
2) Starten: `npm start` (oder `cds watch`)
3) UI öffnen: `http://localhost:9999/app/webapp/index.html`
4) Service: `http://localhost:9999/service/stammtisch/`
5) Chat‑Panel nutzen: Prompt eingeben → Backend action `callLLM` liefert HTML

Hinweis: Das Repo enthält bereits die OData‑Action `callLLM` und die UI‑Anbindung (siehe `app/webapp/main.js`).

## GenAI (Azure) – empfohlene Variante
In `srv/service.js` ist ein Azure‑Client im Einsatz. Setze die Azure‑Umgebung passend zu deinem Deployment:
- `AZURE_OPENAI_API_KEY=...`
- `AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com`
- `AZURE_OPENAI_DEPLOYMENT=<deployment-name>` (z. B. gpt-4o-mini-deploy)
- `AZURE_OPENAI_API_VERSION=2024-08-01-preview`

Weitere Umgebungen (falls genutzt):
- `BRAVE_API_KEY=...` (für Websuche via MCP Brave)
- Postgres‑Creds sind in `package.json > cds.requires.db.[development]` vorkonfiguriert

## MCP‑Tools (Überblick)
- Excel: `excel_describe_sheets`, `excel_read_sheet` (Describe → Read → Mapping)
- Filesystem: Lesen/Schreiben/Listen (Temp‑Ablage für Attachments)
- (Optional) Postgres: `query` (SELECT/UPSERT; gemäß `docs/DB-VALIDATION-PLAN-KFZ.md`)
- (POC) Microsoft 365 CLI: `m365GetCommands`, `m365GetCommandDocs`, `m365RunCommand` (Tool‑Sequenz strikt einhalten)

Konkrete Sequenzen und Beispiele siehe `docs/PROMPT-LIBRARY.md` und `docs/CODING-EXAMPLES-KFZ.md`.

## Excel – Praxislayout
Das praxisnahe Sachbearbeiter‑Layout (Blätter, Pflichtfelder, Validierungen, Synonyme, Mapping) ist in `docs/MOCK-DATA-PLAN-KFZ.md` beschrieben (Abschnitt „Praxisnahes Excel‑Design“ + „Excel Header Matrix“). Der Agent nutzt immer Describe → Read → Mapping.

## Daten & Validierung
- Mockdaten: CSV‑Plan (Entities, Spalten, Beispiel‑Datensätze) in `docs/MOCK-DATA-PLAN-KFZ.md`
- Validierungen: Preflight/Transaktion/Idempotenz in `docs/DB-VALIDATION-PLAN-KFZ.md` mit Copy‑Paste SQL

## Empfohlene Arbeitsweise für Agenten
- Microsoft 365: IMMER `m365GetCommands` → `m365GetCommandDocs` → `m365RunCommand`
- Excel: IMMER `excel_describe_sheets` → `excel_read_sheet`
- Ausgabe: IMMER kompaktes HTML (Abschnitte: Aktionen, Extrahierte Daten, Nächste Schritte, Referenzen, optional Validierungen)
- Halluzinationsschutz: Nur beschriebene Sheet‑Namen verwenden, Pflichtfelder prüfen, fehlende Daten klar benennen

## Nächste Schritte
- M365 MCP Server finalisieren (Paketname/Startkommando, Auth/Scopes, Ordnernamen)
- `.env` erstellen (Azure + Brave + optionale M365 Variablen)
- Optional Persistenz v1 (Claim/Email/Document) gemäß Validierungsplan

Bei Fragen: starte mit `docs/TECH-IMPLEMENTATION-KFZ.md` und nutze die Prompts aus `docs/PROMPT-LIBRARY.md`.
