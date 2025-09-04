sap.ui.define([
  "sap/ui/core/Component",
  "sap/ui/core/ComponentContainer",
  "sap/ui/layout/Splitter",
  "sap/ui/layout/SplitterLayoutData",
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel",
  "sap/m/App",
  "sap/m/Page",
  "sap/m/Bar",
  "sap/m/Title",
  "sap/m/Panel"
], function (Component, ComponentContainer, Splitter, SplitterLayoutData, Fragment, JSONModel, App, Page, Bar, Title, Panel) {
  "use strict";

  const chatManager = {
    chatModel: null,
    feAppComponentInstance: null,
    rightPane: null,
    _currentAbortController: null,

    // Render a safe, readable HTML from LLM markdown/plain responses
    renderMarkdownToHtml: function (input) {
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
        return `[[[CODE_BLOCK_${idx}]]]`;
      });
      src = src.replace(/~~~([a-zA-Z0-9_-]*)\n([\s\S]*?)~~~/g, (m, lang, code) => {
        const idx = blocks.push({ lang: lang || "", code }) - 1;
        return `[[[CODE_BLOCK_${idx}]]]`;
      });

      // Escape remaining HTML
      let html = escapeHtml(src);

      // Normalize: if a single newline follows a sentence end and starts a new sentence, promote to paragraph
      src = src.replace(/([\.!?])\n(\s*[A-ZÄÖÜ0-9])/g, '$1\n\n$2');

      // Horizontal rule markers
      html = html.replace(/(^|\n)\s*[-*_]{3,}\s*(?=\n|$)/g, '$1<hr/>');

      // Inline code
      html = html.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);

      // Basic bold (**text**)
      html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

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

      // Simple list/line formatting: convert bullet markers to readable lines; avoid <ul>/<ol> for FormattedText compatibility
      const lineify = (text) => {
        const lines = text.split(/\n/);
        const out = [];
        for (let line of lines) {
          if (/^\s*-\s+/.test(line)) {
            line = '• ' + line.replace(/^\s*-\s+/, '');
          }
          // Keep numbered bullets as-is
          out.push(line);
        }
        return out.join('\n');
      };
      html = lineify(html);

      // Line breaks for readability; avoid wrapping in <p> to ensure compatibility
      html = html.replace(/\n/g, '<br/>');

      // Restore fenced code blocks (escaped inside)
      html = html.replace(/\[\[\[CODE_BLOCK_(\d+)\]\]\]/g, (m, i) => {
        const blk = blocks[Number(i)] || { lang: '', code: '' };
        const content = escapeHtml(blk.code);
        return `<pre><code data-lang="${blk.lang}">${content}</code></pre>`;
      });

      return html;
    },

    initModel: function () {
      this.chatModel = new JSONModel({
        chatHistory: [
          { type: "assistant", text: "<i>Willkommen! Wie kann ich helfen?</i>" }
        ],
        userInput: "",
        isTyping: false,
        isStreaming: false,
        statusMessage: "",
        showSuggestions: true,
        suggestions: [
          { text: "Fasse den aktuellen Vorgang zusammen" },
          { text: "Welche fehlenden Unterlagen brauche ich?" },
          { text: "Erzeuge eine Kundenmail" },
          { text: "Erkläre die Entscheidung" }
        ]
      });
    },

    addMessage: function (type, text) {
      const history = this.chatModel.getProperty("/chatHistory");
      history.push({ type, text });
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
      const url = "/ai/stream";
      const ac = new AbortController();
      this._currentAbortController = ac;
      this.chatModel.setProperty("/isStreaming", true);
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
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

      // ensure last assistant placeholder exists
      const history = this.chatModel.getProperty("/chatHistory");
      if (!history.length || history[history.length - 1].type !== "assistant") {
        this.addMessage("assistant", "<i>Thinking...</i>");
      }

      const updateAssistant = (text) => {
        const h = this.chatModel.getProperty("/chatHistory");
        h[h.length - 1] = { type: "assistant", text: this.renderMarkdownToHtml(text) };
        this.chatModel.setProperty("/chatHistory", h);
        this.chatModel.refresh(true);
      };

      // Heuristic: insert missing newlines before bullet markers while streaming
      const normalizeBulletsStreaming = (prev, chunk) => {
        if (!chunk) return chunk;
        let s = String(chunk);
        // If a new chunk starts with a bullet but the previous text didn't end with a newline, insert one
        try {
          if (prev && !/\n$/.test(prev) && /^(\s*)(?:[-*]\s+|\d+\.\s+)/.test(s)) {
            s = "\n" + s;
          }
          // Inside the chunk, add a newline before any bullet marker that's not already at line start
          // Hyphen bullets only (avoid '*' to not break bold markup like '**text**')
          s = s.replace(/([^\n])(?=-\s+)/g, '$1\n');
          // Numbered bullets like "1. "
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
          // extract one SSE event (without trimming leading spaces in value)
          let raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (!raw) continue;
          if (raw.startsWith("data:")) {
            let data = raw.slice(5);
            // Per SSE spec: ignore a single optional space after the colon
            if (data.startsWith(" ")) data = data.slice(1);
            if (data.trim() === "[DONE]") { reader.cancel(); break; }
            // If server sends JSON chunks, try to extract a content field; otherwise append as-is
            let toAppend = null;
            if (data.startsWith("{") || data.startsWith("[")) {
              try {
                const obj = JSON.parse(data);
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
            updateAssistant(accumulated);
          }
        }
      }
        return { html: this.renderMarkdownToHtml(accumulated), text: accumulated };
      } finally {
        this.chatModel.setProperty("/isStreaming", false);
        this.chatModel.setProperty("/showSuggestions", false);
        this._currentAbortController = null;
      }
    }
  };

  const chatController = {
    onSendChatMessageInSidePanel: async function (overrideText) {
      const text = (overrideText != null ? String(overrideText) : (chatManager.chatModel.getProperty("/userInput") || "")).trim();
      if (!text) { return; }
      chatManager.chatModel.setProperty("/userInput", "");
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
        const finalHtml = (usedStreaming && resp && resp.html)
          ? resp.html
          : chatManager.renderMarkdownToHtml(resp);
        history.push({ type: "assistant", text: finalHtml });
        chatManager.chatModel.setProperty("/chatHistory", history);
        chatManager.chatModel.refresh(true);
      } catch (e) {
        const history = chatManager.chatModel.getProperty("/chatHistory");
        history.pop();
        history.push({ type: "assistant", text: "<b>Fehler:</b> " + (e && e.message || e) });
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

    onSuggestionPress: function (oEvent) {
      const s = oEvent.getSource().getText();
      chatManager.chatModel.setProperty("/showSuggestions", false);
      this.onSendChatMessageInSidePanel(s);
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

    // Enable Enter-to-send on the TextArea; ensure latest value is in the model before sending
    try {
      const input = sap.ui.core.Fragment.byId("chatSidePanelFragmentGlobal", "chatInputField");
      if (input && input.attachBrowserEvent) {
        input.attachBrowserEvent("keydown", function (ev) {
          if (ev.key === "Enter" && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
            ev.preventDefault();
            try {
              const val = input.getValue();
              // Write to bound model first so getProperty sees the latest
              chatManager.chatModel.setProperty("/userInput", val);
              // Also trigger the control's change lifecycle for consistency
              if (typeof input.fireChange === 'function') input.fireChange({ value: val });
              // Send using the captured value to avoid any race
              chatController.onSendChatMessageInSidePanel(val);
            } catch (e) { /* ignore */ }
          }
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
