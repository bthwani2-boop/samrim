import { borders, radius, type resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniConfirmDialog, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type BeneficiaryPayoutState, formatMoney, type SettlementIntake, settlementIntakeStatusLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "../field-operations/field-client";

type PayoutAttempt = Readonly<{ mode: "FULL_AVAILABLE" | "SPECIFIED"; amountMinor?: number; idempotencyKey: string; correlationID: string }>;

function destinationStatusLabel(state: BeneficiaryPayoutState["destination"]): string {
  if (!state) return "غير مهيأة";
  if (state.status === "ACTIVE_FOR_PAYOUT" && state.verificationStatus === "VERIFIED") return "معتمدة";
  if (state.status === "SUSPENDED" || state.status === "RETIRED" || state.verificationStatus === "REJECTED" || state.verificationStatus === "STALE") return "تحتاج مراجعة المالية";
  if (state.status === "PENDING_APPROVAL") return "بانتظار اعتماد المالية";
  if (state.verificationStatus === "PENDING_VERIFICATION") return "بانتظار تحقق المالية";
  return "قيد الإعداد";
}

function destinationGuidance(state: BeneficiaryPayoutState["destination"]): string {
  if (!state) return "تُهيئها المالية قبل الصرف.";
  if (state.status === "SUSPENDED" || state.status === "RETIRED" || state.verificationStatus === "REJECTED" || state.verificationStatus === "STALE") return "تراجعها المالية قبل الصرف.";
  return "تعتمدها المالية قبل الصرف.";
}

export function FieldPayoutCard({ onWalletRefresh, refreshVersion }: Readonly<{ onWalletRefresh: () => void; refreshVersion: number }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [state, setState] = useState<BeneficiaryPayoutState | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(authenticated);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAttempt, setPendingAttempt] = useState<PayoutAttempt | null>(null);
  const [intake, setIntake] = useState<SettlementIntake | null>(null);
  const [pendingIntakeAttempt, setPendingIntakeAttempt] = useState<PayoutAttempt | null>(null);
  const [confirmMode, setConfirmMode] = useState<"FULL_AVAILABLE" | "SPECIFIED" | null>(null);
  const financialRequestInFlight = useRef(false);
  const load = useCallback(async () => {
    if (!authenticated) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const actor = currentIdentityState();
      if (actor.kind === "authenticated") {
        const raw = await SecureStore.getItemAsync(`bthwani.field.payout.pending.v1.${encodeURIComponent(actor.identity.subject)}`);
        if (raw) setPendingAttempt(JSON.parse(raw) as PayoutAttempt);
        const pendingIntake = await SecureStore.getItemAsync(`bthwani.field.settlement-intake.pending.v1.${encodeURIComponent(actor.identity.subject)}`);
        setPendingIntakeAttempt(pendingIntake ? JSON.parse(pendingIntake) as PayoutAttempt : null);
      }
      setState((await fieldClient().readOwnPayoutState(token)).state);
      const intakes = (await fieldClient().listOwnSettlementIntakes(token)).intakes;
      setIntake(intakes[0] ?? null);
    } catch (cause) {
      console.warn("DSH field payout state readback failed", cause);
      setError("تعذر قراءة حالة طلب التسوية.");
    } finally { setBusy(false); }
  }, [authenticated]);
  useFocusEffect(useCallback(() => { void refreshVersion; void load(); }, [load, refreshVersion]));
  const request = async (mode: "FULL_AVAILABLE" | "SPECIFIED") => {
    if (pendingAttempt) mode = pendingAttempt.mode;
    const normalizedAmount = toAsciiDigits(amount.trim()).replace(/\D/g, "");
    const parsed = pendingAttempt?.amountMinor ?? (mode === "SPECIFIED" ? Number(normalizedAmount) : undefined);
    if (!pendingAttempt && mode === "SPECIFIED" && (!Number.isSafeInteger(parsed) || (parsed ?? 0) <= 0 || (state && (parsed ?? 0) > state.eligibleAvailableMinor))) {
      setError(state && (parsed ?? 0) > state.eligibleAvailableMinor ? "المبلغ المحدد يتجاوز المتاح للتسوية." : "أدخل مبلغ تسوية صحيحًا أكبر من صفر.");
      return;
    }
    if (financialRequestInFlight.current) return;
    financialRequestInFlight.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const actor = currentIdentityState();
      if (actor.kind !== "authenticated" || !actor.identity.subject.trim()) throw new Error("FIELD_SESSION_REQUIRED");
      const storageKey = `bthwani.field.payout.pending.v1.${encodeURIComponent(actor.identity.subject)}`;
      const attempt = pendingAttempt ?? { mode, ...(parsed === undefined ? {} : { amountMinor: parsed }), idempotencyKey: `field_payout_${Crypto.randomUUID()}`, correlationID: `field_payout_corr_${Crypto.randomUUID()}` };
      await SecureStore.setItemAsync(storageKey, JSON.stringify(attempt));
      setPendingAttempt(attempt);
      const created = await fieldClient().createOwnPayoutIntent(token, mode, parsed, attempt.idempotencyKey, attempt.correlationID);
      const canonical = (await fieldClient().readOwnPayoutState(token)).state;
      if (!canonical.latestPayout ||
        canonical.latestPayout.id !== created.payout.id ||
        canonical.latestPayout.actorType !== "field" ||
        canonical.latestPayout.resolvedAmountMinor !== created.payout.resolvedAmountMinor ||
        canonical.latestPayout.status !== created.payout.status) {
        throw new Error("FIELD_PAYOUT_CANONICAL_READBACK_MISMATCH");
      }
      setState(canonical);
      await SecureStore.deleteItemAsync(storageKey);
      setPendingAttempt(null);
      setNotice(`أُرسل طلب التسوية: ${formatMoney(created.payout.resolvedAmountMinor, created.payout.currency)}.`);
      onWalletRefresh();
      setAmount("");
    } catch (cause) {
      console.warn("DSH field payout intent failed", cause);
      setError(pendingAttempt ? "لم نتأكد من نتيجة الطلب السابق؛ تحقق منه قبل إنشاء طلب تسوية آخر." : "تعذر تسجيل طلب التسوية. تأكد من توفر وجهة محفظة رسمية معتمدة ورصيد مستحق.");
    } finally {
      financialRequestInFlight.current = false;
      setBusy(false);
    }
  };
  const requestIntake = async (mode: "FULL_AVAILABLE" | "SPECIFIED") => {
    const actor = currentIdentityState();
    if (actor.kind !== "authenticated" || (!pendingIntakeAttempt && (!state || state.eligibleAvailableMinor <= 0))) return;
    const key = `bthwani.field.settlement-intake.pending.v1.${encodeURIComponent(actor.identity.subject)}`;
    const effectiveMode = pendingIntakeAttempt?.mode ?? mode;
    const parsed = pendingIntakeAttempt?.amountMinor ?? (effectiveMode === "SPECIFIED" ? Number(toAsciiDigits(amount).replace(/\D/g, "")) : undefined);
    if (!pendingIntakeAttempt && effectiveMode === "SPECIFIED" && (!Number.isSafeInteger(parsed) || (parsed ?? 0) <= 0 || (parsed ?? 0) > (state?.eligibleAvailableMinor ?? 0))) {
      setError("مبلغ طلب التسوية غير صالح."); return;
    }
    if (financialRequestInFlight.current) return;
    financialRequestInFlight.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const raw = await SecureStore.getItemAsync(key);
      const stored = raw ? JSON.parse(raw) as PayoutAttempt : null;
      if (pendingIntakeAttempt
        ? !stored || stored.idempotencyKey !== pendingIntakeAttempt.idempotencyKey || stored.correlationID !== pendingIntakeAttempt.correlationID || stored.mode !== pendingIntakeAttempt.mode || stored.amountMinor !== pendingIntakeAttempt.amountMinor
        : Boolean(stored)) throw new Error("FIELD_INTAKE_STORED_ATTEMPT_CHANGED");
      const saved = pendingIntakeAttempt ?? { mode: effectiveMode, ...(parsed === undefined ? {} : { amountMinor: parsed }), idempotencyKey: `field_intake_${Crypto.randomUUID()}`, correlationID: `field_intake_corr_${Crypto.randomUUID()}` };
      await SecureStore.setItemAsync(key, JSON.stringify(saved));
      setPendingIntakeAttempt(saved);
      const token = await getUsableIdentityAccessToken();
      const actorBeforeSend = currentIdentityState();
      if (actorBeforeSend.kind !== "authenticated" || actorBeforeSend.identity.subject !== actor.identity.subject) throw new Error("FIELD_INTAKE_SESSION_CHANGED");
      const created = await fieldClient().createOwnSettlementIntake(token, saved.mode, saved.amountMinor, saved.idempotencyKey, saved.correlationID);
      const actorAfterCreate = currentIdentityState();
      if (actorAfterCreate.kind !== "authenticated" || actorAfterCreate.identity.subject !== actor.identity.subject) throw new Error("FIELD_INTAKE_SESSION_CHANGED");
      const readback = (await fieldClient().listOwnSettlementIntakes(token)).intakes.find((item) => item.id === created.intake.id);
      const actorAfterReadback = currentIdentityState();
      if (actorAfterReadback.kind !== "authenticated" || actorAfterReadback.identity.subject !== actor.identity.subject) throw new Error("FIELD_INTAKE_SESSION_CHANGED");
      if (readback?.actorType !== "field" || readback.actorId !== actor.identity.subject || created.intake.actorType !== "field" || created.intake.actorId !== actor.identity.subject || readback.status !== "REQUESTED" || readback.resolvedAmountMinor !== created.intake.resolvedAmountMinor) throw new Error("SETTLEMENT_INTAKE_READBACK_MISMATCH");
      setIntake(readback);
      onWalletRefresh();
      await SecureStore.deleteItemAsync(key);
      setPendingIntakeAttempt(null);
      setNotice("وصل طلب التسوية إلى قسم المالية. ستُراجع وجهة التحويل قبل الصرف.");
      setAmount("");
    } catch {
      setError("لم يتم تأكيد الطلب. يمكنك استعادة المحاولة بنفس المرجع دون تكرار الطلب.");
    } finally { financialRequestInFlight.current = false; setBusy(false); }
  };
  const destinationReady = state?.destination?.status === "ACTIVE_FOR_PAYOUT" && state.destination.verificationStatus === "VERIFIED";
  const parsedConfirmAmount = Number(toAsciiDigits(amount.trim()).replace(/\D/g, ""));
  const confirmAmount = confirmMode === "FULL_AVAILABLE" ? state?.eligibleAvailableMinor ?? 0 : Number.isSafeInteger(parsedConfirmAmount) ? parsedConfirmAmount : 0;
  const specifiedAmountReady = Number.isSafeInteger(parsedConfirmAmount) && parsedConfirmAmount > 0 && Boolean(state) && parsedConfirmAmount <= (state?.eligibleAvailableMinor ?? 0);
  let confirmDescription = "";
  if (confirmMode && state) {
    const amountLabel = formatMoney(confirmAmount, state.currency);
    if (destinationReady) {
      confirmDescription = `سيُنشأ طلب صرف بمبلغ ${amountLabel} إلى وجهة التحويل المعتمدة. يُحجز المبلغ حتى التسوية وفق السياسة.`;
    } else {
      confirmDescription = `سيصل طلب تسوية بمبلغ ${amountLabel} إلى قسم المالية للمراجعة، دون حجز أو تحويل أي مبلغ الآن. يُراجع حساب التحويل قبل الصرف.`;
    }
  }
  let payoutActions: ReactNode = null;
  if (pendingAttempt) {
    payoutActions = <><Text style={styles.muted}>هناك طلب سابق لم تُحسم حالته بعد. تحقّق منه قبل طلب تسوية أخرى.</Text><BthwaniButton busy={busy} label="التحقق من الطلب المحفوظ" onPress={() => void request(pendingAttempt.mode)} /></>;
  } else if (pendingIntakeAttempt) {
    payoutActions = <><Text style={styles.muted}>لم يُحسم طلب التسوية السابق. تحقّق منه بالمرجع المحفوظ قبل إنشاء طلب جديد.</Text><BthwaniButton busy={busy} label="التحقق من طلب التسوية المحفوظ" onPress={() => void requestIntake(pendingIntakeAttempt.mode)} /></>;
  } else if (intake?.status === "REQUESTED") {
    payoutActions = <View style={styles.openRequest}>
      <Text style={styles.metric}>{formatMoney(intake.resolvedAmountMinor, intake.currency)}</Text>
      <Text style={styles.muted}>{settlementIntakeStatusLabel(intake)}</Text>
    </View>;
  } else if (destinationReady && state && state.eligibleAvailableMinor > 0) {
    payoutActions = <><BthwaniButton busy={busy} label="طلب تسوية كامل المتاح" onPress={() => setConfirmMode("FULL_AVAILABLE")} variant="primary" /><TextInput accessibilityLabel="مبلغ تسوية الميداني المحدد بالريال اليمني" keyboardType="number-pad" value={amount} onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/\D/g, ""))} placeholder="المبلغ بالريال اليمني" placeholderTextColor={theme.colorMuted} style={styles.input} /><BthwaniButton busy={busy} disabled={!specifiedAmountReady} label="طلب المبلغ المحدد" onPress={() => setConfirmMode("SPECIFIED")} variant="secondary" />
    </>;
  } else if (!destinationReady && state && state.eligibleAvailableMinor > 0) {
    payoutActions = <BthwaniButton busy={busy} label="طلب تسوية كامل المتاح" onPress={() => setConfirmMode("FULL_AVAILABLE")} variant="primary" />;
  } else if (destinationReady && state) {
    payoutActions = <Text style={styles.muted}>لا يوجد رصيد متاح لطلب التسوية الآن.</Text>;
  }
  return <BthwaniSurface tone="base" style={styles.card} accessibilityLabel="طلب تسوية الميداني">
    <Text style={styles.title}>طلب تسوية</Text>
    {busy && !state ? <View style={styles.loading}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ تحميل بيانات التسوية…</Text></View> : null}
    {busy && state ? <Text style={styles.muted}>جارٍ تحديث بيانات التسوية…</Text> : null}
    {state ? <>
      <View style={styles.destination}>
        <Text style={styles.destinationLabel}>
          وجهة الصرف · {destinationReady
            ? <Text style={styles.destinationValue}>{state.destination?.walletIdentifierMasked}</Text>
            : <Text style={styles.destinationWarning}>{destinationStatusLabel(state.destination)}</Text>}
        </Text>
        {!destinationReady ? <Text style={styles.muted}>{destinationGuidance(state.destination)}</Text> : null}
      </View>
      <View style={styles.metrics}>
        <View style={styles.metricTile}><Text style={styles.metricLabel}>المتاح الآن</Text><Text style={styles.metric}>{formatMoney(state.eligibleAvailableMinor, state.currency)}</Text></View>
        <View style={styles.metricTile}><Text style={styles.metricLabel}>محجوز</Text><Text style={styles.metric}>{formatMoney(state.heldMinor, state.currency)}</Text></View>
      </View>
      {payoutActions}
    </> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <BthwaniConfirmDialog busy={busy} confirmLabel="تأكيد طلب التسوية" description={confirmDescription} onCancel={() => setConfirmMode(null)} onConfirm={() => { const mode = confirmMode; setConfirmMode(null); if (mode) void (destinationReady ? request(mode) : requestIntake(mode)); }} title="مراجعة طلب التسوية" visible={Boolean(confirmMode)} />
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] }, title: { ...typography.titleSm, color: theme.color }, loading: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, destination: { alignItems: "flex-start" }, destinationLabel: { ...typography.caption, color: theme.colorMuted, textAlign: "right", writingDirection: "rtl" }, destinationValue: { ...typography.bodyStrong, color: theme.color, writingDirection: "ltr" }, destinationWarning: { ...typography.caption, color: theme.warning }, metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] }, metricTile: { flexBasis: 136, flexGrow: 1, minWidth: 0 }, openRequest: { borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, gap: spacing[1], paddingTop: spacing[3] }, metricLabel: { ...typography.caption, color: theme.colorMuted }, metric: { ...typography.bodyStrong, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, input: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, padding: spacing[3], textAlign: "left", writingDirection: "ltr" }, notice: { ...typography.bodySm, color: theme.interactiveText }, error: { ...typography.bodySm, color: theme.warning } }); }
