import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniConfirmDialog, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type BeneficiaryPayoutState } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "../captain-operations/captain-client";

type PayoutAttempt = Readonly<{ mode: "FULL_AVAILABLE" | "SPECIFIED"; amountMinor?: number; idempotencyKey: string; correlationID: string }>;

export function CaptainPayoutCard() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [state, setState] = useState<BeneficiaryPayoutState | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(authenticated);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAttempt, setPendingAttempt] = useState<PayoutAttempt | null>(null);
  const [intake, setIntake] = useState<{ id: string; status: string; resolvedAmountMinor: number; payoutStatus?: string; payoutReference?: string; payoutUpdatedAt?: string } | null>(null);
  const [pendingIntakeAttempt, setPendingIntakeAttempt] = useState<PayoutAttempt | null>(null);
  const [confirmIntakeMode, setConfirmIntakeMode] = useState<"FULL_AVAILABLE" | "SPECIFIED" | null>(null);
  const load = useCallback(async () => {
    if (!authenticated) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const actor = currentIdentityState();
      if (actor.kind === "authenticated") {
        const raw = await SecureStore.getItemAsync(`bthwani.captain.payout.pending.v1.${encodeURIComponent(actor.identity.subject)}`);
        if (raw) setPendingAttempt(JSON.parse(raw) as PayoutAttempt);
        const savedIntake = await SecureStore.getItemAsync(`bthwani.captain.settlement-intake.pending.v1.${encodeURIComponent(actor.identity.subject)}`);
        if (savedIntake) setPendingIntakeAttempt(JSON.parse(savedIntake) as PayoutAttempt);
      }
      setState((await captainClient().readOwnPayoutState(token)).state);
      setIntake((await captainClient().listOwnSettlementIntakes(token)).intakes[0] ?? null);
    } catch (cause) {
      console.error("DSH captain payout state readback failed", cause);
      setError("تعذر قراءة حالة طلب التسوية.");
    } finally { setBusy(false); }
  }, [authenticated]);
  useEffect(() => { void load(); }, [load]);
  const request = async (mode: "FULL_AVAILABLE" | "SPECIFIED") => {
    if (pendingAttempt) mode = pendingAttempt.mode;
    const normalizedAmount = toAsciiDigits(amount.trim()).replace(/[^0-9]/g, "");
    const parsed = pendingAttempt?.amountMinor ?? (mode === "SPECIFIED" ? Number(normalizedAmount) : undefined);
    if (mode === "SPECIFIED" && (!Number.isSafeInteger(parsed) || (parsed ?? 0) <= 0)) {
      setError("أدخل مبلغ تسوية صحيحًا أكبر من صفر.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const actor = currentIdentityState();
      if (actor.kind !== "authenticated" || !actor.identity.subject.trim()) throw new Error("CAPTAIN_SESSION_REQUIRED");
      const storageKey = `bthwani.captain.payout.pending.v1.${encodeURIComponent(actor.identity.subject)}`;
      const attempt = pendingAttempt ?? { mode, ...(parsed === undefined ? {} : { amountMinor: parsed }), idempotencyKey: `captain_payout_${Crypto.randomUUID()}`, correlationID: `captain_payout_corr_${Crypto.randomUUID()}` };
      await SecureStore.setItemAsync(storageKey, JSON.stringify(attempt));
      setPendingAttempt(attempt);
      await captainClient().createOwnPayoutIntent(token, mode, parsed, attempt.idempotencyKey, attempt.correlationID);
      await SecureStore.deleteItemAsync(storageKey);
      setPendingAttempt(null);
      setNotice("تم تسجيل طلب التسوية ووضع المبلغ في الحجز للمراجعة.");
      setAmount("");
      await load();
    } catch (cause) {
      console.error("DSH captain payout intent failed", cause);
      setError(pendingAttempt ? "لم نتأكد من نتيجة الطلب السابق؛ تحقق منه قبل إنشاء طلب تسوية آخر." : "تعذر تسجيل طلب التسوية. تأكد من توفر وجهة محفظة رسمية معتمدة ورصيد مستحق.");
      setBusy(false);
    }
  };
  const requestIntake = async (mode: "FULL_AVAILABLE" | "SPECIFIED") => {
    const actor = currentIdentityState();
    if (actor.kind !== "authenticated" || !state || state.eligibleAvailableMinor <= 0) return;
    const parsed = mode === "SPECIFIED" ? Number(toAsciiDigits(amount).replace(/[^0-9]/g, "")) : undefined;
    if (mode === "SPECIFIED" && (!Number.isSafeInteger(parsed) || (parsed ?? 0) <= 0 || (parsed ?? 0) > state.eligibleAvailableMinor)) {
      setError("المبلغ غير مؤهل للتسوية."); return;
    }
    const key = `bthwani.captain.settlement-intake.pending.v1.${encodeURIComponent(actor.identity.subject)}`;
    setBusy(true); setError(""); setNotice("");
    try {
      const saved = pendingIntakeAttempt ?? { mode, ...(parsed === undefined ? {} : { amountMinor: parsed }), idempotencyKey: `captain_intake_${Crypto.randomUUID()}`, correlationID: `captain_intake_corr_${Crypto.randomUUID()}` };
      await SecureStore.setItemAsync(key, JSON.stringify(saved));
      setPendingIntakeAttempt(saved);
      const token = await getUsableIdentityAccessToken();
      const created = await captainClient().createOwnSettlementIntake(token, saved.mode, saved.amountMinor, saved.idempotencyKey, saved.correlationID);
      const readback = (await captainClient().listOwnSettlementIntakes(token)).intakes.find((item) => item.id === created.intake.id);
      if (!readback || readback.status !== "REQUESTED" || readback.resolvedAmountMinor !== created.intake.resolvedAmountMinor) throw new Error("SETTLEMENT_INTAKE_READBACK_MISMATCH");
      setIntake(readback);
      await SecureStore.deleteItemAsync(key);
      setPendingIntakeAttempt(null);
      setNotice("وصل طلب التسوية إلى المالية. يلزم اعتماد وجهة التحويل قبل الصرف.");
      setAmount("");
    } catch {
      setError("تعذّر تأكيد الطلب؛ يمكن إعادة المحاولة بالمرجع نفسه دون تكرار.");
    } finally { setBusy(false); }
  };
  const destinationReady = state?.destination?.status === "ACTIVE_FOR_PAYOUT" && state.destination.verificationStatus === "VERIFIED";
  const specifiedIntakeAmount = Number(toAsciiDigits(amount).replace(/[^0-9]/g, ""));
  const specifiedIntakeReady = Number.isSafeInteger(specifiedIntakeAmount) && specifiedIntakeAmount > 0 && specifiedIntakeAmount <= (state?.eligibleAvailableMinor ?? 0);
  return <BthwaniSurface tone="base" style={styles.card} accessibilityLabel="طلب تسوية الكابتن"><Text style={styles.eyebrow}>التسوية المالية</Text><Text style={styles.title}>تسوية مستحقات الكابتن</Text>{busy && !state ? <View style={styles.loading}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة حالة التسوية…</Text></View> : null}{state ? <><Text style={styles.muted}>{destinationReady ? `الوجهة المعتمدة: ${state.destination?.walletIdentifierMasked}` : "لا توجد وجهة محفظة رسمية معتمدة بعد؛ تتم إدارتها من لوحة التحكم."}</Text><View style={styles.metrics}><Text style={styles.metric}>المتاح للتسوية: {formatMoney(state.eligibleAvailableMinor, state.currency)}</Text><Text style={styles.metric}>المحجوز: {formatMoney(state.heldMinor, state.currency)}</Text></View>{pendingAttempt ? <><Text style={styles.muted}>طلب سابق قيد التحقق؛ تحقق من نتيجته قبل إنشاء طلب آخر.</Text><BthwaniButton busy={busy} label="التحقق من الطلب المحفوظ" onPress={() => void request(pendingAttempt.mode)} /></> : intake?.status === "REQUESTED" ? <Text style={styles.muted}>طلب التسوية لدى المالية لحين التحقق من وجهة التحويل.</Text> : destinationReady && state.eligibleAvailableMinor > 0 ? <><BthwaniButton busy={busy} label="طلب تسوية كامل المتاح" onPress={() => void request("FULL_AVAILABLE")} variant="secondary" /><TextInput accessibilityLabel="مبلغ تسوية الكابتن المحدد" keyboardType="number-pad" value={amount} onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/[^0-9]/g, ""))} placeholder="مبلغ محدد عند الحاجة" placeholderTextColor={theme.colorMuted} style={styles.input} /><BthwaniButton busy={busy} label="طلب المبلغ المحدد" onPress={() => void request("SPECIFIED")} variant="secondary" /></> : !destinationReady && state.eligibleAvailableMinor > 0 ? intake?.status === "REQUESTED" ? <Text style={styles.muted}>طلب التسوية قيد مراجعة المالية. سيجري التحقق من وجهة التحويل.</Text> : <><BthwaniButton busy={busy} label="طلب تسوية من المالية" onPress={() => setConfirmIntakeMode("FULL_AVAILABLE")} variant="secondary" /><TextInput accessibilityLabel="مبلغ تسوية جزئية بالريال اليمني" keyboardType="number-pad" value={amount} onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/[^0-9]/g, ""))} placeholder="مبلغ محدد اختياري" placeholderTextColor={theme.colorMuted} style={styles.input} /><BthwaniButton busy={busy} label="طلب مبلغ محدد" disabled={!specifiedIntakeReady} onPress={() => setConfirmIntakeMode("SPECIFIED")} variant="secondary" /></> : null}</> : null}{intake ? <Text style={styles.muted}>حالة الطلب: {intake.status === "CANCELLED" ? "ملغى" : intake.payoutStatus === "COMPLETED" ? "مكتمل ومطابق" : intake.status === "CONVERTED" ? "قيد الصرف والمطابقة" : "بانتظار مراجعة المالية"}{intake.payoutReference ? ` · المرجع: ${intake.payoutReference}` : ""}</Text> : null}{notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}{authenticated ? <BthwaniButton busy={busy} label="تحديث حالة التسوية" onPress={() => void load()} variant="secondary" /> : null}<BthwaniConfirmDialog busy={busy} visible={Boolean(confirmIntakeMode)} title="مراجعة طلب التسوية" confirmLabel="تأكيد طلب التسوية" description={confirmIntakeMode && state ? `سيصل طلب تسوية بمبلغ ${formatMoney(confirmIntakeMode === "SPECIFIED" ? specifiedIntakeAmount : state.eligibleAvailableMinor, state.currency)} إلى قسم المالية للمراجعة. لن يُحجز أو يُحوَّل أي مبلغ عند تقديم الطلب؛ يلزم التحقق من وجهة الصرف أولًا.` : ""} onCancel={() => setConfirmIntakeMode(null)} onConfirm={() => { const mode = confirmIntakeMode; setConfirmIntakeMode(null); if (mode) void requestIntake(mode); }} /></BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] }, eyebrow: { ...typography.label, color: theme.interactiveText }, title: { ...typography.titleSm, color: theme.color }, loading: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, metrics: { gap: spacing[1] }, metric: { ...typography.bodySm, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, input: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, padding: spacing[3], textAlign: "left", writingDirection: "ltr" }, notice: { ...typography.bodySm, color: theme.interactiveText }, error: { ...typography.bodySm, color: theme.warning } }); }
