// Logging helpers: redact sensitive info, safe JSON stringify, and unwrap nested errors

function redact(obj) {
  try {
    const clone = JSON.parse(JSON.stringify(obj || {}));
    const headers = clone?.headers || clone?.response?.headers;
    const findHeader = (k) => headers && Object.keys(headers).find((h) => String(h).toLowerCase() === k);
    const authKey = findHeader('authorization');
    if (authKey) headers[authKey] = '***';
    const cookieKey = findHeader('cookie');
    if (cookieKey) headers[cookieKey] = '***';
    if (clone?.access_token) clone.access_token = '***';
    if (clone?.token) clone.token = '***';
    if (clone?.apiKey) clone.apiKey = '***';
    return clone;
  } catch {
    return undefined;
  }
}

function safeJson(x, max = 4000) {
  try {
    const s = typeof x === 'string' ? x : JSON.stringify(x);
    return s.length > max ? s.slice(0, max) + ' …[truncated]' : s;
  } catch {
    try { return String(x); } catch { return '[unprintable]'; }
  }
}

function unwrapError(err, maxDepth = 5) {
  const chain = [];
  let cur = err;
  let depth = 0;
  while (cur && depth < maxDepth) {
    chain.push({
      name: cur?.name,
      message: cur?.message,
      code: cur?.code ?? cur?.status ?? cur?.statusCode,
      responseStatus: cur?.response?.status ?? cur?.response?.statusCode,
      responseData: cur?.response?.data ?? cur?.response?.body,
      responseHeaders: redact(cur?.response?.headers),
      url: cur?.config?.url ?? cur?.options?.url,
      method: cur?.config?.method ?? cur?.options?.method,
      params: cur?.config?.params,
      requestData: cur?.config?.data,
    });
    cur = cur?.cause;
    depth += 1;
  }
  return chain;
}

module.exports = { redact, safeJson, unwrapError };

