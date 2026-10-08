import { BthwaniButton, BthwaniConfirmDialog, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreCommercialAgreement, StoreCommercialAgreementProposalRequest, StoreFulfillmentMode } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "./field-client";
import { parsePercentToBps, percentTextFromBps, sameAgreementRates } from "./field-commercial-agreement-rate";

type AgreementAttempt = Readonly<{ input: StoreCommercialAgreementProposalRequest; idempotencyKey: string; correlationID: string }>;
type RateDraft = Partial<Record<StoreFulfillmentMode, string>>;

const modeLabels: Readonly<Record<StoreFulfillmentMode, string>> = {
  BTHWANI_CAPTAIN: "توصيل بثواني",
  PARTNER_CAPTAIN: "توصيل مندوب الشريك",
  CUSTOMER_PICKUP: "استلام من المتجر",
};

const statusLabels: Readonly<Record<StoreCommercialAgreement["status"], string>> = {
  PROPOSED: "بانتظار قبول الشريك",
  PARTNER_ACCEPTED: "بانتظار قرار المالية",
  ACTIVE: "اتفاقية مفعّلة",
  FINANCE_REJECTED: "رفضت المالية المقترح",
  SUPERSEDED: "استبدلت باتفاقية أحدث",
};

function isUncertain(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const error = cause as { kind?: unknown; status?: unknown };
  return error.kind === "network" || (error.kind === "http" && typeof error.status === "number" && error.status >= 500);
}

export function FieldCommercialAgreement({ caseID }: { caseID: string }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 18, borderWidth: 1, gap: 10, padding: 14 },
    row: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, gap: 6, padding: 10 },
    heading: { color: theme.color, fontSize: 17, fontWeight: "700" },
    body: { color: theme.color, fontSize: 15 },
    muted: { color: theme.colorMuted, fontSize: 14, lineHeight: 21 },
    input: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, color: theme.color, minHeight: 46, paddingHorizontal: 12, paddingVertical: 8 },
    error: { color: theme.danger, fontSize: 14 },
  }), [theme]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [storeName, setStoreName] = useState("");
  const [publicationState, setPublicationState] = useState<"unpublished" | "published" | "hidden" | "">("");
  const [modes, setModes] = useState<ReadonlyArray<StoreFulfillmentMode>>([]);
  const [agreements, setAgreements] = useState<ReadonlyArray<StoreCommercialAgreement>>([]);
  const [agreementHistoryReady, setAgreementHistoryReady] = useState(false);
  const [rates, setRates] = useState<RateDraft>({});
  const [reason, setReason] = useState("");
  const [defaultsUnavailable, setDefaultsUnavailable] = useState(false);
  const [attempt, setAttempt] = useState<AgreementAttempt | null>(null);
  const [confirmProposal, setConfirmProposal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setAgreementHistoryReady(false);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const caseResponse = await fieldClient().readOwnFieldJoiningCase(token, caseID);
      const joiningCase = caseResponse.case;
      if (joiningCase.state !== "approved" || !joiningCase.store) throw new Error("FIELD_STORE_AGREEMENT_CASE_NOT_READY");
      const currentModes = joiningCase.store.fulfillmentModes;
      const [agreementResponse, defaultsResponse] = await Promise.all([
        fieldClient().readFieldStoreCommercialAgreements(token, caseID),
        fieldClient().readFieldStoreCommercialAgreementDefaults(token, caseID).catch(() => null),
      ]);
      const nextRates: RateDraft = {};
      for (const mode of currentModes) {
        const suggested = defaultsResponse?.defaults.find((item) => item.fulfillmentMode === mode)?.suggestedCommissionRateBps;
        if (suggested !== undefined) nextRates[mode] = percentTextFromBps(suggested);
      }
      setStoreName(joiningCase.store.name);
      setPublicationState(joiningCase.store.publicationState);
      setModes(currentModes);
      setAgreements(agreementResponse.agreements);
      setAgreementHistoryReady(true);
      setRates((current) => Object.keys(current).length ? current : nextRates);
      setDefaultsUnavailable(defaultsResponse === null);
    } catch (cause) {
      console.warn("DSH Field commercial agreement readback failed", cause);
      setError("تعذر قراءة الاتفاقية التجارية المقترحة. أعد المحاولة قبل الإرسال.");
    } finally {
      setLoading(false);
    }
  }, [caseID]);

  useEffect(() => { void load(); }, [load]);

  const pending = agreements.find((item) => item.status === "PROPOSED" || item.status === "PARTNER_ACCEPTED");
  const active = agreements.find((item) => item.status === "ACTIVE");
  const currentVersion = agreements.reduce((version, item) => Math.max(version, item.agreementVersion), 0);
  const legacyPublishedStore = publicationState === "published" && agreementHistoryReady && agreements.length === 0;
  const canPropose = agreementHistoryReady && (publicationState === "unpublished" || legacyPublishedStore) && !pending && !active && modes.length > 0;

  async function propose() {
    if (busy || !canPropose) return;
    let currentAttempt = attempt;
    if (!attempt) {
      const normalizedReason = reason.trim();
      const proposalRates = modes.map((fulfillmentMode) => ({ fulfillmentMode, commissionRateBps: parsePercentToBps(rates[fulfillmentMode] ?? "") }));
      if (normalizedReason.length < 8 || normalizedReason.length > 500 || proposalRates.some((item) => item.commissionRateBps === null)) {
        setError("أدخل سببًا من 8 إلى 500 حرف ونسبة صحيحة لكل طريقة تشغيل بين 0% و100% وبحد أقصى منزلتين عشريتين.");
        return;
      }
      const canonicalRates = proposalRates.map((item) => ({ fulfillmentMode: item.fulfillmentMode, commissionRateBps: item.commissionRateBps as number }));
      currentAttempt = {
        input: { rates: canonicalRates, expectedCurrentVersion: currentVersion, reason: normalizedReason },
        idempotencyKey: `field_store_agreement_${Crypto.randomUUID()}`,
        correlationID: `field_store_agreement_corr_${Crypto.randomUUID()}`,
      };
      setAttempt(currentAttempt);
    }
    if (!currentAttempt) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().proposeFieldStoreCommercialAgreement(token, caseID, currentAttempt.input, currentAttempt.idempotencyKey, currentAttempt.correlationID);
      const readback = await fieldClient().readFieldStoreCommercialAgreements(token, caseID);
      const saved = readback.agreements.find((item) => item.agreementId === response.agreement.agreementId && item.status === "PROPOSED");
      if (!saved || saved.agreementVersion !== response.agreement.agreementVersion || !sameAgreementRates(saved.rates, response.agreement.rates) || !sameAgreementRates(saved.rates, currentAttempt.input.rates)) {
        throw new Error("FIELD_STORE_AGREEMENT_READBACK_MISMATCH");
      }
      setAgreements(readback.agreements);
      setAttempt(null);
      setReason("");
      setNotice("أُرسل المقترح إلى الشريك للمراجعة الصريحة؛ لا يفعّل النشر أو الاتفاقية تلقائيًا.");
    } catch (cause) {
      console.warn("DSH Field commercial agreement proposal failed", cause);
      if (!isUncertain(cause)) {
        if (!(cause instanceof Error && cause.message === "FIELD_STORE_AGREEMENT_READBACK_MISMATCH")) setAttempt(null);
        setAgreementHistoryReady(false);
      }
      setError(isUncertain(cause) ? "لم نتأكد من نتيجة الإرسال. أعد المحاولة للتحقق من الطلب نفسه." : "تعذر إرسال المقترح. أعد قراءة الحالة قبل بدء محاولة جديدة.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <View style={styles.card}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الاتفاقية التجارية…</Text></View>;
  const previewRates = modes.map((fulfillmentMode) => ({ fulfillmentMode, commissionRateBps: parsePercentToBps(rates[fulfillmentMode] ?? "") }));
  const proposalReady = reason.trim().length >= 8 && reason.trim().length <= 500 && previewRates.every((item) => item.commissionRateBps !== null);
  const proposalSummary = previewRates.map((item) => `${modeLabels[item.fulfillmentMode]}: ${item.commissionRateBps === null ? "غير صالح" : percentTextFromBps(item.commissionRateBps)}%`).join("، ");
  return <View style={styles.card}>
    <Text style={styles.heading}>اتفاقية عمولة المتجر</Text>
    <Text style={styles.muted}>المتجر: {storeName || "—"}. تُسجَّل الشروط المالية النهائية بعد قبول الشريك واعتماد المالية؛ اقتراح الميدان لا يعني القبول أو الاعتماد.</Text>
    {agreements.map((agreement) => <View key={agreement.agreementId} style={styles.row}>
      <Text style={styles.body}>{statusLabels[agreement.status]}</Text>
      <Text style={styles.muted}>{agreement.rates.map((rate) => `${modeLabels[rate.fulfillmentMode]}: ${percentTextFromBps(rate.commissionRateBps)}%`).join(" · ")}</Text>
      <Text style={styles.muted}>السبب: {agreement.reason}</Text>
    </View>)}
    {pending ? <Text style={styles.muted}>اكتمل الإرسال؛ الخطوة التالية للشريك قبول الأسعار نفسها، ثم قرار المالية.</Text> : null}
    {active ? <Text style={styles.muted}>الاتفاقية مفعّلة بعد قبول الشريك واعتماد المالية.</Text> : null}
    {legacyPublishedStore ? <Text style={styles.error}>تتطلب بيانات المتجر المنشورة القديمة اتفاقية صريحة. سيظل المتجر محجوبًا عن العميل حتى قبول الشريك واعتماد المالية.</Text> : null}
    {publicationState === "hidden" || (publicationState === "published" && !legacyPublishedStore) ? <Text style={styles.muted}>انتهت صلاحية اقتراح الميدان بعد انتقال المتجر إلى ما بعد الإطلاق.</Text> : null}
    {canPropose ? <>
      <Text style={styles.muted}>ابدأ من النسب المقترحة لنوع المتجر عند توفرها، ثم أدخل النسب المتفاوض عليها لكل طريقة تشغيل. النسب المقترحة لا تصبح شروطًا مالية.</Text>
      {defaultsUnavailable ? <Text style={styles.muted}>تعذر تحميل القيم المقترحة؛ أدخل النسبة المتفاوض عليها يدويًا لكل طريقة تشغيل.</Text> : null}
      {modes.map((mode) => <View key={mode} style={styles.row}>
        <Text style={styles.body}>{modeLabels[mode]}</Text>
        <TextInput accessibilityLabel={`نسبة عمولة ${modeLabels[mode]} بالمئة`} editable={!busy && !attempt} keyboardType="decimal-pad" maxLength={6} onChangeText={(value) => setRates((current) => ({ ...current, [mode]: toAsciiDigits(value).replace(",", ".").replace(/[^0-9.]/g, "").slice(0, 6) }))} placeholder="النسبة من 0% إلى 100%" value={rates[mode] ?? ""} style={styles.input} />
      </View>)}
      <TextInput accessibilityLabel="سبب اقتراح اتفاقية عمولة المتجر" editable={!busy && !attempt} maxLength={500} multiline onChangeText={setReason} placeholder="سبب التفاوض على هذه النسب" value={reason} style={styles.input} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton busy={busy} disabled={busy || (!attempt && !proposalReady)} label={attempt ? "إعادة التحقق من إرسال المقترح" : "مراجعة المقترح قبل الإرسال"} onPress={() => { if (attempt) void propose(); else setConfirmProposal(true); }} />
    </> : null}
    {error && !canPropose ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
    {agreementHistoryReady && !canPropose && !pending && !active && publicationState === "unpublished" && modes.length === 0 ? <Text style={styles.error}>لا توجد طرق تشغيل معتمدة؛ راجع بيانات المتجر قبل اقتراح الاتفاقية.</Text> : null}
    <BthwaniButton disabled={busy} label="تحديث الاتفاقية" onPress={() => void load()} variant="secondary" />
    <BthwaniConfirmDialog
      busy={busy}
      confirmLabel="إرسال المقترح"
      description={`سيُرسل للشريك مقترح عمولة مستقل للمراجعة: ${proposalSummary}. لا تصبح هذه النسب سارية إلا بعد قبول الشريك واعتماد المالية.`}
      onCancel={() => setConfirmProposal(false)}
      onConfirm={() => { setConfirmProposal(false); void propose(); }}
      title="مراجعة نسب العمولة"
      visible={confirmProposal}
    />
  </View>;
}
