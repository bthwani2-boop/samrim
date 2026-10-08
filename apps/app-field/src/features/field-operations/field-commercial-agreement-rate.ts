import { toAsciiDigits } from "@bthwani/design-system";
import type { StoreCommercialAgreement } from "@bthwani/dsh";

export function percentTextFromBps(commissionRateBps: number): string {
  const whole = Math.floor(commissionRateBps / 100);
  const fractional = commissionRateBps % 100;
  return fractional === 0
    ? String(whole)
    : `${whole}.${String(fractional).padStart(2, "0").replace(/0+$/, "")}`;
}

export function parsePercentToBps(value: string): number | null {
  const normalized = toAsciiDigits(value.trim()).replace(",", ".");
  if (!/^(?:\d{1,2}(?:\.\d{1,2})?|100(?:\.0{1,2})?)$/.test(normalized)) return null;
  const percent = Number(normalized);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return Math.round(percent * 100);
}

export function sameAgreementRates(left: StoreCommercialAgreement["rates"], right: StoreCommercialAgreement["rates"]): boolean {
  const normalize = (rates: StoreCommercialAgreement["rates"]) => [...rates]
    .sort((a, b) => a.fulfillmentMode.localeCompare(b.fulfillmentMode))
    .map((rate) => `${rate.fulfillmentMode}:${rate.commissionRateBps}`)
    .join("|");
  return normalize(left) === normalize(right);
}
