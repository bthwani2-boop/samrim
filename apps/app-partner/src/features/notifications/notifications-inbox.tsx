import { type resolveTheme, sizing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniIconButton, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, type Notification } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { usePartnerStoreScope } from "../partner-onboarding/partner-store-scope-context";
import { partnerSetupSessionKey } from "../partner-onboarding/partner-setup-session-scope";

const copy = {
  accessibilityLabel: "إشعارات الشريك",
  unauthenticatedTitle: "سجّل الدخول لقراءة تحديثات متجرك",
  unauthenticatedDescription: "ستظهر هنا تحديثات المتجر والطلبات بعد تسجيل الدخول.",
};

function dshClient() {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(value, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

function currentNotificationsSessionKey(): string {
  return partnerSetupSessionKey(currentIdentityState());
}

function isCurrentNotificationsSession(sessionKey: string): boolean {
  return Boolean(sessionKey) && currentNotificationsSessionKey() === sessionKey;
}

export function NotificationsInbox() {
  const router = useRouter();
  const { stores, selectStore, selectedStore } = usePartnerStoreScope();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [sessionKey, setSessionKey] = useState(currentNotificationsSessionKey);
  const sessionKeyRef = useRef(sessionKey);
  const authenticated = isCurrentNotificationsSession(sessionKey);
  const requestID = useRef(0);
  const [items, setItems] = useState<ReadonlyArray<Notification>>([]);
  const [loadedSessionKey, setLoadedSessionKey] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(authenticated);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // Old private results never render during a same-actor session renewal.
  const visibleItems = authenticated && loadedSessionKey === sessionKey ? items : [];
  const visibleUnreadCount = authenticated && loadedSessionKey === sessionKey ? unreadCount : 0;
  const unreadItems = visibleItems.filter((item) => !item.readAt);
  const readItems = visibleItems.filter((item) => Boolean(item.readAt));

  const load = useCallback(async (preserveCurrent = false) => {
    if (!isCurrentNotificationsSession(sessionKey)) return;
    const sequence = ++requestID.current;
    if (!preserveCurrent) setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (sequence !== requestID.current || !isCurrentNotificationsSession(sessionKey)) return;
      const response = await dshClient().listNotifications(token, 50);
      if (sequence !== requestID.current || !isCurrentNotificationsSession(sessionKey)) return;
      setItems(response.notifications);
      setUnreadCount(response.unreadCount);
      setLoadedSessionKey(sessionKey);
    } catch (cause) {
      console.error("DSH partner notifications readback failed", cause);
      if (sequence === requestID.current && isCurrentNotificationsSession(sessionKey)) {
        setLoadedSessionKey(sessionKey);
        setError("تعذر قراءة الإشعارات. أعد المحاولة.");
      }
    } finally {
      if (sequence === requestID.current && isCurrentNotificationsSession(sessionKey)) {
        if (!preserveCurrent) setLoading(false);
      }
    }
  }, [sessionKey]);

  useEffect(() => subscribeIdentitySession(() => {
    const nextSessionKey = currentNotificationsSessionKey();
    if (sessionKeyRef.current === nextSessionKey) return;
    sessionKeyRef.current = nextSessionKey;
    requestID.current += 1;
    setSessionKey(nextSessionKey);
    setLoadedSessionKey("");
    setItems([]);
    setUnreadCount(0);
    setLoading(false);
    setBusy("");
    setError("");
  }), []);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestID.current += 1; };
  }, [load]));

  function destination(item: Notification): Href | null {
    // Notifications can outlive a staff grant. Never open a different selected Store.
    const store = item.storeId ? stores.find((entry) => entry.id === item.storeId) : null;
    if (item.storeId && !store) return null;
    const has = (permission: "orders" | "store_operations") =>
      Boolean(store && (store.owned || store.permissions.includes(permission)));
    if (item.orderId?.trim() && item.kind !== "STORE_AVAILABILITY_CHANGED" && item.kind !== "STORE_PUBLISHED") {
      if (item.storeId ? !has("orders") : !stores.some((entry) => entry.owned || entry.permissions.includes("orders"))) return null;
      return { pathname: "/orders", params: { orderId: item.orderId, ...(item.storeId ? { storeId: item.storeId } : {}) } } as Href;
    }
    if (item.storeId && item.kind === "STORE_AVAILABILITY_CHANGED" && has("store_operations"))
      return { pathname: "/store", params: { section: "operations", returnTo: "notifications" } } as Href;
    if (item.storeId && item.kind === "STORE_PUBLISHED" && store?.owned)
      return { pathname: "/store", params: { section: "settings", returnTo: "notifications" } } as Href;
    return null;
  }

  async function markRead(item: Notification) {
    if (busy || loadedSessionKey !== sessionKey || !isCurrentNotificationsSession(sessionKey)) return;
    setBusy(item.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (!isCurrentNotificationsSession(sessionKey)) return;
      if (!item.readAt) {
        await dshClient().markNotificationRead(token, item.id);
        if (isCurrentNotificationsSession(sessionKey)) await load(true);
      }
      if (isCurrentNotificationsSession(sessionKey)) {
        const target = destination(item);
        if (target) {
          if (item.storeId && selectedStore?.id !== item.storeId) selectStore(item.storeId);
          router.push(target);
        } else if (item.orderId || item.storeId) {
          setError("لا يمكنك فتح تفاصيل هذا الإشعار في نطاق المتاجر والصلاحيات الحالية.");
        }
      }
    } catch (cause) {
      console.error("DSH partner notification read-state write failed", cause);
      if (isCurrentNotificationsSession(sessionKey)) setError("تعذر تحديث حالة الإشعار.");
    } finally {
      if (isCurrentNotificationsSession(sessionKey)) setBusy("");
    }
  }

  function renderItem(item: Notification) {
    return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.title}
      accessibilityHint={item.readAt ? undefined : "اضغط لتمييز الإشعار كمقروء"}
      accessibilityState={{ busy: busy === item.id, disabled: Boolean(busy) }}
      disabled={Boolean(busy)} onPress={() => void markRead(item)}
      style={({ pressed }) => [styles.item, !item.readAt && styles.unread, pressed && styles.pressed]}>
      <View style={styles.itemIcon}><BthwaniIcon name={notificationIcon(item.kind)} color={theme.interactiveText} size={17} /></View>
      <View style={styles.itemContent}>
        <View style={styles.itemHeader}>
          <Text numberOfLines={1} style={styles.itemTitle}>{item.title}</Text>
          {!item.readAt ? <View accessibilityLabel="غير مقروء" style={styles.unreadDot} /> : null}
          <Text style={styles.date}>{formatNotificationDate(item.createdAt)}</Text>
        </View>
        <Text numberOfLines={2} style={styles.body}>{item.body}</Text>
      </View>
    </Pressable>;
  }

  return (
    <View style={styles.container} accessibilityLabel={copy.accessibilityLabel}>
      <View style={styles.screenHeader}>
        <Text accessibilityRole="header" style={styles.title}>الإشعارات</Text>
        <BthwaniIconButton icon="back" label="العودة" onPress={() => router.back()} size={sizing.controlSm} tone="soft" />
      </View>

      {!authenticated ? (
        <BthwaniSurface tone="inset" style={styles.state}>
          <View style={styles.stateIcon}><BthwaniIcon name="notifications" color={theme.interactiveText} size={sizing.iconXl} /></View>
          <Text style={styles.cardTitle}>{copy.unauthenticatedTitle}</Text>
          <Text style={styles.muted}>{copy.unauthenticatedDescription}</Text>
          <BthwaniButton label="تسجيل الدخول" onPress={() => router.replace("/?returnTo=/notifications" as Href)} />
        </BthwaniSurface>
      ) : loading || loadedSessionKey !== sessionKey ? (
        <View style={styles.loadingState} accessibilityLabel="جارٍ تجهيز الإشعارات">
          <BthwaniSkeleton width="100%" height={70} />
          <BthwaniSkeleton width="100%" height={70} />
        </View>
      ) : !visibleItems.length && error ? (
        <BthwaniSurface tone="inset" style={styles.state}>
          <View style={styles.stateIcon}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /></View>
          <Text accessibilityRole="alert" style={styles.cardTitle}>تعذر قراءة الإشعارات</Text>
          <Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text>
          <BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" />
        </BthwaniSurface>
      ) : (
        <>
          {visibleUnreadCount > 0 ? <Text style={styles.unreadSummary}>{visibleUnreadCount === 1 ? "إشعار جديد" : visibleUnreadCount + " إشعارات جديدة"}</Text> : null}
          {unreadItems.length ? <View style={styles.group}><View style={styles.groupHeader}><Text style={styles.groupTitle}>الجديدة</Text><Text style={styles.groupCount}>{unreadItems.length}</Text></View><View style={styles.list}>{unreadItems.map(renderItem)}</View></View> : null}
          {readItems.length ? <View style={styles.group}><View style={styles.groupHeader}><Text style={styles.groupTitle}>المقروءة</Text><Text style={styles.groupCount}>{readItems.length}</Text></View><View style={styles.list}>{readItems.map(renderItem)}</View></View> : null}
          {!visibleItems.length ? <Text style={styles.muted}>لا توجد إشعارات.</Text> : null}
          {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        </>
      )}
    </View>
  );
}

function notificationIcon(kind: Notification["kind"]): "orders" | "deliveries" | "cases" | "notifications" {
  if (kind.startsWith("ORDER_")) return "orders";
  if (kind.startsWith("CAPTAIN_") || ["HANDOFF_CONFIRMED", "PICKED_UP", "DELIVERED", "DELIVERY_FAILED", "DELIVERY_RECOVERED", "REASSIGNED"].includes(kind)) return "deliveries";
  if (kind.startsWith("FIELD_")) return "cases";
  return "notifications";
}

function formatNotificationDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Aden", year: "numeric", month: "2-digit", day: "2-digit" });
  return today.format(date) === today.format(new Date())
    ? new Intl.DateTimeFormat("ar-YE", { timeZone: "Asia/Aden", hour: "2-digit", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat("ar-YE", { timeZone: "Asia/Aden", month: "numeric", day: "numeric" }).format(date);
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({
  container: { backgroundColor: theme.background, flexGrow: 1, gap: 9, paddingBottom: 12, width: "100%" },
  screenHeader: { height: 50, alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  title: { ...typography.titleSm, fontSize: 20, fontWeight: "800", color: theme.color },
  unreadSummary: { ...typography.caption, color: theme.interactiveText },
  group: { gap: 5 },
  groupHeader: { flexDirection: "row", gap: 7, alignItems: "center" },
  groupTitle: { ...typography.label, color: theme.color },
  groupCount: { ...typography.caption, color: theme.colorMuted },
  list: { gap: 7 },
  item: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "flex-start", gap: 9, paddingVertical: 10, paddingHorizontal: 11, minHeight: 62 },
  unread: { backgroundColor: theme.actionSoft, borderColor: theme.borderColorStrong },
  itemContent: { flex: 1, minWidth: 0, gap: 3 },
  itemHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  itemIcon: { width: 29, height: 29, backgroundColor: theme.surfaceInset, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  itemTitle: { ...typography.bodyStrong, fontSize: 13, color: theme.color, flex: 1 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.brandAction },
  body: { ...typography.caption, color: theme.colorMuted, lineHeight: 18 },
  date: { ...typography.caption, color: theme.colorMuted, fontSize: 10 },
  muted: { ...typography.bodySm, color: theme.colorMuted },
  state: { borderRadius: 12, gap: 8, padding: 12 },
  stateIcon: { alignItems: "center", justifyContent: "center" },
  cardTitle: { ...typography.bodyStrong, color: theme.color },
  loadingState: { gap: 8 },
  error: { ...typography.bodySm, color: theme.warning },
  pressed: { opacity: .76 },
}); }
