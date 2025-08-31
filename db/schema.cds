using { cuid, managed } from '@sap/cds/common';

namespace sap.kfz;

type Severity : String(10); // low|medium|high
type TaskStatus : String(20); // open|in_progress|done

entity Insured : cuid, managed {
  name     : String(100);
  email    : String(255);
  phone    : String(40);
  address  : String(255);
}

entity Policy : cuid, managed {
  policyNumber   : String(30);
  product        : String(40);
  effectiveDate  : Date;
  expiryDate     : Date;
  coverageLimits : String(255);
  insured        : Association to Insured;
}

entity Vehicle : cuid, managed {
  vin    : String(20);
  plate  : String(15);
  make   : String(40);
  model  : String(40);
  year   : Integer;
}

entity Claim : cuid, managed {
  claimNumber  : String(30);
  status       : String(30);
  lossDate     : DateTime;
  reportedDate : DateTime;
  description  : LargeString;
  severity     : Severity;
  reserveAmount: Decimal(15,2);
  policy       : Association to Policy;
  vehicle      : Association to Vehicle;

  emails       : Composition of many Email    on emails.claim    = $self;
  documents    : Composition of many Document on documents.claim = $self;
  tasks        : Composition of many Task     on tasks.claim     = $self;
}

entity Email : cuid, managed {
  messageId      : String(120);
  subject        : String(255);
  fromAddress    : String(255); // 'from' ist reserviert in CDS
  receivedAt     : DateTime;
  hasAttachments : Boolean;
  claim          : Association to Claim;
}

entity Document : cuid, managed {
  fileName   : String(255);
  mimeType   : String(60);
  storageRef : String(255);
  source     : String(20); // email|upload|excel
  claim      : Association to Claim;
}

entity Task : cuid, managed {
  type     : String(40); // triage|estimation|contact|payment|clarify-data
  status   : TaskStatus;
  dueDate  : Date;
  assignee : String(100);
  claim    : Association to Claim;
}
