// PoC stub: no LangGraph used; single-step planner + executor lives in sseBridge.
// This file is intentionally minimal to match the documented structure.

async function createAgent(/* deps */) {
  // In this PoC we do not construct a LangGraph agent. Return a minimal shim.
  return {
    async run(/* input */) {
      throw new Error('Not implemented in PoC: use runAgentStreaming in sseBridge');
    }
  };
}

module.exports = { createAgent };

