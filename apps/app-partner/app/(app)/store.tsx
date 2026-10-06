import { PartnerStore } from "../../src/features/partner-onboarding/partner-store";
import { PartnerSurfaceGate } from "../../src/shell/partner-surface-gate";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";

export default function PartnerStoreRoute() {
  return <PartnerScrollScreen><PartnerSurfaceGate surface="store"><PartnerStore /></PartnerSurfaceGate></PartnerScrollScreen>;
}
