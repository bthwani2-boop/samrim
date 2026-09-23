import { FinanceWorkspace } from "../../../../src/features/finance/finance-workspace";
import { PartnerStoreCommissionPolicyWorkspace } from "../../../../src/features/finance/partner-store-commission-policy-workspace";

export default function FinancePartnerStoreCommissionsPage() {
  return <FinanceWorkspace resource="partner-store-commissions"><PartnerStoreCommissionPolicyWorkspace /></FinanceWorkspace>;
}
