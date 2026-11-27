import { wltOperations } from "./generated/wlt-operations.ts";
import { requestIsolatedDecision } from "./transport.ts";
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
export type AgreementDecisionReceipt = Readonly<{
  storeId: string;
  version: number;
  proposalOperationId: string;
  operationId: string;
  state: "RECORDED" | "REPLAYED";
}>;

export class WltDecisionError extends Error {
  constructor(
    readonly outcome: "NOT_SENT" | "REJECTED" | "UNCONFIRMED",
    readonly status: number,
  ) {
    super(outcome === "UNCONFIRMED"
      ? "Agreement decision unconfirmed; reconcile the same operation and payload"
      : "Agreement decision not admitted");
    this.name = "WltDecisionError";
  }
}

const rejectionCodes: Readonly<Partial<Record<number, string>>> = {
  400: "INVALID_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 409: "DECISION_CONFLICT",
};

function admit<D extends Decision>(input: AgreementDecisionInput<D>, choices: readonly D[]): AgreementDecisionInput<D> {
  try {
    const fields = exactRecord(input, ["version", "proposalOperationId", "operationId", "decision", "reason"]);
    const { version, proposalOperationId, operationId, decision, reason } = fields;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 ||
      !fundingIdValid(proposalOperationId) || !fundingIdValid(operationId) ||
      typeof decision !== "string" || !choices.some(choice => choice === decision) ||
      typeof reason !== "string" || Array.from(reason).length < 1 || Array.from(reason).length > 300 ||
      /^\p{White_Space}|\p{White_Space}$|[\p{Cc}\p{Cs}]/u.test(reason)) {
      throw new WltDecisionError("NOT_SENT", 400);
    }
    return Object.freeze({ version, proposalOperationId, operationId, decision: decision as D, reason });
  } catch {
    throw new WltDecisionError("NOT_SENT", 400);
  }
}

type Operation = typeof wltOperations.recordIsolatedMerchantAgreementDecision |
  typeof wltOperations.recordIsolatedFinanceAgreementDecision;

async function record<D extends Decision>(operation: Operation, choices: readonly D[], origin: string,
  bearer: string, storeId: string, input: AgreementDecisionInput<D>, signal: AbortSignal): Promise<AgreementDecisionReceipt> {
  const address = typeof origin === "string" && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
  if (!address || Number(address[1]) > 65535) throw new WltDecisionError("NOT_SENT", 503);
  if (typeof bearer !== "string" || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(bearer)) {
    throw new WltDecisionError("NOT_SENT", 401);
  }
  if (typeof storeId !== "string" || !/^[a-z0-9-]{1,64}$/.test(storeId)) throw new WltDecisionError("NOT_SENT", 400);
  const command = admit(input, choices);
  if (signal.aborted) throw new WltDecisionError("NOT_SENT", 503);
  // Capture the admitted fields once. The caller owns the stable operation ID;
  // transport failure never generates a replacement or retries automatically.
  try {
    const { status, value } = await requestIsolatedDecision(origin, bearer,
      operation.path.replace("{storeID}", storeId), JSON.stringify(command), signal);
    if (status !== 200) {
      const rejection = exactRecord(value, ["error"]);
      if (rejectionCodes[status] && rejection.error === rejectionCodes[status]) {
        throw new WltDecisionError("REJECTED", status);
      }
      throw new WltDecisionError("UNCONFIRMED", 503);
    }
    const receipt = exactRecord(value, ["storeId", "version", "proposalOperationId", "operationId", "state"]);
    if (receipt.storeId !== storeId || receipt.version !== command.version ||
      receipt.proposalOperationId !== command.proposalOperationId || receipt.operationId !== command.operationId ||
      (receipt.state !== "RECORDED" && receipt.state !== "REPLAYED")) {
      throw new WltDecisionError("UNCONFIRMED", 503);
    }
    return Object.freeze({ storeId, version: command.version, proposalOperationId: command.proposalOperationId,
      operationId: command.operationId, state: receipt.state });
  } catch (error) {
    if (error instanceof WltDecisionError) throw error;
    throw new WltDecisionError("UNCONFIRMED", 503);
  }
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
