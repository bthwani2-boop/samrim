import { PartnerOrders } from "../../src/features/partner-onboarding/partner-orders";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";

export default function PartnerOrdersRoute() {
  return <PartnerScrollScreen><PartnerOrders /></PartnerScrollScreen>;
}
