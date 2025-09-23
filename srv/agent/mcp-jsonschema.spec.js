const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const { jsonSchemaToZod } = require('./mcp-jsonschema');

test('jsonSchemaToZod converts object schema with required fields', () => {
  const schema = {
    type: 'object',
    required: ['foo', 'flag'],
    properties: {
      foo: { type: 'string' },
      flag: { type: 'boolean', default: true },
      optional: { type: 'number' },
    },
  };
  const zodSchema = jsonSchemaToZod(schema, z);
  const parsed = zodSchema.parse({ foo: 'bar', flag: false });
  assert.deepEqual(parsed, { foo: 'bar', flag: false });
  assert.throws(() => zodSchema.parse({ flag: true }), /Required/);
});

test('jsonSchemaToZod handles arrays of strings', () => {
  const schema = {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  };
  const zodSchema = jsonSchemaToZod(schema, z);
  const parsed = zodSchema.parse({ items: ['a', 'b'] });
  assert.deepEqual(parsed.items, ['a', 'b']);
  assert.throws(() => zodSchema.parse({ items: [1] }), /Expected string/);
});

test('jsonSchemaToZod handles nested array union values', () => {
  const schema = {
    type: 'object',
    required: ['values'],
    properties: {
      values: {
        type: 'array',
        items: {
          type: 'array',
          items: { type: ['string', 'number', 'null'] },
        },
      },
    },
  };
  const zodSchema = jsonSchemaToZod(schema, z);
  const parsed = zodSchema.parse({ values: [['a', null], [1, 2]] });
  assert.equal(parsed.values[0][0], 'a');
  assert.throws(() => zodSchema.parse({ values: [[{ foo: 'bar' }]] }), /Expected string|number|null/);
});
