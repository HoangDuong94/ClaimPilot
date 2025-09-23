const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');

function decodeJwtExpiry(token) {
  if (!token || typeof token !== 'string') return null;
  const segments = token.split('.');
  if (segments.length < 2) return null;
  let payload = segments[1];
  try {
    payload = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4 !== 0) payload += '=';
    const json = Buffer.from(payload, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed.exp === 'number') {
      return new Date(parsed.exp * 1000);
    }
  } catch (_) { /* ignore and fall back */ }
  return null;
}

function createCliTokenProvider({
  command = process.env.MCP_M365_CLI_BIN || 'm365',
  args,
  resource = 'https://graph.microsoft.com',
  timeout = Number(process.env.MCP_M365_CLI_TIMEOUT_MS || 8000),
  disable = process.env.MCP_M365_DISABLE_CLI === '1' || process.env.MCP_M365_DISABLE_CLI === 'true',
} = {}) {
  if (disable) return null;
  const finalArgs = Array.isArray(args) && args.length
    ? args
    : ['util', 'accesstoken', 'get', '--resource', resource, '--output', 'text'];
  return async () => new Promise((resolve) => {
    try {
      const child = execFile(command, finalArgs, { timeout }, (err, stdout) => {
        if (err) return resolve(null);
        const token = String(stdout || '').trim();
        if (!token) return resolve(null);
        const expiresAt = decodeJwtExpiry(token) || new Date(Date.now() + 10 * 60 * 1000);
        resolve({ token, expiresAt });
      });
      child.on('error', () => resolve(null));
    } catch (_) {
      resolve(null);
    }
  });
}

function buildUrl(baseUrl, pathname, query) {
  const url = new URL(pathname.startsWith('http') ? pathname : `${baseUrl}${pathname.startsWith('/') ? '' : '/'}${pathname}`);
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, item);
        }
      } else {
        url.searchParams.append(key, value);
      }
    }
  }
  return url;
}

function createTokenManager({ env, accessToken, fetchImpl, now, cliProvider }) {
  let cached;
  let cliAnnounced = false;

  async function acquire(scopeSet) {
    if (accessToken) return accessToken;
    const envToken = env.MCP_M365_ACCESS_TOKEN || env.GRAPH_ACCESS_TOKEN || env.AZURE_ACCESS_TOKEN;
    if (envToken) return envToken;

    const nowTs = now();
    if (cached && cached.expiresAt > nowTs) {
      return cached.token;
    }

    if (cliProvider) {
      try {
        const cliResult = await cliProvider();
        if (cliResult && cliResult.token) {
          cached = {
            token: cliResult.token,
            expiresAt: cliResult.expiresAt || new Date(nowTs.getTime() + 10 * 60 * 1000),
          };
          if (!cliAnnounced) {
            try { console.log('[MCP][M365]', 'Nutze bestehende m365 CLI Anmeldung für Graph-Tokens'); } catch (_) {}
            cliAnnounced = true;
          }
          return cached.token;
        }
      } catch (_) { /* ignore and continue */ }
    }

    const tenantId = env.MCP_M365_TENANT_ID || env.AZURE_TENANT_ID;
    const clientId = env.MCP_M365_CLIENT_ID || env.AZURE_CLIENT_ID;
    const clientSecret = env.MCP_M365_CLIENT_SECRET || env.AZURE_CLIENT_SECRET;
    if (!tenantId || !clientId || !clientSecret) {
      throw new Error('Microsoft Graph Zugang nicht konfiguriert (setze MCP_M365_ACCESS_TOKEN oder führe "m365 login" aus)');
    }

    const scope = Array.isArray(scopeSet) && scopeSet.length
      ? scopeSet.join(' ')
      : env.MCP_M365_DEFAULT_SCOPE || 'https://graph.microsoft.com/.default';

    const bodyParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope,
      grant_type: 'client_credentials',
    });

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Token request failed: ${response.status} ${text}`);
    }
    const data = await response.json();
    const expiresIn = Number(data.expires_in || 3600);
    const expiry = new Date(nowTs.getTime() + Math.max(expiresIn - 60, 60) * 1000);
    cached = { token: data.access_token, expiresAt: expiry };
    return cached.token;
  }

  return {
    async getToken(scopeSet) {
      return acquire(scopeSet);
    },
    getCachedToken() {
      if (accessToken) return accessToken;
      return cached ? cached.token : env.MCP_M365_ACCESS_TOKEN || env.GRAPH_ACCESS_TOKEN || null;
    }
  };
}

function ensureFetch(fetchImpl) {
  if (typeof fetchImpl === 'function') return fetchImpl;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  throw new Error('A fetch implementation is required for Microsoft Graph requests');
}

async function createDefaultM365Dependencies(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = ensureFetch(options.fetchImpl);
  const fileSystem = options.fs || fs;
  const now = options.now || (() => new Date());
  const baseUrl = options.baseUrl || 'https://graph.microsoft.com/v1.0';
  const accessToken = options.accessToken;
  const cliProvider = createCliTokenProvider(options.cli);
  const tokenManager = createTokenManager({ env, accessToken, fetchImpl, now, cliProvider });
  const featureStore = new Map();

  async function graphFetch(pathname, {
    method = 'GET',
    query,
    headers = {},
    body,
    prefer,
    responseType = 'json',
    scopeSet,
  } = {}) {
    const token = await tokenManager.getToken(scopeSet);
    const url = buildUrl(baseUrl, pathname, query);
    const finalHeaders = { Authorization: `Bearer ${token}`, ...headers };
    let payload = body;
    const isBuffer = Buffer.isBuffer(body);
    if (body && typeof body === 'object' && !isBuffer && typeof body.pipe !== 'function') {
      finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/json';
      payload = JSON.stringify(body);
    }
    if (isBuffer) {
      finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/octet-stream';
    }
    if (prefer) {
      const preferValues = Array.isArray(prefer) ? prefer : [prefer];
      finalHeaders.Prefer = preferValues.join(', ');
    }
    const response = await fetchImpl(url.toString(), { method, headers: finalHeaders, body: payload });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Graph request failed: ${method} ${url.pathname} -> ${response.status} ${text}`);
    }
    if (responseType === 'raw') return response;
    if (responseType === 'text') return response.text();
    if (responseType === 'buffer') {
      if (typeof response.arrayBuffer === 'function') {
        const buf = await response.arrayBuffer();
        return Buffer.from(buf);
      }
      const text = await response.text();
      return Buffer.from(text);
    }
    return response.json();
  }

  function normaliseMessageList(result = {}) {
    const value = result.value || [];
    return value[0];
  }

  const mail = {
    async getLatestMessage({ folderId = 'inbox', select, includeBodyPreview = false } = {}) {
      const baseSelect = ['id', 'subject', 'receivedDateTime', 'from', 'webLink'];
      if (includeBodyPreview) baseSelect.push('bodyPreview');
      if (Array.isArray(select)) baseSelect.push(...select);
      const finalSelect = Array.from(new Set(baseSelect)).join(',');
      const data = await graphFetch(`/me/mailFolders/${folderId}/messages`, {
        query: {
          '$orderby': 'receivedDateTime desc',
          '$top': 1,
          '$select': finalSelect,
        },
      });
      return normaliseMessageList(data);
    },

    async fetchMessage({ messageId, preferTextBody = true, expandAttachments = false } = {}) {
      if (!messageId) throw new Error('messageId is required');
      const prefer = [];
      if (preferTextBody) prefer.push('outlook.body-content-type="text"');
      const expand = expandAttachments ? '$expand=attachments' : null;
      const query = expand ? { '$expand': 'attachments' } : undefined;
      return graphFetch(`/me/messages/${messageId}`, { prefer, query });
    },

    async createReplyDraft({ messageId, preferHeaders } = {}) {
      if (!messageId) throw new Error('messageId is required');
      const data = await graphFetch(`/me/messages/${messageId}/createReply`, {
        method: 'POST',
        prefer: preferHeaders,
      });
      const draftId = data && (data.id || data.messageId || data.value?.[0]?.id);
      const etag = data && (data['@odata.etag'] || data.etag);
      return { draftId, etag };
    },

    async patchDraftBody({ draftId, body, contentType = 'Text', etag, preferHeaders } = {}) {
      if (!draftId) throw new Error('draftId is required');
      const headers = {};
      if (etag) headers['If-Match'] = etag;
      const data = await graphFetch(`/me/messages/${draftId}`, {
        method: 'PATCH',
        headers,
        prefer: preferHeaders,
        body: {
          body: {
            contentType,
            content: body,
          },
        },
      });
      return { etag: data && (data['@odata.etag'] || data.etag || etag) };
    },

    async sendDraft({ draftId, saveToSentItems = true, preferHeaders } = {}) {
      if (!draftId) throw new Error('draftId is required');
      await graphFetch(`/me/messages/${draftId}/send`, {
        method: 'POST',
        prefer: preferHeaders,
      });
      return {};
    },

    async sendMessage({ subject, body, bodyContentType = 'Text', to = [], internetHeaders, attachments = [], saveToSentItems = true } = {}) {
      if (!subject) throw new Error('subject is required');
      if (!body) throw new Error('body is required');
      if (!Array.isArray(to) || !to.length) throw new Error('recipient list is empty');
      const message = {
        subject,
        body: {
          contentType: bodyContentType,
          content: body,
        },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
        internetMessageHeaders: internetHeaders
          ? Object.entries(internetHeaders).map(([name, value]) => ({ name, value }))
          : undefined,
        attachments: attachments.length ? attachments.map((item) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: item.name,
          contentBytes: item.contentBytes,
        })) : undefined,
      };
      if (attachments.length) {
        for (const attachment of attachments) {
          if (!attachment.contentBytes && attachment.path) {
            const buffer = await fileSystem.readFile(attachment.path);
            attachment.contentBytes = buffer.toString('base64');
          }
        }
      }
      await graphFetch('/me/sendMail', {
        method: 'POST',
        body: {
          message,
          saveToSentItems,
        },
      });
      return { internetMessageId: null };
    },

    async downloadAttachment({ messageId, attachmentId, targetPath } = {}) {
      if (!messageId) throw new Error('messageId is required');
      if (!attachmentId) throw new Error('attachmentId is required');
      if (!targetPath) throw new Error('targetPath is required');
      const data = await graphFetch(`/me/messages/${messageId}/attachments/${attachmentId}`, {});
      const content = data && data.contentBytes ? Buffer.from(data.contentBytes, 'base64') : null;
      if (!content) throw new Error('Attachment content not available');
      const destinationDir = path.dirname(targetPath);
      await fileSystem.mkdir(destinationDir, { recursive: true }).catch(() => {});
      await fileSystem.writeFile(targetPath, content);
      return { filePath: targetPath };
    },

    async uploadAndAttach({ messageId, filePath, contentType } = {}) {
      if (!messageId) throw new Error('messageId is required');
      if (!filePath) throw new Error('filePath is required');
      const buffer = await fileSystem.readFile(filePath);
      const attachment = {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: path.basename(filePath),
        contentType: contentType || undefined,
        contentBytes: buffer.toString('base64'),
      };
      const data = await graphFetch(`/me/messages/${messageId}/attachments`, {
        method: 'POST',
        body: attachment,
      });
      return { attachmentId: data && data.id };
    },
  };

  const calendar = {
    async listEvents({ startDateTime, endDateTime, calendarId = 'me' } = {}) {
      if (!startDateTime || !endDateTime) throw new Error('startDateTime and endDateTime are required');
      const data = await graphFetch('/me/calendarview', {
        query: {
          startDateTime,
          endDateTime,
        },
        headers: {
          Prefer: 'outlook.timezone="UTC"',
        },
      });
      return { events: data.value || [] };
    },

    async createOrUpdateEvent({ eventId, subject, body, start, end, attendees = [], location } = {}) {
      if (!subject) throw new Error('subject is required');
      if (!start || !end) throw new Error('start and end are required');
      const payload = {
        subject,
        body: body ? { contentType: 'HTML', content: body } : undefined,
        start: { dateTime: start, timeZone: 'UTC' },
        end: { dateTime: end, timeZone: 'UTC' },
        attendees: attendees.map((address) => ({ emailAddress: { address }, type: 'required' })),
        location: location ? { displayName: location } : undefined,
      };
      if (eventId) {
        await graphFetch(`/me/events/${eventId}`, { method: 'PATCH', body: payload });
        return { status: 'updated', eventId };
      }
      const created = await graphFetch('/me/events', { method: 'POST', body: payload });
      return { status: 'created', eventId: created && created.id };
    },

    async cancelEvent({ eventId, comment } = {}) {
      if (!eventId) throw new Error('eventId is required');
      await graphFetch(`/me/events/${eventId}/cancel`, {
        method: 'POST',
        body: { comment: comment || '' },
      });
      return { status: 'cancelled', eventId };
    },
  };

  const drive = {
    async uploadFile({ sourcePath, drivePath, conflictBehavior = 'replace' } = {}) {
      if (!sourcePath) throw new Error('sourcePath is required');
      if (!drivePath) throw new Error('drivePath is required');
      const buffer = await fileSystem.readFile(sourcePath);
      const encodedPath = drivePath.startsWith('/') ? drivePath : `/${drivePath}`;
      const response = await graphFetch(`/me/drive/root:${encodedPath}:/content`, {
        method: 'PUT',
        headers: { 'If-Match': '*' },
        query: {
          '@microsoft.graph.conflictBehavior': conflictBehavior,
        },
        body: buffer,
        responseType: 'json',
      });
      return { driveItemId: response && response.id };
    },
  };

  function workbookHeaders(session) {
    return session ? { 'workbook-session-id': session } : {};
  }

  const excel = {
    async listSheets({ driveItemId, workbookSession } = {}) {
      if (!driveItemId) throw new Error('driveItemId is required');
      if (!workbookSession) throw new Error('workbookSession is required');
      const data = await graphFetch(`/me/drive/items/${driveItemId}/workbook/worksheets`, {
        headers: workbookHeaders(workbookSession),
      });
      const sheets = (data.value || []).map((item) => item.name);
      return { sheets };
    },

    async readRange({ driveItemId, workbookSession, sheetName, range, valuesOnly = true, preferValues = false } = {}) {
      if (!driveItemId) throw new Error('driveItemId is required');
      if (!workbookSession) throw new Error('workbookSession is required');
      const headers = workbookHeaders(workbookSession);
      if (preferValues) headers.Prefer = 'outlook.body-content-type="text"';
      let endpoint;
      if (sheetName && range) {
        endpoint = `/me/drive/items/${driveItemId}/workbook/worksheets('${sheetName}')/range(address='${range}')`;
      } else if (sheetName) {
        endpoint = `/me/drive/items/${driveItemId}/workbook/worksheets('${sheetName}')/usedRange(valuesOnly=${valuesOnly ? 'true' : 'false'})`;
      } else {
        endpoint = `/me/drive/items/${driveItemId}/workbook/usedRange(valuesOnly=${valuesOnly ? 'true' : 'false'})`;
      }
      const data = await graphFetch(endpoint, { headers });
      return { address: data.address, values: data.values || [] };
    },

    async updateRange({ driveItemId, workbookSession, sheetName, range, values, matchExpected } = {}) {
      if (!driveItemId) throw new Error('driveItemId is required');
      if (!workbookSession) throw new Error('workbookSession is required');
      if (!sheetName) throw new Error('sheetName is required');
      if (!range) throw new Error('range is required');
      if (!Array.isArray(values)) throw new Error('values must be an array');
      const headers = workbookHeaders(workbookSession);
      if (matchExpected) headers['If-Match'] = '*';
      const endpoint = `/me/drive/items/${driveItemId}/workbook/worksheets('${sheetName}')/range(address='${range}')`;
      await graphFetch(endpoint, {
        method: 'PATCH',
        headers,
        body: { values },
      });
      return { modifiedRange: `${sheetName}!${range}` };
    },
  };

  const graph = {
    async healthCheck({ pingEndpoint = `${baseUrl}/me` } = {}) {
      const start = now();
      const startMs = start instanceof Date ? start.getTime() : Number(start);
      await graphFetch(pingEndpoint.replace(baseUrl, ''), {});
      const end = now();
      const endMs = end instanceof Date ? end.getTime() : Number(end);
      const latencyMs = Number.isFinite(endMs - startMs) ? Math.max(0, endMs - startMs) : 0;
      return { status: 'healthy', latencyMs };
    },

    async acquireToken({ scopeSet } = {}) {
      const token = await tokenManager.getToken(scopeSet);
      return { status: 'acquired', expiresOn: null, token };
    },
  };

  const tooling = {
    async updateFeatureToggle({ feature, enabled, context } = {}) {
      if (!feature) throw new Error('feature is required');
      if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
      const record = {
        feature,
        enabled,
        context,
        updatedAt: now().toISOString(),
      };
      featureStore.set(feature, record);
      return record;
    },
  };

  return { mail, calendar, drive, excel, graph, tooling };
}

module.exports = { createDefaultM365Dependencies };
