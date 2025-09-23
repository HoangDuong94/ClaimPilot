sap.ui.define([
  "sap/ui/core/Component",
  "sap/ui/core/ComponentContainer",
  "sap/ui/layout/Splitter",
  "sap/ui/layout/SplitterLayoutData",
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/m/App",
  "sap/m/Page",
  "sap/m/Panel"
], function (Component, ComponentContainer, Splitter, SplitterLayoutData, Fragment, JSONModel, Filter, App, Page, Panel) {
  "use strict";

  const chatManager = {
    chatModel: null,
    feAppComponentInstance: null,
    rightPane: null,
    _currentAbortController: null,
    isMentionOpen: false,
    _mentionTokenStart: null,
    _mentionCursor: null,
    _mentionValue: '',
    _mentionFilter: '',

    // Render a safe, readable HTML from LLM markdown/plain responses
    // opts: { autoParagraphMode: 'fallback' | 'never' }
    renderMarkdownToHtml: function (input, opts) {
      const autoParagraphMode = (opts && opts.autoParagraphMode) || 'fallback';
      const escapeHtml = (s) => String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

      if (input == null) return "";
      let src = String(input).replace(/\r\n/g, "\n");

      // Extract fenced code blocks first (```lang\n...```) and ~~~ blocks
      const blocks = [];
      src = src.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (m, lang, code) => {
        const idx = blocks.push({ lang: lang || "", code }) - 1;
        // Use an underscore-free placeholder so emphasis regexes don't alter it
        return `[[[CODEBLOCK${idx}]]]`;
      });
      src = src.replace(/~~~([a-zA-Z0-9_-]*)\n([\s\S]*?)~~~/g, (m, lang, code) => {
        const idx = blocks.push({ lang: lang || "", code }) - 1;
        return `[[[CODEBLOCK${idx}]]]`;
      });

      // Pre-escape normalization to honor real paragraph cues
      // 1) Inline horizontal rule markers like ":---" → add newlines around
      src = src.replace(/\s*---\s*/g, '\n---\n');
      // 2) New paragraph when a sentence ends followed by a German opening quote „
      src = src.replace(/([\.!?])\s*„/g, '$1\n\n„');

      // Normalize before escaping: promote single newline after sentence end to paragraph (fallback mode only)
      if (autoParagraphMode !== 'never') {
        src = src.replace(/([\.!?])\n(\s*[A-ZÄÖÜ0-9])/g, '$1\n\n$2');
      }

      // Heuristic auto-paragraphing for long plain text (no existing paragraphs/lists)
      const autoParagraph = (text) => {
        if (/\n\n/.test(text)) return text;
        if (/(^|\n)\s*(?:[-*]\s+|\d+[\.)]\s+)/m.test(text)) return text; // skip if list markers present
        let out = '';
        let i = 0;
        let sentencesInPara = 0;
        let paraStartLen = 0;
        const isUpper = (ch) => /[A-ZÄÖÜ]/.test(ch || '');
        while (i < text.length) {
          const ch = text[i];
          out += ch;
          if (ch === '.' || ch === '!' || ch === '?') {
            // collect following whitespace
            let j = i + 1; let ws = '';
            while (j < text.length && /\s/.test(text[j])) { ws += text[j]; j++; }
            const next = text[j];
            if (isUpper(next)) {
              sentencesInPara++;
              const paraLen = out.length - paraStartLen;
              const insertBreak = sentencesInPara >= 3 || paraLen >= 240;
              out += insertBreak ? "\n\n" : " ";
              if (insertBreak) { sentencesInPara = 0; paraStartLen = out.length; }
              i = j; // skip consumed whitespace
              continue;
            }
          }
          i++;
        }
        return out;
      };

      if (autoParagraphMode !== 'never') {
        src = autoParagraph(src);
      }

      // Interpret Markdown hard line break (two spaces + newline) as paragraph boundary
      try { src = src.replace(/ {2}\n/g, '\n\n'); } catch (e) { /* ignore */ }

      // Escape remaining HTML
      let html = escapeHtml(src);

      // Horizontal rule markers
      html = html.replace(/(^|\n)\s*[-*_]{3,}\s*(?=\n|$)/g, '$1<hr/>');

      // Inline code
      html = html.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);

      // Basic bold (**text**) → use <strong>
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // Basic italic with underscores _text_
      html = html.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');

      // Insert line breaks before inline-numbered bullets like ":1. ", ".2. " when not at start of line
      html = html.replace(/([:\.\)!\]])(\s*)(\d+\.\s+)/g, '$1\n$3');
      // Also before inline hyphen bullets like ":- "
      html = html.replace(/([:\.\)!\]])(\s*)(-\s+)/g, '$1\n$3');

      // Headings (# ...)
      html = html.replace(/(^|\n)######\s+(.+?)(?=\n|$)/g, '$1<h6>$2<\/h6>');
      html = html.replace(/(^|\n)#####\s+(.+?)(?=\n|$)/g, '$1<h5>$2<\/h5>');
      html = html.replace(/(^|\n)####\s+(.+?)(?=\n|$)/g, '$1<h4>$2<\/h4>');
      html = html.replace(/(^|\n)###\s+(.+?)(?=\n|$)/g, '$1<h3>$2<\/h3>');
      html = html.replace(/(^|\n)##\s+(.+?)(?=\n|$)/g, '$1<h2>$2<\/h2>');
      html = html.replace(/(^|\n)#\s+(.+?)(?=\n|$)/g, '$1<h1>$2<\/h1>');

      // Linkify URLs
      html = html.replace(/(https?:\/\/[^\s<]+[^<\.,:;"')\]\s])/g, '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>');

      // Ensure bold headings are visually separated when jammed inline (strong)
      html = html.replace(/([:\.\!\?])\s*<strong>/g, '$1<br/><br/><strong>');
      html = html.replace(/<\/strong>(\S)/g, '</strong><br/><br/>$1');

      // Line formatting: group consecutive bullets and quotes into readable blocks; avoid <ul>/<ol>
      const lineify = (text) => {
        const lines = text.split(/\n/);
        const out = [];
        let list = [];
        let quote = [];
        const flushList = () => {
          if (!list.length) return;
          const body = list.join('<br/>');
          out.push(`<p>${body}</p>`);
          list = [];
        };
        const flushQuote = () => {
          if (!quote.length) return;
          const body = quote.join('<br/>');
          out.push(`<blockquote>${body}</blockquote>`);
          quote = [];
        };
        for (let raw of lines) {
          const line = raw; // already escaped
          if (/^\s*-\s+/.test(line)) {
            flushQuote();
            const content = line.replace(/^\s*-\s+/, '');
            list.push(`• ${content}`);
            continue;
          }
          if (/^\s*\d+[\.)]\s+/.test(line)) {
            flushQuote();
            list.push(`${line.trim()}`);
            continue;
          }
          if (/^\s*>\s+/.test(line)) {
            flushList();
            const content = line.replace(/^\s*>\s+/, '');
            quote.push(content);
            continue;
          }
          // non-bullet/quote line
          flushList(); flushQuote();
          if (line.trim() === '') {
            out.push(''); // will become paragraph gap
          } else {
            const trimmed = line.trim();
            if (trimmed === '<hr/>' || /^<h[1-6][^>]*>.*<\/h[1-6]>$/.test(trimmed)) {
              out.push(trimmed);
            } else {
              out.push(`<p>${line}</p>`);
            }
          }
        }
        flushList(); flushQuote();
        return out.join('');
      };
      html = lineify(html);

      // Line breaks: only apply if keine Block-Tags vorhanden (sonst entfernen)
      if (!/(<p|<blockquote|<hr\/?|<h[1-6])/i.test(html)) {
        html = html.replace(/\n\n+/g, '<br/><br/>' );
        html = html.replace(/\n/g, '<br/>' );
      } else {
        html = html.replace(/\n+/g, '');
      }

      // Post-process: if a paragraph begins with a strong title followed by two <br/>, split into separate paragraphs
      html = html.replace(/<p><strong>([^<]+)<\/strong><br\/><br\/>/g, '<p><strong>$1<\/strong><\/p><p>');

      // Restore fenced code blocks (escaped inside)
      html = html.replace(/\[\[\[CODEBLOCK(\d+)\]\]\]/g, (m, i) => {
        const blk = blocks[Number(i)] || { lang: '', code: '' };
        const content = escapeHtml(blk.code);
        return `<pre><code data-lang="${blk.lang}">${content}</code></pre>`;
      });

      return html;
    },

    _generateThreadId: function () {
      try {
        const rnd = Math.random().toString(36).slice(2, 10);
        return 't-' + Date.now().toString(36) + '-' + rnd;
      } catch (e) {
        return 't-' + Date.now();
      }
    },

    initModel: function () {
      this.chatModel = new JSONModel({
        threadId: this._generateThreadId(),
        chatHistory: [
          // initial welcome message removed
        ],
        userInput: "",
        isTyping: false,
        isStreaming: false,
        statusMessage: "",
        showSuggestions: false,
        lastTrace: null,
        lastStreamText: '',
        lastStreamHtml: '',
        suggestions: [
          { text: "Zeige mir die neueste Mail aus dem Posteingang." },
          { text: "Antworte auf die letzte Mail und bitte um fehlende Dokumente." },
          { text: "Welche Termine stehen diese Woche im Kalender?" },
          { text: "Lies die Tabelle 'Stammtisch Planung' aus der Excel im OneDrive." }
        ]
      });
    },

    resetConversation: function () {
      try {
        if (this._currentAbortController) {
          this._currentAbortController.abort();
        }
      } catch (e) { /* ignore */ }
      this._currentAbortController = null;

      if (!this.chatModel) { return; }
      this.chatModel.setProperty("/threadId", this._generateThreadId());
      this.chatModel.setProperty("/chatHistory", []);
      this.chatModel.setProperty("/userInput", "");
      this.chatModel.setProperty("/isStreaming", false);
      this.chatModel.setProperty("/isTyping", false);
      this.chatModel.setProperty("/statusMessage", "");
      this.chatModel.setProperty("/showSuggestions", false);
      this.chatModel.setProperty("/lastTrace", null);
      this.chatModel.setProperty("/lastStreamText", '');
      this.chatModel.setProperty("/lastStreamHtml", '');
      this.chatModel.refresh(true);
    },

    addMessage: function (type, text) {
      const history = this.chatModel.getProperty("/chatHistory");
      const prev = history[history.length - 1];
      const groupStart = !prev || prev.type !== type;
      history.push({ type, text, groupStart });
      this.chatModel.setProperty("/chatHistory", history);
      this.chatModel.refresh(true);
      setTimeout(function () {
        try {
          const sc = sap.ui.core.Fragment.byId("chatSidePanelFragmentGlobal", "chatHistoryScrollContainerInSidePanel");
          sc && sc.scrollTo(0, 99999, 200);
        } catch (e) { /* ignore */ }
      }, 100);
    },

    sendViaODataAction: async function (prompt) {
      if (!this.feAppComponentInstance) {
        throw new Error("FE Component not available");
      }
      const oDataModel = this.feAppComponentInstance.getModel();
      if (!oDataModel) {
        throw new Error("OData Model not found");
      }
      const op = oDataModel.bindContext("/callLLM(...)");
      op.setParameter("prompt", prompt);
      await op.execute();
      const ctx = op.getBoundContext();
      const result = ctx.getObject();
      return (result && result.response) || "<i>Keine Antwort</i>";
    },

    sendViaStreaming: async function (prompt) {
      const url = "/ai/agent/stream";
      const ac = new AbortController();
      this._currentAbortController = ac;
      this.chatModel.setProperty("/isStreaming", true);
      this.chatModel.setProperty("/lastTrace", null);
      this.chatModel.setProperty("/lastStreamText", '');
      this.chatModel.setProperty("/lastStreamHtml", '');
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, threadId: this.chatModel.getProperty("/threadId") }),
        signal: ac.signal
      });
      if (!resp.ok || !resp.body) {
        this.chatModel.setProperty("/isStreaming", false);
        throw new Error("Streaming Response not OK");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";
      // Deep-Chat-inspired streaming: partial paragraph rendering + throttle
      let lastParaBoundary = 0; // index in accumulated where the last completed paragraph ends (points to first char after boundary)
      let renderedPrefixHtml = ""; // cached HTML for completed paragraphs
      let scheduled = false;
      let pendingUpdate = false;

      const scheduleRender = () => {
        if (scheduled) { pendingUpdate = true; return; }
        scheduled = true;
        setTimeout(() => {
          try {
            // finalize any newly completed paragraphs since lastParaBoundary
            // treat double newline as paragraph boundary
            const boundaryRegex = /\n\n+/g;
            boundaryRegex.lastIndex = lastParaBoundary;
            let match;
            while ((match = boundaryRegex.exec(accumulated)) !== null) {
              const para = accumulated.slice(lastParaBoundary, match.index);
              if (para) {
                renderedPrefixHtml += this.renderMarkdownToHtml(para, { autoParagraphMode: 'never' }) + '<br/><br/>';
              } else {
                renderedPrefixHtml += '<br/><br/>';
              }
              lastParaBoundary = match.index + match[0].length;
            }
            const tail = accumulated.slice(lastParaBoundary);
            const tailHtml = this.renderMarkdownToHtml(tail, { autoParagraphMode: 'fallback' });
            const html = renderedPrefixHtml + tailHtml;
            updateAssistant(html);
          } finally {
            scheduled = false;
            if (pendingUpdate) { pendingUpdate = false; scheduleRender(); }
          }
        }, 40); // ~25 FPS
      };

      // ensure last assistant placeholder exists
      const history = this.chatModel.getProperty("/chatHistory");
      if (!history.length || history[history.length - 1].type !== "assistant") {
        this.addMessage("assistant", "<i>Thinking...</i>");
      }

      const updateAssistant = (html) => {
        if (html == null || String(html).trim() === "") return;
        const h = this.chatModel.getProperty("/chatHistory");
        h[h.length - 1] = { type: "assistant", text: html };
        this.chatModel.setProperty("/chatHistory", h);
        this.chatModel.refresh(true);
      };

      // Heuristic: insert missing newlines before bullet/number markers while streaming
      const normalizeBulletsStreaming = (prev, chunk) => {
        if (!chunk) return chunk;
        let s = String(chunk);
        try {
          // If chunk starts with a list marker and previous text didn't end with a newline, prepend one
          if (prev && !/\n$/.test(prev) && /^(\s*)(?:[-*•]\s+|\d+\.\s+)/.test(s)) {
            s = "\n" + s;
          }
          // Insert newline before inline list markers (hyphen/star/bullet and numbered)
          s = s.replace(/([^\n])(?=(?:[-*•]\s+))/g, '$1\n');
          s = s.replace(/([^\n])(?=\d+\.\s+)/g, '$1\n');
        } catch (e) { /* best-effort; ignore */ }
        return s;
      };

      try {
        while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          // extract one SSE event block (can contain multiple data: lines)
          let raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (!raw) continue;
          const lines = raw.split(/\r?\n/);
          let eventName = null;
          const dataLines = [];
          for (const ln of lines) {
            if (!ln) continue;
            if (ln.startsWith('event:')) {
              eventName = ln.slice(6).trim();
              continue;
            }
            if (ln.startsWith('data:')) {
              let d = ln.slice(5);
              if (d.startsWith(' ')) d = d.slice(1);
              dataLines.push(d);
            }
          }
          if (!dataLines.length) continue;
          let data = dataLines.join('\n');
          // SSE spec: append newline after each data line; remove final trailing newline to keep behaviour
          if (data.endsWith('\n')) data = data.slice(0, -1);

          if (eventName === 'trace') {
            try {
              const tracePayload = JSON.parse(data);
              this.chatModel.setProperty('/lastTrace', tracePayload);
              this.chatModel.refresh(true);
            } catch (e) { /* ignore malformed trace */ }
            continue;
          }

          if (eventName === 'error') {
            try {
              const err = JSON.parse(data);
              reader.cancel();
              throw new Error(err && err.message ? err.message : 'Agent error');
            } catch (e) {
              reader.cancel();
              throw new Error(typeof data === 'string' && data ? data : 'Agent error');
            }
          }

          if (eventName === 'end' || data.trim() === "[DONE]") { reader.cancel(); break; }

          // If server sends JSON chunks, try to extract a content field; otherwise append as-is
          let toAppend = null;
          if (data.startsWith("{") || data.startsWith("[")) {
            try {
              const obj = JSON.parse(data);
              // Only append visible content fields; ignore tool/event JSON payloads
              toAppend = obj.delta || obj.content || obj.text || null;
            } catch (e) {
              toAppend = null;
            }
          }
          // Interpret empty data events as line breaks (common with SSE token streams)
          let piece = (toAppend != null ? toAppend : data);
          // Apply streaming bullet normalization heuristics
          piece = normalizeBulletsStreaming(accumulated, piece);
          accumulated += (piece === "" ? "\n" : piece);
          scheduleRender();
        }
      }
        // finalize full render once stream completes
        // flush any remaining cached paragraphs and tail
        // recompute to be safe
        renderedPrefixHtml = ""; lastParaBoundary = 0;
        const boundaryRegex = /\n\n+/g;
        let match;
        while ((match = boundaryRegex.exec(accumulated)) !== null) {
          const para = accumulated.slice(lastParaBoundary, match.index);
          renderedPrefixHtml += this.renderMarkdownToHtml(para, { autoParagraphMode: 'never' }) + '<br/><br/>';
          lastParaBoundary = match.index + match[0].length;
        }
        const tail = accumulated.slice(lastParaBoundary);
        const tailHtml = boundaryRegex.test(accumulated)
          ? this.renderMarkdownToHtml(tail, { autoParagraphMode: 'never' })
          : this.renderMarkdownToHtml(tail, { autoParagraphMode: 'fallback' });
        const finalHtml = renderedPrefixHtml + tailHtml;
        this.chatModel.setProperty('/lastStreamText', accumulated);
        this.chatModel.setProperty('/lastStreamHtml', finalHtml);
        return { html: finalHtml, text: accumulated };
      } finally {
        this.chatModel.setProperty("/isStreaming", false);
        this.chatModel.setProperty("/showSuggestions", false);
        this._currentAbortController = null;
      }
    }
  };

  const chatController = {
    onSendChatMessageInSidePanel: async function (overrideText) {
      let providedText = overrideText;
      this._closeMentionPopover();
      if (providedText && typeof providedText === "object") {
        const isEventLike =
          (providedText.isA && providedText.isA("sap.ui.base.Event")) ||
          typeof providedText.getSource === "function" ||
          typeof providedText.getParameters === "function" ||
          Object.prototype.hasOwnProperty.call(providedText, "mParameters");
        if (isEventLike) {
          providedText = null;
        }
      }
      const text = (providedText != null ? String(providedText) : (chatManager.chatModel.getProperty("/userInput") || "")).trim();
      if (!text) { return; }
      chatManager.chatModel.setProperty("/userInput", "");
      chatManager.chatModel.setProperty("/statusMessage", "");
      // Escape user text for safe HTML display in FormattedText
      const escapeHtml = (s) => String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
      chatManager.addMessage("user", escapeHtml(text));
      chatManager.addMessage("assistant", "<i>Thinking...</i>");
      chatManager.chatModel.setProperty("/showSuggestions", false);
      try {
        let resp; let usedStreaming = false;
        try {
          resp = await chatManager.sendViaStreaming(text);
          usedStreaming = true;
        } catch (e) {
          resp = await chatManager.sendViaODataAction(text);
        }
        // replace last thinking message
        const history = chatManager.chatModel.getProperty("/chatHistory");
        history.pop();
        const finalHtml = (usedStreaming && resp && typeof resp.text === 'string')
          ? chatManager.renderMarkdownToHtml(resp.text)
          : ((typeof resp === 'string' && /\s*</.test(resp)) ? resp : chatManager.renderMarkdownToHtml(resp));
        // We just removed an assistant placeholder, so this is not a new group
        history.push({ type: "assistant", text: finalHtml, groupStart: false });
        chatManager.chatModel.setProperty("/chatHistory", history);
        chatManager.chatModel.refresh(true);
      } catch (e) {
        const history = chatManager.chatModel.getProperty("/chatHistory");
        history.pop();
        history.push({ type: "assistant", text: "<b>Fehler:</b> " + (e && e.message || e), groupStart: false });
        chatManager.chatModel.setProperty("/chatHistory", history);
        chatManager.chatModel.refresh(true);
      }
    },

    onStopStreaming: function () {
      try {
        if (chatManager._currentAbortController) {
          chatManager._currentAbortController.abort();
        }
      } catch (e) { /* ignore */ }
    },

    onClearChat: function () {
      this._closeMentionPopover();
      chatManager.resetConversation();
    },

    onCopyMessage: function (oEvent) {
      try {
        const ctx = oEvent.getSource().getBindingContext("chat");
        const text = ctx && ctx.getProperty("text");
        if (!text) return;
        const tmp = document.createElement("textarea");
        tmp.value = text.replace(/<[^>]+>/g, "");
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand("copy");
        document.body.removeChild(tmp);
      } catch (e) { /* ignore */ }
    },

    onRetryMessage: function (oEvent) {
      try {
        const ctx = oEvent.getSource().getBindingContext("chat");
        const text = ctx && ctx.getProperty("text");
        if (text) {
          this.onSendChatMessageInSidePanel(text);
        }
      } catch (e) { /* ignore */ }
    },

    onInputLiveChange: function (oEvent) {
      const value = oEvent.getParameter("value");
      chatManager.chatModel.setProperty("/userInput", value);
      this._refreshMentionSuggestions(oEvent.getSource());
    },

    onMentionPopoverClosed: function () {
      this._resetMentionState();
    },

    onMentionItemPress: function (oEvent) {
      const item = oEvent.getSource && oEvent.getSource();
      if (!item) { return; }
      const ctx = item.getBindingContext("chat");
      const selectedText = ctx && ctx.getProperty("text");
      if (!selectedText) {
        this._closeMentionPopover();
        return;
      }
      this._applyMentionSelection(selectedText);
    },

    onMentionListItemPress: function (oEvent) {
      const item = oEvent.getParameter && oEvent.getParameter('listItem');
      if (!item) { return; }
      const ctx = item.getBindingContext("chat");
      const selectedText = ctx && ctx.getProperty("text");
      if (!selectedText) {
        this._closeMentionPopover();
        return;
      }
      this._applyMentionSelection(selectedText);
    },

    _getInputControl: function () {
      try { return sap.ui.core.Fragment.byId("chatSidePanelFragmentGlobal", "chatInputField"); }
      catch (e) { return null; }
    },

    _getMentionPopover: function () {
      try { return sap.ui.core.Fragment.byId("chatSidePanelFragmentGlobal", "mentionPopover"); }
      catch (e) { return null; }
    },

    _getMentionList: function () {
      try { return sap.ui.core.Fragment.byId("chatSidePanelFragmentGlobal", "mentionList"); }
      catch (e) { return null; }
    },

    _handleInputKeydown: function (ev, inputControl) {
      const popover = this._getMentionPopover();
      const mentionOpen = chatManager.isMentionOpen && popover && popover.isOpen();

      if (mentionOpen) {
        if (ev.key === 'ArrowDown' || ev.key === 'Tab') {
          ev.preventDefault();
          this._moveMentionSelection(1);
          return;
        }
        if (ev.key === 'ArrowUp' || (ev.shiftKey && ev.key === 'Tab')) {
          ev.preventDefault();
          this._moveMentionSelection(-1);
          return;
        }
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
          ev.preventDefault();
          const list = this._getMentionList();
          let item = list && list.getSelectedItem ? list.getSelectedItem() : null;
          if (!item && list && list.getItems) {
            const items = list.getItems();
            item = items && items.length ? items[0] : null;
          }
          if (item) {
            const ctx = item.getBindingContext("chat");
            const selectedText = ctx && ctx.getProperty("text");
            this._applyMentionSelection(selectedText);
          } else {
            this._closeMentionPopover();
          }
          return;
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          this._closeMentionPopover();
          return;
        }
      }

      if (ev.key === "Enter" && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        ev.preventDefault();
        const val = inputControl.getValue();
        chatManager.chatModel.setProperty("/userInput", val);
        if (typeof inputControl.fireChange === 'function') {
          inputControl.fireChange({ value: val });
        }
        this.onSendChatMessageInSidePanel(val);
        return;
      }

      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) {
        setTimeout(() => {
          try { this._refreshMentionSuggestions(inputControl); }
          catch (e0) { /* ignore */ }
        }, 0);
      }
    },

    _moveMentionSelection: function (step) {
      const list = this._getMentionList();
      if (!list || !list.getItems) { return; }
      const items = list.getItems();
      if (!items.length) { return; }
      const current = list.getSelectedItem ? list.getSelectedItem() : null;
      let idx = current ? items.indexOf(current) : -1;
      if (idx === -1) {
        idx = step > 0 ? 0 : items.length - 1;
      } else {
        idx = (idx + step + items.length) % items.length;
      }
      if (list.setSelectedItem) {
        list.setSelectedItem(items[idx], true);
      }
    },

    _refreshMentionSuggestions: function (oTextArea) {
      if (!oTextArea || typeof oTextArea.getValue !== 'function') {
        this._closeMentionPopover();
        return;
      }
      const domRef = oTextArea.getFocusDomRef && oTextArea.getFocusDomRef();
      if (!domRef || domRef.selectionStart == null) {
        this._closeMentionPopover();
        return;
      }
      const value = oTextArea.getValue() || '';
      const cursor = domRef.selectionStart != null ? domRef.selectionStart : (chatManager._mentionCursor != null ? chatManager._mentionCursor : value.length);
      const tokenStart = this._locateMentionTokenStart(value, cursor);
      if (tokenStart === -1) {
        this._closeMentionPopover();
        return;
      }

      const filterValueRaw = value.slice(tokenStart + 1, cursor);
      const filterValue = filterValueRaw.trim().toLowerCase();

      const popover = this._getMentionPopover();
      const list = this._getMentionList();
      if (!popover || !list) { return; }

      const binding = list.getBinding && list.getBinding("items");
      if (binding) {
        const filters = [];
        if (filterValue) {
          filters.push(new Filter({
            path: "text",
            test: (text) => typeof text === 'string' && text.toLowerCase().indexOf(filterValue) !== -1
          }));
        }
        binding.filter(filters);
      }

      const items = list.getItems ? list.getItems() : [];
      if (!items.length) {
        this._closeMentionPopover();
        return;
      }

      if (list.removeSelections) { list.removeSelections(true); }
      chatManager.isMentionOpen = true;
      chatManager._mentionTokenStart = tokenStart;
      chatManager._mentionFilter = filterValueRaw;
      chatManager._mentionCursor = cursor;
      chatManager._mentionValue = value;

      if (popover.isOpen && popover.isOpen()) {
        if (popover.rerender) { popover.rerender(); }
      } else if (popover.openBy) {
        popover.openBy(oTextArea);
      }
    },

    _locateMentionTokenStart: function (value, cursor) {
      if (!value || cursor == null) { return -1; }
      let idx = cursor - 1;
      while (idx >= 0) {
        const ch = value[idx];
        if (ch === '@') {
          if (idx > 0) {
            const prev = value[idx - 1];
            if (prev && !/\s/.test(prev)) {
              return -1;
            }
          }
          return idx;
        }
        if (/\s/.test(ch)) {
          return -1;
        }
        idx -= 1;
      }
      return -1;
    },

    _applyMentionSelection: function (selectedText) {
      if (!selectedText) {
        this._closeMentionPopover();
        return;
      }
      const oTextArea = this._getInputControl();
      const domRef = oTextArea && oTextArea.getFocusDomRef && oTextArea.getFocusDomRef();
      if (!oTextArea || !domRef) {
        this._closeMentionPopover();
        return;
      }
      const currentValue = oTextArea.getValue() || '';
      let cursor;
      if (domRef === document.activeElement && domRef.selectionStart != null) {
        cursor = domRef.selectionStart;
      } else if (chatManager._mentionCursor != null) {
        cursor = chatManager._mentionCursor;
      } else {
        cursor = currentValue.length;
      }
      let tokenStart = chatManager._mentionTokenStart;
      if (tokenStart == null || tokenStart < 0 || currentValue[tokenStart] !== '@') {
        tokenStart = this._locateMentionTokenStart(currentValue, cursor);
        if (tokenStart === -1) {
          this._closeMentionPopover();
          return;
        }
      }

      const tokenEnd = cursor;
      const before = currentValue.slice(0, tokenStart);
      const after = currentValue.slice(tokenEnd);
      const clean = String(selectedText).trim();
      const needsTrailingSpace = after.length === 0 ? true : !/^\s/.test(after);
      const insertion = needsTrailingSpace ? clean + ' ' : clean;
      const newValue = before + insertion + after;
      oTextArea.setValue(newValue);
      chatManager.chatModel.setProperty("/userInput", newValue);

      this._closeMentionPopover();
      setTimeout(() => {
        try {
          oTextArea.focus();
          const dom = oTextArea.getFocusDomRef();
          if (dom && typeof dom.setSelectionRange === 'function') {
            const pos = before.length + clean.length + (needsTrailingSpace ? 1 : 0);
            dom.setSelectionRange(pos, pos);
          }
        } catch (e) { /* ignore */ }
      }, 0);
    },

    _closeMentionPopover: function () {
      const popover = this._getMentionPopover();
      if (popover && popover.isOpen && popover.isOpen()) {
        popover.close();
      } else {
        this._resetMentionState();
      }
    },

    _resetMentionState: function () {
      chatManager.isMentionOpen = false;
      chatManager._mentionTokenStart = null;
      chatManager._mentionFilter = '';
      chatManager._mentionCursor = null;
      chatManager._mentionValue = '';
      const list = this._getMentionList();
      if (list) {
        if (list.removeSelections) { list.removeSelections(true); }
        const binding = list.getBinding && list.getBinding("items");
        if (binding) { binding.filter([]); }
      }
    }
  };

  async function init() {
    // Prepare model
    chatManager.initModel();

    // Load chat panel fragment
    const chatPanelContent = await Fragment.load({
      id: "chatSidePanelFragmentGlobal",
      name: "de.claimpilot.claims.ext.ChatSidePanelContent",
      controller: chatController
    });

    // Enable Enter-to-send on the TextArea and wire mention shortcuts
    try {
      const input = sap.ui.core.Fragment.byId("chatSidePanelFragmentGlobal", "chatInputField");
      if (input && input.attachBrowserEvent) {
        input.attachBrowserEvent("keydown", function (ev) {
          chatController._handleInputKeydown.call(chatController, ev, input);
        });
        input.attachBrowserEvent("focusout", function () {
          setTimeout(() => {
            try {
              const popover = chatController._getMentionPopover();
              if (!popover) {
                chatController._resetMentionState();
                return;
              }
              const isOpen = popover.isOpen && popover.isOpen();
              if (!isOpen) {
                chatController._resetMentionState();
                return;
              }
              const popDom = popover.getDomRef && popover.getDomRef();
              const active = document.activeElement;
              if (popDom && active && popDom.contains(active)) {
                return;
              }
              chatController._closeMentionPopover();
            } catch (e) {
              chatController._closeMentionPopover();
            }
          }, 0);
        });
      }
    } catch (e) { /* ignore */ }

    // Wrap chat content in a Panel to ensure setVisible and full height
    const rootContent = Array.isArray(chatPanelContent) ? chatPanelContent[0] : chatPanelContent;
    chatManager.rightPane = new Panel("chatRightPane", { content: [rootContent], height: "100%" });
    chatManager.rightPane.setModel(chatManager.chatModel, "chat");
    chatManager.rightPane.setLayoutData(new SplitterLayoutData({ size: "420px", resizable: true, minSize: 280 }));

    // Create FE component and container (left side)
    const feComponent = await Component.create({ name: "de.claimpilot.claims", id: "feAppComponentCore" });
    chatManager.feAppComponentInstance = feComponent;
    const container = new ComponentContainer({ component: feComponent, height: "100%" });

    // Splitter with two areas: left (FE), right (Chat)
    const splitter = new Splitter("mainSplitter", { height: "100%" });
    splitter.addContentArea(container);
    splitter.addContentArea(chatManager.rightPane);

    // Wire dependencies for FE component (provide chat model and pane)
    if (feComponent.setExternalDependencies) {
      feComponent.setExternalDependencies(chatManager.chatModel, chatManager.rightPane);
    }

    // Mount app
    const page = new Page("mainAppPage", { showHeader: false, content: [splitter], height: "100%" });
    const app = new App({ pages: [page], height: "100%" });
    app.placeAt("appHost");

    // Expose for other modules if needed
    try { window.claimpilotChat = { model: chatManager.chatModel, panel: chatManager.rightPane, sendPrompt: chatController.onSendChatMessageInSidePanel.bind(chatController) }; } catch (e) {}
  }

  return { init };
});
