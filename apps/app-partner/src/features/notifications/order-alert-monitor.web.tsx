import { borders, radius, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, OrderAlertCursor } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useRouter } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";

import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";

type PendingOrderAlert = Readonly<{ actorId: string; orderId: string; storeId: string }>;

function currentActorID(): string {
  const state = currentIdentityState();
  return state.kind === "authenticated" ? state.identity.subject.trim() : "";
}

/** The web foreground counterpart to the native order alert monitor.
 * It reuses DSH's actor-scoped, deduplicated alert cursor; no browser
 * notification permission, service worker or duplicate push channel is needed.
 */
export function OrderAlertMonitor() {
  const actorId = useSyncExternalStore(subscribeIdentitySession, currentActorID, () => "");
  const router = useRouter();
  const theme = useAppearanceTheme();
  const [notice, setNotice] = useState<PendingOrderAlert | null>(null);

  useEffect(() => {
    let active = true;
    let busy = false;
    const cursor = new OrderAlertCursor();
    setNotice(null);

    const poll = async () => {
      if (!actorId || !active || busy || document.visibilityState !== "visible") return;
      const apiUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
      if (!apiUrl) return;
      busy = true;
      try {
        const token = await getUsableIdentityAccessToken();
        if (!active || currentActorID() !== actorId) return;
        const response = await createDshMobileClient(apiUrl, { cryptoRandomUUID: () => Crypto.randomUUID() })
          .listNotifications(token, 35);
        if (!active || currentActorID() !== actorId) return;
        const fresh = cursor.receive("partner", actorId, response.notifications);
        const newest = fresh.at(-1);
        if (newest) setNotice({
          actorId,
          orderId: newest.orderId ?? "",
          storeId: newest.storeId ?? "",
        });
      } catch {
        // A transient failure must not fabricate a new order alert.
      } finally {
        busy = false;
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 8_000);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [actorId]);

  if (!notice || !actorId || notice.actorId !== actorId) return null;

  const openOrders = () => {
    setNotice(null);
    const idValid = /^[A-Za-z0-9._~-]{1,160}$/.test(notice.orderId);
    const storeValid = /^[A-Za-z0-9._~-]{1,160}$/.test(notice.storeId);
    const destination: Href = idValid
      ? { pathname: "/orders", params: { orderId: notice.orderId, ...(storeValid ? { storeId: notice.storeId } : {}) } }
      : "/orders";
    router.push(destination);
  };

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View accessibilityRole="alert" accessibilityLiveRegion="assertive"
        style={[styles.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor }]}>
        <Text style={[styles.title, { color: theme.color }]}>طلب جديد</Text>
        <Text style={[styles.description, { color: theme.colorMuted }]}>
          وصل طلب جديد إلى أحد المتاجر المصرح لك بإدارتها.
        </Text>
        <View style={styles.actions}>
          <BthwaniButton label="عرض الطلبات" onPress={openOrders} />
          <BthwaniButton label="إغلاق التنبيه" onPress={() => setNotice(null)} variant="secondary" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    bottom: spacing[4],
    left: spacing[4],
    right: spacing[4],
    zIndex: 1000,
    alignItems: "flex-start",
  },
  card: {
    width: "100%",
    maxWidth: 390,
    borderWidth: borders.hairline,
    borderRadius: radius.lg,
    padding: spacing[4],
    gap: spacing[2],
  },
  title: { ...typography.titleSm, fontWeight: "800" },
  description: { ...typography.bodySm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
});
