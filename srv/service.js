const escapeHtml = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

module.exports = async (srv) => {
  srv.on('callLLM', async (req) => {
    const { prompt } = req.data || {};
    const safe = escapeHtml(prompt || '');
    const html = [
      '<section style="font-family:Arial,Helvetica,sans-serif">',
      '<h3>AI Placeholder</h3>',
      '<p>Die LLM-Integration folgt später. Aktueller Prompt:</p>',
      `<pre style="white-space:pre-wrap">${safe}</pre>`,
      '<p>Nutzen Sie die OData Action <code>callLLM</code> mit dem Feld <code>prompt</code>. Die Antwort wird als HTML in <code>response</code> zurückgegeben.</p>',
      '</section>'
    ].join('\n');
    return { response: html };
  });
};

