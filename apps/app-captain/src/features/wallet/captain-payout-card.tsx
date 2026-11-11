import { borders, radius, type resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniConfirmDialog, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type BeneficiaryPayoutState, formatMoney, type SettlementIntake, settlementIntakeStatusLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { captainSessionKey } from "../../bootstrap/captain-session-scope";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "../captain-operations/captain-client";

type PayoutAttempt = Readonly<{ mode: "FULL_AVAILABLE" | "SPECIFIED"; amountMinor?: number; idempotencyKey: string; correlationID: string }>;

// Saved financial attempts are retry references, never client-owned financial truth.
// Reject malformed or incomplete references before any WLT mutation.
function parsePayoutAttempt(raw: string | null): PayoutAttempt | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<PayoutAttempt> | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      (parsed.mode !== "FULL_AVAILABLE" && parsed.mode !== "SPECIFIED") ||
      (parsed.mode === "SPECIFIED"
        ? !Number.isSafeInteger(parsed.amountMinor) || Number(parsed.amountMinor) <= 0
        : parsed.amountMinor !== undefined) ||
      typeof parsed.idempotencyKey !== "string" || parsed.idempotencyKey.length < 8 || parsed.idempotencyKey.length > 128 ||
      typeof parsed.correlationID !== "string" || parsed.correlationID.length < 8 || parsed.correlationID.length > 128) {
    throw new Error("CAPTAIN_FINANCIAL_RETRY_STATE_INVALID");
  }
  return parsed as PayoutAttempt;
}

function samePayoutAttempt(stored: PayoutAttempt | null, expected: PayoutAttempt): boolean {
  return Boolean(stored && stored.mode === expected.mode &&
    stored.amountMinor === expected.amountMinor &&
    stored.idempotencyKey === expected.idempotencyKey &&
    stored.correlationID === expected.correlationID);
}

function hasCurrentPayoutSession(sessionKey: string): boolean {
  return Boolean(sessionKey) && captainSessionKey(currentIdentityState()) === sessionKey;
}

export function CaptainPayoutCard() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = Boolean(captainSessionKey(currentIdentityState()));
  const [loadedState, setState] = useState<BeneficiaryPayoutState | null>(null);
  const [amount, setAmount] = useState("");
  const [showPartial, setShowPartial] = useState(false);
  const [busy, setBusy] = useState(authenticated);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedPendingAttempt, setPendingAttempt] = useState<PayoutAttempt | null>(null);
  const financialRequestInFlight = useRef(false);
  const claimFinancialRequest = () => {
    if (financialRequestInFlight.current) return false;
    financialRequestInFlight.current = true;
    return true;
  };
  const readSequence = useRef(0);
  const [loadedSessionKey, setLoadedSessionKey] = useState("");
  const [loadedIntake, setIntake] = useState<SettlementIntake | null>(null);
  const [savedIntakeAttempt, setPendingIntakeAttempt] = useState<PayoutAttempt | null>(null);
  const [confirmIntakeMode, setConfirmIntakeMode] = useState<"FULL_AVAILABLE" | "SPECIFIED" | null>(null);
  // Financial snapshots are private to the exact Identity session. Durable
  // recovery keys stay actor-scoped so a renewed session can safely reconcile.
  const currentSessionReadback = hasCurrentPayoutSession(loadedSessionKey);
  const state = currentSessionReadback ? loadedState : null;
  const pendingAttempt = currentSessionReadback ? savedPendingAttempt : null;
  const pendingIntakeAttempt = currentSessionReadback ? savedIntakeAttempt : null;
  const intake = currentSessionReadback ? loadedIntake : null;
  const load = useCallback(async () => {
    const sequence = ++readSequence.current;
    const identity = currentIdentityState();
    const requestSession = captainSessionKey(identity);
    const actorID = identity.kind === "authenticated" && requestSession ? identity.identity.subject.trim() : "";
    const stillCurrent = () => sequence === readSequence.current && hasCurrentPayoutSession(requestSession);
    setBusy(true);
    setError("");
    setNotice("");
    setState(null);
    setIntake(null);
    setPendingAttempt(null);
    setPendingIntakeAttempt(null);
    setLoadedSessionKey(requestSession);
    if (!requestSession) { setBusy(false); return; }
    try {
      const token = await getUsableIdentityAccessToken();
      if (!stillCurrent()) return;
      const raw = await SecureStore.getItemAsync(`bthwani.captain.payout.pending.v1.${encodeURIComponent(actorID)}`);
      if (!stillCurrent()) return;
      const savedIntake = await SecureStore.getItemAsync(`bthwani.captain.settlement-intake.pending.v1.${encodeURIComponent(actorID)}`);
      if (!stillCurrent()) return;
      const payoutState = (await captainClient().readOwnPayoutState(token)).state;
      if (!stillCurrent()) return;
      if (payoutState.actorType !== "captain" || payoutState.actorId !== actorID) {
        throw new Error("CAPTAIN_PAYOUT_ACTOR_READBACK_MISMATCH");
      }
      const intakes = (await captainClient().listOwnSettlementIntakes(token)).intakes;
      if (!stillCurrent()) return;
      setPendingAttempt(parsePayoutAttempt(raw));
      setPendingIntakeAttempt(parsePayoutAttempt(savedIntake));
      setState(payoutState);
      setIntake(intakes[0] ?? null);
    } catch (cause) {
      console.error("DSH captain payout state readback failed", cause);
      if (stillCurrent()) setError("تعذر قراءة حالة سحب الأرباح.");
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  }, []);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { readSequence.current += 1; };
  }, [load]));
  const request = async (mode: "FULL_AVAILABLE" | "SPECIFIED") => {
    if (!hasCurrentPayoutSession(loadedSessionKey) || busy) return;
    const requestSession = loadedSessionKey;
    if (pendingAttempt) mode = pendingAttempt.mode;
    const normalizedAmount = toAsciiDigits(amount.trim()).replace(/[^0-9]/g, "");
    const parsed = pendingAttempt?.amountMinor ?? (mode === "SPECIFIED" ? Number(normalizedAmount) : undefined);
    if (mode === "SPECIFIED" && (!Number.isSafeInteger(parsed) || (parsed ?? 0) <= 0)) {
      setError("أدخل مبلغ سحب صحيحًا.");
      return;
    }
    if (!claimFinancialRequest()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const actorBeforeToken = currentIdentityState();
      if (captainSessionKey(actorBeforeToken) !== requestSession) throw new Error("CAPTAIN_SESSION_REQUIRED");
      const token = await getUsableIdentityAccessToken();
      const actor = currentIdentityState();
      if (actor.kind !== "authenticated" || captainSessionKey(actor) !== requestSession) {
        throw new Error("CAPTAIN_PAYOUT_SESSION_CHANGED");
      }
      const storageKey = `bthwani.captain.payout.pending.v1.${encodeURIComponent(actor.identity.subject)}`;
      const attempt = pendingAttempt ?? { mode, ...(parsed === undefined ? {} : { amountMinor: parsed }), idempotencyKey: `captain_payout_${Crypto.randomUUID()}`, correlationID: `captain_payout_corr_${Crypto.randomUUID()}` };
      const existing = parsePayoutAttempt(await SecureStore.getItemAsync(storageKey));
      if (!hasCurrentPayoutSession(requestSession)) throw new Error("CAPTAIN_PAYOUT_SESSION_CHANGED");
      if (pendingAttempt ? !samePayoutAttempt(existing, pendingAttempt) : Boolean(existing)) {
        throw new Error("CAPTAIN_PAYOUT_STORED_ATTEMPT_CHANGED");
      }
      await SecureStore.setItemAsync(storageKey, JSON.stringify(attempt));
      if (!hasCurrentPayoutSession(requestSession)) {
        throw new Error("CAPTAIN_PAYOUT_SESSION_CHANGED");
      }
      setPendingAttempt(attempt);
      const result = await captainClient().createOwnPayoutIntent(token, mode, parsed, attempt.idempotencyKey, attempt.correlationID);
      if (!hasCurrentPayoutSession(requestSession)) throw new Error("CAPTAIN_PAYOUT_SESSION_CHANGED");
      // An acknowledged mutation is not enough; verify the WLT read model and actor scope
      // before clearing the durable retry key or reporting financial success.
      const readback = (await captainClient().readOwnPayoutState(token)).state;
      if (!hasCurrentPayoutSession(requestSession)) throw new Error("CAPTAIN_PAYOUT_SESSION_CHANGED");
      if (result.payout.actorType !== "captain" ||
          result.payout.actorId !== actor.identity.subject ||
          result.payout.resolvedAmountMinor <= 0 ||
          readback.actorType !== "captain" ||
          readback.actorId !== actor.identity.subject ||
          readback.latestPayout?.id !== result.payout.id) {
        throw new Error("CAPTAIN_PAYOUT_READBACK_MISMATCH");
      }
      const beforeClear = parsePayoutAttempt(await SecureStore.getItemAsync(storageKey));
      if (!hasCurrentPayoutSession(requestSession)) throw new Error("CAPTAIN_PAYOUT_SESSION_CHANGED");
      if (!samePayoutAttempt(beforeClear, attempt)) throw new Error("CAPTAIN_PAYOUT_STORED_ATTEMPT_CHANGED");
      await SecureStore.deleteItemAsync(storageKey);
      if (!hasCurrentPayoutSession(requestSession)) throw new Error("CAPTAIN_PAYOUT_SESSION_CHANGED");
      setPendingAttempt(null);
      setNotice("تم تقديم طلب سحب الأرباح.");
      setAmount("");
      setShowPartial(false);
      await load();
    } catch (cause) {
      console.error("DSH captain payout intent failed", cause);
      if (hasCurrentPayoutSession(requestSession)) {
        setError(pendingAttempt ? "تحقق من الطلب السابق قبل إعادة المحاولة." : "تعذر طلب سحب الأرباح. تحقق من الرصيد ووجهة الصرف.");
      }
    } finally {
      financialRequestInFlight.current = false;
      if (hasCurrentPayoutSession(requestSession)) setBusy(false);
    }
  };
  const requestIntake = async (mode: "FULL_AVAILABLE" | "SPECIFIED") => {
    const actor = currentIdentityState();
    const requestSession = captainSessionKey(actor);
    if (actor.kind !== "authenticated" || !requestSession || loadedSessionKey !== requestSession || busy ||
        (!pendingIntakeAttempt && (!state || state.eligibleAvailableMinor <= 0))) return;
    const effectiveMode = pendingIntakeAttempt?.mode ?? mode;
    const parsed = pendingIntakeAttempt?.amountMinor ?? (effectiveMode === "SPECIFIED" ? Number(toAsciiDigits(amount).replace(/[^0-9]/g, "")) : undefined);
    if (!pendingIntakeAttempt && effectiveMode === "SPECIFIED" && (!Number.isSafeInteger(parsed) || (parsed ?? 0) <= 0 || (parsed ?? 0) > (state?.eligibleAvailableMinor ?? 0))) {
      setError("المبلغ يتجاوز الأرباح المتاحة للسحب."); return;
    }
    if (!claimFinancialRequest()) return;
    const key = `bthwani.captain.settlement-intake.pending.v1.${encodeURIComponent(actor.identity.subject)}`;
    setBusy(true); setError(""); setNotice("");
    try {
      const raw = await SecureStore.getItemAsync(key);
      if (!hasCurrentPayoutSession(requestSession)) throw new Error("CAPTAIN_INTAKE_SESSION_CHANGED");
      const stored = parsePayoutAttempt(raw);
      if (pendingIntakeAttempt
        ? !samePayoutAttempt(stored, pendingIntakeAttempt)
        : Boolean(stored)) throw new Error("CAPTAIN_INTAKE_STORED_ATTEMPT_CHANGED");
      const saved = pendingIntakeAttempt ?? { mode: effectiveMode, ...(parsed === undefined ? {} : { amountMinor: parsed }), idempotencyKey: `captain_intake_${Crypto.randomUUID()}`, correlationID: `captain_intake_corr_${Crypto.randomUUID()}` };
      if (!hasCurrentPayoutSession(requestSession)) throw new Error("CAPTAIN_INTAKE_SESSION_CHANGED");
      await SecureStore.setItemAsync(key, JSON.stringify(saved));
      if (!hasCurrentPayoutSession(requestSession)) throw new Error("CAPTAIN_INTAKE_SESSION_CHANGED");
      const token = await getUsableIdentityAccessToken();
      if (!hasCurrentPayoutSession(requestSession)) {
        throw new Error("CAPTAIN_INTAKE_SESSION_CHANGED");
      }
      setPendingIntakeAttempt(saved);
      const created = await captainClient().createOwnSettlementIntake(token, saved.mode, saved.amountMinor, saved.idempotencyKey, saved.correlationID);
      if (!hasCurrentPayoutSession(requestSession)) {
        throw new Error("CAPTAIN_INTAKE_SESSION_CHANGED");
      }
      const readback = (await captainClient().listOwnSettlementIntakes(token)).intakes.find((item) => item.id === created.intake.id);
      if (!hasCurrentPayoutSession(requestSession)) {
        throw new Error("CAPTAIN_INTAKE_SESSION_CHANGED");
      }
      if (readback?.status !== "REQUESTED" || readback.resolvedAmountMinor !== created.intake.resolvedAmountMinor) throw new Error("SETTLEMENT_INTAKE_READBACK_MISMATCH");
      const beforeClear = parsePayoutAttempt(await SecureStore.getItemAsync(key));
      if (!hasCurrentPayoutSession(requestSession)) throw new Error("CAPTAIN_INTAKE_SESSION_CHANGED");
      if (!samePayoutAttempt(beforeClear, saved)) throw new Error("CAPTAIN_INTAKE_STORED_ATTEMPT_CHANGED");
      await SecureStore.deleteItemAsync(key);
      if (!hasCurrentPayoutSession(requestSession)) throw new Error("CAPTAIN_INTAKE_SESSION_CHANGED");
      setIntake(readback);
      setPendingIntakeAttempt(null);
      setNotice("وصل طلب سحب الأرباح إلى المالية.");
      setAmount("");
      setShowPartial(false);
    } catch {
      if (hasCurrentPayoutSession(requestSession)) {
        setError("تعذّر تأكيد الطلب؛ يمكن إعادة المحاولة بالمرجع نفسه دون تكرار.");
      }
    } finally {
      financialRequestInFlight.current = false;
      if (hasCurrentPayoutSession(requestSession)) setBusy(false);
    }
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
        </> : pendingIntakeAttempt ? <>
          <Text style={styles.muted}>لم يُحسم طلب التسوية السابق. تحقّق منه بالمرجع المحفوظ قبل إنشاء طلب جديد.</Text>
          <BthwaniButton busy={busy} label="التحقق من طلب التسوية المحفوظ" onPress={() => void requestIntake(pendingIntakeAttempt.mode)} />
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

      {currentSessionReadback && notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {currentSessionReadback && error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {authenticated && currentSessionReadback && error ? <BthwaniButton label="إعادة المحاولة" disabled={busy} busy={busy}
        onPress={() => void load()} variant="secondary" /> : null}
      <BthwaniConfirmDialog busy={busy} visible={currentSessionReadback && Boolean(confirmIntakeMode)}
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
