import { FinanceWorkspace } from "../../../../src/features/finance/finance-workspace";
import { StoreTypeCommissionDefaultWorkspace } from "../../../../src/features/finance/store-type-commission-default-workspace";
import { StoreCommercialAgreementWorkspace } from "../../../../src/features/finance/store-commercial-agreement-workspace";

export default function FinancePartnerStoreCommissionsPage() {
  return <FinanceWorkspace resource="partner-store-commissions"><StoreTypeCommissionDefaultWorkspace /><StoreCommercialAgreementWorkspace /></FinanceWorkspace>;
}
