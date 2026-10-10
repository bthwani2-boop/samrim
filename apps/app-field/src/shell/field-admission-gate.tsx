import { spacing } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, Redirect } from "expo-router";
import { type PropsWithChildren, useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { fieldAdmissionActionability } from "../features/field-operations/field-eligibility";
import { createFieldOperationStyles } from "../features/field-operations/field-operation-styles";
import { useOwnFieldAdmission } from "../features/field-operations/use-field-admission";

export function FieldAdmissionGate({ children }: Readonly<PropsWithChildren>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const { state, verification, refresh } = useOwnFieldAdmission();

  if (state.kind === "loading") {
    return <View style={styles.card}><ActivityIndicator accessibilityLabel="جارٍ التحقق من أهلية الميداني" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ التحقق من أهلية الوصول…</Text></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>تعذر التحقق من أهلية الميداني، لذلك بقيت هذه المساحة مغلقة مؤقتًا.</Text><BthwaniButton label="إعادة التحقق" onPress={() => void refresh()} variant="secondary" /></View>;
  }
  if (state.kind !== "ready" || fieldAdmissionActionability(state.admission) !== "available") {
    return <Redirect href={"/home" as Href} />;
  }
  const verified = verification === "verified";
  return (
    <View style={{ flexGrow: 1 }}>
      <View
        accessibilityElementsHidden={!verified}
        importantForAccessibility={verified ? "auto" : "no-hide-descendants"}
        pointerEvents={verified ? "auto" : "none"}
        style={{ flexGrow: 1, opacity: verified ? 1 : 0 }}
      >
        {children}
      </View>
      {!verified ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, padding: spacing[5] }]}>
          <View style={styles.card}>
            {verification === "checking" ? (
              <><ActivityIndicator accessibilityLabel="جارٍ إعادة التحقق من أهلية الميداني" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ إعادة التحقق من أهلية الميدان…</Text></>
            ) : (
              <><Text accessibilityRole="alert" style={styles.error}>تعذر تحديث الأهلية. احتفظنا بالبيانات غير المحفوظة، لكن العمليات متوقفة حتى نجاح التحقق.</Text><BthwaniButton label="إعادة التحقق" onPress={() => void refresh()} variant="secondary" /></>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}
