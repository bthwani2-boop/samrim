import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniConfirmDialog, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type BeneficiaryPayoutState, type SettlementIntake } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "../captain-operations/captain-client";

type PayoutAttempt = Readonly<{ mode: "FULL_AVAILABLE" | "SPECIFIED"; amountMinor?: number; idempotencyKey: string; correlationID: string }>;

export function CaptainPayoutCard() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [state, setState] = useState<BeneficiaryPayoutState | null>(null);
  const [amount, setAmount] = useState("");
  const [showPartial, setShowPartial] = useState(false);
  const [busy, setBusy] = useState(authenticated);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAttempt, setPendingAttempt] = useState<PayoutAttempt | null>(null);
  const [intake, setIntake] = useState<SettlementIntake | null>(null);
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
  const destinationReady = state?.destination?.status === "ACTIVE_FOR_PAYOUT" &&
    state.destination.verificationStatus === "VERIFIED";
  const eligible = state?.eligibleAvailableMinor ?? 0;
  const partialAmount = Number(toAsciiDigits(amount).replace(/[^0-9]/g, ""));
  const partialReady = Number.isSafeInteger(partialAmount) && partialAmount > 0 && partialAmount <= eligible;
  const blocked = busy || intake?.status === "REQUESTED";
  const initiate = (mode: "FULL_AVAILABLE" | "SPECIFIED") => {
    if (destinationReady) void request(mode);
    else setConfirmIntakeMode(mode);
  };
  return <BthwaniSurface tone="base" style={styles.card} accessibilityLabel="سحب أرباح الكابتن">
    <View style={styles.heading}>
      <Text style={styles.title}>سحب الأرباح</Text>
      {busy && !state ? <ActivityIndicator color={theme.actionBackground} /> : null}
    </View>
    {state ? <>
      <Text style={styles.eligible}>{formatMoney(eligible, state.currency)}</Text>
      {intake?.status === "REQUESTED" ? <Text style={styles.muted}>الطلب قيد المراجعة</Text> :
      pendingAttempt ? <BthwaniButton busy={busy} label="متابعة الطلب" onPress={() => void request(pendingAttempt.mode)} /> :
      eligible > 0 ? <>
        <BthwaniButton busy={busy} disabled={blocked} label="طلب سحب الأرباح"
          onPress={() => initiate("FULL_AVAILABLE")} />
        <Pressable accessibilityRole="button" accessibilityState={{expanded:showPartial}}
          onPress={() => setShowPartial((value) => !value)} style={styles.partialToggle}>
          <Text style={styles.muted}>{showPartial ? "إخفاء المبلغ الجزئي −" : "مبلغ جزئي +"}</Text>
        </Pressable>
        {showPartial ? <>
          <TextInput accessibilityLabel="مبلغ سحب أرباح جزئي" keyboardType="number-pad"
            value={amount} onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/[^0-9]/g, ""))}
            placeholder="المبلغ بالريال اليمني" placeholderTextColor={theme.colorMuted}
            style={styles.input} />
          <BthwaniButton busy={busy} disabled={blocked || !partialReady}
            label="طلب المبلغ" variant="secondary"
            onPress={() => initiate("SPECIFIED")} />
        </> : null}
      </> : <Text style={styles.muted}>لا توجد أرباح قابلة للسحب</Text>}
    </> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <BthwaniButton label="إعادة المحاولة" disabled={busy} onPress={() => void load()} variant="secondary" /></> : null}
    <BthwaniConfirmDialog busy={busy} visible={Boolean(confirmIntakeMode)}
      title="طلب سحب الأرباح"
      description={state ? formatMoney(confirmIntakeMode==="SPECIFIED"?partialAmount:eligible,state.currency):""}
      confirmLabel="تأكيد الطلب"
      onCancel={() => setConfirmIntakeMode(null)}
      onConfirm={() => { const mode=confirmIntakeMode; setConfirmIntakeMode(null); if(mode) void requestIntake(mode); }} />
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { ...typography.titleSm, color: theme.color },
    eligible: { ...typography.titleLg, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    partialToggle: { minHeight: 44, justifyContent: "center" },
    input: { ...typography.bodySm, color: theme.color, borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.md, minHeight: 48, paddingHorizontal: spacing[3] },
    notice: { ...typography.bodySm, color: theme.interactiveText },
    error: { ...typography.bodySm, color: theme.warning },
  });
}
