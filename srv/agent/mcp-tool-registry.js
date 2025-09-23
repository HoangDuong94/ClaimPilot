const { jsonSchemaToZod } = require('./mcp-jsonschema');

function createInProcessToolDefinitions({ manifest, callTool, z }) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest is required');
  }
  if (!Array.isArray(manifest.tools)) {
    throw new Error('manifest.tools must be an array');
  }
  if (typeof callTool !== 'function') {
    throw new Error('callTool function is required');
  }
  if (!z || typeof z !== 'object') {
    throw new Error('zod export is required');
  }

  return manifest.tools.map((tool) => {
    const inputSchema = tool.inputSchema || { type: 'object', properties: {} };
    const zodSchema = jsonSchemaToZod(inputSchema, z);
    const invoke = async (args) => callTool({ name: tool.name, args });
    return {
      name: tool.name,
      description: tool.description,
      manifest: tool,
      zodSchema,
      metadata: tool.metadata || {},
      invoke,
    };
  });
}

module.exports = { createInProcessToolDefinitions };
