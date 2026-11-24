import { DshPublicError } from "./client-core.ts";
import { isCustomerAddressId, parseDeliveryServiceability, type DeliveryServiceability } from "./customer-addresses.ts";
import { parseCustomerCartMerchandiseEstimate, type CustomerCartMerchandiseEstimate } from "./customer-cart.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export type CheckoutRecipientPurpose = "SELF" | "OTHER";
export type CheckoutFulfillmentMode = "BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP";
export type CustomerCheckoutReviewInput = Readonly<{
  expectedCartVersion: number; recipientPurpose: CheckoutRecipientPurpose; fulfillmentMode: CheckoutFulfillmentMode;
  addressId?: string; expectedAddressVersion?: number; recipientName?: string; recipientPhone?: string; deliveryInstructions?: string;
}>;
export type CustomerCheckoutBlocker = "FULFILLMENT_MODE_NOT_ADMITTED" | "PAYABLE_QUOTE_NOT_AVAILABLE" |
  "PAYMENT_ALLOCATION_NOT_AVAILABLE" | "ADDRESS_UNSERVICEABLE";
export type CustomerCheckoutReview = Readonly<{
  actorId: string; storeId: string; cartVersion: number;
  recipientPurpose: CheckoutRecipientPurpose; fulfillmentMode: CheckoutFulfillmentMode;
  merchandise: CustomerCartMerchandiseEstimate; delivery?: DeliveryServiceability;
  checkoutReady: false; blockers: CustomerCheckoutBlocker[];
  storeSchedule: Readonly<{status: "UNAVAILABLE" | "OPEN_BY_SCHEDULE" | "CLOSED_BY_SCHEDULE" | "PAUSED"; version?: number}>;
}>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const version = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const text = (v: unknown, max: number): v is string => typeof v === "string" &&
  v === v.trim() && [...v].length >= 1 && [...v].length <= max && !/[\p{Cc}\p{Cf}\uFFFD\uD800-\uDFFF]/u.test(v);
const storeRule = /^[a-z0-9-]{1,64}$/;
const inputKeys = ["expectedCartVersion", "recipientPurpose", "fulfillmentMode", "addressId",
  "expectedAddressVersion", "recipientName", "recipientPhone", "deliveryInstructions"];
export function validCustomerCheckoutReviewInput(v: unknown): v is CustomerCheckoutReviewInput {
  if (!object(v) || Object.keys(v).some(k => !inputKeys.includes(k)) || !version(v.expectedCartVersion)) return false;
  const has = (k: string) => Object.hasOwn(v, k);
  if (v.recipientPurpose === "SELF") {
    if (has("recipientName") || has("recipientPhone") || has("deliveryInstructions")) return false;
  } else if (v.recipientPurpose === "OTHER") {
    if (!text(v.recipientName, 100) || typeof v.recipientPhone !== "string" ||
      !/^\+[1-9][0-9]{7,14}$/.test(v.recipientPhone) ||
      (has("deliveryInstructions") && !text(v.deliveryInstructions, 300))) return false;
  } else return false;
  if (v.fulfillmentMode === "CUSTOMER_PICKUP") {
    return !has("addressId") && !has("expectedAddressVersion") && !has("deliveryInstructions");
  }
  return (v.fulfillmentMode === "BTHWANI_CAPTAIN" || v.fulfillmentMode === "PARTNER_CAPTAIN") &&
    typeof v.addressId === "string" && isCustomerAddressId(v.addressId) && version(v.expectedAddressVersion);
}
export function parseCustomerCheckoutReview(raw: unknown, storeId: string, actorId: string,
  input: CustomerCheckoutReviewInput): CustomerCheckoutReview {
  const invalid = () => new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  if (!validCustomerCheckoutReviewInput(input) || !object(raw)) throw invalid();
  const keys = ["actorId", "storeId", "cartVersion", "recipientPurpose", "fulfillmentMode", "merchandise", "checkoutReady", "blockers", "storeSchedule",
    ...(input.addressId ? ["delivery"] : [])];
  if (Object.keys(raw).length !== keys.length || keys.some(k => !Object.hasOwn(raw, k)) ||
    raw.actorId !== actorId || raw.storeId !== storeId || raw.cartVersion !== input.expectedCartVersion ||
    raw.recipientPurpose !== input.recipientPurpose || raw.fulfillmentMode !== input.fulfillmentMode || raw.checkoutReady !== false) throw invalid();
  const schedule = raw.storeSchedule;
  if (!object(schedule)) throw invalid();
  const status = schedule.status;
  if (status !== "UNAVAILABLE" && status !== "OPEN_BY_SCHEDULE" && status !== "CLOSED_BY_SCHEDULE" && status !== "PAUSED") throw invalid();
  if (status === "UNAVAILABLE" ? Object.keys(schedule).length !== 1 : Object.keys(schedule).length !== 2 || !version(schedule.version)) throw invalid();
  const storeSchedule: CustomerCheckoutReview["storeSchedule"] = { status, ...(status !== "UNAVAILABLE" && version(schedule.version) ? { version: schedule.version } : {}) };
  let merchandise: CustomerCartMerchandiseEstimate;
  let delivery: DeliveryServiceability | undefined;
  try {
    merchandise = parseCustomerCartMerchandiseEstimate(raw.merchandise, storeId, actorId, input.expectedCartVersion);
    if (input.addressId) {
      delivery = parseDeliveryServiceability(raw.delivery, actorId, storeId, input.addressId);
      if (!delivery.evidence || delivery.evidence.addressVersion !== input.expectedAddressVersion) throw invalid();
    }
  } catch { throw invalid(); }
  const blockers: CustomerCheckoutBlocker[] = ["FULFILLMENT_MODE_NOT_ADMITTED", "PAYABLE_QUOTE_NOT_AVAILABLE", "PAYMENT_ALLOCATION_NOT_AVAILABLE"];
  if (delivery?.status === "UNSERVICEABLE") blockers.push("ADDRESS_UNSERVICEABLE");
  const returnedBlockers = raw.blockers;
  if (!Array.isArray(returnedBlockers) || returnedBlockers.length !== blockers.length ||
    blockers.some((b, i) => returnedBlockers[i] !== b)) throw invalid();
  return { actorId, storeId, cartVersion: input.expectedCartVersion, recipientPurpose: input.recipientPurpose,
    fulfillmentMode: input.fulfillmentMode, merchandise, ...(delivery ? { delivery } : {}), checkoutReady: false, blockers, storeSchedule };
}
export async function reviewCurrentCustomerCheckout(origin: string, bearer: string, actorId: string,
  storeId: string, input: CustomerCheckoutReviewInput, signal?: AbortSignal): Promise<CustomerCheckoutReview> {
  if (!storeRule.test(storeId) || !validCustomerCheckoutReviewInput(input)) throw new DshPublicError(400, "INVALID_REQUEST");
  const path = dshOperations.reviewCurrentCustomerCheckout.path.replace("{storeID}", storeId);
  const value = await privateOwnerRequest(origin, path, bearer, "POST", input, signal);
  return parseCustomerCheckoutReview(value, storeId, actorId, input);
}
