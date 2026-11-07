import { PartnerOperatorBoundary } from "../../../src/features/partner-onboarding/partner-workspace";
import { IndependentStoresWorkspace } from "../../../src/features/stores/independent-stores-workspace";

export default function IndependentStoresPage() {
  return <PartnerOperatorBoundary><IndependentStoresWorkspace /></PartnerOperatorBoundary>;
}

export const metadata = { title: "المتاجر المستقلة" };
