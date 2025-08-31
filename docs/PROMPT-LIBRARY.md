# ClaimPilot – PROMPT LIBRARY – Kfz-Schaden (POC)

Diese Bibliothek enthält getestete Prompts für den Agenten, inklusive erwarteter Tool-Sequenz, benötigter Kontextvariablen und dem HTML‑Ausgabe‑Schema. Sie ist auf das Projekt ClaimPilot abgestimmt: Der Backend‑Agent antwortet als HTML (MarkdownConverter) und das UI rendert im Chat‑Sidepanel.

Allgemeine Konventionen:
- Kontextvariablen: `inboxFolder`, `processedFolder`, `tempDir` sind gesetzt (z. B. „Schaden/Eingang“, „Schaden/Verarbeitet“, `C:/…/tmp`).
- Tool‑Sequenz (M365): IMMER `m365GetCommands` → `m365GetCommandDocs` → `m365RunCommand`.
- Tool‑Sequenz (Excel): IMMER `excel_describe_sheets` → `excel_read_sheet` → Mapping.
- HTML‑Abschnitte: Aktionen, Extrahierte Daten, Nächste Schritte, Referenzen, (optional) Validierungen.

## 1) Ingest: E‑Mail → Excel → HTML

User Prompt (Chat):
> Lies die neueste Schadenmail aus „{inboxFolder}“, lade den Excel‑Anhang, lies das Blatt „Fallübersicht“, extrahiere policyNumber, plate und lossDate, verschiebe die Mail anschließend nach „{processedFolder}“ und gib alles kompakt als HTML aus.

Erwartete Tool‑Sequenz:
1. m365GetCommands (outlook message list) → m365GetCommandDocs → m365RunCommand (`--folder {inboxFolder} --top 5 --output json`)
2. m365GetCommands (message get) → Docs → Run (`--id <messageId> --output json`)
3. m365GetCommands (message attachment list/get) → Docs → Run (download `claim.xlsx` nach `{tempDir}/claim.xlsx`)
4. excel_describe_sheets (`fileAbsolutePath={tempDir}/claim.xlsx`)
5. excel_read_sheet (Sheet „01_Fallübersicht“)
6. Mapping → HTML
7. m365GetCommands (message move) → Docs → Run (`--id <messageId> --destinationFolder {processedFolder}`)

HTML‑Schema (Kurz):
- Aktionen: Mail gelesen, Attachment geladen, Excel gelesen, Mail verschoben
- Extrahierte Daten: policyNumber, plate, lossDate
- Nächste Schritte: Triage vorschlagen
- Referenzen: messageId, attachment name, sheet name

## 2) Kein Anhang: nur Text extrahieren

User Prompt:
> Prüfe die neueste Mail in „{inboxFolder}“. Falls kein Excel‑Anhang vorhanden ist, gib Betreff, Absender, empfangen am aus und nenne fehlende Pflichtfelder. Erzeuge einen Vorschlag für die nächsten Schritte als HTML.

Erwartete Tool‑Sequenz:
1. m365GetCommands (list) → Docs → Run
2. m365GetCommands (get) → Docs → Run
3. m365GetCommands (attachment list) → Docs → Run → keine Excel → HTML mit Minimal‑Extraktion

HTML: Extrahierte Daten (Betreff, from, receivedAt), Validierungen (fehlende Felder), Nächste Schritte (Antwortentwurf, Daten anfordern).

## 3) Mehrere Anhänge: beste Excel wählen

User Prompt:
> Lies die neueste Mail in „{inboxFolder}“. Wenn mehrere Excel‑Anhänge vorhanden sind, wähle die plausibelste (Dateiname enthält „Schaden“ oder größte Datei). Lies das Blatt „01_Fallübersicht“ und gib policyNumber, plate, lossDate als HTML aus.

Sequenz:
1. list → get → attachment list → heuristische Auswahl
2. attachment get → excel describe → excel read → Mapping → HTML

HTML: Aktionen (Auswahlkriterium nennen), Extrahierte Daten, Referenzen (alle Anhänge kurz auflisten).

## 4) Unbekannter Sheetname: Rückfrage oder Auswahl

User Prompt:
> Lade den Excel‑Anhang der neuesten Mail und lies die Fallübersicht. Wenn das Blatt nicht „01_Fallübersicht“ heißt, nutze `excel_describe_sheets` und frage nach, welches Blatt ich lesen soll. Zeige die verfügbaren Blattnamen in HTML.

Sequenz:
1. list → get → attachment list/get → excel describe
2. Kein Match → HTML mit Blattliste und kurzer Rückfrage

## 5) Triage aus JSON (ohne E‑Mail/Excel)

User Prompt:
> Führe eine Triage für diesen Datensatz durch: { policyNumber: "VS‑4711", plate: "M‑AB 1234", lossDate: "2025‑08‑30", description: "Auffahrunfall…" }. Gib Severity (low/medium/high), eine Reserve‑Schätzung und 2–3 nächste Schritte als HTML aus.

Sequenz: Nur reasoning → HTML (keine Tools nötig).

HTML: Aktionen (Logik angewendet), Triage (Severity, Reserve), Nächste Schritte.

## 6) Antwortentwurf (Draft) für fehlende Angaben

User Prompt:
> Erzeuge einen E‑Mail‑Entwurf an „{claimantEmail}“, in dem höflich die fehlenden Felder (plate, lossDate o. Ä.) abgefragt werden. Gib in HTML den Entwurfstitel und die wichtigsten Punkte aus.

Sequenz:
1. m365GetCommands (create draft/send mail) → Docs → Run (Entwurf)

HTML: Aktionen (Draft erstellt), Nächste Schritte (prüfen, versenden), Referenzen (Draft‑ID/Betreff).

## 7) Idempotenzfall (bereits verarbeitet)

User Prompt:
> Prüfe, ob eine Mail mit messageId „<msg‑1@contoso>“ bereits verarbeitet wurde. Wenn ja, fasse die vorhandenen Daten als HTML zusammen, ohne erneut zu verschieben.

Sequenz (optional, mit DB):
1. query (SELECT EXISTS …) → HTML „bereits verarbeitet“

Ohne DB: m365RunCommand (search by subject/date) + Heuristik → HTML „vermutlich verarbeitet“, keine Aktion ausgeführt.

---

Hinweise:
- Immer `--output json` bei `m365RunCommand`, falls der Server dies nicht standardmäßig liefert.
- Bei Excel immer zuerst `excel_describe_sheets`, niemals einen Blattnamen raten.
- HTML kurz, klar strukturiert, Klassen kompatibel zum MarkdownConverter (Listen/Abschnitte reichen aus).
