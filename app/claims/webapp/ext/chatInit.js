sap.ui.define([
  "sap/m/Button",
  "sap/m/Dialog",
  "sap/m/TextArea",
  "sap/m/FormattedText",
  "sap/m/Bar",
  "sap/m/Label",
  "sap/m/BusyIndicator",
  "sap/m/MessageToast",
  "sap/ui/model/odata/v4/ODataModel"
], function (Button, Dialog, TextArea, FormattedText, Bar, Label, BusyIndicator, MessageToast, ODataModel) {
  "use strict";

  function createModel() {
    try {
      return new ODataModel({
        serviceUrl: "/service/kfz/",
        synchronizationMode: "None",
        autoExpandSelect: true,
        earlyRequests: true
      });
    } catch (e) {
      MessageToast.show("Fehler beim Initialisieren des OData-Modells");
      throw e;
    }
  }

  function callLLM(model, prompt) {
    return new Promise(function (resolve, reject) {
      try {
        const ctx = model.bindContext("/callLLM(...)\");
        ctx.setParameter("prompt", prompt || "");
        ctx.execute().then(function () {
          try {
            const resp = ctx.getBoundContext().getObject();
            resolve(resp && resp.response || "");
          } catch (e) { reject(e); }
        }, reject);
      } catch (e) { reject(e); }
    });
  }

  function buildDialog(model) {
    const txt = new TextArea({
      width: "100%",
      rows: 6,
      placeholder: "Prompt eingeben ..."
    });
    const out = new FormattedText({
      width: "100%",
      htmlText: "<i>Antwort erscheint hier ...</i>"
    });
    const busy = new BusyIndicator({size: "Medium", visible: false});
    const dlg = new Dialog({
      title: "AI / callLLM",
      contentWidth: "720px",
      contentHeight: "480px",
      stretchOnPhone: true,
      content: [
        new Label({text: "Prompt"}),
        txt,
        new Label({text: "Antwort"}),
        out,
        busy
      ],
      beginButton: new Button({
        text: "Senden",
        type: "Emphasized",
        press: function () {
          const p = txt.getValue();
          busy.setVisible(true);
          callLLM(model, p).then(function (html) {
            out.setHtmlText(html || "<i>Keine Antwort</i>");
          }).catch(function (e) {
            out.setHtmlText("<b>Fehler:</b> " + (e && e.message || e));
          }).finally(function(){ busy.setVisible(false); });
        }
      }),
      endButton: new Button({ text: "Schließen", press: function(){ dlg.close(); } })
    });
    return dlg;
  }

  function init() {
    // floating Button rechts unten
    const model = createModel();
    const dlg = buildDialog(model);
    const btn = new Button({
      icon: "sap-icon://discussion",
      type: "Emphasized",
      tooltip: "AI Chat (callLLM)",
      press: function(){ dlg.open(); }
    });

    // place button in page DOM
    btn.addStyleClass("claimpilot-fab");
    btn.placeAt("content");

    // inject basic styles
    const style = document.createElement('style');
    style.textContent = `.claimpilot-fab{position:fixed;bottom:16px;right:16px;z-index:1000}`;
    document.head.appendChild(style);
  }

  return { init };
});

