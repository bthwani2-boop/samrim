import { PartnerStore } from "../../src/features/partner-onboarding/partner-store";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";

export default function PartnerStoreRoute() {
  return <PartnerScrollScreen><PartnerStore /></PartnerScrollScreen>;
}
