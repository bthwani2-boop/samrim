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
  const [acceptingID, setAcceptingID] = useState("");
  const [notice, setNotice] = useState("");
  const [requiresReload, setRequiresReload] = useState(false);
  const mutationInFlight = useRef<{ request: number; sessionKey: string } | null>(null);
  const requestID = useRef(0);
  const focused = useRef(false);
  const currentSession = captainSessionKey(currentIdentityState());
  // Store names belong to the session which loaded them, even for the same actor.
  const visibleState = sessionKey && currentSession === sessionKey && state.sessionKey === sessionKey
    ? state : { kind: "loading" as const, sessionKey };

  const reload = useCallback(async () => {
    // A same-session refresh must not supersede the acceptance readback.
    if (mutationInFlight.current?.sessionKey === sessionKey) return;
    const request = ++requestID.current;
    const isCurrent = () => Boolean(sessionKey) && request === requestID.current
      && captainSessionKey(currentIdentityState()) === sessionKey;
    if (!isCurrent()) return;
    setNotice("");
    setState({ kind: "loading", sessionKey });
    try {
      const token = await getUsableIdentityAccessToken();
      if (!isCurrent()) return;
      const response = await captainClient().listOwnStoreCaptainMemberships(token);
      if (isCurrent()) {
        setRequiresReload(false);
        setState({ kind: "ready", sessionKey, memberships: response.memberships });
      }
    } catch {
      if (isCurrent()) setState({ kind: "error", sessionKey });
    }
  }, [sessionKey]);

  const acceptMembership = async (membershipID: string) => {
    // Only the invited Captain may accept a currently visible, pending membership.
    // DSH independently enforces that actor/membership ownership and status.
    if (!sessionKey || state.kind !== "ready" || state.sessionKey !== sessionKey ||
        !state.memberships.some((item) => item.id === membershipID && item.state === "pending") ||
        mutationInFlight.current?.sessionKey === sessionKey || requiresReload ||
        captainSessionKey(currentIdentityState()) !== sessionKey) return;
    const request = ++requestID.current;
    const isCurrent = () => request === requestID.current &&
      captainSessionKey(currentIdentityState()) === sessionKey;
    mutationInFlight.current = { request, sessionKey };
    setAcceptingID(membershipID);
    setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (!isCurrent()) return;
      // A timeout/unknown mutation result is not a rejection or acceptance.
      // The authenticated DSH membership readback is the only final UI truth.
      try {
        await captainClient().acceptTargetedStoreCaptainInvitation(token, membershipID);
      } catch { /* Canonical readback below distinguishes committed from unresolved. */ }
      if (!isCurrent()) return;
      const response = await captainClient().listOwnStoreCaptainMemberships(token);
      if (!isCurrent()) return;
      setState({ kind: "ready", sessionKey, memberships: response.memberships });
      const accepted = response.memberships.some((item) => item.id === membershipID && item.state === "active");
      if (!accepted) setRequiresReload(true);
      setNotice(accepted
        ? "تم قبول دعوة المتجر."
        : "لم يُؤكَّد قبول الدعوة بعد. تحقق من حالة العضوية قبل المحاولة مجددًا.");
    } catch {
      if (isCurrent()) {
        setRequiresReload(true);
        setNotice("تعذر التحقق من نتيجة قبول الدعوة. أعد قراءة العضويات قبل إعادة المحاولة.");
      }
    } finally {
      const ownsMutation = mutationInFlight.current?.request === request;
      if (ownsMutation) mutationInFlight.current = null;
      const currentSession = captainSessionKey(currentIdentityState()) === sessionKey;
      if (currentSession) setAcceptingID("");
      // A blur can invalidate the mutation readback while an immediate refocus
      // is blocked by the in-flight lock. Fetch the canonical state afterward.
      if (ownsMutation && focused.current && currentSession && requestID.current !== request) {
        void reload();
      }
    }
  };

  useEffect(() => {
    // Only the current Identity session can reset its invitation UI.
    if (captainSessionKey(currentIdentityState()) !== sessionKey) return;
    setAcceptingID("");
    setNotice("");
    setRequiresReload(false);
  }, [sessionKey]);
  useEffect(() => subscribeIdentitySession(setIdentityState), []);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    void reload();
    return () => { focused.current = false; requestID.current++; };
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
      {visibleState.kind === "ready" && notice ? (
        <Text accessibilityRole="alert" style={styles.description}>{notice}</Text>
      ) : null}
      {visibleState.kind === "ready" && requiresReload ? (
        <BthwaniButton label="تحديث حالة العضويات" onPress={() => void reload()} variant="secondary" />
      ) : null}
      {visibleMemberships.map((membership) => (
        <View key={membership.id} style={styles.membership}>
          <Text style={styles.title}>{membership.storeName}</Text>
          <Text style={styles.description}>{membership.state === "active" ? "نشط" : "بانتظار قبول الدعوة"}</Text>
          {membership.state === "pending" ? (
            <BthwaniButton
              label={acceptingID === membership.id ? "جارٍ التحقق من الدعوة…" : "قبول دعوة المتجر"}
              busy={acceptingID === membership.id}
              disabled={Boolean(acceptingID) || requiresReload}
              onPress={() => void acceptMembership(membership.id)}
              variant="secondary"
            />
          ) : null}
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
