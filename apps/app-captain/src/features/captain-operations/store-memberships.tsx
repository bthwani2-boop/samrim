import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreCaptainMembership } from "@bthwani/dsh";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { captainSessionKey } from "../../bootstrap/captain-session-scope";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { visibleCaptainStoreMemberships } from "./captain-store-membership-policy";

type MembershipState =
  | { kind: "loading"; sessionKey: string }
  | { kind: "ready"; sessionKey: string; memberships: ReadonlyArray<StoreCaptainMembership> }
  | { kind: "error"; sessionKey: string };

export function StoreCaptainMemberships() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const sessionKey = captainSessionKey(identityState);
  const [state, setState] = useState<MembershipState>({ kind: "loading", sessionKey: "" });
  const requestID = useRef(0);
  const currentSession = captainSessionKey(currentIdentityState());
  // Store names belong to the session which loaded them, even for the same actor.
  const visibleState = sessionKey && currentSession === sessionKey && state.sessionKey === sessionKey
    ? state : { kind: "loading" as const, sessionKey };

  const reload = useCallback(async () => {
    const request = ++requestID.current;
    const isCurrent = () => Boolean(sessionKey) && request === requestID.current
      && captainSessionKey(currentIdentityState()) === sessionKey;
    if (!isCurrent()) return;
    setState({ kind: "loading", sessionKey });
    try {
      const token = await getUsableIdentityAccessToken();
      if (!isCurrent()) return;
      const response = await captainClient().listOwnStoreCaptainMemberships(token);
      if (isCurrent()) setState({ kind: "ready", sessionKey, memberships: response.memberships });
    } catch {
      if (isCurrent()) setState({ kind: "error", sessionKey });
    }
  }, [sessionKey]);

  useEffect(() => subscribeIdentitySession(setIdentityState), []);
  useFocusEffect(useCallback(() => {
    void reload();
    return () => { requestID.current++; };
  }, [reload]));

  const visibleMemberships = visibleState.kind === "ready"
    ? visibleCaptainStoreMemberships(visibleState.memberships)
    : [];

  return (
    <BthwaniSurface tone="base" style={styles.card}>
      <Text style={styles.title}>متاجر التوصيل</Text>
      {visibleState.kind === "loading" ? (
        <View style={styles.state}>
          <ActivityIndicator color={theme.interactiveText} />
          <Text style={styles.description}>جارٍ التحميل…</Text>
        </View>
      ) : null}
      {visibleState.kind === "error" ? (
        <View style={styles.state}>
          <Text accessibilityRole="alert" style={styles.description}>تعذر عرض متاجرك المرتبطة.</Text>
          <BthwaniButton label="إعادة المحاولة" onPress={() => void reload()} variant="secondary" />
        </View>
      ) : null}
      {visibleState.kind === "ready" && visibleMemberships.length === 0 ? (
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
