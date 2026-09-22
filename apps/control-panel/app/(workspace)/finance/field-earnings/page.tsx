"use client";

import { FieldEarningsWorkspace } from "../../../../src/features/finance/field-earnings-workspace";
import { FinanceWorkspace } from "../../../../src/features/finance/finance-workspace";

export default function FinanceFieldEarningsPage() {
  return <FinanceWorkspace resource="field-earnings"><FieldEarningsWorkspace /></FinanceWorkspace>;
}
