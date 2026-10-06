import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, type PartnerPayoutRequestCreateRequest, type PartnerPayoutRequestView, type PartnerPayoutStoreAmount, type BeneficiaryPayoutState } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { usePartnerStoreScope } from "../partner-onboarding/partner-store-scope-context";

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

type PayoutMode = "FULL_AVAILABLE" | "SPECIFIED";

type PayoutAttempt = Readonly<{ mode: PayoutMode; storeAmounts?: ReadonlyArray<{ storeId: string; amountMinor: number }>; idempotencyKey: string; correlationID: string }>;

export function PartnerPayoutCard() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const storeScope = usePartnerStoreScope();
  const [state, setState] = useState<BeneficiaryPayoutState | null>(null);
  const [mode, setMode] = useState<PayoutMode>("FULL_AVAILABLE");
  const [storeAmounts, setStoreAmounts] = useState<Readonly<Record<string, string>>>({});
  const [lastRequest, setLastRequest] = useState<PartnerPayoutRequestView | null>(null);
  const [busy, setBusy] = useState(authenticated);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAttempt, setPendingAttempt] = useState<PayoutAttempt | null>(null);

  // The request scope is the actor's payout_request authority: owned Stores plus
  // active payout_request grants. Server-side authorization re-verifies every Store.
  const payoutStores = useMemo(() => storeScope.stores.filter((store) => store.owned || store.permissions.includes("payout_request")), [storeScope.stores]);
  const storeNames = useMemo(() => Object.fromEntries(storeScope.stores.map((store) => [store.id, store.name])), [storeScope.stores]);
  const ownsEveryPayoutStore = payoutStores.length > 0 && payoutStores.every((store) => store.owned);

  const load = useCallback(async () => {
    if (!authenticated) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const actor = currentIdentityState();
      if (actor.kind === "authenticated") {
        const raw = await SecureStore.getItemAsync(`bthwani.partner.payout.pending.v2.${encodeURIComponent(actor.identity.subject)}`);
        if (raw) setPendingAttempt(JSON.parse(raw) as PayoutAttempt);
      }
      setState((await client().readOwnPayoutState(token)).state);
    } catch (cause) {
      console.error("DSH partner payout state readback failed", cause);
      setError("تعذر قراءة حالة طلب التسوية.");
    } finally { setBusy(false); }
  }, [authenticated]);
  useEffect(() => { void load(); }, [load]);

  const request = async (requestMode?: PayoutMode) => {
    const effectiveMode = pendingAttempt?.mode ?? requestMode ?? mode;
    const amounts: Array<{ storeId: string; amountMinor: number }> = pendingAttempt?.storeAmounts
      ? [...pendingAttempt.storeAmounts]
      : payoutStores.flatMap((store) => {
          const raw = toAsciiDigits(storeAmounts[store.id] ?? "").replace(/[^0-9]/g, "");
          const parsed = Number(raw);
          if (effectiveMode !== "SPECIFIED" || !Number.isSafeInteger(parsed) || parsed <= 0) return [];
          return [{ storeId: store.id, amountMinor: parsed }];
        });
    if (effectiveMode === "SPECIFIED" && amounts.length === 0) {
      setError("أدخل مبلغًا صحيحًا لمتجر واحد على الأقل.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const actor = currentIdentityState();
      if (actor.kind !== "authenticated" || !actor.identity.subject.trim()) throw new Error("PARTNER_SESSION_REQUIRED");
      const storageKey = `bthwani.partner.payout.pending.v2.${encodeURIComponent(actor.identity.subject)}`;
      const attempt = pendingAttempt ?? {
        mode: effectiveMode,
        ...(effectiveMode === "SPECIFIED" ? { storeAmounts: amounts } : {}),
        idempotencyKey: `partner_payout_${Crypto.randomUUID()}`,
        correlationID: `partner_payout_corr_${Crypto.randomUUID()}`,
      };
      await SecureStore.setItemAsync(storageKey, JSON.stringify(attempt));
      setPendingAttempt(attempt);
      const body: PartnerPayoutRequestCreateRequest = {
        scopeMode: attempt.mode,
        ...(ownsEveryPayoutStore && attempt.mode === "FULL_AVAILABLE" ? {} : { storeIds: payoutStores.map((store) => store.id) }),
        ...(attempt.storeAmounts ? { storeAmounts: attempt.storeAmounts.map((store) => ({ storeId: store.storeId, amountMinor: store.amountMinor })) } : {}),
      };
      const response = await client().createPartnerPayoutRequest(token, body, attempt.idempotencyKey, attempt.correlationID);
      await SecureStore.deleteItemAsync(storageKey);
      setPendingAttempt(null);
      setLastRequest(response.request);
      setNotice(`سُجّل طلب التسوية وقُسّم إلى ${response.request.payouts.length} حوالة وفق مستلمي المتاجر؛ المبلغ الآن في الحجز للمراجعة.`);
      setStoreAmounts({});
      await load();
    } catch (cause) {
      console.error("DSH partner payout request failed", cause);
      setError(pendingAttempt ? "لم نتأكد من نتيجة الطلب؛ أعد الإرسال بالمفتاح المحفوظ قبل إنشاء طلب جديد." : "تعذر تسجيل طلب التسوية. تأكد من توفر وجهة محفظة رسمية معتمدة لكل مستلم ورصيد مستحق.");
      setBusy(false);
    }
  };

  const destinationReady = state?.destination?.status === "ACTIVE_FOR_PAYOUT" && state.destination.verificationStatus === "VERIFIED";
  return <BthwaniSurface tone="base" style={styles.card} accessibilityLabel="طلب تسوية الشريك">
    <Text style={styles.eyebrow}>التسوية المالية</Text>
    <Text style={styles.title}>التسوية إلى المحافظ الرسمية</Text>
    {busy && !state ? <View style={styles.loading}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة حالة التسوية…</Text></View> : null}
    {state ? <>
      <Text style={styles.muted}>{destinationReady ? `وجهتك المعتمدة: ${state.destination?.walletIdentifierMasked}` : "لا توجد وجهة محفظة رسمية معتمدة بعد؛ تتم إدارتها من لوحة التحكم. لكل مستلم موظف وجهته الموثقة الخاصة."}</Text>
      <View style={styles.metrics}>
        <Text style={styles.metric}>المتاح للتسوية: {formatMoney(state.eligibleAvailableMinor, state.currency)}</Text>
        <Text style={styles.metric}>المحجوز: {formatMoney(state.heldMinor, state.currency)}</Text>
      </View>
      {pendingAttempt ? <View style={styles.pendingBox}>
        <Text style={styles.muted}>طلب سابق قيد التحقق؛ أعد الإرسال بنفس المفتاح لمنع تكرار الحجز.</Text>
        <BthwaniButton busy={busy} label="التحقق من الطلب المحفوظ" onPress={() => void request()} />
      </View> : destinationReady && state.eligibleAvailableMinor > 0 && payoutStores.length > 0 ? <>
        <View style={styles.modeRow}>
          <BthwaniChip disabled={busy} label="كل المتاح المصرح به" onPress={() => setMode("FULL_AVAILABLE")} selected={mode === "FULL_AVAILABLE"} />
          <BthwaniChip disabled={busy} label="مبالغ محددة لكل متجر" onPress={() => setMode("SPECIFIED")} selected={mode === "SPECIFIED"} />
        </View>
        {mode === "SPECIFIED" ? <View style={styles.amounts}>
          {payoutStores.map((store) => <View key={store.id} style={styles.amountRow}>
            <Text style={styles.amountStore}>{store.name}</Text>
            <TextInput accessibilityLabel={`مبلغ التسوية للمتجر ${store.name}`} keyboardType="number-pad" value={storeAmounts[store.id] ?? ""} onChangeText={(value) => setStoreAmounts((current) => ({ ...current, [store.id]: toAsciiDigits(value).replace(/[^0-9]/g, "") }))} placeholder="المبلغ بالهللات" placeholderTextColor={theme.colorMuted} style={styles.input} />
          </View>)}
          <Text style={styles.muted}>لكل متجر مستلمه الفعلي؛ يقسّم النظام المبالغ إلى حوالات منفصلة عند اختلاف المستلمين أو الوجهات، ولا يجمع مستفيدين مختلفين في حوالة واحدة.</Text>
          <BthwaniButton busy={busy} label="طلب المبالغ المحددة" onPress={() => void request("SPECIFIED")} variant="secondary" />
        </View> : <>
          <Text style={styles.muted}>يغطي الطلب كامل المتاح في نطاق متاجرك المصرح بها، ويقسمه تلقائيًا حسب مستلم كل متجر مع الحفاظ على سطر تخصيص لكل متجر.</Text>
          <BthwaniButton busy={busy} label="طلب تسوية كامل المتاح المصرح به" onPress={() => void request("FULL_AVAILABLE")} variant="secondary" />
        </>}
      </> : null}
      {lastRequest ? <View style={styles.requestBox}>
        <Text style={styles.lineTitle}>آخر طلب مقسّم: {formatMoney(lastRequest.totalAmountMinor, lastRequest.currency)}</Text>
        {lastRequest.stores.map((allocation) => <Text key={allocation.storeId} style={styles.muted}>{storeNames[allocation.storeId] ?? allocation.storeId}: {formatMoney(allocation.amountMinor, allocation.currency)}</Text>)}
        <Text style={styles.muted}>الحوالات: {lastRequest.payouts.length} · الحالة: قيد المعالجة المالية المعتمدة.</Text>
      </View> : null}
    </> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {authenticated ? <BthwaniButton busy={busy} label="تحديث حالة التسوية" onPress={() => void load()} variant="secondary" /> : null}
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] }, eyebrow: { ...typography.label, color: theme.interactiveText }, title: { ...typography.titleSm, color: theme.color }, loading: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, metrics: { gap: spacing[1] }, metric: { ...typography.bodySm, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, input: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, padding: spacing[3], textAlign: "left", writingDirection: "ltr" }, notice: { ...typography.bodySm, color: theme.interactiveText }, error: { ...typography.bodySm, color: theme.warning }, modeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] }, amounts: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] }, amountRow: { gap: spacing[1] }, amountStore: { ...typography.bodyStrong, color: theme.color }, pendingBox: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] }, requestBox: { backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] }, lineTitle: { ...typography.bodyStrong, color: theme.color } }); }
