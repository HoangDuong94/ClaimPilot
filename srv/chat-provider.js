'use strict';

const DEFAULT_TEMP = 0.3;
const DEFAULT_PROVIDER = 'azure';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

function parseTemperature(raw) {
  if (raw == null) return DEFAULT_TEMP;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  return DEFAULT_TEMP;
}

function parseOptionalNumber(raw) {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [{ role: 'user', content: '' }];
  }
  return messages.map(msg => {
    const role = typeof msg?.role === 'string' ? msg.role : 'user';
    const content = msg?.content;
    if (typeof content === 'string') {
      return { role, content };
    }
    if (Array.isArray(content)) {
      const joined = content.map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        if (part && typeof part.value === 'string') return part.value;
        return '';
      }).join('');
      return { role, content: joined };
    }
    if (content && typeof content.text === 'string') {
      return { role, content: content.text };
    }
    return { role, content: content == null ? '' : String(content) };
  });
}

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      if (part && typeof part.value === 'string') return part.value;
      return '';
    }).join('');
  }
  if (content && typeof content.text === 'string') return content.text;
  if (content && typeof content.value === 'string') return content.value;
  return content == null ? '' : String(content);
}

async function createChatProvider(options = {}) {
  const providerEnv = options.provider || process.env.AI_PROVIDER || DEFAULT_PROVIDER;
  const provider = String(providerEnv || DEFAULT_PROVIDER).toLowerCase();
  const temperature = parseTemperature(options.temperature != null ? options.temperature : process.env.AI_TEMPERATURE);
  const maxCompletionTokens = parseOptionalNumber(
    options.maxCompletionTokens != null ? options.maxCompletionTokens : process.env.AI_MAX_COMPLETION_TOKENS
  );
  if (provider === 'openrouter') {
    const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw Object.assign(new Error('OPENROUTER_API_KEY is not configured'), { provider });
    }
    const modelName = options.modelName
      || process.env.OPENROUTER_MODEL_NAME
      || process.env.AI_MODEL_NAME
      || 'openai/gpt-4o-mini';
    const baseURL = options.baseURL || process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL;
    const headers = {};
    const referer = options.referer || process.env.OPENROUTER_HTTP_REFERER;
    const title = options.appTitle || process.env.OPENROUTER_APP_TITLE;
    if (referer) headers['HTTP-Referer'] = referer;
    if (title) headers['X-Title'] = title;

    const OpenAI = require('openai');
    const openaiClient = new OpenAI({
      apiKey,
      baseURL,
      defaultHeaders: Object.keys(headers).length ? headers : undefined
    });
    const { ChatOpenAI } = await import('@langchain/openai');
    const langchainModel = new ChatOpenAI({
      model: modelName,
      temperature,
      apiKey,
      maxCompletionTokens,
      configuration: {
        baseURL,
        defaultHeaders: Object.keys(headers).length ? headers : undefined
      }
    });

    return {
      provider,
      modelName,
      temperature,
      langchain: langchainModel,
      async *stream(messages) {
        const normalized = normalizeMessages(messages);
        const response = await openaiClient.chat.completions.create({
          model: modelName,
          messages: normalized,
          temperature,
          max_tokens: maxCompletionTokens,
          stream: true
        });
        for await (const part of response) {
          const piece = part?.choices?.[0]?.delta?.content;
          if (piece) yield piece;
        }
      },
      async complete(messages) {
        const normalized = normalizeMessages(messages);
        const result = await openaiClient.chat.completions.create({
          model: modelName,
          messages: normalized,
          temperature,
          max_tokens: maxCompletionTokens
        });
        return result?.choices?.[0]?.message?.content || '';
      }
    };
  }

  const destinationName = options.destinationName || process.env.AI_DESTINATION_NAME || 'aicore-destination';
  const modelName = options.modelName || process.env.AI_MODEL_NAME || 'gpt-4.1';
  const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/langchain');
  const azureConfig = { modelName, temperature };
  if (maxCompletionTokens !== undefined) {
    azureConfig.maxCompletionTokens = maxCompletionTokens;
  }
  const azureClient = new AzureOpenAiChatClient(azureConfig, { destinationName });

  return {
    provider: 'azure',
    modelName,
    temperature,
    destinationName,
    langchain: azureClient,
    async *stream(messages) {
      const normalized = normalizeMessages(messages);
      const stream = await azureClient.stream(normalized);
      for await (const chunk of stream) {
        const piece = extractTextContent(chunk?.content);
        if (piece) yield piece;
      }
    },
    async complete(messages) {
      const normalized = normalizeMessages(messages);
      const result = await azureClient.invoke(normalized);
      return extractTextContent(result?.content);
    }
  };
}

module.exports = {
  createChatProvider
};
