import assert from "node:assert/strict";
import { test } from "node:test";
import { storeAgreementReadiness, ownStoreAgreementReadiness, agreementReadinessMessage, agreementStatusLabel, agreementReadbackErrorMessage } from "./store-agreement-readiness.ts";

test("a confirmed active agreement is the only successful Store setup state", () => {
  assert.equal(storeAgreementReadiness([{status:"ACTIVE"}]), "ACTIVE");
  assert.equal(storeAgreementReadiness([{status:"ACTIVE"},{status:"PROPOSED"}]), "ACTIVE");
  assert.equal(agreementReadinessMessage("ACTIVE"), "الاتفاقية سارية");
});

test("unaccepted, finance-pending and absent agreements never appear active", () => {
  assert.equal(storeAgreementReadiness([{status:"PROPOSED",commercialModel:"COMMISSION"}]), "AWAITING_PARTNER");
  assert.equal(storeAgreementReadiness([{status:"PROPOSED"}]), "NOT_ACTIVE");
  assert.equal(storeAgreementReadiness([{status:"PARTNER_ACCEPTED",commercialModel:"COMMISSION"}]), "AWAITING_FINANCE");
  assert.equal(storeAgreementReadiness([{status:"PARTNER_ACCEPTED"}]), "NOT_ACTIVE");
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

test("subscription acceptance does not masquerade as an agreement awaiting routine Finance activation", () => {
  const accepted = {status: "PARTNER_ACCEPTED", commercialModel: "SUBSCRIPTION", storeId: "store-1", partnerActorId: "owner-1"};
  assert.equal(storeAgreementReadiness([accepted]), "SUBSCRIPTION_PENDING_BILLING");
  assert.equal(ownStoreAgreementReadiness([accepted], "store-1", "owner-1"), "SUBSCRIPTION_PENDING_BILLING");
  assert.equal(ownStoreAgreementReadiness([accepted], "store-2", "owner-1"), "UNAVAILABLE");
  assert.match(agreementReadinessMessage("SUBSCRIPTION_PENDING_BILLING"), /التفعيل والتحصيل متوقفان/);
  assert.match(agreementStatusLabel(accepted), /التفعيل والتحصيل متوقفان/);
  assert.notEqual(storeAgreementReadiness([accepted]), "ACTIVE");
});

test("retired hybrid pending proposals cannot appear ready for Partner consent or Finance", () => {
  const legacy = {status: "PROPOSED", commercialModel: "HYBRID"};
  assert.equal(storeAgreementReadiness([legacy]), "RETIRED_MODEL");
  assert.match(agreementStatusLabel(legacy), /لا يمكن قبولها أو تفعيلها/);
  assert.equal(storeAgreementReadiness([{status: "PARTNER_ACCEPTED", commercialModel: "COMMISSION"}]), "AWAITING_FINANCE");
  assert.equal(storeAgreementReadiness([{status: "PROPOSED", commercialModel: "SUBSCRIPTION"}]), "AWAITING_PARTNER");
});

test("readback failures are distinguished without leaking internal server details or inventing active terms", () => {
  assert.match(agreementReadbackErrorMessage({status: 401, code: "EXPIRED", message: "bearer secret"}), /صلاحية جلسة/);
  assert.match(agreementReadbackErrorMessage({status: 403}), /صلاحية قراءة/);
  assert.match(agreementReadbackErrorMessage({status: 404}), /العثور على المتجر/);
  assert.match(agreementReadbackErrorMessage({status: 502, code: "INVALID_RESPONSE"}), /غير مكتملة/);
  assert.match(agreementReadbackErrorMessage({status: 503}), /غير متاحة/);
  assert.doesNotMatch(agreementReadbackErrorMessage({status: 502, code: "INVALID_RESPONSE", message: "token=secret"}), /secret/);
});
