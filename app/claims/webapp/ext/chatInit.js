sap.ui.define([
  "sap/m/Button",
  "sap/m/Panel",
  "sap/m/Toolbar",
  "sap/m/ToolbarSpacer",
  "sap/m/Title",
  "sap/m/TextArea",
  "sap/m/List",
  "sap/m/CustomListItem",
  "sap/m/Text",
  "sap/m/FormattedText",
  "sap/m/Label",
  "sap/m/BusyIndicator",
  "sap/m/MessageToast",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/odata/v4/ODataModel"
], function (Button, Panel, Toolbar, ToolbarSpacer, Title, TextArea, List, CustomListItem, Text, FormattedText, Label, BusyIndicator, MessageToast, JSONModel, ODataModel) {
  "use strict";

  function createODataModel() {
    try {
      return new ODataModel({
        serviceUrl: "/service/kfz/",
        synchronizationMode: "None",
        autoExpandSelect: true,
        earlyRequests: true
      });
    } catch (e) {
      try { MessageToast.show("Fehler beim Initialisieren des OData-Modells"); } catch (x) {}
      return null;
    }
  }

  function callLLM(model, prompt) {
    return new Promise(function (resolve, reject) {
      try {
        if (!model) { return reject(new Error("Service /service/kfz/ nicht erreichbar")); }
        const ctx = model.bindContext("/callLLM(...)");
        ctx.setParameter("prompt", prompt || "");
        ctx.execute().then(function () {
          try {
            const resp = ctx.getBoundContext().getObject();
            resolve((resp && resp.response) || "");
          } catch (e) { reject(e); }
        }, reject);
      } catch (e) { reject(e); }
    });
  }

  function buildSidePanel(context) {
    const chatModel = new JSONModel({ messages: [] });
    const oList = new List({ inset: false, width: "100%", growing: true });
    oList.setModel(chatModel);
    oList.bindItems({
      path: "/messages",
      factory: function (_sId, oContext) {
        const data = oContext.getObject();
        const isUser = data.role === "user";
        const bubble = isUser
          ? new Text({ text: data.text }).addStyleClass("cp-bubble cp-user")
          : new FormattedText({ htmlText: data.text }).addStyleClass("cp-bubble cp-assistant");
        const item = new CustomListItem({ content: bubble });
        item.addStyleClass(isUser ? "cp-item-user" : "cp-item-assistant");
        return item;
      }
    });

    try {
      window.triggerChatScroll = function(){
        try { const ref = oList.getDomRef(); if (ref) ref.scrollTop = ref.scrollHeight; } catch (e) {}
      };
    } catch (e) {}

    const txt = new TextArea({ width: "100%", rows: 4, placeholder: "Prompt eingeben und Enter druecken (Strg+Enter fuer neue Zeile)" });
    const busy = new BusyIndicator({ size: "Small", visible: false });

    function addMessage(role, text) {
      const data = chatModel.getData();
      data.messages.push({ role, text, ts: Date.now() });
      chatModel.updateBindings(true);
      setTimeout(function(){ try { oList.getDomRef().scrollTop = oList.getDomRef().scrollHeight; } catch (e) {} }, 0);
    }

    function sendPrompt(overridePrompt) {
      const prompt = (overridePrompt != null ? String(overridePrompt) : txt.getValue() || "").trim();
      if (!prompt) { return; }
      addMessage("user", prompt);
      txt.setValue("");
      addMessage("assistant", "<i>Thinking...</i>");
      busy.setVisible(true);
      return callLLM(context.odataModel, prompt)
        .then(function (html) {
          const data = chatModel.getData();
          data.messages[data.messages.length - 1] = { role: "assistant", text: html || "<i>Keine Antwort</i>", ts: Date.now() };
          chatModel.updateBindings(true);
          return html;
        })
        .catch(function (e) {
          const msg = "<b>Fehler:</b> " + (e && e.message || e);
          const data = chatModel.getData();
          data.messages[data.messages.length - 1] = { role: "assistant", text: msg, ts: Date.now() };
          chatModel.updateBindings(true);
          throw e;
        })
        .finally(function(){ busy.setVisible(false); });
    }

    txt.attachBrowserEvent("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.ctrlKey && !ev.shiftKey) { ev.preventDefault(); sendPrompt(); }
    });

    const sendBtn = new Button({ text: "Senden", type: "Emphasized", press: sendPrompt });
    const inputBar = new Toolbar({ content: [ txt, sendBtn, busy ]});

    const headerBar = new Toolbar({ content: [ new Title({ text: "AI Chat" }), new ToolbarSpacer() ] });
    const panel = new Panel({ visible: true, expandable: false, content: [ headerBar, oList, inputBar ] });
    panel.addStyleClass("claimpilot-sidepanel");

    return { panel, addMessage, sendPrompt, model: chatModel };
  }

  function init() {
    const odataModel = createODataModel();
    const ui = buildSidePanel({ odataModel });

    // Place side panel directly into body and show it
    if (!ui.panel.getParent()) { ui.panel.placeAt(document.body); }
    ui.panel.setVisible(true);

    const style = document.createElement('style');
    style.textContent = `
      .claimpilot-sidepanel{position:fixed;top:0;right:0;width:420px;max-width:90vw;height:100%;z-index:10000;background:#fff;box-shadow:0 0 8px rgba(0,0,0,.2);display:block;padding:0}
      .claimpilot-sidepanel .sapMPanelContent{height:calc(100% - 0px);display:flex;flex-direction:column;padding:0}
      .claimpilot-sidepanel .sapMTB{border-bottom:1px solid #eee}
      .claimpilot-sidepanel .sapMList{flex:1 1 auto;overflow:auto}
      .claimpilot-sidepanel .sapMTB:last-child{border-top:1px solid #eee}
      .cp-bubble{padding:.5rem .75rem;border-radius:8px;max-width:92%;display:inline-block}
      .cp-user{background:#e8f4ff;align-self:flex-end}
      .cp-assistant{background:#f6f6f6}
      .cp-item-user{display:flex;justify-content:flex-end}
      .cp-item-assistant{display:flex;justify-content:flex-start}
    `;
    document.head.appendChild(style);

    try { window.claimpilotChat = ui; } catch (e) {}
    return ui;
  }

  return { init };
});

