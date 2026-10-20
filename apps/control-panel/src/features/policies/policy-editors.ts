import type { ComponentType } from "react";
import { ServiceCityPanel } from "../service-city/service-city-panel";
import { WalletProviderPolicyPanel } from "../wallet-provider/wallet-provider-policy-panel";
import { DeliveryFeePolicyWorkspace } from "../finance/delivery-fee-policy-workspace";
import { FieldAcquisitionPolicyWorkspace } from "../finance/field-acquisition-policy-workspace";
import { PartnerFinancialTermsPolicyWorkspace } from "../finance/partner-financial-terms-policy-workspace";
import type { PolicyResourceKey } from "./policy-capabilities";
import { CaptainMinimumBalancePolicyWorkspace } from "./captain-minimum-balance-policy-workspace";
import { StoreTypeCancellationPolicyWorkspace } from "./store-type-cancellation-policy-workspace";

/** Single adapter table to existing owner-backed editors; no duplicate policy writers. */
export const policyEditors: Record<PolicyResourceKey, ComponentType> = {
  "store-type-cancellation": StoreTypeCancellationPolicyWorkspace,
  "service-cities": ServiceCityPanel,
  "wallet-providers": WalletProviderPolicyPanel,
  "delivery-fees": DeliveryFeePolicyWorkspace,
  "field-acquisition": FieldAcquisitionPolicyWorkspace,
  "partner-financial-terms": PartnerFinancialTermsPolicyWorkspace,
  "captain-minimum-balance": CaptainMinimumBalancePolicyWorkspace,
};
