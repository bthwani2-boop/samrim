import { PartnerCatalogActivity } from "../../src/features/partner-onboarding/partner-catalog-activity";
import { PartnerSurfaceGate } from "../../src/shell/partner-surface-gate";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";
import { usePartnerStoreScope } from "../../src/features/partner-onboarding/partner-store-scope-context";

export default function PartnerActivityRoute() {
  const { selectedStore } = usePartnerStoreScope();
  return <PartnerScrollScreen><PartnerSurfaceGate surface="more"><PartnerCatalogActivity key={selectedStore?.id ?? "no-store"} /></PartnerSurfaceGate></PartnerScrollScreen>;
}
