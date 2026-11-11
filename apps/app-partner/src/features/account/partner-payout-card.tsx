import { borders, radius, type resolveTheme, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniConfirmDialog, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, isDefinitiveDshMobileClientRejection, type PartnerPayoutRequestCreateRequest, type PartnerPayoutRequestView, type PartnerPayoutSummary, type SettlementIntake, settlementIntakeStatusLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import * as SecureStore from "@bthwani/identity/secure-storage";
import { createPartnerDshClient } from "../../bootstrap/dsh-client";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { partnerSetupSessionKey } from "../partner-onboarding/partner-setup-session-scope";
import { isRecoverablePartnerPayout, matchesPartnerPayoutReadback } from "./partner-payout-readback";

const client = createPartnerDshClient;

// Pending attempts stay with their original actor across logout and re-login so the
// canonical idempotency key can be recovered; the current session never selects a different actor's key.
const storageKey = (subject: string) => `bthwani.partner.payout.pending.v2.${encodeURIComponent(subject)}`;
const intakeStorageKey = (subject: string) => `bthwani.partner.settlement-intake.pending.v1.${encodeURIComponent(subject)}`;
const currentPartnerSessionKey = () => partnerSetupSessionKey(currentIdentityState());

type PayoutMode = "FULL_AVAILABLE" | "SPECIFIED";
type LegacyAttempt = Readonly<{ mode: PayoutMode; storeAmounts?: ReadonlyArray<{ storeId: string; amountMinor: number }>; idempotencyKey: string; correlationID: string; walletOwnerActorId?: string; reviewRequired?: boolean }>;

type PayoutAttempt = Readonly<{ walletOwnerActorId: string; body: PartnerPayoutRequestCreateRequest; idempotencyKey: string; correlationID: string }>;

export function PartnerPayoutCard() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const sessionKey = useSyncExternalStore(subscribeIdentitySession, currentPartnerSessionKey, () => "");
  const identity = currentIdentityState();
  const subject = identity.kind === "authenticated" ? identity.identity.subject : "";
  const stillCurrent = useCallback(() => Boolean(sessionKey && subject) && currentPartnerSessionKey() === sessionKey, [sessionKey, subject]);
  const authenticated = stillCurrent();
  const loadEpoch = useRef(0);
  const [state, setState] = useState<PartnerPayoutSummary | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<PartnerPayoutSummary | null>(null);
  const [mode, setMode] = useState<PayoutMode>("FULL_AVAILABLE");
  const [storeAmounts, setStoreAmounts] = useState<Readonly<Record<string, string>>>({});
  const [lastRequest, setLastRequest] = useState<PartnerPayoutRequestView | null>(null);
  const [intake, setIntake] = useState<SettlementIntake | null>(null);
  const [pendingIntake, setPendingIntake] = useState<{ body: PartnerPayoutRequestCreateRequest; idempotencyKey: string; correlationID: string } | null>(null);
  const [busy, setBusy] = useState(authenticated);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAttempt, setPendingAttempt] = useState<PayoutAttempt | null>(null);
  const [legacyPending, setLegacyPending] = useState<LegacyAttempt | null>(null);
  const [legacyKey, setLegacyKey] = useState<LegacyAttempt | null>(null);
  const [confirmRequest, setConfirmRequest] = useState(false);

  const load = useCallback(async () => {
    if (!stillCurrent()) return;
    const epoch = ++loadEpoch.current;
    const current = () => stillCurrent() && epoch === loadEpoch.current;
    setBusy(true); setError(""); setState(null); setSelectedSummary(null);
    try {
      const token = await getUsableIdentityAccessToken();
      if (!current()) return;
      const raw = await SecureStore.getItemAsync(storageKey(subject));
      if (!current()) return;
      let nextAttempt: PayoutAttempt | null = null;
      let nextLegacyPending: LegacyAttempt | null = null;
      let nextLegacyKey: LegacyAttempt | null = null;
      if (raw) {
        const saved = JSON.parse(raw) as Partial<PayoutAttempt>;
        if (saved.body && saved.walletOwnerActorId && saved.idempotencyKey && saved.correlationID) nextAttempt = saved as PayoutAttempt;
        else if (!saved.body && saved.idempotencyKey && saved.correlationID) {
          const legacy = saved as LegacyAttempt;
          if (legacy.reviewRequired && legacy.walletOwnerActorId) nextLegacyKey = legacy; else nextLegacyPending = legacy;
        } else throw new Error("INVALID_SAVED_PAYOUT");
      }
      const summary = (await client().readOwnPartnerPayoutSummary(token)).summary;
      if (!current()) return;
      const intakes = (await client().listPartnerSettlementIntakes(token)).intakes;
      if (!current()) return;
      const savedIntake = await SecureStore.getItemAsync(intakeStorageKey(subject));
      if (!current()) return;
      setPendingAttempt(nextAttempt); setLegacyPending(nextLegacyPending); setLegacyKey(nextLegacyKey);
      setPendingIntake(savedIntake ? JSON.parse(savedIntake) as { body: PartnerPayoutRequestCreateRequest; idempotencyKey: string; correlationID: string } : null);
      setIntake(intakes[0] ?? null);
      setState(summary);
      setSelected((previous) => previous.length ? previous.filter((id) => summary.stores.some((store) => store.storeId === id)) : summary.stores.map((store) => store.storeId));
    } catch {
      if (current()) { setState(null); setSelectedSummary(null); setError("تعذر قراءة نطاق طلب الصرف المصرح به."); }
    } finally { if (current()) setBusy(false); }
  }, [stillCurrent, subject]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { loadEpoch.current += 1; };
  }, [load]));
  useEffect(() => {
    let active = true;
    setSelectedSummary(null);
    if (stillCurrent() && selected.length && state) {
      void getUsableIdentityAccessToken().then((token) => {
        if (!active || !stillCurrent()) return null;
        return client().readOwnPartnerPayoutSummary(token, selected);
      }).then((response) => {
        if (active && stillCurrent() && response) setSelectedSummary(response.summary);
      }).catch(() => { if (active && stillCurrent()) setError("تعذر تحديث المستحقات للمتاجر المختارة."); });
    }
    return () => { active = false; };
  }, [selected, state, stillCurrent]);

  const request = async () => {
    if (!stillCurrent() || (!pendingAttempt && (!selectedSummary || !selected.length || legacyPending))) return;
    const attemptStorageKey = storageKey(subject);
    setBusy(true); setError(""); setNotice("");
    try {
      let attempt = pendingAttempt;
      if (!attempt) {
        const selectedForRequest = selectedSummary;
        if (!selectedForRequest) throw new Error("PAYOUT_SUMMARY_REQUIRED");
        const owners = [...new Set(selectedForRequest.stores.map((store) => store.partnerActorId))];
        const walletOwnerActorId = owners[0];
        if (!walletOwnerActorId || owners.length !== 1 || (legacyKey?.walletOwnerActorId && walletOwnerActorId !== legacyKey.walletOwnerActorId)) throw new Error("ORIGINAL_PAYOUT_WALLET_REQUIRED");
        const amounts = selected.flatMap((storeId) => {
          const amountMinor = Number(toAsciiDigits(storeAmounts[storeId] ?? ""));
          const store = selectedForRequest.stores.find((item) => item.storeId === storeId);
          return Number.isSafeInteger(amountMinor) && amountMinor > 0 && store && amountMinor <= store.eligibleAvailableMinor ? [{ storeId, amountMinor }] : [];
        });
        if (mode === "SPECIFIED" && amounts.length !== selected.length) throw new Error("STORE_AMOUNTS_REQUIRED");
        attempt = {
          walletOwnerActorId,
          body: mode === "SPECIFIED" ? { scopeMode: mode, storeIds: amounts.map((store) => store.storeId), storeAmounts: amounts } : { scopeMode: mode, storeIds: [...selected] },
          idempotencyKey: legacyKey?.idempotencyKey ?? `partner_payout_${Crypto.randomUUID()}`,
          correlationID: legacyKey?.correlationID ?? `partner_payout_corr_${Crypto.randomUUID()}`,
        };
        await SecureStore.setItemAsync(attemptStorageKey, JSON.stringify(attempt));
        if (!stillCurrent()) return;
        setPendingAttempt(attempt);
      }
      const token = await getUsableIdentityAccessToken();
      if (!stillCurrent()) return;
      const response = await client().createPartnerPayoutRequest(token, attempt.body, attempt.idempotencyKey, attempt.correlationID);
      if (!stillCurrent()) return;
      const canonical = await client().readPartnerPayoutRequestByKey(token, attempt.walletOwnerActorId, attempt.idempotencyKey);
      if (!stillCurrent()) return;
      if (!matchesPartnerPayoutReadback(attempt.body, response.request, canonical.request)) {
        throw new Error("PARTNER_PAYOUT_CANONICAL_READBACK_MISMATCH");
      }
      await SecureStore.deleteItemAsync(attemptStorageKey);
      if (!stillCurrent()) return;
      setPendingAttempt(null); setLegacyKey(null); setLastRequest(canonical.request); setStoreAmounts({});
      setNotice(`سُجل طلب الصرف وتم تأكيده: ${formatMoney(canonical.request.totalAmountMinor, canonical.request.currency)} · ${canonical.request.payouts.length} حوالة وفق مستلمي المتاجر.`);
      await load();
    } catch (cause) {
      if (!stillCurrent()) return;
      if (isDefinitiveDshMobileClientRejection(cause)) {
        await load();
        if (!stillCurrent()) return;
        setError("تعذر إرسال الطلب وفق الحالة الحالية. تحقق من نتيجته قبل إنشاء طلب آخر، وراجع المتاجر والمبالغ وجاهزية المستلمين.");
      } else {
        setError(cause instanceof Error && cause.message === "STORE_AMOUNTS_REQUIRED" ? "أدخل مبلغًا صحيحًا لكل متجر." : "لم نتأكد من نتيجة الطلب السابق؛ تحقق منها قبل إنشاء طلب صرف آخر.");
      }
    } finally { if (stillCurrent()) setBusy(false); }
  };

  const recover = async () => {
    const saved = legacyPending ?? pendingAttempt;
    if (!saved || !state || !stillCurrent()) return;
    const attemptStorageKey = storageKey(subject);
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (!stillCurrent()) return;
      const owners = pendingAttempt ? [pendingAttempt.walletOwnerActorId] : [...new Set(state.stores.map((store) => store.partnerActorId))];
      for (const owner of owners) {
        try {
          const response = await client().readPartnerPayoutRequestByKey(token, owner, saved.idempotencyKey);
          if (!stillCurrent()) return;
          if (!isRecoverablePartnerPayout(response.request, pendingAttempt?.body)) {
            throw new Error("PARTNER_PAYOUT_RECOVERY_CANONICAL_READBACK_MISMATCH");
          }
          await SecureStore.deleteItemAsync(attemptStorageKey);
          if (!stillCurrent()) return;
          setLastRequest(response.request); setPendingAttempt(null); setLegacyPending(null); setLegacyKey(null);
          setNotice("تم استرجاع طلب الصرف المعتمد دون إنشاء طلب جديد.");
          await load(); return;
        } catch (cause) {
          if (!stillCurrent()) return;
          if (!isDefinitiveDshMobileClientRejection(cause) || cause.status !== 404) throw cause;
        }
      }
      // Old attempts do not identify their original wallet. Absence under
      // currently accessible wallets cannot prove absence under a lost grant.
      if (!pendingAttempt) throw new Error("ORIGINAL_PAYOUT_WALLET_UNKNOWN");
      // Keep the original key even after a negative readback. A delayed old
      // request then conflicts instead of creating a second payout.
      const review: LegacyAttempt = legacyPending ?? {
        mode: pendingAttempt.body.scopeMode,
        ...(pendingAttempt.body.storeAmounts ? {storeAmounts:pendingAttempt.body.storeAmounts} : {}),
        idempotencyKey: saved.idempotencyKey, correlationID: saved.correlationID, walletOwnerActorId: pendingAttempt.walletOwnerActorId,
      };
      if (!stillCurrent()) return;
      await SecureStore.setItemAsync(attemptStorageKey, JSON.stringify({ ...review, reviewRequired: true }));
      if (!stillCurrent()) return;
      setLegacyKey(review); setLegacyPending(null); setPendingAttempt(null);
      setMode(review.mode);
      if (review.mode === "SPECIFIED") {
        setSelected((review.storeAmounts ?? []).map((store) => store.storeId));
        setStoreAmounts(Object.fromEntries((review.storeAmounts ?? []).map((store) => [store.storeId, String(store.amountMinor)])));
      }
      await load();
      if (!stillCurrent()) return;
      setNotice("لم يظهر طلب معتمد. راجع المتاجر الحالية ثم أعد المحاولة بالبيانات المحفوظة للمتاجر نفسها.");
    } catch { if (stillCurrent()) setError("تعذر التحقق من الطلب المحفوظ ضمن صلاحياتك الحالية. أعد المحاولة قبل إنشاء طلب آخر."); }
    finally { if (stillCurrent()) setBusy(false); }
  };

  const requestIntake = async () => {
    if (!stillCurrent() || !selectedSummary || selected.length === 0 || !selectedSummary.attributionComplete) return;
    const amounts = selected.flatMap((storeId) => {
      const value = Number(toAsciiDigits(storeAmounts[storeId] ?? ""));
      const store = selectedSummary.stores.find((item) => item.storeId === storeId);
      return Number.isSafeInteger(value) && value > 0 && store && value <= store.eligibleAvailableMinor ? [{ storeId, amountMinor: value }] : [];
    });
    if (mode === "SPECIFIED" && amounts.length !== selected.length) { setError("حدد مبلغًا صحيحًا لكل متجر."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const saved = pendingIntake ?? {
        body: mode === "SPECIFIED" ? { scopeMode: mode, storeIds: selected, storeAmounts: amounts } : { scopeMode: mode, storeIds: selected },
        idempotencyKey: `partner_intake_${Crypto.randomUUID()}`, correlationID: `partner_intake_corr_${Crypto.randomUUID()}`,
      };
      await SecureStore.setItemAsync(intakeStorageKey(subject), JSON.stringify(saved));
      if (!stillCurrent()) return;
      setPendingIntake(saved);
      const token = await getUsableIdentityAccessToken();
      if (!stillCurrent()) return;
      const created = await client().createPartnerSettlementIntake(token, saved.body, saved.idempotencyKey, saved.correlationID);
      if (!stillCurrent()) return;
      if (created.intake.status !== "REQUESTED" || created.intake.resolvedAmountMinor <= 0) throw new Error("SETTLEMENT_INTAKE_INVALID_READBACK");
      await SecureStore.deleteItemAsync(intakeStorageKey(subject));
      if (!stillCurrent()) return;
      setIntake(created.intake);
      setPendingIntake(null);
      setNotice("وصل طلب تسوية المتاجر إلى المالية. سيتم التحقق من وجهة التحويل قبل الصرف.");
    } catch {
      if (stillCurrent()) setError("لم نتأكد من استلام الطلب. استخدم نفس المحاولة للاستعادة دون إنشاء طلب آخر.");
    } finally { if (stillCurrent()) setBusy(false); }
  };
  const storeNames = Object.fromEntries((state?.stores ?? []).map((store) => [store.storeId, store.storeName]));
  const selectedOwners = [...new Set((selectedSummary?.stores ?? []).map((store) => store.partnerActorId))];
  const singleWallet = selectedOwners.length === 1 && (!legacyKey?.walletOwnerActorId || selectedOwners[0] === legacyKey.walletOwnerActorId);
  const specifiedTotalMinor = selected.reduce((total, storeId) => {
    const value = Number(toAsciiDigits(storeAmounts[storeId] ?? ""));
    return Number.isSafeInteger(value) && value > 0 ? total + value : total;
  }, 0);
  const specifiedAmountsReady = Boolean(selectedSummary) && selected.length > 0 && selected.every((storeId) => {
    const store = selectedSummary?.stores.find((item) => item.storeId === storeId);
    const value = Number(toAsciiDigits(storeAmounts[storeId] ?? ""));
    return Boolean(store) && Number.isSafeInteger(value) && value > 0 && value <= (store?.eligibleAvailableMinor ?? 0);
  });
  const requestPreviewMinor = mode === "FULL_AVAILABLE" ? selectedSummary?.eligibleAvailableMinor ?? 0 : specifiedTotalMinor;
  const requestReady = Boolean(selectedSummary && singleWallet && selectedSummary.eligibleAvailableMinor > 0 && selectedSummary.attributionComplete && (mode === "FULL_AVAILABLE" || specifiedAmountsReady));
  const destinationReady = Boolean(selectedSummary?.stores.filter((store) => selected.includes(store.storeId)).every((store) => store.payoutReady));
  let confirmDescription = "";
  if (selectedSummary) {
    const amountLabel = formatMoney(requestPreviewMinor, selectedSummary.currency);
    if (destinationReady) {
      confirmDescription = `سيُنشأ طلب صرف بمبلغ ${amountLabel} للمتاجر المختارة مع حجز المبلغ حتى إتمام التسوية المعتمدة.`;
    } else {
      confirmDescription = `سيُرسل طلب تسوية بمبلغ ${amountLabel} للمتاجر المختارة إلى المالية للمراجعة، دون حجز أو تحويل أي مبلغ الآن.`;
    }
  }
  // React may still own an old render until the Identity subscriber remounts it.
  if (!stillCurrent()) return null;
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
      {pendingAttempt ? <View style={styles.pendingBox}><Text style={styles.muted}>طلب محفوظ قيد التحقق؛ أعد المحاولة بالمتاجر والمبالغ المحفوظة نفسها.</Text><BthwaniButton busy={busy} label="استرجاع نتيجة الطلب" onPress={() => void recover()} /><BthwaniButton busy={busy} label="إعادة المحاولة بالبيانات المحفوظة" onPress={() => void request()} /></View> : legacyPending ? <View style={styles.pendingBox}><Text style={styles.muted}>طلب سابق يحتاج استرجاع نتيجته قبل تحديد نطاق الصرف الحالي.</Text><BthwaniButton busy={busy} label="استرجاع الطلب السابق" onPress={() => void recover()} /></View> : <>
        <View style={styles.modeRow}>
          <BthwaniChip disabled={busy} label="كامل المتاح للمتاجر المختارة" selected={mode === "FULL_AVAILABLE"} onPress={() => setMode("FULL_AVAILABLE")} />
          <BthwaniChip disabled={busy} label="مبالغ محددة لكل متجر" selected={mode === "SPECIFIED"} onPress={() => setMode("SPECIFIED")} />
        </View>
        {mode === "SPECIFIED" ? state.stores.filter((store) => selected.includes(store.storeId)).map((store) => {
          const value = Number(toAsciiDigits(storeAmounts[store.storeId] ?? ""));
          const invalid = Boolean(storeAmounts[store.storeId]) && (!Number.isSafeInteger(value) || value <= 0 || value > store.eligibleAvailableMinor);
          return <View key={store.storeId} style={styles.amountRow}><TextInput accessibilityLabel={`مبلغ الصرف للمتجر ${store.storeName}`} editable={!busy} keyboardType="number-pad" value={storeAmounts[store.storeId] ?? ""} onChangeText={(nextValue) => setStoreAmounts((current) => ({ ...current, [store.storeId]: toAsciiDigits(nextValue).replace(/[^0-9]/g, "") }))} placeholder={`مبلغ ${store.storeName} بالريال اليمني`} placeholderTextColor={theme.colorMuted} style={styles.input} />{invalid ? <Text style={styles.error}>المبلغ يجب أن يكون أكبر من صفر وألا يتجاوز {formatMoney(store.eligibleAvailableMinor, store.currency)}.</Text> : null}</View>;
        }) : null}
        {selectedSummary ? <Text style={styles.metric}>المتاح للمتاجر المختارة: {formatMoney(selectedSummary.eligibleAvailableMinor, selectedSummary.currency)}</Text> : null}
        {selected.length && selectedSummary && !singleWallet ? <Text style={styles.error}>اختر متاجر مالك واحد لكل طلب صرف.</Text> : null}
        <BthwaniButton busy={busy} disabled={!requestReady || intake?.status === "REQUESTED"} label={intake?.status === "REQUESTED" ? "طلب التسوية لدى المالية" : destinationReady ? "مراجعة طلب الصرف" : "طلب تسوية من المالية"} onPress={() => setConfirmRequest(true)} variant="secondary" />
      </>}
    </> : null}
    {intake ? <Text style={styles.muted}>حالة طلب التسوية: {settlementIntakeStatusLabel(intake)}{intake.payoutReference ? ` · المرجع: ${intake.payoutReference}` : ""}{intake.payoutStatus === "COMPLETED" && intake.payoutUpdatedAt ? ` · ${new Date(intake.payoutUpdatedAt).toLocaleDateString("ar-YE")}` : ""}</Text> : null}
    {lastRequest ? <View style={styles.requestBox}>
      <Text style={styles.lineTitle}>الطلب المعتمد: {formatMoney(lastRequest.totalAmountMinor, lastRequest.currency)}</Text>
      {lastRequest.stores.map((allocation) => <Text key={allocation.storeId} style={styles.muted}>{storeNames[allocation.storeId] ?? "متجر ضمن الطلب"}: {formatMoney(allocation.amountMinor, allocation.currency)} · تم تثبيت مستلم الصرف عند إنشاء الطلب</Text>)}
      <Text style={styles.muted}>تم تقسيم الطلب إلى {lastRequest.payouts.length.toLocaleString("ar-YE")} حوالة وفق مستلمي المتاجر المعتمدين.</Text>
    </View> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <BthwaniConfirmDialog
      busy={busy}
      confirmLabel={destinationReady ? "تأكيد طلب الصرف" : "تأكيد طلب التسوية"}
      description={confirmDescription} onCancel={() => setConfirmRequest(false)}
      onConfirm={() => { setConfirmRequest(false); void (destinationReady ? request() : requestIntake()); }}
      title={destinationReady ? "مراجعة طلب الصرف" : "مراجعة طلب التسوية"}
      visible={confirmRequest}
    />
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] }, eyebrow: { ...typography.label, color: theme.interactiveText }, title: { ...typography.titleSm, color: theme.color }, loading: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, metrics: { gap: spacing[1] }, metric: { ...typography.bodySm, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, input: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, padding: spacing[3], textAlign: "left", writingDirection: "ltr" }, notice: { ...typography.bodySm, color: theme.interactiveText }, error: { ...typography.bodySm, color: theme.warning }, modeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] }, amounts: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] }, amountRow: { gap: spacing[1] }, amountStore: { ...typography.bodyStrong, color: theme.color }, pendingBox: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] }, requestBox: { backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] }, lineTitle: { ...typography.bodyStrong, color: theme.color } }); }
