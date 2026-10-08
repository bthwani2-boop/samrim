import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniIconButton, BthwaniSkeleton, BthwaniStatusBadge, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, type Notification } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

const copy = {
  accessibilityLabel: "إشعارات الميدان",
  eyebrow: "مركز تنبيهات الميدان",
  description: "تابع أخبار الشركاء وتحديثاتهم في قائمة واضحة ومنظمة.",
  unauthenticatedTitle: "سجّل الدخول لقراءة إشعارات الميدان",
  unauthenticatedDescription: "ستظهر هنا تحديثات الشركاء بعد تسجيل الدخول.",
};

function dshClient() {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(value, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

export function NotificationsInbox() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [items, setItems] = useState<ReadonlyArray<Notification>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(authenticated);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const requestID = useRef(0);
  const focused = useRef(false);

  const load = useCallback(async (preserveCurrent = false, cursor = "") => {
    if (!authenticated || !focused.current) return;
    const currentRequest = ++requestID.current;
    if (cursor) setLoadingMore(true);
    else {
      setLoadingMore(false);
      if (preserveCurrent) setRefreshing(true);
      else { setRefreshing(false); setLoading(true); }
    }
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await dshClient().listNotifications(token, 50, cursor);
      if (currentRequest === requestID.current) {
        setItems((current) => {
          if (!cursor) return response.notifications;
          const knownIDs = new Set(current.map((item) => item.id));
          return [...current, ...response.notifications.filter((item) => !knownIDs.has(item.id))];
        });
        setNextCursor(response.nextCursor ?? "");
        setUnreadCount(response.unreadCount);
      }
    } catch (cause) {
      console.warn("DSH field notifications readback failed", cause);
      if (currentRequest === requestID.current) setError("تعذر قراءة الإشعارات. أعد المحاولة.");
    } finally {
      if (currentRequest === requestID.current) {
        if (cursor) setLoadingMore(false);
        else if (preserveCurrent) setRefreshing(false);
        else setLoading(false);
      }
    }
  }, [authenticated]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore || refreshing || loading) return;
    void load(true, nextCursor);
  }, [load, loading, loadingMore, nextCursor, refreshing]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void load();
    return () => { focused.current = false; requestID.current += 1; };
  }, [load]));

  async function markRead(item: Notification) {
    if (item.readAt || busy) return;
    setBusy(item.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await dshClient().markNotificationRead(token, item.id);
      if (focused.current) await load(true);
    } catch (cause) {
      console.warn("DSH field notification read-state write failed", cause);
      if (focused.current) setError("تعذر تحديث حالة الإشعار.");
    } finally {
      setBusy("");
    }
  }

  function renderItem(item: Notification) {
    const destination = item.kind === "FIELD_REWARD_CONFIRMED"
      ? { pathname: "/wallet" as const, label: "فتح المحفظة" }
      : item.joiningCaseId
        ? { pathname: "/cases" as const, params: { caseId: item.joiningCaseId }, label: "فتح ملف الشريك" }
        : null;
    return (
      <View key={item.id} style={[styles.item, !item.readAt && styles.unread]}>
        <Pressable
          accessibilityRole={item.readAt ? "text" : "button"}
          accessibilityLabel={`${item.title}${item.readAt ? "، مقروء" : "، غير مقروء"}`}
          accessibilityHint={item.readAt ? undefined : "اضغط لتمييز الإشعار كمقروء"}
          accessibilityState={{ busy: busy === item.id, disabled: Boolean(busy) || Boolean(item.readAt) }}
          disabled={Boolean(busy) || Boolean(item.readAt)}
          onPress={() => void markRead(item)}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <View style={styles.itemHeader}>
            <View style={styles.itemMain}>
              <View style={styles.itemIcon}><BthwaniIcon name={notificationIcon(item.kind)} color={theme.interactiveText} size={sizing.iconMd} /></View>
              <Text selectable style={styles.itemTitle}>{item.title}</Text>
            </View>
            {!item.readAt ? <BthwaniStatusBadge label="جديد" tone="info" /> : null}
          </View>
          <Text selectable style={styles.body}>{item.body}</Text>
          <Text selectable style={styles.date}>{formatNotificationDate(item.createdAt)}</Text>
        </Pressable>
        {destination ? <BthwaniButton label={destination.label} onPress={() => router.push({ pathname: destination.pathname, ...("params" in destination ? { params: destination.params } : {}) } as Href)} variant="secondary" /> : null}
      </View>
    );
  }

  return (
    <View style={styles.container} accessibilityLabel={copy.accessibilityLabel}>
      <View style={styles.screenHeader}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
          <Text style={styles.title}>الإشعارات</Text>
          <Text style={styles.description}>{copy.description}</Text>
        </View>
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
        <View style={styles.loadingState} accessibilityLabel="جارٍ تجهيز الإشعارات"><BthwaniSkeleton width="100%" height={72} /></View>
      ) : !items.length && error ? (
        <BthwaniSurface tone="inset" style={styles.state}>
          <View style={styles.stateIcon}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /></View>
          <Text accessibilityRole="alert" style={styles.cardTitle}>تعذر قراءة الإشعارات</Text>
          <Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text>
          <BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" />
        </BthwaniSurface>
      ) : (
        <>
          <View style={styles.summary}><View style={styles.summaryCopy}><Text style={styles.summaryTitle}>{unreadCount.toLocaleString("ar-YE")} غير مقروءة إجمالًا</Text><Text style={styles.muted}>تعرض القائمة الإشعارات الأحدث أولًا.</Text></View><BthwaniButton busy={refreshing} disabled={Boolean(busy) || loadingMore} label="تحديث" onPress={() => void load(true)} variant="secondary" /></View>
          {items.length ? <View style={styles.list}>{items.map(renderItem)}</View> : null}
          {!items.length ? <View style={styles.empty}><BthwaniIcon name="notifications" color={theme.colorMuted} size={sizing.iconMd} /><Text style={styles.muted}>لا توجد إشعارات حالياً</Text></View> : null}
          {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
          {nextCursor ? <BthwaniButton busy={loadingMore} disabled={Boolean(busy) || refreshing || loading} label="تحميل إشعارات أقدم" onPress={loadMore} variant="secondary" /> : null}
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
  return new Date(value).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" });
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({
  container: { backgroundColor: theme.background, direction: "rtl", flexGrow: 1, gap: spacing[3], paddingBottom: spacing[5], paddingTop: spacing[3], width: "100%" },
  screenHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
  headingCopy: { flex: 1, gap: spacing[1] },
  eyebrow: { ...typography.label, color: theme.interactiveText },
  title: { ...typography.titleLg, color: theme.color },
  description: { ...typography.body, color: theme.colorMuted },
  summary: { alignItems: "center", flexDirection: "row", gap: spacing[2], justifyContent: "space-between" },
  summaryCopy: { flex: 1, gap: spacing[1] },
  summaryTitle: { ...typography.titleSm, color: theme.color },
  list: { gap: spacing[3] },
  item: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4], ...elevation.raised },
  unread: { backgroundColor: theme.actionSoft, borderColor: theme.borderColorStrong },
  itemHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing[2], justifyContent: "space-between" },
  itemMain: { alignItems: "center", flexDirection: "row", flex: 1, gap: spacing[2] },
  itemIcon: { alignItems: "center", backgroundColor: theme.surfaceInset, borderRadius: radius.md, height: sizing.avatarSm, justifyContent: "center", width: sizing.avatarSm },
  itemTitle: { ...typography.bodyStrong, color: theme.color, flex: 1 },
  body: { ...typography.body, color: theme.color },
  date: { ...typography.caption, color: theme.colorMuted },
  muted: { ...typography.bodySm, color: theme.colorMuted },
  state: { alignItems: "center", borderRadius: radius.lg, gap: spacing[2], padding: spacing[3] },
  stateIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.round, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
  cardTitle: { ...typography.titleSm, color: theme.color, textAlign: "center" },
  loadingState: { gap: spacing[2] },
  empty: { alignItems: "center", flexDirection: "row", gap: spacing[2], paddingVertical: spacing[3] },
  error: { ...typography.bodySm, color: theme.warning },
  pressed: { opacity: 0.76 },
}); }
