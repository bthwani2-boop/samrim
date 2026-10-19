import { PartnerMore } from "../../src/features/partner-onboarding/partner-more";
import { PartnerSurfaceGate } from "../../src/shell/partner-surface-gate";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";

export default function PartnerMoreRoute() {
  return <PartnerScrollScreen><PartnerSurfaceGate surface="more"><PartnerMore /></PartnerSurfaceGate></PartnerScrollScreen>;
}
