import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, type BeneficiaryWalletResponse, type CashInFundingIntent } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

type FundingAttempt = Readonly<{ version: 1; actorID: string; amountMinor: number; idempotencyKey: string; correlationID: string }>;
const attemptKey = (actorID: string) => `bthwani.client.cash-in.pending.v1.${encodeURIComponent(actorID)}`;
const api = () => {
  const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!url) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(url, { cryptoRandomUUID: () => Crypto.randomUUID() });
};

export function ClientCashInPanel() {
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
      if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) throw new Error("CLIENT_SESSION_REQUIRED");
      const actorID = identity.identity.subject.trim();
      const raw = await SecureStore.getItemAsync(attemptKey(actorID));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<FundingAttempt>;
        if (parsed.version !== 1 || parsed.actorID !== actorID || !Number.isSafeInteger(parsed.amountMinor) || typeof parsed.idempotencyKey !== "string" || typeof parsed.correlationID !== "string") throw new Error("CASH_IN_RETRY_STATE_INVALID");
        setPending(parsed as FundingAttempt);
      } else setPending(null);
      const token = await getUsableIdentityAccessToken();
      setWallet(await api().readOwnWallet(token));
    } catch (cause) {
      console.error("DSH customer wallet readback failed", cause);
      setError("تعذر قراءة رصيد المحفظة وحالة الشحن من الخادم.");
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const createIntent = async () => {
    const identity = currentIdentityState();
    if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) { setError("يلزم تسجيل الدخول لقراءة محفظة العميل."); return; }
    const actorID = identity.identity.subject.trim();
    const parsedAmount = pending?.actorID === actorID ? pending.amountMinor : Number(toAsciiDigits(amount.trim()).replace(/[^0-9]/g, ""));
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) { setError("أدخل مبلغ شحن صحيحًا أكبر من صفر."); return; }
    const attempt: FundingAttempt = pending?.actorID === actorID ? pending : { version: 1, actorID, amountMinor: parsedAmount, idempotencyKey: `cashin_${Crypto.randomUUID()}`, correlationID: `cashin_corr_${Crypto.randomUUID()}` };
    setBusy(true); setError(""); setNotice("");
    try {
      await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(attempt));
      setPending(attempt);
      const token = await getUsableIdentityAccessToken();
      const response = await api().createOwnFundingIntent(token, parsedAmount, attempt.idempotencyKey, attempt.correlationID);
      setAmount("");
      setNotice(response.simulator ? "أنشأ WLT نية شحن تجريبية. لن يُضاف الرصيد قبل تطبيق نتيجة المحاكي." : "سُجلت نية الشحن؛ سيُضاف الرصيد بعد التأكيد الرسمي من مزود المحفظة.");
      await load();
    } catch (cause) {
      console.error("DSH customer Cash-In request failed", cause);
      setError("لم نتأكد من نتيجة طلب الشحن. بقي المفتاح محفوظًا؛ أعد المحاولة للمبلغ نفسه كي لا تنشأ عملية أخرى.");
    } finally { setBusy(false); }
  };

  const simulate = async (intent: CashInFundingIntent, outcome: "SUCCESS" | "FAILURE" | "UNKNOWN" | "DELAYED") => {
    if (!pending || pending.actorID !== intent.actorId || pending.amountMinor !== intent.amountMinor) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await api().simulateOwnFundingIntent(token, intent.id, outcome, `simulate_${pending.idempotencyKey}`, pending.correlationID);
      setNotice(result.intent.state === "SETTLED" ? "نجح الاختبار: WLT رحّل المبلغ إلى دفتر الأستاذ التجريبي." : `حالة الاختبار: ${result.intent.state}.`);
      if (["SETTLED", "FAILED"].includes(result.intent.state)) await SecureStore.deleteItemAsync(attemptKey(pending.actorID));
      await load();
    } catch (cause) {
      console.error("DSH development Cash-In simulation failed", cause);
      setError("تعذر تطبيق نتيجة المحاكي؛ بقيت نية الشحن محفوظة كما هي.");
    } finally { setBusy(false); }
  };

  const state = wallet?.state;
  const latest = wallet?.fundingIntents ?? [];
  return <BthwaniSurface tone="base" style={styles.panel} accessibilityLabel="شحن رصيد العميل">
    <View style={styles.heading}><View><Text style={styles.title}>شحن الرصيد</Text><Text style={styles.muted}>الشحن الخارجي يمول رصيد بثواني الداخلي بعد تأكيد WLT.</Text></View></View>
    {busy && !wallet ? <View style={styles.loading}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الرصيد…</Text></View> : null}
    {state ? <View style={styles.balance}><Text style={styles.label}>الرصيد الداخلي المتاح</Text><Text style={styles.amount}>{formatMoney(state.availableMinor, state.currency)}</Text><Text style={styles.muted}>المحجوز: {formatMoney(state.heldMinor, state.currency)}</Text></View> : null}
    {state?.simulator ? <Text style={styles.simulator}>وضع تطوير: مزود المحاكاة DEVELOPMENT_SIMULATOR. هذه النتائج لا تحرك أموالًا حقيقية.</Text> : null}
    {state?.cashInEnabled ? <><TextInput accessibilityLabel="مبلغ شحن رصيد العميل" editable={!pending && !busy} keyboardType="number-pad" value={amount} onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/[^0-9]/g, ""))} placeholder="المبلغ بالريال اليمني" placeholderTextColor={theme.colorMuted} style={styles.input} /><BthwaniButton busy={busy} disabled={busy} label={pending ? "إعادة محاولة الشحن بالمفتاح نفسه" : "إنشاء طلب شحن"} onPress={() => void createIntent()} /></> : <Text style={styles.muted}>الشحن غير متاح حاليًا؛ لم يُفعّل مزود محفظة رسمي معتمد لهذا المسار.</Text>}
    {pending ? <Text style={styles.notice}>توجد محاولة محفوظة لهذا الحساب بمبلغ {formatMoney(pending.amountMinor, "YER")}. إعادة الطلب تستخدم مفتاح WLT نفسه.</Text> : null}
    {state?.simulator ? latest.filter((item) => ["PENDING_PROVIDER", "UNKNOWN"].includes(item.state)).slice(0, 1).map((intent) => <View key={intent.id} style={styles.simActions}><Text style={styles.label}>نتيجة محاكاة التطوير لطلب {formatMoney(intent.amountMinor, intent.currency)}</Text>{(["SUCCESS", "FAILURE", "UNKNOWN", "DELAYED"] as const).map((outcome) => <BthwaniButton key={outcome} disabled={busy} busy={busy} variant="secondary" label={{ SUCCESS: "محاكاة نجاح", FAILURE: "محاكاة رفض", UNKNOWN: "محاكاة نتيجة مجهولة", DELAYED: "محاكاة انتظار التأكيد" }[outcome]} onPress={() => void simulate(intent, outcome)} />)}</View>) : null}
    {latest.length ? <View style={styles.history}><Text style={styles.label}>آخر طلبات الشحن</Text>{latest.slice(0, 5).map((intent) => <View key={intent.id} style={styles.row}><Text style={styles.muted}>{intent.state}</Text><Text style={styles.rowAmount}>{formatMoney(intent.amountMinor, intent.currency)}</Text></View>)}</View> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <BthwaniButton busy={busy} disabled={busy} label="تحديث بيانات المحفظة" onPress={() => void load()} variant="secondary" />
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ panel: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] }, heading: { flexDirection: "row", justifyContent: "space-between" }, title: { ...typography.titleSm, color: theme.color }, label: { ...typography.label, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, balance: { borderColor: theme.borderColor, borderBottomWidth: borders.hairline, gap: spacing[1], paddingBottom: spacing[3] }, amount: { ...typography.titleLg, color: theme.color }, input: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, padding: spacing[3], textAlign: "left", writingDirection: "ltr" }, loading: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, simulator: { ...typography.bodySm, color: theme.warning }, simActions: { gap: spacing[2] }, history: { gap: spacing[2] }, row: { borderColor: theme.borderColor, borderTopWidth: borders.hairline, flexDirection: "row", justifyContent: "space-between", paddingTop: spacing[2] }, rowAmount: { ...typography.bodySm, color: theme.color }, notice: { ...typography.bodySm, color: theme.interactiveText }, error: { ...typography.bodySm, color: theme.warning } }); }
