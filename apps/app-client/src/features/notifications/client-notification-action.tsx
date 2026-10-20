import { borders, radius, type resolveTheme, sizing, typography } from "@bthwani/design-system";
import { BthwaniIconButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";

function currentClientActorID(): string {
  const session = currentIdentityState();
  return session.kind === "authenticated" ? session.identity.subject.trim() : "";
}

/** A server-owned unread count, never a local approximation based on the first page. */
export function ClientNotificationAction() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [actorID, setActorID] = useState(currentClientActorID);
  const [unreadCount, setUnreadCount] = useState(0);
  const requestID = useRef(0);

  useEffect(() => subscribeIdentitySession(() => {
    requestID.current += 1;
    setUnreadCount(0);
    setActorID(currentClientActorID());
  }), []);

  useFocusEffect(useCallback(() => {
    const sequence = ++requestID.current;
    if (!actorID || currentClientActorID() !== actorID) return () => { requestID.current += 1; };
    void (async () => {
      try {
        const token = await getUsableIdentityAccessToken();
        if (sequence !== requestID.current || currentClientActorID() !== actorID) return;
        const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
        if (!url) return;
        const result = await createDshMobileClient(url, { cryptoRandomUUID: () => Crypto.randomUUID() }).listNotifications(token, 1);
        if (sequence === requestID.current && currentClientActorID() === actorID) {
          setUnreadCount(Number.isSafeInteger(result.unreadCount) && result.unreadCount > 0 ? result.unreadCount : 0);
        }
      } catch {
        // The notifications screen offers the full load/retry state.
      }
    })();
    return () => { requestID.current += 1; };
  }, [actorID]));

  const countText = unreadCount > 99 ? "99+" : String(unreadCount);
  return <View style={styles.wrapper}>
    <BthwaniIconButton icon="notifications" label={unreadCount ? `الإشعارات، ${unreadCount} غير مقروءة` : "الإشعارات"} onPress={() => router.push("/notifications" as Href)} size={sizing.controlMd} tone="soft" />
    {unreadCount > 0 ? <View pointerEvents="none" style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
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
