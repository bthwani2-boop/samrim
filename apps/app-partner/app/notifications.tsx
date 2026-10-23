import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { type Href, useRouter } from "expo-router";
import { useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../src/bootstrap/identity";
import { NotificationsInbox } from "../src/features/notifications/notifications-inbox";
import { PartnerScrollScreen } from "../src/shell/partner-shell";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };

export default function PartnerNotificationsRoute() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const onUnauthenticated = useCallback(() => router.replace("/?returnTo=/notifications" as Href), [router]);
  return <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}><SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}><PartnerScrollScreen><NotificationsInbox /></PartnerScrollScreen></SafeAreaView></AuthenticatedMobileBoundary>;
}
