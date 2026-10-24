import { PartnerInsights } from "../../src/features/partner-onboarding/partner-insights";
import { PartnerSurfaceGate } from "../../src/shell/partner-surface-gate";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";
export default function PartnerInsightsRoute() {
  return <PartnerScrollScreen><PartnerSurfaceGate surface="more"><PartnerInsights /></PartnerSurfaceGate></PartnerScrollScreen>;
}
