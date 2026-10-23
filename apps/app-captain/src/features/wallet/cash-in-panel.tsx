import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, cashInSimulatorMutationHeaders, cashInSimulatorOptions, cashInSimulatorStateMatches, type CashInSimulatorOutcome, type WalletProvider, type BeneficiaryWalletResponse, type CashInFundingIntent } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "../captain-operations/captain-client";
import { matchesCaptainFundingAttempt, matchesCaptainFundingRequest, parseCaptainFundingAttempt, type CaptainFundingAttempt } from "./cash-in-recovery";

type FundingAttempt = CaptainFundingAttempt;

const attemptKey = (actorID: string) => `bthwani.captain.cash-in.pending.v1.${encodeURIComponent(actorID)}`;

export function CaptainCashInPanel() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [wallet, setWallet] = useState<BeneficiaryWalletResponse | null>(null);
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState<FundingAttempt | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [simulatorOutcome, setSimulatorOutcome] = useState<CashInSimulatorOutcome>("SUCCESS");
  const [providers, setProviders] = useState<ReadonlyArray<WalletProvider>>([]);
  const [selectedProviderKey, setSelectedProviderKey] = useState("");
  const [showTestOptions, setShowTestOptions] = useState(false);
  const [showChargeForm, setShowChargeForm] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) throw new Error("CAPTAIN_SESSION_REQUIRED");
      const actorID = identity.identity.subject.trim();
      const attempt = parseCaptainFundingAttempt(await SecureStore.getItemAsync(attemptKey(actorID)), actorID);
      setPending(attempt);
      const token = await getUsableIdentityAccessToken();
      const client = captainClient();
      const walletResponse = await client.readOwnWallet(token);
      const currentIdentity = currentIdentityState();
      if (currentIdentity.kind !== "authenticated" || currentIdentity.identity.subject.trim() !== actorID) throw new Error("CAPTAIN_SESSION_CHANGED");
      setWallet(walletResponse);
      if (walletResponse.state.providerMock) {
        try {
          const result = await client.listWalletProviders(token);
          const activeProviders = result.walletProviders.filter((provider) => provider.active);
          setProviders(activeProviders);
          setSelectedProviderKey((previous) => activeProviders.some((provider) => provider.key === previous) ? previous : activeProviders[0]?.key ?? "");
        } catch {
          setProviders([]);
          setSelectedProviderKey("");
        }
      }
      if (!attempt?.fundingIntentID) {
        return;
      }

      let intent = (await client.readOwnFundingIntent(token, attempt.fundingIntentID)).intent;
      if (walletResponse.state.providerMock && !["SETTLED", "FAILED"].includes(intent.state) && intent.providerKey !== "DEVELOPMENT_SIMULATOR") {
        intent = (await client.reconcileOwnFundingIntent(token, intent.id, attempt.idempotencyKey + "_recover", attempt.correlationID)).intent;
      }
      if (!matchesCaptainFundingAttempt(intent, attempt)) throw new Error("CASH_IN_RETRY_STATE_CONFLICT");
      const currentIdentityAfterIntentRead = currentIdentityState();
      if (currentIdentityAfterIntentRead.kind !== "authenticated" || currentIdentityAfterIntentRead.identity.subject.trim() !== actorID) throw new Error("CAPTAIN_SESSION_CHANGED");
      const terminal = ["SETTLED", "FAILED"].includes(intent.state);
      const canonicalWallet = terminal ? await client.readOwnWallet(token) : walletResponse;
      setWallet({ ...canonicalWallet, fundingIntents: [intent, ...canonicalWallet.fundingIntents.filter((item) => item.id !== intent.id)] });
      if (terminal) {
        const storedAttempt = parseCaptainFundingAttempt(await SecureStore.getItemAsync(attemptKey(actorID)), actorID);
        if (storedAttempt && matchesCaptainFundingAttempt(intent, storedAttempt)) {
          await SecureStore.deleteItemAsync(attemptKey(actorID));
          setPending(null);
          setNotice(intent.state === "SETTLED" ? "تمت إضافة الرصيد إلى المحفظة." : "لم تتم إضافة الرصيد. يمكنك المحاولة مجددًا.");
        }
      }
    } catch (cause) {
      console.error("DSH captain wallet readback failed", cause);
      setError("تعذرت قراءة المحفظة أو استعادة طلب الشحن من الخادم.");
    } finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const createIntent = async () => {
    const identity = currentIdentityState();
    if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) { setError("يلزم تسجيل الدخول لقراءة محفظة الكابتن."); return; }
    const actorID = identity.identity.subject.trim();
    const parsedAmount = pending?.actorID === actorID ? pending.amountMinor : Number(toAsciiDigits(amount.trim()).replace(/[^0-9]/g, ""));
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) { setError("أدخل مبلغ شحن صحيحًا أكبر من صفر."); return; }
    if (!pending && wallet?.state.providerMock && !providers.some((provider) => provider.key === selectedProviderKey)) {setError("اختر مزود الدفع أولًا.");return;}
    const attempt: FundingAttempt = pending?.actorID === actorID ? pending : { version: 1, actorID, amountMinor: parsedAmount, ...(wallet?.state.providerMock ? { providerKey: selectedProviderKey } : {}), idempotencyKey: `captain_cashin_${Crypto.randomUUID()}`, correlationID: `captain_cashin_corr_${Crypto.randomUUID()}` };
    setBusy(true); setError(""); setNotice("");
    try {
      await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(attempt));
      setPending(attempt);
      const token = await getUsableIdentityAccessToken();
      const client = captainClient();
      const response = pending?.fundingIntentID
        ? { intent: (await client.readOwnFundingIntent(token, pending.fundingIntentID)).intent, simulator: Boolean(__DEV__ && wallet?.state.simulator) }
        : await client.createOwnFundingIntent(token, parsedAmount, attempt.idempotencyKey, attempt.correlationID, attempt.providerKey);
      if (!matchesCaptainFundingRequest(response.intent, actorID, parsedAmount) ||
          !response.intent.id.trim() || response.intent.id.length > 128 ||
          (pending?.fundingIntentID && response.intent.id !== pending.fundingIntentID)) throw new Error("CASH_IN_RESPONSE_MISMATCH");
      const confirmed: FundingAttempt = { ...attempt, fundingIntentID: response.intent.id };
      await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(confirmed));
      setPending(confirmed);
      setAmount("");
      let finalIntent = response.intent;
      if (__DEV__ && response.simulator && finalIntent.providerKey === "DEVELOPMENT_SIMULATOR" && !["SETTLED", "FAILED"].includes(finalIntent.state)) {
        const headers = cashInSimulatorMutationHeaders(attempt, simulatorOutcome);
        const result = await client.simulateOwnFundingIntent(
          token, finalIntent.id, simulatorOutcome,
          headers.idempotencyKey, headers.correlationID,
        );
        const current = currentIdentityState();
        if (current.kind !== "authenticated" || current.identity.subject.trim() !== actorID) throw new Error("CAPTAIN_SESSION_CHANGED");
        if (!matchesCaptainFundingRequest(result.intent, actorID, parsedAmount) || result.intent.id !== finalIntent.id ||
            !cashInSimulatorStateMatches(simulatorOutcome, result.intent.state)) throw new Error("CASH_IN_SIMULATOR_READBACK_MISMATCH");
        finalIntent = result.intent;
      }
      if (wallet?.state.providerMock && !["SETTLED", "FAILED"].includes(finalIntent.state)) {
        finalIntent = (await client.reconcileOwnFundingIntent(token, finalIntent.id, attempt.idempotencyKey + "_recover", attempt.correlationID)).intent;
      }
      if (["SETTLED", "FAILED"].includes(finalIntent.state)) {
        await SecureStore.deleteItemAsync(attemptKey(actorID));
        setPending(null);
        setNotice(finalIntent.state === "SETTLED" ? "نجح شحن المحفظة، وسيظهر الرصيد بعد التحديث." : "لم تتم إضافة الرصيد. يمكنك المحاولة مجددًا.");
      } else {
        setNotice("سُجل طلب الشحن، وسيظهر الرصيد بعد تأكيد المزود المالي.");
      }
      await load();
    } catch (cause) {
      console.error("DSH captain Cash-In request failed", cause);
      setError("لم نتأكد من نتيجة طلب الشحن. أعد المحاولة بالمبلغ نفسه لتجنب تكرار الطلب.");
    } finally { setBusy(false); }
  };

  const state = wallet?.state;
  const simulatorInDevelopment = Boolean(__DEV__ && state?.simulator && state.cashInEnabled);
  const providerMockInDevelopment = Boolean(simulatorInDevelopment && state?.providerMock);
  const latest = (wallet?.fundingIntents ?? []).filter((intent) =>
    simulatorInDevelopment || intent.providerKey !== "DEVELOPMENT_SIMULATOR");
  const userCanAddFunds = Boolean(state?.cashInEnabled && (!state.simulator || simulatorInDevelopment));
  const userHasPending = Boolean(pending);
  const fundingStateLabel = (value: CashInFundingIntent["state"]) =>
    ({ PENDING_PROVIDER: "قيد التأكيد", UNKNOWN: "قيد التحقق", SETTLED: "تم", FAILED: "فشل" })[value];

  return <BthwaniSurface tone="base" style={styles.panel} accessibilityLabel="شحن رصيد الكابتن">
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.title}>الرصيد التشغيلي</Text>
      {simulatorInDevelopment ? <Text style={styles.demo}>تجريبي</Text> : null}
    </View>
    {busy && !wallet ? <ActivityIndicator color={theme.actionBackground} /> : null}
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
          <Pressable key={value} accessibilityRole="button" accessibilityLabel={"اختيار " + value + " ريال"}
            disabled={busy} onPress={() => setAmount(String(value))}
            style={[styles.preset, Number(amount) === value && styles.presetActive]}>
            <Text style={styles.presetText}>{value.toLocaleString("en-US")}</Text>
          </Pressable>)}
      </View> : null}
      {providerMockInDevelopment ? <View style={styles.simOptions}>
        {providers.map((provider) => <Pressable key={provider.key} accessibilityRole="radio" accessibilityLabel={provider.displayNameAr}
          accessibilityState={{ selected: selectedProviderKey === provider.key }} onPress={() => setSelectedProviderKey(provider.key)}
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
              accessibilityState={{ selected: simulatorOutcome === option.outcome }}
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

    {userHasPending ? <Text style={styles.muted}>طلب قيد التأكيد: {formatMoney(pending!.amountMinor, "YER")}</Text> : null}
    {latest.length > 0 ? <View style={styles.history}>
      <Text style={styles.muted}>آخر شحن</Text>
      {latest.slice(0, 3).map((intent) =>
        <View key={intent.id} style={styles.row}>
          <Text style={styles.muted}>{fundingStateLabel(intent.state)}</Text>
          <Text style={styles.label}>{formatMoney(intent.amountMinor, intent.currency)}</Text>
        </View>)}
    </View> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {error ? <BthwaniButton disabled={busy} busy={busy} label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /> : null}
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
