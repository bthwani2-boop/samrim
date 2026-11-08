import type { PartnerStoreOperationalAvailabilityResponse } from "@bthwani/dsh";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";

import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { partnerSetupSessionKey } from "./partner-setup-session-scope";
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
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const sessionKey = partnerSetupSessionKey(identityState);
  const sessionScope = useRef(sessionKey);
  const requestGeneration = useRef(0);

  useEffect(() => subscribeIdentitySession(next => {
    const nextScope = partnerSetupSessionKey(next);
    if (nextScope === sessionScope.current) return;
    sessionScope.current = nextScope;
    requestGeneration.current += 1;
    setIdentityState(next);
    setState({ kind: "loading" });
    setRetry(value => value + 1);
  }), []);

  useFocusEffect(useCallback(() => {
    // Retry explicitly re-reads DSH state for the same Store and Identity session.
    void retry;
    void sessionKey;
    let active = true;
    const generation = ++requestGeneration.current;
    const scope = partnerSetupSessionKey(currentIdentityState());
    const stillCurrent = () => active && generation === requestGeneration.current &&
      scope !== "" && scope === partnerSetupSessionKey(currentIdentityState());
    setState({ kind: "loading" });
    if (!scope) {
      setState({ kind: "error" });
    } else {
      void readOwnStoreOperationalAvailability(storeID)
        .then(value => {
          if (!stillCurrent()) return;
          const validStoreScope = value?.availability?.storeId === storeID &&
            Array.isArray(value.orderabilityByMode) &&
            value.orderabilityByMode.every(mode => mode?.storeId === storeID);
          if (!validStoreScope) { setState({ kind: "error" }); return; }
          setState({ kind: "ready", value });
        })
        .catch(() => { if (stillCurrent()) setState({ kind: "error" }); });
    }
    return () => {
      active = false;
      if (requestGeneration.current === generation) requestGeneration.current += 1;
    };
  }, [storeID, retry, sessionKey]));

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
    <BthwaniButton label="الاتفاقية التجارية" variant="secondary"
      onPress={() => navigate({ pathname: "/store", params: { section: "commercial", returnTo: "more" } } as Href)} />
    <Text style={styles.muted}>تُراجع العمولة أو رسوم الاشتراك في الاتفاقية التجارية المصرّح بها. لا تغيّر هذه الصفحة مدفوعات العملاء أو شروط المتجر.</Text>
  </View>;
}
