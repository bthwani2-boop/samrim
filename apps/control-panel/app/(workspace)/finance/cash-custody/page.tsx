"use client";

import { CashCustodyWorkspace, type CashCustodyInitialQuery } from "../../../../src/features/finance/cash-custody-workspace";
import { FinanceWorkspace } from "../../../../src/features/finance/finance-workspace";

export default async function FinanceCashCustodyPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const query = await searchParams;
  const first = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] ?? "" : value ?? "";
  };
  const initialQuery: CashCustodyInitialQuery = {
    search: first("search").trim().slice(0, 128),
    sort: first("sort") === "collected_desc" ? "collected_desc" : "collected_asc",
    cursor: first("cursor").slice(0, 1024),
  };
  return <FinanceWorkspace resource="cash-custody"><CashCustodyWorkspace initialQuery={initialQuery} /></FinanceWorkspace>;
}
