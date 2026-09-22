"use client";

import { FinanceOverview, FinanceWorkspace } from "../../../src/features/finance/finance-workspace";

export default function FinancePage() {
  return <FinanceWorkspace resource="overview"><FinanceOverview /></FinanceWorkspace>;
}
