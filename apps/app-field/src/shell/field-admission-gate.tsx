import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, Redirect } from "expo-router";
import { type PropsWithChildren, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { createFieldOperationStyles } from "../features/field-operations/field-operation-styles";
import { useOwnFieldAdmission } from "../features/field-operations/use-field-admission";

export function FieldAdmissionGate({ children }: Readonly<PropsWithChildren>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const { state, refresh } = useOwnFieldAdmission();

  if (state.kind === "loading") {
    return <View style={styles.card}><ActivityIndicator accessibilityLabel="جارٍ التحقق من أهلية الميداني" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ التحقق من أهلية الوصول…</Text></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>تعذر التحقق من أهلية الميداني، لذلك بقيت هذه المساحة مغلقة مؤقتًا.</Text><BthwaniButton label="إعادة التحقق" onPress={() => void refresh()} variant="secondary" /></View>;
  }
  if (state.kind !== "ready" || state.admission.state !== "eligible") {
    return <Redirect href={"/home" as Href} />;
  }
  return <>{children}</>;
}
