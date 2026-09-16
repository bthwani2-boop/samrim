import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View, useColorScheme } from "react-native";

import { direction, resolveTextAlign, resolveTheme } from "@bthwani/design-system";

import { isJoiningCaseNotFound, listActiveServiceCities, readOwnJoiningCase } from "./store-readback-client";
import type { ServiceCity } from "@bthwani/dsh";
import { JoiningCaseCorrection } from "./joining-case-correction";
import { StoreOfferManagement } from "../store-offer/store-offer";
import { OrderManagement } from "../order-management/order-management";
import { StoreDeliveryOrigin } from "../location-core/store-delivery-origin";

export function StoreReadback() {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; value: Awaited<ReturnType<typeof readOwnJoiningCase>> }
    | { kind: "empty" }
    | { kind: "error" }
  >({ kind: "loading" });
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);

  useEffect(() => {
    let active = true;
    void readOwnJoiningCase().then(
      (value) => { if (active) setState({ kind: "ready", value }); },
      (error) => { if (active) setState({ kind: isJoiningCaseNotFound(error) ? "empty" : "error" }); },
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    void listActiveServiceCities().then(setCities, () => setCities([]));
  }, []);

  if (state.kind === "loading") return <ActivityIndicator accessibilityLabel="جارٍ قراءة بيانات المتجر" color={theme.actionBackground} />;
  if (state.kind === "empty") return <Text style={styles.muted}>لم يُنشأ المتجر الأول للشريك بعد.</Text>;
  if (state.kind === "error") return <Text accessibilityRole="alert" style={styles.error}>تعذر قراءة بيانات الشريك من المنصة.</Text>;
  const cityName = cities.find((city) => city.id === state.value.case.serviceCityId)?.displayNameAr || "مدينة غير محددة";
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>حالة انضمام الشريك</Text>
      <Text selectable style={styles.value}>{state.value.case.businessName}</Text>
      <Text style={styles.muted}>الحالة: {joiningStateLabel(state.value.case.state)}</Text>
      <Text style={styles.muted}>مدينة المتجر الأول: {cityName}</Text>
      <JoiningCaseCorrection value={state.value} onUpdated={(value) => setState({ kind: "ready", value })} />
      {state.value.case.store ? <><Text selectable style={styles.muted}>المتجر الأول: {state.value.case.store.name}</Text><Text style={styles.muted}>حالة النشر: {publicationStateLabel(state.value.case.store.publicationState)}</Text><Text style={styles.muted}>جاهزية النشر: {state.value.case.store.publicationReadiness.ready ? "جاهز" : "يحتاج إلى استكمال البيانات"}</Text><StoreDeliveryOrigin storeId={state.value.case.store.id} /><StoreOfferManagement storeId={state.value.case.store.id} /><OrderManagement storeId={state.value.case.store.id} /></> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);

  return StyleSheet.create({
    container: { direction: activeDirection, gap: 8, width: "100%" },
    sectionTitle: { color: theme.color, fontSize: 16, fontWeight: "800", textAlign: startTextAlign },
    value: { color: theme.color, fontSize: 15, fontWeight: "700", textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 20, textAlign: startTextAlign },
    error: { backgroundColor: theme.dangerSoft, borderRadius: 10, color: theme.danger, fontSize: 13, padding: 10, textAlign: startTextAlign },
  });
}

function joiningStateLabel(state: "draft" | "submitted" | "needs_correction" | "approved"): string {
  return { draft: "مسودة", submitted: "قيد المراجعة", needs_correction: "يحتاج إلى تصحيح", approved: "تمت الموافقة" }[state];
}

function publicationStateLabel(state: "unpublished" | "published" | "hidden"): string {
  return { unpublished: "غير منشور", published: "منشور", hidden: "مخفي" }[state];
}
