import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

import { currentIdentityState } from "../../bootstrap/identity";
import {
  acceptOwnStoreCommercialAgreement,
  newStoreAgreementMutationKeys,
  readOwnStoreCommercialAgreements,
  type StoreCommercialAgreement,
} from "./store-commercial-agreement-client";

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
  const wholePercent = Math.floor(commissionRateBps / 100);
  const fractionalPercent = String(commissionRateBps % 100).padStart(2, "0");
  return `${commissionRateBps.toLocaleString("en-US")} نقطة أساس · ${wholePercent}.${fractionalPercent}%`;
}

function acceptanceErrorMessage(cause: unknown, hasSavedAttempt: boolean): string {
  if (cause && typeof cause === "object" && "status" in cause && (cause as { status?: unknown }).status === 409) {
    return "تغير إصدار الاتفاقية أو حالتها. أعد قراءة الحالة قبل أي خطوة أخرى.";
  }
  return hasSavedAttempt
    ? "لم نتأكد من نتيجة القبول؛ أعد المحاولة بالمفتاح المحفوظ نفسه أو أعد قراءة الاتفاقية. لن يُرسل القبول تلقائيًا."
    : "تعذر تأكيد قبول الاتفاقية. أعد المحاولة بعد مراجعة التفاصيل.";
}

export function StoreCommercialAgreements({ storeID }: { storeID: string }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const identity = currentIdentityState();
  const actorID = identity.kind === "authenticated" ? identity.identity.subject.trim() : "";
  const storageKey = actorID && storeID ? `bthwani.partner.store-agreement.accept.pending.v1.${encodeURIComponent(actorID)}.${encodeURIComponent(storeID)}` : "";
  const [agreements, setAgreements] = useState<ReadonlyArray<StoreCommercialAgreement> | null>(null);
  const [reasonByAgreement, setReasonByAgreement] = useState<Record<string, string>>({});
  const [pendingAttempt, setPendingAttempt] = useState<AcceptanceAttempt | null>(null);
  const [pendingStorageReady, setPendingStorageReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyAgreementID, setBusyAgreementID] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const acceptanceBusy = useRef(false);

  const load = useCallback(async () => {
    if (!storageKey) {
      setLoading(false);
      setError("يلزم تسجيل دخول الشريك لقراءة اتفاقية المتجر.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      let savedAttempt: AcceptanceAttempt | null = null;
      try {
        const raw = await SecureStore.getItemAsync(storageKey);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isAcceptanceAttempt(parsed)) savedAttempt = parsed;
          else await SecureStore.deleteItemAsync(storageKey);
        }
        setPendingStorageReady(true);
      } catch {
        setPendingStorageReady(false);
        setError("تعذر قراءة متابعة القبول المحفوظة بأمان؛ أعد المحاولة قبل قبول أي اتفاقية.");
      }
      const currentAgreements = await readOwnStoreCommercialAgreements(storeID);
      setAgreements(currentAgreements);
      if (savedAttempt) {
        const current = currentAgreements.find((item) => item.agreementId === savedAttempt?.agreementId);
        if (current && (current.status !== "PROPOSED" || current.agreementVersion !== savedAttempt.expectedAgreementVersion)) {
          await SecureStore.deleteItemAsync(storageKey);
          setPendingAttempt(null);
          setNotice("أُعيدت قراءة الاتفاقية بعد محاولة سابقة؛ راجع حالتها الحالية قبل اتخاذ إجراء.");
        } else {
          setPendingAttempt(savedAttempt);
          setReasonByAgreement((values) => ({ ...values, [savedAttempt.agreementId]: savedAttempt.reason }));
        }
      } else {
        setPendingAttempt(null);
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "DSH_BASE_URL_REQUIRED"
        ? "تعذر الاتصال بخدمة الاتفاقيات."
        : "تعذر قراءة اتفاقيات المتجر من DSH.");
    } finally {
      setLoading(false);
    }
  }, [storageKey, storeID]);

  useEffect(() => { void load(); }, [load]);

  async function accept(agreement: StoreCommercialAgreement) {
    if (acceptanceBusy.current || busyAgreementID || agreement.status !== "PROPOSED" || !storageKey || !pendingStorageReady) return;
    const savedAttempt = pendingAttempt?.agreementId === agreement.agreementId ? pendingAttempt : null;
    if (pendingAttempt && !savedAttempt) {
      setError("تحقق أولًا من محاولة القبول المحفوظة قبل قبول اتفاقية أخرى.");
      return;
    }
    const reason = savedAttempt?.reason ?? (reasonByAgreement[agreement.agreementId] ?? "").trim();
    if (Array.from(reason.trim()).length < 8 || Array.from(reason.trim()).length > 500) {
      setError("اكتب سبب قبول من 8 إلى 500 حرف قبل التأكيد.");
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
        setPendingAttempt(attempt);
      }
      const accepted = await acceptOwnStoreCommercialAgreement(storeID, attempt.agreementId, {
        expectedAgreementVersion: attempt.expectedAgreementVersion,
        reason: attempt.reason,
      }, attempt.idempotencyKey, attempt.correlationID);
      if (accepted.storeId !== storeID || accepted.agreementId !== attempt.agreementId || accepted.partnerActorId !== actorID ||
        accepted.agreementVersion < attempt.expectedAgreementVersion ||
        (accepted.status !== "PARTNER_ACCEPTED" && accepted.status !== "ACTIVE") ||
        !accepted.partnerAcceptedByActorId || accepted.partnerAcceptedByActorId !== actorID) {
        throw new Error("PARTNER_ACCEPTANCE_READBACK_MISMATCH");
      }
      await SecureStore.deleteItemAsync(storageKey);
      setPendingAttempt(null);
      setNotice("سُجل قبولك؛ أُعيدت قراءة حالة الاتفاقية من DSH.");
      await load();
    } catch (cause) {
      setError(acceptanceErrorMessage(cause, attemptSaved));
    } finally {
      acceptanceBusy.current = false;
      setBusyAgreementID("");
    }
  }

  return (
    <BthwaniSurface tone="base" style={styles.panel} accessibilityLabel="اتفاقية المتجر التجارية">
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>الشروط التجارية</Text>
        <Text style={styles.title}>اتفاقية المتجر</Text>
        <Text style={styles.muted}>راجع النسبة المحددة لكل طريقة تشغيل. لا يتم قبول الاتفاقية إلا بعد تأكيدك الصريح.</Text>
      </View>
      {loading && agreements === null ? <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة اتفاقيات المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الاتفاقيات…</Text></View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {agreements?.length === 0 ? <Text style={styles.muted}>لا توجد اتفاقية متجر بانتظارك حاليًا.</Text> : null}
      {agreements?.map((agreement) => {
        const savedAttempt = pendingAttempt?.agreementId === agreement.agreementId ? pendingAttempt : null;
        const reason = savedAttempt?.reason ?? reasonByAgreement[agreement.agreementId] ?? "";
        const canAccept = agreement.status === "PROPOSED" && pendingStorageReady && (!pendingAttempt || Boolean(savedAttempt));
        return (
          <View key={agreement.agreementId} style={styles.agreement}>
            <View style={styles.agreementHeading}>
              <Text style={styles.agreementTitle}>إصدار الاتفاقية {agreement.agreementVersion}</Text>
              <Text accessibilityRole="text" style={[styles.status, agreement.status === "ACTIVE" ? styles.active : agreement.status.includes("REJECT") ? styles.rejected : styles.pending]}>{statusLabel(agreement.status)}</Text>
            </View>
            {agreement.rates.length > 0 ? agreement.rates.map((rate) => (
              <View key={`${agreement.agreementId}:${rate.fulfillmentMode}`} style={styles.rateRow}>
                <Text style={styles.rateLabel}>{modeLabel(rate.fulfillmentMode)}</Text>
                <Text selectable style={styles.rateValue}>{rateValue(rate.commissionRateBps)}</Text>
              </View>
            )) : <Text style={styles.error}>لا تحتوي الاتفاقية على معدلات تشغيل صالحة.</Text>}
            {agreement.status === "PROPOSED" ? <View style={styles.acceptance}>
              <Text style={styles.muted}>اكتب سبب موافقتك، ثم اضغط زر القبول لإرسال قرارك.</Text>
              <TextInput
                accessibilityLabel="سبب قبول اتفاقية المتجر"
                editable={!busyAgreementID && !savedAttempt && !pendingAttempt}
                maxLength={500}
                multiline
                onChangeText={(value) => setReasonByAgreement((current) => ({ ...current, [agreement.agreementId]: value }))}
                placeholder="سبب القبول (8 أحرف على الأقل)"
                placeholderTextColor={theme.colorMuted}
                style={styles.reasonInput}
                value={reason}
              />
              {savedAttempt ? <Text style={styles.muted}>محاولة قبول سابقة غير محسومة؛ سيُعاد إرسال السبب والمفتاح نفسيهما عند ضغط الزر.</Text> : null}
              <BthwaniButton
                busy={busyAgreementID === agreement.agreementId}
                disabled={!canAccept || (!savedAttempt && Array.from(reason.trim()).length < 8)}
                label={savedAttempt ? "إعادة محاولة القبول" : "أوافق على الاتفاقية"}
                onPress={() => void accept(agreement)}
              />
            </View> : null}
          </View>
        );
      })}
      <BthwaniButton busy={loading} disabled={Boolean(busyAgreementID)} label="إعادة قراءة الاتفاقيات" onPress={() => void load()} variant="secondary" />
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
    reasonInput: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, minHeight: 88, padding: spacing[3], textAlignVertical: "top" },
    notice: { ...typography.bodySm, color: theme.interactiveText },
    error: { ...typography.bodySm, color: theme.danger },
  });
}
