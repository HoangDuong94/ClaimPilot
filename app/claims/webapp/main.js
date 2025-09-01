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

    initModel: function () {
      this.chatModel = new JSONModel({
        chatHistory: [
          { type: "assistant", text: "<i>Willkommen! Wie kann ich helfen?</i>" }
        ],
        userInput: "",
        isTyping: false,
        statusMessage: ""
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
    }
  };

  const chatController = {
    onSendChatMessageInSidePanel: async function () {
      const text = (chatManager.chatModel.getProperty("/userInput") || "").trim();
      if (!text) { return; }
      chatManager.chatModel.setProperty("/userInput", "");
      chatManager.addMessage("user", text);
      chatManager.addMessage("assistant", "<i>Thinking...</i>");
      try {
        const resp = await chatManager.sendViaODataAction(text);
        // replace last thinking message
        const history = chatManager.chatModel.getProperty("/chatHistory");
        history.pop();
        history.push({ type: "assistant", text: resp });
        chatManager.chatModel.setProperty("/chatHistory", history);
        chatManager.chatModel.refresh(true);
      } catch (e) {
        const history = chatManager.chatModel.getProperty("/chatHistory");
        history.pop();
        history.push({ type: "assistant", text: "<b>Fehler:</b> " + (e && e.message || e) });
        chatManager.chatModel.setProperty("/chatHistory", history);
        chatManager.chatModel.refresh(true);
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

    // Enable Enter-to-send on the TextArea, ensure change lifecycle fires first
    try {
      const input = sap.ui.core.Fragment.byId("chatSidePanelFragmentGlobal", "chatInputField");
      if (input && input.attachBrowserEvent) {
        input.attachBrowserEvent("keydown", function (ev) {
          if (ev.key === "Enter" && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
            ev.preventDefault();
            try {
              // Update binding by firing change before sending
              input.fireChange({ value: input.getValue() });
            } catch (e) { /* ignore */ }
            chatController.onSendChatMessageInSidePanel();
          }
        });
      }
    } catch (e) { /* ignore */ }

    // Wrap chat content in a Panel to ensure setVisible and full height
    chatManager.rightPane = new Panel("chatRightPane", { content: [chatPanelContent], height: "100%" });
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
