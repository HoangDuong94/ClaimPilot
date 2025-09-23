const test = require('node:test');
const assert = require('node:assert/strict');

function buildM365Deps() {
  return {
    mail: {
      async getLatestMessage({ folderId }) {
        return {
          id: 'msg-1',
          subject: 'Inbox hello',
          receivedDateTime: '2024-12-01T08:00:00Z',
          from: { emailAddress: { address: 'sender@example.com' } },
          webLink: 'https://outlook.office.com/mail/0',
          bodyPreview: 'Body preview',
        };
      },
    },
    calendar: {},
    drive: {},
    excel: {},
    graph: {},
    tooling: {},
  };
}

test('initAllMCPClients creates in-process m365 client when dependencies provided', async () => {
  delete require.cache[require.resolve('./mcp-clients')];
  const { initAllMCPClients } = require('./mcp-clients');
  const clients = await initAllMCPClients({
    m365: { dependencies: buildM365Deps() },
    disableDefaults: true,
  });
  assert.ok(clients.m365, 'Expected m365 client to be initialised');
  const result = await clients.m365.callTool({
    name: 'mail.latestMessage.get',
    arguments: { folderId: 'Inbox' },
  });
  assert.equal(result.from, 'sender@example.com');
  assert.equal(result.messageId, 'msg-1');
});

test('initAllMCPClients exposes manifest metadata on in-process client', async () => {
  delete require.cache[require.resolve('./mcp-clients')];
  const { initAllMCPClients } = require('./mcp-clients');
  const clients = await initAllMCPClients({
    m365: { dependencies: buildM365Deps() },
    disableDefaults: true,
  });
  const manifest = await clients.m365.listTools();
  assert.ok(Array.isArray(manifest.tools), 'manifest must contain tools array');
  const replyDraft = manifest.tools.find((tool) => tool.name === 'mail.message.replyDraft');
  assert.ok(replyDraft, 'manifest should include replyDraft tool');
  assert.equal(replyDraft.metadata.deterministic, true);
});

test('initAllMCPClients throws helpful error for unknown tool name', async () => {
  delete require.cache[require.resolve('./mcp-clients')];
  const { initAllMCPClients } = require('./mcp-clients');
  const clients = await initAllMCPClients({
    m365: { dependencies: buildM365Deps() },
    disableDefaults: true,
  });
  await assert.rejects(async () => {
    await clients.m365.callTool({ name: 'unknown.tool', arguments: {} });
  }, /unknown MCP tool: unknown\.tool/);
});
