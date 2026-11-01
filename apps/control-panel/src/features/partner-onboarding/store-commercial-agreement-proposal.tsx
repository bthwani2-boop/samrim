"use client";

import { type StoreFulfillmentMode } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../session/session-provider";
import { stablePartnerMutationHeaders } from "../partners/partner-request";
import { nextStoreCommercialAgreementVersion } from "./store-commercial-agreement-version";
import { matchesProposedStoreAgreement, storeCommercialRatesForProposal, type ExpectedStoreCommercialProposal, type StoreCommercialProposalReadback } from "./store-commercial-proposal-rates";

type Agreement = StoreCommercialProposalReadback & Readonly<{ partnerActorId: string }>;

const labels: Record<string, string> = {
  BTHWANI_CAPTAIN: "توصيل بثواني",
  PARTNER_CAPTAIN: "توصيل المتجر",
  CUSTOMER_PICKUP: "استلام العميل",
};

export function StoreCommercialAgreementProposal({ storeId, modes }: Readonly<{storeId: string; modes: readonly StoreFulfillmentMode[]}>) {
  const { state: sessionState } = useSession();
  const actorId = sessionState.kind === "authenticated" ? sessionState.identity.subject : "";
  const [agreements, setAgreements] = useState<readonly Agreement[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [commercialModel, setCommercialModel] = useState<"COMMISSION" | "SUBSCRIPTION">("COMMISSION");
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

  const read = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(url, { cache: "no-store", signal: signal ?? null });
    const body: unknown = await response.json();
    if (!response.ok || !body || typeof body !== "object" || !("agreements" in body) || !Array.isArray(body.agreements)) {
      throw new Error("AGREEMENT_READ_UNAVAILABLE");
    }
    const items = body.agreements as Agreement[];
    if (items.some(item => !item.agreementId || item.storeId !== storeId || !Array.isArray(item.rates))) throw new Error("AGREEMENT_READ_INVALID");
    setAgreements(items);
    return items;
  }, [url, storeId]);

  useEffect(() => {
    const controller = new AbortController();
    setAgreements(null);
    setError("");
    setNotice("");
    void read(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? "تعذرت قراءة الاتفاقات؛ أعد المحاولة قبل اقتراح أي شروط." : "تعذرت قراءة الاتفاقات.");
    });
    return () => controller.abort();
  }, [read]);

  async function propose() {
    if (busy || !actorId || nextProposalVersion === null || modes.length === 0) return;
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
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const headers = await stablePartnerMutationHeaders("commercial-proposal:" + actorId + ":" + storeId + ":" + nextProposalVersion + ":" + JSON.stringify(payload));
      const response = await fetch(url, {
        method: "POST", headers, body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("PROPOSAL_REJECTED");
      const body = await response.json() as { agreement?: Agreement };
      const proposed = body.agreement;
      if (!proposed || !matchesProposedStoreAgreement(proposed, expected)) {
        throw new Error("PROPOSAL_READBACK_MISMATCH");
      }
      const actual = await read();
      const confirmed = actual.filter(item =>
        item.agreementId === proposed.agreementId &&
        item.partnerActorId === proposed.partnerActorId &&
        matchesProposedStoreAgreement(item, expected));
      if (confirmed.length !== 1) {
        throw new Error("PROPOSAL_CANONICAL_READBACK_MISMATCH");
      }
      setNotice(recurring ? "حُفظ اقتراح الاشتراك بانتظار قبول صاحب المتجر. التحصيل والاعتماد المالي معطّلان حتى اكتمال الفوترة." :
        "حُفظ اقتراح العمولة بانتظار قبول صاحب المتجر واعتماد المالية.");
    } catch {
      try { await read(); } catch { setAgreements(null); }
      setError("لم نؤكد نتيجة الاقتراح. أعد قراءة الاتفاقات أولًا؛ لا تُنشئ عرضًا ثانيًا قبل التحقق.");
    } finally { setBusy(false); }
  }

  return <section className="access-card" aria-label="الاتفاقات التجارية للمتجر">
    <h4>اقتراح الاتفاق التجاري للمتجر</h4>
    {agreements === null ? <p role="status">جارٍ قراءة اتفاقات المتجر…</p> : <>
      {agreements.length ? <>
      <p>توجد {agreements.length} نسخة محفوظة. {hasActiveAgreement
        ? "تظل الاتفاقية السارية نافذة حتى يقبل الشريك النسخة الجديدة وتعتمدها المالية، دون تعديل الطلبات السابقة."
        : "لا تُستبدل أي اتفاقية معلقة قبل حسمها."}</p>
      {agreements.map(item => <p key={item.agreementId}>النسخة {item.agreementVersion} · {item.status} · {item.commercialModel} {item.commercialModel !== "COMMISSION" ? "· " + item.recurringAmountMinor + " ريال " + item.billingPeriod : ""} · {item.rates.map(rate => labels[rate.fulfillmentMode] + ": " + (rate.commissionRateBps / 100) + "%").join("، ")}</p>)}
      </> : null}
      {nextProposalVersion === null ? <p>لا يمكن تقديم اقتراح أثناء وجود نسخة قيد القبول أو في حالة سجل غير متوقعة. راجع الاتفاقيات مع المالية وأعد القراءة.</p> : <>
      <p>{hasActiveAgreement ? "غيّر شروط المتجر باقتراح نسخة جديدة؛ الاتفاق الحالي يظل ساريًا حتى اعتماد البديل." : nextProposalVersion > 0 ? "راجع سبب رفض النسخة السابقة قبل إعادة الاقتراح." : "اختر النموذج التجاري؛ لا يسري قبل موافقة الشريك واعتماد المالية."}</p>
      <p>أوضاع التنفيذ: {modes.map(mode => labels[mode] ?? mode).join("، ")}</p>
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
      <button type="button" className="button button-secondary" disabled={busy || !actorId || modes.length === 0} onClick={() => void propose()}>
        {busy ? "جارٍ إرسال الاقتراح…" : hasActiveAgreement ? "اقتراح تعديل الاتفاق الساري" : nextProposalVersion > 0 ? "إعادة اقتراح الاتفاق بعد التصحيح" : "اقتراح الاتفاق التجاري"}
      </button>
      </>}
    </>}
    {error ? <p role="alert" className="identity-error">{error} <button className="button button-secondary" type="button" disabled={busy} onClick={() => {setError("");void read().catch(() => setError("تعذرت إعادة القراءة."));}}>إعادة القراءة</button></p> : null}
    {notice ? <output>{notice}</output> : null}
  </section>;
}