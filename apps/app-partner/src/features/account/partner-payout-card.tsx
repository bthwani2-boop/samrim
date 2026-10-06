import { borders, radius, resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniConfirmDialog, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, type PartnerPayoutRequestCreateRequest, type PartnerPayoutRequestView, type PartnerPayoutSummary, isDefinitiveDshMobileClientRejection } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

function storageKey() {
    const actor = currentIdentityState();
    if (actor.kind !== "authenticated") throw new Error("PARTNER_SESSION_REQUIRED");
    return `bthwani.partner.payout.pending.v2.${encodeURIComponent(actor.identity.subject)}`;
}

type PayoutMode = "FULL_AVAILABLE" | "SPECIFIED";
type LegacyAttempt = Readonly<{ mode: PayoutMode; storeAmounts?: ReadonlyArray<{ storeId: string; amountMinor: number }>; idempotencyKey: string; correlationID: string; walletOwnerActorId?: string; reviewRequired?: boolean }>;

type PayoutAttempt = Readonly<{ walletOwnerActorId: string; body: PartnerPayoutRequestCreateRequest; idempotencyKey: string; correlationID: string }>;

export function PartnerPayoutCard() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [state, setState] = useState<PartnerPayoutSummary | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<PartnerPayoutSummary | null>(null);
  const [mode, setMode] = useState<PayoutMode>("FULL_AVAILABLE");
  const [storeAmounts, setStoreAmounts] = useState<Readonly<Record<string, string>>>({});
  const [lastRequest, setLastRequest] = useState<PartnerPayoutRequestView | null>(null);
  const [busy, setBusy] = useState(authenticated);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAttempt, setPendingAttempt] = useState<PayoutAttempt | null>(null);
  const [legacyPending, setLegacyPending] = useState<LegacyAttempt | null>(null);
  const [legacyKey, setLegacyKey] = useState<LegacyAttempt | null>(null);
  const [confirmRequest, setConfirmRequest] = useState(false);

  const load = useCallback(async () => {
    if (!authenticated) return;
    setBusy(true);
    try {
      const token = await getUsableIdentityAccessToken();
      const raw = await SecureStore.getItemAsync(storageKey());
      if (raw) {
        const saved = JSON.parse(raw) as Partial<PayoutAttempt>;
        if (saved.body && saved.walletOwnerActorId && saved.idempotencyKey && saved.correlationID) setPendingAttempt(saved as PayoutAttempt);
        else if (!saved.body && saved.idempotencyKey && saved.correlationID) {
          const legacy = saved as LegacyAttempt;
          if (legacy.reviewRequired && legacy.walletOwnerActorId) setLegacyKey(legacy); else setLegacyPending(legacy);
        }
        else throw new Error("INVALID_SAVED_PAYOUT");
      }
      const summary = (await client().readOwnPartnerPayoutSummary(token)).summary;
      setState(summary);
      setSelected((current) => current.length ? current.filter((id) => summary.stores.some((store) => store.storeId === id)) : summary.stores.map((store) => store.storeId));
    } catch { setState(null); setSelectedSummary(null); setError("تعذر قراءة نطاق طلب الصرف المصرح به."); }
    finally { setBusy(false); }
  }, [authenticated]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    setSelectedSummary(null);
    if (selected.length && state) {
      void getUsableIdentityAccessToken().then((token) => client().readOwnPartnerPayoutSummary(token, selected)).then((response) => {
        if (active) setSelectedSummary(response.summary);
      }).catch(() => { if (active) setError("تعذر تحديث المستحقات للمتاجر المختارة."); });
    }
    return () => { active = false; };
  }, [selected, state]);

  const request = async () => {
    if (!pendingAttempt && (!selectedSummary || !selected.length || legacyPending)) return;
    const attemptStorageKey = storageKey();
    setBusy(true); setError(""); setNotice("");
    try {
      let attempt = pendingAttempt;
      if (!attempt) {
        const owners = [...new Set(selectedSummary!.stores.map((store) => store.partnerActorId))];
        const walletOwnerActorId = owners[0];
        if (!walletOwnerActorId || owners.length !== 1 || (legacyKey?.walletOwnerActorId && walletOwnerActorId !== legacyKey.walletOwnerActorId)) throw new Error("ORIGINAL_PAYOUT_WALLET_REQUIRED");
        const amounts = selected.flatMap((storeId) => {
          const amountMinor = Number(toAsciiDigits(storeAmounts[storeId] ?? ""));
          return Number.isSafeInteger(amountMinor) && amountMinor > 0 ? [{ storeId, amountMinor }] : [];
        });
        if (mode === "SPECIFIED" && !amounts.length) throw new Error("STORE_AMOUNTS_REQUIRED");
        attempt = {
          walletOwnerActorId,
          body: mode === "SPECIFIED" ? { scopeMode: mode, storeIds: amounts.map((store) => store.storeId), storeAmounts: amounts } : { scopeMode: mode, storeIds: [...selected] },
          idempotencyKey: legacyKey?.idempotencyKey ?? `partner_payout_${Crypto.randomUUID()}`,
          correlationID: legacyKey?.correlationID ?? `partner_payout_corr_${Crypto.randomUUID()}`,
        };
        await SecureStore.setItemAsync(attemptStorageKey, JSON.stringify(attempt));
        setPendingAttempt(attempt);
      }
      const token = await getUsableIdentityAccessToken();
      const response = await client().createPartnerPayoutRequest(token, attempt.body, attempt.idempotencyKey, attempt.correlationID);
      const canonical = await client().readPartnerPayoutRequestByKey(token, attempt.walletOwnerActorId, attempt.idempotencyKey);
      if (canonical.request.id !== response.request.id ||
        canonical.request.totalAmountMinor !== response.request.totalAmountMinor ||
        canonical.request.currency !== response.request.currency ||
        canonical.request.payouts.length !== response.request.payouts.length) {
        throw new Error("PARTNER_PAYOUT_CANONICAL_READBACK_MISMATCH");
      }
      await SecureStore.deleteItemAsync(attemptStorageKey);
      setPendingAttempt(null); setLegacyKey(null); setLastRequest(canonical.request); setStoreAmounts({});
      setNotice(`سُجل طلب الصرف وتم تأكيده: ${formatMoney(canonical.request.totalAmountMinor, canonical.request.currency)} · ${canonical.request.payouts.length} حوالة وفق مستلمي المتاجر.`);
      await load();
    } catch (cause) {
      if (isDefinitiveDshMobileClientRejection(cause)) {
        await load();
        setError("رُفض الإرسال وفق الحالة الحالية. احتُفظ بمفتاح الطلب؛ استرجع نتيجته قبل مراجعة المتاجر والمبالغ وجاهزية المستلمين.");
      } else {
        setError(cause instanceof Error && cause.message === "STORE_AMOUNTS_REQUIRED" ? "أدخل مبلغًا صحيحًا لمتجر واحد على الأقل." : "لم نتأكد من نتيجة الطلب؛ تحقق منه بنفس المفتاح والنطاق المحفوظين قبل إنشاء طلب جديد.");
      }
    } finally { setBusy(false); }
  };

  const recover = async () => {
    const saved = legacyPending ?? pendingAttempt;
    if (!saved || !state) return;
    const attemptStorageKey = storageKey();
    setBusy(true); setError("");
    try {
      const actor = currentIdentityState();
      if (actor.kind !== "authenticated") throw new Error("PARTNER_SESSION_REQUIRED");
      const token = await getUsableIdentityAccessToken();
      const owners = pendingAttempt ? [pendingAttempt.walletOwnerActorId] : [...new Set(state.stores.map((store) => store.partnerActorId))];
      for (const owner of owners) {
        try {
          const response = await client().readPartnerPayoutRequestByKey(token, owner, saved.idempotencyKey);
          await SecureStore.deleteItemAsync(attemptStorageKey);
          setLastRequest(response.request); setPendingAttempt(null); setLegacyPending(null); setLegacyKey(null);
          setNotice("تم استرجاع طلب الصرف المعتمد دون إنشاء طلب جديد.");
          await load(); return;
        } catch (cause) {
          if (!isDefinitiveDshMobileClientRejection(cause) || cause.status !== 404) throw cause;
        }
      }
      // Old attempts do not identify their original wallet. Absence under
      // currently accessible wallets cannot prove absence under a lost grant.
      if (!pendingAttempt) throw new Error("ORIGINAL_PAYOUT_WALLET_UNKNOWN");
      // Keep the original key even after a negative readback. A delayed old
      // request then conflicts instead of creating a second payout.
      const review: LegacyAttempt = legacyPending ?? {
        mode: pendingAttempt!.body.scopeMode,
        ...(pendingAttempt!.body.storeAmounts ? {storeAmounts:pendingAttempt!.body.storeAmounts} : {}),
        idempotencyKey: saved.idempotencyKey, correlationID: saved.correlationID, walletOwnerActorId: pendingAttempt.walletOwnerActorId,
      };
      await SecureStore.setItemAsync(attemptStorageKey, JSON.stringify({ ...review, reviewRequired: true }));
      setLegacyKey(review); setLegacyPending(null); setPendingAttempt(null);
      setMode(review.mode);
      if (review.mode === "SPECIFIED") {
        setSelected((review.storeAmounts ?? []).map((store) => store.storeId));
        setStoreAmounts(Object.fromEntries((review.storeAmounts ?? []).map((store) => [store.storeId, String(store.amountMinor)])));
      }
      await load();
      setNotice("لم يظهر طلب معتمد. راجع المتاجر الحالية ثم أرسل بنفس المفتاح السابق؛ اختر متاجر المحفظة الأصلية؛ سيمنع تكرار أي طلب متأخر.");
    } catch { setError("تعذر التحقق من الطلب المحفوظ ضمن صلاحياتك الحالية. احتُفظ بمفتاحه لمنع التكرار."); }
    finally { setBusy(false); }
  };

  const storeNames = Object.fromEntries((state?.stores ?? []).map((store) => [store.storeId, store.storeName]));
  const selectedOwners = [...new Set((selectedSummary?.stores ?? []).map((store) => store.partnerActorId))];
  const singleWallet = selectedOwners.length === 1 && (!legacyKey?.walletOwnerActorId || selectedOwners[0] === legacyKey.walletOwnerActorId);
  const specifiedTotalMinor = selected.reduce((total, storeId) => {
    const value = Number(toAsciiDigits(storeAmounts[storeId] ?? ""));
    return Number.isSafeInteger(value) && value > 0 ? total + value : total;
  }, 0);
  const requestPreviewMinor = mode === "FULL_AVAILABLE" ? selectedSummary?.eligibleAvailableMinor ?? 0 : specifiedTotalMinor;
  const requestReady = Boolean(selectedSummary && singleWallet && selectedSummary.eligibleAvailableMinor > 0 && selectedSummary.attributionComplete && (mode === "FULL_AVAILABLE" || specifiedTotalMinor > 0));
  return <BthwaniSurface tone="base" style={styles.card} accessibilityLabel="طلب صرف الشريك">
    <Text style={styles.title}>طلب صرف مستحقات المتاجر</Text>
    <Text style={styles.muted}>هذه المساحة تستخدم صلاحية طلب الصرف لكل متجر. قراءة التقارير المالية وتغيير المستلم صلاحيتان مستقلتان.</Text>
    {busy && !state ? <ActivityIndicator color={theme.actionBackground} /> : null}
    {state ? <>
      {!state.attributionComplete ? <Text style={styles.error}>تحتاج عمليات الصرف القديمة مطابقة مالية قبل طلب صرف جديد.</Text> : null}
      <Text style={styles.metric}>المتاح المصرح بطلبه: {formatMoney(state.eligibleAvailableMinor, state.currency)}</Text>
      {state.stores.map((store) => <View key={store.storeId} style={styles.amountRow}>
        <BthwaniChip disabled={busy || !!pendingAttempt || !!legacyPending} label={store.storeName} selected={selected.includes(store.storeId)} onPress={() => setSelected((current) => current.includes(store.storeId) ? current.filter((id) => id !== store.storeId) : [...current, store.storeId])} />
        <Text style={styles.muted}>المتاح: {formatMoney(store.eligibleAvailableMinor, store.currency)} · المحجوز: {formatMoney(store.heldMinor, store.currency)} · {store.payoutReady ? "المستلم جاهز للصرف" : "المستلم يحتاج إجراء المالية أو المالك"}</Text>
      </View>)}
      {pendingAttempt ? <View style={styles.pendingBox}><Text style={styles.muted}>طلب محفوظ قيد التحقق؛ سيُرسل بنفس المبالغ والمتاجر والمفتاح.</Text><BthwaniButton busy={busy} label="استرجاع نتيجة الطلب" onPress={() => void recover()} /><BthwaniButton busy={busy} label="إعادة الإرسال بنفس المفتاح" onPress={() => void request()} /></View> : legacyPending ? <View style={styles.pendingBox}><Text style={styles.muted}>طلب سابق يحتاج استرجاع نتيجته قبل تحديد نطاق الصرف الحالي.</Text><BthwaniButton busy={busy} label="استرجاع الطلب السابق" onPress={() => void recover()} /></View> : <>
        <View style={styles.modeRow}>
          <BthwaniChip disabled={busy} label="كامل المتاح للمتاجر المختارة" selected={mode === "FULL_AVAILABLE"} onPress={() => setMode("FULL_AVAILABLE")} />
          <BthwaniChip disabled={busy} label="مبالغ محددة لكل متجر" selected={mode === "SPECIFIED"} onPress={() => setMode("SPECIFIED")} />
        </View>
        {mode === "SPECIFIED" ? state.stores.filter((store) => selected.includes(store.storeId)).map((store) => <TextInput key={store.storeId} accessibilityLabel={`مبلغ الصرف للمتجر ${store.storeName}`} editable={!busy} keyboardType="number-pad" value={storeAmounts[store.storeId] ?? ""} onChangeText={(value) => setStoreAmounts((current) => ({ ...current, [store.storeId]: toAsciiDigits(value).replace(/[^0-9]/g, "") }))} placeholder={`مبلغ ${store.storeName} بالريال اليمني`} placeholderTextColor={theme.colorMuted} style={styles.input} />) : null}
        {selectedSummary ? <Text style={styles.metric}>المتاح للمتاجر المختارة: {formatMoney(selectedSummary.eligibleAvailableMinor, selectedSummary.currency)}</Text> : null}
        {selected.length && selectedSummary && !singleWallet ? <Text style={styles.error}>اختر متاجر مالك واحد لكل طلب صرف.</Text> : null}
        <BthwaniButton busy={busy} disabled={!requestReady} label="مراجعة طلب الصرف" onPress={() => setConfirmRequest(true)} variant="secondary" />
      </>}
    </> : null}
    {lastRequest ? <View style={styles.requestBox}>
      <Text style={styles.lineTitle}>الطلب المعتمد: {formatMoney(lastRequest.totalAmountMinor, lastRequest.currency)}</Text>
      {lastRequest.stores.map((allocation) => <Text key={allocation.storeId} style={styles.muted}>{storeNames[allocation.storeId] ?? "متجر ضمن الطلب"}: {formatMoney(allocation.amountMinor, allocation.currency)} · تم تثبيت مستلم الصرف عند إنشاء الطلب</Text>)}
      <Text style={styles.muted}>تم تقسيم الطلب إلى {lastRequest.payouts.length.toLocaleString("ar-YE")} حوالة وفق مستلمي المتاجر المعتمدين.</Text>
    </View> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {authenticated ? <BthwaniButton busy={busy} label="تحديث حالة الصرف" onPress={() => void load()} variant="secondary" /> : null}
    <BthwaniConfirmDialog
      busy={busy}
      confirmLabel="تأكيد طلب الصرف"
      description={selectedSummary ? `سيُنشأ طلب صرف بمبلغ ${formatMoney(requestPreviewMinor, selectedSummary.currency)} للمتاجر المختارة، وسيُقسم إلى حوالات وفق مستلم الصرف المعتمد لكل متجر.` : ""}
      onCancel={() => setConfirmRequest(false)}
      onConfirm={() => { setConfirmRequest(false); void request(); }}
      title="مراجعة طلب الصرف"
      visible={confirmRequest}
    />
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] }, eyebrow: { ...typography.label, color: theme.interactiveText }, title: { ...typography.titleSm, color: theme.color }, loading: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, metrics: { gap: spacing[1] }, metric: { ...typography.bodySm, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, input: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, padding: spacing[3], textAlign: "left", writingDirection: "ltr" }, notice: { ...typography.bodySm, color: theme.interactiveText }, error: { ...typography.bodySm, color: theme.warning }, modeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] }, amounts: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] }, amountRow: { gap: spacing[1] }, amountStore: { ...typography.bodyStrong, color: theme.color }, pendingBox: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] }, requestBox: { backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] }, lineTitle: { ...typography.bodyStrong, color: theme.color } }); }
