import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniIconButton, BthwaniSkeleton, BthwaniStatusBadge, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, type Notification } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

const copy = {
  accessibilityLabel: "إشعارات الكابتن",
  eyebrow: "مركز تنبيهات التوصيل",
  description: "تابع عروض وتحديثات التوصيل في قائمة واضحة ومنظمة.",
  unauthenticatedTitle: "سجّل الدخول لقراءة إشعارات التوصيل",
  unauthenticatedDescription: "ستظهر هنا عروض وتحديثات التوصيل بعد تسجيل الدخول.",
  unreadDescription: "ابدأ بالأحدث لتبقى على اطلاع بحالة توصيلاتك.",
  readDescription: "أنت على اطلاع بكل تحديثات توصيلاتك.",
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
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(authenticated);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const unreadItems = useMemo(() => items.filter((item) => !item.readAt), [items]);
  const readItems = useMemo(() => items.filter((item) => Boolean(item.readAt)), [items]);

  const load = useCallback(async (preserveCurrent = false) => {
    if (!authenticated) return;
    if (preserveCurrent) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await dshClient().listNotifications(token, 50);
      setItems(response.notifications);
      setUnreadCount(response.unreadCount);
    } catch (cause) {
      console.error("DSH captain notifications readback failed", cause);
      setError("تعذر قراءة الإشعارات. أعد المحاولة.");
    } finally {
      if (preserveCurrent) setRefreshing(false); else setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => { void load(); }, [load]);

  async function markRead(item: Notification) {
    if (item.readAt || busy) return;
    setBusy(item.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await dshClient().markNotificationRead(token, item.id);
      await load(true);
    } catch (cause) {
      console.error("DSH captain notification read-state write failed", cause);
      setError("تعذر تحديث حالة الإشعار.");
    } finally {
      setBusy("");
    }
  }

  function renderItem(item: Notification) {
    return (
      <Pressable
        key={item.id}
        accessibilityRole="button"
        accessibilityLabel={item.title}
        accessibilityHint={item.readAt ? undefined : "اضغط لتمييز الإشعار كمقروء"}
        accessibilityState={{ busy: busy === item.id, disabled: Boolean(busy) }}
        disabled={Boolean(busy)}
        onPress={() => void markRead(item)}
        style={({ pressed }) => [styles.item, !item.readAt && styles.unread, pressed && styles.pressed]}
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
        <View style={styles.loadingState} accessibilityLabel="جارٍ تجهيز الإشعارات">
          <BthwaniSkeleton width="100%" height={84} />
          <BthwaniSkeleton width="100%" height={142} />
          <BthwaniSkeleton width="100%" height={142} />
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
          <BthwaniSurface tone="raised" style={styles.summary}>
            <View style={styles.summaryIcon}><BthwaniIcon name="notifications" color={theme.interactiveText} size={sizing.iconLg} /></View>
            <View style={styles.summaryCopy}>
              <Text style={styles.summaryTitle}>{unreadCount} إشعارات غير مقروءة</Text>
              <Text style={styles.muted}>{unreadCount ? copy.unreadDescription : copy.readDescription}</Text>
            </View>
          </BthwaniSurface>
          {unreadItems.length ? <View style={styles.group}><View style={styles.groupHeader}><Text style={styles.groupTitle}>الجديدة</Text><Text style={styles.groupCount}>{unreadItems.length}</Text></View><View style={styles.list}>{unreadItems.map(renderItem)}</View></View> : null}
          {readItems.length ? <View style={styles.group}><View style={styles.groupHeader}><Text style={styles.groupTitle}>المقروءة</Text><Text style={styles.groupCount}>{readItems.length}</Text></View><View style={styles.list}>{readItems.map(renderItem)}</View></View> : null}
          {!items.length ? <BthwaniSurface tone="inset" style={styles.state}><View style={styles.stateIcon}><BthwaniIcon name="notifications" color={theme.colorMuted} size={sizing.iconXl} /></View><Text style={styles.cardTitle}>لا توجد إشعارات حالياً</Text><Text style={styles.muted}>ستظهر تحديثات التوصيل هنا عند توفرها.</Text></BthwaniSurface> : null}
          {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
          <BthwaniButton busy={refreshing} disabled={Boolean(busy)} label="تحديث الإشعارات" onPress={() => void load(true)} variant="secondary" />
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
  container: { backgroundColor: theme.background, direction: "rtl", flexGrow: 1, gap: spacing[4], paddingBottom: spacing[5], width: "100%" },
  screenHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
  headingCopy: { flex: 1, gap: spacing[1] },
  eyebrow: { ...typography.label, color: theme.interactiveText },
  title: { ...typography.hero, color: theme.color },
  description: { ...typography.body, color: theme.colorMuted },
  summary: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[3], padding: spacing[4], ...elevation.raised },
  summaryIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.round, height: sizing.avatarMd, justifyContent: "center", width: sizing.avatarMd },
  summaryCopy: { flex: 1, gap: spacing[1] },
  summaryTitle: { ...typography.titleSm, color: theme.color },
  group: { gap: spacing[2] },
  groupHeader: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
  groupTitle: { ...typography.titleSm, color: theme.color },
  groupCount: { ...typography.label, color: theme.interactiveText },
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
  state: { alignItems: "center", borderRadius: radius.xl, gap: spacing[3], padding: spacing[5] },
  stateIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.round, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
  cardTitle: { ...typography.titleSm, color: theme.color, textAlign: "center" },
  loadingState: { gap: spacing[3] },
  error: { ...typography.bodySm, color: theme.warning },
  pressed: { opacity: 0.76 },
}); }
