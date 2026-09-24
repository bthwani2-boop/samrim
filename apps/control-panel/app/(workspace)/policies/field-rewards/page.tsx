"use client";

import { FieldCommissionPolicyWorkspace } from "../../../../src/features/finance/field-commission-policy-workspace";
import { PoliciesWorkspace } from "../../../../src/features/policies/policies-workspace";

export default function PolicyFieldRewardsPage() {
  return <PoliciesWorkspace resource="field-rewards"><FieldCommissionPolicyWorkspace /></PoliciesWorkspace>;
}
