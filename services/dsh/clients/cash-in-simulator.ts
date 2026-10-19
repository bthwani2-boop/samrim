import type { CashInFundingIntent } from "./generated/dsh-types";

export type CashInSimulatorOutcome = "SUCCESS" | "FAILURE" | "UNKNOWN" | "DELAYED";

export const cashInSimulatorOptions: ReadonlyArray<{ outcome: CashInSimulatorOutcome; label: string }> = [
  { outcome: "SUCCESS", label: "نجاح" },
  { outcome: "FAILURE", label: "فشل" },
  { outcome: "UNKNOWN", label: "غير معروفة" },
  { outcome: "DELAYED", label: "تأخير" },
];

export function cashInSimulatorMutationHeaders(
  attempt: Readonly<{ idempotencyKey: string; correlationID: string }>,
  outcome: CashInSimulatorOutcome,
): Readonly<{ idempotencyKey: string; correlationID: string }> {
  const suffix = "_sim_" + outcome.toLowerCase();
  return { idempotencyKey: attempt.idempotencyKey + suffix, correlationID: attempt.correlationID + suffix };
}

export function cashInSimulatorStateMatches(
  outcome: CashInSimulatorOutcome,
  state: CashInFundingIntent["state"],
): boolean {
  switch (outcome) {
    case "SUCCESS": return state === "SETTLED";
    case "FAILURE": return state === "FAILED";
    case "UNKNOWN": return state === "UNKNOWN";
    case "DELAYED": return state === "UNKNOWN" || state === "PENDING_PROVIDER";
  }
}
