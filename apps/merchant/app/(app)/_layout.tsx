import MerchantIdentityGate from "../../src/features/access/identity-gate";

// This boundary deliberately renders no child routes until a current Identity Merchant
// session and current DSH Store authorization can be verified by their owners.
export default function MerchantAppBoundary() {
  return <MerchantIdentityGate />;
}
