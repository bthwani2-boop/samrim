import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type BeneficiaryWalletResponse, type CashInFundingIntent } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
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
          setNotice(intent.providerKey === "DEVELOPMENT_SIMULATOR" ? "" : intent.state === "SETTLED" ? "تمت إضافة الرصيد." : "لم تتم إضافة الرصيد. يمكنك المحاولة مجددًا.");
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
      const response = await captainClient().createOwnFundingIntent(token, parsedAmount, attempt.idempotencyKey, attempt.correlationID);
      if (!matchesCaptainFundingRequest(response.intent, actorID, parsedAmount) || !response.intent.id.trim() || response.intent.id.length > 128) throw new Error("CASH_IN_RESPONSE_MISMATCH");
      const confirmedAttempt: FundingAttempt = { ...attempt, fundingIntentID: response.intent.id };
      await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(confirmedAttempt));
      setPending(confirmedAttempt);
      setAmount("");
      if (["SETTLED", "FAILED"].includes(response.intent.state)) {
        await SecureStore.deleteItemAsync(attemptKey(actorID));
        setPending(null);
        setNotice(response.intent.providerKey === "DEVELOPMENT_SIMULATOR" ? "تعذر إتمام الدفع. حاول مجددًا لاحقًا." : response.intent.state === "SETTLED" ? "تمت إضافة الرصيد." : "لم تتم إضافة الرصيد. يمكنك المحاولة مجددًا.");
      } else {
        setNotice(response.simulator ? "تعذر إتمام الدفع. حاول مجددًا لاحقًا." : "سُجل طلب الشحن، وسيظهر الرصيد بعد تأكيد الدفع.");
      }
      await load();
    } catch (cause) {
      console.error("DSH captain Cash-In request failed", cause);
      setError("لم نتأكد من نتيجة طلب الشحن. أعد المحاولة بالمبلغ نفسه لتجنب تكرار الطلب.");
    } finally { setBusy(false); }
  };

  const state = wallet?.state;
  const latest = (wallet?.fundingIntents ?? []).filter((intent) => intent.providerKey !== "DEVELOPMENT_SIMULATOR");
  const userCanAddFunds = Boolean(state?.cashInEnabled && !state.simulator);
  const userHasPending = Boolean(pending && !state?.simulator);
  const fundingStateLabel = (value: CashInFundingIntent["state"]) => ({ PENDING_PROVIDER: "بانتظار تأكيد الدفع", UNKNOWN: "جارٍ التحقق من الدفع", SETTLED: "تم الدفع", FAILED: "لم يكتمل الدفع" })[value];
  return <BthwaniSurface tone="base" style={styles.panel} accessibilityLabel="شحن رصيد الكابتن">
    <Text style={styles.title}>شحن رصيد الكابتن</Text><Text style={styles.muted}>يُستخدم الرصيد المتاح لتسوية المبالغ المعتمدة. لا ينطبق الشحن على كابتن المتجر.</Text>
    {busy && !wallet ? <View style={styles.loading}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الرصيد…</Text></View> : null}
    {state ? <View style={styles.balance}><Text style={styles.label}>المتاح</Text><Text style={styles.amount}>{formatMoney(state.availableMinor, state.currency)}</Text><Text style={styles.muted}>الرصيد الدفتري {formatMoney(state.ledgerBalanceMinor, state.currency)} · المحجوز {formatMoney(state.heldMinor, state.currency)}</Text></View> : null}
    {userCanAddFunds ? <><TextInput accessibilityLabel="مبلغ شحن محفظة الكابتن" editable={!userHasPending && !busy} keyboardType="number-pad" value={amount} onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/[^0-9]/g, ""))} placeholder="المبلغ بالريال اليمني" placeholderTextColor={theme.colorMuted} style={styles.input} /><BthwaniButton busy={busy} disabled={busy} label={userHasPending ? "متابعة طلب الشحن" : "إضافة رصيد"} onPress={() => void createIntent()} /></> : <Text style={styles.muted}>الشحن غير متاح حاليًا.</Text>}
    {userHasPending ? <Text style={styles.notice}>طلب شحن بقيمة {formatMoney(pending!.amountMinor, "YER")} بانتظار التأكيد.</Text> : null}
    {latest.length ? <View style={styles.history}><Text style={styles.label}>آخر طلبات الشحن</Text>{latest.slice(0, 5).map((intent) => <View key={intent.id} style={styles.row}><Text style={styles.muted}>{fundingStateLabel(intent.state)}</Text><Text style={styles.rowAmount}>{formatMoney(intent.amountMinor, intent.currency)}</Text></View>)}</View> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <BthwaniButton busy={busy} disabled={busy} label="تحديث بيانات المحفظة" onPress={() => void load()} variant="secondary" />
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ panel: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] }, title: { ...typography.titleSm, color: theme.color }, label: { ...typography.label, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, balance: { borderColor: theme.borderColor, borderBottomWidth: borders.hairline, gap: spacing[1], paddingBottom: spacing[3] }, amount: { ...typography.titleLg, color: theme.color }, input: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, padding: spacing[3], textAlign: "left", writingDirection: "ltr" }, loading: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, history: { gap: spacing[2] }, row: { borderColor: theme.borderColor, borderTopWidth: borders.hairline, flexDirection: "row", justifyContent: "space-between", paddingTop: spacing[2] }, rowAmount: { ...typography.bodySm, color: theme.color }, notice: { ...typography.bodySm, color: theme.interactiveText }, error: { ...typography.bodySm, color: theme.warning } }); }
