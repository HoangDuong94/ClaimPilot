using { sap.kfz as kfz } from '../db/schema';

entity ClaimFlat as select from kfz.Claim {
  *,
  policy.policyNumber as policyNumber,
  vehicle.plate       as plate
};
