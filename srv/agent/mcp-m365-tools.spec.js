const test = require('node:test');
const assert = require('node:assert/strict');

function loadFactory() {
  return require('./mcp-m365-tools').createM365ToolHandlers;
}

test('creates handlers that align with manifest tool names', () => {
  const createM365ToolHandlers = loadFactory();
  const manifest = require('./mcp-tool-manifest').createM365ToolManifest();
  const handlers = createM365ToolHandlers({
    mail: {}, calendar: {}, drive: {}, excel: {}, graph: {}, tooling: {}
  });
  const handlerNames = Object.keys(handlers).sort();
  const manifestNames = manifest.tools.map((tool) => tool.name).sort();
  assert.deepEqual(handlerNames, manifestNames);
});

test('mail.latestMessage.get delegates to dependency and normalises output', async () => {
  const createM365ToolHandlers = loadFactory();
  let receivedArgs;
  const handlers = createM365ToolHandlers({
    mail: {
      async getLatestMessage(args) {
        receivedArgs = args;
        return {
          id: '123',
          subject: 'Test',
          receivedDateTime: '2024-12-01T10:00:00Z',
          from: { emailAddress: { address: 'sender@example.com' } },
          webLink: 'https://outlook.office.com/foo',
          bodyPreview: 'Hello'
        };
      }
    },
    calendar: {}, drive: {}, excel: {}, graph: {}, tooling: {}
  });
  const result = await handlers['mail.latestMessage.get']({ folderId: 'Inbox' });
  assert.equal(receivedArgs.folderId, 'Inbox');
  assert.deepEqual(result, {
    messageId: '123',
    subject: 'Test',
    receivedDateTime: '2024-12-01T10:00:00Z',
    from: 'sender@example.com',
    webLink: 'https://outlook.office.com/foo',
    bodyPreview: 'Hello'
  });
});

test('mail.message.replyDraft composes create, patch and send operations', async () => {
  const createM365ToolHandlers = loadFactory();
  const calls = [];
  const handlers = createM365ToolHandlers({
    mail: {
      async createReplyDraft({ messageId }) {
        calls.push(['createReplyDraft', { messageId }]);
        return { draftId: 'draft-1', etag: 'etag-1' };
      },
      async patchDraftBody({ draftId, body, contentType, etag, preferHeaders }) {
        calls.push(['patchDraftBody', { draftId, body, contentType, etag, preferHeaders }]);
        return { etag: 'etag-2' };
      },
      async sendDraft({ draftId, saveToSentItems, preferHeaders }) {
        calls.push(['sendDraft', { draftId, saveToSentItems, preferHeaders }]);
        return { internetMessageId: '<message-id@example.com>' };
      }
    },
    calendar: {}, drive: {}, excel: {}, graph: {}, tooling: {}
  });
  const output = await handlers['mail.message.replyDraft']({
    messageId: 'abc',
    body: 'Antwortinhalt',
    contentType: 'Text',
    preferHeaders: ['return=representation'],
    saveToSentItems: false
  });
  assert.deepEqual(calls, [
    ['createReplyDraft', { messageId: 'abc' }],
    ['patchDraftBody', {
      draftId: 'draft-1',
      body: 'Antwortinhalt',
      contentType: 'Text',
      etag: 'etag-1',
      preferHeaders: ['return=representation']
    }],
    ['sendDraft', {
      draftId: 'draft-1',
      saveToSentItems: false,
      preferHeaders: ['return=representation']
    }]
  ]);
  assert.deepEqual(output, {
    status: 'sent',
    draftId: 'draft-1',
    etag: 'etag-2'
  });
});

test('excel.workbook.readRange forwards defaults and returns structured values', async () => {
  const createM365ToolHandlers = loadFactory();
  let received;
  const handlers = createM365ToolHandlers({
    mail: {}, calendar: {}, drive: {},
    excel: {
      async readRange(args) {
        received = args;
        return {
          address: "Tabelle1!A1:B2",
          values: [["A", "B"], ["C", "D"]]
        };
      }
    },
    graph: {}, tooling: {}
  });
  const validSession = '12345678-1234-1234-1234-1234567890ab';
  const result = await handlers['excel.workbook.readRange']({
    driveItemId: 'drive-1',
    workbookSession: validSession,
    sheetName: 'Tabelle1'
  });
  assert.deepEqual(received, {
    driveItemId: 'drive-1',
    workbookSession: validSession,
    sheetName: 'Tabelle1',
    range: undefined,
    valuesOnly: true,
    preferValues: false
  });
  assert.deepEqual(result, {
    address: 'Tabelle1!A1:B2',
    values: [["A", "B"], ["C", "D"]]
  });
});

test('excel.workbook tools allow missing workbook session', async () => {
  const createM365ToolHandlers = loadFactory();
  const captured = { listSheets: null, readRange: null };
  const handlers = createM365ToolHandlers({
    mail: {}, calendar: {}, drive: {},
    excel: {
      async listSheets(args) {
        captured.listSheets = args;
        return { sheets: ['Sheet1'] };
      },
      async readRange(args) {
        captured.readRange = args;
        return { address: 'Sheet1!A1:B2', values: [['A']] };
      },
    },
    graph: {}, tooling: {}
  });
  const sheetResult = await handlers['excel.workbook.listSheets']({ driveItemId: 'drive-1' });
  const rangeResult = await handlers['excel.workbook.readRange']({ driveItemId: 'drive-1' });
  assert.deepEqual(sheetResult, { sheets: ['Sheet1'] });
  assert.deepEqual(rangeResult, { address: 'Sheet1!A1:B2', values: [['A']] });
  assert.equal(captured.listSheets.workbookSession, undefined);
  assert.equal(captured.readRange.workbookSession, undefined);
});

test('excel workbook handlers drop placeholder workbook sessions', async () => {
  const createM365ToolHandlers = loadFactory();
  const captured = { listSheets: null, readRange: null };
  const handlers = createM365ToolHandlers({
    mail: {}, calendar: {}, drive: {},
    excel: {
      async listSheets(args) {
        captured.listSheets = args;
        return { sheets: [] };
      },
      async readRange(args) {
        captured.readRange = args;
        return { address: 'Sheet1!A1:A1', values: [['x']] };
      },
    },
    graph: {}, tooling: {}
  });
  await handlers['excel.workbook.listSheets']({ driveItemId: 'drive-1', workbookSession: 'default' });
  await handlers['excel.workbook.readRange']({ driveItemId: 'drive-1', workbookSession: 'session', sheetName: 'Sheet1' });
  assert.equal(captured.listSheets.workbookSession, undefined);
  assert.equal(captured.readRange.workbookSession, undefined);
});

test('excel workbook handlers drop short workbook sessions', async () => {
  const createM365ToolHandlers = loadFactory();
  const captured = { listSheets: null, readRange: null };
  const handlers = createM365ToolHandlers({
    mail: {}, calendar: {}, drive: {},
    excel: {
      async listSheets(args) {
        captured.listSheets = args;
        return { sheets: [] };
      },
      async readRange(args) {
        captured.readRange = args;
        return { address: 'Sheet1!A1:A1', values: [['x']] };
      },
    },
    graph: {}, tooling: {}
  });
  await handlers['excel.workbook.listSheets']({ driveItemId: 'drive-1', workbookSession: 'initial' });
  await handlers['excel.workbook.readRange']({ driveItemId: 'drive-1', workbookSession: 'initial', sheetName: 'Sheet1', range: 'A1:A1' });
  assert.equal(captured.listSheets.workbookSession, undefined);
  assert.equal(captured.readRange.workbookSession, undefined);
});

test('excel.workbook.readRange normalises column-only ranges to reasonable defaults', async () => {
  const createM365ToolHandlers = loadFactory();
  const captured = [];
  const handlers = createM365ToolHandlers({
    mail: {}, calendar: {}, drive: {},
    excel: {
      async readRange(args) {
        captured.push(args);
        return { address: 'Sheet1!A1:B10', values: [['x']] };
      },
    },
    graph: {}, tooling: {}
  });
  await handlers['excel.workbook.readRange']({
    driveItemId: 'drive-1',
    sheetName: 'Sheet1',
    range: 'A:Z',
    valuesOnly: false,
  });
  await handlers['excel.workbook.readRange']({
    driveItemId: 'drive-1',
    range: 'A:Z',
  });
  const [sheetCall, workbookCall] = captured;
  assert.equal(sheetCall.range, undefined);
  assert.equal(sheetCall.valuesOnly, true);
  assert.equal(workbookCall.range, 'A1:Z200');
});

test('excel.workbook.readRange interprets "usedRange" inputs correctly', async () => {
  const createM365ToolHandlers = loadFactory();
  let received;
  const handlers = createM365ToolHandlers({
    mail: {}, calendar: {}, drive: {},
    excel: {
      async readRange(args) {
        received = args;
        return { address: 'Sheet1!A1:B2', values: [['ok']] };
      },
    },
    graph: {}, tooling: {}
  });
  await handlers['excel.workbook.readRange']({
    driveItemId: 'drive-1',
    sheetName: 'Sheet1',
    range: 'usedRange',
    valuesOnly: false,
  });
  assert.equal(received.range, undefined);
  assert.equal(received.valuesOnly, true);
});

test('graph.health.check bubbles dependency output', async () => {
  const createM365ToolHandlers = loadFactory();
  const handlers = createM365ToolHandlers({
    mail: {}, calendar: {}, drive: {}, excel: {},
    graph: {
      async healthCheck({ pingEndpoint }) {
        return { status: 'healthy', latencyMs: 50, pingEndpoint };
      }
    },
    tooling: {}
  });
  const result = await handlers['graph.health.check']({ pingEndpoint: 'https://graph.microsoft.com/v1.0/me' });
  assert.deepEqual(result, { status: 'healthy', latencyMs: 50, pingEndpoint: 'https://graph.microsoft.com/v1.0/me' });
});

test('tooling.feature.toggle delegates and ensures deterministic response', async () => {
  const createM365ToolHandlers = loadFactory();
  const handlers = createM365ToolHandlers({
    mail: {}, calendar: {}, drive: {}, excel: {}, graph: {},
    tooling: {
      async updateFeatureToggle({ feature, enabled, context }) {
        return { feature, enabled, context, updatedAt: 'now' };
      }
    }
  });
  const result = await handlers['tooling.feature.toggle']({ feature: 'mcp', enabled: true, context: { actor: 'test' } });
  assert.deepEqual(result, { status: 'updated', feature: 'mcp', enabled: true, context: { actor: 'test' }, updatedAt: 'now' });
});
