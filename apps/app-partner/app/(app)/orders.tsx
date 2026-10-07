import { PartnerOrders } from "../../src/features/partner-onboarding/partner-orders";
import { PartnerSurfaceGate } from "../../src/shell/partner-surface-gate";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";

export default function PartnerOrdersRoute() {
  return <PartnerScrollScreen><PartnerSurfaceGate surface="orders"><PartnerOrders /></PartnerSurfaceGate></PartnerScrollScreen>;
}
