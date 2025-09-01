sap.ui.define([
    "sap/fe/core/AppComponent"
], function (AppComponent) {
    "use strict";

    return AppComponent.extend("de.claimpilot.claims.Component", {
        metadata: { manifest: "json" },

        // Externe Referenzen (optional von außen gesetzt)
        _oChatModelExternal: null,
        _oDynamicSideContentExternal: null,
        _aiSendFunctionFromCustomAction: null,
        _aiSendThisArg: null,

        init: function () {
            AppComponent.prototype.init.apply(this, arguments);
        },

        // Wird von main.js oder anderen Stellen aufgerufen
        setExternalDependencies: function (oChatModel, oDynamicSideContent) {
            this._oChatModelExternal = oChatModel;
            this._oDynamicSideContentExternal = oDynamicSideContent;
        },

        getChatModel: function () {
            return this._oChatModelExternal || (window.claimpilotChat && window.claimpilotChat.model) || null;
        },

        getDynamicSideContent: function () {
            return this._oDynamicSideContentExternal || (window.claimpilotChat && window.claimpilotChat.panel) || null;
        },

        getAISendFunction: function () {
            return this._aiSendFunctionFromCustomAction || (window.claimpilotChat && window.claimpilotChat.sendPrompt) || null;
        },

        // Wird von CustomActions.js aufgerufen, um die Sende-Logik zu registrieren
        registerAISendFunction: function (fnSend, thisArg) {
            if (typeof fnSend === 'function') {
                this._aiSendFunctionFromCustomAction = fnSend;
                this._aiSendThisArg = thisArg || null; // ExtensionAPI-Kontext optional
                return true;
            }
            return false;
        },

        openChat: function () {
            var panel = this.getDynamicSideContent();
            if (panel && typeof panel.setVisible === 'function') {
                panel.setVisible(true);
            }
        },

        sendAI: function (prompt, oChatModelToUpdate) {
            var fn = this.getAISendFunction();
            if (typeof fn === 'function') {
                // Wenn CustomAction registriert ist, zwei Parameter unterstützen und this-Kontext respektieren
                if (fn === this._aiSendFunctionFromCustomAction) {
                    try {
                        var res = this._aiSendFunctionFromCustomAction.call(this._aiSendThisArg || null, prompt, oChatModelToUpdate);
                        return (res && typeof res.then === 'function') ? res : Promise.resolve(res);
                    } catch (e) {
                        return Promise.reject(e);
                    }
                }
                // Fallback auf globalen sendPrompt(prompt)
                var out = fn(prompt);
                return (out && typeof out.then === 'function') ? out : Promise.resolve(out);
            }
            return Promise.reject(new Error('AI Send-Funktion nicht verfügbar'));
        },

        // Wird von main.js (ChatFragmentController) aufgerufen
        invokeAIActionOnCurrentPage: function (sPrompt, oChatModelToUpdate) {
            var self = this;
            var text = (sPrompt == null ? "" : String(sPrompt)).trim();
            if (!text) { return Promise.resolve(null); }

            // Panel sichtbar machen
            this.openChat();

            // Optional: externes ChatModel (wenn übergeben) mitführen
            var placeholderIndex = -1;
            if (oChatModelToUpdate && typeof oChatModelToUpdate.getData === 'function') {
                try {
                    var data = oChatModelToUpdate.getData();
                    data.messages = data.messages || [];
                    data.messages.push({ role: 'user', text: text, ts: Date.now() });
                    data.messages.push({ role: 'assistant', text: '<i>Thinking...</i>', ts: Date.now() });
                    placeholderIndex = data.messages.length - 1;
                    oChatModelToUpdate.updateBindings(true);
                } catch (e) { /* ignore */ }
            }

            // Wenn eine CustomAction-Implementierung registriert ist, diese zuerst verwenden und Kontext/Argumente beibehalten
            if (this._aiSendFunctionFromCustomAction) {
                try {
                    var customRes = this._aiSendFunctionFromCustomAction.call(this._aiSendThisArg || null, text, oChatModelToUpdate);
                    return (customRes && typeof customRes.then === 'function') ? customRes : Promise.resolve(customRes);
                } catch (errCall) {
                    return Promise.reject(errCall);
                }
            }

            var fnSend = (window.claimpilotChat && window.claimpilotChat.sendPrompt) || null;
            if (typeof fnSend !== 'function') { return Promise.reject(new Error('AI Send-Funktion nicht verfügbar')); }

            return fnSend(text)
                .then(function (html) {
                    if (oChatModelToUpdate && placeholderIndex >= 0) {
                        try {
                            var d = oChatModelToUpdate.getData();
                            d.messages[placeholderIndex] = { role: 'assistant', text: html || '<i>Keine Antwort</i>', ts: Date.now() };
                            oChatModelToUpdate.updateBindings(true);
                        } catch (e) { /* ignore */ }
                    }
                    return html;
                })
                .catch(function (err) {
                    if (oChatModelToUpdate && placeholderIndex >= 0) {
                        try {
                            var d2 = oChatModelToUpdate.getData();
                            d2.messages[placeholderIndex] = { role: 'assistant', text: '<b>Fehler:</b> ' + (err && err.message || err), ts: Date.now() };
                            oChatModelToUpdate.updateBindings(true);
                        } catch (e) { /* ignore */ }
                    }
                    throw err;
                });
        }
    });
});
