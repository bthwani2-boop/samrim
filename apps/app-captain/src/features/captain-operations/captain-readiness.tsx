import { BthwaniButton, BthwaniIconButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { sizing } from "@bthwani/design-system";
import * as Location from "expo-location";
import { publishCaptainPresence } from "./captain-presence-publisher";
import { type CaptainAdmission, captainAdmissionStateLabel, captainAvailabilityStateLabel } from "@bthwani/dsh";
import { type Href, Link, useFocusEffect } from "expo-router";
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
  const [activityCounts, setActivityCounts] = useState<{ offers: number | null; deliveries: number | null }>({ offers: null, deliveries: null });

  const load = useCallback(async (): Promise<boolean> => {
    const sequence = ++readSequence.current;
    const session = currentIdentityState();
    const actorID = session.kind === "authenticated" ? session.identity.subject.trim() : "";
    setLoading(true);
    setAdmission(null);
    setLoadedActorID("");
    setActivityCounts({ offers: null, deliveries: null });
    setError("");
    if (!actorID) {
      setLoading(false);
      setError("سجّل الدخول لقراءة جاهزية الكابتن.");
      return false;
    }
    try {
      const token = await getUsableIdentityAccessToken();
      const api = captainClient();
      const response = await api.readOwnCaptainAdmission(token);
      const current = currentIdentityState();
      if (sequence !== readSequence.current || current.kind !== "authenticated" || !isCurrentCaptainActor(actorID, current.identity.subject.trim())) return false;
      setAdmission(response.admission);
      setLoadedActorID(actorID);
      // Summary counts are optional; a full bounded list cannot establish an exact total.
      void Promise.allSettled([api.listOwnCaptainOffers(token), api.listOwnCaptainAssignments(token)]).then(([offersResult, assignmentsResult]) => {
        const latest = currentIdentityState();
        if (sequence !== readSequence.current || latest.kind !== "authenticated" || !isCurrentCaptainActor(actorID, latest.identity.subject.trim())) return;
        setActivityCounts({
          offers: offersResult.status === "fulfilled" && offersResult.value.offers.length < 50
            ? offersResult.value.offers.filter((offer) => offer.state === "offered" && Date.parse(offer.expiresAt) > Date.now()).length : null,
          deliveries: assignmentsResult.status === "fulfilled" && assignmentsResult.value.assignments.length < 50
            ? assignmentsResult.value.assignments.filter((assignment) => assignment.state === "assigned" || assignment.state === "in_custody").length : null,
        });
      });
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
  useFocusEffect(useCallback(() => {
    if (!activeActorID) {
      readSequence.current += 1;
      setAdmission(null);
      setLoadedActorID("");
      setActivityCounts({ offers: null, deliveries: null });
      setLoading(false);
    } else {
      void load();
    }
    return () => { readSequence.current += 1; };
  }, [activeActorID, load]));
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

  const eligible = currentAdmission?.state === "eligible";
  const available = currentAdmission?.availabilityState === "available";
  const offersLabel = activityCounts.offers === null ? "العروض" : "العروض (" + activityCounts.offers + ")";
  const deliveriesLabel = activityCounts.deliveries === null ? "التوصيلات" : "التوصيلات (" + activityCounts.deliveries + ")";
  const highlightDeliveries = (activityCounts.deliveries ?? 0) > 0;
  const highlightOffers = !highlightDeliveries && (activityCounts.offers ?? 0) > 0;

  return (
    <View style={styles.container} accessibilityLabel="جاهزية الكابتن">
      <View style={styles.readinessPageHeading}>
        <Text style={styles.readinessTitle}>الجاهزية</Text>
        <BthwaniIconButton icon="refresh" label="تحديث الجاهزية والعروض والتوصيلات" disabled={busy || loading} onPress={() => void load()} size={sizing.controlSm} tone="soft" />
      </View>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ تحديث الحالة…</Text></View> : null}
      {!loading && currentAdmission ? <View style={styles.readinessHero}>
        <View style={styles.readinessHeroHeader}>
          <View style={styles.readinessHeroCopy}>
            <Text style={styles.readinessEyebrow}>حالة العمل</Text>
            <Text style={styles.readinessStatus}>{captainAvailabilityStateLabel(currentAdmission.availabilityState)}</Text>
          </View>
          <BthwaniStatusBadge icon={eligible ? "success" : "warning"} label={captainAdmissionStateLabel(currentAdmission.state)} tone={eligible ? "success" : "warning"} />
        </View>
        {eligible ? <BthwaniButton
          busy={busy}
          disabled={busy || loading}
          label={available ? "إيقاف استقبال العروض" : "بدء استقبال العروض"}
          onPress={() => void setAvailability(!available)}
          variant={available ? "secondary" : "primary"}
        /> : <Text style={styles.muted}>تغيير التوفر متاح بعد اعتماد الكابتن.</Text>}
      </View> : null}
      {!loading && currentAdmission ? <View style={styles.readinessActions}>
        <Text style={styles.sectionTitle}>العمل الآن</Text>
        <View style={styles.row}>
          <Link href={"/offers" as Href} asChild><BthwaniButton label={offersLabel} style={styles.actionButton} variant={highlightOffers ? "primary" : "secondary"} /></Link>
          <Link href={"/deliveries" as Href} asChild><BthwaniButton label={deliveriesLabel} style={styles.actionButton} variant={highlightDeliveries ? "primary" : "secondary"} /></Link>
        </View>
      </View> : null}
      {error ? <View style={styles.readinessError}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><BthwaniButton disabled={busy || loading} label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /></View> : null}
    </View>
  );
}
