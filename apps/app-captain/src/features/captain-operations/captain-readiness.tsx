import { Link, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useAppearanceTheme } from "@bthwani/design-system/native";

import { captainAdmissionStateLabel, captainAvailabilityStateLabel, type CaptainAdmission } from "@bthwani/dsh";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { createCaptainOperationStyles } from "./captain-operation-styles";

export function CaptainReadiness() {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createCaptainOperationStyles(theme), [theme]);
  const [admission, setAdmission] = useState<CaptainAdmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await captainClient().readOwnCaptainAdmission(token);
      setAdmission(response.admission);
    } catch (cause) {
      console.error("DSH Captain admission readback failed", cause);
      setError("تعذر قراءة جاهزية الكابتن. أعد المحاولة.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setAvailability(available: boolean) {
    if (!admission || busy) return;
    setBusy(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await captainClient().setCaptainAvailability(token, available, admission.version);
      await load();
    } catch (cause) {
      console.error("DSH Captain availability failed", cause);
      setError("تعذر تحديث التوفر. أعد القراءة لتأكيد النسخة الحالية.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="جاهزية الكابتن">
      <Text style={styles.title}>جاهزية الكابتن</Text>
      <Text style={styles.muted}>حالة القبول والتوفر تُقرأ من DSH بعد تحقق جلسة الكابتن.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading && admission ? <View style={styles.card}>
        <Text style={styles.cardTitle}>الحالة التشغيلية</Text>
        <Text style={styles.muted}>القبول: {captainAdmissionStateLabel(admission.state)} · التوفر: {captainAvailabilityStateLabel(admission.availabilityState)}</Text>
        <View style={styles.row}>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || admission.state !== "eligible" }} disabled={busy || admission.state !== "eligible"} onPress={() => void setAvailability(true)} style={[styles.button, busy && styles.disabledButton]}><Text style={styles.buttonText}>{busy ? "جارٍ الحفظ…" : "متاح"}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || admission.state !== "eligible" }} disabled={busy || admission.state !== "eligible"} onPress={() => void setAvailability(false)} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>غير متاح</Text></Pressable>
        </View>
      </View> : null}
      {!loading ? <View style={styles.summaryCard}><Text style={styles.sectionTitle}>الخطوة التالية</Text><Text style={styles.muted}>افتح العروض أو التوصيلات لمعالجة المهام الحالية.</Text><View style={styles.row}><Link href={"/offers" as Href} asChild><Pressable accessibilityRole="button" style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>فتح العروض</Text></Pressable></Link><Link href={"/deliveries" as Href} asChild><Pressable accessibilityRole="button" style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>فتح التوصيلات</Text></Pressable></Link></View></View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void load()} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>تحديث الحالة</Text></Pressable>
    </View>
  );
}
