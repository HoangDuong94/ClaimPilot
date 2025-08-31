sap.ui.require(
    [
        'sap/fe/test/JourneyRunner',
        'de/claimpilot/claims/test/integration/FirstJourney',
		'de/claimpilot/claims/test/integration/pages/ClaimList',
		'de/claimpilot/claims/test/integration/pages/ClaimObjectPage'
    ],
    function(JourneyRunner, opaJourney, ClaimList, ClaimObjectPage) {
        'use strict';
        var JourneyRunner = new JourneyRunner({
            // start index.html in web folder
            launchUrl: sap.ui.require.toUrl('de/claimpilot/claims') + '/index.html'
        });

       
        JourneyRunner.run(
            {
                pages: { 
					onTheClaimList: ClaimList,
					onTheClaimObjectPage: ClaimObjectPage
                }
            },
            opaJourney.run
        );
    }
);