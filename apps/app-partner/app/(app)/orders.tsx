import { StoreReadback } from "../../src/features/partner-onboarding/store-readback";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";

export default function PartnerOrdersRoute() {
  return <PartnerScrollScreen><StoreReadback surface="orders" /></PartnerScrollScreen>;
}
