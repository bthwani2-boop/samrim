import { useCallback } from "react";
import { useRouter } from "expo-router";

import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import ServiceCityScope from "../../src/features/service-city/service-city-scope";
import ClientShell from "../../src/shell/client-shell";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };

export default function ClientAppLayout() {
  const router = useRouter();
  const onUnauthenticated = useCallback(() => router.replace("/"), [router]);
  return (
    <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}>
      <ServiceCityScope>
        <ClientShell />
      </ServiceCityScope>
    </AuthenticatedMobileBoundary>
  );
}
