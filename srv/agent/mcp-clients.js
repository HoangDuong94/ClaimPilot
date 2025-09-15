// Minimal MCP client bootstrap: only M365 (stdio) for now
// CommonJS file using dynamic ESM imports where needed

const process = require('process');

function parseCommandLine(cmd) {
  const tokens = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) {
      if (ch === q) q = null; else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
    } else if (ch === ' ') {
      if (cur) { tokens.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  const command = tokens.shift();
  return { command, args: tokens };
}

async function startMcpClient(name, command, args, env) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({ command, args, env: { ...process.env, ...env } });
  const client = new Client({ name: `mcp-${name}`, version: '0.1.0' }, {});
  await client.connect(transport);
  return { client, transport };
}

async function initAllMCPClients() {
  const clients = {};

  // Only enable M365 MCP via env: MCP_M365_CMD e.g. "npx m365-mcp-server"
  if (process.env.MCP_M365_CMD) {
    try {
      const { command, args } = parseCommandLine(process.env.MCP_M365_CMD);
      if (!command) throw new Error('MCP_M365_CMD ist leer/ungültig');
      const { client } = await startMcpClient('m365', command, args, {});
      clients.m365 = client;
    } catch (e) {
      console.warn('[MCP] M365 start/connect failed:', e && e.message ? e.message : String(e));
    }
  }

  return clients;
}

async function closeMCPClients(clients = {}) {
  const all = Object.values(clients);
  await Promise.all(all.map(async (c) => { try { await c.close(); } catch (_) {} }));
}

module.exports = { initAllMCPClients, closeMCPClients };
