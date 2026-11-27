import {
  type AgreementCollector,
  agreementCollectors,
  agreementFulfillmentFrom,
  agreementMember,
  agreementStoreValid,
  agreementSubscriptionAmountValid,
  type FulfillmentMode,
} from "./commercial-agreement.ts";
import { wltOperations } from "./generated/wlt-operations.ts";
import { requestIsolatedAgreementCommand } from "./transport.ts";
import { exactRecord, fundingIdValid } from "./validation.ts";

type MerchantDecision = "ACCEPTED" | "DECLINED";
type FinanceDecision = "FINANCE_APPROVED" | "FINANCE_REJECTED";
type Decision = MerchantDecision | FinanceDecision;
type Outcome = "NOT_SENT" | "REJECTED" | "UNCONFIRMED";

export type AgreementDecisionInput<D extends Decision = Decision> = Readonly<{
  version: number;
  proposalOperationId: string;
  operationId: string;
  decision: D;
  reason: string;
}>;

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

type AgreementReceipt = Readonly<{
  storeId: string;
  version: number;
  operationId: string;
  state: "RECORDED" | "REPLAYED";
}>;

export type AgreementDecisionReceipt = AgreementReceipt & Readonly<{ proposalOperationId: string }>;
export type AgreementProposalReceipt = AgreementReceipt;

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

type CommandError = typeof WltDecisionError | typeof WltProposalError;
type DecisionOperation = typeof wltOperations.recordIsolatedMerchantAgreementDecision |
  typeof wltOperations.recordIsolatedFinanceAgreementDecision;
type CommandOperation = DecisionOperation | typeof wltOperations.recordIsolatedFinanceAgreementProposal;

const rejectionCodes: Readonly<Partial<Record<number, string>>> = {
  400: "INVALID_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
};

const proposalInstant = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.([0-9]{1,6}0*))?(Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/;

function validProposalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = proposalInstant.exec(value);
  if (!match || match[0] !== value) return false;
  const [, stamp = "", fraction = "", zone = ""] = match;

  // Validate whole seconds independently; Date truncates microsecond precision.
  const local = Date.parse(stamp.concat("Z"));
  if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, 19) !== stamp) return false;
  const instant = new Date(stamp + zone);
  const year = instant.getUTCFullYear();
  return year >= 1 && year <= 9999 &&
    (instant.toISOString() !== "0001-01-01T00:00:00.000Z" || /[1-9]/.test(fraction));
}

function validReason(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Array.from(value).length <= 300 &&
    !/^\p{White_Space}|\p{White_Space}$|[\p{Cc}\p{Cs}]/u.test(value);
}

// The contract validator checks own enumerable keys. Snapshot exactly those
// fields into a prototype-free record before reading optional values, so
// inherited properties can never supply or override financial terms.
function ownCommandFields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const fields: Record<string, unknown> = Object.create(null);
  for (const [key, field] of Object.entries(exactRecord(value, required, optional))) {
    fields[key] = field;
  }
  return fields;
}

function admitDecision<D extends Decision>(input: AgreementDecisionInput<D>, choices: readonly D[]): AgreementDecisionInput<D> {
  try {
    const { version, proposalOperationId, operationId, decision, reason } = ownCommandFields(
      input, ["version", "proposalOperationId", "operationId", "decision", "reason"],
    );
    if (typeof version === "number" && Number.isSafeInteger(version) && version >= 1 &&
      fundingIdValid(proposalOperationId) && fundingIdValid(operationId) &&
      agreementMember(decision, choices) && validReason(reason)) {
      return { version, proposalOperationId, operationId, decision, reason };
    }
  } catch {
    // A rejected field is never serialized or sent.
  }
  throw new WltDecisionError("NOT_SENT", 400);
}

function admitProposal(input: AgreementProposalInput): AgreementProposalInput {
  try {
    const {
      expectedVersion, operationId, feeModel, collector, fulfillmentModes, proposedEffectiveAt, reason,
      commissionBasisPoints, subscriptionAmountYer, subscriptionPeriodDays,
    } = ownCommandFields(
      input,
      ["expectedVersion", "operationId", "feeModel", "collector", "fulfillmentModes", "proposedEffectiveAt", "reason"],
      ["commissionBasisPoints", "subscriptionAmountYer", "subscriptionPeriodDays"],
    );

    if (typeof expectedVersion === "number" && Number.isSafeInteger(expectedVersion) &&
      expectedVersion >= 0 && expectedVersion < Number.MAX_SAFE_INTEGER && fundingIdValid(operationId) &&
      agreementMember(collector, agreementCollectors) && validProposalInstant(proposedEffectiveAt) &&
      validReason(reason)) {
      const common = {
        expectedVersion, operationId, collector,
        fulfillmentModes: agreementFulfillmentFrom(fulfillmentModes),
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
    }
  } catch {
    // Reject invalid records, amounts, and fulfillment modes before transport.
  }
  throw new WltProposalError("NOT_SENT", 400);
}

function admitConnection(origin: string, bearer: string, storeId: string, ErrorType: CommandError): void {
  const address = typeof origin === "string" && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
  if (!address || Number(address[1]) > 65535) throw new ErrorType("NOT_SENT", 503);
  if (typeof bearer !== "string" || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(bearer)) {
    throw new ErrorType("NOT_SENT", 401);
  }
  if (!agreementStoreValid(storeId)) throw new ErrorType("NOT_SENT", 400);
}

// Only an exact receipt or a recognized owner rejection resolves a command.
// Unknown outcomes preserve the caller's operation identity and payload.
async function submit<T extends Omit<AgreementReceipt, "state">>(
  operation: CommandOperation, origin: string, bearer: string, expected: T,
  command: AgreementDecisionInput | AgreementProposalInput, signal: AbortSignal,
  ErrorType: CommandError, conflict: string,
): Promise<Readonly<T & Pick<AgreementReceipt, "state">>> {
  if (signal.aborted) throw new ErrorType("NOT_SENT", 503);
  try {
    const { status, value } = await requestIsolatedAgreementCommand(
      origin, bearer, operation.path.replace("{storeID}", expected.storeId), JSON.stringify(command), signal,
    );

    if (status === 200) {
      const receipt = ownCommandFields(value, [...Object.keys(expected), "state"]);
      if (Object.entries(expected).every(([key, field]) => receipt[key] === field) &&
        (receipt.state === "RECORDED" || receipt.state === "REPLAYED")) {
        return Object.freeze({ ...expected, state: receipt.state });
      }
    } else {
      const code = status === 409 ? conflict : rejectionCodes[status];
      if (code && ownCommandFields(value, ["error"]).error === code) {
        throw new ErrorType("REJECTED", status);
      }
    }
  } catch (error) {
    if (error instanceof ErrorType) throw error;
  }
  throw new ErrorType("UNCONFIRMED", 503);
}

async function recordDecision<D extends Decision>(
  operation: DecisionOperation, choices: readonly D[], origin: string,
  bearer: string, storeId: string, input: AgreementDecisionInput<D>, signal: AbortSignal,
): Promise<AgreementDecisionReceipt> {
  admitConnection(origin, bearer, storeId, WltDecisionError);
  const command = admitDecision(input, choices);
  return submit(operation, origin, bearer, {
    storeId,
    version: command.version,
    proposalOperationId: command.proposalOperationId,
    operationId: command.operationId,
  }, command, signal, WltDecisionError, "DECISION_CONFLICT");
}

// Disposable local integration only; no activation or serving-binary write authority.
export async function recordIsolatedFinanceAgreementProposal(
  origin: string, bearer: string, storeId: string, input: AgreementProposalInput, signal: AbortSignal,
): Promise<AgreementProposalReceipt> {
  admitConnection(origin, bearer, storeId, WltProposalError);
  const command = admitProposal(input);
  return submit(wltOperations.recordIsolatedFinanceAgreementProposal, origin, bearer, {
    storeId,
    version: command.expectedVersion + 1,
    operationId: command.operationId,
  }, command, signal, WltProposalError, "PROPOSAL_CONFLICT");
}

export function recordIsolatedMerchantAgreementDecision(
  origin: string, bearer: string, storeId: string, input: AgreementDecisionInput<MerchantDecision>, signal: AbortSignal,
): Promise<AgreementDecisionReceipt> {
  return recordDecision(wltOperations.recordIsolatedMerchantAgreementDecision, ["ACCEPTED", "DECLINED"],
    origin, bearer, storeId, input, signal);
}

export function recordIsolatedFinanceAgreementDecision(
  origin: string, bearer: string, storeId: string, input: AgreementDecisionInput<FinanceDecision>, signal: AbortSignal,
): Promise<AgreementDecisionReceipt> {
  return recordDecision(wltOperations.recordIsolatedFinanceAgreementDecision, ["FINANCE_APPROVED", "FINANCE_REJECTED"],
    origin, bearer, storeId, input, signal);
}
