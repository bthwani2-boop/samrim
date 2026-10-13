import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CaptainAdmission, captainAdmissionStateLabel, captainAvailabilityStateLabel } from "@bthwani/dsh";
import { type Href, Link } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

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

  const load = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setAdmission(null);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await captainClient().readOwnCaptainAdmission(token);
      setAdmission(response.admission);
      return true;
    } catch (cause) {
      console.error("DSH Captain admission readback failed", cause);
      setError("تعذر قراءة جاهزية الكابتن. أعد المحاولة.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setAvailability(available: boolean) {
    if (!admission || busy || loading || admission.state !== "eligible" || admission.availabilityState === (available ? "available" : "unavailable")) return;
    setBusy(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await captainClient().setCaptainAvailability(token, available, admission.version);
      if (!(await load())) setError("وصل رد تغيير التوفر، لكن تعذرت قراءة الحالة الجديدة. حدّث الجاهزية قبل إجراء آخر.");
    } catch (cause) {
      console.error("DSH Captain availability failed", cause);
      const verified = await load();
      setError(verified
        ? "لم نتأكد من نتيجة تغيير التوفر. راجع الحالة الجديدة قبل أي محاولة أخرى."
        : "لم نتأكد من نتيجة تغيير التوفر وتعذرت قراءة الجاهزية؛ لن نرسل تغييرًا آخر حتى تنجح إعادة القراءة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="جاهزية الكابتن">
      <Text style={styles.title}>جاهزية الكابتن</Text>
      <Text style={styles.muted}>تحقق من جاهزيتك، حدّد توفرك، ثم انتقل مباشرة إلى المهمة التالية.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading && admission ? <View style={styles.card}>
        <View style={styles.row}><View style={styles.task}><Text style={styles.cardTitle}>قبولك</Text><Text style={styles.muted}>{captainAdmissionStateLabel(admission.state)}</Text></View><View style={styles.task}><Text style={styles.cardTitle}>التوفر</Text><BthwaniStatusBadge icon={admission.availabilityState === "available" ? "success" : "appearance"} label={captainAvailabilityStateLabel(admission.availabilityState)} tone={admission.availabilityState === "available" ? "success" : "neutral"} /></View></View>
        <View style={styles.row}>
          <BthwaniButton busy={busy} disabled={busy || loading || admission.state !== "eligible" || admission.availabilityState === "available"} label="متاح" onPress={() => void setAvailability(true)} style={styles.actionButton} />
          <BthwaniButton busy={busy} disabled={busy || loading || admission.state !== "eligible" || admission.availabilityState === "unavailable"} label="غير متاح" onPress={() => void setAvailability(false)} style={styles.actionButton} variant="secondary" />
        </View>
      </View> : null}
      {!loading ? <View style={styles.summaryCard}><Text style={styles.sectionTitle}>الخطوة التالية</Text><Text style={styles.muted}>افتح العروض أو التوصيلات لمعالجة المهام الحالية.</Text><View style={styles.row}><Link href={"/offers" as Href} asChild><BthwaniButton label="فتح العروض" style={styles.actionButton} variant="secondary" /></Link><Link href={"/deliveries" as Href} asChild><BthwaniButton label="فتح التوصيلات" style={styles.actionButton} variant="secondary" /></Link></View></View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton busy={busy || loading} disabled={busy || loading} label="تحديث الحالة" onPress={() => void load()} variant="secondary" />
    </View>
  );
}
