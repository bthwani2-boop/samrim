import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";

import { direction, resolveRowDirection, resolveTextAlign, resolveTheme } from "@bthwani/design-system";
import { createDshMobileClient, type CaptainAdmission, type CaptainAssignment, type CaptainOffer } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

function client() {
  return createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });
}

export function CaptainOperations() {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [admission, setAdmission] = useState<CaptainAdmission | null>(null);
  const [offers, setOffers] = useState<ReadonlyArray<CaptainOffer>>([]);
  const [assignments, setAssignments] = useState<ReadonlyArray<CaptainAssignment>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const api = client();
      const [admissionResponse, offerResponse, assignmentResponse] = await Promise.all([
        api.readOwnCaptainAdmission(token),
        api.listOwnCaptainOffers(token),
        api.listOwnCaptainAssignments(token),
      ]);
      setAdmission(admissionResponse.admission);
      setOffers(offerResponse.offers);
      setAssignments(assignmentResponse.assignments);
    } catch (cause) {
      console.error("DSH Captain readback failed", cause);
      setError("تعذر قراءة حالة الكابتن والطلبات. أعد المحاولة.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setAvailability(available: boolean) {
    if (!admission || busy) return;
    setBusy("availability");
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().setCaptainAvailability(token, available, admission.version);
      await load();
    } catch (cause) {
      console.error("DSH Captain availability failed", cause);
      setError("تعذر تحديث التوفر. أعد القراءة لتأكيد النسخة الحالية.");
    } finally {
      setBusy("");
    }
  }

  async function respond(offer: CaptainOffer, decision: "accept" | "reject") {
    if (busy) return;
    setBusy(offer.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().respondToCaptainOffer(token, offer.id, { decision }, offer.version);
      await load();
    } catch (cause) {
      console.error("DSH Captain offer response failed", cause);
      setError("تعذر الرد على العرض. أعد القراءة فقد يكون منتهيًا أو سبق حسمه.");
    } finally {
      setBusy("");
    }
  }

  async function pickup(assignment: CaptainAssignment) {
    if (busy || assignment.state !== "assigned") return;
    setBusy(assignment.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().completeCaptainPickup(token, assignment.id, assignment.handoff.version);
      await load();
    } catch (cause) {
      console.error("DSH Captain pickup failed", cause);
      setError("لا يمكن تأكيد الاستلام قبل تأكيد المتجر أو عند تعارض النسخة.");
    } finally {
      setBusy("");
    }
  }

  async function complete(assignment: CaptainAssignment, result: "delivered" | "delivery_failed") {
    if (busy || assignment.state !== "in_custody") return;
    setBusy(assignment.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().completeCaptainAssignment(token, assignment.id, { result }, assignment.version);
      await load();
    } catch (cause) {
      console.error("DSH Captain completion failed", cause);
      setError("تعذر تسجيل النتيجة النهائية. أعد القراءة قبل المحاولة.");
    } finally {
      setBusy("");
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="عمليات الكابتن">
      <Text style={styles.title}>عمليات الكابتن</Text>
      <Text style={styles.muted}>الحالة والطلبات تُقرأ من DSH بعد تحقق جلسة الكابتن.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading && admission ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>الجاهزية</Text>
          <Text style={styles.muted}>القبول: {admission.state} · التوفر: {admission.availabilityState}</Text>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy) || admission.state !== "eligible"} onPress={() => void setAvailability(true)} style={[styles.button, busy && styles.disabledButton]}><Text style={styles.buttonText}>{busy === "availability" ? "جارٍ الحفظ…" : "متاح"}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy) || admission.state !== "eligible"} onPress={() => void setAvailability(false)} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>غير متاح</Text></Pressable>
          </View>
        </View>
      ) : null}
      {!loading ? <Text style={styles.sectionTitle}>العروض ({offers.length})</Text> : null}
      {!loading && !offers.length ? <Text style={styles.muted}>لا توجد عروض حالية.</Text> : null}
      {offers.map((offer) => <View key={offer.id} style={styles.card}><Text style={styles.cardTitle}>عرض للطلب {offer.orderId}</Text><Text style={styles.muted}>الحالة: {offer.state} · ينتهي: {new Date(offer.expiresAt).toLocaleString("ar-YE")}</Text>{offer.state === "offered" ? <View style={styles.row}><Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void respond(offer, "accept")} style={[styles.button, busy && styles.disabledButton]}><Text style={styles.buttonText}>{busy === offer.id ? "جارٍ الحفظ…" : "قبول العرض"}</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void respond(offer, "reject")} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>رفض</Text></Pressable></View> : null}</View>)}
      {!loading ? <Text style={styles.sectionTitle}>التكليفات ({assignments.length})</Text> : null}
      {!loading && !assignments.length ? <Text style={styles.muted}>لا توجد تكليفات.</Text> : null}
      {assignments.map((assignment) => <View key={assignment.id} style={styles.card}><Text style={styles.cardTitle}>طلب {assignment.orderId}</Text><Text style={styles.muted}>الحالة: {assignment.state} · تسليم المتجر: {assignment.handoff.state}</Text>{assignment.state === "assigned" && assignment.handoff.state === "store_confirmed" ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void pickup(assignment)} style={[styles.button, busy && styles.disabledButton]}><Text style={styles.buttonText}>{busy === assignment.id ? "جارٍ الحفظ…" : "تأكيد الاستلام"}</Text></Pressable> : null}{assignment.state === "in_custody" ? <View style={styles.row}><Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void complete(assignment, "delivered")} style={[styles.button, busy && styles.disabledButton]}><Text style={styles.buttonText}>{busy === assignment.id ? "جارٍ الحفظ…" : "تم التسليم"}</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void complete(assignment, "delivery_failed")} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>تعذر التسليم</Text></Pressable></View> : null}</View>)}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void load()} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>تحديث الحالة</Text></Pressable>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const rowDirection = resolveRowDirection(activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, gap: 10, marginTop: 16, padding: 14, width: "100%", direction: activeDirection },
    title: { color: theme.color, fontSize: 18, fontWeight: "800", textAlign: startTextAlign },
    sectionTitle: { color: theme.color, fontSize: 15, fontWeight: "800", marginTop: 6, textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 19, textAlign: startTextAlign },
    state: { alignItems: "center", gap: 8, paddingVertical: 8 },
    card: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 7, padding: 10 },
    cardTitle: { color: theme.color, fontSize: 14, fontWeight: "800", textAlign: startTextAlign },
    row: { flexDirection: rowDirection, gap: 8 },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 8, flex: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    secondaryButtonText: { color: theme.color, fontWeight: "700" },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    error: { color: theme.danger, fontSize: 13, textAlign: startTextAlign },
  });
}
