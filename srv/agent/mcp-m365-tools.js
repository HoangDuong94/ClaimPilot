const { createM365ToolManifest } = require('./mcp-tool-manifest');

function assertFunction(fn, message) {
  if (typeof fn !== 'function') {
    throw new Error(message);
  }
}

function normaliseMessageSender(from) {
  if (!from) return undefined;
  if (typeof from === 'string') return from;
  if (from.emailAddress && typeof from.emailAddress.address === 'string') {
    return from.emailAddress.address;
  }
  if (typeof from.address === 'string') return from.address;
  if (typeof from.email === 'string') return from.email;
  return undefined;
}

function createM365ToolHandlers(dependencies = {}) {
  const manifest = createM365ToolManifest();
  const handlers = {};

  const mailDeps = dependencies.mail || {};
  const calendarDeps = dependencies.calendar || {};
  const driveDeps = dependencies.drive || {};
  const excelDeps = dependencies.excel || {};
  const graphDeps = dependencies.graph || {};
  const toolingDeps = dependencies.tooling || {};

  const PLACEHOLDER_SESSIONS = new Set(['default', 'session', 'persistent', 'initial', 'shared']);
  const COLUMN_RANGE_PATTERN = /^[a-z]+:[a-z]+$/i;
  const COLUMN_ONLY_FALLBACK_ROWS = 200;

  function normaliseWorkbookSession(value) {
    if (!value) return undefined;
    const candidate = typeof value === 'string' ? value : (value && value.id ? String(value.id) : String(value));
    const trimmed = candidate.trim();
    if (!trimmed) return undefined;
    const lowered = trimmed.toLowerCase();
    if (PLACEHOLDER_SESSIONS.has(lowered)) return undefined;
    if (/^session-?\d+$/i.test(trimmed)) return undefined;
    if (trimmed.length <= 8) return undefined;
    if (trimmed.length < 20) return undefined;
    return trimmed;
  }

  function normaliseRangeArguments({ sheetName, range, valuesOnly }) {
    if (range == null) {
      return { range: undefined, valuesOnly };
    }
    if (typeof range !== 'string') {
      return { range, valuesOnly };
    }
    const trimmed = range.trim();
    if (!trimmed) {
      return { range: undefined, valuesOnly };
    }
    if (/^usedrange$/i.test(trimmed)) {
      return { range: undefined, valuesOnly: true };
    }
    if (COLUMN_RANGE_PATTERN.test(trimmed.replace(/\s+/g, ''))) {
      const [rawStart, rawEnd] = trimmed.split(':');
      const startCol = rawStart.replace(/[^a-z]/gi, '').toUpperCase();
      const endCol = rawEnd.replace(/[^a-z]/gi, '').toUpperCase() || startCol;
      if (sheetName) {
        return { range: undefined, valuesOnly: true };
      }
      const safeStart = startCol || 'A';
      const safeEnd = endCol || safeStart;
      const boundedRange = `${safeStart}1:${safeEnd}${COLUMN_ONLY_FALLBACK_ROWS}`;
      return { range: boundedRange, valuesOnly };
    }
    return { range: trimmed, valuesOnly };
  }

  handlers['mail.latestMessage.get'] = async ({ folderId = 'inbox', select, includeBodyPreview = false } = {}) => {
    assertFunction(mailDeps.getLatestMessage, 'mail.getLatestMessage dependency missing');
    const result = await mailDeps.getLatestMessage({ folderId, select, includeBodyPreview });
    if (!result) return null;
    const from = normaliseMessageSender(result.from);
    const messageId = result.id || result.messageId;
    return {
      messageId,
      subject: result.subject,
      receivedDateTime: result.receivedDateTime,
      from,
      webLink: result.webLink,
      bodyPreview: result.bodyPreview,
    };
  };

  handlers['mail.message.fetch'] = async ({ messageId, preferTextBody = true, expandAttachments = false } = {}) => {
    if (!messageId) throw new Error('messageId is required');
    assertFunction(mailDeps.fetchMessage, 'mail.fetchMessage dependency missing');
    const result = await mailDeps.fetchMessage({ messageId, preferTextBody, expandAttachments });
    if (!result) return null;
    return {
      messageId: result.id || result.messageId || messageId,
      subject: result.subject,
      body: result.body,
      headers: result.headers,
      attachments: result.attachments,
    };
  };

  handlers['mail.message.replyDraft'] = async ({
    messageId,
    body,
    contentType = 'Text',
    preferHeaders,
    saveToSentItems = true,
  } = {}) => {
    if (!messageId) throw new Error('messageId is required');
    if (typeof body !== 'string' || !body) throw new Error('body is required');
    assertFunction(mailDeps.createReplyDraft, 'mail.createReplyDraft dependency missing');
    assertFunction(mailDeps.patchDraftBody, 'mail.patchDraftBody dependency missing');
    assertFunction(mailDeps.sendDraft, 'mail.sendDraft dependency missing');

    const { draftId, etag } = await mailDeps.createReplyDraft({ messageId, preferHeaders });
    if (!draftId) {
      throw new Error('createReplyDraft must return { draftId, etag }');
    }
    const patchResult = await mailDeps.patchDraftBody({ draftId, body, contentType, etag, preferHeaders });
    const finalEtag = (patchResult && patchResult.etag) || etag;
    await mailDeps.sendDraft({ draftId, saveToSentItems, preferHeaders });
    return { status: 'sent', draftId, etag: finalEtag };
  };

  handlers['mail.message.send'] = async ({
    subject,
    body,
    to,
    bodyContentType = 'Text',
    internetHeaders,
    attachments,
    saveToSentItems = true,
  } = {}) => {
    if (!Array.isArray(to) || to.length === 0) throw new Error('to must contain at least one recipient');
    if (typeof subject !== 'string') throw new Error('subject is required');
    if (typeof body !== 'string') throw new Error('body is required');
    assertFunction(mailDeps.sendMessage, 'mail.sendMessage dependency missing');
    const result = await mailDeps.sendMessage({ subject, body, bodyContentType, to, internetHeaders, attachments, saveToSentItems });
    return {
      status: 'sent',
      internetMessageId: result && result.internetMessageId,
    };
  };

  handlers['mail.attachment.download'] = async ({ messageId, attachmentId, targetPath } = {}) => {
    if (!messageId) throw new Error('messageId is required');
    if (!attachmentId) throw new Error('attachmentId is required');
    if (!targetPath) throw new Error('targetPath is required');
    assertFunction(mailDeps.downloadAttachment, 'mail.downloadAttachment dependency missing');
    const result = await mailDeps.downloadAttachment({ messageId, attachmentId, targetPath });
    return {
      status: 'saved',
      filePath: result && result.filePath ? result.filePath : targetPath,
    };
  };

  handlers['mail.attachment.uploadAndAttach'] = async ({ messageId, filePath, contentType } = {}) => {
    if (!messageId) throw new Error('messageId is required');
    if (!filePath) throw new Error('filePath is required');
    assertFunction(mailDeps.uploadAndAttach, 'mail.uploadAndAttach dependency missing');
    const result = await mailDeps.uploadAndAttach({ messageId, filePath, contentType });
    return {
      status: 'attached',
      attachmentId: result && result.attachmentId,
    };
  };

  handlers['calendar.events.list'] = async ({ startDateTime, endDateTime, calendarId } = {}) => {
    if (!startDateTime || !endDateTime) throw new Error('startDateTime and endDateTime are required');
    assertFunction(calendarDeps.listEvents, 'calendar.listEvents dependency missing');
    const result = await calendarDeps.listEvents({ startDateTime, endDateTime, calendarId });
    return { events: (result && result.events) || result || [] };
  };

  handlers['calendar.event.createOrUpdate'] = async ({ eventId, subject, body, start, end, attendees, location } = {}) => {
    if (!subject) throw new Error('subject is required');
    if (!start || !end) throw new Error('start and end are required');
    assertFunction(calendarDeps.createOrUpdateEvent, 'calendar.createOrUpdateEvent dependency missing');
    const result = await calendarDeps.createOrUpdateEvent({ eventId, subject, body, start, end, attendees, location });
    const status = eventId ? 'updated' : 'created';
    return {
      status,
      eventId: (result && result.eventId) || result || eventId,
    };
  };

  handlers['calendar.event.cancel'] = async ({ eventId, comment } = {}) => {
    if (!eventId) throw new Error('eventId is required');
    assertFunction(calendarDeps.cancelEvent, 'calendar.cancelEvent dependency missing');
    await calendarDeps.cancelEvent({ eventId, comment });
    return { status: 'cancelled', eventId };
  };

  handlers['drive.file.upload'] = async ({ sourcePath, drivePath, conflictBehavior = 'replace' } = {}) => {
    if (!sourcePath) throw new Error('sourcePath is required');
    if (!drivePath) throw new Error('drivePath is required');
    assertFunction(driveDeps.uploadFile, 'drive.uploadFile dependency missing');
    const result = await driveDeps.uploadFile({ sourcePath, drivePath, conflictBehavior });
    return {
      status: 'uploaded',
      driveItemId: result && result.driveItemId,
    };
  };

  handlers['excel.workbook.listSheets'] = async ({ driveItemId, workbookSession } = {}) => {
    if (!driveItemId) throw new Error('driveItemId is required');
    assertFunction(excelDeps.listSheets, 'excel.listSheets dependency missing');
    const session = normaliseWorkbookSession(workbookSession);
    const result = await excelDeps.listSheets({ driveItemId, workbookSession: session });
    return { sheets: (result && result.sheets) || result || [] };
  };

  handlers['excel.workbook.readRange'] = async ({
    driveItemId,
    workbookSession,
    sheetName,
    range,
    valuesOnly = true,
    preferValues = false,
  } = {}) => {
    if (!driveItemId) throw new Error('driveItemId is required');
    assertFunction(excelDeps.readRange, 'excel.readRange dependency missing');
    const session = normaliseWorkbookSession(workbookSession);
    const normalisedRange = normaliseRangeArguments({ sheetName, range, valuesOnly });
    const result = await excelDeps.readRange({
      driveItemId,
      workbookSession: session,
      sheetName,
      range: normalisedRange.range,
      valuesOnly: normalisedRange.valuesOnly,
      preferValues,
    });
    if (!result) return { address: undefined, values: [] };
    return {
      address: result.address,
      values: result.values,
    };
  };

  handlers['excel.workbook.updateRange'] = async ({
    driveItemId,
    workbookSession,
    sheetName,
    range,
    values,
    matchExpected,
  } = {}) => {
    if (!driveItemId) throw new Error('driveItemId is required');
    if (!sheetName) throw new Error('sheetName is required');
    if (!range) throw new Error('range is required');
    if (!Array.isArray(values)) throw new Error('values must be an array of rows');
    assertFunction(excelDeps.updateRange, 'excel.updateRange dependency missing');
    const session = normaliseWorkbookSession(workbookSession);
    const result = await excelDeps.updateRange({ driveItemId, workbookSession: session, sheetName, range, values, matchExpected });
    return {
      status: 'updated',
      modifiedRange: result && result.modifiedRange ? result.modifiedRange : range,
    };
  };

  handlers['graph.health.check'] = async ({ pingEndpoint } = {}) => {
    assertFunction(graphDeps.healthCheck, 'graph.healthCheck dependency missing');
    return graphDeps.healthCheck({ pingEndpoint });
  };

  handlers['graph.token.acquire'] = async ({ scopeSet } = {}) => {
    if (!Array.isArray(scopeSet) || scopeSet.length === 0) throw new Error('scopeSet must contain at least one scope');
    assertFunction(graphDeps.acquireToken, 'graph.acquireToken dependency missing');
    const result = await graphDeps.acquireToken({ scopeSet });
    return {
      status: 'acquired',
      expiresOn: result && result.expiresOn,
    };
  };

  handlers['tooling.feature.toggle'] = async ({ feature, enabled, context } = {}) => {
    if (!feature) throw new Error('feature is required');
    if (typeof enabled !== 'boolean') throw new Error('enabled flag must be boolean');
    assertFunction(toolingDeps.updateFeatureToggle, 'tooling.updateFeatureToggle dependency missing');
    const result = await toolingDeps.updateFeatureToggle({ feature, enabled, context });
    return {
      status: 'updated',
      feature,
      enabled,
      context,
      updatedAt: result && result.updatedAt,
    };
  };

  // Ensure handlers cover every manifest tool to keep runtime alignment
  for (const tool of manifest.tools) {
    if (!handlers[tool.name]) {
      throw new Error(`Missing handler implementation for ${tool.name}`);
    }
  }

  return handlers;
}

module.exports = { createM365ToolHandlers };
