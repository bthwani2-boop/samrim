import { WltReadError } from "./errors.ts";
import { wltOperations } from "./generated/wlt-operations.ts";
import { readOwner } from "./transport.ts";
import { fundingIdValid } from "./validation.ts";

const storeRule = /^[a-z0-9-]{1,64}$/;
const states = ["AWAITING_MERCHANT_CONSENT", "AWAITING_FINANCE_REVIEW", "DECLINED",
  "FINANCE_REJECTED", "REVIEW_APPROVED_PENDING_ACTIVATION"] as const;
const modes = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"] as const;
type Proposal = {
  version: number;
  operationId: string;
  storeRelation: "MARKETPLACE" | "DIRECT";
  collector: "PLATFORM_MANAGED" | "STORE_MANAGED";
  currency: "YER";
  fulfillmentModes: (typeof modes)[number][];
  proposedEffectiveAt: string;
  reviewState: (typeof states)[number];
} & (
  { feeModel: "COMMISSION"; commissionBasisPoints: number; subscriptionAmountYer: null; subscriptionPeriodDays: null } |
  { feeModel: "SUBSCRIPTION"; commissionBasisPoints: null; subscriptionAmountYer: string; subscriptionPeriodDays: number }
);
export type CommercialAgreementReview = { storeId: string; proposal: Proposal | null };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WltReadError(502);
  return value as Record<string, unknown>;
}
function member<T extends string>(value: unknown, list: readonly T[]): value is T {
  return typeof value === "string" && list.some(item => item === value);
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const stamp = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,9})?Z$/.exec(value);
  const ms = Date.parse(value);
  return !!stamp && Number.isFinite(ms) && new Date(ms).toISOString().slice(0,19) === stamp[1];
}

export function parseCommercialAgreementReview(value: unknown, storeId: string): CommercialAgreementReview {
  const data = record(value);
  if (!storeRule.test(storeId) || data.storeId !== storeId || Object.keys(data).length !== 2) throw new WltReadError(502);
  if (data.proposal === null) return { storeId, proposal: null };
  const p = record(data.proposal);
  if (Object.keys(p).length !== 12 || !integer(p.version,1,Number.MAX_SAFE_INTEGER) ||
      !fundingIdValid(p.operationId) || !member(p.storeRelation,["MARKETPLACE","DIRECT"]) ||
      !member(p.feeModel,["COMMISSION","SUBSCRIPTION"]) ||
      !member(p.collector,["PLATFORM_MANAGED","STORE_MANAGED"]) || p.currency !== "YER" ||
      !validDate(p.proposedEffectiveAt) || !member(p.reviewState,states) ||
      !Array.isArray(p.fulfillmentModes) || p.fulfillmentModes.length < 1 || p.fulfillmentModes.length > 3 ||
      !p.fulfillmentModes.every(mode=>member(mode,modes)) ||
      new Set(p.fulfillmentModes).size !== p.fulfillmentModes.length) throw new WltReadError(502);
  if (p.feeModel === "COMMISSION") {
    if (!integer(p.commissionBasisPoints,0,10000) || p.subscriptionAmountYer !== null ||
        p.subscriptionPeriodDays !== null) throw new WltReadError(502);
  } else if (p.commissionBasisPoints !== null || typeof p.subscriptionAmountYer !== "string" ||
      !/^[1-9][0-9]{0,18}$/.test(p.subscriptionAmountYer) || BigInt(p.subscriptionAmountYer) > 9223372036854775807n ||
      !integer(p.subscriptionPeriodDays,1,2147483647)) throw new WltReadError(502);
  return { storeId, proposal: p as Proposal };
}

export async function readOperatorCommercialAgreementReview(origin: string, bearer: string,
  storeId: string, signal: AbortSignal): Promise<CommercialAgreementReview> {
  if (!storeRule.test(storeId)) throw new WltReadError(400);
  const operation = wltOperations.getOperatorCommercialAgreementReview;
  return parseCommercialAgreementReview(await readOwner(origin,bearer,operation.method,
    operation.path.replace("{storeID}",storeId),signal),storeId);
}
