"use client";

import { DeliveryFeePolicyWorkspace } from "../../../../src/features/finance/delivery-fee-policy-workspace";
import { PoliciesWorkspace } from "../../../../src/features/policies/policies-workspace";

export default function PolicyDeliveryFeesPage() {
  return <PoliciesWorkspace resource="delivery-fees"><DeliveryFeePolicyWorkspace /></PoliciesWorkspace>;
}
