import HomeDashboard from "../../../src/features/workspace/home-dashboard";
import PublicMarketOverview from "../../../src/features/workspace/public-market-overview";
import { currentOperatorAccess, currentOriginalOperatorPermissions } from "../../../src/server/current-operator-access";

export const dynamic = "force-dynamic";

export default async function OperatorDashboardPage({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  // The layout gate is for navigation. Derive every read from the current
  // Identity session again; no private owner call is authorized by a tab.
  const [access, original] = await Promise.all([currentOperatorAccess(), currentOriginalOperatorPermissions()]);
  const originalOperator = access !== null && original !== null && original.actorId === access.actorId;
  const grants = access?.grants ?? [];
  const canVisitStores = grants.includes("merchant");
  const canVisitCatalog = grants.includes("catalog");
  return <HomeDashboard grants={grants} originalOperator={originalOperator} marketOverview={
    (canVisitStores || canVisitCatalog)
      ? <PublicMarketOverview searchParams={searchParams}
          canVisitStores={canVisitStores} canVisitCatalog={canVisitCatalog} />
      : null
  } />;
}
