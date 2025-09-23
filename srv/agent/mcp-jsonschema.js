function jsonSchemaToZod(schema, z) {
  if (!schema || typeof schema !== 'object') {
    throw new Error('schema must be an object');
  }
  if (!z || typeof z !== 'object') {
    throw new Error('zod instance is required');
  }

  function convert(current) {
    if (!current || typeof current !== 'object') {
      throw new Error('Invalid JSON schema node');
    }

    if (current.enum) {
      const values = current.enum;
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error('enum must be a non-empty array');
      }
      if (values.every((value) => typeof value === 'string')) {
        return z.enum(values);
      }
      return z.union(values.map((value) => z.literal(value)));
    }

    if (Array.isArray(current.type)) {
      const variants = current.type.map((typeVariant) => convert({
        ...current,
        type: typeVariant,
        enum: undefined,
      }));
      return z.union(variants);
    }

    switch (current.type) {
      case 'string': {
        let base = z.string();
        if (current.format === 'date-time') {
          base = base.refine((value) => !Number.isNaN(Date.parse(value)), {
            message: 'Invalid date-time format',
          });
        }
        return applyCommon(base, current);
      }
      case 'number':
      case 'integer': {
        let base = current.type === 'integer' ? z.number().int() : z.number();
        if (typeof current.minimum === 'number') base = base.min(current.minimum);
        if (typeof current.maximum === 'number') base = base.max(current.maximum);
        return applyCommon(base, current);
      }
      case 'boolean':
        return applyCommon(z.boolean(), current);
      case 'null':
        return z.null();
      case 'array': {
        const itemSchema = current.items ? convert(current.items) : z.any();
        let base = z.array(itemSchema);
        if (typeof current.minItems === 'number') base = base.min(current.minItems);
        if (typeof current.maxItems === 'number') base = base.max(current.maxItems);
        return applyCommon(base, current);
      }
      case 'object': {
        const props = current.properties || {};
        const required = new Set(current.required || []);
        const shape = {};
        for (const [key, propertySchema] of Object.entries(props)) {
          let propZod = convert(propertySchema);
          const isRequired = required.has(key);
          const hasDefault = Object.prototype.hasOwnProperty.call(propertySchema, 'default');
          if (!isRequired) {
            propZod = propZod.optional();
          }
          if (hasDefault) {
            propZod = propZod.default(propertySchema.default);
          }
          shape[key] = propZod;
        }
        let base = z.object(shape);
        if (current.additionalProperties === true) {
          base = base.passthrough();
        } else if (current.additionalProperties === false) {
          base = base.strict();
        }
        return applyCommon(base, current);
      }
      default:
        return applyCommon(z.any(), current);
    }
  }

  function applyCommon(base, node) {
    let schema = base;
    if (Object.prototype.hasOwnProperty.call(node, 'default')) {
      schema = schema.default(node.default);
    }
    if (node.nullable) {
      schema = schema.nullable();
    }
    return schema;
  }

  return convert(schema);
}

module.exports = { jsonSchemaToZod };
