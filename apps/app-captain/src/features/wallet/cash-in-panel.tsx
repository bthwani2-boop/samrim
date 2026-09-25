import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type BeneficiaryWalletResponse, type CashInFundingIntent } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "../captain-operations/captain-client";

type FundingAttempt = Readonly<{ version: 1; actorID: string; amountMinor: number; idempotencyKey: string; correlationID: string }>;
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
      const raw = await SecureStore.getItemAsync(attemptKey(actorID));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<FundingAttempt>;
        if (parsed.version !== 1 || parsed.actorID !== actorID || !Number.isSafeInteger(parsed.amountMinor) || typeof parsed.idempotencyKey !== "string" || typeof parsed.correlationID !== "string") throw new Error("CASH_IN_RETRY_STATE_INVALID");
        setPending(parsed as FundingAttempt);
      } else setPending(null);
      const token = await getUsableIdentityAccessToken();
      setWallet(await captainClient().readOwnWallet(token));
    } catch (cause) {
      console.error("DSH captain wallet readback failed", cause);
      setError("تعذر قراءة رصيد الكابتن وحالة الشحن من الخادم.");
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
      setAmount("");
      setNotice(response.simulator ? "أنشأ WLT نية شحن تجريبية. لن يُضاف الرصيد قبل تطبيق نتيجة المحاكي." : "سُجلت نية الشحن؛ سيُضاف الرصيد بعد التأكيد الرسمي من مزود المحفظة.");
      await load();
    } catch (cause) {
      console.error("DSH captain Cash-In request failed", cause);
      setError("لم نتأكد من نتيجة طلب الشحن. بقي المفتاح محفوظًا؛ أعد المحاولة للمبلغ نفسه كي لا تنشأ عملية أخرى.");
    } finally { setBusy(false); }
  };

  const simulate = async (intent: CashInFundingIntent, outcome: "SUCCESS" | "FAILURE" | "UNKNOWN" | "DELAYED") => {
    if (!pending || pending.actorID !== intent.actorId || pending.amountMinor !== intent.amountMinor) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await captainClient().simulateOwnFundingIntent(token, intent.id, outcome, `simulate_${intent.id}_${outcome}`, `simulate_corr_${intent.id}`);
      setNotice(result.intent.state === "SETTLED" ? "نجح الاختبار: رحّل WLT المبلغ إلى دفتر الأستاذ التجريبي." : `حالة الاختبار: ${result.intent.state}.`);
      if (["SETTLED", "FAILED"].includes(result.intent.state)) await SecureStore.deleteItemAsync(attemptKey(pending.actorID));
      await load();
    } catch (cause) {
      console.error("DSH captain development Cash-In simulation failed", cause);
      setError("تعذر تطبيق نتيجة المحاكي؛ بقيت نية الشحن محفوظة كما هي.");
    } finally { setBusy(false); }
  };

  const state = wallet?.state;
  const latest = wallet?.fundingIntents ?? [];
  return <BthwaniSurface tone="base" style={styles.panel} accessibilityLabel="شحن رصيد الكابتن">
    <Text style={styles.title}>شحن رصيد الكابتن</Text><Text style={styles.muted}>يُستخدم الرصيد الداخلي لتغطية التعرضات المالية التي يعتمدها WLT. كابتن الشريك غير مشمول.</Text>
    {busy && !wallet ? <View style={styles.loading}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الرصيد…</Text></View> : null}
    {state ? <View style={styles.balance}><Text style={styles.label}>المتاح</Text><Text style={styles.amount}>{formatMoney(state.availableMinor, state.currency)}</Text><Text style={styles.muted}>الرصيد الدفتري {formatMoney(state.ledgerBalanceMinor, state.currency)} · المحجوز {formatMoney(state.heldMinor, state.currency)}</Text></View> : null}
    {state?.simulator ? <Text style={styles.simulator}>وضع تطوير: DEVELOPMENT_SIMULATOR. لا توجد أموال حقيقية في هذا المسار.</Text> : null}
    {state?.cashInEnabled ? <><TextInput accessibilityLabel="مبلغ شحن محفظة الكابتن" editable={!pending && !busy} keyboardType="number-pad" value={amount} onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/[^0-9]/g, ""))} placeholder="المبلغ بالريال اليمني" placeholderTextColor={theme.colorMuted} style={styles.input} /><BthwaniButton busy={busy} disabled={busy} label={pending ? "إعادة المحاولة بالمفتاح نفسه" : "إنشاء طلب شحن"} onPress={() => void createIntent()} /></> : <Text style={styles.muted}>الشحن غير متاح؛ لا يوجد مزود رسمي معتمد مفعّل حاليًا.</Text>}
    {pending ? <Text style={styles.notice}>محاولة محفوظة بقيمة {formatMoney(pending.amountMinor, "YER")}؛ ستُعاد بنفس مفتاح WLT عند المحاولة.</Text> : null}
    {state?.simulator ? latest.filter((item) => ["PENDING_PROVIDER", "UNKNOWN"].includes(item.state)).slice(0, 1).map((intent) => <View key={intent.id} style={styles.actions}><Text style={styles.label}>محاكاة نتيجة الطلب</Text>{(["SUCCESS", "FAILURE", "UNKNOWN", "DELAYED"] as const).map((outcome) => <BthwaniButton key={outcome} busy={busy} disabled={busy} variant="secondary" label={{ SUCCESS: "محاكاة نجاح", FAILURE: "محاكاة رفض", UNKNOWN: "نتيجة مجهولة", DELAYED: "تأخير التأكيد" }[outcome]} onPress={() => void simulate(intent, outcome)} />)}</View>) : null}
    {latest.length ? <View style={styles.history}><Text style={styles.label}>آخر طلبات الشحن</Text>{latest.slice(0, 5).map((intent) => <View key={intent.id} style={styles.row}><Text style={styles.muted}>{intent.state}</Text><Text style={styles.rowAmount}>{formatMoney(intent.amountMinor, intent.currency)}</Text></View>)}</View> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <BthwaniButton busy={busy} disabled={busy} label="تحديث بيانات المحفظة" onPress={() => void load()} variant="secondary" />
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ panel: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] }, title: { ...typography.titleSm, color: theme.color }, label: { ...typography.label, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, balance: { borderColor: theme.borderColor, borderBottomWidth: borders.hairline, gap: spacing[1], paddingBottom: spacing[3] }, amount: { ...typography.titleLg, color: theme.color }, input: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, padding: spacing[3], textAlign: "left", writingDirection: "ltr" }, loading: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, simulator: { ...typography.bodySm, color: theme.warning }, actions: { gap: spacing[2] }, history: { gap: spacing[2] }, row: { borderColor: theme.borderColor, borderTopWidth: borders.hairline, flexDirection: "row", justifyContent: "space-between", paddingTop: spacing[2] }, rowAmount: { ...typography.bodySm, color: theme.color }, notice: { ...typography.bodySm, color: theme.interactiveText }, error: { ...typography.bodySm, color: theme.warning } }); }
