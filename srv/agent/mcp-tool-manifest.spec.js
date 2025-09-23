const test = require('node:test');
const assert = require('node:assert/strict');

function loadFactory() {
  return require('./mcp-tool-manifest').createM365ToolManifest;
}

test('manifest enumerates the expected M365 tool names exactly once', () => {
  const createM365ToolManifest = loadFactory();
  const manifest = createM365ToolManifest();
  assert.equal(manifest.namespace, 'm365');
  assert.match(manifest.version, /^0\.\d+\.\d+$/);
  const toolNames = manifest.tools.map((tool) => tool.name);
  const expected = [
    'mail.latestMessage.get',
    'mail.message.fetch',
    'mail.message.replyDraft',
    'mail.message.send',
    'mail.attachment.download',
    'mail.attachment.uploadAndAttach',
    'calendar.events.list',
    'calendar.event.createOrUpdate',
    'calendar.event.cancel',
    'drive.file.upload',
    'excel.workbook.listSheets',
    'excel.workbook.readRange',
    'excel.workbook.updateRange',
    'graph.health.check',
    'graph.token.acquire',
    'tooling.feature.toggle',
  ];
  assert.deepEqual(toolNames.sort(), [...new Set(toolNames)].sort(), 'tool names must be unique');
  for (const name of expected) {
    assert.ok(toolNames.includes(name), `manifest is missing tool ${name}`);
  }
});

test('replyDraft tool schema requires messageId and body with deterministic defaults', () => {
  const createM365ToolManifest = loadFactory();
  const manifest = createM365ToolManifest();
  const replyDraft = manifest.tools.find((tool) => tool.name === 'mail.message.replyDraft');
  assert.ok(replyDraft, 'mail.message.replyDraft tool not found');
  assert.equal(replyDraft.metadata.category, 'mail');
  assert.equal(replyDraft.metadata.deterministic, true);
  assert.deepEqual(replyDraft.metadata.scopes, ['Mail.ReadWrite', 'Mail.Send']);
  const { inputSchema } = replyDraft;
  assert.ok(inputSchema, 'replyDraft input schema missing');
  assert.deepEqual(inputSchema.type, 'object');
  assert.ok(Array.isArray(inputSchema.required), 'replyDraft required array missing');
  assert.ok(inputSchema.required.includes('messageId'));
  assert.ok(inputSchema.required.includes('body'));
  assert.deepEqual(Object.keys(inputSchema.properties), [
    'messageId',
    'body',
    'contentType',
    'preferHeaders',
    'saveToSentItems',
  ]);
  assert.equal(inputSchema.properties.messageId.type, 'string');
  assert.equal(inputSchema.properties.body.type, 'string');
  assert.equal(inputSchema.properties.contentType.enum[0], 'Text');
  assert.equal(replyDraft.outputSchema.properties.status.enum[0], 'sent');
});

test('excel read range schema surfaces sheetName and range controls', () => {
  const createM365ToolManifest = loadFactory();
  const manifest = createM365ToolManifest();
  const readRange = manifest.tools.find((tool) => tool.name === 'excel.workbook.readRange');
  assert.ok(readRange, 'excel.workbook.readRange tool not found');
  assert.equal(readRange.metadata.category, 'excel');
  assert.deepEqual(readRange.metadata.scopes, ['Files.ReadWrite.All']);
  const { inputSchema } = readRange;
  assert.equal(inputSchema.type, 'object');
  assert.ok(inputSchema.required.includes('driveItemId'));
  assert.ok(inputSchema.required.includes('workbookSession')); // ensures deterministic session handling
  assert.ok(Object.prototype.hasOwnProperty.call(inputSchema.properties, 'sheetName'));
  assert.ok(Object.prototype.hasOwnProperty.call(inputSchema.properties, 'range'));
  assert.ok(Object.prototype.hasOwnProperty.call(inputSchema.properties, 'valuesOnly'));
  assert.equal(inputSchema.properties.valuesOnly.type, 'boolean');
  assert.deepEqual(readRange.outputSchema.properties.values.type, 'array');
});

test('every tool declares deterministic metadata and scopes array', () => {
  const createM365ToolManifest = loadFactory();
  const manifest = createM365ToolManifest();
  for (const tool of manifest.tools) {
    assert.equal(tool.metadata.deterministic, true, `${tool.name} must be deterministic`);
    assert.ok(Array.isArray(tool.metadata.scopes), `${tool.name} metadata.scopes must be an array`);
    assert.ok(tool.description && tool.description.length > 10, `${tool.name} needs a helpful description`);
  }
});
