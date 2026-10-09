import { FinanceWorkspace } from "../../../../src/features/finance/finance-workspace";
import { PartnerEarningsWorkspace, type PartnerEarningsInitialQuery } from "../../../../src/features/finance/partner-earnings-workspace";

export default async function PartnerCommissionReceivablesPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const query = await searchParams;
  const first = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] ?? "" : value ?? "";
  };
  const initialQuery: PartnerEarningsInitialQuery = {
    cursor: first("cursor").slice(0, 1024),
    partnerActorId: first("partnerActorId").trim().slice(0, 128),
  };
  return <FinanceWorkspace resource="partner-commission-receivables"><PartnerEarningsWorkspace initialQuery={initialQuery} /></FinanceWorkspace>;
}

export const metadata = { title: "تحصيل عمولة المنصة" };
