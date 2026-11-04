/**
 * Earlier WLT contract versions returned commission agreements without the
 * later commercial-model/billing fields. Backfill display-only non-billing
 * defaults exclusively for already decided historical agreements.
 *
 * Proposed/accepted records without explicit terms must stay invalid, and
 * this projection never authorizes acceptance, invoices or settlement.
 */
const legacyFinalStatuses = new Set(["ACTIVE", "SUPERSEDED", "FINANCE_REJECTED", "REJECTED"]);
// Old WLT omits these fields. The newer DSH Go bridge can serialize the
// missing values as empty strings and zeroes. Neither shape authorizes billing.
const legacyBridgeEmptyFields = {
  commercialModel: "", recurringAmountMinor: 0, billingPeriod: "",
  billingTimeZone: "", invoiceDueDays: 0, graceDays: 0, renewalPolicy: "",
  terminationTerms: "", adjustmentTerms: "",
} as const;

export function normalizeHistoricalCommissionReadback(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const fields = Object.entries(legacyBridgeEmptyFields);
  const allMissing = fields.every(([field]) => !Object.hasOwn(record, field));
  const allBridgeEmpty = fields.every(([field, empty]) =>
    Object.hasOwn(record, field) && record[field] === empty);
  if (!legacyFinalStatuses.has(String(record.status)) || (!allMissing && !allBridgeEmpty) ||
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
