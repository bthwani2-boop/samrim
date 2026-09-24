"use client";

import { PartnerFinancialTermsPolicyWorkspace } from "../../../../src/features/finance/partner-financial-terms-policy-workspace";
import { PoliciesWorkspace } from "../../../../src/features/policies/policies-workspace";

export default function PolicyPartnerFinancialTermsPage() {
  return <PoliciesWorkspace resource="partner-financial-terms"><PartnerFinancialTermsPolicyWorkspace /></PoliciesWorkspace>;
}
