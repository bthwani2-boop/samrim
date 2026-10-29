import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniConfirmDialog, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import * as SecureStore from "../../bootstrap/compatible-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";

import { currentIdentityState } from "../../bootstrap/identity";
import { hasReviewableStoreAgreementRates, isConfirmedOwnStoreAgreementAcceptance } from "./store-agreement-acceptance-readback";
import {
  acceptOwnStoreCommercialAgreement,
  newStoreAgreementMutationKeys,
  readOwnStoreCommercialAgreements,
  type StoreCommercialAgreement,
} from "./store-commercial-agreement-client";

const DEFAULT_ACCEPTANCE_REASON = "أوافق على نسب العمولة وشروط الاتفاقية المعروضة";

type AcceptanceAttempt = Readonly<{
  agreementId: string;
  expectedAgreementVersion: number;
  reason: string;
  idempotencyKey: string;
  correlationID: string;
}>;

function isAcceptanceAttempt(value: unknown): value is AcceptanceAttempt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.agreementId === "string" && candidate.agreementId.trim().length > 0 &&
    Number.isSafeInteger(candidate.expectedAgreementVersion) && Number(candidate.expectedAgreementVersion) > 0 &&
    typeof candidate.reason === "string" && Array.from(candidate.reason.trim()).length >= 8 &&
    typeof candidate.idempotencyKey === "string" && candidate.idempotencyKey.length >= 8 &&
    typeof candidate.correlationID === "string" && candidate.correlationID.length >= 8;
}

function modeLabel(mode: string): string {
  switch (mode) {
    case "BTHWANI_CAPTAIN": return "توصيل بثواني";
    case "PARTNER_CAPTAIN": return "توصيل المتجر";
    case "CUSTOMER_PICKUP": return "الاستلام من المتجر";
    default: return mode;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "PROPOSED": return "بانتظار قبول مالك المتجر";
    case "PARTNER_ACCEPTED": return "قُبلت من المالك · بانتظار اعتماد المالية";
    case "ACTIVE": return "سارية";
    case "FINANCE_REJECTED":
    case "REJECTED": return "مرفوضة";
    case "SUPERSEDED": return "استُبدلت باتفاق أحدث";
    default: return `الحالة: ${status}`;
  }
}

function rateValue(commissionRateBps: number): string {
  return new Intl.NumberFormat("ar-YE-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(commissionRateBps / 100) + "%";
}

function acceptanceErrorMessage(cause: unknown, hasSavedAttempt: boolean): string {
  if (cause && typeof cause === "object" && "status" in cause && (cause as { status?: unknown }).status === 409) {
    return "تغيرت بيانات الاتفاقية أو حالتها. أعد قراءتها قبل المتابعة.";
  }
  return hasSavedAttempt
    ? "لم نتأكد من نتيجة القبول؛ تحقق من الاتفاقية قبل إعادة المحاولة. لن يُرسل القبول تلقائيًا."
    : "تعذر تأكيد قبول الاتفاقية. أعد المحاولة بعد مراجعة التفاصيل.";
}

export function StoreCommercialAgreements({ storeID }: Readonly<{ storeID: string }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const identity = currentIdentityState();
  const actorID = identity.kind === "authenticated" ? identity.identity.subject.trim() : "";
  const storageKey = actorID && storeID ? `bthwani.partner.store-agreement.accept.pending.v1.${encodeURIComponent(actorID)}.${encodeURIComponent(storeID)}` : "";
  const [agreements, setAgreements] = useState<ReadonlyArray<StoreCommercialAgreement> | null>(null);
  const [agreementsScope, setAgreementsScope] = useState("");
  const [feedbackScope, setFeedbackScope] = useState("");
  const activeScope = useRef(storageKey);
  activeScope.current = storageKey;
  const readSequence = useRef(0);
  const [pendingAttempt, setPendingAttempt] = useState<AcceptanceAttempt | null>(null);
  const [pendingStorageReady, setPendingStorageReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyAgreementID, setBusyAgreementID] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [agreementToConfirm, setAgreementToConfirm] = useState<StoreCommercialAgreement | null>(null);
  const acceptanceBusy = useRef(false);

  const load = useCallback(async (): Promise<ReadonlyArray<StoreCommercialAgreement> | null> => {
    const sequence = ++readSequence.current;
    const isCurrent = () => activeScope.current === storageKey && readSequence.current === sequence;
    setFeedbackScope(storageKey);
    if (!storageKey) {
      setAgreements(null);
      setAgreementsScope("");
      setLoading(false);
      setPendingStorageReady(false);
      setError("يلزم تسجيل دخول الشريك لقراءة اتفاقية المتجر.");
      return null;
    }
    setLoading(true);
    setPendingStorageReady(false);
    setError("");
    try {
      let savedAttempt: AcceptanceAttempt | null = null;
      try {
        const raw = await SecureStore.getItemAsync(storageKey);
        if (!isCurrent()) return null;
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isAcceptanceAttempt(parsed)) savedAttempt = parsed;
          else await SecureStore.deleteItemAsync(storageKey);
        }
        if (!isCurrent()) return null;
        setPendingStorageReady(true);
      } catch {
        if (!isCurrent()) return null;
        setPendingStorageReady(false);
        setError("تعذر قراءة متابعة القبول المحفوظة بأمان؛ أعد المحاولة قبل قبول أي اتفاقية.");
      }
      const currentAgreements = await readOwnStoreCommercialAgreements(storeID);
      if (!isCurrent()) return null;
      if (currentAgreements.some((agreement) => agreement.partnerActorId !== actorID)) {
        throw new Error("AGREEMENT_ACTOR_SCOPE_MISMATCH");
      }
      if (savedAttempt) {
        const current = currentAgreements.find((item) => item.agreementId === savedAttempt.agreementId);
        if (current && (current.status !== "PROPOSED" || current.agreementVersion !== savedAttempt.expectedAgreementVersion)) {
          await SecureStore.deleteItemAsync(storageKey);
          if (!isCurrent()) return null;
          setPendingAttempt(null);
          setNotice("أُعيدت قراءة الاتفاقية بعد محاولة سابقة؛ راجع حالتها الحالية قبل اتخاذ إجراء.");
        } else {
          setPendingAttempt(savedAttempt);
        }
      } else {
        setPendingAttempt(null);
      }
      setAgreements(currentAgreements);
      setAgreementsScope(storageKey);
      return currentAgreements;
    } catch (cause) {
      if (isCurrent()) {
        setError(cause instanceof Error && cause.message === "DSH_BASE_URL_REQUIRED"
          ? "تعذر الاتصال بخدمة الاتفاقيات."
          : "تعذر قراءة اتفاقيات المتجر أو التحقق من ملكيتها. أعد المحاولة.");
      }
      return null;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [actorID, storageKey, storeID]);

  useEffect(() => {
    setAgreementToConfirm(null);
    setNotice("");
    void load();
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") void load(); });
    return () => { listener.remove(); readSequence.current += 1; };
  }, [load]);

  function requestAcceptanceConfirmation(agreement: StoreCommercialAgreement) {
    if (activeScope.current !== storageKey || agreementsScope !== storageKey ||
      agreement.storeId !== storeID || agreement.partnerActorId !== actorID ||
      !hasReviewableStoreAgreementRates(agreement)) return;
    const savedAttempt = pendingAttempt?.agreementId === agreement.agreementId ? pendingAttempt : null;
    const reason = savedAttempt?.reason ?? DEFAULT_ACCEPTANCE_REASON;
    if (Array.from(reason.trim()).length < 8 || Array.from(reason.trim()).length > 500) {
      setError("تعذر تجهيز إقرار القبول. أعد قراءة الاتفاقية ثم حاول مجددًا.");
      return;
    }
    setError("");
    setAgreementToConfirm(agreement);
  }

  async function accept(agreement: StoreCommercialAgreement) {
    if (acceptanceBusy.current || busyAgreementID || agreement.status !== "PROPOSED" || !storageKey ||
      !pendingStorageReady || agreementsScope !== storageKey || activeScope.current !== storageKey ||
      agreement.storeId !== storeID || agreement.partnerActorId !== actorID ||
      !hasReviewableStoreAgreementRates(agreement)) return;
    const savedAttempt = pendingAttempt?.agreementId === agreement.agreementId ? pendingAttempt : null;
    if (pendingAttempt && !savedAttempt) {
      setError("تحقق أولًا من محاولة القبول المحفوظة قبل قبول اتفاقية أخرى.");
      return;
    }
    const reason = savedAttempt?.reason ?? DEFAULT_ACCEPTANCE_REASON;
    if (Array.from(reason.trim()).length < 8 || Array.from(reason.trim()).length > 500) {
      setError("تعذر تجهيز إقرار القبول. أعد قراءة الاتفاقية ثم حاول مجددًا.");
      return;
    }

    const attempt: AcceptanceAttempt = savedAttempt ?? {
      agreementId: agreement.agreementId,
      expectedAgreementVersion: agreement.agreementVersion,
      reason,
      ...newStoreAgreementMutationKeys(),
    };
    acceptanceBusy.current = true;
    setBusyAgreementID(agreement.agreementId);
    setError("");
    setNotice("");
    let attemptSaved = Boolean(savedAttempt);
    try {
      if (!savedAttempt) {
        await SecureStore.setItemAsync(storageKey, JSON.stringify(attempt));
        attemptSaved = true;
        if (activeScope.current !== storageKey) return;
        setPendingAttempt(attempt);
      }
      if (activeScope.current !== storageKey) return;
      const accepted = await acceptOwnStoreCommercialAgreement(storeID, attempt.agreementId, {
        expectedAgreementVersion: attempt.expectedAgreementVersion,
        reason: attempt.reason,
      }, attempt.idempotencyKey, attempt.correlationID);
      if (activeScope.current !== storageKey) return;
      const expected = { storeID, actorID, agreementID: attempt.agreementId, expectedVersion: attempt.expectedAgreementVersion };
      if (!isConfirmedOwnStoreAgreementAcceptance(accepted, expected)) {
        throw new Error("PARTNER_ACCEPTANCE_READBACK_MISMATCH");
      }
      const canonicalReadback = await load();
      if (activeScope.current !== storageKey) return;
      const canonical = canonicalReadback?.find((item) => item.agreementId === attempt.agreementId);
      if (!isConfirmedOwnStoreAgreementAcceptance(canonical, expected)) {
        throw new Error("PARTNER_ACCEPTANCE_CANONICAL_READBACK_MISMATCH");
      }
      await SecureStore.deleteItemAsync(storageKey);
      if (activeScope.current !== storageKey) return;
      setPendingAttempt(null);
      setNotice("سُجل قبولك وتم تأكيد الاتفاقية.");
    } catch (cause) {
      if (activeScope.current === storageKey) setError(acceptanceErrorMessage(cause, attemptSaved));
    } finally {
      acceptanceBusy.current = false;
      setBusyAgreementID("");
    }
  }

  const visibleAgreements = agreementsScope === storageKey ? agreements : null;
  const scopedPendingAttempt = agreementsScope === storageKey ? pendingAttempt : null;
  const visibleError = feedbackScope === storageKey ? error : "";
  const visibleNotice = feedbackScope === storageKey ? notice : "";
  const readingCurrentStore = loading || (Boolean(storageKey) && agreementsScope !== storageKey && !visibleError);

  return (
    <BthwaniSurface tone="base" style={styles.panel} accessibilityLabel="اتفاقية المتجر التجارية">
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>الشروط التجارية</Text>
        <Text style={styles.title}>اتفاقية المتجر</Text>
        <Text style={styles.muted}>راجع النسبة المحددة لكل طريقة تشغيل. لا يتم قبول الاتفاقية إلا بعد تأكيدك الصريح.</Text>
      </View>
      {readingCurrentStore && visibleAgreements === null ? <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة اتفاقيات المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الاتفاقيات…</Text></View> : null}
      {visibleError ? <Text accessibilityRole="alert" style={styles.error}>{visibleError}</Text> : null}
      {visibleNotice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{visibleNotice}</Text> : null}
      {visibleAgreements?.length === 0 ? <Text style={styles.muted}>لا توجد اتفاقية بانتظارك الآن. يجهّز قسم الشركاء المقترح؛ ستظهر الشروط هنا لمراجعتها وقبولها قبل سريانها. يمكنك تجهيز المنتجات والصور بالتوازي.</Text> : null}
      {visibleAgreements?.map((agreement) => {
        const savedAttempt = scopedPendingAttempt?.agreementId === agreement.agreementId ? scopedPendingAttempt : null;
        const canAccept = agreement.status === "PROPOSED" && hasReviewableStoreAgreementRates(agreement) && pendingStorageReady && !loading && (!scopedPendingAttempt || Boolean(savedAttempt));
        return (
          <View key={agreement.agreementId} style={styles.agreement}>
            <View style={styles.agreementHeading}>
              <Text style={styles.agreementTitle}>الاتفاقية التجارية</Text>
              <Text accessibilityRole="text" style={[styles.status, agreement.status === "ACTIVE" ? styles.active : agreement.status.includes("REJECT") ? styles.rejected : styles.pending]}>{statusLabel(agreement.status)}</Text>
            </View>
            {agreement.rates.length > 0 ? agreement.rates.map((rate) => (
              <View key={`${agreement.agreementId}:${rate.fulfillmentMode}`} style={styles.rateRow}>
                <Text style={styles.rateLabel}>{modeLabel(rate.fulfillmentMode)}</Text>
                <Text selectable style={styles.rateValue}>{rateValue(rate.commissionRateBps)}{rate.fulfillmentMode === "PARTNER_CAPTAIN" ? ` · رسوم توصيل المتجر: ${rate.deliveryPricingMode === "FREE" ? "مجاني" : rate.deliveryPricingMode === "FIXED" ? `${rate.deliveryFixedFeeMinor ?? 0} ريال` : "حسب المسافة"}` : ""}{rate.deliveryMarkupMinor ? ` · زيادة توصيل ${rate.deliveryMarkupMinor} ريال لبثواني دون مساس بأجرة الكابتن` : ""}</Text>
              </View>
            )) : <Text style={styles.error}>لا تحتوي الاتفاقية على معدلات تشغيل صالحة.</Text>}
            {agreement.status === "PROPOSED" ? <View style={styles.acceptance}>
              <Text style={styles.muted}>راجع النسب أعلاه ثم اضغط «مراجعة وتأكيد القبول». يُسجل إقرارك باسمك، وبعده تعتمد المالية الاتفاقية قبل نشر المتجر.</Text>
              {savedAttempt ? <Text style={styles.muted}>محاولة قبول سابقة غير محسومة؛ تحقق من نتيجتها قبل إعادة المحاولة.</Text> : null}
              <BthwaniButton
                busy={busyAgreementID === agreement.agreementId}
                disabled={!canAccept}
                label={savedAttempt ? "إعادة محاولة القبول" : "مراجعة وتأكيد القبول"}
                onPress={() => requestAcceptanceConfirmation(agreement)}
              />
            </View> : null}
          </View>
        );
      })}
      <BthwaniButton busy={loading} disabled={Boolean(busyAgreementID)} label="إعادة قراءة الاتفاقيات" onPress={() => void load()} variant="secondary" />
      <BthwaniConfirmDialog
        busy={Boolean(agreementToConfirm && busyAgreementID === agreementToConfirm.agreementId)}
        confirmLabel="تأكيد قبول الاتفاقية"
        description={agreementToConfirm
          ? `ستوافق على الاتفاقية التجارية. النسب: ${agreementToConfirm.rates.map((rate) => `${modeLabel(rate.fulfillmentMode)}: ${rateValue(rate.commissionRateBps)}${rate.fulfillmentMode === "PARTNER_CAPTAIN" ? ` · رسوم توصيل المتجر: ${rate.deliveryPricingMode === "FREE" ? "مجاني" : rate.deliveryPricingMode === "FIXED" ? `${rate.deliveryFixedFeeMinor ?? 0} ريال` : "حسب المسافة"}` : ""}${rate.deliveryMarkupMinor ? ` + ${rate.deliveryMarkupMinor} ريال هامش توصيل لبثواني` : ""}`).join("، ")}. بعد قبولك تراجعها الإدارة المالية قبل أن تصبح سارية.`
          : ""}
        onCancel={() => setAgreementToConfirm(null)}
        onConfirm={() => {
          const agreement = agreementToConfirm;
          setAgreementToConfirm(null);
          if (agreement) void accept(agreement);
        }}
        title="تأكيد الشروط التجارية"
        visible={Boolean(agreementToConfirm && agreementsScope === storageKey && agreementToConfirm.storeId === storeID && agreementToConfirm.partnerActorId === actorID)}
      />
    </BthwaniSurface>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    panel: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    heading: { gap: spacing[1] },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.titleSm, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    state: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[3] },
    agreement: { backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    agreementHeading: { gap: spacing[1] },
    agreementTitle: { ...typography.titleSm, color: theme.color },
    status: { ...typography.bodySm },
    active: { color: theme.interactiveText },
    pending: { color: theme.warning },
    rejected: { color: theme.danger },
    rateRow: { borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, gap: spacing[1], paddingTop: spacing[2] },
    rateLabel: { ...typography.label, color: theme.color },
    rateValue: { ...typography.bodySm, color: theme.color, textAlign: "left", writingDirection: "ltr" },
    acceptance: { gap: spacing[2], paddingTop: spacing[2] },
    notice: { ...typography.bodySm, color: theme.interactiveText },
    error: { ...typography.bodySm, color: theme.danger },
  });
}
