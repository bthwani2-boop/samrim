import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, Redirect } from "expo-router";
import { type PropsWithChildren, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { createPartnerSurfaceStyles } from "../features/partner-onboarding/partner-surface-styles";
import { usePartnerStoreScope } from "../features/partner-onboarding/partner-store-scope-context";
import { type PartnerSurface, canonicalPartnerSurfacePath } from "./partner-authority";

/**
 * Fails a protected app-partner surface closed until the actor's authority is
 * proven from the live accessible-store scope. Direct or deep-link entry to a
 * surface without material authority never renders it: it redirects to the
 * actor's canonical first authorized surface instead of relying on hidden
 * tabs alone.
 */
export function PartnerSurfaceGate({ surface, children }: Readonly<PropsWithChildren<{ surface: PartnerSurface }>>) {
  const { state, authority, reload } = usePartnerStoreScope();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);

  if (state.kind === "loading") {
    return <View style={styles.card}><ActivityIndicator accessibilityLabel="جارٍ التحقق من صلاحية الوصول" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ التحقق من صلاحيات وصولك إلى هذه المساحة…</Text></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.card}>
      <Text accessibilityRole="alert" style={styles.error}>تعذر التحقق من صلاحية وصولك إلى هذه المساحة، لذلك بقيت مغلقة مؤقتًا.</Text>
      <BthwaniButton label="إعادة التحقق" onPress={() => void reload()} variant="secondary" />
      <Text style={styles.muted}>يبقى حسابك متاحًا دائمًا من مساحة الحساب، ويمكن إعادة المحاولة في أي وقت.</Text>
    </View>;
  }
  if (!authority.canUse(surface)) {
    return <Redirect href={canonicalPartnerSurfacePath(authority) as Href} />;
  }
  return <>{children}</>;
}
