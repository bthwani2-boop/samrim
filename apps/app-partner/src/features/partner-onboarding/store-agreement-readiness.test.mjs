import assert from "node:assert/strict";
import { test } from "node:test";
import { storeAgreementReadiness, ownStoreAgreementReadiness, agreementReadinessMessage } from "./store-agreement-readiness.ts";

test("a confirmed active agreement is the only successful Store setup state", () => {
  assert.equal(storeAgreementReadiness([{status:"ACTIVE"}]), "ACTIVE");
  assert.equal(storeAgreementReadiness([{status:"ACTIVE"},{status:"PROPOSED"}]), "ACTIVE");
  assert.equal(agreementReadinessMessage("ACTIVE"), "الاتفاقية سارية");
});

test("unaccepted, finance-pending and absent agreements never appear active", () => {
  assert.equal(storeAgreementReadiness([{status:"PROPOSED"}]), "AWAITING_PARTNER");
  assert.equal(storeAgreementReadiness([{status:"PARTNER_ACCEPTED"}]), "AWAITING_FINANCE");
  assert.equal(storeAgreementReadiness([{status:"SUPERSEDED"}]), "NOT_ACTIVE");
  assert.equal(storeAgreementReadiness([{status:"REJECTED"}]), "NOT_ACTIVE");
  assert.equal(storeAgreementReadiness([]), "NOT_ACTIVE");
});

test("a mismatched Store or owner cannot receive another Store's ACTIVE status", () => {
  const list=[{status:"ACTIVE",storeId:"s1",partnerActorId:"owner1"}];
  assert.equal(ownStoreAgreementReadiness(list,"s1","owner1"),"ACTIVE");
  assert.equal(ownStoreAgreementReadiness(list,"s2","owner1"),"UNAVAILABLE");
  assert.equal(ownStoreAgreementReadiness(list,"s1","owner2"),"UNAVAILABLE");
  assert.equal(ownStoreAgreementReadiness([],"s1","owner1"),"NOT_ACTIVE");
});

test("unknown owner readback stays unknown rather than inventing a completed step", () => {
  assert.match(agreementReadinessMessage(null), /جارٍ التحقق/);
  assert.match(agreementReadinessMessage("UNAVAILABLE"), /تعذر التحقق/);
  assert.notEqual(agreementReadinessMessage("UNAVAILABLE"), agreementReadinessMessage("ACTIVE"));
});
