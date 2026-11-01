import type { CatalogInventorySummary } from "./generated/dsh-types";

// Fail closed if a response belongs to another Store or contains a partial or
// inconsistent set of counters. Never present a truncated page as a full total.
export function scopedCatalogInventorySummary(input: unknown, storeID: string): CatalogInventorySummary | null {
 if (!input || typeof input !== "object" || Array.isArray(input)) return null;
 const summary = (input as { summary?: unknown }).summary;
 if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
 const value = summary as Record<string, unknown>;
 if (!storeID.trim() || value.storeId !== storeID) return null;
 const keys = ["totalOffers", "publishedOffers", "availableOffers", "unavailableOffers", "stockoutOffers"] as const;
 if (!keys.every(key => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)) return null;
 if ((value.publishedOffers as number) > (value.totalOffers as number)) return null;
 if ((value.availableOffers as number) + (value.unavailableOffers as number) !== value.publishedOffers) return null;
 if ((value.stockoutOffers as number) > (value.unavailableOffers as number)) return null;
 return value as CatalogInventorySummary;
}
