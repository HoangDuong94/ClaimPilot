const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const { createInProcessToolDefinitions } = require('./mcp-tool-registry');
const { createM365ToolManifest } = require('./mcp-tool-manifest');

test('builder returns descriptors for manifest tools', () => {
  const manifest = createM365ToolManifest();
  const descriptors = createInProcessToolDefinitions({
    manifest,
    callTool: async () => ({}),
    z,
  });
  const names = descriptors.map((d) => d.name);
  assert.ok(names.includes('mail.message.replyDraft'));
  const reply = descriptors.find((d) => d.name === 'mail.message.replyDraft');
  assert.equal(reply.metadata.category, 'mail');
  assert.equal(typeof reply.invoke, 'function');
  assert.equal(typeof reply.zodSchema.parse, 'function');
});

test('descriptor invoke delegates to callTool with provided arguments', async () => {
  const manifest = createM365ToolManifest();
  const calls = [];
  const descriptors = createInProcessToolDefinitions({
    manifest,
    callTool: async ({ name, args }) => {
      calls.push({ name, args });
      return { ok: true };
    },
    z,
  });
  const tool = descriptors.find((d) => d.name === 'mail.latestMessage.get');
  await tool.invoke({ folderId: 'Inbox' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { name: 'mail.latestMessage.get', args: { folderId: 'Inbox' } });
});

test('zod schema enforces required fields from JSON schema', () => {
  const manifest = createM365ToolManifest();
  const descriptors = createInProcessToolDefinitions({ manifest, callTool: async () => ({}), z });
  const reply = descriptors.find((d) => d.name === 'mail.message.replyDraft');
  assert.throws(() => reply.zodSchema.parse({ body: 'Test' }), /Required/);
  const parsed = reply.zodSchema.parse({ messageId: '123', body: 'Test' });
  assert.equal(parsed.messageId, '123');
});
