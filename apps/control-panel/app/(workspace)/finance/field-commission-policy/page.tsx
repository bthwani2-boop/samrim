"use client";

import { FieldCommissionPolicyWorkspace } from "../../../../src/features/finance/field-commission-policy-workspace";
import { FinanceWorkspace } from "../../../../src/features/finance/finance-workspace";

export default function FinanceFieldCommissionPolicyPage() {
  return <FinanceWorkspace resource="field-commission-policy"><FieldCommissionPolicyWorkspace /></FinanceWorkspace>;
}
