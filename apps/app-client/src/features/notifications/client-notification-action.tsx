import { borders, radius, type resolveTheme, sizing, typography } from "@bthwani/design-system";
import { BthwaniIconButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { clientSessionKey } from "../access/client-session-scope";

function currentClientNotificationSessionKey(): string {
  return clientSessionKey(currentIdentityState());
}

/** A server-owned unread count, never a local approximation based on the first page. */
export function ClientNotificationAction() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [sessionKey, setSessionKey] = useState(currentClientNotificationSessionKey);
  const sessionKeyRef = useRef(sessionKey);
  const [loadedSessionKey, setLoadedSessionKey] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const requestID = useRef(0);

  useEffect(() => subscribeIdentitySession(() => {
    const nextSessionKey = currentClientNotificationSessionKey();
    if (sessionKeyRef.current === nextSessionKey) return;
    sessionKeyRef.current = nextSessionKey;
    requestID.current += 1;
    setUnreadCount(0);
    setLoadedSessionKey("");
    setSessionKey(nextSessionKey);
  }), []);

  useFocusEffect(useCallback(() => {
    const sequence = ++requestID.current;
    if (!sessionKey || currentClientNotificationSessionKey() !== sessionKey) return () => { requestID.current += 1; };
    void (async () => {
      try {
        const token = await getUsableIdentityAccessToken();
        if (sequence !== requestID.current || currentClientNotificationSessionKey() !== sessionKey) return;
        const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
        if (!url) return;
        const client = createDshMobileClient(url, { cryptoRandomUUID: () => Crypto.randomUUID() });
        const [result, shares] = await Promise.all([client.listNotifications(token, 1), client.listClientShares(token).catch(() => null)]);
        if (sequence === requestID.current && currentClientNotificationSessionKey() === sessionKey) {
          setUnreadCount(Math.max(0, result.unreadCount || 0) + Math.max(0, shares?.unreadCount || 0));
          setLoadedSessionKey(sessionKey);
        }
      } catch {
        // The notifications screen offers the full load/retry state.
      }
    })();
    return () => { requestID.current += 1; };
  }, [sessionKey]));

  // Never render a previous session's private unread count during the Identity transition.
  const visibleUnreadCount = sessionKey && loadedSessionKey === sessionKey && currentClientNotificationSessionKey() === sessionKey ? unreadCount : 0;
  const countText = visibleUnreadCount > 99 ? "99+" : String(visibleUnreadCount);
  return <View style={styles.wrapper}>
    <BthwaniIconButton icon="notifications" label={visibleUnreadCount ? `الإشعارات، ${visibleUnreadCount} غير مقروءة` : "الإشعارات"} onPress={() => router.push("/notifications" as Href)} size={sizing.controlMd} tone="soft" />
    {visibleUnreadCount > 0 ? <View pointerEvents="none" style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={styles.count}>{countText}</Text>
    </View> : null}
  </View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    wrapper: { position: "relative" },
    badge: { position: "absolute", top: -4, right: -5, minWidth: 18, height: 18, paddingHorizontal: 3, borderRadius: radius.round, alignItems: "center", justifyContent: "center", backgroundColor: theme.interactiveText, borderColor: theme.surface, borderWidth: borders.hairline },
    count: { ...typography.caption, color: theme.surface, fontSize: 10, fontWeight: "700", lineHeight: 13, textAlign: "center" },
  });
}
