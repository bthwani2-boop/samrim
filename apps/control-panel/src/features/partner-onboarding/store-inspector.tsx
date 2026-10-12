"use client";

import { fulfillmentModeLabel, publicationReadinessBlockedReasonLabel, publicationStateLabel, type StorePublicationResponse } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";

export function StoreInspector({ storeId, detailHref, onClose }: Readonly<{ storeId: string; detailHref: string; onClose: () => void }>) {
  const [store, setStore] = useState<StorePublicationResponse["store"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const region = useRef<HTMLElement | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (signal = AbortSignal.timeout(12_000)) => {
    const request = ++sequence.current;
    setLoading(true); setError(""); setStore(null);
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/publication`, { cache: "no-store", signal });
      if (!response.ok) throw new Error(response.status === 403 ? "لا تملك صلاحية قراءة جاهزية هذا المتجر." : await partnerErrorMessage(response));
      const result = await response.json() as StorePublicationResponse;
      if (request !== sequence.current) return;
      if (result?.store?.id !== storeId || typeof result.store.name !== "string" || !Array.isArray(result.store.fulfillmentModes) || !Number.isFinite(Date.parse(result.store.updatedAt)) || typeof result.store.publicationReadiness?.ready !== "boolean" || !["published", "hidden", "unpublished"].includes(result.store.publicationState)) throw new Error("استجابة معاينة المتجر غير صالحة. أعد القراءة.");
      setStore(result.store);
    } catch (cause) {
      if (request === sequence.current) setError(cause instanceof DOMException && cause.name === "TimeoutError" ? "استغرقت قراءة المعاينة وقتًا طويلًا. أعد القراءة." : cause instanceof Error ? cause.message : "تعذرت قراءة معاينة المتجر.");
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    region.current?.focus();
    const controller = new AbortController();
    void load(AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
    return () => { sequence.current += 1; controller.abort(); };
  }, [load]);

  return <section ref={region} className="store-detail-section store-inspector" aria-label="معاينة المتجر" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <div className="store-detail-heading"><h2>{store?.name ?? "معاينة المتجر"}</h2><button type="button" className="button button-secondary" onClick={onClose}>إغلاق المعاينة</button></div>
    {loading ? <p role="status">جارٍ قراءة النشر والجاهزية الحالية…</p> : null}
    {error ? <p className="identity-error" role="alert">{error}</p> : null}
    {store ? <>
      <dl className="store-detail-facts">
        <div><dt>حالة النشر الحالية</dt><dd>{publicationStateLabel(store.publicationState)}</dd></div>
        <div><dt>الشريك</dt><dd>{store.partnerName || "ملف الشريك"}</dd></div>
        <div><dt>مدينة الخدمة</dt><dd>{store.serviceCityName || "غير محددة"}</dd></div>
        <div><dt>النشاط الرئيسي</dt><dd>{store.primaryVerticalName || "غير محددة"}</dd></div>
        <div><dt>أوضاع الطلب</dt><dd>{store.fulfillmentModes.map(fulfillmentModeLabel).join("، ") || "غير محددة"}</dd></div>
        <div><dt>آخر تحديث السجل</dt><dd><time dateTime={store.updatedAt}>{new Date(store.updatedAt).toLocaleString("ar-YE")}</time></dd></div>
      </dl>
      <p>{store.publicationReadiness.ready ? "المتجر مستوفٍ لشروط النشر الحالية." : `الجاهزية: ${publicationReadinessBlockedReasonLabel(store.publicationReadiness.blockedReason)}`}</p>
    </> : null}
    <div className="button-row"><Link className="button button-secondary" href={detailHref}>فتح ملف المتجر الكامل</Link><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>إعادة قراءة المعاينة</button></div>
  </section>;
}
