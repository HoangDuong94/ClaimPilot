Refactor: Legacy‑Bereinigung (ohne Abschnitt B)

Ziel: Entferne echte Altlasten & Redundanzen, säubere Konfigurationen und kleinere Code‑Stellen – ohne funktionale Änderungen am UI/Service.
Ausgeschlossen: Optionale Löschungen aus Abschnitt B (z. B. srv/claim-flat.cds, FLP‑Sandbox, Debug‑Skripte) – diese bleiben unberührt.

Scope (doing)

A) Sicher entfernen

Temporäre/Backup‑Artefakte

tmp_before_patch_backup.txt

tmp_view_service_js.txt

tmp_call.json

Doppelte/überholte FE‑Annotations auf App‑Seite

app/claims/annotations.cds

app/services.cds (zieht nur die obige Datei rein)

Unbenutztes externes Service‑Artefakt

srv/external/gen.edmx

srv/external/gen.csn

plus Konfiguration: package.json ➜ cds.requires.gen entfernen

Unbenutzte Runtime‑Dependencies

@langchain/openai, openai, langchain, voca (werden im Code nicht verwendet)

Doppelte Port/DB‑Konfiguration

.cdsrc.json: Konfig ist in package.json > cds bereits vorhanden.
➜ Migration: Feature‑Flag odata_new_parser in package.json übernehmen, dann .cdsrc.json löschen.

C) Kleine Cleanups

Unbenutzte UI5‑Imports in app/claims/webapp/main.js entfernen (sap/m/Bar, sap/m/Title).

D) Doku‑Drift abfangen (Notiz statt Big Rewrite)

Oben in die betroffenen Dokus einen Hinweis einfügen, dass die Markdown→HTML‑Konvertierung clientseitig in app/claims/webapp/main.js erfolgt (und kein Backend‑Converter existiert).

E) Ausführung/Kommandos

Siehe unten „Schritte & Kommandos“.

F) Regression‑Checkliste

Siehe unten „Akzeptanzkriterien“.

Nicht‑Scope (out)

Abschnitt B (Optionals) wird nicht ausgeführt.
D. h. keine Löschung von srv/claim-flat.cds, app/claims/webapp/test/flpSandbox.html, scripts/test-*.js.

Schritte & Kommandos (idempotent, safe)

Voraussetzungen: Repository sauber, npm i ausgeführt.
Tipp: Nutze separate Commits je Schritt‑Gruppe (Conventional Commit).

1) Dateien löschen (Altlasten & doppelte App‑Annotations)
git rm -f \
  tmp_before_patch_backup.txt \
  tmp_view_service_js.txt \
  tmp_call.json \
  app/services.cds \
  app/claims/annotations.cds \
  srv/external/gen.edmx \
  srv/external/gen.csn

2) package.json bereinigen

Unused deps entfernen: @langchain/openai, openai, langchain, voca

Externes Modell entfernen: Block cds.requires.gen

Feature‑Flag migrieren: cds.features.odata_new_parser = true hinzufügen (Migration aus .cdsrc.json)

Patch (schematisch):

diff --git a/package.json b/package.json
@@
   "dependencies": {
-    "@langchain/openai": "^0.2.7",
-    "openai": "^4.57.0",
-    "langchain": "^0.2.18",
-    "voca": "^1.4.1",
     "@sap-ai-sdk/langchain": "^1.14.0",
     "@sap-cloud-sdk/connectivity": "^3",
     "@sap-cloud-sdk/http-client": "^3",
     "@sap-cloud-sdk/resilience": "^3",
     "@sap/cds": "^8.9.4",
     "dotenv": "^16.6.1",
     "express": "^4.19.2"
   },
@@
   "cds": {
     "odata": {
       "version": "v4"
     },
+    "features": {
+      "odata_new_parser": true
+    },
     "requires": {
       "db": {
         "kind": "sqlite",
         "credentials": {
           "database": "sqlite.db"
         }
-      },
-      "gen": {
-        "kind": "odata",
-        "model": "srv/external/gen"
       }
     },
     "server": {
       "port": 9999
     }
   }


Danach:

npm install
npm prune

3) .cdsrc.json entfernen (nach Migration)

Wir haben features.odata_new_parser in package.json übernommen, Port/DB liegen dort bereits.

git rm -f .cdsrc.json

4) Unbenutzte UI5‑Imports entfernen

Datei: app/claims/webapp/main.js
Import‑Liste & Funktionssignatur anpassen:

-  "sap/m/Bar",
-  "sap/m/Title",
   "sap/m/Panel"
-], function (Component, ComponentContainer, Splitter, SplitterLayoutData, Fragment, JSONModel, App, Page, Bar, Title, Panel) {
+], function (Component, ComponentContainer, Splitter, SplitterLayoutData, Fragment, JSONModel, App, Page, Panel) {


Suche im File nach Bar/Title: keine Referenzen ➜ safe.

5) Doku‑Hinweis (Drift fix)

In diesen Dateien ganz oben einen Hinweis‑Block hinzufügen (ein Satz reicht):

docs/Agent.md

docs/TECH-IMPLEMENTATION-KFZ.md

docs/CODING-EXAMPLES-KFZ.md

docs/README.md

Textvorschlag:

> Hinweis: Die Markdown→HTML‑Konvertierung erfolgt aktuell **clientseitig** in `app/claims/webapp/main.js`.
> Ein Backend‑Markdown‑Converter ist in diesem POC nicht aktiv.


(Optional kann im Root‑README.md zusätzlich „ohne Fiori“ zu „mit Fiori Elements“ präzisiert werden.)

Akzeptanzkriterien (Definition of Done)

Build & Start

npm run watch:hybrid startet ohne Fehler/Warnings zu fehlenden externen Modellen/Destinationen.

Keine cds requires gen‑Warnungen mehr.

UI

List Report lädt die Claims (Spalten & Facets wie zuvor).

Object Page zeigt „E‑Mails“, „Dokumente“, „Aufgaben“ Tabs wie zuvor.

Chat

Streaming über POST /ai/stream funktioniert (UI zeigt „Thinking…“ → ersetzt durch Antwort).

Fallback via OData‑Action callLLM funktioniert (falls Streaming fehlschlägt).

Code Hygiene

app/claims/webapp/main.js enthält keine ungenutzten UI5‑Imports mehr.

npm ls zeigt keine de‑referenzierten Pakete (die vier entfernten sind weg).

Konfiguration

.cdsrc.json ist entfernt, verlegte features.odata_new_parser existiert unter package.json > cds.features.

Port/DB‑Einstellungen sind nur in package.json vorhanden.

Doku

Die vier genannten docs/*.md Dateien enthalten den Hinweis‑Block zum clientseitigen Rendering.

Commit‑Vorschläge (Conventional Commits)

Files/Annotations

chore: remove legacy tmp files and duplicate FE annotations


Package/Config

refactor: drop unused AI deps and external gen model; migrate cds features to package.json


UI Imports

chore(ui): remove unused UI5 imports (Bar, Title) from main.js


Docs

docs: add client-side markdown rendering note to docs

Rollback‑Plan (falls etwas bricht)

Stelle .cdsrc.json wieder her oder füge cds.features.odata_new_parser: true zurück ein (falls vergessen).

Revert des Package‑Patches (Git), dann npm i.

Wiederherstellung gelöschter Files per git checkout <commit> -- <path> (falls versehentlich entfernt).

Hinweise für den Agenten

Idempotenz: Prüfe vor jedem Lösch‑Befehl, ob die Datei existiert; diffs nur anwenden, wenn Keys/Deps vorhanden.

Suche nach Referenzen: Vor dem Löschen der externen gen.* Artefakte global nach srv/external/gen suchen – es gibt keine Laufzeit‑Referenzen außerhalb von package.json.

Kein Abschnitt B: Dateien wie srv/claim-flat.cds, app/claims/webapp/test/flpSandbox.html, scripts/test-*.js bleiben unverändert.

Ende der Anweisung.
Wenn alle Akzeptanzkriterien erfüllt sind, ist die Legacy‑Bereinigung abgeschlossen – ohne Änderung der sichtbaren Funktionalität.