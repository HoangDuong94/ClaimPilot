using KfzService as service from '../../srv/service';

annotate service.Claim with @com.sap.vocabularies.UI.v1: {
  HeaderInfo: {
    TypeName: 'Schaden',
    TypeNamePlural: 'Schäden',
    Title: { Value: { $Path: 'claimNumber' } },
    Description: { Value: { $Path: 'status' } }
  },
  SelectionFields: [
    { $PropertyPath: 'claimNumber' },
    { $PropertyPath: 'status' },
    { $PropertyPath: 'severity' },
    { $PropertyPath: 'lossDate' }
  ],
  LineItem: [
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: { $Path: 'claimNumber' }, Label: 'Claim' },
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: { $Path: 'policy/policyNumber' }, Label: 'Police' },
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: { $Path: 'vehicle/plate' }, Label: 'Kennzeichen' },
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: { $Path: 'lossDate' }, Label: 'Schadendatum' },
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: { $Path: 'status' }, Label: 'Status' },
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: { $Path: 'severity' }, Label: 'Schadenschwere' },
    { $Type: 'com.sap.vocabularies.UI.v1.DataField', Value: { $Path: 'reportedDate' }, Label: 'Meldedatum' }
  ]
};
