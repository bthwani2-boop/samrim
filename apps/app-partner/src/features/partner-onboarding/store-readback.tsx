import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View, useColorScheme } from "react-native";

import { resolveTheme } from "@bthwani/design-system";

import { isJoiningCaseNotFound, listActiveServiceCities, readOwnJoiningCase } from "./store-readback-client";
import type { ServiceCity } from "@bthwani/dsh";
import { JoiningCaseCorrection } from "./joining-case-correction";
import { StoreAssortmentManagement } from "../store-assortment/store-assortment";
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
  if (state.kind === "error") return <Text accessibilityRole="alert" style={styles.error}>تعذر قراءة بيانات الشريك من DSH.</Text>;
  const cityName = cities.find((city) => city.id === state.value.case.serviceCityId)?.displayNameAr || state.value.case.serviceCityId;
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>حالة انضمام الشريك</Text>
      <Text selectable style={styles.value}>{state.value.case.businessName}</Text>
      <Text style={styles.muted}>الحالة: {state.value.case.state}</Text>
      <Text style={styles.muted}>مدينة المتجر الأول: {cityName}</Text>
      <JoiningCaseCorrection value={state.value} onUpdated={(value) => setState({ kind: "ready", value })} />
      {state.value.case.store ? <><Text selectable style={styles.muted}>المتجر الأول: {state.value.case.store.name}</Text><Text style={styles.muted}>حالة النشر: {state.value.case.store.publicationState}</Text><Text style={styles.muted}>جاهزية النشر: {state.value.case.store.publicationReadiness.ready ? "جاهز" : "محجوب"}</Text><Text style={styles.muted}>الإصدار الكانوني: {state.value.case.store.version}</Text><StoreDeliveryOrigin storeId={state.value.case.store.id} /><StoreAssortmentManagement storeId={state.value.case.store.id} /></> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { direction: "rtl", gap: 8, width: "100%" },
    sectionTitle: { color: theme.structure, fontSize: 16, fontWeight: "800", textAlign: "right" },
    value: { color: theme.structure, fontSize: 15, fontWeight: "700", textAlign: "right" },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 20, textAlign: "right" },
    error: { backgroundColor: theme.dangerSoft, borderRadius: 10, color: theme.danger, fontSize: 13, padding: 10, textAlign: "right" },
  });
}
