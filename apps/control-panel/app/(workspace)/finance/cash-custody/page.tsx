"use client";

import { CashCustodyWorkspace } from "../../../../src/features/finance/cash-custody-workspace";
import { FinanceWorkspace } from "../../../../src/features/finance/finance-workspace";

export default function FinanceCashCustodyPage() {
  return <FinanceWorkspace resource="cash-custody"><CashCustodyWorkspace /></FinanceWorkspace>;
}
