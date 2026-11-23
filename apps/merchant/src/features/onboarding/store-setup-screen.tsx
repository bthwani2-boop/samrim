import MerchantIdentityGate from "../access/identity-gate";

// Store setup is part of the single Identity-verified Merchant workspace.
// DSH remains the sole Store writer; setup never implies publication.
export default function StoreSetupScreen() {
  return <MerchantIdentityGate />;
}
