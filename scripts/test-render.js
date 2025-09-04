#!/usr/bin/env node

function renderMarkdownToHtml(input) {
  const escapeHtml = (s) => String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  if (input == null) return '';
  let src = String(input).replace(/\r\n/g, "\n");

  // Extract fenced code blocks
  const blocks = [];
  src = src.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (m, lang, code) => {
    const idx = blocks.push({ lang: lang || '', code }) - 1;
    return `[[[CODE_BLOCK_${idx}]]]`;
  });
  src = src.replace(/~~~([a-zA-Z0-9_-]*)\n([\s\S]*?)~~~/g, (m, lang, code) => {
    const idx = blocks.push({ lang: lang || '', code }) - 1;
    return `[[[CODE_BLOCK_${idx}]]]`;
  });

  let html = escapeHtml(src);

  // Inline code
  html = html.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // Italic with underscores
  html = html.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  // Inline numbered bullets after punctuation
  html = html.replace(/([:\.\)!\]])(\s*)(\d+\.\s+)/g, '$1\n$3');
  // Inline hyphen bullets after punctuation
  html = html.replace(/([:\.\)!\]])(\s*)(-\s+)/g, '$1\n$3');

  // Linkify
  html = html.replace(/(https?:\/\/[^\s<]+[^<\.,:;"')\]\s])/g, '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>');

  const lineify = (text) => {
    const lines = text.split(/\n/);
    const out = [];
    for (let line of lines) {
      if (/^\s*-\s+/.test(line)) {
        const content = line.replace(/^\s*-\s+/, '');
        out.push(`<span class=\"cp-li\">• ${content}</span>`);
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        out.push(`<span class=\"cp-li cp-li-num\">${line.trim()}</span>`);
        continue;
      }
      if (line.trim() === '') { out.push(''); continue; }
      out.push(line);
    }
    return out.join('\n');
  };
  html = lineify(html);

  html = html.replace(/\n\n+/g, '<br/><br/>' );
  html = html.replace(/\n/g, '<br/>' );

  // Restore code blocks
  html = html.replace(/\[\[\[CODE_BLOCK_(\d+)\]\]\]/g, (m, i) => {
    const blk = blocks[Number(i)] || { lang: '', code: '' };
    const content = escapeHtml(blk.code);
    return `<pre><code data-lang="${blk.lang}">${content}</code></pre>`;
  });

  return html;
}

const input = process.argv.slice(2).join(' ') || 'Natürlich! Hier sind fünf Punkte über BTS:1. **Wer sie sind:** BTS (Bangtan Sonyeondan oder "Bangtan Boys") ist eine südkoreanische Boygroup, die 2013 von Big Hit Entertainment gegründet wurde.2. **Mitglieder:** Die Gruppe besteht aus sieben Mitgliedern: RM, Jin, Suga, J-Hope, Jimin, V und Jungkook.3. **Musikstil:** BTS ist bekannt für eine Mischung aus K-Pop, Hip-Hop, R&B und EDM. Ihre Texte behandeln oft gesellschaftliche Themen, persönliche Kämpfe und Selbstliebe.4. **Erfolge:** BTS hat zahlreiche internationale Auszeichnungen gewonnen, darunter Billboard Music Awards und American Music Awards. Sie waren die erste K-Pop-Gruppe, die auf Platz 1 der US Billboard 200 landete.5. **Soziales Engagement:** Die Gruppe engagiert sich sozial, zum Beispiel mit der "Love Myself"-Kampagne in Zusammenarbeit mit UNICEF gegen Gewalt an Kindern und Jugendlichen.';

console.log(renderMarkdownToHtml(input));
