import { PartnerEmployees } from "../../src/features/partner-onboarding/partner-employees";
import { PartnerSurfaceGate } from "../../src/shell/partner-surface-gate";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";

export default function PartnerEmployeesRoute() {
  return <PartnerScrollScreen><PartnerSurfaceGate surface="employees"><PartnerEmployees /></PartnerSurfaceGate></PartnerScrollScreen>;
}
