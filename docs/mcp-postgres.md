# Postgres MCP Integration

Diese Notiz erklärt, wie der Postgres MCP Server ("Postgres MCP Pro") an den ClaimPilot Agent angebunden wird. Ziel ist, dass der Agent uneingeschränkte CRUD-Befehle gegen die lokale Postgres-Datenbank ausführen kann.

## Voraussetzungen

- Laufender Postgres-Container: `claimspilot-postgres` (Port 8356 laut Docker Compose/Handbuch).
- Docker Desktop, damit `host.docker.internal` verfügbar ist (wird vom MCP Image automatisch verwendet).
- Das Docker-Image `crystaldba/postgres-mcp` (wird beim Start automatisch gezogen).

## Start per Umgebungsvariablen

Der Agent liest `MCP_POSTGRES_CMD` und `MCP_POSTGRES_URI`. Beispiel für lokale Entwicklung:

```bash
export MCP_POSTGRES_CMD="docker run -i --rm -e DATABASE_URI=postgresql://claimspilot:claimspilot@localhost:8356/claimspilot crystaldba/postgres-mcp"
export MCP_POSTGRES_URI="postgresql://claimspilot:claimspilot@localhost:8356/claimspilot"
```

Wichtig:

- `srv/agent/mcp-clients.js` erzwingt `--access-mode=unrestricted`. Dadurch darf der Agent DDL/DML ohne Rückfrage ausführen.
- Falls bereits `--access-mode` im Kommando steht, wird es auf `unrestricted` überschrieben.
- Ohne `MCP_POSTGRES_URI` wird als Fallback `DATABASE_URL` genutzt.

## Tools im Agent

Nach dem Start stehen (standardmäßig) folgende Werkzeuge zur Verfügung:

- `postgres_execute_sql` – generische CRUD-Ausführung (`execute_sql`).
- `postgres_list_schemas`, `postgres_list_objects`, `postgres_get_object_details` – Schemaexploration.
- `postgres_explain_query`, `postgres_get_top_queries` – Performanceanalyse.
- `postgres_analyze_db_health`, `postgres_analyze_workload_indexes`, `postgres_analyze_query_indexes` – Diagnose bzw. Indexempfehlungen.

Die Whitelist lässt sich über `MCP_POSTGRES_TOOLS` einschränken (kommagetrennte Namensliste), falls einzelne Tools deaktiviert werden sollen.

## Schneller Test

```bash
MCP_POSTGRES_CMD="docker run -i --rm -e DATABASE_URI=postgresql://claimspilot:claimspilot@localhost:8356/claimspilot crystaldba/postgres-mcp" \
MCP_POSTGRES_URI="postgresql://claimspilot:claimspilot@localhost:8356/claimspilot" \
node - <<'NODE'
(async () => {
  const { initAllMCPClients, closeMCPClients } = require('./srv/agent/mcp-clients');
  const clients = await initAllMCPClients();
  const result = await clients.postgres.callTool({
    name: 'execute_sql',
    arguments: { sql: 'SELECT 42 as answer;' },
  });
  console.log(result);
  await closeMCPClients(clients);
})();
NODE
```

Erwartete Antwort: `[{"answer": 42}]` (in MCP-Textstruktur). Damit ist der unrestricted Modus aktiv und die Datenbankverbindung funktioniert.
