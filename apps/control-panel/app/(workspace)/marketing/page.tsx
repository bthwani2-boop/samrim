import { MarketingOverview, MarketingWorkspace } from "../../../src/features/marketing/marketing-workspace";

export default function MarketingPage() {
  return <MarketingWorkspace resource="overview"><MarketingOverview /></MarketingWorkspace>;
}

export const metadata = { title: "التسويق والمحتوى" };
