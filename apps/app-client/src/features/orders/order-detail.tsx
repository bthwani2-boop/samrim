import { borders, direction, radius, resolveTextAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, formatOrderDate, formatQuantity, type Order, orderStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

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
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; order: Order } | { kind: "error" }>({ kind: "loading" });

  const load = useCallback(async () => {
    if (!orderId.trim()) { setState({ kind: "error" }); return; }
    setState({ kind: "loading" });
    try {
      const token = await getUsableIdentityAccessToken();
      setState({ kind: "ready", order: (await client().readOrder(token, orderId)).order });
    } catch (error) {
      console.error("DSH client order detail read failed", error);
      setState({ kind: "error" });
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  if (state.kind === "loading") return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة تفاصيل الطلب" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة تفاصيل الطلب…</Text></View>;
  if (state.kind === "error") return <View style={styles.state}><Text style={styles.title}>تعذر قراءة تفاصيل الطلب</Text><Text style={styles.muted}>قد تكون الجلسة أو الطلب غير متاحين الآن.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>إعادة المحاولة</Text></Pressable><Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>العودة إلى الطلبات</Text></Pressable></View>;

  const { order } = state;
  return <View style={styles.container} accessibilityLabel="تفاصيل الطلب"><Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={styles.back}>طلباتي</Text></Pressable><Text style={styles.eyebrow}>تفاصيل الطلب</Text><Text style={styles.title}>طلب بتاريخ {formatOrderDate(order.createdAt)}</Text><View style={styles.status}><Text style={styles.statusTitle}>الحالة الحالية</Text><Text style={styles.statusValue}>{orderStateLabel(order.state)}</Text><Text style={styles.muted}>الإجمالي: {formatMoney(order.totalAmountMinor, order.currency)}</Text></View><Text style={styles.sectionTitle}>العنوان</Text><Text style={styles.muted}>{order.addressText}</Text><Text style={styles.sectionTitle}>المنتجات</Text><View style={styles.lines}>{order.lines.map((line) => <View key={line.id} style={styles.line}><Text style={styles.lineTitle}>{line.productName}</Text><Text style={styles.muted}>{formatQuantity(line.baseUnit, line.finalQuantityBaseUnits)} · {formatMoney(line.lineAmountMinor, line.currency)}</Text></View>)}</View><Text style={styles.muted}>تُقرأ الحالة الحالية من DSH عند كل فتح؛ أعد المحاولة عند تعذر القراءة.</Text></View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, direction: activeDirection, gap: spacing[3], marginTop: spacing[4], padding: spacing[3], width: "100%" },
    state: { alignItems: "center", direction: activeDirection, gap: spacing[3], paddingVertical: spacing[8], width: "100%" },
    eyebrow: { ...typography.label, color: theme.interactiveText, textAlign: startTextAlign },
    title: { ...typography.titleMd, color: theme.color, textAlign: startTextAlign },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    back: { ...typography.bodySm, color: theme.interactiveText, textAlign: startTextAlign },
    status: { backgroundColor: theme.actionSoft, borderRadius: radius.sm, gap: spacing[1], padding: spacing[3] },
    statusTitle: { ...typography.label, color: theme.colorMuted, textAlign: startTextAlign },
    statusValue: { ...typography.titleSm, color: theme.interactiveText, textAlign: startTextAlign },
    sectionTitle: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    lines: { gap: spacing[2] },
    line: { borderColor: theme.borderColor, borderTopWidth: borders.hairline, gap: spacing[1], paddingTop: spacing[2] },
    lineTitle: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.md, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    buttonText: { ...typography.bodyStrong, color: theme.onAction },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    secondaryButtonText: { ...typography.bodyStrong, color: theme.color },
  });
}
