import {
  agreementCollectors, agreementFulfillmentFrom, agreementMember, agreementStoreValid,
  agreementSubscriptionAmountValid, type AgreementCollector, type FulfillmentMode,
} from "./commercial-agreement.ts";
import { wltOperations } from "./generated/wlt-operations.ts";
import { requestIsolatedAgreementCommand } from "./transport.ts";
import { exactRecord, fundingIdValid } from "./validation.ts";

type MerchantDecision = "ACCEPTED" | "DECLINED";
type FinanceDecision = "FINANCE_APPROVED" | "FINANCE_REJECTED";
type Decision = MerchantDecision | FinanceDecision;

export type AgreementDecisionInput<D extends Decision = Decision> = Readonly<{
  version: number;
  proposalOperationId: string;
  operationId: string;
  decision: D;
  reason: string;
}>;
type AgreementReceipt = Readonly<{
  storeId: string;
  version: number;
  operationId: string;
  state: "RECORDED" | "REPLAYED";
}>;

export type AgreementDecisionReceipt = AgreementReceipt & Readonly<{ proposalOperationId: string }>;
export type AgreementProposalReceipt = AgreementReceipt;

export type AgreementProposalInput = Readonly<{
  expectedVersion: number;
  operationId: string;
  collector: AgreementCollector;
  fulfillmentModes: readonly FulfillmentMode[];
  proposedEffectiveAt: string;
  reason: string;
} & (
  { feeModel: "COMMISSION"; commissionBasisPoints: number; subscriptionAmountYer?: null; subscriptionPeriodDays?: null } |
  { feeModel: "SUBSCRIPTION"; commissionBasisPoints?: null; subscriptionAmountYer: string; subscriptionPeriodDays: number }
)>;

type Outcome = "NOT_SENT" | "REJECTED" | "UNCONFIRMED";

export class WltDecisionError extends Error {
  constructor(readonly outcome: Outcome, readonly status: number) {
    super(outcome === "UNCONFIRMED"
      ? "Agreement decision unconfirmed; reconcile the same operation and payload"
      : "Agreement decision not admitted");
    this.name = "WltDecisionError";
  }
}

export class WltProposalError extends Error {
  constructor(readonly outcome: Outcome, readonly status: number) {
    super(outcome === "UNCONFIRMED"
      ? "Agreement proposal unconfirmed; reconcile the same operation and payload"
      : "Agreement proposal not admitted");
    this.name = "WltProposalError";
  }
}

const rejectionCodes: Readonly<Partial<Record<number, string>>> = {
  400: "INVALID_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN",
};

function validReason(reason: unknown): reason is string {
  return typeof reason === "string" && reason.length > 0 && Array.from(reason).length <= 300 &&
    !/^\p{White_Space}|\p{White_Space}$|[\p{Cc}\p{Cs}]/u.test(reason);
}

function admitDecision<D extends Decision>(input: AgreementDecisionInput<D>, choices: readonly D[]): AgreementDecisionInput<D> {
  try {
    const fields = exactRecord(input, ["version", "proposalOperationId", "operationId", "decision", "reason"]);
    const { version, proposalOperationId, operationId, decision, reason } = fields;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 ||
      !fundingIdValid(proposalOperationId) || !fundingIdValid(operationId) ||
      !agreementMember(decision, choices) || !validReason(reason)) {
      throw new WltDecisionError("NOT_SENT", 400);
    }
    return { version, proposalOperationId, operationId, decision, reason };
  } catch {
    throw new WltDecisionError("NOT_SENT", 400);
  }
}

type DecisionOperation = typeof wltOperations.recordIsolatedMerchantAgreementDecision |
  typeof wltOperations.recordIsolatedFinanceAgreementDecision;
type CommandOperation = DecisionOperation | typeof wltOperations.recordIsolatedFinanceAgreementProposal;
type CommandError = typeof WltDecisionError | typeof WltProposalError;

function admitConnection(origin: string, bearer: string, storeId: string, ErrorType: CommandError) {
  const address = typeof origin === "string" && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
  if (!address || Number(address[1]) > 65535) throw new ErrorType("NOT_SENT", 503);
  if (typeof bearer !== "string" || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(bearer)) {
    throw new ErrorType("NOT_SENT", 401);
  }
  if (!agreementStoreValid(storeId)) throw new ErrorType("NOT_SENT", 400);
}

async function submit<T extends Omit<AgreementReceipt, "state">>(operation: CommandOperation,
  origin: string, bearer: string, expected: T, command: AgreementDecisionInput | AgreementProposalInput,
  signal: AbortSignal, ErrorType: CommandError, conflict: string): Promise<Readonly<T & Pick<AgreementReceipt, "state">>> {
  if (signal.aborted) throw new ErrorType("NOT_SENT", 503);
  try {
    const { status, value } = await requestIsolatedAgreementCommand(origin, bearer,
      operation.path.replace("{storeID}", expected.storeId), JSON.stringify(command), signal);
    if (status !== 200) {
      const rejection = exactRecord(value, ["error"]);
      const code = status === 409 ? conflict : rejectionCodes[status];
      if (code && rejection.error === code) {
        throw new ErrorType("REJECTED", status);
      }
      throw new ErrorType("UNCONFIRMED", 503);
    }
    const identities = Object.entries(expected);
    const receipt = exactRecord(value, [...Object.keys(expected), "state"]);
    if (!identities.every(([key, field]) => receipt[key] === field) ||
      (receipt.state !== "RECORDED" && receipt.state !== "REPLAYED")) {
      throw new ErrorType("UNCONFIRMED", 503);
    }
    return Object.freeze({ ...expected, state: receipt.state });
  } catch (error) {
    if (error instanceof ErrorType) throw error;
    throw new ErrorType("UNCONFIRMED", 503);
  }
}

async function record<D extends Decision>(operation: DecisionOperation, choices: readonly D[], origin: string,
  bearer: string, storeId: string, input: AgreementDecisionInput<D>, signal: AbortSignal): Promise<AgreementDecisionReceipt> {
  admitConnection(origin, bearer, storeId, WltDecisionError);
  const command = admitDecision(input, choices);
  return submit(operation, origin, bearer, {
    storeId, version: command.version, proposalOperationId: command.proposalOperationId, operationId: command.operationId,
  }, command, signal, WltDecisionError, "DECISION_CONFLICT");
}

function validProposalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.([0-9]{1,9}))?(Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/.exec(value);
  if (!match) return false;
  const [, stamp = "", fraction = "", zone = ""] = match;
  if (stamp.startsWith("0000-")) return false;
  if (/[1-9]/.test(fraction.slice(6))) return false;
  const local = Date.parse(stamp + "Z");
  if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, 19) !== stamp) return false;
  const instant = new Date(stamp + zone);
  const year = instant.getUTCFullYear();
  return year >= 1 && year <= 9999 &&
    (instant.toISOString() !== "0001-01-01T00:00:00.000Z" || /[1-9]/.test(fraction));
}

function admitProposal(input: AgreementProposalInput): AgreementProposalInput {
  try {
    const fields = { ...exactRecord(input,
      ["expectedVersion", "operationId", "feeModel", "collector", "fulfillmentModes", "proposedEffectiveAt", "reason"],
      ["commissionBasisPoints", "subscriptionAmountYer", "subscriptionPeriodDays"]) };
    const { expectedVersion, operationId, feeModel, collector, fulfillmentModes, proposedEffectiveAt, reason,
      commissionBasisPoints, subscriptionAmountYer, subscriptionPeriodDays } = fields;
    if (typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 || expectedVersion >= Number.MAX_SAFE_INTEGER || !fundingIdValid(operationId) ||
      !agreementMember(collector, agreementCollectors) || !validProposalInstant(proposedEffectiveAt) ||
      !validReason(reason)) throw new WltProposalError("NOT_SENT", 400);
    const common = {
      expectedVersion, operationId, collector, fulfillmentModes: agreementFulfillmentFrom(fulfillmentModes),
      proposedEffectiveAt, reason,
    };
    if (feeModel === "COMMISSION" && typeof commissionBasisPoints === "number" &&
      Number.isInteger(commissionBasisPoints) && commissionBasisPoints >= 0 && commissionBasisPoints <= 10000 &&
      subscriptionAmountYer == null && subscriptionPeriodDays == null) {
      return { ...common, feeModel, commissionBasisPoints };
    }
    if (feeModel === "SUBSCRIPTION" && commissionBasisPoints == null &&
      agreementSubscriptionAmountValid(subscriptionAmountYer) && typeof subscriptionPeriodDays === "number" &&
      Number.isInteger(subscriptionPeriodDays) && subscriptionPeriodDays > 0 && subscriptionPeriodDays <= 2147483647) {
      return { ...common, feeModel, subscriptionAmountYer, subscriptionPeriodDays };
    }
  } catch {
    throw new WltProposalError("NOT_SENT", 400);
  }
  throw new WltProposalError("NOT_SENT", 400);
}

// The caller retains the operation ID and admitted terms across retries.
export async function recordIsolatedFinanceAgreementProposal(origin: string, bearer: string, storeId: string,
  input: AgreementProposalInput, signal: AbortSignal): Promise<AgreementProposalReceipt> {
  admitConnection(origin, bearer, storeId, WltProposalError);
  const command = admitProposal(input);
  return submit(wltOperations.recordIsolatedFinanceAgreementProposal, origin, bearer, {
    storeId, version: command.expectedVersion + 1, operationId: command.operationId,
  }, command, signal, WltProposalError, "PROPOSAL_CONFLICT");
}

// Disposable local integration only. These commands neither activate terms
// nor grant access to the read-only serving binary.
export function recordIsolatedMerchantAgreementDecision(origin: string, bearer: string, storeId: string,
  input: AgreementDecisionInput<MerchantDecision>, signal: AbortSignal): Promise<AgreementDecisionReceipt> {
  return record(wltOperations.recordIsolatedMerchantAgreementDecision, ["ACCEPTED", "DECLINED"],
    origin, bearer, storeId, input, signal);
}

export function recordIsolatedFinanceAgreementDecision(origin: string, bearer: string, storeId: string,
  input: AgreementDecisionInput<FinanceDecision>, signal: AbortSignal): Promise<AgreementDecisionReceipt> {
  return record(wltOperations.recordIsolatedFinanceAgreementDecision, ["FINANCE_APPROVED", "FINANCE_REJECTED"],
    origin, bearer, storeId, input, signal);
}
