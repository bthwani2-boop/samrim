import { Link, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, useColorScheme, View } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import { fieldAdmissionStateLabel, type FieldAdmission } from "@bthwani/dsh";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "./field-client";
import { createFieldOperationStyles } from "./field-operation-styles";

export function FieldReadiness() {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
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
      <Text style={styles.muted}>القبول وملفات الانضمام مملوكة لـ DSH، ولا يملك الميدان نشر المتجر أو مراجعته.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading && admission ? <View style={styles.card}><Text style={styles.cardTitle}>قبول الميدان</Text><Text style={styles.muted}>الحالة: {fieldAdmissionStateLabel(admission.state)}</Text></View> : null}
      {!loading && !admission ? <View style={styles.card} accessibilityLiveRegion="polite"><Text style={styles.cardTitle}>لا توجد أهلية تشغيلية</Text><Text style={styles.muted}>لم تصل أهلية الميدان من DSH. أعد المحاولة أو تواصل مع المشغل.</Text></View> : null}
      {!loading && admission?.state === "eligible" ? <View style={styles.summaryCard}><Text style={styles.muted}>يمكنك فتح ملف انضمام جديد من المسار المخصص.</Text><Link href={"/new-case" as Href} asChild><Pressable accessibilityRole="button" style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>فتح ملف جديد</Text></Pressable></Link></View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>تحديث الحالة</Text></Pressable>
    </View>
  );
}
