// srv/utils/markdown-converter.js
/**
 * Einfacher Markdown-zu-HTML Konverter für AI-Antworten
 * Speziell optimiert für SAP UI5 FormattedText Component
 */

class MarkdownConverter {
  /**
   * Konvertiert Markdown zu HTML für SAP UI5 FormattedText
   * @param {string} markdown - Markdown Text
   * @returns {string} HTML String
   */
  static convertToHTML(markdown) {
    if (!markdown || typeof markdown !== 'string') {
      return '';
    }

    let html = markdown;

    // 1. Code-Blöcke (müssen zuerst verarbeitet werden)
    html = this.convertCodeBlocks(html);

    // 2. Inline Code
    html = this.convertInlineCode(html);

    // 3. Headers (H1-H3)
    html = this.convertHeaders(html);

    // 4. Bold und Italic
    html = this.convertTextFormatting(html);

    // 5. Listen
    html = this.convertLists(html);

    // 6. Links (falls vorhanden)
    html = this.convertLinks(html);

    // 7. Emojis und Sonderzeichen beibehalten
    html = this.preserveEmojis(html);

    // 8. Zeilenumbrüche (außerhalb geschützter Blöcke)
    html = this.convertLineBreaksSafe(html);

    // 9. SAP UI5 spezifische Optimierungen
    html = this.optimizeForSAPUI5(html);

    return html.trim();
  }

  /**
   * Konvertiert Code-Blöcke: ```language\ncode\n```
   */
  static convertCodeBlocks(text) {
    return text.replace(/```(\w*)\n([\s\S]*?)\n```/g, (match, language, code) => {
      const cleanCode = this.escapeHTML(code.trim());
      return `<div class="ai-code-block">\n        <div class="ai-code-header">${language || 'Code'}</div>\n        <pre class="ai-code-content"><code>${cleanCode}</code></pre>\n      </div>`;
    });
  }

  /**
   * Konvertiert Inline-Code: `code`
   */
  static convertInlineCode(text) {
    return text.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>');
  }

  /**
   * Konvertiert Headers
   */
  static convertHeaders(text) {
    // ### Header 3
    text = text.replace(/^### (.+)$/gm, '<h3 class="ai-header-3">$1</h3>');
    // ## Header 2
    text = text.replace(/^## (.+)$/gm, '<h2 class="ai-header-2">$1</h2>');
    // # Header 1
    text = text.replace(/^# (.+)$/gm, '<h1 class="ai-header-1">$1</h1>');
    return text;
  }

  /**
   * Konvertiert Bold und Italic
   */
  static convertTextFormatting(text) {
    // **Bold**
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong class="ai-bold">$1</strong>');
    // *Italic*
    text = text.replace(/\*([^*]+)\*/g, '<em class="ai-italic">$1</em>');
    return text;
  }

  /**
   * Konvertiert Listen und gruppiert in ul/ol
   */
  static convertLists(text) {
    // Unordered Lists: Zeilenbeginn "- "
    text = text.replace(/^- (.+)$/gm, '<li class="ai-list-item">$1</li>');
    // Wrap consecutive list items in <ul>
    text = text.replace(/(<li class="ai-list-item">[\s\S]*?<\/li>\s*)+/g, (match) => {
      return `<ul class="ai-unordered-list">${match}</ul>`;
    });

    // Numbered Lists: Zeilenbeginn "\d+. "
    text = text.replace(/^\d+\. (.+)$/gm, '<li class="ai-numbered-item">$1</li>');
    // Wrap consecutive numbered items in <ol>
    text = text.replace(/(<li class="ai-numbered-item">[\s\S]*?<\/li>\s*)+/g, (match) => {
      return `<ol class="ai-ordered-list">${match}</ol>`;
    });

    return text;
  }

  /**
   * Konvertiert Markdown-Links [Text](URL)
   */
  static convertLinks(text) {
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="#" class="ai-link" data-url="$2" title="$2">$1</a>');
  }

  /**
   * Behält Emojis bei
   */
  static preserveEmojis(text) {
    return text; // Emojis sind bereits Unicode
  }

  /**
   * Konvertiert Zeilenumbrüche zu <p> / <br/>
   */
  static convertLineBreaks(text) {
    // Doppelte Zeilenumbrüche zu Paragraphen-Grenzen
    text = text.replace(/\n\n+/g, '</p><p class="ai-paragraph">');
    // Einzelne Zeilenumbrüche zu <br/>
    text = text.replace(/\n/g, '<br/>');
    // Wenn kein HTML am Anfang: wrap in Paragraph
    if (!text.startsWith('<') && text.length > 0) {
      text = `<p class="ai-paragraph">${text}</p>`;
    }
    return text;
  }

  /**
   * Konvertiert Zeilenumbrüche außerhalb von <ul>, <ol>, <pre>, <code> und Code-Blöcken
   * und bereinigt überflüssige <br/> innerhalb von Listen.
   */
  static convertLineBreaksSafe(text) {
    if (!text) return text;

    // Schutzblöcke extrahieren
    const blocks = [];
    const save = (m) => {
      const idx = blocks.push(m) - 1;
      return `[[[BLK_${idx}]]]`;
    };

    // Schütze Code-Container, UL/OL und PRE/CODE Bereiche
    text = text
      .replace(/<div class=\"ai-code-block\">[\s\S]*?<\/div>/g, save)
      .replace(/<ul class=\"ai-unordered-list\">[\s\S]*?<\/ul>/g, save)
      .replace(/<ol class=\"ai-ordered-list\">[\s\S]*?<\/ol>/g, save)
      .replace(/<pre[\s\S]*?<\/pre>/g, save)
      .replace(/<code[\s\S]*?<\/code>/g, save);

    // Führe Standard-Zeilenumbruch-Konvertierung auf dem Rest aus
    let out = this.convertLineBreaks(text);

    // Blöcke wiederherstellen
    out = out.replace(/\[\[\[BLK_(\d+)\]\]\]/g, (_, i) => blocks[Number(i)] || '');

    // Bereinigung: Entferne <br/> zwischen Listenpunkten und an UL/OL-Rändern
    out = out
      .replace(/<\/li>\s*<br\s*\/?>(\s*)/gi, '</li>$1')
      .replace(/<ul class=\"ai-unordered-list\">\s*<br\s*\/?>(\s*)/gi, '<ul class="ai-unordered-list">$1')
      .replace(/<ol class=\"ai-ordered-list\">\s*<br\s*\/?>(\s*)/gi, '<ol class="ai-ordered-list">$1')
      .replace(/(\s*)<br\s*\/?>(\s*)<\/ul>/gi, '</ul>')
      .replace(/(\s*)<br\s*\/?>(\s*)<\/ol>/gi, '</ol>')
      .replace(/<\/p>\s*<br\s*\/?>(\s*)/gi, '</p>$1')
      .replace(/<br\s*\/?>(\s*)<p class=\"ai-paragraph\">/gi, '<p class="ai-paragraph">');

    // Entferne leere Paragraphen und überflüssige <p> direkt um Listen
    out = out
      .replace(/<p class=\"ai-paragraph\">\s*<\/p>/g, '')
      .replace(/<p class=\"ai-paragraph\">\s*(<(?:ul|ol)\b[\s\S]*?<\/(?:ul|ol)>)\s*<\/p>/g, '$1')
      .replace(/<(ul|ol)\b([\s\S]*?)>\s*<p class=\"ai-paragraph\">\s*<\/p>\s*<\/(ul|ol)>/g, '<$1$2></$3>');

    // Trim überflüssige <br> / leere <p> am Ende des Inhalts
    out = out
      .replace(/(?:(?:\s*<br\s*\/?>(?:\s|\n)*)|(?:\s*<p[^>]*>\s*<\/p>\s*))+$/gi, '')
      .replace(/\s+$/g, '');

    return out;
  }

  /**
   * SAP UI5 spezifische Optimierungen
   */
  static optimizeForSAPUI5(text) {
    // Entferne leere Paragraphen
    text = text.replace(/<p class=\"ai-paragraph\"><\/p>/g, '');
    // Stelle sicher, dass alle Tags geschlossen sind
    text = this.closeOpenTags(text);
    // Entferne doppelte <br/> innerhalb von Code-Headern/Containern
    text = text.replace(/(<div class=\"ai-code-header\">)\s*<br\s*\/?>(\s*)/g, '$1')
               .replace(/<pre class=\"ai-code-content\">\s*<code>/g, '<pre class="ai-code-content"><code>');
    return text;
  }

  /**
   * HTML Escaping für Code-Blöcke
   */
  static escapeHTML(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Schließt offene Tags (vereinfachte Heuristik)
   */
  static closeOpenTags(html) {
    const openTags = [];
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
    let match;
    while ((match = tagRegex.exec(html)) !== null) {
      if (match[0].startsWith('</')) {
        const tag = match[1].toLowerCase();
        const index = openTags.lastIndexOf(tag);
        if (index !== -1) openTags.splice(index, 1);
      } else {
        openTags.push(match[1].toLowerCase());
      }
    }
    // Schliesse verbleibende Tags in umgekehrter Reihenfolge
    for (let i = openTags.length - 1; i >= 0; i--) {
      html += `</${openTags[i]}>`;
    }
    return html;
  }
}

module.exports = MarkdownConverter;
