import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCustomerCheckoutReview, reviewCurrentCustomerCheckout, validCustomerCheckoutReviewInput } from "./customer-checkout-review.ts";

const input = { expectedCartVersion: 4, salesChannel: "DIRECT", recipientPurpose: "SELF", fulfillmentMode: "CUSTOMER_PICKUP" };
const result = { actorId: "customer-a", storeId: "store-a", cartVersion: 4,
  salesChannel: "DIRECT", recipientPurpose: "SELF", fulfillmentMode: "CUSTOMER_PICKUP",
  merchandise: { actorId: "customer-a", storeId: "store-a", cartVersion: 4,
    lines: [{ offerId: "offer-a", variantId: "variant-a", quantity: 2, unitYer: "550", lineTotalYer: "1100" }],
    merchandiseSubtotalYer: "1100", checkoutReady: false },
  storeSchedule: { status: "OPEN_BY_SCHEDULE", version: 3 },
  checkoutReady: false, blockers: ["FULFILLMENT_MODE_NOT_ADMITTED", "PAYABLE_QUOTE_NOT_AVAILABLE", "PAYMENT_ALLOCATION_NOT_AVAILABLE"] };
const origin = "http://127.0.0.1:3202";
const bearer = Buffer.alloc(32, 14).toString("base64url");
const read = (value, signal, store = "store-a") => reviewCurrentCustomerCheckout(origin, bearer, "customer-a", store, value, signal);
const json = value => Response.json(value, { headers: { "Cache-Control": "no-store" } });

test("required request fields must be own wire fields", async t => {
  const { salesChannel, ...rest } = input;
  const inherited = Object.assign(Object.create({ salesChannel }), rest);
  assert.equal(validCustomerCheckoutReviewInput(inherited), false);
  const f = t.mock.method(globalThis, "fetch", async () => json(result));
  await assert.rejects(read(inherited), { status: 400, code: "INVALID_REQUEST" });
  await assert.rejects(read(input, undefined, ["store-a"]), { status: 400, code: "INVALID_REQUEST" });
  assert.equal(f.mock.callCount(), 0);
});

test("review binds readback to submitted scalar snapshot, not mutable caller", async t => {
  const command = { ...input };
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), input);
    command.salesChannel = "MARKETPLACE";
    command.expectedCartVersion = 5;
    return json(result);
  });
  assert.deepEqual(await read(command), result);
});

test("receipt schedule must contain exact own fields", () => {
  for (const schedule of [
    Object.assign(Object.create({ status: "OPEN_BY_SCHEDULE" }), { version: 3, unrelated: true }),
    Object.assign(Object.create({ version: 3 }), { status: "OPEN_BY_SCHEDULE", unrelated: true }),
    Object.assign(Object.create({ status: "UNAVAILABLE" }), { unrelated: true }),
  ]) {
    assert.throws(() => parseCustomerCheckoutReview({ ...result, storeSchedule: schedule }, "store-a", "customer-a", input),
      { status: 502, code: "OWNER_RESPONSE_INVALID" });
  }
});

test("checkout keeps the city policy separate from the sales channel and overall eligibility", () => {
  const allowed = { storeRelation: "MARKETPLACE", status: "ALLOWED_BY_CITY_POLICY", version: 4 };
  for (const cityFulfillmentPolicy of [
    allowed,
    { ...allowed, status: "DENIED_BY_CITY_POLICY" },
    { storeRelation: "DIRECT", status: "UNCONFIGURED" },
  ]) {
    const evidence = { ...result, cityFulfillmentPolicy };
    assert.deepEqual(parseCustomerCheckoutReview(evidence, "store-a", "customer-a", input), evidence);
  }
  for (const cityFulfillmentPolicy of [
    { ...allowed, status: "UNCONFIGURED" }, { ...allowed, status: "OPEN" },
    { ...allowed, version: 0 }, { ...allowed, changedByActor: "private" }, null,
  ]) {
    assert.throws(() => parseCustomerCheckoutReview({ ...result, cityFulfillmentPolicy }, "store-a", "customer-a", input),
      { status: 502, code: "OWNER_RESPONSE_INVALID" });
  }
  assert.throws(() => parseCustomerCheckoutReview({ ...result, salesChannel: "MARKETPLACE",
    cityFulfillmentPolicy: { ...allowed, storeRelation: "DIRECT" } }, "store-a", "customer-a",
  { ...input, salesChannel: "MARKETPLACE" }), { status: 502, code: "OWNER_RESPONSE_INVALID" });
});

test("admission follows exact pickup and delivery recipient combinations", () => {
  const addressId = "addr-00000000000000000000000000000001";
  const other = { recipientPurpose: "OTHER", recipientName: "Recipient", recipientPhone: "+967770000001" };
  const delivery = { fulfillmentMode: "PARTNER_CAPTAIN", addressId, expectedAddressVersion: 2 };
  for (const command of [input, { ...input, ...other }, { ...input, ...delivery },
    { ...input, ...other, ...delivery, deliveryInstructions: "Door" }]) {
    assert.equal(validCustomerCheckoutReviewInput(command), true);
  }
  for (const command of [null, [], { ...input, ...other, recipientName: " " },
    { ...input, ...other, recipientPhone: "123" }, { ...input, ...other, recipientName: "\u0085Name" },
    { ...input, ...other, deliveryInstructions: "Door" }, { ...input, ...other, ...delivery, deliveryInstructions: "\uFFFD" },
    { ...input, ...delivery, addressId: "wrong" }, { ...input, ...delivery, expectedAddressVersion: 0 },
    { ...input, fulfillmentMode: "UNKNOWN" }]) assert.equal(validCustomerCheckoutReviewInput(command), false);
  assert.throws(() => parseCustomerCheckoutReview(null, "store-a", "customer-a", input), {status:502,code:"OWNER_RESPONSE_INVALID"});
  assert.throws(() => parseCustomerCheckoutReview(result, "store-a", "customer-a", {}), {status:502,code:"OWNER_RESPONSE_INVALID"});
  assert.deepEqual(parseCustomerCheckoutReview({ ...result, storeSchedule: { status: "UNAVAILABLE" } }, "store-a", "customer-a", input).storeSchedule, { status: "UNAVAILABLE" });
});

test("serviceability and fee evidence remain version-bound and non-payable", () => {
  const addressId = "addr-00000000000000000000000000000001";
  const command = { ...input, fulfillmentMode: "BTHWANI_CAPTAIN", addressId, expectedAddressVersion: 2 };
  const evidence = {storeCityId:"sanaa",addressCityId:"aden",addressVersion:2,policyVersion:7,radiusMetres:30000,distanceMetres:40000};
  const candidate = { ...result, fulfillmentMode: command.fulfillmentMode, delivery: {actorId:"customer-a",storeId:"store-a",addressId,status:"UNSERVICEABLE",evidence},
    blockers:[...result.blockers,"ADDRESS_UNSERVICEABLE"] };
  assert.deepEqual(parseCustomerCheckoutReview(candidate,"store-a","customer-a",command),candidate);
  for(const receipt of [{...candidate, delivery:{...candidate.delivery,evidence:{...evidence,addressVersion:3}}},
    {...candidate,blockers:result.blockers}]) assert.throws(()=>parseCustomerCheckoutReview(receipt,"store-a","customer-a",command),{status:502,code:"OWNER_RESPONSE_INVALID"});
  const zero = {...candidate,delivery:{...candidate.delivery,status:"SERVICEABLE",evidence:{...evidence,addressCityId:"sanaa",distanceMetres:0}},
    blockers:result.blockers,distanceFeeEstimate:{policyVersion:7,distanceMetres:0,feeYer:"0"}};
  assert.deepEqual(parseCustomerCheckoutReview(zero,"store-a","customer-a",command),zero);
  assert.throws(()=>parseCustomerCheckoutReview({...zero,distanceFeeEstimate:Object.assign(Object.create({feeYer:"0"}),{policyVersion:7,distanceMetres:0,extra:true})},"store-a","customer-a",command),{status:502,code:"OWNER_RESPONSE_INVALID"});
});
