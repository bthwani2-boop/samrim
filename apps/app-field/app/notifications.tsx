import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../src/bootstrap/identity";
import { NotificationsInbox } from "../src/features/notifications/notifications-inbox";
import { FieldScrollScreen } from "../src/shell/field-shell";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };

export default function FieldNotificationsRoute() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const onUnauthenticated = useCallback(() => router.replace("/?returnTo=/notifications" as Href), [router]);
  return <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}><SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}><FieldScrollScreen><NotificationsInbox /></FieldScrollScreen></SafeAreaView></AuthenticatedMobileBoundary>;
}
