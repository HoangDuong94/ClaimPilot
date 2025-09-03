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

async function callSAPGenAIHubViaLangChain(prompt) {
  const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/langchain');
  const destinationName = process.env.AI_DESTINATION_NAME || 'aicore-destination';
  const modelName = process.env.AI_MODEL_NAME || 'gpt-4.1';

  const chat = new AzureOpenAiChatClient(
    { modelName, temperature: 0.3 },
    { destinationName }
  );

  const res = await chat.invoke(String(prompt || ''));
  const content = typeof res.content === 'string'
    ? res.content
    : Array.isArray(res.content)
      ? res.content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('')
      : '';
  return String(content || '').trim();
}

module.exports = async (srv) => {
  srv.on('callLLM', async (req) => {
    const { prompt } = req.data || {};

    try {
      const answer = await callSAPGenAIHubViaLangChain(prompt);
      const safeAnswer = escapeHtml(answer);
      const html = buildHtmlResponse('AI Antwort (GPT-4.1 via SAP GenAI LangChain)', `<pre style=\"white-space:pre-wrap\">${safeAnswer}</pre>`);
      return { response: html };
    } catch (e) {
      const reason = e && e.message ? e.message : String(e);
      const html = buildHtmlResponse('AI Fehler', [
        '<p>Die Anfrage an SAP GenAI (LangChain, AzureOpenAiChatClient) ist fehlgeschlagen.</p>',
        `<p><b>Grund:</b> ${escapeHtml(reason)}</p>`,
        '<p>Bitte prüfen:</p>',
        '<ul>',
        '<li>Destination \"aicore-destination\" existiert im BTP Destination Service.</li>',
        '<li>Lokale Bindings vorhanden (cds bind destination/aicore) für Hybrid.</li>',
        '<li>Ausgehende Netzwerkverbindung ist erlaubt.</li>',
        '</ul>'
      ].join(''));
      return { response: html };
    }
  });
};
