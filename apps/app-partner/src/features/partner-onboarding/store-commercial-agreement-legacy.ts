/**
 * Earlier WLT contract versions returned commission agreements without the
 * later commercial-model/billing fields. Backfill display-only non-billing
 * defaults exclusively for already decided historical agreements.
 *
 * Proposed/accepted records without explicit terms must stay invalid, and
 * this projection never authorizes acceptance, invoices or settlement.
 */
const legacyFinalStatuses = new Set(["ACTIVE", "SUPERSEDED", "FINANCE_REJECTED", "REJECTED"]);
const commercialFields = [
  "commercialModel", "recurringAmountMinor", "billingPeriod", "billingTimeZone",
  "invoiceDueDays", "graceDays", "renewalPolicy", "terminationTerms", "adjustmentTerms",
] as const;

export function normalizeHistoricalCommissionReadback(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!legacyFinalStatuses.has(String(record.status)) ||
    commercialFields.some((field) => Object.hasOwn(record, field)) ||
    !Array.isArray(record.rates) || record.rates.length === 0) return value;
  return {
    ...record,
    commercialModel: "COMMISSION",
    recurringAmountMinor: 0,
    billingPeriod: "NONE",
    billingTimeZone: "Asia/Aden",
    invoiceDueDays: 0,
    graceDays: 0,
    renewalPolicy: "NONE",
    terminationTerms: "",
    adjustmentTerms: "",
    historicalCommissionReadback: true,
  };
}
