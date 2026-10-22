import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, cashInSimulatorMutationHeaders, cashInSimulatorOptions, cashInSimulatorStateMatches, type CashInSimulatorOutcome, type BeneficiaryWalletResponse } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [showCharge, setShowCharge] = useState(false);
  const [showTestOptions, setShowTestOptions] = useState(false);
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
      if (!attempt?.fundingIntentID) {
        return;
      }

      const intent = (await client.readOwnFundingIntent(token, attempt.fundingIntentID)).intent;
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
  useEffect(() => { void load(); }, [load]);

  const createIntent = async () => {
    const identity = currentIdentityState();
    if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) { setError("يلزم تسجيل الدخول لقراءة محفظة الكابتن."); return; }
    const actorID = identity.identity.subject.trim();
    const parsedAmount = pending?.actorID === actorID ? pending.amountMinor : Number(toAsciiDigits(amount.trim()).replace(/[^0-9]/g, ""));
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) { setError("أدخل مبلغ شحن صحيحًا أكبر من صفر."); return; }
    const attempt: FundingAttempt = pending?.actorID === actorID ? pending : { version: 1, actorID, amountMinor: parsedAmount, idempotencyKey: `captain_cashin_${Crypto.randomUUID()}`, correlationID: `captain_cashin_corr_${Crypto.randomUUID()}` };
    setBusy(true); setError(""); setNotice("");
    try {
      await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(attempt));
      setPending(attempt);
      const token = await getUsableIdentityAccessToken();
      const client = captainClient();
      const response = pending?.fundingIntentID
        ? { intent: (await client.readOwnFundingIntent(token, pending.fundingIntentID)).intent, simulator: Boolean(__DEV__ && wallet?.state.simulator) }
        : await client.createOwnFundingIntent(token, parsedAmount, attempt.idempotencyKey, attempt.correlationID);
      if (!matchesCaptainFundingRequest(response.intent, actorID, parsedAmount) ||
          !response.intent.id.trim() || response.intent.id.length > 128 ||
          (pending?.fundingIntentID && response.intent.id !== pending.fundingIntentID)) throw new Error("CASH_IN_RESPONSE_MISMATCH");
      const confirmed: FundingAttempt = { ...attempt, fundingIntentID: response.intent.id };
      await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(confirmed));
      setPending(confirmed);
      setAmount("");
      let finalIntent = response.intent;
      if (__DEV__ && response.simulator && !["SETTLED", "FAILED"].includes(finalIntent.state)) {
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
  const simulatorInDevelopment = Boolean(__DEV__ && state?.simulator);
  const userCanAddFunds = Boolean(state?.cashInEnabled && (!state.simulator || simulatorInDevelopment));
  const currentAmount = Number(toAsciiDigits(amount).replace(/[^0-9]/g, ""));
  return <BthwaniSurface tone="base" style={styles.panel} accessibilityLabel="شحن رصيد الكابتن">
    <Text style={styles.title}>الرصيد المتاح</Text>
    {busy && !wallet ? <ActivityIndicator color={theme.actionBackground} /> : null}
    {state ? <>
      <Text style={styles.amount}>{formatMoney(state.availableMinor, state.currency)}</Text>
      {state.heldMinor > 0 ? <Text style={styles.muted}>محجوز: {formatMoney(state.heldMinor, state.currency)}</Text> : null}
    </> : null}
    {userCanAddFunds ? <>
      <Pressable accessible accessibilityRole="button"
        accessibilityLabel={showCharge || pending ? "إغلاق نموذج الشحن" : "إضافة رصيد"}
        disabled={busy || Boolean(pending)} onPress={() => setShowCharge((value) => !value)}
        style={styles.toggle}>
        <Text style={styles.label}>{showCharge || pending ? "إغلاق الشحن −" : "+ شحن الرصيد"}</Text>
      </Pressable>
      {showCharge || pending ? <>
        <TextInput accessibilityLabel="مبلغ الشحن بالريال اليمني"
          editable={!busy && !pending} keyboardType="number-pad"
          placeholder="المبلغ بالريال اليمني" placeholderTextColor={theme.colorMuted}
          value={amount} onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/[^0-9]/g, ""))}
          style={styles.input} />
        {!pending ? <View style={styles.presets}>{[1000,5000,10000].map((value) =>
          <Pressable key={value} accessibilityRole="button" disabled={busy}
            onPress={() => setAmount(String(value))}
            style={[styles.preset,currentAmount===value && styles.presetActive]}>
            <Text style={styles.label}>{value.toLocaleString("en-US")}</Text>
          </Pressable>)}</View> : null}
        {simulatorInDevelopment ? <>
          <Pressable accessibilityRole="button" accessibilityState={{expanded:showTestOptions}}
            onPress={() => setShowTestOptions((value) => !value)} style={styles.testToggle}>
            <Text style={styles.muted}>خيارات الاختبار {showTestOptions?"−":"+"}</Text>
          </Pressable>
          {showTestOptions ? <View style={styles.options}>
            {cashInSimulatorOptions.map((item) => <Pressable key={item.outcome}
              accessibilityRole="radio" accessibilityState={{selected:simulatorOutcome===item.outcome}}
              onPress={() => setSimulatorOutcome(item.outcome)} style={styles.preset}>
              <Text style={styles.label}>{item.label}</Text>
            </Pressable>)}
          </View> : null}
        </> : null}
        <BthwaniButton busy={busy} disabled={busy || (!pending && (!Number.isSafeInteger(currentAmount) || currentAmount<=0))}
          label={pending ? "متابعة الشحن" : simulatorInDevelopment ? "شحن تجريبي" : "تأكيد الشحن"}
          onPress={() => void createIntent()} />
      </> : null}
    </> : state ? <Text style={styles.muted}>الشحن غير متاح</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <BthwaniButton label="إعادة المحاولة" disabled={busy} onPress={() => void load()} variant="secondary" /></> : null}
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    panel: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    title: { ...typography.bodySm, color: theme.colorMuted },
    amount: { ...typography.titleLg, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    label: { ...typography.bodyStrong, color: theme.color },
    toggle: { backgroundColor: theme.actionSoft, borderRadius: radius.md, minHeight: 44, paddingHorizontal: spacing[3], justifyContent: "center" },
    input: { ...typography.bodySm, color: theme.color, borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.md, minHeight: 48, paddingHorizontal: spacing[3] },
    presets: { flexDirection: "row", gap: spacing[2] },
    preset: { flex: 1, borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.md, padding: spacing[2], minHeight: 44, justifyContent: "center", alignItems: "center" },
    presetActive: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    testToggle: { minHeight: 44, justifyContent: "center" },
    options: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    notice: { ...typography.bodySm, color: theme.interactiveText },
    error: { ...typography.bodySm, color: theme.warning },
  });
}
