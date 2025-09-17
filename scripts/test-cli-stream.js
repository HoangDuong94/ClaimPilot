#!/usr/bin/env node
/*
  Smoke-test for the CLI streaming bridge (/ai/cli/stream).
  - Posts a prompt to the CLI endpoint.
  - Aggregates SSE chunks, ensuring Markdown code fences are present.
  - Optional helpers: free port 9999 and launch the CAP server before testing.

  Usage:
    node scripts/test-cli-stream.js --prompt "Get-Date"
    node scripts/test-cli-stream.js --prompt "codex" --spawn-server
    node scripts/test-cli-stream.js --prompt "codex" --kill-port --url http://localhost:9999/ai/cli/stream

  Flags:
    --prompt|-p <text>        Prompt to send (default: "Get-Date")
    --url|-u <url>            Target SSE endpoint (default: env.SSE_URL or http://localhost:9999/ai/cli/stream)
    --spawn-server            Kill listeners on the target port, start `npm run start`, wait, run the test, then stop the server
    --kill-port               Force-kill listeners on the target port before running the test (implied by --spawn-server)
    --no-kill-port            Skip the automatic port cleanup (even when --spawn-server is used)
    --port <number>           Override port detection for the kill helper (default: derived from --url)
    --server-cmd "..."        Command used with --spawn-server (default: "npm run start")
    --server-warmup <ms>      Milliseconds to wait for the server to boot (default: 8000)
*/

const http = require('http');
const https = require('https');
const { spawnSync, spawn } = require('child_process');

function parseArgs(argv) {
  const options = {
    prompt: 'Get-Date',
    url: process.env.SSE_URL || 'http://localhost:9999/ai/cli/stream',
    spawnServer: false,
    killPort: null,
    explicitKillPort: false,
    port: null,
    serverCommand: 'npm run start',
    serverWarmup: 8000,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--prompt' || arg === '-p') && i + 1 < argv.length) {
      options.prompt = argv[++i];
      continue;
    }
    if ((arg === '--url' || arg === '-u') && i + 1 < argv.length) {
      options.url = argv[++i];
      continue;
    }
    if (arg === '--spawn-server') { options.spawnServer = true; continue; }
    if (arg === '--kill-port') { options.killPort = true; options.explicitKillPort = true; continue; }
    if (arg === '--no-kill-port') { options.killPort = false; options.explicitKillPort = true; continue; }
    if (arg === '--port' && i + 1 < argv.length) {
      options.port = Number(argv[++i]);
      continue;
    }
    if (arg === '--server-cmd' && i + 1 < argv.length) {
      options.serverCommand = argv[++i];
      continue;
    }
    if (arg === '--server-warmup' && i + 1 < argv.length) {
      options.serverWarmup = Number(argv[++i]);
      continue;
    }
  }

  let targetUrl;
  try {
    targetUrl = new URL(options.url);
  } catch (err) {
    throw new Error(`Invalid URL: ${options.url}`);
  }
  if (!options.port || Number.isNaN(options.port)) {
    options.port = Number(targetUrl.port) || (targetUrl.protocol === 'https:' ? 443 : 80);
  }
  if (options.killPort === null) {
    options.killPort = options.spawnServer; // default: kill port when we spawn the server
  }
  return options;
}

function killProcessOnPort(port) {
  const killed = new Set();
  const errors = [];
  const portStr = String(port);

  if (process.platform === 'win32') {
    const ps = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-NetTCPConnection -State Listen -LocalPort ${port} | Select-Object -ExpandProperty OwningProcess`], { encoding: 'utf8' });
    let pids = [];
    if (ps.status === 0 && ps.stdout) {
      pids = ps.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }
    if (!pids.length) {
      const netstat = spawnSync('cmd.exe', ['/c', `netstat -ano | findstr :${portStr}`], { encoding: 'utf8' });
      if (netstat.stdout) {
        const lines = netstat.stdout.split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid) pids.push(pid.trim());
        }
      }
    }
    for (const pid of new Set(pids)) {
      if (!pid || pid === String(process.pid)) continue;
      const res = spawnSync('taskkill', ['/PID', pid, '/F'], { encoding: 'utf8' });
      if (res.status === 0) {
        killed.add(pid);
      } else {
        errors.push(`PID ${pid}: ${(res.stderr || res.stdout || 'unknown error').trim()}`);
      }
    }
  } else {
    const lsof = spawnSync('lsof', ['-ti', `:${portStr}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    let pids = [];
    if (lsof.status === 0 && lsof.stdout) {
      pids = lsof.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }
    if (!pids.length) {
      const fuser = spawnSync('fuser', ['-k', `${portStr}/tcp`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (fuser.status === 0 && fuser.stdout) {
        pids = fuser.stdout.split(/\s+/).map(s => s.trim()).filter(Boolean);
      } else if (fuser.stderr) {
        const msg = fuser.stderr.trim();
        if (msg) errors.push(msg);
      }
    }
    for (const pid of new Set(pids)) {
      if (!pid || pid === String(process.pid)) continue;
      try {
        process.kill(Number(pid), 'SIGKILL');
        killed.add(pid);
      } catch (err) {
        errors.push(`PID ${pid}: ${err.message}`);
      }
    }
  }
  return { killed: [...killed], errors };
}

function postSSE(url, body, onEvent) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const lib = isHttps ? https : http;
    const u = new URL(url);
    const data = JSON.stringify(body || {});
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', chunk => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const lines = raw.split(/\n/);
          let event = 'message';
          const dataLines = [];
          for (const line of lines) {
            if (!line) continue;
            if (line.startsWith(':')) continue;
            if (line.startsWith('event:')) { event = line.slice(6).trim(); continue; }
            if (line.startsWith('data:')) {
              let d = line.slice(5);
              if (d.startsWith(' ')) d = d.slice(1);
              dataLines.push(d);
            }
          }
          const dataStr = dataLines.join('\n');
          onEvent && onEvent({ event, data: dataStr });
        }
      });
      res.on('end', resolve);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function startServer(command, warmupMs, cwd = process.cwd()) {
  console.log(`[server] starting: ${command}`);
  const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`));

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, warmupMs);
    child.once('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Server process exited with code ${code}`));
    });
  });
  return { child, ready };
}

function stopServer(child, timeoutMs = 3000) {
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('exit', done);
    child.once('close', done);
    const signal = process.platform === 'win32' ? 'SIGINT' : 'SIGTERM';
    try { child.kill(signal); } catch (_) { done(); return; }
    setTimeout(() => {
      if (settled) return;
      try {
        child.kill('SIGKILL');
      } catch (_) { /* ignore */ }
      done();
    }, timeoutMs);
  });
}

async function run() {
  const opts = parseArgs(process.argv);
  const { prompt, url, port } = opts;

  if (opts.killPort) {
    console.log(`[port ${port}] attempting to terminate listeners...`);
    const result = killProcessOnPort(port);
    if (result.killed.length) {
      console.log(`[port ${port}] terminated PID(s): ${result.killed.join(', ')}`);
    } else {
      console.log(`[port ${port}] no listeners found.`);
    }
    if (result.errors.length) {
      console.warn(`[port ${port}] warnings: ${result.errors.join(' | ')}`);
    }
  } else if (!opts.spawnServer && opts.explicitKillPort) {
    console.log(`[port ${port}] port cleanup disabled via --no-kill-port.`);
  }

  let serverHandle = null;
  if (opts.spawnServer) {
    serverHandle = startServer(opts.serverCommand, opts.serverWarmup);
    try {
      await serverHandle.ready;
      console.log(`[server] warmup (${opts.serverWarmup}ms) finished.`);
    } catch (err) {
      console.error(`[server] failed to start: ${err.message}`);
      await stopServer(serverHandle.child);
      process.exitCode = 1;
      return;
    }
  }

  let raw = '';
  try {
    console.log('CLI stream endpoint:', url);
    console.log('Prompt             :', prompt);
    await postSSE(url, { prompt }, ({ event, data }) => {
      if (event === 'error') {
        console.error('SSE error:', data);
        return;
      }
      if (event === 'end' || data === '[DONE]') {
        return;
      }
      raw += (data === '' ? '\n' : data);
    });
  } catch (err) {
    console.error('\n[FAIL] Request failed:', err.message);
    if (err && err.errors && Array.isArray(err.errors)) {
      for (const sub of err.errors) {
        console.error('  -', sub.message || sub.toString());
      }
    }
    process.exitCode = 1;
    if (serverHandle) await stopServer(serverHandle.child);
    return;
  } finally {
    if (opts.spawnServer && serverHandle) {
      await stopServer(serverHandle.child);
      console.log('[server] stopped.');
    }
    if (opts.spawnServer || opts.killPort) {
      const cleanup = killProcessOnPort(port);
      if (cleanup.killed.length) {
        console.log(`[port ${port}] post-run cleanup terminated PID(s): ${cleanup.killed.join(', ')}`);
      } else {
        console.log(`[port ${port}] post-run cleanup found no listeners.`);
      }
      if (cleanup.errors.length) {
        console.warn(`[port ${port}] cleanup warnings: ${cleanup.errors.join(' | ')}`);
      }
    }
  }

  const normalized = raw.replace(/\r\n/g, '\n');
  const trimmed = normalized.replace(/\s+$/, '');
  const fenceMatch = trimmed.match(/^```([^\n]*)\n([\s\S]*)\n```$/);
  if (!fenceMatch) {
    console.error('\n[FAIL] Missing Markdown code fence in response.');
    console.error('Raw output:\n', normalized);
    process.exitCode = 1;
    return;
  }
  const fenceLang = fenceMatch[1] || '';
  const body = fenceMatch[2];
  const lines = body.split(/\n/).length;
  const hasStderr = /\bstderr\b|\bexception\b|\berror\b/i.test(body);

  console.log('\n--- Result ---');
  console.log(fenceMatch[0]);
  console.log('\n--- Summary ---');
  console.log('Fence language :', fenceLang || '(none)');
  console.log('Body length    :', body.length, 'chars');
  console.log('Lines          :', lines);
  console.log('Contains error?:', hasStderr ? 'yes' : 'no');
  if (!opts.spawnServer) {
    console.log('Duration       : not measured (no server spawn)');
  } else {
    console.log('Duration       : included in overall script execution');
  }
}

run().catch(err => {
  console.error('[FATAL]', err && err.message ? err.message : err);
  process.exitCode = 1;
});
