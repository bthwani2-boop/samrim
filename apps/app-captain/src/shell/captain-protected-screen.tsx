import { useAppearanceTheme } from "@bthwani/design-system/native";
import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { type Href, useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { type PropsWithChildren, useCallback } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../bootstrap/identity";
import { captainProtectedReturnTo } from "../features/access/captain-route";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };

export function CaptainProtectedScreen({ children }: Readonly<PropsWithChildren>) {
  const router = useRouter();
  const pathname = usePathname();
  const { q } = useLocalSearchParams<{ q?: string | string[] }>();
  const theme = useAppearanceTheme();
  const returnTo = captainProtectedReturnTo(pathname, q);
  const onUnauthenticated = useCallback(
    () => router.replace(`/?returnTo=${encodeURIComponent(returnTo)}` as Href),
    [returnTo, router],
  );

  return (
    <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}>
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaView>
    </AuthenticatedMobileBoundary>
  );
}
