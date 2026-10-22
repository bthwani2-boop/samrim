/** UI payment intent; DSH/WLT remain authoritative at checkout. */
export type CheckoutPaymentChoice = "CASH" | "WALLET" | "MIXED";

export function paymentSplit(totalMinor: number, availableMinor: number | null, choice: CheckoutPaymentChoice):
  Readonly<{ walletMinor: number; cashMinor: number }> | null {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) return null;
  if (choice === "CASH") return { walletMinor: 0, cashMinor: totalMinor };
  if (availableMinor === null || !Number.isSafeInteger(availableMinor) || availableMinor < 0) return null;
  if (choice === "WALLET") return availableMinor >= totalMinor ? { walletMinor: totalMinor, cashMinor: 0 } : null;
  if (choice !== "MIXED" || totalMinor < 2 || availableMinor < 1) return null;
  // If sufficient for all, deliberately retain a meaningful cash share for mixed payment.
  const walletMinor = Math.min(availableMinor, totalMinor - 1, availableMinor >= totalMinor ? Math.floor(totalMinor / 2) : totalMinor - 1);
  return walletMinor > 0 ? { walletMinor, cashMinor: totalMinor - walletMinor } : null;
}
