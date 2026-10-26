import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, usePathname, useRouter } from "expo-router";
import { type PropsWithChildren, useCallback } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../bootstrap/identity";
import { CaptainPresencePublisher } from "../features/captain-operations/captain-presence-publisher";
import { CaptainMissionLocationPublisher } from "../features/captain-operations/captain-mission-location-publisher";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };

export function CaptainProtectedScreen({ children }: Readonly<PropsWithChildren>) {
  const router = useRouter();
  const pathname = usePathname();
  const theme = useAppearanceTheme();
  const onUnauthenticated = useCallback(
    () => router.replace(`/?returnTo=${encodeURIComponent(pathname)}` as Href),
    [pathname, router],
  );

  return (
    <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}>
      <CaptainPresencePublisher />
      <CaptainMissionLocationPublisher />
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaView>
    </AuthenticatedMobileBoundary>
  );
}
