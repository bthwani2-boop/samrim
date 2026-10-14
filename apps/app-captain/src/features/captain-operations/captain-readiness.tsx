import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import * as Location from "expo-location";
import { publishCaptainPresence } from "./captain-presence-publisher";
import { type CaptainAdmission, captainAdmissionStateLabel, captainAvailabilityStateLabel } from "@bthwani/dsh";
import { type Href, Link } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { createCaptainOperationStyles } from "./captain-operation-styles";
import { isCurrentCaptainActor } from "./captain-session-scope";

export function CaptainReadiness() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createCaptainOperationStyles(theme), [theme]);
  const [admission, setAdmission] = useState<CaptainAdmission | null>(null);
  const [loadedActorID, setLoadedActorID] = useState("");
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const activeActorID = identityState.kind === "authenticated" ? identityState.identity.subject.trim() : "";
  const readSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<boolean> => {
    const sequence = ++readSequence.current;
    const session = currentIdentityState();
    const actorID = session.kind === "authenticated" ? session.identity.subject.trim() : "";
    setLoading(true);
    setAdmission(null);
    setLoadedActorID("");
    setError("");
    if (!actorID) {
      setLoading(false);
      setError("سجّل الدخول لقراءة جاهزية الكابتن.");
      return false;
    }
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await captainClient().readOwnCaptainAdmission(token);
      const current = currentIdentityState();
      if (sequence !== readSequence.current || current.kind !== "authenticated" || !isCurrentCaptainActor(actorID, current.identity.subject.trim())) return false;
      setAdmission(response.admission);
      setLoadedActorID(actorID);
      return true;
    } catch (cause) {
      console.error("DSH Captain admission readback failed", cause);
      const current = currentIdentityState();
      if (sequence === readSequence.current && current.kind === "authenticated" && isCurrentCaptainActor(actorID, current.identity.subject.trim())) setError("تعذر قراءة جاهزية الكابتن. أعد المحاولة.");
      return false;
    } finally {
      if (sequence === readSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => subscribeIdentitySession(setIdentityState), []);
  useEffect(() => {
    if (!activeActorID) {
      readSequence.current += 1;
      setAdmission(null);
      setLoadedActorID("");
      setLoading(false);
      return;
    }
    void load();
  }, [activeActorID, load]);
  const currentAdmission = isCurrentCaptainActor(loadedActorID, activeActorID) ? admission : null;

  async function setAvailability(available: boolean) {
    if (!currentAdmission || busy || loading || !isCurrentCaptainActor(loadedActorID, activeActorID) || currentAdmission.state !== "eligible" || currentAdmission.availabilityState === (available ? "available" : "unavailable")) return;
    const actorID = loadedActorID;
    setBusy(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const current = currentIdentityState();
      if (current.kind !== "authenticated" || !isCurrentCaptainActor(actorID, current.identity.subject.trim())) return;
      await captainClient().setCaptainAvailability(token, available, currentAdmission.version);
      if (available) {
        try {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (permission.granted) void publishCaptainPresence().catch(() => {});
        } catch { /* Availability remains canonical even if location permission is declined. */ }
      }
      const after = currentIdentityState();
      if (after.kind !== "authenticated" || !isCurrentCaptainActor(actorID, after.identity.subject.trim())) return;
      if (!(await load())) setError("وصل رد تغيير التوفر، لكن تعذرت قراءة الحالة الجديدة. حدّث الجاهزية قبل إجراء آخر.");
    } catch (cause) {
      console.error("DSH Captain availability failed", cause);
      const current = currentIdentityState();
      if (current.kind !== "authenticated" || !isCurrentCaptainActor(actorID, current.identity.subject.trim())) return;
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
      <Text style={styles.readinessTitle}>جاهزية الكابتن</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading && currentAdmission ? <View style={styles.readinessCard}>
        <View style={styles.readinessStatusRow}><View style={styles.readinessItem}><Text style={styles.cardTitle}>قبولك</Text><Text style={styles.muted}>{captainAdmissionStateLabel(currentAdmission.state)}</Text></View><View style={styles.readinessItem}><Text style={styles.cardTitle}>التوفر</Text><BthwaniStatusBadge icon={currentAdmission.availabilityState === "available" ? "success" : "appearance"} label={captainAvailabilityStateLabel(currentAdmission.availabilityState)} tone={currentAdmission.availabilityState === "available" ? "success" : "neutral"} /></View></View>
        <View style={styles.row}>
          <BthwaniButton busy={busy} disabled={busy || loading || currentAdmission.state !== "eligible" || currentAdmission.availabilityState === "available"} label="متاح" onPress={() => void setAvailability(true)} style={styles.actionButton} />
          <BthwaniButton busy={busy} disabled={busy || loading || currentAdmission.state !== "eligible" || currentAdmission.availabilityState === "unavailable"} label="غير متاح" onPress={() => void setAvailability(false)} style={styles.actionButton} variant="secondary" />
        </View>
      </View> : null}
      {!loading ? <View style={styles.nextStepCard}><Text style={styles.sectionTitle}>العمل الآن</Text><View style={styles.row}><Link href={"/offers" as Href} asChild><BthwaniButton label="العروض" style={styles.actionButton} /></Link><Link href={"/deliveries" as Href} asChild><BthwaniButton label="التوصيلات" style={styles.actionButton} variant="secondary" /></Link></View></View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton busy={busy || loading} disabled={busy || loading} label="تحديث الحالة" onPress={() => void load()} variant="secondary" />
    </View>
  );
}
