# Chat-Streaming – Testanleitung

Diese Anleitung beschreibt, wie du den AI-Streaming‑Endpoint sowie die Darstellung in der Chat‑UI testest. Alle Schritte enthalten die konkreten Befehle, damit du das Verhalten reproduzieren kannst.

## Voraussetzungen

- Node.js 18+ (getestet mit v22)
- npm
- @sap/cds (wird über `npm run` genutzt)
- Repository installiert (`npm install` bereits ausgeführt)

Optional, falls du lokal mit Destination/GenAI arbeitest:
- Gültige Destination/Bindings (BTP) und lokale `.env`/Bindings für Hybrid‑Profil

## 1) Server starten (Hybrid)

- Port ist in `package.json` unter `cds.server.port` auf `9999` gesetzt.

```bash
npm run watch:hybrid
```

Warte, bis der Server lauscht (Port 9999). In einem zweiten Terminal kannst du die Tests ausführen.

## 2) Streaming‑Endpoint mit Skript testen

Skript: `scripts/test-chat.js`

- Standard: POST auf `http://localhost:9999/ai/stream` mit JSON‐Body `{ prompt }`
- Liest Server‑Sent Events (SSE), aggregiert Text und zeigt eine Kurz‑Zusammenfassung

Beispielaufrufe:

```bash
# Standard (nutzt Default‑URL)
node scripts/test-chat.js --prompt "Nenne mir 5 Punkte über BTS"

# Alternativ: URL per Umgebungsvariable (Linux/macOS)
SSE_URL=http://localhost:9999/ai/stream node scripts/test-chat.js -p "Liste die wichtigsten Punkte zu Animes in Stichpunkten"

# Alternativ: URL per Umgebungsvariable (Windows PowerShell)
$env:SSE_URL='http://localhost:9999/ai/stream'; node scripts/test-chat.js -p "Liste die wichtigsten Punkte zu Animes in Stichpunkten"
```

Hinweise:
- Abschluss‑Event: Server sendet `event: end` und `data: [DONE]`.
- Fehler‑Event: `event: error` mit `data: {"message":"..."}`.
- Der Client interpretiert leere `data:`‑Events als Zeilenumbruch.

## 3) Heuristik‑Test für Bullets (reine Normalisierung)

Skript: `scripts/test-bullet-heuristic.js`

Dieses Skript simuliert „zusammengeklebte“ Bullet‑Chunks (z. B. `- …- …`) und zeigt, wie die Streaming‑Heuristik Newlines einfügt, ohne Markdown‑Fettschrift zu zerstören.

```bash
node scripts/test-bullet-heuristic.js
```

Erwartung: Jede Bullet‑Zeile wird auf eine eigene Zeile normalisiert (mit `- ` und nummerierten `1. `).

## 4) Renderer‑Test (Markdown/HTML ohne Server)

Skript: `scripts/test-render.js`

Dieser Test führt den gleichen Lightweight‑Renderer aus, der auch in der UI verwendet wird (`app/claims/webapp/main.js`). Er zeigt, wie Text in klickbare Links, fett/kursiv, Code und lesbare Bullet/Nummern‑Zeilen umgewandelt wird.

```bash
# Ohne Argument nutzt das Skript ein BTS‑Beispiel mit "1. ... 2. ..."
node scripts/test-render.js

# Optional: Eigener Text
node scripts/test-render.js "Natürlich! Hier sind fünf Punkte über BTS:1. **Wer sie sind:** ... 2. **Mitglieder:** ... 3. ... 4. ... 5. ..."
```

Erwartung: Ausgabe enthält `<span class="cp-li cp-li-num">1. ...</span>` pro Nummern‑Zeile sowie `<b>…</b>` für `**fett**`. URLs werden klickbar (`<a href=...>`).

## 5) End‑to‑End in der UI (Browser)

1. Server läuft (`npm run watch:hybrid`).
2. Browser öffnen (UI5 App startet automatisch, wenn so konfiguriert; ansonsten `http://localhost:9999`).
3. Hart neu laden (Cache umgehen), z. B. Strg+F5.
4. Im Chat rechts Prompt eingeben:
   - „Nenne mir 5 Punkte über BTS“
   - „Liste die wichtigsten Punkte zu Animes in Stichpunkten“
5. Erwartung in der Chat‑Bubble:
   - Nummerierte Punkte „1. … 2. …“ stehen auf separaten Zeilen und sind als Blöcke (`cp-li cp-li-num`) gerendert.
   - `- `‑Bullets erscheinen als „• …“‑Zeilen (`cp-li`).
   - `**fett**` wird fett, `_kursiv_` wird kursiv, simple `http(s)://…` werden klickbar.
   - Doppelte Newlines erzeugen zusätzlichen Abstand.

## 6) Was wurde dafür geändert (Kurzüberblick)

- Streaming‑Heuristik (Client): Newlines vor Bullets/Nummern während des Streamings.
- Renderer (Client, `app/claims/webapp/main.js`):
  - Linkify, `**fett**`, `_kursiv_`, Code (inline/blocks)
  - Bullet/Nummer‑Zeilen als `<span class="cp-li …">…</span>`
  - Absatzabstand via `<br/>` und `<br/><br/>`
- Styles (Client, `app/claims/webapp/index.html`):
  - `.cp-li`, `.cp-li-num`, Links, H4–H6, `<hr>`

## 7) Troubleshooting

- `ECONNREFUSED`: Server läuft nicht oder falscher Port. Prüfe `npm run watch:hybrid` und Port `9999`.
- `ECONNRESET` / Timeout: Instabiler Endpoint oder Proxy/Netzwerk. Erneut versuchen; Logs prüfen (`server.log`).
- „Failed to fetch the list of deployments.“: GenAI/Destination‑Konfiguration fehlt/fehlerhaft (BTP Destination `aicore-destination` bzw. `AI_DESTINATION_NAME`, lokale Bindings). Hybrid‑Setup/Service‑Key prüfen.
- UI zeigt alte Assets: Browser Cache leeren/Strg+F5.

## 8) Nützliche npm‑Skripte

```bash
npm run watch:hybrid   # Startet CAP im Hybrid‑Profil auf Port 9999
npm run test:chat      # Alias für: node scripts/test-chat.js
npm run test:chat:raw  # Rohes SSE‑Debugging (falls vorhanden)
```

---

Mit diesen Schritten kannst du sowohl den Streaming‑Endpoint als auch die Darstellung in der Chat‑UI nachvollziehbar testen. Wenn weitere Formatierungen (z. B. Zitate, Tabellen) gewünscht sind, bitte kurz spezifizieren – ich ergänze die Renderer‑Regeln entsprechend.

