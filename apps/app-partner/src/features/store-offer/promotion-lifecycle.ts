import type { PromotionView } from "@bthwani/dsh";

export type PromotionBucket = "active" | "scheduled" | "draft" | "paused" | "ended";

/** Display-only classification. Eligibility remains exclusively server-evaluated by DSH. */
export function promotionBucket(promotion: Pick<PromotionView, "state" | "startsAt" | "endsAt">, now: number): PromotionBucket {
  if (promotion.state === "DRAFT") return "draft";
  if (promotion.state === "PAUSED") return "paused";
  if (promotion.state === "ENDED") return "ended";
  const start = Date.parse(promotion.startsAt);
  const end = promotion.endsAt ? Date.parse(promotion.endsAt) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(start) || Number.isNaN(end) || now >= end) return "ended";
  return now < start ? "scheduled" : "active";
}
