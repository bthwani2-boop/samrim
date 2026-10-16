import type { DiscoveryContentView, PromotionView } from "@bthwani/dsh";
import { RecordIndicator } from "../shared/record-indicator";

type MarketingState = PromotionView["state"] | DiscoveryContentView["state"];

const states = {
  DRAFT: { icon: "unpublished", label: "مسودة", tone: "neutral" },
  PUBLISHED: { icon: "published", label: "منشور", tone: "success" },
  PAUSED: { icon: "paused", label: "موقوف", tone: "warning" },
  ENDED: { icon: "ended", label: "منتهٍ", tone: "neutral" },
} as const;

export function MarketingStateIndicator({ state }: Readonly<{ state: MarketingState }>) {
  const entry = states[state];
  return <RecordIndicator legend icon={entry.icon} label={entry.label} tone={entry.tone} />;
}
