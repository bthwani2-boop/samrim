import PartnerWallet from "../../src/features/wallet/wallet";
import { PartnerSurfaceGate } from "../../src/shell/partner-surface-gate";

export default function PartnerWalletRoute() {
  return <PartnerSurfaceGate surface="wallet"><PartnerWallet /></PartnerSurfaceGate>;
}
