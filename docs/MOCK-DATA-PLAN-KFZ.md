# ClaimPilot – Mockdaten-Plan – Kfz-Schaden (POC)

Ziel: Realistische, konsistente Mockdaten für eine Kfz‑Schadenmeldungs‑App planen, die mit CAP/CDS, OData v4 und Fiori Elements harmonieren. Dieser Plan orientiert sich an der bestehenden Struktur (CSV-Seeding unter `db/data/`), dem Stil des aktuellen CDS (cuid/managed, Associations/Compositions) und fokussiert auf nachvollziehbare Testfälle für agentische Flows (E‑Mail → Excel → Extraktion → HTML/optional Persistenz).

Hinweis: Dies ist eine Planungsgrundlage. Wir ändern in dieser Session keine CDS-Dateien, sondern definieren, wie die späteren CSVs aussehen sollen, sobald das CDS für Kfz vorliegt.


## Leitlinien (aus bestehendem Projekt abgeleitet)
- Namespace: wie im Projekt üblich `sap.<domäne>` (z. B. `sap.kfz`).
- CAP/CDS Konventionen: `cuid, managed` in Kernentitäten; Beziehungen als `Association`/`Composition` analog `db/schema.cds`.
- Seed‑Format: je Entität eine CSV unter `db/data/<namespace>-<Entity>.csv` (vgl. `db/data/sap.stammtisch-*.csv`).
- Datumsformat: ISO 8601; für `DateTime` z. B. `2025-09-01T18:30:00Z`.
- Textspalten: String‑Längen orientieren sich an bisherigen Mustern (String(100)/String(255)) – für Mockdaten nicht strikt, aber konsistent planen.


## Entitäten (geplant) und Beziehungen

Vorschlag (POC‑Set, minimal aber aussagekräftig):
- Claim (cuid, managed)
  - claimNumber (String(30)), status (enum/String), lossDate (DateTime), reportedDate (DateTime), description (LargeString)
  - severity (String: low|medium|high), reserveAmount (Decimal(15,2))
  - Associations: policy → Policy, vehicle → Vehicle; Composition: tasks → Task, documents → Document, emails → Email
- Policy (cuid, managed)
  - policyNumber (String(30)), product (String(40)), effectiveDate (Date), expiryDate (Date), coverageLimits (String)
  - insured → Insured
- Insured (cuid, managed)
  - name (String(100)), email (String), phone (String), address (String)
- Vehicle (cuid, managed)
  - vin (String(20)), plate (String(15)), make (String(40)), model (String(40)), year (Integer)
- LossEvent (cuid, managed) [optional v1]
  - location (String(255)), circumstances (LargeString), policeReportNo (String)
  - claim → Claim (1:1)
- Document (cuid, managed)
  - fileName (String(255)), mimeType (String(60)), storageRef (String(255)), source (String: email|upload|excel)
  - claim → Claim (n:1)
- Email (cuid, managed)
  - messageId (String(120)), subject (String(255)), from (String(255)), receivedAt (DateTime), hasAttachments (Boolean)
  - claim → Claim (n:1)
- Task (cuid, managed)
  - type (String: triage|estimation|contact|payment|clarify-data), status (String: open|in_progress|done), dueDate (Date), assignee (String)
  - claim → Claim (n:1)

Beziehungen (geplant):
- Claim 1 — 1 Policy, Claim 1 — 1 Vehicle (Association)
- Claim 1 — n Emails/Documents/Tasks (Composition bevorzugt, analog Stammtisch→Teilnehmer Komposition)


## CSV‑Dateien (geplant) und Spalten

Dateinamen folgen der bestehenden Konvention:
- `db/data/sap.kfz-Policy.csv`
- `db/data/sap.kfz-Insured.csv`
- `db/data/sap.kfz-Vehicle.csv`
- `db/data/sap.kfz-Claim.csv`
- `db/data/sap.kfz-Email.csv`
- `db/data/sap.kfz-Document.csv`
- `db/data/sap.kfz-Task.csv`

Spalten (Plan):

1) Policy
- ID, policyNumber, product, effectiveDate, expiryDate, coverageLimits, insured_ID

2) Insured
- ID, name, email, phone, address

3) Vehicle
- ID, vin, plate, make, model, year

4) Claim
- ID, claimNumber, status, lossDate, reportedDate, description, severity, reserveAmount, policy_ID, vehicle_ID

5) Email
- ID, messageId, subject, from, receivedAt, hasAttachments, claim_ID

6) Document
- ID, fileName, mimeType, storageRef, source, claim_ID

7) Task
- ID, type, status, dueDate, assignee, claim_ID

Anmerkungen:
- IDs: UUIDs (können für Mockdaten fixe UUIDs sein); Assoziationen referenzieren via `<entity>_ID` (analog aktuellem Projektstil z. B. `praesentator_ID`).
- Dateipfade (storageRef): relative Pfade im Repo oder Platzhalter (`files/claim-1001/claim.xlsx`).


## Beispiel‑Datensätze (kompakt, pro Entität)

Insured
```
ID,name,email,phone,address
11111111-1111-1111-1111-111111111111,Max Mustermann,max.mustermann@example.com,+49 170 1234567,Beispielweg 1, 80331 München
22222222-2222-2222-2222-222222222222,Erika Beispiel,erika.beispiel@example.com,+49 171 2345678,Demoallee 5, 50667 Köln
```

Policy
```
ID,policyNumber,product,effectiveDate,expiryDate,coverageLimits,insured_ID
aaaaaaa1-0000-0000-0000-000000000001,VS-4711,KFZ-Kasko,2025-01-01,2025-12-31,Haftpflicht+Teilkasko,11111111-1111-1111-1111-111111111111
aaaaaaa2-0000-0000-0000-000000000002,VS-815,KFZ-Haftpflicht,2025-03-01,2026-02-28,Haftpflicht,22222222-2222-2222-2222-222222222222
```

Vehicle
```
ID,vin,plate,make,model,year
bbbbbbb1-0000-0000-0000-000000000001,WVWZZZ1JZXW000001,M-AB 1234,Volkswagen,Golf,2020
bbbbbbb2-0000-0000-0000-000000000002,WBACB11010DU00002,K-KA 9876,BMW,3er,2019
```

Claim
```
ID,claimNumber,status,lossDate,reportedDate,description,severity,reserveAmount,policy_ID,vehicle_ID
ccccccc1-0000-0000-0000-000000000001,CL-1001,open,2025-08-30T17:45:00Z,2025-08-31T08:10:00Z,Frontschaden nach Auffahrunfall an Ampel,medium,1500.00,aaaaaaa1-0000-0000-0000-000000000001,bbbbbbb1-0000-0000-0000-000000000001
ccccccc2-0000-0000-0000-000000000002,CL-1002,in_progress,2025-08-20T09:30:00Z,2025-08-20T10:00:00Z,Hagelschaden Motorhaube/Dach,low,300.00,aaaaaaa2-0000-0000-0000-000000000002,bbbbbbb2-0000-0000-0000-000000000002
```

Email
```
ID,messageId,subject,from,receivedAt,hasAttachments,claim_ID
ddddddd1-0000-0000-0000-000000000001,<msg-1@contoso>,Schadenmeldung Kfz – VS-4711,customer1@mail.com,2025-08-31T07:55:10Z,true,ccccccc1-0000-0000-0000-000000000001
ddddddd2-0000-0000-0000-000000000002,<msg-2@contoso>,Hagelschaden – VS-815,customer2@mail.com,2025-08-20T09:45:00Z,false,ccccccc2-0000-0000-0000-000000000002
```

Document
```
ID,fileName,mimeType,storageRef,source,claim_ID
fffffff1-0000-0000-0000-000000000001,claim-1001.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,files/claim-1001/claim.xlsx,excel,ccccccc1-0000-0000-0000-000000000001
fffffff2-0000-0000-0000-000000000002,fotos.zip,application/zip,files/claim-1002/fotos.zip,email,ccccccc2-0000-0000-0000-000000000002
```

Task
```
ID,type,status,dueDate,assignee,claim_ID
99999991-0000-0000-0000-000000000001,estimation,open,2025-09-05,Sachbearbeiter A,ccccccc1-0000-0000-0000-000000000001
99999992-0000-0000-0000-000000000002,contact,open,2025-09-02,Sachbearbeiter B,ccccccc2-0000-0000-0000-000000000002
```


## Szenarien (für End‑to‑End Tests mit Agent)

S1 – Standard Fluss (E‑Mail mit Excel‑Anhang):
- Email.messageId `<msg-1@contoso>`, Betreff enthält „Schadenmeldung“, `hasAttachments=true`, Document `claim-1001.xlsx` verknüpft.
- Excel‑Sheet „Schadenmeldung“ enthält Spalten wie `Versicherungsscheinnummer`, `Kennzeichen`, `Schadendatum`, `Beschreibung`.
- Agent: findet Mail → lädt Excel → `excel_describe_sheets` → `excel_read_sheet` → mappt → HTML ausgeben.

S2 – Kein Anhang, nur Text:
- Email ohne Attachment, aber „Hagelschaden“ im Betreff/Text; Agent liefert Minimal‑Extraktion (nur Betreff/Body), empfiehlt fehlende Daten nachzufordern (Task `clarify-data`).

S3 – Mehrere Anhänge:
- Zwei Excel‑Dateien; Agent wählt plausibelste (größte/namensähnlichste), verweist auf alternative Anhänge in „Referenzen“.

S4 – Abweichender Sheetname:
- Excel enthält „Meldung“ statt „Schadenmeldung“; Agent zeigt `excel_describe_sheets` Ergebnis und fragt nach Auswahl, falls unsicher.

S5 – Bereits verarbeitete Mail (optional, bei Persistenz):
- Email.messageId existiert bereits → Agent meldet idempotent „bereits verarbeitet“, erneut nur HTML‑Zusammenfassung ohne DB‑Änderung.


## Validierungen und Konsistenzregeln (geplant)
- Pflichtfelder für sinnvolle Triage: `policyNumber`, `plate`, `lossDate` – andernfalls Task `clarify-data` vorschlagen.
- `reserveAmount` Heuristik: low=300, medium=1500, high=5000 (nur Anzeige in HTML, Persistenz optional).
- Referentielle Integrität: `policy_ID`, `vehicle_ID`, `claim_ID` müssen auf existierende IDs in den jeweiligen CSVs verweisen.
- Datumswerte ISO 8601 (für `DateTime`), reine `Date` als `YYYY-MM-DD`.


## Datenumfang und Vielfalt
- 2–3 Insured, 2 Policies, 2 Vehicles, 2–3 Claims, 2 Emails, 2 Documents, 2 Tasks.
- Mindestens ein Case mit Excel‑Anhang, einer ohne, einer mit mehreren Anhängen.


## Dateistruktur (geplant) für Assets
- `files/claim-1001/claim.xlsx` (Fake‑Platzhalter für Tests; realer Inhalt nicht erforderlich, wenn nur Flow demonstriert wird)
- `files/claim-1002/fotos.zip`


## Nächste Schritte
1) CDS für `sap.kfz` entwerfen (Claim/Policy/Insured/Vehicle/Email/Document/Task inkl. cuid/managed, Assoziationen/Kompositionen).
2) CSVs gemäß obiger Struktur anlegen und referenzielle IDs abstimmen.
3) Agent‑Prompts auf Standard‑JSON‑Mapping und HTML‑Abschnitte festnageln (siehe `docs/Agent.md`).
4) Optional Persistenz‑Tests (Postgres MCP `query`) ergänzen.

## Praxisnahes Excel‑Design (für Sachbearbeiter)

Ziel: Ein Excel, das in der Praxis von Sachbearbeitern ausfüllbar ist und stabil vom Agenten (Excel MCP) geparst werden kann. Keine Merge‑Zellen, klare Header, feste Datentypen. 1 Schaden pro Datei (Batch optional).

- Blätter: `00_Anleitung`, `01_Fallübersicht`, `02_Versicherungsnehmer`, `03_Fahrzeug`, `04_Ereignis`, `05_Kostenpositionen`, `06_Belege`, `07_Metadaten`, (optional) `99_Lookup` (versteckt für Drop‑downs).

### 01_Fallübersicht (Pflichtkern in einer Zeile)
- Versicherungsscheinnummer (policyNumber, Pflicht, String ≤ 30)
- Schadennummer (claimNumber, optional, String ≤ 30)
- Kennzeichen (plate, Pflicht, String ≤ 15)
- VIN (vin, optional, ideal 17 Zeichen alphanumerisch)
- Schadendatum (lossDate, Pflicht, Datum/ISO)
- Meldedatum (reportedDate, optional)
- Ort (location, optional)
- Beschreibung (description, Pflicht, Freitext ≤ 2000)
- Schadenschwere (severity, optional, low|medium|high via Drop‑down)
- Deckung geprüft (coverageStatus, optional, ja|nein|unklar)

Beispielzeile: VS‑4711 | CL‑1001 | M‑AB 1234 | WVWZZZ1JZXW000001 | 2025‑08‑30 | 2025‑08‑31 | München, Leopoldstr. 12 | Auffahrunfall an Ampel, Airbag | medium | unklar

### 02_Versicherungsnehmer
- Name (claimantName, Pflicht)
- E‑Mail (claimantEmail, Pflicht)
- Telefon (phone, optional)
- Adresse (address, optional)

### 03_Fahrzeug
- Marke (make), Modell (model), Baujahr (year 1900–aktuelles Jahr)
- Kennzeichen (plate; Cross‑Check)
- VIN (vin; 17 Zeichen, A–Z/0–9, keine I/O/Q)

### 04_Ereignis
- Hergang (circumstances; 2–5 Sätze)
- Beteiligte Dritte (thirdPartyPresent: ja|nein), Fremdschaden (thirdPartyDamage: ja|nein)
- Polizei hinzugezogen (policeInvolved: ja|nein), Polizeiaktenzeichen (policeReportNo)
- Zeugen (witnesses: „Name – Kontakt“, kommasepariert)
- GPS (lat/lon, optional Dezimal)
- Foto‑Hinweis (hasPhotos: ja|nein)

### 05_Kostenpositionen (mehrere Zeilen)
- PosNr (Integer), Kategorie (repair|towing|rental|other), Beschreibung
- Betrag (amount, Zahl 2 Dezimal), Währung (currency: EUR|CHF|USD), MwStSatz% (vatRate)

Beispiel:
- 1 | repair | Stoßstange/Frontträger | 1200,00 | EUR | 19
- 2 | towing | Abschleppen | 150,00 | EUR | 19

### 06_Belege
- Dateiname (fileName), Typ (photo|estimate|other), Beschreibung (optional), Quelle (email|upload), Sensitiv (ja|nein)

### 07_Metadaten
- messageId (z. B. <msg‑1@contoso>), sourceEmail, receivedAt (ISO), Eingangskanal (email|portal|telefon), Bearbeiter, Status (intake|review|triage|closed)

### 99_Lookup (versteckt)
- severity: low|medium|high; booleans: ja|nein|unklar; kosten.kategorien; waehrungen; eingangskanal/status

### Validierungen (praxisnah)
- Kennzeichen: ≤ 15, Großbuchstaben, Bindestriche erlaubt (Agent: trim/upper; bei >15: kürzen und im HTML melden)
- VIN: 17 Zeichen alphanumerisch; leer zulässig
- Pflichtfelder: policyNumber, plate, lossDate, description, claimantName, claimantEmail
- Datum: Excel‑Datum oder ISO; Agent normalisiert zu ISO 8601
- Beträge: numerisch, 2 Dezimal; currency via Drop‑down
- Enumerationen: severity ∈ {low,medium,high}; Kategorie ∈ {repair,towing,rental,other}

### Agent‑Mapping (kanonisch)
- policyNumber ← 01_Fallübersicht.Versicherungsscheinnummer
- claimNumber ← 01_Fallübersicht.Schadennummer (optional)
- plate ← 01_Fallübersicht.Kennzeichen (Cross‑Check 03_Fahrzeug)
- vin ← 01_Fallübersicht.VIN oder 03_Fahrzeug.VIN
- lossDate ← 01_Fallübersicht.Schadendatum; reportedDate ← Meldedatum
- description ← 01_Fallübersicht.Beschreibung; severity ← Schadenschwere
- claimantName/claimantEmail ← 02_Versicherungsnehmer
- costs[] ← 05_Kostenpositionen; documents[] ← 06_Belege; meta.* ← 07_Metadaten

### Header‑Synonyme (DE/EN → Kanon)
- Versicherungsscheinnummer|Police|Policy No → policyNumber
- Schadennummer|Claim No → claimNumber
- Kennzeichen|Nummernschild|License Plate → plate
- Schadendatum|Loss Date → lossDate; Meldedatum|Reported Date → reportedDate
- Beschreibung|Sachverhalt|Description → description
- Name|Versicherungsnehmer|Claimant Name → claimantName; E‑Mail|Email → claimantEmail

### Hinweise für Sachbearbeiter (00_Anleitung)
- Keine Merge‑Zellen; Header in Zeile 1; Pflichtfelder gelb markiert
- Datumszellen als Datum formatieren (oder ISO schreiben)
- Dateiname: `Schaden_<policyNumber>_<lossDate>_<plate>.xlsx`

## Excel Header Matrix (Beispielwerte/Validierungen)

| Kanonisches Feld | Mögliche Header (DE/EN) | Format/Regel | Beispiel | Pflicht |
|---|---|---|---|---|
| policyNumber | Versicherungsscheinnummer, Police, Policy No | String ≤ 30 | VS‑4711 | Ja |
| claimNumber | Schadennummer, Claim No | String ≤ 30 | CL‑1001 | Nein |
| plate | Kennzeichen, Nummernschild, License Plate | String ≤ 15, UPPER/TRIM | M‑AB 1234 | Ja |
| vin | VIN, Fahrgestellnummer | String 17, [A‑Z0‑9], keine I/O/Q | WVWZZZ1JZXW000001 | Nein |
| lossDate | Schadendatum, Loss Date | ISO 8601 oder Datum | 2025‑08‑30 | Ja |
| reportedDate | Meldedatum, Reported Date | ISO 8601 oder Datum | 2025‑08‑31 | Nein |
| location | Ort, Location | String ≤ 255 | München, Leopoldstr. 12 | Nein |
| description | Beschreibung, Sachverhalt, Description | String ≤ 2000 | Auffahrunfall … | Ja |
| severity | Schadenschwere | low|medium|high | medium | Nein |
| claimantName | Name, Versicherungsnehmer, Claimant Name | String ≤ 100 | Max Mustermann | Ja |
| claimantEmail | E‑Mail, Email | E‑Mail‑Format | max.mustermann@example.com | Ja |
| phone | Telefon | String | +49 170 1234567 | Nein |
| address | Adresse | String | Beispielweg 1, 80331 München | Nein |
| make | Marke | String | Volkswagen | Nein |
| model | Modell | String | Golf | Nein |
| year | Baujahr | Ganzzahl (1900..jetzt) | 2020 | Nein |
| policeReportNo | Polizeiaktenzeichen | String | 2025/12345 | Nein |
| hasPhotos | Foto‑Hinweis | ja|nein | ja | Nein |
| costs[] | PosNr, Kategorie, Betrag, Währung … | s. 05_Kostenpositionen | 1, repair, 1200, EUR | Nein |
| documents[] | Dateiname, Typ, Quelle … | s. 06_Belege | fotos_front.jpg | Nein |
| meta.messageId | messageId | String ≤ 120 | <msg‑1@contoso> | Nein |
| meta.sourceEmail | sourceEmail | E‑Mail‑Format | customer@mail.com | Nein |
| meta.receivedAt | receivedAt | ISO 8601 | 2025‑08‑31T07:55:10Z | Nein |

Agent‑Hinweis: IMMER `excel_describe_sheets` → `excel_read_sheet`. Header per Synonymtabelle mappen; Pflichtfelder prüfen; Verstöße im HTML unter „Validierungen“ nennen.
