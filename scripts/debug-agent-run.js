#!/usr/bin/env node
/**
 * Quick harness to execute the CAP MCP agent with a fixed prompt and capture
 * every SSE chunk that LangGraph emits. This mirrors the UI behaviour so we
 * can analyse token usage and prompt evolution without the Fiori shell.
 *
 * Usage with service bindings:
 *   cds bind destination/aicore --exec "node scripts/debug-agent-run.js --auto-continue"
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Ensure verbose agent logging unless the caller already tweaked it
process.env.AGENT_TRACE = process.env.AGENT_TRACE || '1';
process.env.AGENT_LOG_STEPS = process.env.AGENT_LOG_STEPS || '1';
process.env.AGENT_LOG_OUTPUT = process.env.AGENT_LOG_OUTPUT || '1';
process.env.AGENT_SSE_SPLIT = process.env.AGENT_SSE_SPLIT || '0';

const DEFAULT_PROMPT = 'Bitte plane zuerst, wie du die neueste Mail aus meinem Posteingang mit dem CLI abrufst.';
const DEFAULT_FOLLOW_UP = 'Ja, bitte führe den Plan jetzt aus.';

function parseArgs(argv) {
  const threadSeed = Math.random().toString(36).slice(2, 10);
  const opts = { prompt: DEFAULT_PROMPT, threadId: `debug-${Date.now().toString(36)}-${threadSeed}`, followUp: null };
  const rest = [];
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--prompt' && argv[i + 1]) { opts.prompt = argv[++i]; continue; }
    if (arg === '--thread' && argv[i + 1]) { opts.threadId = argv[++i]; continue; }
    if (arg === '--follow-up' && argv[i + 1]) { opts.followUp = argv[++i]; continue; }
    if (arg === '--auto-continue') { opts.followUp = opts.followUp || DEFAULT_FOLLOW_UP; continue; }
    if (arg === '--out' && argv[i + 1]) { opts.outFile = argv[++i]; continue; }
    rest.push(arg);
  }
  const filtered = rest.filter((item) => !/^destination\//i.test(item));
  if (filtered.length) opts.prompt = filtered.join(' ');
  return opts;
}

class SseRecorderResponse {
  constructor() {
    this.statusCode = 200;
    this.headers = {};
    this._buffer = '';
    this.events = [];
  }
  setHeader(name, value) { this.headers[name] = value; }
  getHeader(name) { return this.headers[name]; }
  flushHeaders() {}
  write(chunk) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    process.stdout.write(text);
    this._buffer += text;
    this._drainBlocks();
  }
  _drainBlocks() {
    while (true) {
      const idx = this._buffer.indexOf('\n\n');
      if (idx < 0) break;
      const block = this._buffer.slice(0, idx);
      this._buffer = this._buffer.slice(idx + 2);
      const event = { raw: block };
      for (const line of block.split(/\n/)) {
        if (line.startsWith('event:')) {
          event.event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const data = line.slice(5).trimStart();
          event.data = event.data ? `${event.data}\n${data}` : data;
        }
      }
      this.events.push(event);
    }
  }
  end() {
    if (this._buffer) {
      this.events.push({ raw: this._buffer });
      this._buffer = '';
    }
  }
}

async function runOnce({ prompt, threadId }) {
  const { runAgentStreaming } = require('../srv/agent');
  const res = new SseRecorderResponse();
  const startedAt = Date.now();
  try {
    await runAgentStreaming({ prompt, threadId, res });
  } finally {
    res.end();
  }
  return {
    startedAt,
    durationMs: Date.now() - startedAt,
    prompt,
    events: res.events,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const sessions = [];
  try {
    sessions.push(await runOnce({ prompt: opts.prompt, threadId: opts.threadId }));
    if (opts.followUp) {
      // small delay to keep logs separate
      await new Promise((resolve) => setTimeout(resolve, 200));
      sessions.push(await runOnce({ prompt: opts.followUp, threadId: opts.threadId }));
    }
  } catch (err) {
    console.error('[debug-agent-run] Agent failed', err);
    throw err;
  }

  const outDir = path.join(__dirname, '..', 'tmp');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outFile = opts.outFile
    ? path.resolve(opts.outFile)
    : path.join(outDir, `agent-debug-${Date.now()}.json`);
  const payload = {
    startedAt: new Date(sessions[0].startedAt).toISOString(),
    threadId: opts.threadId,
    runs: sessions.map((s) => ({
      startedAt: new Date(s.startedAt).toISOString(),
      durationMs: s.durationMs,
      prompt: s.prompt,
      events: s.events,
    })),
  };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n[debug-agent-run] Trace written to ${outFile}`);
  return outFile;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[debug-agent-run] Unhandled error', err);
    process.exit(1);
  });
