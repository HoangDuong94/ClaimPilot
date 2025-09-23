const test = require('node:test');
const assert = require('node:assert/strict');

const { createDefaultM365Dependencies } = require('./mcp-m365-defaults');
const { createM365ToolHandlers } = require('./mcp-m365-tools');

function createResponse(body, status = 200, headers = {}) {
  const headerStore = {};
  for (const [key, value] of Object.entries(headers)) {
    headerStore[key.toLowerCase()] = value;
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key) => headerStore[key.toLowerCase()],
    },
    async json() { return body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

function createFetchStub(sequence) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const next = sequence.shift();
    if (!next) {
      throw new Error(`Unexpected fetch call for ${url}`);
    }
    calls.push({ url, options });
    return next(url, options);
  };
  return { fetchImpl, calls };
}

function createFsStub() {
  const files = new Map();
  return {
    files,
    async readFile(path) {
      if (!files.has(path)) throw new Error(`ENOENT:${path}`);
      return files.get(path);
    },
    async writeFile(path, data) {
      files.set(path, Buffer.from(data));
    },
    async mkdir() { /* noop for tests */ },
    async stat(path) {
      if (!files.has(path)) throw new Error('ENOENT');
      return { isFile: () => true };
    },
  };
}

test('mail.latestMessage.get queries Graph inbox deterministically', async () => {
  const { fetchImpl, calls } = createFetchStub([
    () => createResponse({
      value: [
        {
          id: 'msg-1',
          subject: 'Test',
          receivedDateTime: '2024-12-01T10:00:00Z',
          from: { emailAddress: { address: 'sender@example.com' } },
          webLink: 'https://outlook.office.com/mail/',
          bodyPreview: 'Preview',
        },
      ],
    }),
  ]);
  const deps = await createDefaultM365Dependencies({ fetchImpl, accessToken: 'token-123', fs: createFsStub() });
  const handlers = createM365ToolHandlers(deps);
  const result = await handlers['mail.latestMessage.get']({ folderId: 'inbox' });
  assert.equal(result.messageId, 'msg-1');
  assert.equal(result.from, 'sender@example.com');
  assert.ok(calls[0].url.startsWith('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages'));
  assert.ok(calls[0].options.headers.Authorization.includes('token-123'));
});

test('mail.message.replyDraft issues create, patch and send requests', async () => {
  const { fetchImpl, calls } = createFetchStub([
    () => createResponse({ id: 'draft-1', '@odata.etag': 'W/"etag-1"' }),
    () => createResponse({ '@odata.etag': 'W/"etag-2"' }),
    () => createResponse({}),
  ]);
  const deps = await createDefaultM365Dependencies({ fetchImpl, accessToken: 'token-456', fs: createFsStub() });
  const handlers = createM365ToolHandlers(deps);
  const output = await handlers['mail.message.replyDraft']({
    messageId: 'msg-123',
    body: 'Antwort',
    contentType: 'Text',
    preferHeaders: ['return=representation'],
    saveToSentItems: true,
  });
  assert.equal(output.status, 'sent');
  assert.equal(calls.length, 3);
  assert.ok(calls[0].url.includes('/createReply'));
  assert.equal(calls[1].options.method, 'PATCH');
  assert.ok(calls[1].options.headers['If-Match']);
  assert.equal(calls[2].options.method, 'POST');
});

test('excel.workbook.readRange uses workbook session header', async () => {
  const { fetchImpl, calls } = createFetchStub([
    () => createResponse({ sheets: [{ name: 'Sheet1' }] }),
    () => createResponse({ address: 'Sheet1!A1:B2', values: [["A", "B"], ["C", "D"]] }),
  ]);
  const deps = await createDefaultM365Dependencies({ fetchImpl, accessToken: 'token-789', fs: createFsStub() });
  const handlers = createM365ToolHandlers(deps);
  await handlers['excel.workbook.listSheets']({ driveItemId: 'drive-1', workbookSession: 'session-1' });
  const result = await handlers['excel.workbook.readRange']({
    driveItemId: 'drive-1',
    workbookSession: 'session-1',
    sheetName: 'Sheet1',
  });
  assert.equal(result.address, 'Sheet1!A1:B2');
  assert.equal(calls[1].options.headers['workbook-session-id'], 'session-1');
});

test('graph.health.check returns health metadata', async () => {
  const { fetchImpl } = createFetchStub([
    () => createResponse({ id: 'user' }),
  ]);
  const deps = await createDefaultM365Dependencies({ fetchImpl, accessToken: 'token-graph', fs: createFsStub() });
  const result = await deps.graph.healthCheck({ pingEndpoint: 'https://graph.microsoft.com/v1.0/me' });
  assert.equal(result.status, 'healthy');
  assert.ok(result.latencyMs >= 0);
});

test('tooling.feature.toggle stores state deterministically', async () => {
  const deps = await createDefaultM365Dependencies({
    fetchImpl: async () => createResponse({}),
    accessToken: 'token',
    fs: createFsStub(),
  });
  const handlers = createM365ToolHandlers(deps);
  const first = await handlers['tooling.feature.toggle']({ feature: 'mcp', enabled: true, context: { actor: 'test' } });
  assert.equal(first.status, 'updated');
  const second = await handlers['tooling.feature.toggle']({ feature: 'mcp', enabled: false });
  assert.equal(second.enabled, false);
});
