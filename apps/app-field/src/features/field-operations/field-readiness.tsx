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
      <Text style={styles.muted}>تأكد من أهليتك، أنشئ ملف الانضمام، وتابع ما يحتاج إلى إجراء منك.</Text>
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {state.kind === "ready" ? <View style={styles.card}><Text style={styles.cardTitle}>حالة الأهلية</Text><BthwaniStatusBadge icon={state.admission.state === "eligible" ? "success" : "warning"} label={fieldAdmissionStateLabel(state.admission.state)} tone={state.admission.state === "eligible" ? "success" : "warning"} /><Text style={styles.muted}>{state.admission.state === "eligible" ? "يمكنك بدء ملف انضمام جديد الآن." : "تابع الحالة أو تواصل مع المشغل إذا بقيت غير متاحة."}</Text></View> : null}
      {state.kind === "missing" ? <View style={styles.card} accessibilityLiveRegion="polite"><Text style={styles.cardTitle}>لا توجد أهلية تشغيلية</Text><Text style={styles.muted}>لا يوجد سجل أهلية ميدانية لهذا الحساب في DSH. تواصل مع المشغّل لإكمال إجراءات التسجيل.</Text></View> : null}
      {state.kind === "error" ? <View style={styles.card} accessibilityLiveRegion="polite"><Text accessibilityRole="alert" style={styles.error}>تعذر التحقق من أهلية الميدان. لم نتمكن من قراءة حالتها؛ أعد المحاولة عند توفر الاتصال.</Text></View> : null}
      {state.kind === "ready" && state.admission.state === "eligible" ? <View style={styles.summaryCard}><Text style={styles.muted}>يمكنك بدء ملف انضمام جديد عند جاهزيتك.</Text><Link href={"/new-case" as Href} asChild><BthwaniButton label="فتح ملف جديد" variant="secondary" /></Link></View> : null}
      <BthwaniButton label={state.kind === "error" ? "إعادة المحاولة" : "تحديث الحالة"} onPress={() => void refresh()} variant="secondary" />
    </View>
  );
}
