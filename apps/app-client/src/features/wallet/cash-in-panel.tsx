import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type BeneficiaryWalletResponse, type CashInFundingIntent, type CashInSimulatorOutcome, type WalletProvider, cashInSimulatorMutationHeaders, cashInSimulatorOptions, cashInSimulatorStateMatches, createDshMobileClient, formatMoney } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import * as SecureStore from "../../bootstrap/compatible-storage";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, AppState, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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
  return intent.actorType === "customer" && intent.id === attempt.fundingIntentID && intent.actorId === attempt.actorID && intent.fundingPurpose === "CUSTOMER_TOPUP" && intent.amountMinor === attempt.amountMinor && intent.currency === "YER";
}

function walletWithFundingIntent(wallet: BeneficiaryWalletResponse, intent: CashInFundingIntent): BeneficiaryWalletResponse {
  return { ...wallet, fundingIntents: [intent, ...wallet.fundingIntents.filter((item) => item.id !== intent.id)] };
}

const attemptKey = (actorID: string) => "bthwani.client.cash-in.pending.v1." + encodeURIComponent(actorID);

// Keep media under the DSH origin reachable by the actual Android device.
function providerLogoUri(uri: string): string {
  const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!base || !uri) return uri;
  try {
    const original = new URL(uri);
    if (!original.pathname.startsWith("/dsh/catalog/media/wallet-providers/logos/")) return uri;
    return new URL(original.pathname, base).toString();
  } catch {
    return uri;
  }
}

const api = () => {
  const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!url) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(url, { cryptoRandomUUID: () => Crypto.randomUUID() });
};

export function ClientCashInPanel({ mode = "wallet", onAddFunds, initialAmountMinor = 0, returnToCheckout = false }: {
  mode?: PanelMode; onAddFunds?: () => void; initialAmountMinor?: number; returnToCheckout?: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [wallet, setWallet] = useState<BeneficiaryWalletResponse | null>(null);
  const [amount, setAmount] = useState(() => Number.isSafeInteger(initialAmountMinor) && initialAmountMinor > 0 ? String(initialAmountMinor) : "");
  const [lastSettledAmount,setLastSettledAmount]=useState<number|null>(null);
  const [pending, setPending] = useState<FundingAttempt | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [simulatorOutcome, setSimulatorOutcome] = useState<CashInSimulatorOutcome>("SUCCESS");
  const [selectedProviderKey, setSelectedProviderKey] = useState("");
  const [providers, setProviders] = useState<ReadonlyArray<WalletProvider>>([]);
  const [providersStatus, setProvidersStatus] = useState<"loading" | "ready" | "error">("loading");

  const loadProviders = useCallback(async () => {
    setProvidersStatus((previous) => previous === "ready" ? "ready" : "loading");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await api().listWalletProviders(token);
      setProviders(response.walletProviders.filter((provider) => provider.active));
      setProvidersStatus("ready");
    } catch {
      // A transient network error must not erase already displayed logos.
      setProvidersStatus((previous) => previous === "ready" ? "ready" : "error");
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadProviders();
    // Focused wallet: refresh the tiny public index, no restart required.
    // Also refresh immediately when Android resumes from the background.
    const listener = AppState.addEventListener("change", (next) => {
      if (next === "active") void loadProviders();
    });
    const refresh = setInterval(() => {
      if (AppState.currentState === "active") void loadProviders();
    }, 5000);
    return () => { clearInterval(refresh); listener.remove(); };
  }, [mode, loadProviders]));

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

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const simulatorInDevelopment = Boolean(__DEV__ && wallet?.state.simulator && wallet.state.cashInEnabled);

  const createIntent = async () => {
    if (wallet?.state.simulator && !simulatorInDevelopment) {
      setError("المحاكي متاح للتطوير فقط.");
      return;
    }
    if (!pending && (!simulatorInDevelopment || selectedProviderKey !== "DEVELOPMENT_SIMULATOR")) {
      setError("اختر وسيلة شحن متصلة. المزودون الخارجيون غير مربوطين بعملية الشحن بعد.");
      return;
    }
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
      const client = api();
      const response = pending?.fundingIntentID
        ? { intent: (await client.readOwnFundingIntent(token, pending.fundingIntentID)).intent, simulator: simulatorInDevelopment }
        : await client.createOwnFundingIntent(token, parsedAmount, attempt.idempotencyKey, attempt.correlationID);
      let intent = response.intent;
      if (!intent.id.trim() || intent.id.length > 128 ||
          intent.actorType !== "customer" || intent.actorId !== actorID ||
          intent.fundingPurpose !== "CUSTOMER_TOPUP" ||
          intent.amountMinor !== parsedAmount || intent.currency !== "YER" ||
          (pending?.fundingIntentID && intent.id !== pending.fundingIntentID)) throw new Error("CASH_IN_RESPONSE_MISMATCH");
      const confirmed: FundingAttempt = { ...attempt, fundingIntentID: intent.id };
      await SecureStore.setItemAsync(attemptKey(actorID), JSON.stringify(confirmed));
      setPending(confirmed);
      setAmount("");
      if (simulatorInDevelopment && response.simulator && !isTerminalFundingIntent(intent)) {
        const headers = cashInSimulatorMutationHeaders(attempt, simulatorOutcome);
        const result = await client.simulateOwnFundingIntent(
          token, intent.id, simulatorOutcome,
          headers.idempotencyKey, headers.correlationID,
        );
        const current = currentIdentityState();
        if (current.kind !== "authenticated" || current.identity.subject.trim() !== actorID) throw new Error("CASH_IN_SESSION_CHANGED");
        if (result.intent.id !== intent.id || result.intent.actorId !== actorID ||
            result.intent.amountMinor !== parsedAmount || result.intent.fundingPurpose !== "CUSTOMER_TOPUP" ||
            !cashInSimulatorStateMatches(simulatorOutcome, result.intent.state)) {
          throw new Error("CASH_IN_SIMULATOR_READBACK_MISMATCH");
        }
        intent = result.intent;
      }
      if (isTerminalFundingIntent(intent)) {
        if (intent.state === "SETTLED") {
          const confirmedWallet = await client.readOwnWallet(token);
          if (confirmedWallet.state.actorId !== actorID ||
              !confirmedWallet.fundingIntents.some((entry) => entry.id === intent.id && entry.state === "SETTLED")) {
            throw new Error("CASH_IN_LEDGER_READBACK_MISMATCH");
          }
          setLastSettledAmount(parsedAmount);
        }
        await SecureStore.deleteItemAsync(attemptKey(actorID));
        setPending(null);
        setNotice(intent.state === "SETTLED" ? "تمت إضافة الرصيد." : "فشل الشحن؛ لم يضاف رصيد.");
      } else {
        setNotice(simulatorInDevelopment ? "النتيجة غير محسومة؛ يمكن متابعة الطلب نفسه." : "بانتظار تأكيد مزود الدفع.");
      }
      await load();
    } catch {
      setError(currentIdentityState().kind === "authenticated" ? "لم نتأكد من نتيجة الطلب. أعد المحاولة بالمبلغ نفسه لتجنب تكرار الخصم." : "انتهت جلسة الدخول. سجّل الدخول للمتابعة.");
    } finally {
      setBusy(false);
    }
  };

  const state = wallet?.state;
  const recentCompensations = (state as (BeneficiaryWalletResponse["state"] & { recentCompensations?: ReadonlyArray<{ id: string; orderId: string; amountMinor: number; currency: "YER"; createdAt: string }> }) | undefined)?.recentCompensations ?? [];
  const userCanAddFunds = Boolean(state?.cashInEnabled && (!state.simulator || __DEV__));
  const userHasPending = Boolean(pending);

  if (mode === "wallet") {
    return (
      <BthwaniSurface accessibilityLabel="رصيد المحفظة" style={styles.walletPanel}>
        <View style={styles.balanceCard}>
          <View style={styles.balanceCopy}>
            <Text style={styles.balanceLabel}>الرصيد المتاح</Text>
            {state ? <Text accessibilityLabel={"الرصيد " + formatMoney(state.availableMinor, state.currency)} style={styles.balanceValue}>{formatMoney(state.availableMinor, state.currency)}</Text> : <Text style={styles.balanceValue}>{busy ? "…" : "—"}</Text>}
          </View>
          <BthwaniIcon name="wallet" color={theme.interactiveText} size={spacing[6]} />
        </View>
        <View style={styles.providersSection}>
          <Text style={styles.muted}>المحافظ الرسمية متاحة للعرض فقط. الشحن التجريبي مستقل عن التحويلات الفعلية.</Text>
          <Text style={styles.providersTitle}>المحافظ المعتمدة</Text>
          {providersStatus === "loading" ? <ActivityIndicator accessibilityLabel="جارٍ قراءة المحافظ المعتمدة" color={theme.actionBackground} /> : null}
          {providersStatus === "ready" && providers.length > 0 ? <View style={styles.providersGrid}>
            {providers.map((provider) => <View key={provider.key} style={styles.providerItem} accessibilityLabel={`مزود محفظة نشط: ${provider.displayNameAr}`}>
              {provider.logoUri ? <Image key={provider.logoUri} source={{uri:providerLogoUri(provider.logoUri)}} accessibilityLabel={"شعار "+provider.displayNameAr} style={styles.providerLogo} resizeMode="contain" /> : <BthwaniIcon name="wallet" color={theme.interactiveText} size={spacing[5]} />}
              <Text style={styles.providerName} numberOfLines={2}>{provider.displayNameAr}</Text>
            </View>)}
          </View> : null}
          {providersStatus === "ready" && providers.length === 0 ? <Text style={styles.muted}>لا توجد محافظ معتمدة حاليًا.</Text> : null}
          {providersStatus === "error" ? <BthwaniButton label="تعذر قراءة المحافظ — إعادة المحاولة" onPress={() => void loadProviders()} variant="secondary" /> : null}
        </View>
        {wallet?.fundingIntents?.length ? <View style={styles.walletCredits}><Text style={styles.creditHeading}>آخر عمليات الشحن</Text>{wallet.fundingIntents.slice(0,5).map((intent)=><View key={intent.id} style={styles.walletCredit}><Text style={styles.creditAmount}>{formatMoney(intent.amountMinor,intent.currency)}</Text><Text style={styles.muted}>{intent.state==="SETTLED"?"تم الشحن":intent.state==="FAILED"?"تعذر الشحن":"قيد المعالجة"}</Text></View>)}</View> : null}
        {recentCompensations.length ? <View style={styles.walletCredits}>
          <Text style={styles.creditHeading}>تعويضات أُضيفت إلى محفظتك</Text>
          {recentCompensations.map((credit) => <View key={credit.id} style={styles.walletCredit}>
            <Text style={styles.creditAmount}>+ {formatMoney(credit.amountMinor, credit.currency)}</Text>
            <Text style={styles.muted}>تعويض عن الطلب {credit.orderId}</Text>
          </View>)}
        </View> : null}
        {userHasPending ? <Text style={styles.pendingCopy}>طلب شحن قيد التأكيد: {formatMoney(pending!.amountMinor, "YER")}.</Text> : null}
        {busy && !wallet ? <ActivityIndicator accessibilityLabel="جارٍ قراءة الرصيد" color={theme.actionBackground} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {userCanAddFunds ? <BthwaniButton disabled={busy} label="＋ إضافة رصيد" onPress={onAddFunds ?? (() => router.push("/wallet-cash-in" as Href))} /> : null}
        {simulatorInDevelopment ? <Text style={styles.muted}>شحن تجريبي — لا توجد أموال حقيقية.</Text> : null}
        {!userCanAddFunds && state ? <Text style={styles.muted}>شحن الرصيد غير متاح حاليًا.</Text> : null}
        {!state && error ? <BthwaniButton disabled={busy} label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /> : null}
      </BthwaniSurface>
    );
  }

  if(mode==="cash-in" && lastSettledAmount!==null){
    return <SafeAreaView edges={["top"]} style={[styles.cashInScreen,styles.successPage]}>
      <BthwaniIcon name="wallet" color={theme.interactiveText} size={spacing[12]} />
      <Text accessibilityRole="header" style={styles.pageTitle}>تمت إضافة الرصيد التجريبي</Text>
      <Text style={styles.balanceValue}>{formatMoney(lastSettledAmount,"YER")}</Text>
      <Text style={styles.muted}>تمت التسوية في بيئة التطوير دون تحويل أي أموال حقيقية.</Text>
      <BthwaniButton label={returnToCheckout ? "العودة لتأكيد الطلب" : "العودة إلى المحفظة"} onPress={() => {
        if (returnToCheckout && router.canGoBack()) router.back();
        else router.replace("/wallet" as Href);
      }} />
    </SafeAreaView>;
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
              editable={!userHasPending && !busy && userCanAddFunds}
              keyboardType="number-pad"
              onChangeText={(value) => setAmount(toAsciiDigits(value).replace(/[^0-9]/g, ""))}
              placeholder="0"
              placeholderTextColor={theme.colorMuted}
              style={styles.amountInput}
              value={amount}
            />
          </View>
        </View>

        {!userHasPending && userCanAddFunds ? <View style={styles.amountPresets}>
          {[1000,5000,10000,50000].map((value)=><Pressable key={value} accessibilityRole="button" accessibilityLabel={"اختيار "+value+" ريال"} onPress={()=>setAmount(String(value))} style={[styles.amountPreset,Number(amount)===value && styles.amountPresetSelected]}><Text style={styles.amountPresetText}>{value.toLocaleString("en-US")}</Text></Pressable>)}
        </View> : null}
        <Text style={styles.methodPrompt}>مزود الشحن</Text>
        {providersStatus === "loading" ? <ActivityIndicator accessibilityLabel="جارٍ قراءة مزودي الشحن" color={theme.actionBackground} /> : null}
        {providersStatus === "ready" && providers.length ? <View style={styles.providersGrid}>
          {providers.map((provider) => <View key={provider.key} accessible accessibilityLabel={provider.displayNameAr + "، غير متصل بالشحن"} style={[styles.providerItem, styles.providerUnavailable]}>
            {provider.logoUri ? <Image source={{ uri: providerLogoUri(provider.logoUri) }} style={styles.providerLogo} resizeMode="contain" /> : <BthwaniIcon name="wallet" color={theme.interactiveText} size={spacing[5]} />}
            <View style={styles.providerCopy}><Text style={styles.providerName} numberOfLines={1}>{provider.displayNameAr}</Text><Text style={styles.muted}>غير متصل بالشحن</Text></View>
          </View>)}
        </View> : null}
        {providersStatus === "error" ? <BthwaniButton label="إعادة قراءة المزودين" variant="secondary" onPress={() => void loadProviders()} /> : null}
        {providersStatus === "ready" && !providers.length ? <Text style={styles.muted}>لا يوجد مزود دفع متصل.</Text> : null}
        {simulatorInDevelopment ? <Pressable accessibilityRole="radio" accessibilityState={{ selected: selectedProviderKey === "DEVELOPMENT_SIMULATOR" }}
          onPress={() => setSelectedProviderKey("DEVELOPMENT_SIMULATOR")} style={[styles.methodRow, selectedProviderKey !== "DEVELOPMENT_SIMULATOR" && styles.providerUnavailable]}>
          <Text style={styles.methodTitle}>محاكي WLT — اختبار فقط</Text>
          <Text style={styles.methodTitle}>{selectedProviderKey === "DEVELOPMENT_SIMULATOR" ? "◉" : "○"}</Text>
        </Pressable> : null}
        <Text style={styles.methodPrompt}>{simulatorInDevelopment ? "تأكيد محاكاة الشحن" : "الشحن الإلكتروني"}</Text>
        {simulatorInDevelopment ? <View accessibilityLabel="نتيجة محاكاة الدفع" style={styles.simOptions}>
          {cashInSimulatorOptions.map((option) => <Pressable key={option.outcome} accessibilityRole="radio"
            accessibilityState={{ selected: simulatorOutcome === option.outcome }} onPress={() => setSimulatorOutcome(option.outcome)}
            style={[styles.simOption, simulatorOutcome === option.outcome && styles.simOptionSelected]}>
            <Text style={styles.simOptionText}>{option.label}</Text>
          </Pressable>)}
        </View> : null}
        {userCanAddFunds && !simulatorInDevelopment ? (
          <View accessible accessibilityLabel="طلب تمويل خارجي — يتطلب الربط الفعلي" style={styles.methodRow}>
            <View style={styles.methodCopy}>
              <View style={styles.methodIcon}><BthwaniIcon name="wallet" color={theme.interactiveText} size={spacing[6]} /></View>
              <View style={styles.methodText}>
                <Text style={styles.methodTitle}>{simulatorInDevelopment ? "محاكي WLT — دون دفع حقيقي" : "الدفع الإلكتروني"}</Text>
              </View>
            </View>
            <View style={styles.radioOuter}><View style={styles.radioInner} /></View>
          </View>
        ) : null}
        {!userCanAddFunds && state ? <Text style={styles.unavailable}>الشحن غير متاح حاليًا.</Text> : null}

        {busy && !wallet ? <ActivityIndicator accessibilityLabel="جارٍ تحميل وسائل الشحن" color={theme.actionBackground} /> : null}
        {userHasPending ? <Text style={styles.pendingCopy}>لديك طلب محفوظ بقيمة {formatMoney(pending!.amountMinor, "YER")}، وسيظهر الرصيد بعد تأكيد الدفع.</Text> : null}
        {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!wallet && error ? <BthwaniButton disabled={busy} label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing[3]) }]}>
        <BthwaniButton
          busy={busy}
          disabled={busy || !userCanAddFunds || (!userHasPending && (!simulatorInDevelopment || selectedProviderKey !== "DEVELOPMENT_SIMULATOR"))}
          label={simulatorInDevelopment ? userHasPending ? "متابعة المحاكاة" : "متابعة شحن تجريبي" : "مزود دفع غير متصل"}
          onPress={() => void createIntent()}
        />
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    walletPanel: { borderRadius: radius.xl, gap: spacing[4], marginTop: spacing[3], padding: spacing[3] },
    providersSection: { gap: spacing[3] },
    providersTitle: { ...typography.titleSm, color: theme.color, textAlign: "right" },
    providersGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing[2] },
    providerItem: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[2], minHeight: 64, padding: spacing[3], width: "48%" },
    providerName: { ...typography.bodyStrong, color: theme.color, flex: 1, textAlign: "right" },
    providerLogo:{width:38,height:38,borderRadius:radius.sm,backgroundColor:theme.surface},
    providerUnavailable: { opacity: 0.7 },
    providerCopy: { flex: 1, gap: spacing[1] },
    amountPresets:{flexDirection:"row",flexWrap:"wrap",gap:spacing[2]},
    amountPreset:{paddingVertical:spacing[2],paddingHorizontal:spacing[3],borderRadius:radius.md,borderWidth:borders.hairline,borderColor:theme.borderColor,minHeight:44,justifyContent:"center"},
    amountPresetSelected:{backgroundColor:theme.actionSoft,borderColor:theme.interactiveText},
    amountPresetText:{...typography.bodySm,color:theme.color},
    successPage:{alignItems:"center",justifyContent:"center",gap:spacing[5],padding:spacing[4]},
    walletCredits: { gap: spacing[2] },
    walletCredit: { backgroundColor: theme.actionSoft, borderRadius: radius.md, gap: spacing[1], padding: spacing[3] },
    creditHeading: { ...typography.titleSm, color: theme.color, textAlign: "right" },
    creditAmount: { ...typography.bodyStrong, color: theme.interactiveText, textAlign: "right" },
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
    simOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    simOption: { alignItems: "center", justifyContent: "center", borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.md, minHeight: 44, padding: spacing[2], width: "47%" },
    simOptionSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    simOptionText: { ...typography.bodySm, color: theme.color },
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
