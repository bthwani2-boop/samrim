import { StoreReadback } from "../../src/features/partner-onboarding/store-readback";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";

export default function PartnerOnboardingRoute() {
  return <PartnerScrollScreen><StoreReadback surface="onboarding" /></PartnerScrollScreen>;
}
