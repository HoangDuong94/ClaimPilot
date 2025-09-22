const cds = require('@sap/cds');
// Ensure .env is loaded early so DB creds are available
try { require('dotenv').config(); } catch (_) { /* optional */ }
const { createChatProvider } = require('./chat-provider');

// Ensure Postgres config is concretely resolved from environment
(() => {
  try {
    const cfg = (cds && cds.env && cds.env.requires && cds.env.requires.db) || {};
    const envUrl = process.env.DATABASE_URL;
    const envPg = {
      host: process.env.POSTGRES_HOST,
      port: process.env.POSTGRES_PORT,
      database: process.env.POSTGRES_DATABASE,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD
    };
    const hasEnvUrl = !!envUrl;
    const hasEnvPg = !!(envPg.host && envPg.database && envPg.user);
    const placeholderUrl = typeof cfg?.credentials?.url === 'string' && cfg.credentials.url.includes('{env.');
    const placeholderHost = typeof cfg?.credentials?.host === 'string' && cfg.credentials.host.includes('{env.');

    // Force dialect to postgres for hybrid profile
    cds.env.sql = cds.env.sql || {};
    cds.env.sql.dialect = 'postgres';

    const keepPool = cfg && cfg.pool ? cfg.pool : undefined;
    const keepClient = cfg && cfg.client ? cfg.client : undefined;
    if (hasEnvUrl) {
      const parsePgUrl = (u) => {
        try {
          const x = new URL(u);
          return {
            host: x.hostname,
            port: x.port ? Number(x.port) : 5432,
            database: (x.pathname || '').replace(/^\//, ''),
            user: decodeURIComponent(x.username || ''),
            password: decodeURIComponent(x.password || ''),
          };
        } catch (_) { return null; }
      };
      const parsed = parsePgUrl(envUrl) || {};
      parsed.schema = 'public';
      cds.env.requires.db = {
        kind: 'postgres',
        impl: '@cap-js/postgres',
        credentials: parsed,
        ...(keepPool ? { pool: keepPool } : {}),
        client: { ...(keepClient || {}), connectionTimeoutMillis: (keepClient && keepClient.connectionTimeoutMillis) || 10000, connectionString: envUrl }
      };
    } else if (hasEnvPg && (cfg.kind !== 'postgres' || placeholderHost)) {
      cds.env.requires.db = {
        kind: 'postgres',
        impl: '@cap-js/postgres',
        credentials: {
          host: envPg.host,
          port: envPg.port ? Number(envPg.port) : 5432,
          database: envPg.database,
          user: envPg.user,
          password: envPg.password,
          schema: 'public'
        },
        ...(keepPool ? { pool: keepPool } : {}),
        ...(keepClient ? { client: keepClient } : {})
      };
    } else if (placeholderUrl) {
      // If only placeholder URL is set but env not loaded, try to resolve now
      if (process.env.DATABASE_URL) {
        cds.env.requires.db.credentials.url = process.env.DATABASE_URL;
      }
    }
  } catch (e) {
    // Swallow to not block startup; logs only in debug
    if (process.env.DEBUG) console.warn('[db-config]', e && e.message);
  }
})();

async function streamGenAI(prompt, res, opts = {}) {
  function sseWrite(res, data) {
    if (data == null) return;
    const s = String(data);
    const lines = s.split(/\r?\n/);
    for (const line of lines) {
      res.write(`data: ${line}\n`);
    }
    res.write(`\n`);
  }
  const client = await createChatProvider();
  const messages = [{ role: 'user', content: String(prompt || '') }];
  const forceFallback = !!opts.forceFallback;
  try {
    if (forceFallback) throw new Error('forced-fallback');
    for await (const piece of client.stream(messages)) {
      if (piece) sseWrite(res, piece);
    }
  } catch (e) {
    const text = String(await client.complete(messages) || '');
    const chunkSize = 64;
    for (let i = 0; i < text.length; i += chunkSize) {
      const piece = text.slice(i, i + chunkSize);
      if (piece) sseWrite(res, piece);
      await new Promise(r => setTimeout(r, 10));
    }
  }
  res.write(`event: end\n`);
  res.write(`data: [DONE]\n\n`);
  res.end();
}

cds.on('bootstrap', (app) => {
  // Server-Sent Events endpoint for streaming chat responses
  app.post('/ai/stream', expressJson(), async (req, res) => {
    try {
      const prompt = (req.body && req.body.prompt) || '';
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders && res.flushHeaders();
      const forceFallback = req.headers['x-use-fallback'] === '1' || req.query.fallback === '1';
      await streamGenAI(prompt, res, { forceFallback });
    } catch (e) {
      try {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: e && e.message ? e.message : String(e) })}\n\n`);
        res.end();
      } catch (_) { /* ignore */ }
    }
  });
  // Agent endpoint: LangGraph + MCP tools (no fallback)
  app.post('/ai/agent/stream', expressJson(), async (req, res) => {
    try {
      const { runAgentStreaming } = require('./agent');
      const prompt = (req.body && req.body.prompt) || '';
      const threadId = (req.body && req.body.threadId) || undefined;
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders && res.flushHeaders();
      await runAgentStreaming({ prompt, threadId, res });
    } catch (e) {
      try {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: e && e.message ? e.message : String(e) })}\n\n`);
        res.end();
      } catch (_) { /* ignore */ }
    }
  });
});

function expressJson() {
  const express = require('express');
  return express.json();
}

module.exports = {};


