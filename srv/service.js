// .env loading optional; CAP usually injects env via process environment

const escapeHtml = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\"/g, '&quot;')
  .replace(/'/g, '&#39;');

function buildHtmlResponse(title, bodyHtml) {
  return [
    '<section style="font-family:Arial,Helvetica,sans-serif">',
    `<h3>${escapeHtml(title)}</h3>`,
    bodyHtml,
    '</section>'
  ].join('\n');
}

async function callChatCompletion(prompt) {
  const { createChatProvider } = require('./chat-provider');
  const client = await createChatProvider();
  const messages = [{ role: 'user', content: String(prompt || '') }];
  const text = await client.complete(messages);
  return {
    text: String(text || '').trim(),
    provider: client.provider,
    modelName: client.modelName
  };
}

module.exports = async (srv) => {
  srv.on('callLLM', async (req) => {
    const { prompt } = req.data || {};

    try {
      const { text, provider, modelName } = await callChatCompletion(prompt);
      const label = provider === 'openrouter'
        ? `${modelName} via OpenRouter`
        : `${modelName} via SAP GenAI Destination`;
      const safeAnswer = escapeHtml(text);
      const html = buildHtmlResponse(`AI Antwort (${escapeHtml(label)})`, `<pre style=\"white-space:pre-wrap\">${safeAnswer}</pre>`);
      return { response: html };
    } catch (e) {
      const reason = e && e.message ? e.message : String(e);
      const configuredProvider = String((process.env.AI_PROVIDER || 'azure')).toLowerCase();
      const hints = configuredProvider === 'openrouter'
        ? [
            '<li>Env Variable \"OPENROUTER_API_KEY\" ist gesetzt.</li>',
            '<li>\"OPENROUTER_MODEL_NAME\" verweist auf ein verfügbares OpenRouter Modell.</li>',
            '<li>HTTPS Zugriff auf https://openrouter.ai ist möglich.</li>'
          ]
        : [
            '<li>Destination \"aicore-destination\" existiert im BTP Destination Service.</li>',
            '<li>Lokale Bindings vorhanden (cds bind destination/aicore) für Hybrid.</li>',
            '<li>Ausgehende Netzwerkverbindung ist erlaubt.</li>'
          ];
      const html = buildHtmlResponse('AI Fehler', [
        `<p>Die Anfrage an den LLM Provider (${escapeHtml(configuredProvider)}) ist fehlgeschlagen.</p>`,
        `<p><b>Grund:</b> ${escapeHtml(reason)}</p>`,
        '<p>Bitte prüfen:</p>',
        `<ul>${hints.join('')}</ul>`
      ].join(''));
      return { response: html };
    }
  });
};
