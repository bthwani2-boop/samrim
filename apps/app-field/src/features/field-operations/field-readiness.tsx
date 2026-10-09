import { sizing } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIconButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, Link, useNavigation } from "expo-router";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { fieldAdmissionActionability } from "./field-eligibility";
import { createFieldOperationStyles } from "./field-operation-styles";
import { useOwnFieldAdmission } from "./use-field-admission";

export function FieldReadiness() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const { state, refresh } = useOwnFieldAdmission();
  const actionability = state.kind === "ready" ? fieldAdmissionActionability(state.admission) : null;
  const navigation = useNavigation();

  useEffect(() => { return () => navigation.setOptions({ headerRight: undefined }); }, [navigation]);
  useEffect(() => {
    navigation.setOptions({ headerRight: () => <BthwaniIconButton disabled={state.kind === "loading"} icon="refresh" label={state.kind === "error" ? "إعادة المحاولة" : "تحديث الحالة"} onPress={() => void refresh()} size={sizing.controlSm} /> });
  }, [navigation, refresh, state.kind]);

  return (
    <View style={[styles.container, { flexGrow: 1, justifyContent: "center" }]} accessibilityLabel="جاهزية الميدان">
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {actionability === "profile_review" ? <Text accessibilityLiveRegion="polite" style={styles.muted}>ملفك يحتاج مراجعة قبل إتاحة وظائف الميدان. تواصل مع فريق التشغيل لاستكمالها.</Text> : null}
      {state.kind === "ready" && actionability === "not_eligible" ? <Text accessibilityLiveRegion="polite" style={styles.muted}>إضافة الشريك غير متاحة الآن؛ راجع أهلية الميدان من صفحة الحساب.</Text> : null}
      {state.kind === "missing" ? <Text style={styles.muted} accessibilityLiveRegion="polite">أكمل ملف الميدان من صفحة الحساب لإضافة شريك.</Text> : null}
      {state.kind === "error" ? <View style={styles.card} accessibilityLiveRegion="polite"><Text accessibilityRole="alert" style={styles.error}>تعذر التحقق من أهلية حسابك الميداني الآن. أعد المحاولة لاحقًا.</Text></View> : null}
      {actionability === "available" ? <Link href={"/new-case" as Href} asChild><BthwaniButton label="إضافة شريك" variant="primary" /></Link> : null}
    </View>
  );
}
