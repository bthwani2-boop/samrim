import { borders, radius, type resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type BeneficiaryWalletResponse, type CashInFundingIntent, type CashInSimulatorOutcome, cashInSimulatorMutationHeaders, cashInSimulatorOptions, cashInSimulatorStateMatches, formatMoney, type WalletProvider } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { captainSessionKey } from "../../bootstrap/captain-session-scope";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { captainClient } from "../captain-operations/captain-client";

type FundingAttempt = Readonly<{
  version: 1;
  actorID: string;
  amountMinor: number;
  idempotencyKey: string;
  correlationID: string;
  fundingIntentID?: string;
  providerKey?: string;
}>;

// Persisted retry data is actor-scoped, but WLT is the only authority for its
// financial outcome. Invalid or foreign attempts must fail closed.
function parseCaptainFundingAttempt(raw: string | null, actorID: string): FundingAttempt | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<FundingAttempt> | null;
  const validFundingIntentID = parsed?.fundingIntentID === undefined || (
    typeof parsed.fundingIntentID === "string" && parsed.fundingIntentID.length > 0 && parsed.fundingIntentID.length <= 128
  );
  if (parsed?.version !== 1 ||
    parsed.actorID !== actorID ||
    !Number.isSafeInteger(parsed.amountMinor) ||
    Number(parsed.amountMinor) <= 0 ||
    typeof parsed.idempotencyKey !== "string" ||
    parsed.idempotencyKey.length < 8 ||
    parsed.idempotencyKey.length > 128 ||
    typeof parsed.correlationID !== "string" ||
    parsed.correlationID.length < 8 ||
    parsed.correlationID.length > 128 ||
    !validFundingIntentID || (parsed.providerKey !== undefined && (typeof parsed.providerKey !== "string" || parsed.providerKey.length === 0 || parsed.providerKey.length > 64))
  ) throw new Error("CASH_IN_RETRY_STATE_INVALID");
  return parsed as FundingAttempt;
}

function matchesCaptainFundingRequest(intent: CashInFundingIntent, actorID: string, amountMinor: number): boolean {
  return intent.actorType === "captain" &&
    intent.actorId === actorID &&
    intent.fundingPurpose === "CAPTAIN_TOPUP" &&
    intent.amountMinor === amountMinor &&
    intent.currency === "YER";
}

function matchesCaptainFundingAttempt(intent: CashInFundingIntent, attempt: FundingAttempt): boolean {
  return Boolean(attempt.fundingIntentID && intent.id === attempt.fundingIntentID) && matchesCaptainFundingRequest(intent, attempt.actorID, attempt.amountMinor) && (!attempt.providerKey || intent.providerKey === attempt.providerKey.toUpperCase());
}

const attemptKey = (actorID: string) => `bthwani.captain.cash-in.pending.v1.${encodeURIComponent(actorID)}`;

function sameFundingAttempt(stored: FundingAttempt | null, expected: FundingAttempt): boolean {
  return Boolean(stored &&
    stored.actorID === expected.actorID &&
    stored.idempotencyKey === expected.idempotencyKey &&
    stored.correlationID === expected.correlationID &&
    stored.amountMinor === expected.amountMinor &&
    stored.providerKey === expected.providerKey &&
    stored.fundingIntentID === expected.fundingIntentID);
}

function hasCurrentFundingSession(sessionKey: string): boolean {
  return Boolean(sessionKey) && captainSessionKey(currentIdentityState()) === sessionKey;
}

export function CaptainCashInPanel() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [wallet, setWallet] = useState<BeneficiaryWalletResponse | null>(null);
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState<FundingAttempt | null>(null);
  const [busy, setBusy] = useState(true);
  const fundingInFlight = useRef(false);
  const readSequence = useRef(0);
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const sessionKey = captainSessionKey(identityState);
  const [loadedSessionKey, setLoadedSessionKey] = useState("");
  const currentSessionReadback = Boolean(sessionKey) && loadedSessionKey === sessionKey && hasCurrentFundingSession(sessionKey);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [simulatorOutcome, setSimulatorOutcome] = useState<CashInSimulatorOutcome>("SUCCESS");
  const [providers, setProviders] = useState<ReadonlyArray<WalletProvider>>([]);
  const [selectedProviderKey, setSelectedProviderKey] = useState("");
  const [showTestOptions, setShowTestOptions] = useState(false);
  const [showChargeForm, setShowChargeForm] = useState(false);
  const load = useCallback(async () => {
    const sequence = ++readSequence.current;
    const identity = currentIdentityState();
    const requestSession = captainSessionKey(identity);
    const actorID = identity.kind === "authenticated" && requestSession ? identity.identity.subject.trim() : "";
    const stillCurrent = () => sequence === readSequence.current && hasCurrentFundingSession(requestSession);
    setBusy(true);
    setError("");
    setNotice("");
    setLoadedSessionKey(requestSession);
    setWallet(null);
    setPending(null);
    setProviders([]);
    setSelectedProviderKey("");
    if (!requestSession) { setBusy(false); return; }
    try {
      const rawAttempt = await SecureStore.getItemAsync(attemptKey(actorID));
      if (!stillCurrent()) return;
      const attempt = parseCaptainFundingAttempt(rawAttempt, actorID);
      const token = await getUsableIdentityAccessToken();
      if (!stillCurrent()) return;
      const client = captainClient();
      const walletResponse = await client.readOwnWallet(token);
      if (!stillCurrent()) return;
      setPending(attempt);
      setWallet(walletResponse);
      if (walletResponse.state.providerMock) {
        try {
          const result = await client.listWalletProviders(token);
          if (!stillCurrent()) return;
          const activeProviders = result.walletProviders.filter((provider) => provider.active);
          setProviders(activeProviders);
          setSelectedProviderKey((previous) => activeProviders.some((provider) => provider.key === previous) ? previous : activeProviders[0]?.key ?? "");
        } catch {
          if (!stillCurrent()) return;
          setProviders([]);
          setSelectedProviderKey("");
        }
      }
      if (!attempt?.fundingIntentID) return;

      let intent = (await client.readOwnFundingIntent(token, attempt.fundingIntentID)).intent;
      if (!stillCurrent()) return;
      if (walletResponse.state.providerMock && !["SETTLED", "FAILED"].includes(intent.state) && intent.providerKey !== "DEVELOPMENT_SIMULATOR") {
        intent = (await client.reconcileOwnFundingIntent(token, intent.id, `${attempt.idempotencyKey}_recover`, attempt.correlationID)).intent;
        if (!stillCurrent()) return;
      }
      if (!matchesCaptainFundingAttempt(intent, attempt)) throw new Error("CASH_IN_RETRY_STATE_CONFLICT");
      const terminal = ["SETTLED", "FAILED"].includes(intent.state);
      const canonicalWallet = terminal ? await client.readOwnWallet(token) : walletResponse;
      if (!stillCurrent()) return;
      setWallet({ ...canonicalWallet, fundingIntents: [intent, ...canonicalWallet.fundingIntents.filter((item) => item.id !== intent.id)] });
      if (terminal) {
        const storedAttempt = parseCaptainFundingAttempt(await SecureStore.getItemAsync(attemptKey(actorID)), actorID);
        if (!stillCurrent()) return;
        if (storedAttempt && storedAttempt.idempotencyKey === attempt.idempotencyKey &&
            storedAttempt.correlationID === attempt.correlationID &&
            matchesCaptainFundingAttempt(intent, storedAttempt)) {
          await SecureStore.deleteItemAsync(attemptKey(actorID));
          if (!stillCurrent()) return;
          setPending(null);
          setNotice(intent.state === "SETTLED" ? "تمت إضافة الرصيد إلى المحفظة." : "لم تتم إضافة الرصيد. يمكنك المحاولة مجددًا.");
        }
      }
    } catch (cause) {
      console.error("DSH captain wallet readback failed", cause);
      if (stillCurrent()) setError("تعذرت قراءة المحفظة أو استعادة طلب الشحن من الخادم.");
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  }, []);
  useEffect(() => subscribeIdentitySession(setIdentityState), []);
  useFocusEffect(useCallback(() => {
    if (sessionKey) void load();
    return () => { readSequence.current += 1; };
  }, [load, sessionKey]));

  const createIntent = async () => {
    if (busy || fundingInFlight.current) return;
    const identity = currentIdentityState();
    const requestSession = captainSessionKey(identity);
    if (identity.kind !== "authenticated" || !requestSession) {
      setError("يلزم تسجيل الدخول لقراءة محفظة الكابتن."); return;
    }
    const actorID = identity.identity.subject.trim();
    const isCurrent = () => hasCurrentFundingSession(requestSession);
    if (loadedSessionKey !== requestSession || !isCurrent()) return;
    const parsedAmount = pending?.actorID === actorID ? pending.amountMinor : Number(toAsciiDigits(amount.trim()).replace(/[^0-9]/g, ""));
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) { setError("أدخل مبلغ شحن صحيحًا أكبر من صفر."); return; }
    if (!pending && wallet?.state.providerMock && !providers.some((provider) => provider.key === selectedProviderKey)) {setError("اختر مزود الدفع أولًا.");return;}
    const attempt: FundingAttempt = pending?.actorID === actorID ? pending : { version: 1, actorID, amountMinor: parsedAmount, ...(wallet?.state.providerMock ? { providerKey: selectedProviderKey } : {}), idempotencyKey: `captain_cashin_${Crypto.randomUUID()}`, correlationID: `captain_cashin_corr_${Crypto.randomUUID()}` };
    fundingInFlight.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      // Never overwrite an unknown financial attempt left by an older session.
      // Resume only the exact attempt already displayed from the owner readback.
      const storedAttempt = parseCaptainFundingAttempt(
        await SecureStore.getItemAsync(attemptKey(actorID)), actorID,
      );
      if (!isCurrent()) throw new Error("CAPTAIN_CASH_IN_SESSION_CHANGED");
      if (pending ? !sameFundingAttempt(storedAttempt, pending) : Boolean(storedAttempt)) {
        throw new Error("CASH_IN_STORED_ATTEMPT_CHANGED");
      }
      await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(attempt));
      if (!isCurrent()) throw new Error("CAPTAIN_CASH_IN_SESSION_CHANGED");
      setPending(attempt);
      const token = await getUsableIdentityAccessToken();
      if (!isCurrent()) throw new Error("CAPTAIN_CASH_IN_SESSION_CHANGED");
      const client = captainClient();
      const response = pending?.fundingIntentID
        ? { intent: (await client.readOwnFundingIntent(token, pending.fundingIntentID)).intent, simulator: Boolean(__DEV__ && wallet?.state.simulator) }
        : await client.createOwnFundingIntent(token, parsedAmount, attempt.idempotencyKey, attempt.correlationID, attempt.providerKey);
      if (!isCurrent()) throw new Error("CAPTAIN_CASH_IN_SESSION_CHANGED");
      if (!matchesCaptainFundingRequest(response.intent, actorID, parsedAmount) ||
          !response.intent.id.trim() || response.intent.id.length > 128 ||
          (pending?.fundingIntentID && response.intent.id !== pending.fundingIntentID)) throw new Error("CASH_IN_RESPONSE_MISMATCH");
      const confirmed: FundingAttempt = { ...attempt, fundingIntentID: response.intent.id };
      // A response from WLT must not overwrite a newer session's saved attempt.
      const beforeConfirm = parseCaptainFundingAttempt(
        await SecureStore.getItemAsync(attemptKey(actorID)), actorID,
      );
      if (!isCurrent()) throw new Error("CAPTAIN_CASH_IN_SESSION_CHANGED");
      if (!sameFundingAttempt(beforeConfirm, attempt)) throw new Error("CASH_IN_STORED_ATTEMPT_CHANGED");
      await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(confirmed));
      if (!isCurrent()) throw new Error("CAPTAIN_CASH_IN_SESSION_CHANGED");
      setPending(confirmed);
      setAmount("");
      let finalIntent = response.intent;
      if (!isCurrent()) throw new Error("CAPTAIN_CASH_IN_SESSION_CHANGED");
      if (__DEV__ && response.simulator && finalIntent.providerKey === "DEVELOPMENT_SIMULATOR" && !["SETTLED", "FAILED"].includes(finalIntent.state)) {
        const headers = cashInSimulatorMutationHeaders(attempt, simulatorOutcome);
        const result = await client.simulateOwnFundingIntent(
          token, finalIntent.id, simulatorOutcome,
          headers.idempotencyKey, headers.correlationID,
        );
        if (!isCurrent()) throw new Error("CAPTAIN_CASH_IN_SESSION_CHANGED");
        if (!matchesCaptainFundingRequest(result.intent, actorID, parsedAmount) || result.intent.id !== finalIntent.id ||
            !cashInSimulatorStateMatches(simulatorOutcome, result.intent.state)) throw new Error("CASH_IN_SIMULATOR_READBACK_MISMATCH");
        finalIntent = result.intent;
      }
      if (!isCurrent()) throw new Error("CAPTAIN_CASH_IN_SESSION_CHANGED");
      if (wallet?.state.providerMock && !["SETTLED", "FAILED"].includes(finalIntent.state)) {
        finalIntent = (await client.reconcileOwnFundingIntent(token, finalIntent.id, `${attempt.idempotencyKey}_recover`, attempt.correlationID)).intent;
      }
      if (!isCurrent()) throw new Error("CAPTAIN_CASH_IN_SESSION_CHANGED");
      // Only load() reconciles and retires a durable funding attempt after
      // checking WLT's canonical owner readback and the saved idempotency key.
      if (isCurrent()) await load();
    } catch (cause) {
      console.error("DSH captain Cash-In request failed", cause);
      if (isCurrent()) setError("لم نتأكد من نتيجة طلب الشحن. أعد المحاولة بالمبلغ نفسه لتجنب تكرار الطلب.");
    } finally {
      fundingInFlight.current = false;
      if (isCurrent()) setBusy(false);
    }
  };

  const visibleWallet = currentSessionReadback ? wallet : null;
  const state = visibleWallet?.state;
  const simulatorInDevelopment = Boolean(__DEV__ && state?.simulator && state.cashInEnabled);
  const providerMockInDevelopment = Boolean(simulatorInDevelopment && state?.providerMock);
  const latest = (visibleWallet?.fundingIntents ?? []).filter((intent) =>
    simulatorInDevelopment || intent.providerKey !== "DEVELOPMENT_SIMULATOR");
  const userCanAddFunds = Boolean(state?.cashInEnabled && (!state.simulator || simulatorInDevelopment));
  const userHasPending = Boolean(currentSessionReadback && pending);
  const fundingStateLabel = (value: CashInFundingIntent["state"]) =>
    ({ PENDING_PROVIDER: "قيد التأكيد", UNKNOWN: "قيد التحقق", SETTLED: "تم", FAILED: "فشل" })[value];

  return <BthwaniSurface tone="base" style={styles.panel} accessibilityLabel="شحن رصيد الكابتن">
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.title}>الرصيد التشغيلي</Text>
      {simulatorInDevelopment ? <Text style={styles.demo}>تجريبي</Text> : null}
    </View>
    {busy && !visibleWallet ? <ActivityIndicator color={theme.actionBackground} /> : null}
    {state ? <View style={styles.balance}>
      <Text style={styles.muted}>المتاح للاستخدام التشغيلي</Text>
      <Text style={styles.amount}>{formatMoney(state.availableMinor, state.currency)}</Text>
      <View style={styles.holdRow}><Text style={styles.muted}>الرصيد الدفتري: {formatMoney(state.ledgerBalanceMinor, state.currency)}</Text><Text style={styles.muted}>المحجوز: {formatMoney(state.heldMinor, state.currency)}</Text></View>
    </View> : null}

    {userCanAddFunds ? <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={showChargeForm ? "إغلاق الشحن" : "إضافة رصيد"}
        accessibilityState={{ expanded: showChargeForm || userHasPending }}
        disabled={busy || userHasPending}
        onPress={() => setShowChargeForm((previous) => !previous)}
        style={styles.toggle}>
        <Text style={styles.toggleLabel}>{showChargeForm || userHasPending ? "إغلاق الشحن −" : "إضافة رصيد +"}</Text>
      </Pressable>
      {showChargeForm || userHasPending ? <>
      <TextInput accessibilityLabel="مبلغ شحن محفظة الكابتن"
        editable={!userHasPending && !busy} keyboardType="number-pad"
        value={amount} onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/[^0-9]/g, ""))}
        placeholder="المبلغ بالريال اليمني" placeholderTextColor={theme.colorMuted} style={styles.input} />
      {!userHasPending ? <View style={styles.presets}>
        {[1000, 5000, 10000].map((value) =>
          <Pressable key={value} accessibilityRole="button" accessibilityLabel={`اختيار ${value} ريال`}
            disabled={busy} onPress={() => setAmount(String(value))}
            style={[styles.preset, Number(amount) === value && styles.presetActive]}>
            <Text style={styles.presetText}>{value.toLocaleString("en-US")}</Text>
          </Pressable>)}
      </View> : null}
      {providerMockInDevelopment ? <View style={styles.simOptions}>
        {providers.map((provider) => <Pressable key={provider.key} accessibilityRole="radio" accessibilityLabel={provider.displayNameAr}
          accessibilityState={{ checked: selectedProviderKey === provider.key }} onPress={() => setSelectedProviderKey(provider.key)}
          style={[styles.simOption, selectedProviderKey === provider.key && styles.simOptionSelected]}>
          <Text style={styles.label}>{provider.displayNameAr}</Text>
        </Pressable>)}
        {!providers.length ? <Text style={styles.muted}>لا يوجد مزود دفع نشط للاختبار.</Text> : null}
      </View> : null}
      {simulatorInDevelopment && !providerMockInDevelopment ? <>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showTestOptions }}
          onPress={() => setShowTestOptions((value) => !value)}
          style={styles.testToggle}>
          <Text style={styles.muted}>خيارات الاختبار {showTestOptions ? "−" : "+"}</Text>
        </Pressable>
        {showTestOptions ? <View style={styles.simOptions} accessibilityLabel="نتيجة شحن الكابتن التجريبي">
          {cashInSimulatorOptions.map((option) =>
            <Pressable key={option.outcome} accessibilityRole="radio"
              accessibilityState={{ checked: simulatorOutcome === option.outcome }}
              onPress={() => setSimulatorOutcome(option.outcome)}
              style={[styles.simOption, simulatorOutcome === option.outcome && styles.simOptionSelected]}>
              <Text style={styles.label}>{option.label}</Text>
            </Pressable>)}
        </View> : null}
      </> : null}
      <BthwaniButton busy={busy} disabled={busy || (!userHasPending && (!amount.trim() || (providerMockInDevelopment && !selectedProviderKey)))}
        label={userHasPending ? "متابعة الشحن" : simulatorInDevelopment ? "شحن تجريبي" : "شحن"}
        onPress={() => void createIntent()} />
      </> : null}
    </> : state ? <Text style={styles.muted}>الشحن غير متاح.</Text> : null}

    {userHasPending && pending ? <Text style={styles.muted}>طلب قيد التأكيد: {formatMoney(pending.amountMinor, "YER")}</Text> : null}
    {latest.length > 0 ? <View style={styles.history}>
      <Text style={styles.muted}>آخر شحن</Text>
      {latest.slice(0, 3).map((intent) =>
        <View key={intent.id} style={styles.row}>
          <Text style={styles.muted}>{fundingStateLabel(intent.state)}</Text>
          <Text style={styles.label}>{formatMoney(intent.amountMinor, intent.currency)}</Text>
        </View>)}
    </View> : null}
    {currentSessionReadback && notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {currentSessionReadback && error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {currentSessionReadback && error ? <BthwaniButton disabled={busy} busy={busy} label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /> : null}
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    panel: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { ...typography.titleSm, color: theme.color },
    demo: { ...typography.caption, color: theme.interactiveText },
    label: { ...typography.bodyStrong, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    balance: { gap: spacing[1], paddingVertical: spacing[1] },
    amount: { ...typography.hero, color: theme.color },
    holdRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing[2], paddingTop: spacing[2], borderTopColor: theme.borderColor, borderTopWidth: borders.hairline },
    input: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, minHeight: 48, paddingHorizontal: spacing[3] },
    presets: { flexDirection: "row", gap: spacing[2] },
    preset: { flex: 1, borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.md, alignItems: "center", justifyContent: "center", minHeight: 44 },
    presetActive: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    presetText: { ...typography.bodySm, color: theme.color },
    testToggle: { paddingVertical: spacing[2] },
    simOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    simOption: { width: "47%", alignItems: "center", justifyContent: "center", borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.md, minHeight: 44, padding: spacing[2] },
    simOptionSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    history: { gap: spacing[2] },
    row: { flexDirection: "row", justifyContent: "space-between", borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, paddingTop: spacing[2] },
    toggle: { backgroundColor: theme.actionSoft, borderRadius: radius.md, minHeight: 44, justifyContent: "center", paddingHorizontal: spacing[3] },
    toggleLabel: { ...typography.bodyStrong, color: theme.color },
    notice: { ...typography.bodySm, color: theme.interactiveText },
    error: { ...typography.bodySm, color: theme.warning },
  });
}
