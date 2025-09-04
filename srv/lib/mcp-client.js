// srv/lib/mcp-client.js
// Microsoft 365 MCP Client (stdio) via npx, configurable via env
// Works in CommonJS by using dynamic ESM imports

let m365Client = null;
let m365Transport = null;

async function importMcpClient() {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  return { Client, StdioClientTransport };
}

function getM365SpawnConfig() {
  const command = process.env.M365_MCP_COMMAND || 'npx';
  // Use the package string as provided by user unless overridden
  // Correct default NPM package name for the Microsoft 365 MCP server
  const pkg = process.env.M365_MCP_PACKAGE || '@pnp/cli-microsoft365-mcp-server@latest';
  // Allow passing full args as JSON array via env, otherwise default to ["-y", pkg]
  let args;
  if (process.env.M365_MCP_ARGS) {
    try {
      args = JSON.parse(process.env.M365_MCP_ARGS);
      if (!Array.isArray(args)) throw new Error('M365_MCP_ARGS must be a JSON array');
    } catch (e) {
      throw new Error(`Invalid M365_MCP_ARGS: ${e && e.message ? e.message : String(e)}`);
    }
  } else {
    args = ['-y', pkg];
  }
  return { command, args };
}

async function initM365MCPClient() {
  if (m365Client) return m365Client;
  const { Client, StdioClientTransport } = await importMcpClient();
  const { command, args } = getM365SpawnConfig();

  m365Transport = new StdioClientTransport({
    command,
    args,
    env: { ...process.env }
  });

  const client = new Client({ name: 'm365-mcp-client', version: '1.0.0' }, {});
  await client.connect(m365Transport);
  m365Client = client;
  console.log(`✅ M365 MCP client initialized using: ${command} ${args.join(' ')}`);
  return m365Client;
}

async function ensureClient() {
  if (!m365Client) {
    await initM365MCPClient();
  }
  return m365Client;
}

async function getM365Client() {
  return ensureClient();
}

// Best-effort tool listing using SDK client. API may vary by version.
async function listM365Tools() {
  const client = await ensureClient();
  try {
    if (typeof client.listTools === 'function') {
      const res = await client.listTools();
      return res?.tools || res || [];
    }
    if (client.tools && typeof client.tools.list === 'function') {
      return await client.tools.list();
    }
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
  return [];
}

// Best-effort tool execution. Falls back if exact API differs.
async function runM365Tool(name, args) {
  const client = await ensureClient();
  if (!name) throw new Error('tool name is required');
  const parameters = args && typeof args === 'object' ? args : {};
  try {
    if (typeof client.callTool === 'function') {
      const res = await client.callTool({ name, arguments: parameters });
      return res;
    }
    if (client.tools && typeof client.tools.call === 'function') {
      return await client.tools.call(name, parameters);
    }
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
  throw new Error('MCP client does not expose a supported call method');
}

async function closeM365MCPClient() {
  const closeOps = [];
  try {
    if (m365Client && typeof m365Client.close === 'function') {
      closeOps.push(m365Client.close());
    }
  } catch (_) {}
  m365Client = null;
  m365Transport = null;
  await Promise.all(closeOps);
  console.log('✅ M365 MCP client closed');
}

module.exports = {
  initM365MCPClient,
  listM365Tools,
  runM365Tool,
  closeM365MCPClient,
  getM365Client
};
