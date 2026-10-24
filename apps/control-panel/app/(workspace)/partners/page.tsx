import { PartnerOperatorBoundary } from "../../../src/features/partner-onboarding/partner-workspace";
import { PartnersCommandCenter } from "../../../src/features/partner-onboarding/partners-command-center";

export default function PartnersPage() {
  return <PartnerOperatorBoundary><PartnersCommandCenter /></PartnerOperatorBoundary>;
}
export const metadata = { title: "الشركاء والمتاجر" };
