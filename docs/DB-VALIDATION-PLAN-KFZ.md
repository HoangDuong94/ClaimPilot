# ClaimPilot – Validierungskonzept – Postgres (MCP) für Kfz‑Schaden (POC)

Ziel: Sichere, konsistente Create/Update‑Operationen über den MCP‑Weg (`query`) gewährleisten – ohne Schemakonflikte, falsche Typen/Längen oder defekte Referenzen. Der Plan ist so formuliert, dass ein Agent deterministisch vorgeht und bei Abweichungen elegante Fallbacks/Fehlermeldungen liefert.


## Leitprinzipien
- Schichtenmodell: Vor der Schreiboperation wird IMMER validiert (Preflight). Erst wenn alle Checks bestehen, wird in einer Transaktion geschrieben.
- Idempotenz: Upserts nur über definierte eindeutige Schlüssel (z. B. `email.message_id` oder `claim.claim_number`).
- Minimalinvasiv: In POC‑Phase Validierung bevorzugt via SQL‑Preflights; optionale DB‑Constraints/Indizes ergänzen, sobald CDS feststeht.
- Transparenz: Bei Korrekturen (Truncate/Normalize) Grund nennen und in HTML/Logs ausgeben.


## Validierungsebenen

1) Schema‑Checks (Metadaten)
- Prüfe Tabellen/Spalten, Datentypen, maximale Längen, Nullable/Not‑Null, Default‑Werte.
- Quelle: `information_schema.columns`, `pg_catalog.pg_constraint`, `pg_indexes`.

2) Werte‑Checks (Payload)
- UUID/Key‑Formate (z. B. 36 Zeichen oder direkt Typ `uuid`).
- Stringlängen (z. B. `plate` ≤ 15, `policy_number` ≤ 30, `file_name` ≤ 255).
- Enumerationen (z. B. `severity` ∈ {low, medium, high}; `status` ∈ {open, in_progress, done}).
- Datumswerte (ISO 8601; `::timestamptz` castbar; `date` castbar).
- Beträge (`reserve_amount` als `numeric(15,2)`).

3) Referenzielle Integrität
- FK‑Existenz: `policy_id`, `vehicle_id`, `claim_id` müssen existieren.
- Optional: Defer‑Check in Transaktion, wenn in einem Rutsch angelegt wird.

4) Eindeutigkeit/Idempotenz
- Unique‑Schlüssel vorhanden? Beispiel:
  - `email.message_id` UNIQUE
  - `claim.claim_number` UNIQUE (oder Komposit: `policy_number` + `loss_date`)


## Preflight‑Checkliste (Agent)
- 1) Schema Discovery: Lies Metadaten der Zieltabelle (Spalten, Typ, Länge, Nullability).
- 2) Mapping validieren: Prüfe jedes Feld (Typ, Länge, Pflichtfeld).
- 3) FK prüfen: `SELECT 1 FROM <fk_table> WHERE id=$1` für alle Referenzen.
- 4) Uniqueness: Prüfe, ob ein Datensatz mit dem idempotenten Schlüssel existiert (z. B. `message_id`).
- 5) Normalize: Trim/Uppercase (z. B. `plate = UPPER(TRIM(plate))`), Datums‑Parsing (`to_timestamp`, `::date`), Text‑Truncate mit Grund.
- 6) Entscheidung: Bei Fehler → Abbruch mit klarer, kurzer Meldung + Handlungsvorschlag; bei Erfolg → Transaktion schreiben.


## SQL‑Beispiele

A) Spalten/Typen/Längen ermitteln (Schema‑Check):
```sql
SELECT column_name, data_type, character_maximum_length, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'claim'
ORDER BY ordinal_position;
```

B) Werte‑Länge prüfen (z. B. Kennzeichen ≤ 15):
```sql
SELECT LENGTH($1) <= 15 AS ok; -- $1 = 'M-AB 1234'
```

C) UUID prüfen:
```sql
SELECT $1::uuid IS NOT NULL AS ok; -- wirft Fehler, wenn kein gültiges UUID-Format
```

D) ENUM/Set validieren (mit Checkliste im Agenten):
```sql
-- Beispiel: severity muss in (low, medium, high) liegen
SELECT $1 IN ('low','medium','high') AS ok;
```

E) Datum castbar?
```sql
SELECT ($1::timestamptz) IS NOT NULL AS ok;  -- '2025-08-30T17:45:00Z'
SELECT ($2::date) IS NOT NULL AS ok;         -- '2025-09-05'
```

F) FK‑Existenz (Policy/Vehicle):
```sql
SELECT EXISTS(SELECT 1 FROM policy WHERE id = $1) AS ok;  -- $1 = policy_id
SELECT EXISTS(SELECT 1 FROM vehicle WHERE id = $1) AS ok; -- $1 = vehicle_id
```

G) Uniqueness/Idempotenz (Email.message_id):
```sql
SELECT EXISTS(SELECT 1 FROM email WHERE message_id = $1) AS exists; -- $1 = '<msg-1@contoso>'
```

H) Transaktion mit Upsert (vereinfachtes Muster):
```sql
BEGIN;
-- Claim anlegen/aktualisieren
INSERT INTO claim (claim_number, policy_id, vehicle_id, loss_date, description, severity, reserve_amount)
VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7::numeric)
ON CONFLICT (claim_number)
DO UPDATE SET description = EXCLUDED.description, severity = EXCLUDED.severity, reserve_amount = EXCLUDED.reserve_amount
RETURNING id;
-- Email referenzieren (idempotent)
INSERT INTO email (message_id, claim_id, subject, received_at, has_attachments)
VALUES ($8, $9, $10, $11::timestamptz, $12)
ON CONFLICT (message_id) DO NOTHING;
COMMIT;
```

Rollback‑Muster bei Fehlern:
```sql
ROLLBACK; -- bei einem Preflight- oder Insert-Fehler
```


## Beispiel: Falsche Key‑Länge (Kennzeichen)
- Problem: `plate` ist 22 Zeichen, erlaubt sind 15.
- Vorgehen:
  1) Preflight Längencheck → Fehler erkannt.
  2) Agent entscheidet nach Policy: a) hart ablehnen (Fehler melden), b) Truncate mit Hinweis.
  3) HTML‑Antwort enthält Abschnitt „Validierungen“ mit „plate gekürzt von 22→15 Zeichen; Original: ‚...‘“.

Truncate‑Beispiel (bewusst, nur POC):
```sql
SELECT LEFT($1, 15);  -- Trunkiert auf 15
```


## Optional: DB‑Constraints/Indizes (empfohlen, sobald CDS steht)
- UNIQUE: `email(message_id)`, `claim(claim_number)` oder Komposit‐Key (`policy_number`,`loss_date`).
- CHECKs: `CHECK (char_length(plate) <= 15)`, `CHECK (severity IN ('low','medium','high'))`.
- FK: `claim.policy_id → policy(id)`, `claim.vehicle_id → vehicle(id)`.
- Typen: `uuid` für IDs, `numeric(15,2)` für Beträge, `timestamptz`/`date` für Datum.

Diese Constraints verhindern fehlerhafte Writes auch dann, wenn ein Preflight einmal versagt.


## Agent‑Sequenz (Deterministisch)
1) Schema lesen → Spaltenregeln extrahieren (Max‑Länge, Datentyp, Nullable).
2) Payload normalisieren (Trim, Upper, Datums‑Parse, Dezimalformat), Längen prüfen.
3) Pflichtfelder prüfen (z. B. `policy_number`, `plate`, `loss_date`).
4) FK‑Existenz prüfen.
5) Uniqueness/Idempotenz prüfen.
6) BEGIN → UPSERTs → COMMIT (bei Fehler: ROLLBACK und klare HTML‑Fehlermeldung).
7) HTML‑Abschnitte: Aktionen, Validierungen (ok/korrekturen), Datenänderungen, Referenzen (IDs/Keys).


## Fallbacks
- Unklare/fehlende Werte → Task „clarify‑data“ anlegen (falls Persistenz) oder im HTML „fehlende Felder“ aufführen.
- Constraint‑Violation → Fehlermeldung klar und kurz, keine halben Writes (Rollback).
- Staging‑Pattern (optional): Rohdaten in Staging‑Tabelle, Validierung dort, Promotion in finalen Tabellen erst nach Erfolg.


## Logging/Transparenz
- Vor dem Write: Liste der Prüfungen + Ergebnisse (true/false) erzeugen und in der HTML‑Zusammenfassung ausgeben.
- Bei Korrekturen: Art der Korrektur + Grund benennen (z. B. „plate auf 15 Zeichen gekürzt“).
- Post‑Write: IDs/Keys der betroffenen Datensätze anzeigen.


## Abschluss
Mit diesem Plan kann der Agent über MCP‑`query` verlässlich validieren, idempotent schreiben und bei Inkonsistenzen deterministisch abbrechen oder korrigieren – ohne das bestehende CAP/FE‑Gerüst zu ändern. Sobald das endgültige CDS steht, sollten Constraints/Indizes in der DB etabliert werden, um den Schutz serverseitig zu verhärten.
