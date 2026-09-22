"use client";

import { MarketingPromotionsWorkspace, MarketingWorkspace } from "../../../../src/features/marketing/marketing-workspace";

export default function MarketingPromotionsPage() {
  return <MarketingWorkspace resource="promotions"><MarketingPromotionsWorkspace /></MarketingWorkspace>;
}
