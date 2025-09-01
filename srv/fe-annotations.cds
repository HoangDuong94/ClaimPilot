using KfzService as service from './service';

annotate service.Claim with @(
  UI.HeaderInfo : {
    TypeName       : 'Schaden',
    TypeNamePlural : 'Schaeden',
    Title          : { Value : claimNumber },
    Description    : { Value : status }
  },

  UI.SelectionFields : [
    claimNumber, status, severity, lossDate
  ],

  UI.LineItem : [
    { $Type : 'UI.DataField', Value : claimNumber,            Label : 'Claim',        ![@UI.Importance] : #High },
    { $Type : 'UI.DataField', Value : policy.policyNumber,    Label : 'Police',       ![@UI.Importance] : #High },
    { $Type : 'UI.DataField', Value : vehicle.plate,          Label : 'Kennzeichen',  ![@UI.Importance] : #High },
    { $Type : 'UI.DataField', Value : lossDate,               Label : 'Schadendatum', ![@UI.Importance] : #High },
    { $Type : 'UI.DataField', Value : status,                 Label : 'Status',       ![@UI.Importance] : #High },
    { $Type : 'UI.DataField', Value : severity,               Label : 'Schadenschwere' },
    { $Type : 'UI.DataField', Value : reportedDate,           Label : 'Meldedatum' }
  ],

  UI.Facets : [
    {
      $Type : 'UI.ReferenceFacet',
      Label : 'Allgemeine Informationen',
      Target: '@UI.FieldGroup#General'
    },
    {
      $Type : 'UI.ReferenceFacet',
      Label : 'Beschreibung',
      Target: '@UI.FieldGroup#Description'
    },
    {
      $Type : 'UI.ReferenceFacet',
      Label : 'E-Mails',
      Target: 'emails/@UI.LineItem'
    },
    {
      $Type : 'UI.ReferenceFacet',
      Label : 'Dokumente',
      Target: 'documents/@UI.LineItem'
    },
    {
      $Type : 'UI.ReferenceFacet',
      Label : 'Aufgaben',
      Target: 'tasks/@UI.LineItem'
    }
  ],

  UI.FieldGroup #General : {
    Data : [
      { Value : claimNumber,          Label : 'Claim' },
      { Value : status,               Label : 'Status' },
      { Value : severity,             Label : 'Schadenschwere' },
      { Value : lossDate,             Label : 'Schadendatum' },
      { Value : reportedDate,         Label : 'Meldedatum' },
      { Value : policy.policyNumber,  Label : 'Police' },
      { Value : vehicle.plate,        Label : 'Kennzeichen' },
      { Value : reserveAmount,        Label : 'Reserve' }
    ]
  },

  UI.FieldGroup #Description : {
    Data : [
      { Value : description, Label : 'Beschreibung' }
    ]
  }
);

annotate service.Claim with {
  description   @title : 'Beschreibung'            @UI.MultiLineText;
  claimNumber   @title : 'Claim';
  status        @title : 'Status';
  severity      @title : 'Schadenschwere';
  lossDate      @title : 'Schadendatum';
  reportedDate  @title : 'Meldedatum';
  reserveAmount @title : 'Reserve';
};

annotate service.Claim with @(
  Capabilities.InsertRestrictions  : { Insertable : true },
  Capabilities.UpdateRestrictions  : { Updatable  : true },
  Capabilities.DeleteRestrictions  : { Deletable  : true }
);

annotate service.Claim with {
  policy @Common.ValueList : {
    $Type          : 'Common.ValueListType',
    CollectionPath : 'Policy',
    Parameters     : [
      { $Type : 'Common.ValueListParameterInOut',  LocalDataProperty : policy_ID,  ValueListProperty : 'ID' },
      { $Type : 'Common.ValueListParameterDisplayOnly', ValueListProperty : 'policyNumber' }
    ]
  };
  vehicle @Common.ValueList : {
    $Type          : 'Common.ValueListType',
    CollectionPath : 'Vehicle',
    Parameters     : [
      { $Type : 'Common.ValueListParameterInOut',  LocalDataProperty : vehicle_ID, ValueListProperty : 'ID' },
      { $Type : 'Common.ValueListParameterDisplayOnly', ValueListProperty : 'plate' }
    ]
  };
};

annotate service.Email with @(
  UI.LineItem : [
    { $Type : 'UI.DataField', Value : subject,       Label : 'Betreff' },
    { $Type : 'UI.DataField', Value : fromAddress,   Label : 'Von' },
    { $Type : 'UI.DataField', Value : receivedAt,    Label : 'Empfangen am' },
    { $Type : 'UI.DataField', Value : hasAttachments,Label : 'Anhänge' }
  ]
);

annotate service.Email with @(
  Capabilities.InsertRestrictions  : { Insertable : true },
  Capabilities.UpdateRestrictions  : { Updatable  : true },
  Capabilities.DeleteRestrictions  : { Deletable  : true }
);

annotate service.Document with @(
  UI.LineItem : [
    { $Type : 'UI.DataField', Value : fileName,   Label : 'Datei' },
    { $Type : 'UI.DataField', Value : mimeType,   Label : 'Typ' },
    { $Type : 'UI.DataField', Value : source,     Label : 'Quelle' }
  ]
);

annotate service.Document with @(
  Capabilities.InsertRestrictions  : { Insertable : true },
  Capabilities.UpdateRestrictions  : { Updatable  : true },
  Capabilities.DeleteRestrictions  : { Deletable  : true }
);

annotate service.Task with @(
  UI.LineItem : [
    { $Type : 'UI.DataField', Value : type,     Label : 'Typ' },
    { $Type : 'UI.DataField', Value : status,   Label : 'Status' },
    { $Type : 'UI.DataField', Value : dueDate,  Label : 'Fällig am' },
    { $Type : 'UI.DataField', Value : assignee, Label : 'Bearbeiter' }
  ]
);

annotate service.Task with @(
  Capabilities.InsertRestrictions  : { Insertable : true },
  Capabilities.UpdateRestrictions  : { Updatable  : true },
  Capabilities.DeleteRestrictions  : { Deletable  : true }
);
