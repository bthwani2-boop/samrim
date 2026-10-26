import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { type Href, usePathname, useRouter } from "expo-router";
import { type PropsWithChildren, useCallback } from "react";

import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../bootstrap/identity";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };

export function ClientProtectedScreen({ children }: Readonly<PropsWithChildren>) {
  const pathname = usePathname();
  const router = useRouter();
  const onUnauthenticated = useCallback(
    () => router.replace(("/?returnTo=" + encodeURIComponent(pathname)) as Href),
    [pathname, router],
  );

  return (
    <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}>
      {children}
    </AuthenticatedMobileBoundary>
  );
}
