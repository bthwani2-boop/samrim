import type { PartnerStoreOperationalAvailabilityResponse } from "@bthwani/dsh";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { readOwnStoreOperationalAvailability } from "./store-readback-client";
import { storeSettingsStatus } from "./partner-store-settings-status";

type ReadState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "error" }>
  | Readonly<{ kind: "ready"; value: PartnerStoreOperationalAvailabilityResponse }>;


/** Store settings surface reads DSH truth; writes remain in the canonical operational editor. */
export function PartnerStoreSettingsOverview({ storeID }: Readonly<{ storeID: string }>) {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [state, setState] = useState<ReadState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useFocusEffect(useCallback(() => {
    // Retry explicitly re-reads DSH state for the same Store.
    void retry;
    let active = true;
    setState({ kind: "loading" });
    void readOwnStoreOperationalAvailability(storeID)
      .then(value => { if (active) setState({ kind: "ready", value }); })
      .catch(() => { if (active) setState({ kind: "error" }); });
    return () => { active = false; };
  }, [storeID, retry]));

  const navigate = (href: Href) => router.push(href);
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>إعدادات تشغيل المتجر</Text>
    {state.kind === "loading" ? <Text style={styles.muted} accessibilityLiveRegion="polite">جارٍ قراءة إعدادات التشغيل...</Text> : null}
    {state.kind === "error" ? <>
      <Text style={styles.error} accessibilityRole="alert">تعذر قراءة إعدادات المتجر. لم تُفترض أي حالة تشغيل.</Text>
      <BthwaniButton label="إعادة المحاولة" variant="secondary" onPress={() => setRetry(value => value + 1)} />
    </> : null}
    {state.kind === "ready" ? <>
      <Text style={styles.value}>{storeSettingsStatus(state.value)}</Text>
      <Text style={styles.muted}>ساعات العمل: {state.value.availability.scheduleMode === "ALWAYS_OPEN" ? "على مدار الساعة" : "جدول أسبوعي"}</Text>
      <Text style={styles.muted}>وقت التجهيز: {state.value.availability.preparationMinutes == null ? "غير محدد" : state.value.availability.preparationMinutes.toLocaleString("ar-YE") + " دقيقة"}</Text>
    </> : null}
    <BthwaniButton label="تعديل ساعات العمل واستقبال الطلبات" variant="secondary"
      onPress={() => navigate({ pathname: "/store", params: { section: "operations", returnTo: "more" } } as Href)} />
    <Text style={styles.metaLabel}>إعدادات مرتبطة</Text>
    <BthwaniButton label="إدارة المنتجات والمخزون" variant="secondary" onPress={() => navigate("/products?filter=stockout" as Href)} />
    <BthwaniButton label="إشعارات المتجر" variant="secondary" onPress={() => navigate("/notifications" as Href)} />
    <Text style={styles.muted}>تُدار وسائل التحصيل والعمولات من الاتفاقية المعتمدة في الأسفل؛ لا تغيّر هذه الشاشة إعدادات الدفع لدى العملاء.</Text>
  </View>;
}
