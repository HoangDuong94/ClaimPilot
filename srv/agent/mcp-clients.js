// Minimal MCP client bootstrap: in-process M365 handlers plus optional external clients
// CommonJS file using dynamic ESM imports where needed

const process = require('process');
const { spawnSync } = require('child_process');
const { createM365InProcessClient } = require('./mcp-m365-inprocess');

function expandEnvVars(str, env = process.env) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\$\{([^}]+)\}|\$([A-Za-z0-9_]+)/g, (_match, braced, bare) => {
    const key = (braced || bare || '').trim();
    if (!key) return '';
    const value = env[key];
    return value === undefined ? '' : value;
  });
}

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

function maskUri(uri = '') {
  if (!uri) return undefined;
  try {
    return uri.replace(/\/\/([^:\/@?#]+):([^@\/?#]*)@/, (_m, user) => `//${user}:***@`);
  } catch (_) {
    return uri;
  }
}

async function startMcpClient(name, command, args, env) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({ command, args, env: { ...process.env, ...env } });
  const client = new Client({ name: `mcp-${name}`, version: '0.1.0' }, {});
  await client.connect(transport);
  return { client, transport };
}

function ensureUnrestrictedArgs(args = []) {
  const next = [...args];
  const hasInline = next.some(a => String(a || '').includes('--access-mode=') || String(a || '') === '--access-mode');
  if (!hasInline) {
    next.push('--access-mode=unrestricted');
    return next;
  }

  for (let i = 0; i < next.length; i += 1) {
    const token = String(next[i] || '');
    if (token === '--access-mode' && next[i + 1]) {
      next[i + 1] = 'unrestricted';
      return next;
    }
    if (token.startsWith('--access-mode=')) {
      next[i] = '--access-mode=unrestricted';
      return next;
    }
  }

  next.push('--access-mode=unrestricted');
  return next;
}

async function initAllMCPClients(options = {}) {
  const clients = {};
  const disableDefaults = options.disableDefaults === true;

  const shouldAutoEnableM365 = () => {
    if (options?.m365?.enable !== undefined) return options.m365.enable;
    const flag = process.env.MCP_M365_ENABLE_INPROCESS;
    if (flag && ['1', 'true', 'yes', 'on'].includes(String(flag).toLowerCase())) return true;
    if (process.env.MCP_M365_ACCESS_TOKEN || process.env.GRAPH_ACCESS_TOKEN) return true;
    if (process.env.MCP_M365_CLIENT_ID && process.env.MCP_M365_CLIENT_SECRET && process.env.MCP_M365_TENANT_ID) return true;
    const cliCommand = options?.m365?.cli?.command
      || process.env.MCP_M365_CLI_BIN
      || process.env.M365_CLI_BIN
      || 'm365';
    try {
      const result = spawnSync(cliCommand, ['--version'], { stdio: 'ignore' });
      if (result && result.status === 0) return true;
    } catch (_) { /* CLI not available */ }
    return false;
  };

  if (options?.m365?.dependencies) {
    try {
      clients.m365 = createM365InProcessClient({ dependencies: options.m365.dependencies });
    } catch (e) {
      console.warn('[MCP] Failed to initialise in-process M365 client:', e && e.message ? e.message : String(e));
    }
  } else if (!disableDefaults && shouldAutoEnableM365()) {
    try {
      const { createDefaultM365Dependencies } = require('./mcp-m365-defaults');
      const dependencies = await createDefaultM365Dependencies(options?.m365?.config || {});
      clients.m365 = createM365InProcessClient({ dependencies });
      try {
        console.log('[MCP] In-process M365 client aktiviert');
      } catch (_) {}
    } catch (e) {
      console.warn('[MCP] In-process M365 initialisation failed:', e && e.message ? e.message : String(e));
    }
  }

  if (!disableDefaults) {
    const pgCmd = expandEnvVars(process.env.MCP_POSTGRES_CMD);
    if (pgCmd) {
      try {
        const { command, args } = parseCommandLine(pgCmd);
        if (!command) throw new Error('MCP_POSTGRES_CMD ist leer/ungültig');
        const unrestrictedArgs = ensureUnrestrictedArgs(args);
        const pgEnv = {};
        const uri = process.env.MCP_POSTGRES_URI
          || process.env.MCP_POSTGRES_DATABASE_URI
          || process.env.MCP_POSTGRES_URL
          || process.env.DATABASE_URL
          || process.env.POSTGRES_URL;
        if (uri) {
          pgEnv.DATABASE_URI = uri;
        } else {
          console.warn('[MCP] Postgres DATABASE_URI nicht gesetzt (setze MCP_POSTGRES_URI oder DATABASE_URL)');
        }
        const { client } = await startMcpClient('postgres', command, unrestrictedArgs, pgEnv);
        try {
          console.log('[MCP] Postgres client verbunden', {
            command,
            args: unrestrictedArgs,
            uri: maskUri(uri || pgEnv.DATABASE_URI),
          });
        } catch (_) { }
        clients.postgres = client;
      } catch (e) {
        console.warn('[MCP] Postgres start/connect failed:', e && e.message ? e.message : String(e));
      }
    }
  }

  try {
    console.log('[MCP] Clients bereit', { clients: Object.keys(clients) });
  } catch (_) { }
  return clients;
}

async function closeMCPClients(clients = {}) {
  const all = Object.values(clients);
  await Promise.all(all.map(async (c) => { try { await c.close(); } catch (_) {} }));
}

module.exports = { initAllMCPClients, closeMCPClients };
