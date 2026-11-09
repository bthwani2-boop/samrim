import { readPublishedIndependentWebStore, type PartnerAccessibleStore } from "@bthwani/dsh";
import { useEffect, useState, useSyncExternalStore } from "react";

import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";
import { partnerSetupSessionKey } from "./partner-setup-session-scope";
import { buildPartnerIndependentStorefrontURL, type PartnerStorefrontURL } from "./partner-storefront-url";

type Check = Readonly<{ scope: string; storeId: string; cityId: string; verified: boolean; status: "available" | "unavailable" | "error" }>;

export function usePartnerIndependentPublicLink(
  store: PartnerAccessibleStore | null,
): Readonly<{ link: PartnerStorefrontURL | null; checking: boolean; status: "unavailable" | "error" | "available" | "checking" }> {
  // Identity session changes are an explicit dependency: old public-link checks
  // and responses must never survive a different actor or session.
  const sessionScope = useSyncExternalStore(
    subscribeIdentitySession,
    () => partnerSetupSessionKey(currentIdentityState()),
    () => "",
  );
  const [check, setCheck] = useState<Check | null>(null);
  const storeID = store?.id ?? "";
  const cityID = store?.serviceCityId ?? "";
  const independent = store?.relationModel === "INDEPENDENT_STORE";
  const owner = Boolean(store?.owned);
  useEffect(() => {
    setCheck(null);
    if (!storeID || !cityID || !independent || !owner) return;
    const scope = sessionScope;
    const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
    if (!scope || !base) return;
    const controller = new AbortController();
    void readPublishedIndependentWebStore(base, storeID, cityID, controller.signal)
      .then(value => {
        if (controller.signal.aborted || partnerSetupSessionKey(currentIdentityState()) !== scope) return;
        const verified = value.storeId === storeID && value.serviceCityId === cityID &&
          Boolean(value.hostingTermsVersion.trim() && value.merchantPolicyVersion.trim()) &&
          value.checkoutEnabled === false;
        setCheck({ scope, storeId: storeID, cityId: cityID, verified, status: verified ? "available" : "unavailable" });
      })
      .catch(error => {
        if (controller.signal.aborted || partnerSetupSessionKey(currentIdentityState()) !== scope) return;
        const unavailable = error && typeof error === "object" && "status" in error &&
          (error.status === 404 || error.status === 403);
        setCheck({ scope, storeId: storeID, cityId: cityID, verified: false, status: unavailable ? "unavailable" : "error" });
      });
    return () => controller.abort();
  }, [storeID, cityID, independent, owner, sessionScope]);

  const currentScope = sessionScope;
  const current = owner && check?.storeId === storeID && check.cityId === cityID && check.scope === currentScope ? check : null;
  const configured = Boolean(process.env.EXPO_PUBLIC_DSH_API_URL?.trim() && currentScope);
  // All public Store websites are hosted by Client Expo Web; the Partner host
  // must never construct a different public origin or use a private preview.
  const origin = process.env.EXPO_PUBLIC_CLIENT_WEB_ORIGIN?.trim();
  const verified = Boolean(current?.verified);
  return {
    link: store ? buildPartnerIndependentStorefrontURL(store, origin, verified, __DEV__) : null,
    checking: independent && owner && configured && !current,
    status: !independent || !owner ? "unavailable" : !configured ? "error" : !current ? "checking" : current.status,
  };
}
