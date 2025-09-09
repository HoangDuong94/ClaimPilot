ClaimPilot CAP Backend (ohne Fiori)

Dieses Projekt stellt ein minimales CAP-Backend (Node.js, OData v4) für die Domäne KFZ bereit. Es enthält:
- CDS-Domänenmodell unter `db/schema.cds` (sap.kfz)
- OData-Service unter `srv/service.cds` (Pfad `/service/kfz`)
- Action `callLLM(prompt)` mit Platzhalter-Handler in `srv/service.js`

Schnellstart
- Abhängigkeiten: `npm install`
- Entwickeln: `npm run watch` (oder `cds watch`)
- Service öffnen: `http://localhost:9999/service/kfz/`

Hinweise
- Standard-DB ist SQLite (`sqlite.db`). PostgreSQL kann später konfiguriert werden.
- Fiori Elements wird hier bewusst nicht bereitgestellt; UI-Generierung folgt separat.

Agent (PoC)
- Neuer SSE-Endpoint: `POST /ai/agent/stream` mit Body `{ "prompt": "...", "threadId": "optional" }`.
- Streamt Token-Chunks als `data: <text>` und Tool-Events als JSON (`tool_start|tool_end|tool_error`).
- MCP (Microsoft 365 CLI) wird bevorzugt genutzt; Fallback ist das Plain-LLM.
- Zum Aktivieren: `AGENT_ENABLE=1` (Default). Optional: `MCP_M365_START_CMD` auf den MCP-Server-Startbefehl setzen.
