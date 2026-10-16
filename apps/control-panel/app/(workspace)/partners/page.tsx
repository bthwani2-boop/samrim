import { PartnerOperatorBoundary } from "../../../src/features/partner-onboarding/partner-workspace";
import { PartnersWorkbench } from "../../../src/features/partner-onboarding/partners-workbench";

export default function PartnersPage() {
  return <PartnerOperatorBoundary><PartnersWorkbench /></PartnerOperatorBoundary>;
}
export const metadata = { title: "الشركاء والمتاجر" };
