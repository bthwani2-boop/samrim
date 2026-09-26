import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { createDshMobileClient, formatMoney, type BeneficiaryWalletResponse, type CashInFundingIntent } from "@bthwani/dsh";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

type FundingAttempt = Readonly<{ version: 1; actorID: string; amountMinor: number; idempotencyKey: string; correlationID: string; fundingIntentID?: string }>;
type PanelMode = "wallet" | "cash-in";

function parseFundingAttempt(raw: string | null, actorID: string): FundingAttempt | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<FundingAttempt>;
  const validFundingIntentID = parsed.fundingIntentID === undefined || (typeof parsed.fundingIntentID === "string" && parsed.fundingIntentID.length > 0 && parsed.fundingIntentID.length <= 128);
  if (
    parsed.version !== 1 ||
    parsed.actorID !== actorID ||
    !Number.isSafeInteger(parsed.amountMinor) ||
    Number(parsed.amountMinor) <= 0 ||
    typeof parsed.idempotencyKey !== "string" ||
    parsed.idempotencyKey.length < 8 ||
    parsed.idempotencyKey.length > 128 ||
    typeof parsed.correlationID !== "string" ||
    parsed.correlationID.length < 8 ||
    parsed.correlationID.length > 128 ||
    !validFundingIntentID
  ) throw new Error("CASH_IN_RETRY_STATE_INVALID");
  return parsed as FundingAttempt;
}

function isTerminalFundingIntent(intent: Pick<CashInFundingIntent, "state">): boolean {
  return intent.state === "SETTLED" || intent.state === "FAILED";
}

function fundingIntentMatchesAttempt(intent: CashInFundingIntent, attempt: FundingAttempt): boolean {
  return intent.id === attempt.fundingIntentID && intent.actorId === attempt.actorID && intent.fundingPurpose === "CUSTOMER_TOPUP" && intent.amountMinor === attempt.amountMinor && intent.currency === "YER";
}

function walletWithFundingIntent(wallet: BeneficiaryWalletResponse, intent: CashInFundingIntent): BeneficiaryWalletResponse {
  return { ...wallet, fundingIntents: [intent, ...wallet.fundingIntents.filter((item) => item.id !== intent.id)] };
}

const attemptKey = (actorID: string) => "bthwani.client.cash-in.pending.v1." + encodeURIComponent(actorID);

const api = () => {
  const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!url) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(url, { cryptoRandomUUID: () => Crypto.randomUUID() });
};

export function ClientCashInPanel({ mode = "wallet", onAddFunds }: { mode?: PanelMode; onAddFunds?: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [wallet, setWallet] = useState<BeneficiaryWalletResponse | null>(null);
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState<FundingAttempt | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    setWallet(null);
    setPending(null);
    try {
      const beforeRestore = currentIdentityState();
      if (beforeRestore.kind !== "authenticated" && beforeRestore.kind !== "restoring") throw new Error("CLIENT_SESSION_REQUIRED");
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) throw new Error("CLIENT_SESSION_REQUIRED");
      const actorID = identity.identity.subject.trim();
      const storageKey = attemptKey(actorID);
      const restoredAttempt = parseFundingAttempt(await SecureStore.getItemAsync(storageKey), actorID);
      setPending(restoredAttempt);
      const walletResponse = await api().readOwnWallet(token);
      setWallet(walletResponse);
      if (!restoredAttempt?.fundingIntentID) return;

      const intent = (await api().readOwnFundingIntent(token, restoredAttempt.fundingIntentID)).intent;
      if (!fundingIntentMatchesAttempt(intent, restoredAttempt)) throw new Error("CASH_IN_RETRY_STATE_CONFLICT");
      setWallet(walletWithFundingIntent(walletResponse, intent));
      if (!isTerminalFundingIntent(intent)) return;
      await SecureStore.deleteItemAsync(storageKey);
      setPending(null);
    } catch {
      setError(currentIdentityState().kind === "authenticated" ? "تعذر تحديث بيانات المحفظة. أعد المحاولة." : "انتهت جلسة الدخول. سجّل الدخول لعرض المحفظة.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createIntent = async () => {
    const identity = currentIdentityState();
    if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) {
      setError("سجّل الدخول للمتابعة.");
      return;
    }
    const actorID = identity.identity.subject.trim();
    const parsedAmount = pending?.actorID === actorID ? pending.amountMinor : Number(toAsciiDigits(amount.trim()).replace(/[^0-9]/g, ""));
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
      setError("أدخل مبلغًا صحيحًا أكبر من صفر.");
      return;
    }
    const attempt: FundingAttempt = pending?.actorID === actorID
      ? pending
      : { version: 1, actorID, amountMinor: parsedAmount, idempotencyKey: "cashin_" + Crypto.randomUUID(), correlationID: "cashin_corr_" + Crypto.randomUUID() };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(attempt));
      setPending(attempt);
      const token = await getUsableIdentityAccessToken();
      const response = await api().createOwnFundingIntent(token, parsedAmount, attempt.idempotencyKey, attempt.correlationID);
      if (
        response.intent.id.trim().length === 0 ||
        response.intent.id.length > 128 ||
        response.intent.actorId !== actorID ||
        response.intent.fundingPurpose !== "CUSTOMER_TOPUP" ||
        response.intent.amountMinor !== parsedAmount ||
        response.intent.currency !== "YER"
      ) throw new Error("CASH_IN_RESPONSE_MISMATCH");

      const confirmedAttempt: FundingAttempt = { ...attempt, fundingIntentID: response.intent.id };
      await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(confirmedAttempt));
      setPending(confirmedAttempt);
      setAmount("");
      if (isTerminalFundingIntent(response.intent)) {
        await SecureStore.deleteItemAsync(attemptKey(actorID));
        setPending(null);
        setNotice(response.intent.state === "SETTLED" ? "تمت إضافة الرصيد." : "لم تتم إضافة الرصيد. يمكنك المحاولة مجددًا.");
      } else {
        setNotice(response.simulator ? "طلب تجريبي؛ لا تُستخدم أموال حقيقية." : "أُرسل الطلب، وسيظهر الرصيد بعد تأكيد الدفع.");
      }
      await load();
    } catch {
      setError(currentIdentityState().kind === "authenticated" ? "لم نتأكد من نتيجة الطلب. أعد المحاولة بالمبلغ نفسه؛ حُفظ مفتاح الطلب لمنع التكرار." : "انتهت جلسة الدخول. سجّل الدخول للمتابعة.");
    } finally {
      setBusy(false);
    }
  };

  const state = wallet?.state;

  if (mode === "wallet") {
    return (
      <BthwaniSurface accessibilityLabel="رصيد المحفظة" style={styles.walletPanel}>
        <View style={styles.balanceCard}>
          <View style={styles.balanceCopy}>
            <Text style={styles.balanceLabel}>رصيدك</Text>
            {state ? <Text accessibilityLabel={"الرصيد " + formatMoney(state.availableMinor, state.currency)} style={styles.balanceValue}>{formatMoney(state.availableMinor, state.currency)}</Text> : <Text style={styles.balanceValue}>{busy ? "…" : "—"}</Text>}
          </View>
          <BthwaniIcon name="wallet" color={theme.interactiveText} size={spacing[6]} />
        </View>
        {pending ? <Text style={styles.pendingCopy}>طلب شحن قيد التأكيد: {formatMoney(pending.amountMinor, "YER")}.</Text> : null}
        {busy && !wallet ? <ActivityIndicator accessibilityLabel="جارٍ قراءة الرصيد" color={theme.actionBackground} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {state?.cashInEnabled
          ? <BthwaniButton disabled={busy} label="＋ إضافة رصيد" onPress={onAddFunds ?? (() => router.push("/wallet-cash-in" as Href))} />
          : state
            ? <Text style={styles.muted}>الشحن غير متاح حاليًا.</Text>
            : error ? <BthwaniButton disabled={busy} label="تحديث" onPress={() => void load()} variant="secondary" /> : null}
      </BthwaniSurface>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.cashInScreen}>
      <View style={styles.topBar}>
        <View style={styles.headerSide} />
        <Text style={styles.pageTitle}>إضافة رصيد</Text>
        <BthwaniButton accessibilityLabel="العودة إلى المحفظة" label="→" onPress={() => router.back()} style={styles.backButton} variant="quiet" />
      </View>
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.amountField}>
          <Text style={styles.amountPrompt}>أضف المبلغ هنا:</Text>
          <View style={styles.amountRow}>
            <Text style={styles.currencyLabel}>ريال يمني</Text>
            <TextInput
              accessibilityLabel="مبلغ الشحن بالريال اليمني"
              editable={!pending && !busy && Boolean(state?.cashInEnabled)}
              keyboardType="number-pad"
              onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/[^0-9]/g, ""))}
              placeholder="0"
              placeholderTextColor={theme.colorMuted}
              style={styles.amountInput}
              value={amount}
            />
          </View>
        </View>

        <Text style={styles.methodPrompt}>اختر وسيلة الدفع ثم اضغط على موافق</Text>
        {state?.cashInEnabled ? (
          <View accessible accessibilityLabel={state.simulator ? "محاكاة الشحن محددة" : "الدفع الإلكتروني محدد"} accessibilityRole="radio" accessibilityState={{ selected: true }} style={styles.methodRow}>
            <View style={styles.methodCopy}>
              <View style={styles.methodIcon}><BthwaniIcon name="wallet" color={theme.interactiveText} size={spacing[6]} /></View>
              <View style={styles.methodText}>
                <Text style={styles.methodTitle}>{state.simulator ? "محاكاة الشحن" : "الدفع الإلكتروني"}</Text>
                {state.simulator ? <Text style={styles.muted}>بيئة تطوير فقط، لا تُستخدم أموال حقيقية.</Text> : null}
              </View>
            </View>
            <View style={styles.radioOuter}><View style={styles.radioInner} /></View>
          </View>
        ) : state ? <Text style={styles.unavailable}>لا توجد وسيلة شحن مفعّلة حاليًا.</Text> : null}

        {busy && !wallet ? <ActivityIndicator accessibilityLabel="جارٍ تحميل وسائل الشحن" color={theme.actionBackground} /> : null}
        {pending ? <Text style={styles.pendingCopy}>لديك طلب محفوظ بقيمة {formatMoney(pending.amountMinor, "YER")}. إعادة المحاولة تستخدم الطلب نفسه.</Text> : null}
        {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!wallet && error ? <BthwaniButton disabled={busy} label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing[3]) }]}>
        <BthwaniButton
          busy={busy}
          disabled={busy || !state?.cashInEnabled}
          label={pending ? "متابعة الطلب" : "موافق"}
          onPress={() => void createIntent()}
        />
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    walletPanel: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[4], marginTop: spacing[4], padding: spacing[4] },
    balanceCard: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, flexDirection: "row", justifyContent: "space-between", minHeight: 96, paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
    balanceCopy: { alignItems: "flex-end", gap: spacing[1] },
    balanceLabel: { ...typography.bodySm, color: theme.colorMuted },
    balanceValue: { ...typography.titleLg, color: theme.color, textAlign: "right" },
    cashInScreen: { backgroundColor: theme.background, flex: 1 },
    topBar: { alignItems: "center", backgroundColor: theme.surface, borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, flexDirection: "row", minHeight: 64, paddingHorizontal: spacing[3] },
    headerSide: { width: spacing[12] },
    pageTitle: { ...typography.titleMd, color: theme.color, flex: 1, textAlign: "center" },
    backButton: { minHeight: spacing[12], width: spacing[12] },
    formContent: { flexGrow: 1, gap: spacing[4], padding: spacing[4] },
    amountField: { backgroundColor: theme.surface, borderColor: theme.borderColorStrong, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[3] },
    amountPrompt: { ...typography.bodySm, color: theme.colorMuted, textAlign: "right" },
    amountRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: spacing[10] },
    currencyLabel: { ...typography.body, color: theme.colorMuted },
    amountInput: { ...typography.titleMd, color: theme.color, flex: 1, minHeight: spacing[10], padding: 0, textAlign: "right", writingDirection: "ltr" },
    methodPrompt: { ...typography.body, color: theme.color, marginTop: spacing[2], textAlign: "right" },
    methodRow: { alignItems: "center", backgroundColor: theme.actionSoft, borderColor: theme.interactiveText, borderRadius: radius.md, borderWidth: borders.hairline, flexDirection: "row", justifyContent: "space-between", minHeight: 76, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    methodCopy: { alignItems: "center", flex: 1, flexDirection: "row", gap: spacing[3], minWidth: 0 },
    methodIcon: { alignItems: "center", backgroundColor: theme.surface, borderRadius: radius.md, height: spacing[10], justifyContent: "center", width: spacing[10] },
    methodText: { flex: 1, gap: spacing[1], minWidth: 0 },
    methodTitle: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    radioOuter: { alignItems: "center", borderColor: theme.interactiveText, borderRadius: radius.round, borderWidth: 2, height: spacing[6], justifyContent: "center", marginStart: spacing[3], width: spacing[6] },
    radioInner: { backgroundColor: theme.interactiveText, borderRadius: radius.round, height: spacing[3], width: spacing[3] },
    unavailable: { ...typography.bodySm, color: theme.colorMuted, textAlign: "right" },
    pendingCopy: { ...typography.bodySm, color: theme.interactiveText, textAlign: "right" },
    notice: { ...typography.bodySm, color: theme.interactiveText, textAlign: "right" },
    error: { ...typography.bodySm, color: theme.danger, textAlign: "right" },
    muted: { ...typography.caption, color: theme.colorMuted, textAlign: "right" },
    footer: { backgroundColor: theme.surface, borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, paddingHorizontal: spacing[4], paddingTop: spacing[3] },
  });
}
