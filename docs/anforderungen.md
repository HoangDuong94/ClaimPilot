## Ziel

- Chat-Eingaben aus dem bestehenden **UI5-Chatpanel** werden **1:1** an ein **lokales CLI** (PowerShell **oder** lokaler LLM im CLI) übergeben.  
- Die Ausgabe wird **live** per **SSE** zurück in den Chat gestreamt.  
- **`/ai/agent/stream` bleibt unangetastet**, damit du es später wieder nutzen kannst.  
- Für **schöne Darstellung** umrahmen wir die CLI-Ausgabe serverseitig mit Markdown-Codefences (```powershell … ```).

---

## Änderungen am Projekt

### 🔧 Backend
- **`server.js`** → **ändern**  
  - Neue Helferfunktionen für SSE (falls nicht schon vorhanden)  
  - Neue Funktion `streamCli(prompt, res)`  
  - Neuer Endpoint: `POST /ai/cli/stream` (verwendet `streamCli`)  
  - **Nichts** an `/ai/agent/stream` ändern

- **`.env.example`** → **neu/erweitern**  
  - Konfig für Ziel-CLI (PowerShell oder LLM) und Darstellung

### 🎨 Frontend
- **`main.js`** → **kleine Änderung**  
  - In `sendViaStreaming()` die URL von `"/ai/agent/stream"` auf `"/ai/cli/stream"` setzen.  
  - Rest (SSE-Lesen, Rendern) unverändert.

---

## ENV-Konfiguration

> Für den **einfachen PowerShell-Test**:

```env
# Welches CLI soll gestartet werden?
LLM_CMD=powershell.exe
# Wie wird der Prompt übergeben? (hier per Argumenteinsatz in -Command)
LLM_ARGS=-NoLogo -NoProfile -ExecutionPolicy Bypass -Command {PROMPT}
# Übergabemodus: via STDIN oder als Argument
LLM_INPUT_MODE=arg            # 'stdin' | 'arg'
# Optional: Kodierung und hübsche Code-Sprache für die Codefences
LLM_ENCODING=utf8
CLI_FENCE_LANG=powershell     # z.B. 'text', 'bash', 'powershell'
# Optional: Logs
LLM_LOG=1
````

> Später, wenn du stattdessen einen **lokalen CLI-LLM** nutzen willst, änderst du nur:
>
> ```env
> LLM_CMD=C:\tools\codex.exe
> LLM_ARGS=--model my-model --stream --prompt {PROMPT}
> LLM_INPUT_MODE=arg
> CLI_FENCE_LANG=text
> ```

---

## Backend-Implementierung (Snippets)

> **Datei:** `server.js`
> (In deine bestehende Struktur einfügen – `/ai/agent/stream` bitte **nicht** anfassen.)

```js
// --- SSE helpers (falls nicht schon vorhanden) ---
function sseWrite(res, data) {
  if (data == null) return;
  const s = String(data);
  for (const line of s.split(/\r?\n/)) res.write(`data: ${line}\n`);
  res.write('\n');
}
function sseError(res, obj) {
  res.write('event: error\n');
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}
function sseEnd(res) {
  res.write('event: end\n');
  res.write('data: [DONE]\n\n');
  res.end();
}

// --- CLI streaming bridge ---
const { spawn } = require('child_process');

async function streamCli(prompt, res) {
  const cmd = process.env.LLM_CMD;
  if (!cmd) { sseError(res, { message: 'LLM_CMD not set' }); return sseEnd(res); }

  // Split args like a shell (grobe, aber praxistaugliche Variante)
  const rawArgs = (process.env.LLM_ARGS || '').trim();
  const args = rawArgs
    ? (rawArgs.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map(a => a.replace(/^"|"$/g, ''))
    : [];

  const mode = (process.env.LLM_INPUT_MODE || 'stdin').toLowerCase(); // 'stdin' | 'arg'
  let finalArgs = args.slice();
  if (mode === 'arg') {
    const hasPlaceholder = finalArgs.some(a => a.includes('{PROMPT}'));
    if (!hasPlaceholder) {
      sseError(res, { message: 'LLM_INPUT_MODE=arg aber {PROMPT} fehlt in LLM_ARGS' });
      return sseEnd(res);
    }
    finalArgs = finalArgs.map(a => a.replace('{PROMPT}', prompt));
  }

  const encoding = process.env.LLM_ENCODING || 'utf8';
  const fenceLang = process.env.CLI_FENCE_LANG || 'text';

  // Start process
  const child = spawn(cmd, finalArgs, { shell: true, windowsHide: true });

  child.stdout.setEncoding(encoding);
  child.stderr.setEncoding(encoding);

  // Hübsche Darstellung: Codefence öffnen
  sseWrite(res, `\`\`\`${fenceLang}\n`);

  child.stdout.on('data', chunk => sseWrite(res, chunk));
  child.stderr.on('data', chunk => sseWrite(res, chunk));

  child.on('close', code => {
    if (process.env.LLM_LOG === '1') {
      try { console.log('[CLI][exit]', { code }); } catch {}
    }
    // Codefence schließen
    sseWrite(res, `\n\`\`\``);
    sseEnd(res);
  });

  child.on('error', err => {
    sseError(res, { message: String(err && err.message || err) });
    sseEnd(res);
  });

  // Prompt über STDIN einspeisen (falls konfiguriert)
  if (mode === 'stdin') {
    try { child.stdin.write(prompt); child.stdin.end(); } catch {}
  }

  // Client trennt → Prozess beenden
  res.on('close', () => { try { child.kill('SIGKILL'); } catch {} });
}

// --- Route registrieren (innerhalb cds.on('bootstrap', app => { ... })) ---
app.post('/ai/cli/stream', expressJson(), async (req, res) => {
  const prompt = (req.body && req.body.prompt) || '';
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();
  await streamCli(String(prompt || ''), res);
});
```

> **Wichtig:** Lass deinen bestehenden `/ai/agent/stream`-Endpunkt so wie er ist (du hast dort LangGraph/MCP).
> Für diesen PoC ruft das FE einfach `/ai/cli/stream` auf.

---

## Frontend-Anpassung

> **Datei:** `webapp/main.js` (in deinem Repo: `main.js` im Frontend-Root)
> **In `chatManager.sendViaStreaming()` die Ziel-URL ändern:**

```diff
- const url = "/ai/agent/stream";
+ const url = "/ai/cli/stream";
```

Alles andere (SSE lesen, Throttling, `renderMarkdownToHtml`) bleibt unverändert.
Durch die Codefences vom Server wird die Ausgabe als **Monospace-Codeblock** schön gerendert.

---

## Minimaler Testfall (PowerShell)

1. **ENV setzen** (PowerShell):

   ```powershell
   $env:LLM_CMD="powershell.exe"
   $env:LLM_ARGS="-NoLogo -NoProfile -ExecutionPolicy Bypass -Command {PROMPT}"
   $env:LLM_INPUT_MODE="arg"
   $env:CLI_FENCE_LANG="powershell"
   ```

2. **App starten** (wie gewohnt, z. B. `cds watch` oder dein Startscript).

3. **Im Chat eingeben** (einfacher Befehl):

   ```
   Get-Date
   ```

   Erwartung: Live-Output als Codeblock.

4. **Etwas umfangreicher**:

   ```
   Get-Process | Select-Object Name,Id,CPU -First 5 | Format-Table -AutoSize
   ```

   Erwartung: Tabelle erscheint sauber monospaced im Chat-Bubble.

> Hinweis: Mehrzeilige Commands kannst du im Chat in **einer Zeile** mit `;` trennen, z. B.
> `cd $env:USERPROFILE; ls; pwd`

---

## Akzeptanzkriterien

* [ ] Chat sendet **genau** den eingegebenen Text an `/ai/cli/stream`.
* [ ] Backend startet das konfigurierte CLI, streamt **STDOUT/STDERR** via SSE.
* [ ] Ausgabe wird im Chat als **Markdown-Codeblock** formatiert angezeigt.
* [ ] Abbruch des Requests beendet den Kindprozess.
* [ ] `/ai/agent/stream` bleibt funktionsfähig (unverändert).

---

## Optional (später)

* Umschaltbar zwischen CLI-Zielen (PowerShell vs. lokaler CLI-LLM) per UI-Drop-down → setzt intern `CLI_FENCE_LANG`/ENV.
* separate `/ai/cli/run` (non-stream) für kurze Kommandos.
* Wechsel zurück auf `node-pty/xterm.js`, wenn interaktive Sessions gewünscht werden (History/Pfeiltasten).

---

```
```
