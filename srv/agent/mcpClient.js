// Lightweight MCP client wrapper for the Microsoft 365 CLI MCP server (PoC)
// - Prefers MCP over direct CLI
// - If MCP is unavailable, falls back to calling `m365` CLI directly
// - Exposes a simple run(commandLine) API returning { ok, stdout, stderr }

const { spawn } = require('child_process');

let clientSingleton = null;
let clientState = {
  healthy: false,
  lastError: null,
  transport: null,
  client: null,
};

async function tryImportMcpSdk() {
  try {
    const clientMod = await import('@modelcontextprotocol/sdk/client');
    const stdioMod = await import('@modelcontextprotocol/sdk/client/stdio');
    return { ...clientMod, ...stdioMod };
  } catch (e) {
    return null; // SDK not available; we'll use CLI fallback
  }
}

function parseCommandLine(cmd) {
  // Simple parser to split a command line into command + args while preserving quoted segments
  // Handles double quotes and single quotes; no escape processing for PoC
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      if (ch === quote) { quote = null; }
      else { current += ch; }
    } else {
      if (ch === '"' || ch === '\'') { quote = ch; }
      else if (ch === ' ') {
        if (current) { tokens.push(current); current = ''; }
      } else { current += ch; }
    }
  }
  if (current) tokens.push(current);
  const command = tokens.shift();
  return { command, args: tokens };
}

async function connectM365Mcp() {
  if (clientSingleton) return clientSingleton;

  const sdk = await tryImportMcpSdk();
  if (!sdk) {
    clientSingleton = {
      tools: [],
      runM365: runM365ViaCli,
      disconnect: async () => {},
      isHealthy: () => false,
    };
    return clientSingleton;
  }

  const { Client, StdioClientTransport } = sdk;

  // Build stdio transport only if explicitly configured; otherwise assume unavailable
  const startCmd = process.env.MCP_M365_START_CMD; // e.g. "npx m365-mcp-server"
  if (!startCmd) {
    clientSingleton = {
      tools: [],
      runM365: runM365ViaCli,
      disconnect: async () => {},
      isHealthy: () => false,
    };
    return clientSingleton;
  }

  const { command, args } = parseCommandLine(startCmd);
  if (!command) {
    clientSingleton = {
      tools: [],
      runM365: runM365ViaCli,
      disconnect: async () => {},
      isHealthy: () => false,
    };
    return clientSingleton;
  }

  const transport = new StdioClientTransport({ command, args, stderr: 'inherit' });
  const client = new Client({
    name: 'claimpilot-cap-agent',
    version: '0.1.0'
  }, { capabilities: {} });

  await client.connect(transport);
  clientState.healthy = true;
  clientState.client = client;
  clientState.transport = transport;

  // Build a generic runner that uses a single tool entry point if available, otherwise pass through
  async function runM365ViaMcp(commandLine) {
    try {
      // Discover tools and prefer a tool that indicates generic CLI passthrough
      const tools = await client.listTools();
      const all = tools.tools || [];
      // Heuristic picks a generic m365 tool if present
      const preferred = all.find(t => /m365|cli/i.test(t.name)) || all[0];
      if (!preferred) throw new Error('No MCP tools available');
      const result = await client.callTool({
        name: preferred.name,
        arguments: { command: String(commandLine) }
      });
      const outputs = (result && (result.structuredContent || result.content)) || [];
      const text = outputs.map(o => o.text || '').join('\n');
      return { ok: true, method: 'mcp', stdout: text, stderr: '' };
    } catch (e) {
      clientState.lastError = e;
      return { ok: false, method: 'mcp', stdout: '', stderr: e && e.message ? e.message : String(e) };
    }
  }

  // Expose singleton
  clientSingleton = {
    tools: [],
    runM365: runM365ViaMcp,
    disconnect: async () => { try { await transport.close(); } catch (_) {}; clientState.healthy = false; },
    isHealthy: () => !!clientState.healthy,
  };

  // Basic health check timer
  const interval = Number(process.env.MCP_M365_HEALTH_INTERVAL_MS || 30000);
  setInterval(async () => {
    try {
      if (!clientState.client) return;
      await clientState.client.ping();
      clientState.healthy = true;
    } catch (e) {
      clientState.healthy = false;
      clientState.lastError = e;
    }
  }, Math.max(5000, interval)).unref();

  return clientSingleton;
}

function runM365ViaCli(commandLine) {
  return new Promise((resolve) => {
    const child = spawn(commandLine, { shell: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += String(d); });
    child.stderr.on('data', d => { stderr += String(d); });
    child.on('error', (e) => {
      resolve({ ok: false, method: 'cli', stdout, stderr: e && e.message ? e.message : String(e) });
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, method: 'cli', stdout, stderr });
      else resolve({ ok: false, method: 'cli', stdout, stderr: stderr || `Exit code ${code}` });
    });
  });
}

module.exports = {
  connectM365Mcp,
};
