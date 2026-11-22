import WorkspaceUnavailable from "../../../src/features/operator-shell/workspace-unavailable";
import StoresWorkspace from "../../../src/features/stores/stores-workspace";
import PublicMarketOverview from "../../../src/features/workspace/public-market-overview";
import { currentOperatorAccess } from "../../../src/server/current-operator-access";

export const dynamic = "force-dynamic";

export default async function MerchantWorkspacePage({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("merchant")) {
    return <WorkspaceUnavailable title="التجار والمتاجر"
      description="يتطلب هذا العرض صلاحية إدارة التجار الحالية من Identity." owner="Identity" />;
  }
  return <StoresWorkspace title="إدارة التجار والمتاجر" marketOverview={
    <PublicMarketOverview searchParams={searchParams} canVisitStores={true}
      canVisitCatalog={false} action="/merchants" />
  } />;
}
