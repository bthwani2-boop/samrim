import { FinanceWorkspace } from "../../../../src/features/finance/finance-workspace";
import { PartnerStoreCommissionPolicyWorkspace } from "../../../../src/features/finance/partner-store-commission-policy-workspace";
import { StoreCommercialAgreementWorkspace } from "../../../../src/features/finance/store-commercial-agreement-workspace";

export default function FinancePartnerStoreCommissionsPage() {
  return <FinanceWorkspace resource="partner-store-commissions"><PartnerStoreCommissionPolicyWorkspace /><StoreCommercialAgreementWorkspace /></FinanceWorkspace>;
}
