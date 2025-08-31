sap.ui.define([
    "sap/fe/core/AppComponent",
    "de/claimpilot/claims/ext/chatInit"
], function (AppComponent, chatInit) {
    "use strict";

    return AppComponent.extend("de.claimpilot.claims.Component", {
        metadata: {
            manifest: "json"
        },
        init: function () {
            AppComponent.prototype.init.apply(this, arguments);
            try {
                if (chatInit && typeof chatInit.init === 'function') {
                    chatInit.init();
                }
            } catch (e) {
                // fail-safe: ignore UI init errors
                /* eslint-disable no-console */
                console && console.warn && console.warn("Chat init failed", e);
            }
        }
    });
});
