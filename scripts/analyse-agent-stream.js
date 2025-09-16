#!/usr/bin/env node
/**
 * Analyse the LangGraph agent stream exactly like the Fiori chat UI.
 * Records SSE events, rebuilds the accumulated text and renders HTML using
 * the same Markdown heuristics as the frontend so formatting tweaks can be
 * regression-tested offline.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DEFAULT_PROMPT = 'Bitte plane zuerst, wie du die neueste Mail aus meinem Posteingang mit dem CLI abrufst.';
const DEFAULT_FOLLOW_UP = 'Ja, bitte führe den Plan jetzt aus.';

function parseArgs(argv) {
  const threadSeed = Math.random().toString(36).slice(2, 10);
  const opts = {
    prompt: DEFAULT_PROMPT,
    followUp: null,
    threadId: `debug-${Date.now().toString(36)}-${threadSeed}`,
    outFile: null,
    snapshotFile: null,
    compare: null,
  };
  const rest = [];
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--compare' && argv[i + 2]) {
      opts.compare = { before: argv[i + 1], after: argv[i + 2] };
      i += 2;
      continue;
    }
    if (arg === '--prompt' && argv[i + 1]) { opts.prompt = argv[++i]; continue; }
    if (arg === '--follow-up' && argv[i + 1]) { opts.followUp = argv[++i]; continue; }
    if (arg === '--auto-continue') { opts.followUp = opts.followUp || DEFAULT_FOLLOW_UP; continue; }
    if (arg === '--thread' && argv[i + 1]) { opts.threadId = argv[++i]; continue; }
    if (arg === '--out' && argv[i + 1]) { opts.outFile = argv[++i]; continue; }
    if (arg === '--snapshot' && argv[i + 1]) { opts.snapshotFile = argv[++i]; continue; }
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

function parseDataPayload(raw = '') {
  const lines = String(raw || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    let data = line.slice(5);
    if (data.startsWith(' ')) data = data.slice(1);
    out.push(data);
  }
  return out.join('\n');
}

function normalizeBulletsStreaming(prev, chunk) {
  if (!chunk) return chunk;
  let s = String(chunk);
  try {
    if (prev && !/\n$/.test(prev) && /^(\s*)(?:[-*•]\s+|\d+\.\s+)/.test(s)) {
      s = `\n${s}`;
    }
    s = s.replace(/([^\n])(?=(?:[-*•]\s+))/g, '$1\n');
    s = s.replace(/([^\n])(?=\d+\.\s+)/g, '$1\n');
  } catch (_) { /* ignore */ }
  return s;
}

function renderMarkdownToHtml(input, opts = {}) {
  const autoParagraphMode = opts.autoParagraphMode || 'fallback';
  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  if (input == null) return '';
  let src = String(input).replace(/\r\n/g, '\n');

  const blocks = [];
  src = src.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (m, lang, code) => {
    const idx = blocks.push({ lang: lang || '', code }) - 1;
    return `[[[CODEBLOCK${idx}]]]`;
  });
  src = src.replace(/~~~([a-zA-Z0-9_-]*)\n([\s\S]*?)~~~/g, (m, lang, code) => {
    const idx = blocks.push({ lang: lang || '', code }) - 1;
    return `[[[CODEBLOCK${idx}]]]`;
  });

  src = src.replace(/\s*---\s*/g, '\n---\n');
  src = src.replace(/([\.!?])\s*„/g, '$1\n\n„');

  if (autoParagraphMode !== 'never') {
    src = src.replace(/([\.!?])\n(\s*[A-ZÄÖÜ0-9])/g, '$1\n\n$2');
  }

  const autoParagraph = (text) => {
    if (/\n\n/.test(text)) return text;
    if (/(^|\n)\s*(?:[-*]\s+|\d+[\.)]\s+)/m.test(text)) return text;
    let out = '';
    let i = 0;
    let sentencesInPara = 0;
    let paraStartLen = 0;
    const isUpper = (ch) => /[A-ZÄÖÜ]/.test(ch || '');
    while (i < text.length) {
      const ch = text[i];
      out += ch;
      if (ch === '.' || ch === '!' || ch === '?') {
        let j = i + 1; let ws = '';
        while (j < text.length && /\s/.test(text[j])) { ws += text[j]; j += 1; }
        const next = text[j];
        if (isUpper(next)) {
          sentencesInPara += 1;
          const paraLen = out.length - paraStartLen;
          const insertBreak = sentencesInPara >= 3 || paraLen >= 240;
          out += insertBreak ? '\n\n' : ' ';
          if (insertBreak) { sentencesInPara = 0; paraStartLen = out.length; }
          i = j;
          continue;
        }
      }
      i += 1;
    }
    return out;
  };

  if (autoParagraphMode !== 'never') {
    src = autoParagraph(src);
  }

  try { src = src.replace(/ {2}\n/g, '\n\n'); } catch (_) { /* ignore */ }

  let html = escapeHtml(src);

  html = html.replace(/(^|\n)\s*[-*_]{3,}\s*(?=\n|$)/g, '$1<hr/>');
  html = html.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  html = html.replace(/([:\.\)!\]])(\s*)(\d+\.\s+)/g, '$1\n$3');
  html = html.replace(/([:\.\)!\]])(\s*)(-\s+)/g, '$1\n$3');
  html = html.replace(/(^|\n)######\s+(.+?)(?=\n|$)/g, '$1<h6>$2</h6>');
  html = html.replace(/(^|\n)#####\s+(.+?)(?=\n|$)/g, '$1<h5>$2</h5>');
  html = html.replace(/(^|\n)####\s+(.+?)(?=\n|$)/g, '$1<h4>$2</h4>');
  html = html.replace(/(^|\n)###\s+(.+?)(?=\n|$)/g, '$1<h3>$2</h3>');
  html = html.replace(/(^|\n)##\s+(.+?)(?=\n|$)/g, '$1<h2>$2</h2>');
  html = html.replace(/(^|\n)#\s+(.+?)(?=\n|$)/g, '$1<h1>$2</h1>');
  html = html.replace(/(https?:\/\/[^\s<]+[^<\.,:;"')\]\s])/g, '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>');
  html = html.replace(/([:\.\!\?])\s*<strong>/g, '$1<br/><br/><strong>');
  html = html.replace(/<\/strong>(\S)/g, '</strong><br/><br/>$1');

  const lineify = (text) => {
    const lines = text.split(/\n/);
    const out = [];
    let list = [];
    let quote = [];
    const flushList = () => {
      if (!list.length) return;
      const body = list.join('<br/>');
      out.push(`<p>${body}</p>`);
      list = [];
    };
    const flushQuote = () => {
      if (!quote.length) return;
      const body = quote.join('<br/>');
      out.push(`<blockquote>${body}</blockquote>`);
      quote = [];
    };
    for (const raw of lines) {
      const line = raw;
      if (/^\s*-\s+/.test(line)) {
        flushQuote();
        const content = line.replace(/^\s*-\s+/, '');
        list.push(`• ${content}`);
        continue;
      }
      if (/^\s*\d+[\.)]\s+/.test(line)) {
        flushQuote();
        list.push(`${line.trim()}`);
        continue;
      }
      if (/^\s*>\s+/.test(line)) {
        flushList();
        const content = line.replace(/^\s*>\s+/, '');
        quote.push(content);
        continue;
      }
      flushList(); flushQuote();
      if (line.trim() === '') {
        out.push('');
      } else {
        const trimmed = line.trim();
        if (trimmed === '<hr/>' || /^<h[1-6][^>]*>.*<\/h[1-6]>$/.test(trimmed)) {
          out.push(trimmed);
        } else {
          out.push(`<p>${line}</p>`);
        }
      }
    }
    flushList(); flushQuote();
    return out.join('');
  };
  html = lineify(html);

  if (!/(<p|<blockquote|<hr\/?|<h[1-6])/i.test(html)) {
    html = html.replace(/\n\n+/g, '<br/><br/>' );
    html = html.replace(/\n/g, '<br/>' );
  } else {
    html = html.replace(/\n+/g, '');
  }

  html = html.replace(/<p><strong>([^<]+)<\/strong><br\/><br\/>/g, '<p><strong>$1</strong></p><p>');
  html = html.replace(/\[\[\[CODEBLOCK(\d+)\]\]\]/g, (m, i) => {
    const blk = blocks[Number(i)] || { lang: '', code: '' };
    const content = escapeHtml(blk.code);
    return `<pre><code data-lang="${blk.lang}">${content}</code></pre>`;
  });

  return html;
}

function renderFinalHtml(accumulated) {
  if (!accumulated) return '';
  const boundaryRegex = /\n\n+/g;
  let renderedPrefixHtml = '';
  let lastParaBoundary = 0;
  let match;
  let hadBoundary = false;
  while ((match = boundaryRegex.exec(accumulated)) !== null) {
    hadBoundary = true;
    const para = accumulated.slice(lastParaBoundary, match.index);
    if (para) {
      renderedPrefixHtml += `${renderMarkdownToHtml(para, { autoParagraphMode: 'never' })}<br/><br/>`;
    } else {
      renderedPrefixHtml += '<br/><br/>';
    }
    lastParaBoundary = match.index + match[0].length;
  }
  const tail = accumulated.slice(lastParaBoundary);
  const tailHtml = renderMarkdownToHtml(tail, { autoParagraphMode: hadBoundary ? 'never' : 'fallback' });
  return renderedPrefixHtml + tailHtml;
}

function analyseEvents(events) {
  const steps = [];
  const traces = [];
  const errors = [];
  let accumulated = '';

  for (const ev of events) {
    const name = ev.event || 'data';
    const payload = ev.data != null ? ev.data : parseDataPayload(ev.raw);
    if (name === 'trace') {
      try { traces.push(JSON.parse(payload)); }
      catch (_) { traces.push(payload); }
      continue;
    }
    if (name === 'error') {
      try { errors.push(JSON.parse(payload)); }
      catch (_) { errors.push({ raw: payload }); }
      continue;
    }
    if (name === 'end') continue;
    if (payload.trim() === '[DONE]') continue;

    let toAppend = payload;
    if (toAppend && (toAppend.startsWith('{') || toAppend.startsWith('['))) {
      try {
        const obj = JSON.parse(toAppend);
        toAppend = obj.delta || obj.content || obj.text || toAppend;
      } catch (_) { /* keep raw */ }
    }
    toAppend = normalizeBulletsStreaming(accumulated, toAppend);
    accumulated += (toAppend === '' ? '\n' : toAppend);
    const html = renderFinalHtml(accumulated);
    steps.push({ event: name, appended: toAppend, accumulated, htmlSample: html.slice(0, 400) });
  }

  return {
    accumulated,
    html: renderFinalHtml(accumulated),
    steps,
    traces,
    errors,
  };
}

function loadReport(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function printDiff(label, before, after) {
  if (before === after) return 0;
  const from = before == null || before === '' ? '<empty>' : before;
  const to = after == null || after === '' ? '<empty>' : after;
  console.log(`\n${label}`);
  console.log('--- before');
  console.log(from);
  console.log('+++ after');
  console.log(to);
  return 1;
}

function compareReports(beforePath, afterPath) {
  const before = loadReport(beforePath);
  const after = loadReport(afterPath);
  let changes = 0;

  if ((before.runs || []).length !== (after.runs || []).length) {
    changes += 1;
    console.log(`Run count differs: before=${(before.runs || []).length} after=${(after.runs || []).length}`);
  }

  const count = Math.min((before.runs || []).length, (after.runs || []).length);
  for (let i = 0; i < count; i += 1) {
    const oldRun = before.runs[i];
    const newRun = after.runs[i];
    if (oldRun.prompt !== newRun.prompt) {
      changes += printDiff(`Run ${i + 1} prompt`, oldRun.prompt, newRun.prompt);
    }
    const oldAnalysis = oldRun.analysis || {};
    const newAnalysis = newRun.analysis || {};
    changes += printDiff(`Run ${i + 1} accumulated`, oldAnalysis.accumulated, newAnalysis.accumulated);
    changes += printDiff(`Run ${i + 1} html`, oldAnalysis.html, newAnalysis.html);

    const oldSteps = (oldAnalysis.steps || []).length;
    const newSteps = (newAnalysis.steps || []).length;
    if (oldSteps !== newSteps) {
      changes += 1;
      console.log(`Run ${i + 1} step count differs: before=${oldSteps} after=${newSteps}`);
    }
  }

  if (!changes) {
    console.log('No differences found between reports.');
  } else {
    console.log(`\nDifferences detected: ${changes}`);
  }
  return changes;
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

  if (opts.compare) {
    const before = path.resolve(opts.compare.before);
    const after = path.resolve(opts.compare.after);
    const diff = compareReports(before, after);
    if (diff) process.exitCode = 1;
    return;
  }

  const sessions = [];
  try {
    sessions.push(await runOnce({ prompt: opts.prompt, threadId: opts.threadId }));
    if (opts.followUp) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      sessions.push(await runOnce({ prompt: opts.followUp, threadId: opts.threadId }));
    }
  } catch (err) {
    console.error('[analyse-agent-stream] Agent failed', err);
    throw err;
  }

  const analyses = sessions.map((session) => ({
    startedAt: new Date(session.startedAt).toISOString(),
    durationMs: session.durationMs,
    prompt: session.prompt,
    analysis: analyseEvents(session.events),
    events: session.events,
  }));

  for (let i = 0; i < analyses.length; i += 1) {
    const run = analyses[i];
    console.log(`\n=== Run ${i + 1} ===`);
    console.log(`Prompt: ${run.prompt}`);
    console.log(`Duration: ${run.durationMs} ms`);
    console.log(`Accumulated characters: ${run.analysis.accumulated.length}`);
    if (run.analysis.errors.length) {
      console.log('Errors:');
      for (const err of run.analysis.errors) console.log('  ', err);
    }
    console.log('Final text:\n', run.analysis.accumulated.slice(0, 1200));
    if (run.analysis.accumulated.length > 1200) console.log('  ...[truncated]');
    console.log('Rendered HTML preview:\n', run.analysis.html.slice(0, 1200));
    if (run.analysis.html.length > 1200) console.log('  ...[truncated]');
  }

  const outDir = path.join(__dirname, '..', 'tmp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = opts.outFile
    ? path.resolve(opts.outFile)
    : path.join(outDir, `agent-analysis-${Date.now()}.json`);
  const payload = {
    startedAt: new Date(sessions[0].startedAt).toISOString(),
    threadId: opts.threadId,
    runs: analyses,
  };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n[analyse-agent-stream] Report written to ${outFile}`);

  if (opts.snapshotFile) {
    const snapPath = path.resolve(opts.snapshotFile);
    if (fs.existsSync(snapPath)) {
      console.log(`\n[analyse-agent-stream] Comparing against snapshot ${snapPath}`);
      const diff = compareReports(snapPath, outFile);
      if (diff) {
        process.exitCode = 1;
      } else {
        console.log('[analyse-agent-stream] Snapshot match.');
      }
    } else {
      console.log(`\n[analyse-agent-stream] Snapshot not found. You can create one via: cp "${outFile}" "${snapPath}"`);
    }
  }
  return outFile;
}

main()
  .then(() => {
    const code = process.exitCode == null ? 0 : process.exitCode;
    process.exit(code);
  })
  .catch((err) => {
    console.error('[analyse-agent-stream] Unhandled error', err);
    process.exit(1);
  });
