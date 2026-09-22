"use client";

import { PartnerEarningsWorkspace } from "../../../../src/features/finance/partner-earnings-workspace";
import { FinanceWorkspace } from "../../../../src/features/finance/finance-workspace";

export default function FinancePartnerEarningsPage() {
  return <FinanceWorkspace resource="partner-earnings"><PartnerEarningsWorkspace /></FinanceWorkspace>;
}
