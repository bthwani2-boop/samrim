"use client";

import { BeneficiarySettlementWorkspace } from "../../../../src/features/finance/beneficiary-settlement-workspace";
import { CustomerWithdrawalQueue } from "../../../../src/features/finance/customer-withdrawal-queue";
import { FinanceWorkspace } from "../../../../src/features/finance/finance-workspace";

export default function FinanceBeneficiarySettlementPage() {
  return <FinanceWorkspace resource="beneficiary-settlement"><BeneficiarySettlementWorkspace /><CustomerWithdrawalQueue /></FinanceWorkspace>;
}
