const { createM365ToolManifest } = require('./mcp-tool-manifest');
const { createM365ToolHandlers } = require('./mcp-m365-tools');

function ensureObject(value, message) {
  if (!value || typeof value !== 'object') {
    throw new Error(message);
  }
}

function createM365InProcessClient({ dependencies }) {
  ensureObject(dependencies, 'dependencies object is required');
  const manifest = createM365ToolManifest();
  const handlers = createM365ToolHandlers(dependencies);
  const handlerNames = new Set(Object.keys(handlers));

  async function callTool({ name, arguments: args = {} } = {}) {
    if (!handlerNames.has(name)) {
      throw new Error(`unknown MCP tool: ${name}`);
    }
    const handler = handlers[name];
    return handler(args);
  }

  async function listTools() {
    return manifest;
  }

  async function close() {
    // Nothing to dispose yet, but keep signature for symmetry
  }

  return {
    callTool,
    listTools,
    close,
  };
}

module.exports = { createM365InProcessClient };
