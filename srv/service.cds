using { sap.kfz as kfz } from '../db/schema';

service KfzService @(path:'/service/kfz') {
  entity Insured   as projection on kfz.Insured;
  entity Policy    as projection on kfz.Policy;
  entity Vehicle   as projection on kfz.Vehicle;
  entity Claim     as projection on kfz.Claim;
  entity Email     as projection on kfz.Email;
  entity Document  as projection on kfz.Document;
  entity Task      as projection on kfz.Task;

  type ChatResponse { response : LargeString; }
  action callLLM(prompt : String) returns ChatResponse;
}

