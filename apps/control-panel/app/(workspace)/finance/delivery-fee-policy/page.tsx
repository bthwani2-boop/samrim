"use client";

import { DeliveryFeePolicyWorkspace } from "../../../../src/features/finance/delivery-fee-policy-workspace";
import { FinanceWorkspace } from "../../../../src/features/finance/finance-workspace";

export default function FinanceDeliveryFeePolicyPage() {
  return <FinanceWorkspace resource="delivery-fee-policy"><DeliveryFeePolicyWorkspace /></FinanceWorkspace>;
}
