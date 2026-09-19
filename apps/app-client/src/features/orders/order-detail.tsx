import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSectionHeader, BthwaniSkeleton, BthwaniStatusBadge, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, formatOrderDate, formatQuantity, type Order, orderStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

export default function ClientOrderDetail() {
  const { orderId: rawOrderId } = useLocalSearchParams<{ orderId?: string | string[] }>();
  const orderId = Array.isArray(rawOrderId) ? rawOrderId[0] ?? "" : rawOrderId ?? "";
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; order: Order } | { kind: "error" } | { kind: "auth_required" }>({ kind: "loading" });
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const load = useCallback(async (preserveCurrent = false) => {
    if (!orderId.trim()) { setState({ kind: "error" }); return; }
    if (preserveCurrent) setRefreshing(true);
    else setState({ kind: "loading" });
    setRefreshError("");
    try {
      const token = await getUsableIdentityAccessToken();
      setState({ kind: "ready", order: (await client().readOrder(token, orderId)).order });
    } catch (error) {
      console.error("DSH client order detail read failed", error);
      if (preserveCurrent) setRefreshError("تعذر تحديث الحالة. ما زالت التفاصيل الحالية معروضة.");
      else setState({ kind: "error" });
    } finally {
      setRefreshing(false);
    }
  }, [orderId]);

  useEffect(() => subscribeIdentitySession(setIdentityState), []);

  useEffect(() => {
    if (identityState.kind !== "authenticated") {
      setState({ kind: "auth_required" });
      setRefreshError("");
      return;
    }
    void load();
  }, [identityState.kind, load]);

  if (state.kind === "auth_required") return <View style={styles.state}><BthwaniIcon name="account" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.title}>سجّل الدخول لعرض تفاصيل الطلب</Text><Text style={styles.muted}>سجّل الدخول أولًا ثم افتح الطلب مرة أخرى.</Text><BthwaniButton label="تسجيل الدخول" onPress={() => router.replace("/?returnTo=/orders" as Href)} /></View>;
  if (state.kind === "loading") return <View style={styles.state} accessibilityLabel="جارٍ تجهيز تفاصيل الطلب"><BthwaniSkeleton width="42%" height={28} /><BthwaniSkeleton height={128} /><BthwaniSkeleton height={180} /></View>;
  if (state.kind === "error") return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text style={styles.title}>تعذر قراءة تفاصيل الطلب</Text><Text style={styles.muted}>قد تكون الجلسة أو الطلب غير متاحين الآن.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} /><BthwaniButton label="العودة إلى الطلبات" onPress={() => router.back()} variant="secondary" /></View>;

  const { order } = state;
  return (
    <View style={styles.container} accessibilityLabel="تفاصيل الطلب">
      <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى الطلبات" onPress={() => router.back()} style={styles.backButton}><BthwaniIcon name="back" color={theme.interactiveText} size={sizing.iconMd} /><Text style={styles.back}>طلباتي</Text></Pressable>
      <BthwaniSurface tone="raised" style={styles.summary}>
        <View style={styles.summaryIcon}><BthwaniIcon name="orders" color={theme.onAction} size={sizing.iconXl} /></View>
        <View style={styles.summaryCopy}><Text style={styles.eyebrow}>طلبك</Text><Text style={styles.title}>طلب {formatOrderDate(order.createdAt)}</Text><Text style={styles.muted}>{order.addressText}</Text></View>
      </BthwaniSurface>
      <View style={styles.status}><View style={styles.statusCopy}><Text style={styles.statusTitle}>الحالة الحالية</Text><BthwaniStatusBadge icon={order.state === "DELIVERED" ? "success" : order.state === "DELIVERY_FAILED" ? "warning" : "orders"} label={orderStateLabel(order.state)} tone={order.state === "DELIVERED" ? "success" : order.state === "DELIVERY_FAILED" ? "danger" : "info"} /><Text style={styles.statusTotal}>{formatMoney(order.totalAmountMinor, order.currency)}</Text></View><BthwaniButton accessibilityLabel="تحديث حالة الطلب" busy={refreshing} label="تحديث الحالة" onPress={() => void load(true)} variant="secondary" /></View>
      {refreshError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.refreshError}>{refreshError}</Text> : null}
      <BthwaniSectionHeader title="عنوان التوصيل" />
      <BthwaniSurface tone="base" style={styles.address}><BthwaniIcon name="location" color={theme.interactiveText} size={sizing.iconMd} /><Text style={styles.muted}>{order.addressText}</Text></BthwaniSurface>
      <BthwaniSectionHeader title="المنتجات" subtitle={`${order.lines.length} ${order.lines.length === 1 ? "منتج" : "منتجات"}`} />
      <View style={styles.lines}>{order.lines.map((line) => <BthwaniSurface key={line.id} tone="base" style={styles.line}><View style={styles.lineTop}><Text style={styles.lineTitle} numberOfLines={2}>{line.productName}</Text><Text style={styles.linePrice}>{formatMoney(line.lineAmountMinor, line.currency)}</Text></View><Text style={styles.muted}>{formatQuantity(line.baseUnit, line.finalQuantityBaseUnits)}{line.modifierSnapshots.length ? ` · ${line.modifierSnapshots.map((modifier) => modifier.optionNameAr).join("، ")}` : ""}</Text></BthwaniSurface>)}</View>
      <Text style={styles.muted}>تُقرأ حالة الطلب الحالية من الخدمة عند كل فتح.</Text>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background, gap: spacing[4], paddingBottom: spacing[5], width: "100%" },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[10], width: "100%" },
    backButton: { alignItems: "center", flexDirection: "row", gap: spacing[1], minHeight: sizing.controlMd },
    back: { ...typography.body, color: theme.interactiveText },
    summary: { alignItems: "center", borderRadius: radius.xl, flexDirection: "row", gap: spacing[3], padding: spacing[4], ...elevation.raised },
    summaryIcon: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.lg, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    summaryCopy: { flex: 1, gap: spacing[1] },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.titleMd, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    status: { backgroundColor: theme.actionSoft, borderRadius: radius.lg, gap: spacing[1], padding: spacing[4] },
    statusCopy: { flex: 1, gap: spacing[1] },
    statusTitle: { ...typography.caption, color: theme.colorMuted },
    statusValue: { ...typography.titleSm, color: theme.interactiveText },
    statusTotal: { ...typography.bodyStrong, color: theme.color },
    address: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[2], padding: spacing[4] },
    lines: { gap: spacing[3] },
    line: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    lineTop: { alignItems: "flex-start", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
    lineTitle: { ...typography.bodyStrong, color: theme.color, flex: 1 },
    linePrice: { ...typography.bodyStrong, color: theme.interactiveText },
    refreshError: { ...typography.bodySm, color: theme.danger },
  });
}
