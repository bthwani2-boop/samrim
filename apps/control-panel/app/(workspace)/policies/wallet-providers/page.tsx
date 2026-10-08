"use client";

import { PoliciesWorkspace } from "../../../../src/features/policies/policies-workspace";
import { WalletProviderPolicyPanel } from "../../../../src/features/wallet-provider/wallet-provider-policy-panel";

export default function PolicyWalletProvidersPage() {
  return <PoliciesWorkspace resource="wallet-providers"><WalletProviderPolicyPanel /></PoliciesWorkspace>;
}
