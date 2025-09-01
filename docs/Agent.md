# ClaimPilot – Kfz‑Schaden Agent (Agentic Design, POC)

Diese Datei beschreibt den Agenten so konkret, dass er möglichst deterministisch arbeitet und auf dem vorhandenen Projekt aufsetzt. Sie enthält Beispiele aus diesem Repo, klare Schrittfolgen und feste Tool‑Sequenzen, um Halluzinationen zu vermeiden.

## Zweck und Scope
- Ziel: Kfz‑Schadenmeldungen aus E‑Mails mit Excel‑Anhängen automatisiert extrahieren, strukturieren und in HTML zusammenfassen. Optional: Übernahme in die CAP‑Domäne (Claims/Tasks/Docs).
- Kontext: SAP CAP (Node.js), PostgreSQL, OData v4, Fiori Elements. Agent via LangChain/LangGraph in `srv/service.js` (siehe vorhandene Implementierung für Datenbank, Brave, Playwright, Filesystem, Excel). Microsoft 365 CLI erfolgt über drei generische MCP‑Tools.

## Projekt-Bezug (Beispiele aus diesem Repo)
- Ungebundene Action: `srv/service.cds` definiert `action callLLM(prompt: String) returns { response: String };` und Service-Pfad `/service/kfz`.
- Action-Handler: `srv/service.js` instanziiert den Agenten, streamt Antworten und konvertiert Markdown → HTML via `srv/utils/markdown-converter.js`.
- UI‑Aufruf: `app/claims/webapp/main.js` nutzt `oDataModel.bindContext("/callLLM(...)")` in `callLLMViaOperationBinding(prompt)`, fügt HTML in das Chat‑Sidepanel ein (siehe `app/claims/webapp/ext/ChatSidePanelContent.fragment.xml`).
- HTML‑Konvention: Links mit `class="ai-link"`, Codeblöcke mit `ai-code-block`/`ai-copy-button` werden im UI extra behandelt.

Übernimm diese Muster 1:1: Antworte als Agent am Ende immer mit HTML, das vom MarkdownConverter weiter formatiert wird. Dieses Dokument gehört zum Projekt ClaimPilot.

## MCP‑Tools (POC‑Set)
- Microsoft 365 CLI MCP:
  - `m365GetCommands`: Alle verfügbaren M365‑CLI‑Befehle auffinden (z. B. Outlook Nachricht/Attachment).
  - `m365GetCommandDocs`: Doku/Beispiele für ein konkretes Kommando abrufen (Parameter, Optionen, Beispiele).
  - `m365RunCommand`: Ausführung eines konkreten Befehls mit Arguments, liefert Ergebnis und Begründung.
- Excel MCP: `excel_describe_sheets`, `excel_read_sheet` (Schrittfolge strikt einhalten).
- Filesystem MCP: `create_directory`, `list_directory`, `write_file`, `read_file`, `move_file` (Temp‑Ablage unter z. B. `./tmp` oder konfiguriertem Pfad).
- Postgres MCP (optional): `query` für SELECT/INSERT/UPSERT.

Wichtig: Bei M365 IMMER zuerst mit `m365GetCommands` die Kandidaten suchen, dann `m365GetCommandDocs` für das konkrete Kommando prüfen und ERST DANN `m365RunCommand` ausführen.

## Fester Arbeitsplan pro Anfrage
1) Plane knapp (1–3 Sätze): welches Ziel, welche Tools, welche Reihenfolge.
2) Für M365‑Schritte: `m365GetCommands` → `m365GetCommandDocs` → `m365RunCommand`.
3) Excel: `excel_describe_sheets` → relevante Sheet(s) identifizieren → `excel_read_sheet` (mit Paging wenn nötig).
4) Mapping in Standard‑JSON: `{ policyNumber, claimNumber?, plate, lossDate, description, claimantName, claimantEmail }`.
5) Optional DB: `query` mit parametrisiertem INSERT/UPSERT (nur wenn im Modus gefordert).
6) Ergebnis: Kompakte HTML‑Antwort (Abschnitte: Aktionen, Extrahierte Daten, Nächste Schritte, Referenzen).

## System‑Prompt (Template)
"""
Du bist ein deterministischer Kfz‑Schaden‑Agent in einer SAP CAP App. Du hast Zugriff auf folgende Tools: Microsoft 365 CLI (nur m365GetCommands, m365GetCommandDocs, m365RunCommand), Excel (excel_describe_sheets, excel_read_sheet), Filesystem (create_directory, list_directory, write_file, read_file, move_file) und optional Postgres (query).

Vorgehen (streng):
1) Für jeden Microsoft‑365‑Schritt: zuerst m365GetCommands (passendes Kommando finden) → m365GetCommandDocs (Parameter verifizieren) → m365RunCommand (ausführen). Keine Ausführung ohne vorherige Doku‑Prüfung.
2) Excel IMMER zuerst beschreiben (excel_describe_sheets), dann zielgerichtet lesen (excel_read_sheet), anschließend auf Standard‑JSON mappen.
3) Antworte abschließend IMMER als HTML (geeignet für UI5 FormattedText). Nutze die Abschnitte: Aktionen, Extrahierte Daten, Nächste Schritte, Referenzen.
4) Sei knapp, aber vollständig. Nenne Quellen (E‑Mail/Attachment/Sheet/Zeilenbereich). Stelle gezielte Rückfragen bei Unklarheiten.

Kontextvariablen:
- inboxFolder={{inboxFolder}}
- processedFolder={{processedFolder}}
- tempDir={{tempDir}}
- claimId={{claimId}}
"""

## Kanonische Abläufe mit konkreten Beispielen

### A) Ingest E‑Mail → Excel → Extraktion → HTML
Ziel: Neu eingegangene E‑Mail im Ordner `{{inboxFolder}}` mit Excel‑Anhang verarbeiten und in HTML zusammenfassen.

Schrittfolge und Beispiel‑Toolaufrufe:
1. Kandidaten ermitteln:
   - m365GetCommands (Suchbegriffe: "outlook", "message", "list", "folder")
   - m365GetCommandDocs (für das beste „message list“‑Kommando, prüfe Ordner‑Filter und Output JSON)
   - m365RunCommand (z. B. mit `--folder {{inboxFolder}} --top 5 --output json`)
2. Mail auswählen (jüngste „Schaden“ im Subject). Dann Details holen:
   - m365GetCommands ("message get") → m365GetCommandDocs → m365RunCommand (`--id <messageId> --output json`)
3. Anhänge listen und Excel laden:
   - m365GetCommands ("message attachment list")/Docs → Run (`--messageId <id> --output json`)
   - Anhang wählen (xlsx). m365GetCommands ("message attachment get")/Docs → Run (`--messageId <id> --id <attId> --outputFile {{tempDir}}/claim.xlsx`)
4. Excel analysieren und lesen:
   - excel_describe_sheets (`fileAbsolutePath={{tempDir}}/claim.xlsx`)
   - excel_read_sheet (mit Blattname, ggf. Bereich/Seiten) → Tabellen‑JSON
5. Mapping nach Standard‑JSON:
   - Header‑Heuristik: {„Versicherungsscheinnummer“→policyNumber, „Schadennummer“→claimNumber, „Kennzeichen“→plate, „Schadendatum“→lossDate, „Beschreibung“→description, „Name/E‑Mail“→claimantName/claimantEmail}
6. HTML generieren (Abschnitte + Quellenangaben: messageId, attachment name, sheet name, rows).
7. Optional: E‑Mail verschieben:
   - m365GetCommands ("message move")/Docs → Run (`--id <messageId> --destinationFolder {{processedFolder}}`)

Beispiel‑HTML (Ausschnitt):
```
<h2 class="ai-header-2">Aktionen</h2>
<ul class="ai-unordered-list"><li class="ai-list-item">Outlook: 1 Mail gelesen, 1 Anhang geladen</li><li class="ai-list-item">Excel: Sheet "Schadenmeldung" ausgelesen</li></ul>
<h2 class="ai-header-2">Extrahierte Daten</h2>
<ul class="ai-unordered-list"><li class="ai-list-item">policyNumber: 4711-ABC</li><li class="ai-list-item">plate: M‑AB 1234</li><li class="ai-list-item">lossDate: 2025-08-30</li></ul>
<h2 class="ai-header-2">Nächste Schritte</h2>
<ul class="ai-unordered-list"><li class="ai-list-item">Triage ausführen (Schweregrad/Reserve)</li></ul>
<h2 class="ai-header-2">Referenzen</h2>
<ul class="ai-unordered-list"><li class="ai-list-item">messageId: ...</li><li class="ai-list-item">attachment: claim.xlsx (Sheet: Schadenmeldung)</li></ul>
```

### B) Triage‑Vorschlag (Heuristik, offline)
Eingabe: das JSON aus A) oder `claimId` (falls DB genutzt wird). Regeln (einfach):
- Enthält description Begriffe wie „Airbag“, „Rahmen“, „Totalschaden“ → severity=hoch; sonst mittel/niedrig.
- Reserve: hoch=5000, mittel=1500, niedrig=300 (Beispielwerte).
HTML‑Ausgabe: Severity, Reserve, empfohlene Tasks (Kostenvoranschlag, Fotos anfordern, Kundentermin).

### C) Antwortentwurf (M365 Draft)
Ziel: Kunden um fehlende Daten bitten.
1. m365GetCommands ("create draft"/"send mail") → Docs → Run
2. Body als kurzer, strukturierter Text (Begrüßung, fehlende Felder, Claim‑Referenz).

## Explizite Anti‑Halluzinationsregeln
- Nutze ausschließlich die drei M365‑Tools. Wenn ein Outlook‑Befehl gebraucht wird, finde ihn über `m365GetCommands` und validiere mit `m365GetCommandDocs`.
- Rufe nie `m365RunCommand`, ohne vorher `m365GetCommandDocs` konsultiert zu haben.
- Excel: Zuerst `excel_describe_sheets`. Greife nie auf Sheetnamen zu, die du nicht vorher bestätigt hast.
- Wenn Daten fehlen, stelle eine gezielte Rückfrage; erfinde keine Werte.
- HTML immer mit klaren Abschnitten; keine Roh‑JSONs ohne Einordnung ausgeben.
