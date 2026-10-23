import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniConfirmDialog, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type BeneficiaryPayoutState, settlementIntakeStatusLabel, type SettlementIntake } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
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
      setError("تعذر قراءة حالة سحب الأرباح.");
    } finally { setBusy(false); }
  }, [authenticated]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const request = async (mode: "FULL_AVAILABLE" | "SPECIFIED") => {
    if (pendingAttempt) mode = pendingAttempt.mode;
    const normalizedAmount = toAsciiDigits(amount.trim()).replace(/[^0-9]/g, "");
    const parsed = pendingAttempt?.amountMinor ?? (mode === "SPECIFIED" ? Number(normalizedAmount) : undefined);
    if (mode === "SPECIFIED" && (!Number.isSafeInteger(parsed) || (parsed ?? 0) <= 0)) {
      setError("أدخل مبلغ سحب صحيحًا.");
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
      const result = await captainClient().createOwnPayoutIntent(token, mode, parsed, attempt.idempotencyKey, attempt.correlationID);
      // An acknowledged mutation is not enough; verify the WLT read model and actor scope
      // before clearing the durable retry key or reporting financial success.
      const readback = (await captainClient().readOwnPayoutState(token)).state;
      if (result.payout.actorType !== "captain" ||
          result.payout.actorId !== actor.identity.subject ||
          result.payout.resolvedAmountMinor <= 0 ||
          readback.actorType !== "captain" ||
          readback.actorId !== actor.identity.subject ||
          readback.latestPayout?.id !== result.payout.id) {
        throw new Error("CAPTAIN_PAYOUT_READBACK_MISMATCH");
      }
      await SecureStore.deleteItemAsync(storageKey);
      setPendingAttempt(null);
      setNotice("تم تقديم طلب سحب الأرباح.");
      setAmount("");
      setShowPartial(false);
      await load();
    } catch (cause) {
      console.error("DSH captain payout intent failed", cause);
      setError(pendingAttempt ? "تحقق من الطلب السابق قبل إعادة المحاولة." : "تعذر طلب سحب الأرباح. تحقق من الرصيد ووجهة الصرف.");
      setBusy(false);
    }
  };
  const requestIntake = async (mode: "FULL_AVAILABLE" | "SPECIFIED") => {
    const actor = currentIdentityState();
    if (actor.kind !== "authenticated" || !state || state.eligibleAvailableMinor <= 0) return;
    const parsed = mode === "SPECIFIED" ? Number(toAsciiDigits(amount).replace(/[^0-9]/g, "")) : undefined;
    if (mode === "SPECIFIED" && (!Number.isSafeInteger(parsed) || (parsed ?? 0) <= 0 || (parsed ?? 0) > state.eligibleAvailableMinor)) {
      setError("المبلغ يتجاوز الأرباح المتاحة للسحب."); return;
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
      setNotice("وصل طلب سحب الأرباح إلى المالية.");
      setAmount("");
      setShowPartial(false);
    } catch {
      setError("تعذّر تأكيد الطلب؛ يمكن إعادة المحاولة بالمرجع نفسه دون تكرار.");
    } finally { setBusy(false); }
  };
  const destinationReady = state?.destination?.status === "ACTIVE_FOR_PAYOUT" &&
    state.destination.verificationStatus === "VERIFIED";
  const eligible = state?.eligibleAvailableMinor ?? 0;
  const specifiedIntakeAmount = Number(toAsciiDigits(amount).replace(/[^0-9]/g, ""));
  const specifiedReady = Number.isSafeInteger(specifiedIntakeAmount) &&
    specifiedIntakeAmount > 0 && specifiedIntakeAmount <= eligible;

  const metrics = state ? <View style={styles.availableBox}>
    <Text style={styles.muted}>المبلغ المؤهل للسحب</Text>
    <Text style={styles.availableAmount}>{formatMoney(state.eligibleAvailableMinor, state.currency)}</Text>
  </View> : null;

  const intakeConfirmAmount = confirmIntakeMode === "SPECIFIED" ? specifiedIntakeAmount : eligible;
  const intakeConfirmDescription = confirmIntakeMode && state
    ? `طلب سحب أرباح بمبلغ ${formatMoney(intakeConfirmAmount, state.currency)} إلى المالية.`
    : "";

  return (
    <BthwaniSurface tone="base" style={styles.card} accessibilityLabel="سحب أرباح الكابتن">
      <Text accessibilityRole="header" style={styles.title}>سحب الأرباح</Text>
      {busy && !state ? <ActivityIndicator color={theme.actionBackground} /> : null}
      {metrics}
      {state ? <>
        <Text style={styles.muted}>{destinationReady
          ? `الوجهة: ${state.destination?.walletIdentifierMasked ?? "معتمدة"}`
          : "وجهة الصرف قيد الاعتماد."}</Text>
        {pendingAttempt ? <>
          <Text style={styles.muted}>طلب سابق قيد التأكيد.</Text>
          <BthwaniButton busy={busy} label="متابعة الطلب" onPress={() => void request(pendingAttempt.mode)} />
        </> : intake?.status === "REQUESTED" ? (
          <Text style={styles.muted}>طلب السحب قيد المراجعة.</Text>
        ) : eligible > 0 ? <>
          <BthwaniButton busy={busy}
            label="طلب سحب الأرباح"
            onPress={() => destinationReady ? void request("FULL_AVAILABLE") : setConfirmIntakeMode("FULL_AVAILABLE")}
          />
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPartial }}
            style={styles.partialToggle} disabled={busy}
            onPress={() => setShowPartial((value) => !value)}>
            <Text style={styles.muted}>{showPartial ? "إخفاء المبلغ الجزئي −" : "مبلغ جزئي +"}</Text>
          </Pressable>
          {showPartial ? <>
            <TextInput accessibilityLabel="مبلغ سحب أرباح جزئي بالريال اليمني"
              editable={!busy} keyboardType="number-pad"
              value={amount} onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/[^0-9]/g, ""))}
              placeholder="المبلغ بالريال اليمني" placeholderTextColor={theme.colorMuted}
              style={styles.input} />
            <BthwaniButton busy={busy} disabled={!specifiedReady}
              label="طلب المبلغ" variant="secondary"
              onPress={() => destinationReady ? void request("SPECIFIED") : setConfirmIntakeMode("SPECIFIED")} />
          </> : null}
        </> : <Text style={styles.muted}>لا توجد أرباح متاحة للسحب.</Text>}
        {intake ? <Text style={styles.muted}>
          {settlementIntakeStatusLabel(intake)}{intake.payoutReference ? ` · ${intake.payoutReference}` : ""}
        </Text> : null}
      </> : null}

      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {authenticated && error ? <BthwaniButton label="إعادة المحاولة" disabled={busy} busy={busy}
        onPress={() => void load()} variant="secondary" /> : null}
      <BthwaniConfirmDialog busy={busy} visible={Boolean(confirmIntakeMode)}
        title="سحب الأرباح" description={intakeConfirmDescription}
        confirmLabel="تأكيد الطلب"
        onCancel={() => setConfirmIntakeMode(null)}
        onConfirm={() => { const mode = confirmIntakeMode; setConfirmIntakeMode(null); if (mode) void requestIntake(mode); }} />
    </BthwaniSurface>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    title: { ...typography.titleSm, color: theme.color },
    available: { ...typography.bodyStrong, color: theme.color },
    availableBox: { gap: spacing[2], padding: spacing[3], borderRadius: radius.md, backgroundColor: theme.surfaceRaised },
    availableAmount: { ...typography.titleLg, color: theme.color },    muted: { ...typography.bodySm, color: theme.colorMuted },
    input: { ...typography.bodySm, backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, minHeight: 48, paddingHorizontal: spacing[3] },
    partialToggle: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing[2] },
    notice: { ...typography.bodySm, color: theme.interactiveText },
    error: { ...typography.bodySm, color: theme.warning },
  });
}
