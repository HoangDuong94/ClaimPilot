#!/usr/bin/env node
// Reproduces the UI streaming parsing vs. raw SSE for /ai/agent/stream
// Prints raw SSE events, UI-like accumulated text (before/after), and final HTML as the UI would render it.

const http = require('http');
const https = require('https');

function postSSE(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const lib = isHttps ? https : http;
    const u = new URL(url);
    const data = JSON.stringify(body || {});
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Accept': 'text/event-stream',
        ...headers,
      }
    }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      const events = [];
      res.on('data', chunk => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (raw) events.push(raw);
        }
      });
      res.on('end', () => resolve(events));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// --- UI-like rendering helpers (ported/adapted from app/claims/webapp/main.js) ---
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdownToHtmlLikeUI(input, opts = {}) {
  const autoParagraphMode = opts.autoParagraphMode || 'fallback';
  if (input == null) return '';
  let src = String(input).replace(/\r\n/g, "\n");

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
  if (autoParagraphMode !== 'never') {
    src = src.replace(/([\.!?])\n(\s*[A-ZÄÖÜA-Za-z0-9])/g, '$1\n\n$2');
  }

  const autoParagraph = (text) => {
    if (/\n\n/.test(text)) return text;
    if (/(^|\n)\s*(?:[-*•]\s+|\d+[\.)]\s+)/m.test(text)) return text;
    let out = '';
    let i = 0; let sentencesInPara = 0; let paraStartLen = 0;
    const isUpper = (ch) => /[A-ZÄÖÜA-Za-z]/.test(ch || '');
    while (i < text.length) {
      const ch = text[i];
      out += ch;
      if (ch === '.' || ch === '!' || ch === '?') {
        let j = i + 1; while (j < text.length && /\s/.test(text[j])) j++;
        const next = text[j];
        if (isUpper(next)) {
          sentencesInPara++;
          const paraLen = out.length - paraStartLen;
          const insertBreak = sentencesInPara >= 3 || paraLen >= 240;
          out += insertBreak ? "\n\n" : " ";
          if (insertBreak) { sentencesInPara = 0; paraStartLen = out.length; }
          i = j; continue;
        }
      }
      i++;
    }
    return out;
  };
  if (autoParagraphMode !== 'never') src = autoParagraph(src);

  // Interpret Markdown hard line break (two spaces + newline) as paragraph boundary
  try { src = src.replace(/ {2}\n/g, '\n\n'); } catch (e) {}

  let html = escapeHtml(src);
  html = html.replace(/(^|\n)\s*[-*_]{3,}\s*(?=\n|$)/g, '$1<hr/>' );
  html = html.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  html = html.replace(/([:\.\)!\]])(\s*)(\d+\.\s+)/g, '$1\n$3');
  html = html.replace(/([:\.\)!\]])(\s*)(-\s+)/g, '$1\n$3');
  html = html.replace(/(^|\n)######\s+(.+?)(?=\n|$)/g, '$1<h6>$2<\/h6>');
  html = html.replace(/(^|\n)#####\s+(.+?)(?=\n|$)/g, '$1<h5>$2<\/h5>');
  html = html.replace(/(^|\n)####\s+(.+?)(?=\n|$)/g, '$1<h4>$2<\/h4>');
  html = html.replace(/(^|\n)###\s+(.+?)(?=\n|$)/g, '$1<h3>$2<\/h3>');
  html = html.replace(/(^|\n)##\s+(.+?)(?=\n|$)/g, '$1<h2>$2<\/h2>');
  html = html.replace(/(^|\n)#\s+(.+?)(?=\n|$)/g, '$1<h1>$2<\/h1>');
  html = html.replace(/(https?:\/\/[^\s<]+[^<\.,:;"')\]\s])/g, '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>');
  html = html.replace(/([:\.\!\?])\s*<strong>/g, '$1<br/><br/><strong>');
  html = html.replace(/<\/strong>(\S)/g, '</strong><br/><br/>$1');

  const lineify = (text) => {
    const lines = text.split(/\n/);
    const out = [];
    let list = []; let quote = [];
    const flushList = () => { if (!list.length) return; const body = list.join('<br/>'); out.push(`<p>${body}</p>`); list = []; };
    const flushQuote = () => { if (!quote.length) return; const body = quote.join('<br/>'); out.push(`<blockquote>${body}</blockquote>`); quote = []; };
    for (let raw of lines) {
      const line = raw;
      if (/^\s*[-*•]\s+/.test(line)) { flushQuote(); const content = line.replace(/^\s*[-*•]\s+/, ''); list.push(`• ${content}`); continue; }
      if (/^\s*\d+[\.)]\s+/.test(line)) { flushQuote(); list.push(`${line.trim()}`); continue; }
      if (/^\s*>\s+/.test(line)) { flushList(); const content = line.replace(/^\s*>\s+/, ''); quote.push(content); continue; }
      flushList(); flushQuote();
      if (line.trim() === '') { out.push(''); } else {
        const trimmed = line.trim();
        if (trimmed === '<hr/>' || /^<h[1-6][^>]*>.*<\/h[1-6]>$/.test(trimmed)) out.push(trimmed); else out.push(`<p>${line}</p>`);
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
  html = html.replace(/<p><strong>([^<]+)<\/strong><br\/><br\/>/g, '<p><strong>$1<\/strong><\/p><p>');
  html = html.replace(/\[\[\[CODEBLOCK(\d+)\]\]\]/g, (m, i) => {
    const blk = blocks[Number(i)] || { lang: '', code: '' };
    const content = escapeHtml(blk.code);
    return `<pre><code data-lang="${blk.lang}">${content}</code></pre>`;
  });
  return html;
}

function normalizeBulletsStreamingBefore(prev, chunk) {
  if (!chunk) return chunk;
  let s = String(chunk);
  try {
    if (prev && !/\n$/.test(prev) && /^(\s*)(?:[-*]\s+|\d+\.\s+)/.test(s)) {
      s = "\n" + s;
    }
    s = s.replace(/([^\n])(?=-\s+)/g, '$1\n');
    s = s.replace(/([^\n])(?=\d+\.\s+)/g, '$1\n');
  } catch {}
  return s;
}

function normalizeBulletsStreamingAfter(prev, chunk) {
  if (!chunk) return chunk;
  let s = String(chunk);
  try {
    if (prev && !/\n$/.test(prev) && /^(\s*)(?:[-*•]\s+|\d+\.\s+)/.test(s)) {
      s = "\n" + s;
    }
    s = s.replace(/([^\n])(?=(?:[-*•]\s+))/g, '$1\n');
    s = s.replace(/([^\n])(?=\d+\.\s+)/g, '$1\n');
  } catch {}
  return s;
}

function extractDataFromBlock(raw) {
  if (!/^data:/m.test(raw)) return null;
  const lines = raw.split(/\r?\n/);
  let joined = '';
  for (const ln of lines) {
    if (!ln.startsWith('data:')) continue;
    let d = ln.slice(5);
    if (d.startsWith(' ')) d = d.slice(1);
    joined += d + '\n';
  }
  return joined.replace(/\n$/, '');
}

function uiAccumulate(events, mode = 'before') {
  let acc = '';
  for (const e of events) {
    const data = extractDataFromBlock(e);
    if (data == null) continue;
    if (data.trim() === '[DONE]') break;
    let toAppend = null;
    if (data.startsWith('{') || data.startsWith('[')) {
      try {
        const obj = JSON.parse(data);
        toAppend = obj.delta || obj.content || obj.text || (mode === 'after' ? obj.output : null) || null;
      } catch {}
    }
    let piece = (toAppend != null ? toAppend : data);
    piece = mode === 'after' ? normalizeBulletsStreamingAfter(acc, piece) : normalizeBulletsStreamingBefore(acc, piece);
    acc += (piece === '' ? '\n' : piece);
  }
  return acc;
}

(async () => {
  const url = process.env.SSE_URL || 'http://localhost:9999/ai/agent/stream';
  const prompt = process.argv[2] || 'Sag Hallo.';
  const threadId = process.argv[3] || 't-repro-1';
  console.log('Posting to', url, 'prompt=', prompt, 'threadId=', threadId);
  const events = await postSSE(url, { prompt, threadId });
  console.log('\n--- RAW SSE EVENTS ---');
  for (const raw of events) console.log(raw);
  const before = uiAccumulate(events, 'before');
  const after = uiAccumulate(events, 'after');
  console.log('\n--- UI BEFORE (original) ---\n' + before);
  console.log('\n--- UI AFTER (improved) ---\n' + after);
  // Final render like UI after stream completes
  let renderedPrefixHtml = '';
  let lastParaBoundary = 0;
  const boundaryRegex = /\n\n+/g;
  let match;
  while ((match = boundaryRegex.exec(after)) !== null) {
    const para = after.slice(lastParaBoundary, match.index);
    renderedPrefixHtml += renderMarkdownToHtmlLikeUI(para, { autoParagraphMode: 'never' }) + '<br/><br/>';
    lastParaBoundary = match.index + match[0].length;
  }
  const tail = after.slice(lastParaBoundary);
  const tailHtml = boundaryRegex.test(after)
    ? renderMarkdownToHtmlLikeUI(tail, { autoParagraphMode: 'never' })
    : renderMarkdownToHtmlLikeUI(tail, { autoParagraphMode: 'fallback' });
  const finalHtml = renderedPrefixHtml + tailHtml;
  console.log('\n--- UI FINAL HTML (simulated) ---\n' + finalHtml);
})();
