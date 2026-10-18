import { BthwaniButton, BthwaniMap, useAppearanceTheme } from "@bthwani/design-system/native";
import type { CaptainOpportunityHeatmap } from "@bthwani/dsh";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { createCaptainOperationStyles } from "./captain-operation-styles";
import { isCurrentCaptainActor } from "./captain-session-scope";

const intensityLabel = { LOW: "نشاط منخفض", MEDIUM: "نشاط متوسط", HIGH: "نشاط مرتفع" } as const;

export function CaptainOpportunities() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createCaptainOperationStyles(theme), [theme]);
  const [data, setData] = useState<CaptainOpportunityHeatmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const before = currentIdentityState();
    setLoading(true);
    setData(null);
    setError("");
    if (before.kind !== "authenticated") {
      setLoading(false);
      return;
    }
    const actorID = before.identity.subject.trim();
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await captainClient().readOwnCaptainOpportunities(token);
      const after = currentIdentityState();
      if (sequence !== requestSequence.current || after.kind !== "authenticated" || !isCurrentCaptainActor(actorID, after.identity.subject.trim())) return;
      if (!Array.isArray(result.cells) || !result.cells.every((cell) =>
        Number.isFinite(cell.latitude) && Number.isFinite(cell.longitude) && cell.intensity in intensityLabel
      )) throw new Error("INVALID_OPPORTUNITY_RESPONSE");
      setData(result);
    } catch {
      const after = currentIdentityState();
      if (sequence === requestSequence.current && after.kind === "authenticated" && isCurrentCaptainActor(actorID, after.identity.subject.trim())) {
        setError("تعذر قراءة نشاط المناطق. أعد المحاولة.");
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void refresh();
    return () => { requestSequence.current++; setData(null); };
  }, [refresh]));

  return <View style={styles.container} accessibilityLabel="فرص المناطق">
    <Text style={styles.readinessTitle}>فرص المناطق</Text>
    <Text style={styles.muted}>مؤشر تاريخي مجمّع من طلبات المتاجر خلال الأيام السبعة المكتملة السابقة. لا يعرض مواقع الكباتن أو منازل العملاء، ولا يضمن إسناد طلب.</Text>
    {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة نشاط المناطق…</Text></View> : null}
    {!loading && error ? <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><BthwaniButton label="إعادة المحاولة" variant="secondary" onPress={() => void refresh()} /></View> : null}
    {!loading && data?.sampleStatus === "INSUFFICIENT_DATA" ? <View style={styles.card}><Text style={styles.muted}>البيانات غير كافية لعرض مناطق نشاط آمنة حاليًا. هذا لا يعني عدم وجود طلبات.</Text><BthwaniButton label="تحديث المؤشر" variant="secondary" onPress={() => void refresh()} /></View> : null}
    {!loading && data?.sampleStatus === "AVAILABLE" && data.cells.length ? <View style={styles.card}>
      <Text style={styles.sectionTitle}>مناطق النشاط التقريبية</Text>
      <BthwaniMap accessibilityLabel="خريطة مؤشرات النشاط العامة" markers={data.cells.map((cell, index) => ({
        id: "opportunity-" + index,
        coordinate: { latitude: cell.latitude, longitude: cell.longitude },
        title: intensityLabel[cell.intensity],
      }))} />
      {data.cells.map((cell, index) => <Text key={cell.latitude + ":" + cell.longitude} style={styles.muted}>منطقة {index + 1}: {intensityLabel[cell.intensity]}</Text>)}
      <Text style={styles.muted}>تُعرض مراكز مناطق واسعة وليست مواقع متاجر بعينها.</Text>
      <BthwaniButton label="تحديث المؤشر" variant="secondary" onPress={() => void refresh()} />
    </View> : null}
  </View>;
}
