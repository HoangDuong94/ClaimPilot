// Minimal MCP client bootstrap: only M365 (stdio) for now
// CommonJS file using dynamic ESM imports where needed

const process = require('process');

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

async function initAllMCPClients() {
  const clients = {};

  // M365 MCP ist vorübergehend deaktiviert.
  // if (process.env.MCP_M365_CMD) {
  //   try {
  //     const { command, args } = parseCommandLine(process.env.MCP_M365_CMD);
  //     if (!command) throw new Error('MCP_M365_CMD ist leer/ungültig');
  //     const { client } = await startMcpClient('m365', command, args, {});
  //     clients.m365 = client;
  //   } catch (e) {
  //     console.warn('[MCP] M365 start/connect failed:', e && e.message ? e.message : String(e));
  //   }
  // }

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
