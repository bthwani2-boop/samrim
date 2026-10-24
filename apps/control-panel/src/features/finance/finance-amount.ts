import { formatMoney } from "@bthwani/dsh";

/** The DSH/WLT operator contract passes YER amounts as integer display units.
 * Historical "Minor" suffixes must not trigger a client-side /100 conversion.
 */
export function financeAmount(amount: number, currency: "YER" = "YER"): string {
  if (!Number.isFinite(amount)) throw new Error("Invalid finance amount");
  return formatMoney(amount, currency);
}
