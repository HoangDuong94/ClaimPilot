# PostgreSQL Setup for ClaimPilot

Dieses Dokument beschreibt die Schritte, um die CAP-Anwendung mit einer PostgreSQL-Datenbank zu betreiben. Die Anleitung deckt den lokalen Docker-Betrieb ab und zeigt, wie die CAP-Konfiguration umgestellt wird.

## Voraussetzungen

- Docker Desktop (WSL-Integration aktiv)
- Node.js-AbhÃ¤ngigkeiten bereits mit `npm install` installiert
- Zugriff auf das Projektverzeichnis `ClaimPilot`

## PostgreSQL in Docker bereitstellen

1. Persistentes Volume anlegen (einmalig):
   ```bash
   docker volume create claimspilot-pgdata
   ```
2. Container mit PostgreSQL 16 starten:
   ```bash
   docker run -d --name claimspilot-postgres \
     -e POSTGRES_DB=claimspilot \
     -e POSTGRES_USER=claimspilot \
     -e POSTGRES_PASSWORD=claimspilot \
     -p 5433:5432 \
     -v claimspilot-pgdata:/var/lib/postgresql/data \
     postgres:16
   ```
   - Port `5433` auf dem Host bleibt frei neben anderen Instanzen; bei Bedarf anpassen.
   - Umgebungsvariablen setzen Datenbankname, Benutzer und Passwort.
3. Status prÃ¼fen:
   ```bash
   docker ps
   docker logs --tail 20 claimspilot-postgres
   ```
4. Verbindung testen:
   ```bash
   docker exec claimspilot-postgres \
     psql -U claimspilot -d claimspilot -c "SELECT 1"
   ```

## CAP-Konfiguration auf PostgreSQL umstellen

1. PostgreSQL-Treiber installieren:
   ```bash
   npm install @cap-js/postgres
   ```
2. Zugangsdaten in `.env` hinterlegen (nicht commiten):
   ```env
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5433
   POSTGRES_USER=claimspilot
   POSTGRES_PASSWORD=claimspilot
   POSTGRES_DATABASE=claimspilot
   ```
3. Profil `postgres` definieren, z.B. in `package.json` (Auszug):
   ```json
   "cds": {
     "requires": {
       "db": {
         "kind": "sqlite",
         "credentials": { "database": "sqlite.db" }
       },
       "[postgres]": {
         "db": {
           "kind": "postgres",
           "credentials": {
             "host": "{env.POSTGRES_HOST}",
             "port": "{env.POSTGRES_PORT}",
             "database": "{env.POSTGRES_DATABASE}",
             "user": "{env.POSTGRES_USER}",
             "password": "{env.POSTGRES_PASSWORD}"
           }
         }
       }
     }
   }
   ```
   - Alternativ kann das Profil in `.cdsrc.json` gepflegt werden.
   - FÃ¼r Cloud-Deployments empfiehlt sich eine BTP-Destination statt direkter Credentials.

## Datenmodell auf PostgreSQL deployen

1. Schema und CSV-Testdaten einspielen:
   ```bash
   npx cds deploy --to postgres --profile postgres
   ```
2. Service gegen PostgreSQL starten:
   ```bash
   npm run watch -- --profile postgres
   ```
3. UI `app/claims` oder OData-Endpunkte prÃ¼fen, um sicherzustellen, dass die Testdaten geladen wurden.

## Betrieb & Wartung

- Container stoppen/starten: `docker stop claimspilot-postgres`, `docker start claimspilot-postgres`.
- Backups: Volume `claimspilot-pgdata` sichern oder `pg_dump` Ã¼ber `docker exec` aufrufen.
- Passwort und sensible Daten ausschlieÃŸlich in `.env` und nicht im Repo speichern.
- FÃ¼r Mehrbenutzerumgebungen individuelle Benutzer/Rollen in PostgreSQL einrichten (`CREATE ROLE ...`).

Mit diesen Schritten kann die CAP-App lokal oder in hybriden Szenarien gegen PostgreSQL betrieben werden, wÃ¤hrend SQLite als Default weiterhin verfÃ¼gbar bleibt.

## Alternativen & Tipps

- Verbindung über Connection-String (statt Einzelwerten):
  - `.env`
    ```env
    DATABASE_URL=postgres://claimspilot:claimspilot@localhost:5433/claimspilot
    ```
  - `package.json` Profil anpassen (nur `url`):
    ```json
    "cds": {
      "requires": {
        "[postgres]": {
          "db": {
            "kind": "postgres",
            "credentials": { "url": "{env.DATABASE_URL}" }
          }
        }
      }
    }
    ```

- SSL (Cloud/Produktiv):
  - In `credentials` z. B. `ssl: { "rejectUnauthorized": false }` setzen, wenn das Zertifikat nicht validiert werden kann.
  - Besser: CA-Zertifikat übergeben und `rejectUnauthorized: true` lassen.

- Initiales Schema/Role (optional):
  ```sql
  CREATE ROLE claimspilot LOGIN PASSWORD 'claimspilot';
  CREATE DATABASE claimspilot OWNER claimspilot;
  ```

- Admin-Tool (optional):
  - pgAdmin in Docker: `dpage/pgadmin4`, Port 5050, Verbindung auf `localhost:5433`.

## Troubleshooting

- ECONNREFUSED/Timeout:
  - Port korrekt? Container läuft? Host-Firewall/Proxy prüfen.
- `role "claimspilot" does not exist`:
  - Benutzer/DB wie oben anlegen oder .env anpassen.
- `permission denied for schema`:
  - Rechte prüfen (`GRANT ALL ON SCHEMA public TO claimspilot;`).
- Deploy überschreibt nicht:
  - Mit `--profile postgres` starten und sicherstellen, dass das Profil greift.
  - `npx cds env` zeigt die effektive Konfiguration.
- Umlaute/Encoding in Daten:
  - Container-Locale auf UTF-8, Client-Encoding `UTF8` verwenden.

## CI/Dev-Workflow

- Lokales Starten gegen Postgres:
  ```bash
  npm run watch -- --profile postgres
  ```
- Einmaliges Deploy (Schema + CSV):
  ```bash
  npx cds deploy --to postgres --profile postgres
  ```


