using { UI } from '@sap/cds/common';
using KfzService as service from '../../srv/service';

annotate service.Claim with @UI: {
  HeaderInfo: {
    TypeName: 'Schaden',
    TypeNamePlural: 'Schäden',
    Title: { Value: claimNumber },
    Description: { Value: status }
  },
  SelectionFields: [
    { $PropertyPath: 'claimNumber' },
    { $PropertyPath: 'status' },
    { $PropertyPath: 'severity' },
    { $PropertyPath: 'lossDate' }
  ],
  LineItem: [
    { $Type: 'UI.DataField', Value: { $Path: 'claimNumber' }, Label: 'Claim' },
    { $Type: 'UI.DataField', Value: { $Path: 'policy/policyNumber' }, Label: 'Police' },
    { $Type: 'UI.DataField', Value: { $Path: 'vehicle/plate' }, Label: 'Kennzeichen' },
    { $Type: 'UI.DataField', Value: { $Path: 'lossDate' }, Label: 'Schadendatum' },
    { $Type: 'UI.DataField', Value: { $Path: 'status' }, Label: 'Status' },
    { $Type: 'UI.DataField', Value: { $Path: 'severity' }, Label: 'Schadenschwere' },
    { $Type: 'UI.DataField', Value: { $Path: 'reportedDate' }, Label: 'Meldedatum' }
  ]
};
