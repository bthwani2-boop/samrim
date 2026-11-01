import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreCaptainMembership } from "@bthwani/dsh";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { visibleCaptainStoreMemberships } from "./captain-store-membership-policy";

type MembershipState =
  | { kind: "loading" }
  | { kind: "ready"; memberships: ReadonlyArray<StoreCaptainMembership> }
  | { kind: "error" };

export function StoreCaptainMemberships() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<MembershipState>({ kind: "loading" });

  const reload = useCallback(async () => {
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await captainClient().listOwnStoreCaptainMemberships(token);
      setState({ kind: "ready", memberships: response.memberships });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const visibleMemberships = state.kind === "ready"
    ? visibleCaptainStoreMemberships(state.memberships)
    : [];

  return (
    <BthwaniSurface tone="base" style={styles.card}>
      <Text style={styles.title}>متاجر التوصيل</Text>
      {state.kind === "loading" ? (
        <View style={styles.state}>
          <ActivityIndicator color={theme.interactiveText} />
          <Text style={styles.description}>جارٍ التحميل…</Text>
        </View>
      ) : null}
      {state.kind === "error" ? (
        <View style={styles.state}>
          <Text accessibilityRole="alert" style={styles.description}>تعذر عرض متاجرك المرتبطة.</Text>
          <BthwaniButton label="إعادة المحاولة" onPress={() => void reload()} variant="secondary" />
        </View>
      ) : null}
      {state.kind === "ready" && visibleMemberships.length === 0 ? (
        <Text style={styles.description}>لا توجد عضويات متاجر نشطة أو قيد التفعيل مرتبطة بحسابك.</Text>
      ) : null}
      {visibleMemberships.map((membership) => (
        <View key={membership.id} style={styles.membership}>
          <Text style={styles.title}>{membership.storeName}</Text>
          <Text style={styles.description}>{membership.state === "active" ? "نشط" : "بانتظار التفعيل"}</Text>
        </View>
      ))}
    </BthwaniSurface>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    title: { ...typography.bodyStrong, color: theme.color },
    description: { ...typography.bodySm, color: theme.colorMuted },
    state: { gap: spacing[2], paddingVertical: spacing[2] },
    membership: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
  });
}
