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

