import { typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type PartnerAccessibleStore, type PartnerScopedFinanceStore } from "@bthwani/dsh";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { createPartnerDshClient } from "../../bootstrap/dsh-client";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { partnerSetupSessionKey } from "./partner-setup-session-scope";

const currentPartnerSessionKey = () => partnerSetupSessionKey(currentIdentityState());

export function PartnerPerformancePeek({ store }: { store: PartnerAccessibleStore | undefined }) {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const styles = useMemo(() => StyleSheet.create({
    root: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, gap: 6 },
    top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    heading: { ...typography.bodyStrong, color: theme.color, fontSize: 13 },
    action: { ...typography.caption, color: theme.brandAction, fontWeight: "800" },
    metrics: { flexDirection: "row", alignItems: "center", gap: 12 },
    metric: { flex: 1, gap: 3 },
    label: { ...typography.caption, color: theme.colorMuted },
    number: { ...typography.bodyStrong, color: theme.color },
  }), [theme]);
  const sessionKey = useSyncExternalStore(subscribeIdentitySession, currentPartnerSessionKey, () => "");
  const scopeKey = JSON.stringify([sessionKey, store?.id]);
  const [data, setData] = useState<PartnerScopedFinanceStore | null>(null);
  const [loadedScope, setLoadedScope] = useState("");

  useFocusEffect(useCallback(() => {
    let active = true;
    setData(null);
    setLoadedScope("");
    const storeID = store?.id;
    const stillCurrent = () => active && Boolean(sessionKey) && currentPartnerSessionKey() === sessionKey;
    if (!sessionKey || !storeID || !store.owned) return () => { active = false; };
    void (async () => {
      const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
      if (!base) return;
      const token = await getUsableIdentityAccessToken();
      if (!stillCurrent()) return;
      const api = createPartnerDshClient();
      const result = await api.readOwnPartnerFinancialSummary(token);
      if (!stillCurrent()) return;
      const summary = result.summary.stores.find(item => item.storeId === storeID);
      if (summary?.attributionComplete) {
        setData(summary);
        setLoadedScope(scopeKey);
      }
    })().catch(() => {
      if (stillCurrent()) {
        setData(null);
        setLoadedScope("");
      }
    });
    return () => { active = false; };
  }, [sessionKey, scopeKey, store?.id, store?.owned]));

  const visibleData = store?.owned && sessionKey && currentPartnerSessionKey() === sessionKey && loadedScope === scopeKey ? data : null;
  if (!visibleData) return null;
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="ملخص مستحقات المتجر، فتح الأداء"
    onPress={() => {
      if (currentPartnerSessionKey() === sessionKey) router.push("/insights?returnTo=more" as Href);
    }}
    style={styles.root}
  >
    <View style={styles.top}><Text style={styles.heading}>ملخص المتجر المالي</Text><Text style={styles.action}>الأداء ←</Text></View>
    <View style={styles.metrics}>
      <View style={styles.metric}><Text style={styles.label}>مستحقات مكتسبة</Text><Text style={styles.number} numberOfLines={1}>{formatMoney(visibleData.earnedMinor, "YER")}</Text></View>
      <View style={styles.metric}><Text style={styles.label}>طلبات مسوّاة</Text><Text style={styles.number}>{visibleData.orderCount.toLocaleString("ar-YE")}</Text></View>
      <BthwaniIcon name="orders" color={theme.colorMuted} size={19} />
    </View>
  </Pressable>;
}
