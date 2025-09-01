sap.ui.define([
  "sap/ui/core/Component",
  "sap/ui/core/ComponentContainer",
  "sap/ui/layout/DynamicSideContent",
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel",
  "sap/m/App",
  "sap/m/Page",
  "sap/m/Bar",
  "sap/m/Title"
], function (Component, ComponentContainer, DynamicSideContent, Fragment, JSONModel, App, Page, Bar, Title) {
  "use strict";

  const chatManager = {
    chatModel: null,
    dynamicSideContent: null,
    feAppComponentInstance: null,

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
      if (this.dynamicSideContent) {
        setTimeout(function () {
          try {
            const sc = sap.ui.core.Fragment.byId("chatSidePanelFragmentGlobal", "chatHistoryScrollContainerInSidePanel");
            sc && sc.scrollTo(0, 99999, 200);
          } catch (e) { /* ignore */ }
        }, 100);
      }
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
    // Prepare model and side content
    chatManager.initModel();
    chatManager.dynamicSideContent = new DynamicSideContent("appDynamicSideContentGlobal", {
      showSideContent: true
    });
    chatManager.dynamicSideContent.setModel(chatManager.chatModel, "chat");

    // Load chat panel fragment
    const chatPanel = await Fragment.load({
      id: "chatSidePanelFragmentGlobal",
      name: "de.claimpilot.claims.ext.ChatSidePanelContent",
      controller: chatController
    });
    chatManager.dynamicSideContent.addSideContent(chatPanel);

    // Create FE component and wire dependencies
    const feComponent = await Component.create({ name: "de.claimpilot.claims", id: "feAppComponentCore" });
    chatManager.feAppComponentInstance = feComponent;
    if (feComponent.setExternalDependencies) {
      feComponent.setExternalDependencies(chatManager.chatModel, chatManager.dynamicSideContent);
    }

    // Add main content and mount app
    const container = new ComponentContainer({ component: feComponent, height: "100%" });
    chatManager.dynamicSideContent.addMainContent(container);

    const page = new Page("mainAppPage", { showHeader: false, content: [chatManager.dynamicSideContent], height: "100%" });
    const app = new App({ pages: [page], height: "100%" });
    app.placeAt("appHost");

    // Expose for other modules if needed
    try { window.claimpilotChat = { model: chatManager.chatModel, panel: chatManager.dynamicSideContent, sendPrompt: chatController.onSendChatMessageInSidePanel.bind(chatController) }; } catch (e) {}
  }

  return { init };
});
