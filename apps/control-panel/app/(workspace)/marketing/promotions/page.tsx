import { MarketingWorkspace } from "../../../../src/features/marketing/marketing-workspace";
import { MarketingPromotionsWorkspace } from "../../../../src/features/marketing/marketing-promotions-workspace";

export default function MarketingPromotionsPage() {
  return <MarketingWorkspace resource="promotions"><MarketingPromotionsWorkspace /></MarketingWorkspace>;
}

export const metadata = { title: "العروض" };
