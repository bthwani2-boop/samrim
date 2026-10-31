import { typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, type StoreContentPerformanceSummary } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";

export function PartnerStoreMarketingSummary({ storeId }: Readonly<{ storeId: string }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    panel: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 14, padding: 16, gap: 10 },
    heading: { ...typography.bodyStrong, color: theme.color, fontWeight: "800" },
    cards: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
    card: { backgroundColor: theme.surfaceInset, padding: 13, borderRadius: 11, minWidth: 125, flexGrow: 1, gap: 5 },
    value: { ...typography.titleMd, color: theme.color, fontWeight: "800" },
    muted: { ...typography.caption, color: theme.colorMuted },
    error: { ...typography.bodySm, color: theme.danger },
    action: { backgroundColor: theme.actionSoft, padding: 12, borderRadius: 10, alignSelf: "flex-start" },
  }), [theme]);
  const [identityState, setIdentityState] = useState(currentIdentityState);
  useEffect(() => subscribeIdentitySession(setIdentityState), []);
  const activeActor = identityState.kind === "authenticated" ? identityState.identity.subject : "";
  const [loadedScope, setLoadedScope] = useState("");
  const [summary, setSummary] = useState<StoreContentPerformanceSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useFocusEffect(useCallback(() => {
    void retry;
    let active = true;
    setSummary(null); setLoadedScope(""); setError(""); setLoading(true);
    const actorId = activeActor;
    const valid = () => {
      const now = currentIdentityState();
      return active && Boolean(actorId) && now.kind === "authenticated" && now.identity.subject === actorId;
    };
    void (async () => {
      const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
      if (!base || !actorId) throw new Error("MARKETING_SESSION_REQUIRED");
      const token = await getUsableIdentityAccessToken();
      if (!valid()) return;
      const api = createDshMobileClient(base, { cryptoRandomUUID: () => Crypto.randomUUID() });
      const result = await api.readPartnerStoreContentPerformanceSummary(token, storeId);
      if (!valid()) return;
      if (!result || result.storeId !== storeId ||
        [result.contentCount, result.impressions, result.clicks, result.attributedOrdersCreated]
          .some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("MARKETING_SUMMARY_SCOPE_MISMATCH");
      setSummary(result);
      setLoadedScope(actorId + "|" + storeId);
    })().catch(() => { if (valid()) setError("تعذرت قراءة تحليلات مقاطع هذا المتجر. تحقق من الصلاحية والاتصال ثم أعد المحاولة."); })
      .finally(() => { if (valid()) setLoading(false); });
    return () => { active = false; };
  }, [storeId, retry, activeActor]));
  const visibleSummary = activeActor && loadedScope === activeActor + "|" + storeId ? summary : null;

  return <View style={styles.panel} accessibilityLabel="ملخص أداء مقاطع المتجر">
    <Text accessibilityRole="header" style={styles.heading}>أداء مقاطع المتجر</Text>
    <Text style={styles.muted}>أرقام DSH الفعلية لجميع المقاطع التي أنشأها هذا المتجر، بما فيها التاريخية والمتوقفة. أحداث الظهور والنقر ليست عدد أشخاص فريدين.</Text>
    {!activeActor ? <Text style={styles.error}>يلزم تسجيل الدخول لقراءة تحليلات المتجر.</Text> : null}
    {activeActor && loading ? <ActivityIndicator accessibilityLabel="جارٍ تحميل تحليلات التسويق" color={theme.brandAction}/> : null}
    {activeActor && error ? <View style={{ gap: 9 }}><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="إعادة قراءة تحليلات المقاطع" style={styles.action} onPress={() => setRetry(v => v + 1)}>
        <Text style={styles.heading}>إعادة المحاولة</Text>
      </Pressable>
    </View> : null}
    {!loading && !error && visibleSummary ? <View style={styles.cards}>
      {[
        { label: "المقاطع", value: visibleSummary.contentCount },
        { label: "أحداث الظهور", value: visibleSummary.impressions },
        { label: "النقرات", value: visibleSummary.clicks },
        { label: "طلبات منشأة منسوبة", value: visibleSummary.attributedOrdersCreated },
      ].map(item => <View key={item.label} style={styles.card}><Text style={styles.muted}>{item.label}</Text>
        <Text style={styles.value}>{item.value.toLocaleString("ar-YE")}</Text></View>)}
    </View> : null}
    <Text style={styles.muted}>الطلبات المنسوبة تعني إنشاء طلب بعد نقرة مؤهلة، وليس اكتمال البيع أو استحقاقًا ماليًا. تسويات WLT منفصلة.</Text>
  </View>;
}
