"use client";

import { type StoreFulfillmentMode } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../session/session-provider";
import { stablePartnerMutationHeaders } from "../partners/partner-request";

type Agreement = Readonly<{
  agreementId: string;
  status: string;
  agreementVersion: number;
  rates: readonly { fulfillmentMode: string; commissionRateBps: number }[];
}>;

const reason = "عرض تأسيسي بعمولة منتجات صفرية بانتظار قبول الشريك واعتماد المالية";
const labels: Record<string, string> = {
  BTHWANI_CAPTAIN: "توصيل بثواني",
  PARTNER_CAPTAIN: "توصيل المتجر",
  CUSTOMER_PICKUP: "استلام العميل",
};

export function StoreZeroCommissionProposal({ storeId, modes }: Readonly<{storeId: string; modes: readonly StoreFulfillmentMode[]}>) {
  const { state: sessionState } = useSession();
  const actorId = sessionState.kind === "authenticated" ? sessionState.identity.subject : "";
  const [agreements, setAgreements] = useState<readonly Agreement[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = `/api/partners/stores/${encodeURIComponent(storeId)}/commercial-agreements`;

  const read = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(url, { cache: "no-store", signal: signal ?? null });
    const body: unknown = await response.json();
    if (!response.ok || !body || typeof body !== "object" || !("agreements" in body) || !Array.isArray(body.agreements)) {
      throw new Error("AGREEMENT_READ_UNAVAILABLE");
    }
    const items = body.agreements as Agreement[];
    if (items.some(item => !item.agreementId || !Array.isArray(item.rates))) throw new Error("AGREEMENT_READ_INVALID");
    setAgreements(items);
    return items;
  }, [url]);

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
    if (busy || !actorId || !agreements || agreements.length !== 0 || modes.length === 0) return;
    const distinct = [...new Set(modes)];
    if (distinct.length !== modes.length || distinct.some(mode => !(mode in labels))) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const headers = await stablePartnerMutationHeaders(`initial-zero-commission:${actorId}:${storeId}`);
      const response = await fetch(url, {
        method: "POST", headers,
        body: JSON.stringify({
          rates: distinct.map(fulfillmentMode => ({ fulfillmentMode, commissionRateBps: 0 })),
          expectedCurrentVersion: 0, reason,
        }),
      });
      if (!response.ok) throw new Error("PROPOSAL_REJECTED");
      const body = await response.json() as { agreement?: Agreement };
      if (!body.agreement || body.agreement.status !== "PROPOSED" || body.agreement.rates.length !== distinct.length ||
        body.agreement.rates.some(rate => rate.commissionRateBps !== 0 || !distinct.includes(rate.fulfillmentMode as StoreFulfillmentMode))) {
        throw new Error("PROPOSAL_READBACK_MISMATCH");
      }
      const actual = await read();
      if (!actual.some(item => item.agreementId === body.agreement?.agreementId && item.status === "PROPOSED")) throw new Error("PROPOSAL_CANONICAL_READBACK_MISMATCH");
      setNotice("تم إنشاء عرض بعمولة منتجات صفرية. ينتظر قبول صاحب المتجر ثم اعتماد المالية.");
    } catch {
      try { await read(); } catch { setAgreements(null); }
      setError("لم نؤكد نتيجة الاقتراح. أعد قراءة الاتفاقات أولًا؛ لا تُنشئ عرضًا ثانيًا قبل التحقق.");
    } finally { setBusy(false); }
  }

  return <section className="access-card" aria-label="الاتفاق التجاري الأول للمتجر">
    <h4>الاتفاق التجاري الأول</h4>
    {agreements === null ? <p role="status">جارٍ قراءة اتفاقات المتجر…</p> : agreements.length ? <>
      <p>توجد {agreements.length} نسخة محفوظة. لا يمكن إنشاء عرض تأسيسي جديد فوق اتفاق موجود من هذا الإجراء.</p>
      {agreements.map(item => <p key={item.agreementId}>النسخة {item.agreementVersion} · {item.status} · {item.rates.map(rate => `${labels[rate.fulfillmentMode] ?? rate.fulfillmentMode}: ${rate.commissionRateBps / 100}%`).join("، ")}</p>)}
    </> : <>
      <p>لا توجد اتفاقية لهذا المتجر. يمكن للشراكات اقتراح عمولة منتجات صفرية للأوضاع المفعّلة، دون تفعيلها تلقائيًا.</p>
      <p>{modes.map(mode => labels[mode] ?? mode).join("، ")}</p>
      <p>المدة التأسيسية وتاريخ الانتقال إلى اتفاق آخر غير محددين بهذا العرض؛ لا تُعلن مدة قبل اعتماد سياستها وتنفيذها.</p>
      <button type="button" className="button button-secondary" disabled={busy || !actorId || modes.length === 0} onClick={() => void propose()}>
        {busy ? "جارٍ إرسال الاقتراح…" : "اقتراح اتفاق بعمولة 0%"}
      </button>
    </>}
    {error ? <p role="alert" className="identity-error">{error} <button className="button button-secondary" type="button" disabled={busy} onClick={() => {setError("");void read().catch(() => setError("تعذرت إعادة القراءة."));}}>إعادة القراءة</button></p> : null}
    {notice ? <output>{notice}</output> : null}
  </section>;
}