using KfzService as service from '../../srv/service';

annotate service.Claim with @("com.sap.vocabularies.UI.v1") {
  HeaderInfo : {
    TypeName       : 'Schaden',
    TypeNamePlural : 'Schäden',
    Title          : { Value : claimNumber },
    Description    : { Value : status }
  };

  SelectionFields : [ claimNumber, status, severity, lossDate ];

  LineItem : [
    { $Type: 'UI.DataField', Value: claimNumber, Label: 'Claim' },
    { $Type: 'UI.DataField', Value: 'policy/policyNumber', Label: 'Police' },
    { $Type: 'UI.DataField', Value: 'vehicle/plate', Label: 'Kennzeichen' },
    { $Type: 'UI.DataField', Value: lossDate, Label: 'Schadendatum' },
    { $Type: 'UI.DataField', Value: status, Label: 'Status' },
    { $Type: 'UI.DataField', Value: severity, Label: 'Schadenschwere' },
    { $Type: 'UI.DataField', Value: reportedDate, Label: 'Meldedatum' }
  ];
};
