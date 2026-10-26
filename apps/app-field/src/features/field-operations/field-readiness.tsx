import { spacing } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import * as Crypto from "expo-crypto";
import { type Href, useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { fieldAdmissionActionability } from "./field-eligibility";
import { createFieldOperationStyles } from "./field-operation-styles";
import { useOwnFieldAdmission } from "./use-field-admission";

export function FieldReadiness() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const { state, verification, refresh } = useOwnFieldAdmission();
  const actionability = state.kind === "ready" ? fieldAdmissionActionability(state.admission) : null;
  const router = useRouter();

  return (
    <View style={[styles.container, { paddingTop: spacing[3] }]} accessibilityLabel="جاهزية الميدان">
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {state.kind === "ready" && verification === "checking" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ تحديث أهلية الميدان…</Text></View> : null}
      {state.kind === "ready" && verification === "failed" ? <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>تعذر تحديث الأهلية. أعد التحقق قبل استخدام وظائف الميدان.</Text><BthwaniButton label="إعادة التحقق" onPress={() => void refresh()} variant="secondary" /></View> : null}
      {verification === "verified" && actionability === "profile_review" ? <Text accessibilityLiveRegion="polite" style={styles.muted}>ملفك يحتاج مراجعة قبل إتاحة وظائف الميدان. تواصل مع فريق التشغيل لاستكمالها.</Text> : null}
      {verification === "verified" && actionability === "not_eligible" ? <Text accessibilityLiveRegion="polite" style={styles.muted}>إضافة الشريك غير متاحة الآن؛ راجع أهلية الميدان من صفحة الحساب.</Text> : null}
      {state.kind === "missing" ? <Text style={styles.muted} accessibilityLiveRegion="polite">أكمل ملف الميدان من صفحة الحساب لإضافة شريك.</Text> : null}
      {state.kind === "error" ? <View style={styles.compactCard} accessibilityLiveRegion="polite"><Text accessibilityRole="alert" style={styles.error}>تعذر التحقق من أهلية حسابك الميداني الآن.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void refresh()} variant="secondary" /></View> : null}
      {verification === "verified" && actionability === "available" ? <View style={{ gap: spacing[3] }}><Text style={styles.muted}>حسابك جاهز لإضافة شركاء جدد.</Text><BthwaniButton label="إضافة شريك" variant="primary" onPress={() => router.navigate({ pathname: "/new-case", params: { fresh: Crypto.randomUUID() } } as Href)} /></View> : null}
    </View>
  );
}
