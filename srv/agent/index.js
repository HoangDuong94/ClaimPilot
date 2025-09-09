const { connectM365Mcp } = require('./mcpClient');
const { runAgentStreaming: runStreaming } = require('./sseBridge');

async function runAgentStreaming({ prompt, threadId, mode, res }) {
  const mcp = await connectM365Mcp();
  // mode ignored in PoC; mcp provides runM365()
  return runStreaming({ prompt, threadId, mode, res, mcp });
}

module.exports = {
  runAgentStreaming,
};

