using KfzService as service from '../../srv/service';

annotate service.Claim with @com.sap.vocabularies.UI.v1: {
  HeaderInfo: {
    TypeName: 'Schaden',
    TypeNamePlural: 'Schaeden',
    Title: { Value: claimNumber },
    Description: { Value: status }
  },
  SelectionFields: [
    { $PropertyPath: claimNumber },
    { $PropertyPath: status },
    { $PropertyPath: severity },
    { $PropertyPath: lossDate }
  ],
  LineItem: [
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: claimNumber, Label: 'Claim', ![@com.sap.vocabularies.UI.v1.Importance]: #High },
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: policyNumber, Label: 'Police', ![@com.sap.vocabularies.UI.v1.Importance]: #High },
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: plate, Label: 'Kennzeichen', ![@com.sap.vocabularies.UI.v1.Importance]: #High },
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: lossDate, Label: 'Schadendatum', ![@com.sap.vocabularies.UI.v1.Importance]: #High },
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: status, Label: 'Status', ![@com.sap.vocabularies.UI.v1.Importance]: #High },
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: severity, Label: 'Schadenschwere' },
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: reportedDate, Label: 'Meldedatum' }
  ]
};
