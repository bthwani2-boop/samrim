import type { CustomerCartLine } from "@bthwani/dsh";

type CartPreviewLine = Pick<CustomerCartLine, "previewUnitYer" | "quantity" | "previewAvailable">;

// DSH owns price truth. This is only a read-only, exact YER rendering aid.
export function previewLineSubtotalYer(line: CartPreviewLine): bigint {
  return BigInt(line.previewUnitYer) * BigInt(line.quantity);
}

export function summarizeCartPreview(lines: readonly CartPreviewLine[]) {
  let availableSubtotalYer = 0n;
  let unavailableLines = 0;
  for (const line of lines) {
    if (!line.previewAvailable) {
      unavailableLines++;
      continue;
    }
    availableSubtotalYer += previewLineSubtotalYer(line);
  }
  return { availableSubtotalYer, unavailableLines };
}