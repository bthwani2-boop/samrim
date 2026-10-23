import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniIconButton, BthwaniSkeleton, BthwaniStatusBadge, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, type Notification } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";

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

function activeActorID(): string {
  const session = currentIdentityState();
  return session.kind === "authenticated" ? session.identity.subject.trim() : "";
}

export function NotificationsInbox() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [actorID, setActorID] = useState(activeActorID);
  const authenticated = Boolean(actorID);
  const requestID = useRef(0);
  const [items, setItems] = useState<ReadonlyArray<Notification>>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(authenticated);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const unreadItems = useMemo(() => items.filter((item) => !item.readAt), [items]);
  const readItems = useMemo(() => items.filter((item) => Boolean(item.readAt)), [items]);

  const load = useCallback(async (preserveCurrent = false) => {
    if (!actorID || activeActorID() !== actorID) return;
    const sequence = ++requestID.current;
    if (!preserveCurrent) setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (sequence !== requestID.current || activeActorID() !== actorID) return;
      const response = await dshClient().listNotifications(token, 50);
      if (sequence !== requestID.current || activeActorID() !== actorID) return;
      setItems(response.notifications);
      setUnreadCount(response.unreadCount);
    } catch (cause) {
      console.error("DSH partner notifications readback failed", cause);
      if (sequence === requestID.current && activeActorID() === actorID) setError("تعذر قراءة الإشعارات. أعد المحاولة.");
    } finally {
      if (sequence === requestID.current && activeActorID() === actorID) {
        if (!preserveCurrent) setLoading(false);
      }
    }
  }, [actorID]);

  useEffect(() => subscribeIdentitySession(() => {
    requestID.current += 1;
    setActorID(activeActorID());
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

  async function markRead(item: Notification) {
    if (item.readAt || busy || !actorID || activeActorID() !== actorID) return;
    setBusy(item.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (activeActorID() !== actorID) return;
      await dshClient().markNotificationRead(token, item.id);
      if (activeActorID() === actorID) await load(true);
    } catch (cause) {
      console.error("DSH partner notification read-state write failed", cause);
      if (activeActorID() === actorID) setError("تعذر تحديث حالة الإشعار.");
    } finally {
      if (activeActorID() === actorID) setBusy("");
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
      ) : loading ? (
        <View style={styles.loadingState} accessibilityLabel="جارٍ تجهيز الإشعارات">
          <BthwaniSkeleton width="100%" height={70} />
          <BthwaniSkeleton width="100%" height={70} />
        </View>
      ) : !items.length && error ? (
        <BthwaniSurface tone="inset" style={styles.state}>
          <View style={styles.stateIcon}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /></View>
          <Text accessibilityRole="alert" style={styles.cardTitle}>تعذر قراءة الإشعارات</Text>
          <Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text>
          <BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" />
        </BthwaniSurface>
      ) : (
        <>
          {unreadCount > 0 ? <Text style={styles.unreadSummary}>{unreadCount === 1 ? "إشعار جديد" : unreadCount + " إشعارات جديدة"}</Text> : null}
          {unreadItems.length ? <View style={styles.group}><View style={styles.groupHeader}><Text style={styles.groupTitle}>الجديدة</Text><Text style={styles.groupCount}>{unreadItems.length}</Text></View><View style={styles.list}>{unreadItems.map(renderItem)}</View></View> : null}
          {readItems.length ? <View style={styles.group}><View style={styles.groupHeader}><Text style={styles.groupTitle}>المقروءة</Text><Text style={styles.groupCount}>{readItems.length}</Text></View><View style={styles.list}>{readItems.map(renderItem)}</View></View> : null}
          {!items.length ? <Text style={styles.muted}>لا توجد إشعارات.</Text> : null}
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
