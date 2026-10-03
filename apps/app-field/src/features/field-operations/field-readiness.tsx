import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { fieldAdmissionStateLabel } from "@bthwani/dsh";
import { type Href, Link } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { createFieldOperationStyles } from "./field-operation-styles";
import { useOwnFieldAdmission } from "./use-field-admission";

export function FieldReadiness() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const { state, refresh } = useOwnFieldAdmission();

  return (
    <View style={styles.container} accessibilityLabel="جاهزية الميدان">
      <Text style={styles.title}>جاهزية الميدان</Text>
      <Text style={styles.muted}>تابع حالة تفعيلك، وأضف الشركاء، وأكمل ما يحتاج إلى إجراء منك.</Text>
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {state.kind === "ready" ? <View style={styles.card}><Text style={styles.cardTitle}>حالة التفعيل</Text><BthwaniStatusBadge icon={state.admission.state === "eligible" ? "success" : "warning"} label={fieldAdmissionStateLabel(state.admission.state)} tone={state.admission.state === "eligible" ? "success" : "warning"} /><Text style={styles.muted}>{state.admission.state === "eligible" ? "يمكنك بدء ضم شريك جديد الآن." : "تابع الحالة أو تواصل مع فريق التشغيل إذا بقيت غير متاحة."}</Text></View> : null}
      {state.kind === "missing" ? <View style={styles.card} accessibilityLiveRegion="polite"><Text style={styles.cardTitle}>لم يكتمل تفعيل الحساب</Text><Text style={styles.muted}>تواصل مع فريق التشغيل لإكمال تسجيلك للميدان.</Text></View> : null}
      {state.kind === "error" ? <View style={styles.card} accessibilityLiveRegion="polite"><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة حالة تفعيلك الآن. أعد المحاولة عند توفر الاتصال.</Text></View> : null}
      {state.kind === "ready" && state.admission.state === "eligible" ? <View style={styles.summaryCard}><Text style={styles.muted}>يمكنك بدء ضم شريك جديد عند جاهزيتك.</Text><Link href={"/new-case" as Href} asChild><BthwaniButton label="إضافة شريك" variant="secondary" /></Link></View> : null}
      <BthwaniButton label={state.kind === "error" ? "إعادة المحاولة" : "تحديث الحالة"} onPress={() => void refresh()} variant="secondary" />
    </View>
  );
}
