const crypto = require('crypto');

async function getLlmClient() {
  const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/langchain');
  const destinationName = process.env.AI_DESTINATION_NAME || 'aicore-destination';
  const modelName = process.env.AI_MODEL_NAME || 'gpt-4.1';
  const temperature = 0.2;
  return new AzureOpenAiChatClient({ modelName, temperature }, { destinationName });
}

function writeSse(res, data) {
  if (!data) return;
  res.write(`data: ${data}\n\n`);
}

function writeSseJson(res, obj) {
  writeSse(res, JSON.stringify(obj));
}

function endSse(res) {
  res.write('event: end\n');
  res.write('data: [DONE]\n\n');
  res.end();
}

function firstKBHash(text, kb = 4) {
  const slice = String(text || '').slice(0, kb * 1024);
  return crypto.createHash('sha256').update(slice).digest('hex').slice(0, 16);
}

// Very simple in-memory memory per threadId
const memory = new Map(); // threadId -> [{role, content}]

function getThreadMessages(threadId) {
  if (!threadId) return [];
  return memory.get(threadId) || [];
}

function setThreadMessages(threadId, msgs) {
  if (!threadId) return;
  memory.set(threadId, msgs);
}

function parseJsonFromText(text) {
  // Try to find first JSON object in text
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

async function planToolStep(llm, userPrompt, threadId) {
  const system = [
    'You are an assistant that can plan one Microsoft 365 CLI action when helpful.',
    'Return JSON only. Choose either a final answer or a single CLI action.',
    'Schema: { "action": "final" | "m365.run", "cli": "m365 <subcommand> [args]", "reason": "short" }',
    'If a CLI call is appropriate, fill "cli" with a complete m365 command. Otherwise use action="final".',
  ].join(' ');

  const contextMsgs = getThreadMessages(threadId);
  const planRes = await llm.invoke([
    ...contextMsgs,
    { role: 'system', content: system },
    { role: 'user', content: String(userPrompt || '') }
  ]);
  const raw = typeof planRes.content === 'string'
    ? planRes.content
    : Array.isArray(planRes.content)
      ? planRes.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
      : '';
  const json = parseJsonFromText(raw);
  if (json && (json.action === 'final' || json.action === 'm365.run')) return json;
  // Fallback: no structured plan
  return { action: 'final' };
}

async function streamFinalAnswer(llm, res, messages) {
  const stream = await llm.stream(messages);
  let full = '';
  for await (const chunk of stream) {
    const piece = typeof chunk.content === 'string'
      ? chunk.content
      : Array.isArray(chunk.content)
        ? chunk.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
        : '';
    if (piece) { full += piece; writeSse(res, piece); }
  }
  return full;
}

async function runAgentStreaming({ prompt, threadId, mode, res, mcp }) { // mode ignored in PoC
  if (!prompt || !String(prompt).trim()) {
    writeSseJson(res, { text: '⚠️ Leerer Prompt', event: 'tool_error', tool: 'input' });
    return endSse(res);
  }

  const llm = await getLlmClient();
  const startTime = Date.now();
  const threadMsgs = getThreadMessages(threadId);

  // 1) Plan
  const plan = await planToolStep(llm, prompt, threadId);

  let toolOutput = '';
  let usedTool = false;
  if (plan.action === 'm365.run' && plan.cli) {
    usedTool = true;
    const cli = String(plan.cli);
    writeSseJson(res, { text: `🔧 running: ${cli}`, event: 'tool_start', tool: 'm365' });
    const t0 = Date.now();
    let runResult;
    try {
      runResult = await mcp.runM365(cli);
    } catch (e) {
      runResult = { ok: false, method: 'unknown', stdout: '', stderr: e && e.message ? e.message : String(e) };
    }
    const dur = Date.now() - t0;
    if (runResult.ok) {
      toolOutput = String(runResult.stdout || '');
      const hash = firstKBHash(toolOutput);
      console.log('[AGENT][tool]', {
        tool: 'm365', method: runResult.method, ok: true, ms: dur, threadId,
        input: cli.slice(0, 200), outputHash: hash
      });
      writeSseJson(res, { text: '✅ done', event: 'tool_end', tool: 'm365' });
    } else {
      const err = runResult.stderr || 'unknown error';
      const hash = firstKBHash(err);
      console.log('[AGENT][tool]', {
        tool: 'm365', method: runResult.method, ok: false, ms: dur, threadId,
        input: cli.slice(0, 200), outputHash: hash
      });
      writeSseJson(res, { text: `⚠️ m365 failed: ${err.slice(0, 160)}`, event: 'tool_error', tool: 'm365' });
    }
  }

  // 2) Final answer (with or without tool context)
  const finalSystem = usedTool
    ? 'You executed an M365 CLI command; summarize and answer the user question using the command result provided in the assistant message.'
    : 'Answer the user question directly.';

  const messages = [
    ...threadMsgs,
    { role: 'system', content: finalSystem },
    { role: 'user', content: String(prompt || '') },
  ];
  if (usedTool) {
    messages.push({ role: 'assistant', content: `Command output:\n${toolOutput}` });
  }

  const finalText = await streamFinalAnswer(llm, res, messages);

  // Update memory
  const newMsgs = [...threadMsgs, { role: 'user', content: String(prompt || '') }];
  // Store the final assistant response in memory (not the raw tool output)
  newMsgs.push({ role: 'assistant', content: String(finalText || '') });
  setThreadMessages(threadId, newMsgs);

  const totalMs = Date.now() - startTime;
  console.log('[AGENT][done]', { threadId, usedTool, ms: totalMs });
  endSse(res);
}

module.exports = {
  runAgentStreaming,
};
