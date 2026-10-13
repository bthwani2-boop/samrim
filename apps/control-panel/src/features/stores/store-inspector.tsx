"use client";

import { publicationReadinessBlockedReasonLabel, type StorePublicationResponse } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { partnerErrorMessage } from "../partners/partner-error-message";
import { StoreLogo } from "./store-logo";
import { FulfillmentIndicators, PublicationIndicator } from "./store-indicators";
import { useReadOnReturn } from "../shared/use-read-on-return";

export function StoreInspector({ storeId, detailHref, onClose, onPrevious, onNext }: Readonly<{ storeId: string; detailHref: string; onClose: () => void; onPrevious?: (() => void) | undefined; onNext?: (() => void) | undefined }>) {
  const [store, setStore] = useState<StorePublicationResponse["store"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const region = useRef<HTMLElement | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (signal = AbortSignal.timeout(12_000)) => {
    const request = ++sequence.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/publication`, { cache: "no-store", signal });
      if (!response.ok) throw new Error(response.status === 403 ? "لا تملك صلاحية قراءة جاهزية هذا المتجر." : await partnerErrorMessage(response));
      const result = await response.json() as StorePublicationResponse;
      if (request !== sequence.current) return;
      if (result?.store?.id !== storeId || typeof result.store.name !== "string" || !Array.isArray(result.store.fulfillmentModes) || !Number.isFinite(Date.parse(result.store.updatedAt)) || typeof result.store.publicationReadiness?.ready !== "boolean" || !["published", "hidden", "unpublished"].includes(result.store.publicationState)) throw new Error("استجابة معاينة المتجر غير صالحة. أعد القراءة.");
      setStore(result.store);
    } catch (cause) {
      if (request === sequence.current) { setStore(null); setError(cause instanceof DOMException && cause.name === "TimeoutError" ? "استغرقت قراءة المعاينة وقتًا طويلًا. أعد المحاولة." : cause instanceof Error ? cause.message : "تعذرت قراءة معاينة المتجر."); }
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [storeId]);
  useReadOnReturn(load, !loading);

  useEffect(() => {
    region.current?.focus();
    const controller = new AbortController();
    void load(AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
    return () => { sequence.current += 1; controller.abort(); };
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void load(AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
    };
    const interval = window.setInterval(refresh, 120_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [load]);

  return <section ref={region} className="store-detail-section store-inspector" aria-label="معاينة المتجر" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <div className="store-detail-heading"><h2>معاينة المتجر</h2><button type="button" className="button button-secondary" onClick={onClose}>إغلاق المعاينة</button></div>
    <nav className="store-inspector-navigation" aria-label="متاجر الصفحة الحالية"><button type="button" className="button button-secondary" onClick={onPrevious} disabled={!onPrevious}>المتجر السابق</button><button type="button" className="button button-secondary" onClick={onNext} disabled={!onNext}>المتجر التالي</button></nav>
    {loading ? <p role="status">جارٍ قراءة النشر والجاهزية الحالية…</p> : null}
    {error ? <div role="alert"><p className="identity-error">{error}</p><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>إعادة قراءة المعاينة</button></div> : null}
    {store ? <>
      <div className="partner-case-summary-main"><StoreLogo name={store.name} uri={store.storeProfileImage?.uri} /><div><strong>{store.name}</strong><Link href={`/partners/actors/${encodeURIComponent(store.partnerActorId)}`}>{store.partnerName || "فتح ملف الشريك"}</Link></div></div>
      <div className="store-inspector-next-action"><strong>{store.publicationReadiness.ready ? "جاهز للنشر" : "المطلوب قبل النشر"}</strong><p>{store.publicationReadiness.ready ? "المتجر مستوفٍ لشروط النشر الحالية." : publicationReadinessBlockedReasonLabel(store.publicationReadiness.blockedReason)}</p><Link className="button button-secondary" href={detailHref}>فتح ملف المتجر الكامل</Link></div>
      <dl className="store-detail-facts">
        <div><dt>حالة النشر الحالية</dt><dd><PublicationIndicator state={store.publicationState} /></dd></div>
        <div><dt>مدينة الخدمة</dt><dd>{store.serviceCityName || "غير محددة"}</dd></div>
        <div><dt>النشاط الرئيسي</dt><dd>{store.primaryVerticalName || "غير محددة"}</dd></div>
        <div><dt>أوضاع الطلب</dt><dd><FulfillmentIndicators modes={store.fulfillmentModes} /></dd></div>
        <div><dt>آخر تحديث السجل</dt><dd><time dateTime={store.updatedAt}>{new Date(store.updatedAt).toLocaleString("ar-YE")}</time></dd></div>
      </dl>
    </> : null}
    {!store ? <Link className="button button-secondary" href={detailHref}>فتح ملف المتجر الكامل</Link> : null}
  </section>;
}
