import { DshPublicError } from "./client-core.ts";
import { type DeliveryServiceability, isCustomerAddressId, parseDeliveryServiceability } from "./customer-addresses.ts";
import { type CustomerCartMerchandiseEstimate, parseCustomerCartMerchandiseEstimate } from "./customer-cart.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export type CheckoutSalesChannel = "DIRECT" | "MARKETPLACE";
export type CheckoutRecipientPurpose = "SELF" | "OTHER";
export type CheckoutFulfillmentMode = "BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP";
export type CustomerCheckoutReviewInput = Readonly<{
  expectedCartVersion: number; salesChannel: CheckoutSalesChannel; recipientPurpose: CheckoutRecipientPurpose; fulfillmentMode: CheckoutFulfillmentMode;
  addressId?: string; expectedAddressVersion?: number; recipientName?: string; recipientPhone?: string; deliveryInstructions?: string;
}>;
export type CustomerCheckoutBlocker = "FULFILLMENT_MODE_NOT_ADMITTED" | "PAYABLE_QUOTE_NOT_AVAILABLE" |
  "PAYMENT_ALLOCATION_NOT_AVAILABLE" | "ADDRESS_UNSERVICEABLE";
type CityFulfillmentPolicy = Readonly<{storeRelation: "DIRECT" | "MARKETPLACE"} & (
  {status: "UNCONFIGURED"} |
  {status: "ALLOWED_BY_CITY_POLICY" | "DENIED_BY_CITY_POLICY"; version: number}
)>;
export type CustomerCheckoutReview = Readonly<{
  actorId: string; storeId: string; cartVersion: number; salesChannel: CheckoutSalesChannel;
  recipientPurpose: CheckoutRecipientPurpose; fulfillmentMode: CheckoutFulfillmentMode;
  merchandise: CustomerCartMerchandiseEstimate; delivery?: DeliveryServiceability;
  distanceFeeEstimate?: Readonly<{policyVersion: number; distanceMetres: number; feeYer: string}>;
  checkoutReady: false; blockers: CustomerCheckoutBlocker[];
  storeSchedule: Readonly<
    {status: "UNAVAILABLE"} |
    {status: "OPEN_BY_SCHEDULE" | "CLOSED_BY_SCHEDULE"; version: number} |
    {status: "PAUSED"; version: number; pausedUntil?: string}
  >;
  cityFulfillmentPolicy?: CityFulfillmentPolicy;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function version(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
function storeValid(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value);
}
function recipientText(value: unknown, max: number): value is string {
  return typeof value === "string" && value === value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "") &&
    [...value].length >= 1 && [...value].length <= max && !/[\p{Cc}\p{Cf}\p{Cs}\uFFFD]/u.test(value);
}
function invalid(): never { throw new DshPublicError(502, "OWNER_RESPONSE_INVALID"); }

// Capture only the exact scalar wire fields. One detached command binds
// validation, serialization and owner readback, including optional PII.
function submission(value: unknown): CustomerCheckoutReviewInput | undefined {
  if (!record(value)) return undefined;
  const { expectedCartVersion, salesChannel, recipientPurpose, fulfillmentMode } = value;
  if (!version(expectedCartVersion) || (salesChannel !== "DIRECT" && salesChannel !== "MARKETPLACE") ||
    (recipientPurpose !== "SELF" && recipientPurpose !== "OTHER") ||
    (fulfillmentMode !== "CUSTOMER_PICKUP" && fulfillmentMode !== "BTHWANI_CAPTAIN" && fulfillmentMode !== "PARTNER_CAPTAIN")) return undefined;
  const common: CustomerCheckoutReviewInput = { expectedCartVersion, salesChannel, recipientPurpose, fulfillmentMode };
  const keys = ["expectedCartVersion", "salesChannel", "recipientPurpose", "fulfillmentMode"];
  let recipient: Pick<CustomerCheckoutReviewInput, "recipientName" | "recipientPhone" | "deliveryInstructions"> = {};
  if (recipientPurpose === "OTHER") {
    const { recipientName, recipientPhone } = value;
    if (!recipientText(recipientName, 100) || typeof recipientPhone !== "string" || !/^\+[1-9][0-9]{7,14}$/.test(recipientPhone)) return undefined;
    keys.push("recipientName", "recipientPhone");
    recipient = { recipientName, recipientPhone };
    if (fulfillmentMode !== "CUSTOMER_PICKUP" && Object.hasOwn(value, "deliveryInstructions")) {
      const { deliveryInstructions } = value;
      if (!recipientText(deliveryInstructions, 300)) return undefined;
      keys.push("deliveryInstructions");
      recipient = { ...recipient, deliveryInstructions };
    }
  }
  if (fulfillmentMode === "CUSTOMER_PICKUP") {
    return exact(value, keys) ? { ...common, ...recipient } : undefined;
  }
  const { addressId, expectedAddressVersion } = value;
  keys.push("addressId", "expectedAddressVersion");
  if (!exact(value, keys) || typeof addressId !== "string" || !isCustomerAddressId(addressId) || !version(expectedAddressVersion)) return undefined;
  return { ...common, ...recipient, addressId, expectedAddressVersion };
}
export function validCustomerCheckoutReviewInput(value: unknown): value is CustomerCheckoutReviewInput {
  return submission(value) !== undefined;
}

function scheduleFrom(value: unknown): CustomerCheckoutReview["storeSchedule"] {
  if (!record(value)) invalid();
  const { status, version: scheduleVersion } = value;
  if (status === "UNAVAILABLE" && exact(value, ["status"])) return { status };
  if (!version(scheduleVersion)) invalid();
  if ((status === "OPEN_BY_SCHEDULE" || status === "CLOSED_BY_SCHEDULE" || status === "PAUSED") &&
    exact(value, ["status", "version"])) return { status, version: scheduleVersion };
  if (status === "PAUSED" && exact(value, ["status", "version", "pausedUntil"])) {
    const { pausedUntil } = value;
    if (typeof pausedUntil === "string" && !pausedUntil.startsWith("0000-") &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(pausedUntil)) {
      // Keep owner precision on the wire. Validate the calendar using standard millisecond ISO syntax.
      const wholeSecond = `${pausedUntil.slice(0, 19)}.000Z`;
      const expiry = new Date(wholeSecond);
      if (Number.isFinite(expiry.getTime()) && expiry.toISOString() === wholeSecond) {
        return { status, version: scheduleVersion, pausedUntil };
      }
    }
  }
  return invalid();
}

function cityFulfillmentFrom(value: unknown, channel: CheckoutSalesChannel): CityFulfillmentPolicy {
  if (!record(value)) invalid();
  const { storeRelation, status } = value;
  if ((storeRelation !== "DIRECT" && storeRelation !== "MARKETPLACE") ||
    (channel === "MARKETPLACE" && storeRelation !== "MARKETPLACE")) invalid();
  if (status === "UNCONFIGURED" && exact(value, ["storeRelation", "status"])) return { storeRelation, status };
  if ((status === "ALLOWED_BY_CITY_POLICY" || status === "DENIED_BY_CITY_POLICY") &&
    exact(value, ["storeRelation", "status", "version"]) && version(value.version)) {
    return { storeRelation, status, version: value.version };
  }
  return invalid();
}

function feeFrom(value: unknown, delivery?: DeliveryServiceability): NonNullable<CustomerCheckoutReview["distanceFeeEstimate"]> {
  const evidence = delivery?.evidence;
  if (!record(value) || !exact(value, ["policyVersion", "distanceMetres", "feeYer"]) ||
    delivery?.status !== "SERVICEABLE" || !evidence) invalid();
  const { policyVersion, distanceMetres, feeYer } = value;
  if (policyVersion !== evidence.policyVersion || typeof distanceMetres !== "number" || !Number.isSafeInteger(distanceMetres) ||
    distanceMetres !== Math.round(evidence.distanceMetres) || distanceMetres < 0 || distanceMetres > evidence.radiusMetres ||
    typeof feeYer !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(feeYer) ||
    BigInt(feeYer) > BigInt(distanceMetres) * 100000n || (distanceMetres > 0 && feeYer === "0")) invalid();
  return { policyVersion, distanceMetres, feeYer };
}

function reviewFrom(raw: unknown, storeId: string, actorId: string, input: CustomerCheckoutReviewInput): CustomerCheckoutReview {
  if (!record(raw)) invalid();
  const keys = ["actorId", "storeId", "cartVersion", "salesChannel", "recipientPurpose", "fulfillmentMode",
    "merchandise", "checkoutReady", "blockers", "storeSchedule"];
  if (input.addressId !== undefined) keys.push("delivery");
  if (Object.hasOwn(raw, "distanceFeeEstimate")) keys.push("distanceFeeEstimate");
  if (Object.hasOwn(raw, "cityFulfillmentPolicy")) keys.push("cityFulfillmentPolicy");
  if (!exact(raw, keys) || raw.actorId !== actorId || raw.storeId !== storeId || raw.cartVersion !== input.expectedCartVersion ||
    raw.salesChannel !== input.salesChannel || raw.recipientPurpose !== input.recipientPurpose ||
    raw.fulfillmentMode !== input.fulfillmentMode || raw.checkoutReady !== false) invalid();
  const storeSchedule = scheduleFrom(raw.storeSchedule);
  const cityFulfillmentPolicy = Object.hasOwn(raw, "cityFulfillmentPolicy") ?
    cityFulfillmentFrom(raw.cityFulfillmentPolicy, input.salesChannel) : undefined;
  let merchandise: CustomerCartMerchandiseEstimate;
  let delivery: DeliveryServiceability | undefined;
  try {
    merchandise = parseCustomerCartMerchandiseEstimate(raw.merchandise, storeId, actorId, input.expectedCartVersion);
    if (input.addressId !== undefined) {
      delivery = parseDeliveryServiceability(raw.delivery, actorId, storeId, input.addressId);
      if (!delivery.evidence || delivery.evidence.addressVersion !== input.expectedAddressVersion) invalid();
    }
  } catch { return invalid(); }
  const distanceFeeEstimate = Object.hasOwn(raw, "distanceFeeEstimate") ? feeFrom(raw.distanceFeeEstimate, delivery) : undefined;
  const blockers: CustomerCheckoutBlocker[] = ["FULFILLMENT_MODE_NOT_ADMITTED", "PAYABLE_QUOTE_NOT_AVAILABLE", "PAYMENT_ALLOCATION_NOT_AVAILABLE"];
  if (delivery?.status === "UNSERVICEABLE") blockers.push("ADDRESS_UNSERVICEABLE");
  const returned = raw.blockers;
  if (!Array.isArray(returned) || returned.length !== blockers.length ||
    blockers.some((blocker, index) => !Object.hasOwn(returned, index) || returned[index] !== blocker)) invalid();
  return { actorId, storeId, cartVersion: input.expectedCartVersion, salesChannel: input.salesChannel,
    recipientPurpose: input.recipientPurpose, fulfillmentMode: input.fulfillmentMode, merchandise,
    ...(delivery ? { delivery } : {}), ...(distanceFeeEstimate ? { distanceFeeEstimate } : {}),
    checkoutReady: false, blockers, storeSchedule, ...(cityFulfillmentPolicy ? { cityFulfillmentPolicy } : {}) };
}

export function parseCustomerCheckoutReview(raw: unknown, storeId: string, actorId: string,
  input: CustomerCheckoutReviewInput): CustomerCheckoutReview {
  const submitted = submission(input);
  if (!submitted || !storeValid(storeId)) invalid();
  return reviewFrom(raw, storeId, actorId, submitted);
}

export async function reviewCurrentCustomerCheckout(origin: string, bearer: string, actorId: string,
  storeId: string, input: CustomerCheckoutReviewInput, signal?: AbortSignal): Promise<CustomerCheckoutReview> {
  const submitted = submission(input);
  if (!storeValid(storeId) || !submitted) throw new DshPublicError(400, "INVALID_REQUEST");
  const operation = dshOperations.reviewCurrentCustomerCheckout;
  const value = await privateOwnerRequest(origin, operation.path.replace("{storeID}", storeId), bearer, operation.method, submitted, signal);
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  return reviewFrom(value, storeId, actorId, submitted);
}
