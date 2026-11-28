import { WltReadError } from "./errors.ts";
import { wltOperations } from "./generated/wlt-operations.ts";
import { readOwner } from "./transport.ts";
import { exactRecord, fundingIdValid } from "./validation.ts";

const relations = ["MARKETPLACE", "DIRECT"] as const;
export const agreementCollectors = ["PLATFORM_MANAGED", "STORE_MANAGED"] as const;
const states = ["AWAITING_MERCHANT_CONSENT", "AWAITING_FINANCE_REVIEW", "DECLINED",
  "FINANCE_REJECTED", "REVIEW_APPROVED_PENDING_ACTIVATION"] as const;
const modes = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"] as const;
export type FulfillmentMode = (typeof modes)[number];
export type AgreementCollector = (typeof agreementCollectors)[number];
type Proposal = {
  version: number;
  operationId: string;
  storeRelation: (typeof relations)[number];
  collector: AgreementCollector;
  currency: "YER";
  fulfillmentModes: FulfillmentMode[];
  proposedEffectiveAt: string;
  reviewState: (typeof states)[number];
} & (
  { feeModel: "COMMISSION"; commissionBasisPoints: number; subscriptionAmountYer: null; subscriptionPeriodDays: null } |
  { feeModel: "SUBSCRIPTION"; commissionBasisPoints: null; subscriptionAmountYer: string; subscriptionPeriodDays: number }
);
export type CommercialAgreementReview = { storeId: string; proposal: Proposal | null };

const proposalFields = [
  "version", "operationId", "storeRelation", "feeModel", "collector", "currency",
  "commissionBasisPoints", "subscriptionAmountYer", "subscriptionPeriodDays",
  "fulfillmentModes", "proposedEffectiveAt", "reviewState",
] as const;

export function agreementStoreValid(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value);
}

export function agreementMember<T extends string>(value: unknown, list: readonly T[]): value is T {
  return typeof value === "string" && list.some(item => item === value);
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

// The Go projection serializes UTC with up to nine fractional digits.
// Keep the original timestamp after validating the calendar components.
function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const stamp = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,9})?Z$/.exec(value);
  const ms = Date.parse(value);
  return !!stamp && Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === stamp[1];
}

export function agreementFulfillmentFrom(value: unknown): FulfillmentMode[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > modes.length) throw new WltReadError(502);
  const result: FulfillmentMode[] = [];
  for (const mode of value) {
    if (!agreementMember(mode, modes) || result.includes(mode)) throw new WltReadError(502);
    result.push(mode);
  }
  return result;
}

export function agreementSubscriptionAmountValid(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n;
}

function proposalFrom(value: unknown): Proposal {
  const {
    version, operationId, storeRelation, feeModel, collector, currency,
    commissionBasisPoints, subscriptionAmountYer, subscriptionPeriodDays,
    fulfillmentModes, proposedEffectiveAt, reviewState,
  } = exactRecord(value, proposalFields);
  if (!integer(version, 1, Number.MAX_SAFE_INTEGER) || !fundingIdValid(operationId) ||
    !agreementMember(storeRelation, relations) || !agreementMember(collector, agreementCollectors) || currency !== "YER" ||
    !validDate(proposedEffectiveAt) || !agreementMember(reviewState, states)) throw new WltReadError(502);
  const common = {
    version, operationId, storeRelation, collector, currency: "YER" as const,
    fulfillmentModes: agreementFulfillmentFrom(fulfillmentModes), proposedEffectiveAt, reviewState,
  };
  if (feeModel === "COMMISSION") {
    if (!integer(commissionBasisPoints, 0, 10000) || subscriptionAmountYer !== null ||
      subscriptionPeriodDays !== null) throw new WltReadError(502);
    return { ...common, feeModel, commissionBasisPoints, subscriptionAmountYer, subscriptionPeriodDays };
  }
  if (feeModel !== "SUBSCRIPTION" || commissionBasisPoints !== null ||
    !agreementSubscriptionAmountValid(subscriptionAmountYer) ||
    !integer(subscriptionPeriodDays, 1, 2147483647)) throw new WltReadError(502);
  return { ...common, feeModel, commissionBasisPoints, subscriptionAmountYer, subscriptionPeriodDays };
}

export function parseCommercialAgreementReview(value: unknown, storeId: string): CommercialAgreementReview {
  const data = exactRecord(value, ["storeId", "proposal"]);
  if (!agreementStoreValid(storeId) || data.storeId !== storeId) throw new WltReadError(502);
  return { storeId, proposal: data.proposal === null ? null : proposalFrom(data.proposal) };
}

type AgreementOperation =
  typeof wltOperations.getOperatorCommercialAgreementReview |
  typeof wltOperations.getOwnedMerchantCommercialAgreementReview;

async function readAgreement(operation: AgreementOperation, origin: string, bearer: string,
  storeId: string, signal: AbortSignal): Promise<CommercialAgreementReview> {
  if (!agreementStoreValid(storeId)) throw new WltReadError(400);
  const value = await readOwner(origin, bearer, operation.method, operation.path.replace("{storeID}", storeId), signal);
  return parseCommercialAgreementReview(value, storeId);
}

export function readOperatorCommercialAgreementReview(origin: string, bearer: string,
  storeId: string, signal: AbortSignal): Promise<CommercialAgreementReview> {
  return readAgreement(wltOperations.getOperatorCommercialAgreementReview, origin, bearer, storeId, signal);
}

export function readOwnedMerchantCommercialAgreementReview(origin: string, bearer: string,
  storeId: string, signal: AbortSignal): Promise<CommercialAgreementReview> {
  return readAgreement(wltOperations.getOwnedMerchantCommercialAgreementReview, origin, bearer, storeId, signal);
}
