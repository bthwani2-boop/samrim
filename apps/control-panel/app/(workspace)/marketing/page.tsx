import WorkspaceUnavailable from "../../../src/features/operator-shell/workspace-unavailable";
import PublicMarketOverview from "../../../src/features/workspace/public-market-overview";
import { currentOperatorAccess } from "../../../src/server/current-operator-access";

export const dynamic = "force-dynamic";

export default async function MarketingPage({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  // Marketing permission grants this workspace, not Store mutation or private Customer access.
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("marketing")) {
    return <WorkspaceUnavailable title="التسويق"
      description="يتطلب عرض التسويق جلسة مشغّل وصلاحية marketing الحالية من Identity." owner="Identity" />;
  }
  return (
    <main>
      <h1>التسويق</h1>
      <p>عرض منشورات السوق من DSH للقراءة فقط. لا تمثل النتائج إحصاءات إجمالية أو صلاحية لتعديل المتاجر والعروض.</p>
      <PublicMarketOverview searchParams={searchParams}
        canVisitStores={false} canVisitCatalog={false}
        canViewPublicMarket={true} action="/marketing" />
    </main>
  );
}
