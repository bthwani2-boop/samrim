import { typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, type OrderRating, type StoreOrderRatingSummary } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";

const PAGE_SIZE = 20;
function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("ar-YE", { timeZone: "Asia/Aden", dateStyle: "medium" });
}

export function PartnerStoreRatings({ storeId }: Readonly<{ storeId: string }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    page: { gap: 12 },
    box: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
    title: { ...typography.titleMd, color: theme.color, fontWeight: "800" },
    heading: { ...typography.bodyStrong, color: theme.color },
    review: { ...typography.bodySm, color: theme.color },
    muted: { ...typography.caption, color: theme.colorMuted },
    error: { ...typography.bodySm, color: theme.danger },
    actions: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
    action: { backgroundColor: theme.actionSoft, borderRadius: 10, minHeight: 44, paddingHorizontal: 15, justifyContent: "center" },
    actionText: { ...typography.bodySm, fontWeight: "700", color: theme.interactiveText },
  }), [theme]);
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const activeActor = identityState.kind === "authenticated" ? identityState.identity.subject : "";
  const [loadedActor, setLoadedActor] = useState("");
  useEffect(() => subscribeIdentitySession(setIdentityState), []);
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<ReadonlyArray<string>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [ratings, setRatings] = useState<ReadonlyArray<OrderRating>>([]);
  const [summary, setSummary] = useState<StoreOrderRatingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    // Account and Store scope changes invalidate pagination and previous data.
    void activeActor;
    void storeId;
    setCursor(""); setHistory([]); setLoadedActor("");
  }, [activeActor, storeId]);

  useFocusEffect(useCallback(() => {
    let active = true;
    void retry;
    setRatings([]); setSummary(null); setLoadedActor(""); setNextCursor(""); setError(""); setLoading(true);
    const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
    const actor = activeActor;
    const valid = () => {
      const current = currentIdentityState();
      return active && Boolean(actor) && current.kind === "authenticated" && current.identity.subject === actor;
    };
    void (async () => {
      if (!base || !actor) throw new Error("PARTNER_SESSION_REQUIRED");
      const token = await getUsableIdentityAccessToken();
      if (!valid()) return;
      const api = createDshMobileClient(base, { cryptoRandomUUID: () => Crypto.randomUUID() });
      const response = await api.listPartnerStoreOrderRatings(token, storeId, PAGE_SIZE, cursor);
      if (!valid()) return;
      const stats = response.summary;
      if (!Array.isArray(response.ratings) || response.ratings.some(item => item.storeId !== storeId) ||
        !stats || !Number.isSafeInteger(stats.totalRatings) || stats.totalRatings < 0 ||
        !Number.isFinite(stats.averageRating) || stats.averageRating < 0 || stats.averageRating > 5 ||
        [stats.oneStar, stats.twoStars, stats.threeStars, stats.fourStars, stats.fiveStars].some(value => !Number.isSafeInteger(value) || value < 0) ||
        stats.oneStar + stats.twoStars + stats.threeStars + stats.fourStars + stats.fiveStars !== stats.totalRatings) {
        throw new Error("RATINGS_SCOPE_OR_SUMMARY_MISMATCH");
      }
      setRatings(response.ratings);
      setSummary(stats);
      setLoadedActor(actor);
      setNextCursor(response.nextCursor ?? "");
    })().catch(() => {
      if (valid()) setError("تعذرت قراءة تقييمات الطلبات. تحقق من الاتصال والصلاحيات ثم أعد المحاولة.");
    }).finally(() => { if (valid()) setLoading(false); });
    return () => { active = false; };
  }, [storeId, cursor, retry, activeActor]));
  const current = Boolean(activeActor) && loadedActor === activeActor;
  const visibleRatings = current ? ratings : [];
  const visibleSummary = current ? summary : null;

  return <View style={styles.page} accessibilityLabel="تقييمات طلبات المتجر">
    <Text style={styles.title}>تقييمات الطلبات المكتملة</Text>
    <Text style={styles.muted}>ملاحظات العملاء بعد اكتمال الطلب دون إظهار حساب العميل أو رقم التواصل المحفوظ. إجماليات النجوم محسوبة من كافة تقييمات هذا المتجر، لا من الصفحة الحالية.</Text>
    {visibleSummary && !loading && !error ? <View style={styles.box} accessibilityLabel="ملخص جميع تقييمات المتجر">
      <Text style={styles.title}>{visibleSummary.totalRatings ? visibleSummary.averageRating.toFixed(1) + " من 5" : "لا توجد تقييمات بعد"}</Text>
      <Text style={styles.muted}>{visibleSummary.totalRatings.toLocaleString("ar-YE")} تقييمًا من طلبات مكتملة</Text>
      {([5, 4, 3, 2, 1] as const).map(stars => <View key={stars} style={styles.actions}>
        <Text style={styles.review}>{stars} نجوم</Text>
        <Text style={styles.muted}>{(stars === 5 ? visibleSummary.fiveStars : stars === 4 ? visibleSummary.fourStars : stars === 3 ? visibleSummary.threeStars : stars === 2 ? visibleSummary.twoStars : visibleSummary.oneStar).toLocaleString("ar-YE")} تقييم</Text>
      </View>)}
    </View> : null}
    {!activeActor ? <Text style={styles.error}>يلزم تسجيل الدخول لقراءة التقييمات.</Text> : null}
    {activeActor && (loading || !current && !error) ? <ActivityIndicator accessibilityLabel="جارٍ تحميل التقييمات" color={theme.brandAction}/> : null}
    {activeActor && error ? <View style={styles.box}>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="إعادة قراءة التقييمات" onPress={() => setRetry(v => v + 1)} style={styles.action}><Text style={styles.actionText}>إعادة المحاولة</Text></Pressable>
    </View> : null}
    {current && !loading && !error && visibleRatings.length === 0 ? <View style={styles.box}><Text style={styles.muted}>لا توجد تقييمات مكتملة في هذه الصفحة.</Text></View> : null}
    {current && !loading && !error ? visibleRatings.map(rating => <View key={rating.orderId} style={styles.box}>
      <Text style={styles.heading} accessibilityLabel={`التقييم ${rating.rating} من 5`}>{rating.rating} / 5 ★</Text>
      <Text style={styles.review}>{rating.review.trim() || "تقييم دون تعليق"}</Text>
      <Text style={styles.muted}>{dateLabel(rating.createdAt)}</Text>
    </View>) : null}
    {current && !loading && !error && (nextCursor || history.length > 0) ? <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel="صفحة التقييمات السابقة" disabled={!history.length} style={[styles.action, !history.length && {opacity:0.4}]} onPress={() => {
        setCursor(history[history.length - 1] ?? ""); setHistory(h => h.slice(0, -1));
      }}><Text style={styles.actionText}>السابق</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="صفحة التقييمات التالية" disabled={!nextCursor} style={[styles.action, !nextCursor && {opacity:0.4}]} onPress={() => {
        setHistory(h => [...h, cursor]); setCursor(nextCursor);
      }}><Text style={styles.actionText}>التالي</Text></Pressable>
    </View> : null}
  </View>;
}
