"use client";

import { useState } from "react";

import { BeneficiarySettlementWorkspace } from "../../../../src/features/finance/beneficiary-settlement-workspace";
import { CustomerWithdrawalQueue } from "../../../../src/features/finance/customer-withdrawal-queue";
import { FinanceWorkspace } from "../../../../src/features/finance/finance-workspace";

export default function FinanceBeneficiarySettlementPage() {
  const [requestedBatchId, setRequestedBatchId] = useState("");
  return <FinanceWorkspace resource="beneficiary-settlement"><BeneficiarySettlementWorkspace requestedBatchId={requestedBatchId} /><CustomerWithdrawalQueue onBatchCreated={setRequestedBatchId} /></FinanceWorkspace>;
}
