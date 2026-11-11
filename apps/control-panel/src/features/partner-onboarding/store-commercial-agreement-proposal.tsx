"use client";

import type { StoreFulfillmentMode } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { storeCommercialStatusLabel } from "../finance/store-commercial-agreement-types";
import { stablePartnerMutationHeaders } from "../partners/partner-request";
import { nextStoreCommercialAgreementVersion } from "./store-commercial-agreement-version";
import { type ExpectedStoreCommercialProposal, matchesProposedStoreAgreement, type StoreCommercialProposalReadback, storeCommercialRatesForProposal } from "./store-commercial-proposal-rates";

type AgreementRate = StoreCommercialProposalReadback["rates"][number] & Readonly<{
  deliveryMarkupMinor?: number;
  deliveryPricingMode?: "DISTANCE" | "FIXED" | "FREE";
  deliveryFixedFeeMinor?: number;
}>;
type Agreement = Omit<StoreCommercialProposalReadback, "rates"> & Readonly<{
  partnerActorId: string;
  rates: readonly AgreementRate[];
}>;

const labels: Record<string, string> = {
  BTHWANI_CAPTAIN: "توصيل بثواني",
  PARTNER_CAPTAIN: "توصيل المتجر",
  CUSTOMER_PICKUP: "استلام العميل",
};

function commercialRateDescription(rate: AgreementRate): string {
  const parts = [`${labels[rate.fulfillmentMode]}: ${rate.commissionRateBps / 100}%`];
  if ((rate.deliveryMarkupMinor ?? 0) > 0) parts.push(`إضافة على رسوم توصيل العميل: ${rate.deliveryMarkupMinor} ريال`);
  if (rate.fulfillmentMode === "PARTNER_CAPTAIN") {
    const mode = rate.deliveryPricingMode ?? "DISTANCE";
    parts.push(mode === "FREE" ? "توصيل المتجر: مجاني" :
      mode === "FIXED" ? `توصيل المتجر: ثابت ${rate.deliveryFixedFeeMinor} ريال` :
      "توصيل المتجر: حسب المسافة");
  }
  return parts.join(" · ");
}

// The proposal UI submits commission rates only. Additional WLT delivery fees
// are valid for older contracts, but cannot be silently added to this proposal.
function hasOnlyDefaultDeliveryFeeTerms(item: Agreement): boolean {
  return item.rates.every(rate => (rate.deliveryMarkupMinor ?? 0) === 0 &&
    (rate.deliveryPricingMode ?? "DISTANCE") === "DISTANCE" &&
    (rate.deliveryFixedFeeMinor ?? 0) === 0);
}

export function StoreCommercialAgreementProposal(props: Readonly<{storeId: string; modes: readonly StoreFulfillmentMode[]; readOnly?: boolean; suggestedModel?: "COMMISSION" | "SUBSCRIPTION"}>) {
  const { state } = useSession();
  const permitted = state.kind === "authenticated" && state.identity.role === "operator"
    && state.identity.permissions?.includes("partners") === true
    && (props.readOnly !== false || (state.identity.permissions.includes("platform_policies")
      && state.identity.permissions.includes("finance")))
    && Boolean(state.identity.subject && state.identity.sessionId);
  if (!permitted || state.kind !== "authenticated") {
    return <p role="alert" className="identity-error">لا يمكن عرض الاتفاقات دون جلسة مشغّل فعّالة وصلاحيات الاتفاق المطلوبة.</p>;
  }
  const sessionKey = JSON.stringify([state.identity.subject, state.identity.sessionId, props.storeId]);
  return <StoreCommercialAgreementEditor key={sessionKey} {...props} />;
}

function StoreCommercialAgreementEditor({ storeId, modes, readOnly = true, suggestedModel = "COMMISSION" }: Readonly<{storeId: string; modes: readonly StoreFulfillmentMode[]; readOnly?: boolean; suggestedModel?: "COMMISSION" | "SUBSCRIPTION"}>) {
  const { state: sessionState } = useSession();
  const actorId = sessionState.kind === "authenticated" ? sessionState.identity.subject : "";
  const [agreements, setAgreements] = useState<readonly Agreement[] | null>(null);
  const readSequence = useRef(0);
  const proposalController = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [commercialModel, setCommercialModel] = useState<"COMMISSION" | "SUBSCRIPTION">(suggestedModel);
  const [commissionPercentByMode, setCommissionPercentByMode] = useState<Record<StoreFulfillmentMode, string>>({
    BTHWANI_CAPTAIN: "0", PARTNER_CAPTAIN: "0", CUSTOMER_PICKUP: "0",
  });
  const [recurringAmount, setRecurringAmount] = useState("");
  const [billingPeriod, setBillingPeriod] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [invoiceDueDays, setInvoiceDueDays] = useState("7");
  const [graceDays, setGraceDays] = useState("3");
  const [renewalPolicy, setRenewalPolicy] = useState<"MANUAL" | "AUTOMATIC">("MANUAL");
  const [terminationTerms, setTerminationTerms] = useState("");
  const [adjustmentTerms, setAdjustmentTerms] = useState("");
  const [proposalReason, setProposalReason] = useState("اقتراح شروط تجارية بانتظار قبول الشريك واعتماد المالية");
  const url = `/api/partners/stores/${encodeURIComponent(storeId)}/commercial-agreements`;
  const nextProposalVersion = agreements ? nextStoreCommercialAgreementVersion(agreements) : null;
  const hasActiveAgreement = agreements?.some(item => item.status === "ACTIVE") ?? false;
  const hasUnknownAgreementStatus = agreements?.some(item => !["PROPOSED", "PARTNER_ACCEPTED", "ACTIVE", "SUPERSEDED", "FINANCE_REJECTED"].includes(item.status)) ?? false;

  const read = useCallback(async (signal?: AbortSignal) => {
    const request = ++readSequence.current;
    // Never keep an old version actionable while canonical WLT readback is pending.
    setAgreements(null);
    setNotice("");
    try {
      const readSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000);
      const response = await fetch(url, { cache: "no-store", signal: readSignal });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("agreements" in body) || !Array.isArray(body.agreements)) {
        throw new Error("AGREEMENT_READ_UNAVAILABLE");
      }
      const items = body.agreements as Agreement[];
      if (items.some(item => !item || typeof item.agreementId !== "string" || !item.agreementId.trim() ||
        item.storeId !== storeId || typeof item.partnerActorId !== "string" || !item.partnerActorId.trim() ||
        typeof item.proposedByActorId !== "string" || !item.proposedByActorId.trim() ||
        typeof item.status !== "string" || typeof item.reason !== "string" ||
        !["COMMISSION", "SUBSCRIPTION", "HYBRID"].includes(item.commercialModel) ||
        !Number.isSafeInteger(item.recurringAmountMinor) || item.recurringAmountMinor < 0 ||
        item.recurringAmountMinor > 100000000 ||
        !["NONE", "MONTHLY", "ANNUAL"].includes(item.billingPeriod) ||
        item.billingTimeZone !== "Asia/Aden" ||
        !Number.isSafeInteger(item.invoiceDueDays) || item.invoiceDueDays < 0 || item.invoiceDueDays > 30 ||
        !Number.isSafeInteger(item.graceDays) || item.graceDays < 0 || item.graceDays > 30 ||
        !["NONE", "MANUAL", "AUTOMATIC"].includes(item.renewalPolicy) ||
        typeof item.terminationTerms !== "string" || typeof item.adjustmentTerms !== "string" ||
        !Number.isSafeInteger(item.agreementVersion) || item.agreementVersion < 1 ||
        !Array.isArray(item.rates) || item.rates.length < 1 || item.rates.length > 3 ||
        item.rates.some(rate => !rate || !Object.hasOwn(labels, rate.fulfillmentMode) ||
          !Number.isSafeInteger(rate.commissionRateBps) || rate.commissionRateBps < 0 ||
          rate.commissionRateBps > 10000 ||
          (rate.deliveryMarkupMinor !== undefined && (!Number.isSafeInteger(rate.deliveryMarkupMinor) ||
            rate.deliveryMarkupMinor < 0 || rate.deliveryMarkupMinor > 10000)) ||
          (rate.deliveryFixedFeeMinor !== undefined && (!Number.isSafeInteger(rate.deliveryFixedFeeMinor) ||
            rate.deliveryFixedFeeMinor < 0 || rate.deliveryFixedFeeMinor > 20000)) ||
          (rate.deliveryPricingMode !== undefined && !["DISTANCE", "FIXED", "FREE"].includes(rate.deliveryPricingMode)) ||
          ((rate.deliveryMarkupMinor ?? 0) > 0 && (rate.fulfillmentMode !== "BTHWANI_CAPTAIN" || rate.commissionRateBps !== 0)) ||
          (rate.fulfillmentMode !== "PARTNER_CAPTAIN" &&
            ((rate.deliveryPricingMode ?? "DISTANCE") !== "DISTANCE" || (rate.deliveryFixedFeeMinor ?? 0) !== 0)) ||
          (rate.fulfillmentMode === "PARTNER_CAPTAIN" && (
            ((rate.deliveryPricingMode ?? "DISTANCE") === "FIXED" && (rate.deliveryFixedFeeMinor ?? 0) <= 0) ||
            ((rate.deliveryPricingMode ?? "DISTANCE") !== "FIXED" && (rate.deliveryFixedFeeMinor ?? 0) !== 0)))) ||
        new Set(item.rates.map(rate => rate.fulfillmentMode)).size !== item.rates.length ||
        (item.commercialModel === "COMMISSION" && (item.recurringAmountMinor !== 0 ||
          item.billingPeriod !== "NONE" || item.invoiceDueDays !== 0 || item.graceDays !== 0 ||
          item.renewalPolicy !== "NONE" || item.terminationTerms !== "" || item.adjustmentTerms !== "")) ||
        (item.commercialModel === "SUBSCRIPTION" && (item.recurringAmountMinor < 1 ||
          !["MONTHLY", "ANNUAL"].includes(item.billingPeriod) ||
          !["MANUAL", "AUTOMATIC"].includes(item.renewalPolicy) ||
          item.rates.some(rate => rate.commissionRateBps !== 0) ||
          Array.from(item.terminationTerms).length < 8 || Array.from(item.terminationTerms).length > 500 ||
          Array.from(item.adjustmentTerms).length < 8 || Array.from(item.adjustmentTerms).length > 500))) ||
        new Set(items.map(item => item.agreementId)).size !== items.length) {
        throw new Error("AGREEMENT_READ_INVALID");
      }
      if (request !== readSequence.current || signal?.aborted) throw new Error("AGREEMENT_READ_SUPERSEDED");
      setAgreements(items);
      return items;
    } catch (cause) {
      if (request !== readSequence.current || signal?.aborted) throw new Error("AGREEMENT_READ_SUPERSEDED");
      throw cause;
    }
  }, [url, storeId]);

  useEffect(() => {
    const controller = new AbortController();
    setAgreements(null);
    setError("");
    setNotice("");
    void read(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted && !(cause instanceof Error && cause.message === "AGREEMENT_READ_SUPERSEDED")) setError(cause instanceof Error ? "تعذرت قراءة الاتفاقات؛ أعد المحاولة قبل اقتراح أي شروط." : "تعذرت قراءة الاتفاقات.");
    });
    return () => {
      controller.abort();
      readSequence.current++;
      // A pending POST may have committed. Suppress late updates and never replay.
      proposalController.current?.abort();
      proposalController.current = null;
    };
  }, [read]);

  async function propose() {
    if (readOnly || busy || proposalController.current || requiresConfirmation || !actorId || nextProposalVersion === null || modes.length === 0) return;
    const distinct = [...new Set(modes)];
    if (distinct.length !== modes.length || distinct.some(mode => !(mode in labels))) return;
    const rates = storeCommercialRatesForProposal(distinct, commissionPercentByMode, commercialModel);
    const recurring = commercialModel !== "COMMISSION";
    const amount = Number(recurringAmount);
    const due = Number(invoiceDueDays);
    const grace = Number(graceDays);
    if (!rates ||
      (recurring && (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000000 ||
        !Number.isSafeInteger(due) || due < 0 || due > 30 || !Number.isSafeInteger(grace) || grace < 0 || grace > 30 ||
        Array.from(terminationTerms.trim()).length < 8 || Array.from(terminationTerms.trim()).length > 500 ||
        Array.from(adjustmentTerms.trim()).length < 8 || Array.from(adjustmentTerms.trim()).length > 500)) ||
      Array.from(proposalReason.trim()).length < 8 || Array.from(proposalReason.trim()).length > 500) {
      setError("تحقق من النسبة والمبلغ وشروط العقد وسبب الاقتراح قبل الإرسال."); return;
    }
    const payload = {
      commercialModel,
      rates,
      expectedCurrentVersion: nextProposalVersion, reason: proposalReason.trim(),
      ...(recurring ? { recurringAmountMinor: amount, billingPeriod, billingTimeZone: "Asia/Aden", invoiceDueDays: due,
        graceDays: grace, renewalPolicy, terminationTerms: terminationTerms.trim(), adjustmentTerms: adjustmentTerms.trim() } : {}),
    };
    const expected: ExpectedStoreCommercialProposal = {
      storeId, proposedByActorId: actorId, agreementVersion: nextProposalVersion + 1,
      reason: proposalReason.trim(), commercialModel, rates,
      recurringAmountMinor: recurring ? amount : 0,
      billingPeriod: recurring ? billingPeriod : "NONE",
      billingTimeZone: "Asia/Aden",
      invoiceDueDays: recurring ? due : 0,
      graceDays: recurring ? grace : 0,
      renewalPolicy: recurring ? renewalPolicy : "NONE",
      terminationTerms: recurring ? terminationTerms.trim() : "",
      adjustmentTerms: recurring ? adjustmentTerms.trim() : "",
    };
    const controller = new AbortController();
    proposalController.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    let postAttempted = false;
    try {
      const headers = await stablePartnerMutationHeaders("commercial-proposal:" + actorId + ":" + storeId + ":" + nextProposalVersion + ":" + JSON.stringify(payload));
      if (controller.signal.aborted) return;
      postAttempted = true;
      const response = await fetch(url, {
        method: "POST", headers, body: JSON.stringify(payload),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error("PROPOSAL_REJECTED");
      const body = await response.json() as { agreement?: Agreement };
      if (controller.signal.aborted) return;
      const proposed = body.agreement;
      if (!proposed || !matchesProposedStoreAgreement(proposed, expected) ||
        !hasOnlyDefaultDeliveryFeeTerms(proposed)) {
        throw new Error("PROPOSAL_READBACK_MISMATCH");
      }
      const actual = await read(controller.signal);
      if (controller.signal.aborted) return;
      const confirmed = actual.filter(item =>
        item.agreementId === proposed.agreementId &&
        item.partnerActorId === proposed.partnerActorId &&
        matchesProposedStoreAgreement(item, expected) &&
        hasOnlyDefaultDeliveryFeeTerms(item));
      if (confirmed.length !== 1) {
        throw new Error("PROPOSAL_CANONICAL_READBACK_MISMATCH");
      }
      setNotice(recurring ? "حُفظ اقتراح الاشتراك بانتظار قبول صاحب المتجر. التحصيل والاعتماد المالي معطّلان حتى اكتمال الفوترة." :
        "حُفظ اقتراح العمولة بانتظار قبول صاحب المتجر واعتماد المالية.");
    } catch {
      if (controller.signal.aborted) return;
      if (!postAttempted) {
        // Header generation failed locally; WLT was never called.
        setError("تعذر تجهيز طلب الاقتراح، ولم يُرسل أي طلب. تحقق من المتصفح ثم حاول مجددًا.");
        return;
      }
      try { await read(controller.signal); } catch { if (!controller.signal.aborted) setAgreements(null); }
      if (!controller.signal.aborted) {
        setRequiresConfirmation(true);
        setError("لم نؤكد نتيجة الاقتراح. أعد قراءة الاتفاقات أولًا؛ لا تُنشئ عرضًا ثانيًا قبل التحقق.");
      }
    } finally {
      if (proposalController.current === controller) proposalController.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <section className="access-card" aria-label="الاتفاقات التجارية للمتجر">
    <h4>اقتراح الاتفاق التجاري للمتجر</h4>
    {agreements === null ? <p role="status">جارٍ قراءة اتفاقات المتجر…</p> : <>
      {agreements.length ? <>
      <p>توجد {agreements.length} نسخة محفوظة. {hasActiveAgreement
        ? "تظل الاتفاقية السارية نافذة حتى يقبل الشريك النسخة الجديدة وتعتمدها المالية، دون تعديل الطلبات السابقة."
        : "لا تُستبدل أي اتفاقية معلقة قبل حسمها."}</p>
      {agreements.map(item => <p key={item.agreementId}>النسخة {item.agreementVersion} · {storeCommercialStatusLabel(item)} · {item.commercialModel} {item.commercialModel !== "COMMISSION" ? "· " + item.recurringAmountMinor + " ريال " + item.billingPeriod : ""} · {item.rates.map(commercialRateDescription).join("، ")}</p>)}
      {hasUnknownAgreementStatus && !error ? <p role="alert" className="identity-error">توجد حالة اتفاق غير معروفة. لا يمكن اقتراح شروط قبل مراجعة السجل. <button className="button button-secondary" type="button" disabled={busy} onClick={() => void read().catch((cause: unknown) => { if (!(cause instanceof Error && cause.message === "AGREEMENT_READ_SUPERSEDED")) setError("تعذرت إعادة قراءة الاتفاقات."); })}>إعادة قراءة السجل</button></p> : null}
      </> : null}
      {!readOnly ? <>
      {nextProposalVersion === null ? <p>لا يمكن تقديم اقتراح أثناء وجود نسخة قيد القبول أو في حالة سجل غير متوقعة. راجع الاتفاقيات مع المالية وأعد القراءة.</p> : <>
      <p>{hasActiveAgreement ? "غيّر شروط المتجر باقتراح نسخة جديدة؛ الاتفاق الحالي يظل ساريًا حتى اعتماد البديل." : nextProposalVersion > 0 ? "راجع سبب رفض النسخة السابقة قبل إعادة الاقتراح." : "اختر النموذج التجاري؛ لا يسري قبل موافقة الشريك واعتماد المالية."}</p>
      <p>أوضاع التنفيذ: {modes.map(mode => labels[mode] ?? mode).join("، ")}</p>
      <section className="access-card" aria-label="مقارنة نماذج التعاقد">
        <h5>أي نموذج تجاري يناسب هذا المتجر؟</h5>
        <div className="form-grid">
          <p><strong>العمولة:</strong> نسبة تعاقدية على الطلبات المؤهلة لكل طريقة تنفيذ. لا تُستحق رسوم اشتراك دورية، ويسري الاتفاق بعد قبول مالك المتجر واعتماد المالية.</p>
          <p><strong>الاشتراك:</strong> مبلغ دوري متفق عليه بالريال اليمني دون عمولة على منتجات الطلبات. يمكن عرض المقترح وقبوله، لكن الاشتراك غير قابل للتفعيل أو التحصيل حاليًا حتى اكتمال فوترة WLT ومراجعتها.</p>
        </div>
        <p className="muted">صلاحيات الشريك لا تتغير بحسب النموذج التجاري؛ هذا اتفاق رسوم خاص بالمتجر وليس باقة مدفوعة لفتح الميزات. لا يتحول معدل عمولة 0% إلى اشتراك تلقائيًا.</p>
      </section>
      <div className="form-grid">
        <label className="field-label" htmlFor="store-commercial-model">نموذج الاتفاق
          <select id="store-commercial-model" value={commercialModel} onChange={event => setCommercialModel(event.target.value as "COMMISSION" | "SUBSCRIPTION")} disabled={busy}>
            <option value="COMMISSION">عمولة فقط</option>
            <option value="SUBSCRIPTION">اشتراك فقط دون عمولة منتجات</option>
          </select>
        </label>
        {commercialModel !== "SUBSCRIPTION" ? modes.map(mode =>
          <label className="field-label" htmlFor={"store-commercial-rate-" + mode} key={mode}>
            عمولة المنتجات (%) — {labels[mode]}
            <input id={"store-commercial-rate-" + mode} type="number" min="0" max="100" step="0.01"
              value={commissionPercentByMode[mode]}
              onChange={event => setCommissionPercentByMode(current => ({ ...current, [mode]: event.target.value }))}
              disabled={busy} />
          </label>
        ) : <p>عمولة المنتجات صفر صراحةً في نموذج الاشتراك لجميع طرق التنفيذ.</p>}
        {commercialModel !== "COMMISSION" ? <>
          <label className="field-label" htmlFor="store-commercial-amount">الاشتراك الدوري بالريال اليمني
            <input id="store-commercial-amount" type="number" min="1" max="100000000" step="1" value={recurringAmount} onChange={event => setRecurringAmount(event.target.value)} disabled={busy} />
          </label>
          <label className="field-label" htmlFor="store-commercial-period">الدورية
            <select id="store-commercial-period" value={billingPeriod} onChange={event => setBillingPeriod(event.target.value as "MONTHLY" | "ANNUAL")} disabled={busy}><option value="MONTHLY">شهري</option><option value="ANNUAL">سنوي</option></select>
          </label>
          <label className="field-label" htmlFor="store-commercial-due">أيام استحقاق الفاتورة
            <input id="store-commercial-due" type="number" min="0" max="30" step="1" value={invoiceDueDays} onChange={event => setInvoiceDueDays(event.target.value)} disabled={busy} />
          </label>
          <label className="field-label" htmlFor="store-commercial-grace">أيام السماح
            <input id="store-commercial-grace" type="number" min="0" max="30" step="1" value={graceDays} onChange={event => setGraceDays(event.target.value)} disabled={busy} />
          </label>
          <label className="field-label" htmlFor="store-commercial-renewal">التجديد
            <select id="store-commercial-renewal" value={renewalPolicy} onChange={event => setRenewalPolicy(event.target.value as "MANUAL" | "AUTOMATIC")} disabled={busy}><option value="MANUAL">بمراجعة يدوية</option><option value="AUTOMATIC">تلقائي وفق الاتفاق</option></select>
          </label>
          <label className="field-label" htmlFor="store-commercial-termination">شروط الإلغاء
            <textarea id="store-commercial-termination" rows={2} minLength={8} maxLength={500} value={terminationTerms} onChange={event => setTerminationTerms(event.target.value)} disabled={busy} />
          </label>
          <label className="field-label" htmlFor="store-commercial-adjustment">شروط التعديل أو الاسترداد
            <textarea id="store-commercial-adjustment" rows={2} minLength={8} maxLength={500} value={adjustmentTerms} onChange={event => setAdjustmentTerms(event.target.value)} disabled={busy} />
          </label>
        </> : null}
        <label className="field-label" htmlFor="store-commercial-proposal-reason">سبب الاقتراح
          <textarea id="store-commercial-proposal-reason" rows={2} minLength={8} maxLength={500} value={proposalReason} onChange={event => setProposalReason(event.target.value)} disabled={busy} />
        </label>
      </div>
      {commercialModel !== "COMMISSION" ? <p className="muted">الاشتراك اقتراح قابل للقبول فقط حاليًا؛ يمنع WLT الاعتماد والتحصيل حتى تنفيذ الفوترة والقيود والتسويات والمراجعة المستقلة.</p> :
        <p className="muted">عمولة 0% ليست اشتراكًا ولا تتحول تلقائيًا إلى اتفاق مدفوع.</p>}
      <button type="button" className="button button-secondary" disabled={busy || requiresConfirmation || !actorId || modes.length === 0} onClick={() => void propose()}>
        {busy ? "جارٍ إرسال الاقتراح…" : hasActiveAgreement ? "اقتراح تعديل الاتفاق الساري" : nextProposalVersion > 0 ? "إعادة اقتراح الاتفاق بعد التصحيح" : "اقتراح الاتفاق التجاري"}
      </button>
      </>}
      </> : <p className="muted">يُحدّد نموذج العمولة أو الاشتراك من قسم السياسات في لوحة التحكم بواسطة المشغّل المخوّل. هذه الصفحة تعرض سجل الاتفاقيات للمتابعة فقط؛ القبول والاعتماد يظلان مستقلين.</p>}
    </>}
    {error ? <p role="alert" className="identity-error">{error} <button className="button button-secondary" type="button" disabled={busy} onClick={() => { setError(""); void read().then(() => setRequiresConfirmation(false)).catch(() => setError("تعذرت إعادة القراءة.")); }}>إعادة القراءة</button></p> : null}
    {notice ? <output>{notice}</output> : null}
  </section>;
}