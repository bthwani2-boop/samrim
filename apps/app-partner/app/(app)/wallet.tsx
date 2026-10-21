import PartnerWallet from "../../src/features/wallet/wallet";
import { PartnerSurfaceGate } from "../../src/shell/partner-surface-gate";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";

export default function PartnerWalletRoute() {
  return <PartnerScrollScreen><PartnerSurfaceGate surface="wallet"><PartnerWallet /></PartnerSurfaceGate></PartnerScrollScreen>;
}
