# CAP ↔ PostgreSQL Timeout (ResourceRequest timed out)

Kurzer Leitfaden, falls der Service mit 500 – `TimeoutError: ResourceRequest timed out` antwortet (z. B. bei `GET /service/kfz/Policy`). Das Problem liegt fast immer an der DB‑Verbindung (Port/URL/Reachability), nicht an der OData‑Query.

**Symptome**
- Logauszug beim Request:
  - `500 - TimeoutError: ResourceRequest timed out (generic-pool)`
- CAP startet scheinbar normal, aber erste DB‑Zugriffe hängen/fehlschlagen.

**Schnelle Checks**
- Docker‑Portmapping prüfen (Standardname hier: `claimspilot-postgres`):
  - `docker ps` → Spalte `PORTS` muss z. B. `0.0.0.0:8356->5432/tcp` zeigen.
- TCP‑Erreichbarkeit vom Host/WSL prüfen:
  - Bash: `(echo >/dev/tcp/127.0.0.1/8356) && echo OK || echo FAIL`
- DB im Container erreichbar?
  - `docker exec claimspilot-postgres psql -U claimspilot -d claimspilot -c "select 1"`
- Effektive CAP‑DB‑Konfiguration:
  - `npx cds env requires.db` → erwartet `credentials.url = {env.DATABASE_URL}`
- Profil richtig aufrufen (ohne doppelten Strich):
  - `cds run --profile hybrid` (nicht `cds run --profile --hybrid`)

**Häufige Ursachen**
- Port‑Mismatch: Container exponiert z. B. `9039`, aber CAP verbindet auf `8356` (oder umgekehrt).
- Falscher Profilaufruf: `--profile --hybrid` statt `--profile hybrid` → falsches Profil greift.
- DB noch nicht "ready": Unmittelbar nach Docker‑Start, Healthcheck/Readyphase.
- Ungültige/fehlende `DATABASE_URL`: Platzhalter bleibt leer oder zeigt auf falschen Host/Port.

**Behebung (empfohlen, zukunftssicher)**
- Eine Quelle der Wahrheit nutzen: `DATABASE_URL` in `.env` setzen (hier Standard `8356`):
  - `DATABASE_URL=postgres://claimspilot:claimspilot@localhost:8356/claimspilot`
- Container mit fixem Port 8356 betreiben (Daten bleiben im Volume):
  - `docker stop claimspilot-postgres && docker rm claimspilot-postgres`
  - `docker run -d --name claimspilot-postgres \
    -e POSTGRES_DB=claimspilot -e POSTGRES_USER=claimspilot -e POSTGRES_PASSWORD=claimspilot \
    -p 8356:5432 -v claimspilot-pgdata:/var/lib/postgresql/data postgres:16`
- CAP korrekt starten:
  - `cds run --profile hybrid` oder `npm run watch:hybrid`

**Verifizieren**
- `docker exec claimspilot-postgres psql -U claimspilot -d claimspilot -c "\dt"` → Tabellen sichtbar (`sap_kfz_*`, …)
- `npx cds env requires.db` → zeigt `credentials.url` auf `localhost:8356`
- `curl -s "http://localhost:9999/service/kfz/Policy?$top=1"` → HTTP 200

**Hinweise / Sonderfälle**
- Wenn Port 9999 belegt ist: `ss -ltnp | rg ':9999'` und Prozess beenden, oder CAP mit `--port 0` (Autoport) starten.
- WSL/Windows‑Mischumgebung: Falls `psql` nativ nicht installiert ist, nutze `docker exec` für Konnektivitätstests.
- Meldung „better‑sqlite3 invalid ELF header“ bei `cds deploy`: Das ist ein Build‑Mismatch der SQLite‑Dev‑Dependency in WSL. Entweder in WSL `npm ci` neu ausführen oder direkt nur gegen Postgres arbeiten (kein Deploy nötig, wenn das Schema bereits da ist).

**Standardeinstellungen in diesem Repo**
- Erwartete URL: `postgres://claimspilot:claimspilot@localhost:8356/claimspilot` (in `.env` als `DATABASE_URL`).
- CAP liest `DATABASE_URL`; Port‑Änderungen müssen in Docker und `.env` konsistent erfolgen.
