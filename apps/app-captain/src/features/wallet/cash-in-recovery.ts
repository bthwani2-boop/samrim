import type { CashInFundingIntent } from "@bthwani/dsh";

export type CaptainFundingAttempt = Readonly<{
  version: 1;
  actorID: string;
  amountMinor: number;
  idempotencyKey: string;
  correlationID: string;
  fundingIntentID?: string;
}>;

export function parseCaptainFundingAttempt(raw: string | null, actorID: string): CaptainFundingAttempt | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<CaptainFundingAttempt>;
  const validFundingIntentID = parsed.fundingIntentID === undefined || (
    typeof parsed.fundingIntentID === "string" && parsed.fundingIntentID.length > 0 && parsed.fundingIntentID.length <= 128
  );
  if (
    parsed.version !== 1 ||
    parsed.actorID !== actorID ||
    !Number.isSafeInteger(parsed.amountMinor) ||
    Number(parsed.amountMinor) <= 0 ||
    typeof parsed.idempotencyKey !== "string" ||
    parsed.idempotencyKey.length < 8 ||
    parsed.idempotencyKey.length > 128 ||
    typeof parsed.correlationID !== "string" ||
    parsed.correlationID.length < 8 ||
    parsed.correlationID.length > 128 ||
    !validFundingIntentID
  ) throw new Error("CASH_IN_RETRY_STATE_INVALID");
  return parsed as CaptainFundingAttempt;
}

export function matchesCaptainFundingRequest(intent: CashInFundingIntent, actorID: string, amountMinor: number): boolean {
  return intent.actorType === "captain" &&
    intent.actorId === actorID &&
    intent.fundingPurpose === "CAPTAIN_TOPUP" &&
    intent.amountMinor === amountMinor &&
    intent.currency === "YER";
}

export function matchesCaptainFundingAttempt(intent: CashInFundingIntent, attempt: CaptainFundingAttempt): boolean {
  return intent.id === attempt.fundingIntentID && matchesCaptainFundingRequest(intent, attempt.actorID, attempt.amountMinor);
}

export function isSimulatableCaptainFundingIntent(intent: CashInFundingIntent, actorID: string): boolean {
  return matchesCaptainFundingRequest(intent, actorID, intent.amountMinor) &&
    intent.providerKey === "DEVELOPMENT_SIMULATOR" &&
    (intent.state === "PENDING_PROVIDER" || intent.state === "UNKNOWN");
}

export function isSameCaptainFundingIntent(before: CashInFundingIntent, after: CashInFundingIntent): boolean {
  return before.id === after.id &&
    before.actorType === after.actorType &&
    before.actorId === after.actorId &&
    before.fundingPurpose === after.fundingPurpose &&
    before.providerKey === after.providerKey &&
    before.amountMinor === after.amountMinor &&
    before.currency === after.currency;
}
