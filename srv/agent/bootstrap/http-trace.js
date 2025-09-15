// Optional HTTP tracing for global fetch
// Enable with AGENT_HTTP_TRACE=1 or =true

const { redact, safeJson } = require('../helpers/logging');

function enableHttpTrace() {
  try {
    const on = process.env.AGENT_HTTP_TRACE === '1' || process.env.AGENT_HTTP_TRACE === 'true';
    if (!on) return;
    if (!globalThis.fetch) return; // Node <18 or no fetch polyfill
    if (globalThis.__agent_http_trace_enabled) return;
    globalThis.__agent_http_trace_enabled = true;

    const orig = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url;
      try {
        console.log('[HTTP][req]', {
          method: init?.method || 'GET',
          url,
          headers: redact(init?.headers),
          bodyPreview: safeJson(init?.body, 1000),
        });
      } catch {}
      const res = await orig(input, init);
      try {
        const clone = res.clone?.() || res; // some fetch impl may not support clone
        let body = '';
        try { body = await clone.text(); } catch {}
        const headersObj = {};
        try {
          if (res.headers && typeof res.headers.entries === 'function') {
            for (const [k, v] of res.headers.entries()) headersObj[k] = v;
          }
        } catch {}
        console.log('[HTTP][res]', {
          status: res.status,
          url: res.url,
          headers: headersObj,
          bodyPreview: body && body.length > 1000 ? body.slice(0, 1000) + ' …[truncated]' : body
        });
      } catch {}
      return res;
    };
  } catch {}
}

module.exports = { enableHttpTrace };

