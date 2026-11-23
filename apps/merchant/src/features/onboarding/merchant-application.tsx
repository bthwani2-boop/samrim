import MerchantIdentityGate from "../access/identity-gate";

// Public joining entry reuses the only authenticated Merchant boundary.
// A verified Merchant with no Stores can register the first DSH-owned Store
// from the workspace; this screen never grants a role or creates a Store.
export default function MerchantApplication() {
  return <MerchantIdentityGate mode="join" />;
}
