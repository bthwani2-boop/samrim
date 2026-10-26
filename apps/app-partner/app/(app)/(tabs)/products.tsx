import { PartnerProducts } from "../../../src/features/partner-onboarding/partner-products";
import { PartnerSurfaceGate } from "../../../src/shell/partner-surface-gate";
import { PartnerScrollScreen } from "../../../src/shell/partner-shell";

export default function PartnerProductsRoute() {
  return <PartnerScrollScreen><PartnerSurfaceGate surface="products"><PartnerProducts /></PartnerSurfaceGate></PartnerScrollScreen>;
}
