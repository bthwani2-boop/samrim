import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { type Href, useRouter } from "expo-router";
import { useCallback } from "react";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../src/bootstrap/identity";
import { NotificationsInbox } from "../src/features/notifications/notifications-inbox";
import { PartnerScrollScreen } from "../src/shell/partner-shell";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };

export default function PartnerNotificationsRoute() {
  const router = useRouter();
  const onUnauthenticated = useCallback(() => router.replace("/?returnTo=/notifications" as Href), [router]);
  return <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}><PartnerScrollScreen><NotificationsInbox /></PartnerScrollScreen></AuthenticatedMobileBoundary>;
}
