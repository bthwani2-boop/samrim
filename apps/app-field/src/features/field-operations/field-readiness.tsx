import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type FieldAdmission, fieldAdmissionStateLabel } from "@bthwani/dsh";
import { type Href, Link } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient, isMissingFieldAdmission } from "./field-client";
import { createFieldOperationStyles } from "./field-operation-styles";

export function FieldReadiness() {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const [admission, setAdmission] = useState<FieldAdmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().readOwnFieldAdmission(token);
      setAdmission(response.admission);
    } catch (cause) {
      if (isMissingFieldAdmission(cause)) {
        setAdmission(null);
        return;
      }
      console.error("DSH Field admission readback failed", cause);
      setError("تعذر قراءة قبول الميدان. أعد المحاولة.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <View style={styles.container} accessibilityLabel="جاهزية الميدان">
      <Text style={styles.title}>جاهزية الميدان</Text>
      <Text style={styles.muted}>تأكد من أهليتك، أنشئ ملف الانضمام، وتابع ما يحتاج إلى إجراء منك.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading && admission ? <View style={styles.card}><Text style={styles.cardTitle}>حالة الأهلية</Text><BthwaniStatusBadge icon={admission.state === "eligible" ? "success" : "warning"} label={fieldAdmissionStateLabel(admission.state)} tone={admission.state === "eligible" ? "success" : "warning"} /><Text style={styles.muted}>{admission.state === "eligible" ? "يمكنك بدء ملف انضمام جديد الآن." : "تابع الحالة أو تواصل مع المشغل إذا بقيت غير متاحة."}</Text></View> : null}
      {!loading && !admission ? <View style={styles.card} accessibilityLiveRegion="polite"><Text style={styles.cardTitle}>لا توجد أهلية تشغيلية</Text><Text style={styles.muted}>لم تصل حالة الأهلية بعد. أعد المحاولة أو تواصل مع المشغل.</Text></View> : null}
      {!loading && admission?.state === "eligible" ? <View style={styles.summaryCard}><Text style={styles.muted}>يمكنك بدء ملف انضمام جديد عند جاهزيتك.</Text><Link href={"/new-case" as Href} asChild><BthwaniButton label="فتح ملف جديد" variant="secondary" /></Link></View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton label="تحديث الحالة" onPress={() => void load()} variant="secondary" />
    </View>
  );
}
