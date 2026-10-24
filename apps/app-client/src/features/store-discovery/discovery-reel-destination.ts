import type { DiscoveryContentTargetResolution, DiscoveryContentTargetType } from "@bthwani/dsh";

// A reel carries a single destination. The original Store page owns pricing,
// product choices, promotion redemption and cart logic.
export function reelDestinationLabel(type: DiscoveryContentTargetType): string | null {
  switch (type) {
    case "PRODUCT": return "عرض المنتج";
    case "STORE": return "زيارة المتجر";
    case "PROMOTION": return "شاهد العرض";
    case "CATEGORY": return "استكشف المنتجات";
    case "INFO": return null;
  }
}

export function resolvedDiscoveryDestination(target: DiscoveryContentTargetResolution): string | null {
  if (!target.storeId) return null;
  const storePath = `/store/${encodeURIComponent(target.storeId)}`;
  if (target.targetType === "PRODUCT") {
    return target.targetId ? `${storePath}?productId=${encodeURIComponent(target.targetId)}` : null;
  }
  if (target.targetType === "CATEGORY") {
    return target.targetId ? `${storePath}?categoryId=${encodeURIComponent(target.targetId)}` : null;
  }
  if (target.targetType === "PROMOTION") {
    return target.targetId ? `${storePath}?promotionId=${encodeURIComponent(target.targetId)}` : null;
  }
  return target.targetType === "STORE" ? storePath : null;
}
