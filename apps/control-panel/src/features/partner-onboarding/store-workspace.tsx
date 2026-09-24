"use client";

import { publicationReadinessBlockedReasonLabel, publicationStateLabel, type StoreFulfillmentMode, type StoreFulfillmentModesResponse, type StorePublicationResponse } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";
import { partnerMutationHeaders } from "./partner-request";
import "./store-workspace.module.css";

const fulfillmentModeOptions: ReadonlyArray<Readonly<{ value: StoreFulfillmentMode; label: string; description: string }>> = [
  { value: "BTHWANI_CAPTAIN", label: "توصيل بثواني", description: "تتولى المنصة إسناد التوصيل وإدارته." },
  { value: "PARTNER_CAPTAIN", label: "توصيل المتجر", description: "يعيّن المتجر كابتنًا من كباتنه النشطين." },
  { value: "CUSTOMER_PICKUP", label: "استلام من المتجر", description: "يستلم العميل طلبه مباشرة من المتجر." },
];

export function StoreWorkspace({ storeId }: Readonly<{ storeId: string }>) {
  const [publication, setPublication] = useState<StorePublicationResponse | null>(null);
  const [selectedModes, setSelectedModes] = useState<ReadonlyArray<StoreFulfillmentMode>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestSequence = useRef(0);

  const readStore = useCallback(async (showLoading = true): Promise<StorePublicationResponse | null> => {
    const sequence = ++requestSequence.current;
    if (showLoading) setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/publication`, { cache: "no-store" });
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      const next = await response.json() as StorePublicationResponse;
      if (sequence !== requestSequence.current) return null;
      setPublication(next);
      setSelectedModes(next.store.fulfillmentModes);
      return next;
    } catch (cause) {
      if (sequence !== requestSequence.current) return null;
      setError(cause instanceof Error ? cause.message : "تعذرت قراءة سجل المتجر من DSH.");
      return null;
    } finally {
      if (sequence === requestSequence.current && showLoading) setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void readStore();
    return () => { requestSequence.current += 1; };
  }, [readStore]);

  async function reconcileFailure(response: Response, fallback: string) {
    const message = await partnerErrorMessage(response);
    await readStore(false);
    setError(message || fallback);
  }

  async function changePublication() {
    const current = publication?.store;
    if (!current) return;
    const nextState = current.publicationState === "published" ? "hidden" : "published";
    if (nextState === "published" && !current.publicationReadiness.ready) {
      setError(`لا يمكن نشر المتجر: ${publicationReadinessBlockedReasonLabel(current.publicationReadiness.blockedReason)}`);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(current.id)}/publication`, {
        method: "POST",
        headers: partnerMutationHeaders(),
        body: JSON.stringify({ state: nextState, expectedVersion: current.version }),
      });
      if (!response.ok) {
        await reconcileFailure(response, "تعذر تغيير حالة النشر.");
        return;
      }
      const result = await response.json() as StorePublicationResponse;
      setPublication(result);
      setSelectedModes(result.store.fulfillmentModes);
      setNotice("سُجل تغيير النشر في DSH وعادت الحالة الكانونية الجديدة.");
    } catch {
      await readStore(false);
      setError("تعذر تأكيد نتيجة تغيير النشر. تمت إعادة قراءة المتجر؛ راجع الحالة قبل إعادة المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  async function saveFulfillmentModes() {
    const current = publication?.store;
    if (!current || selectedModes.length === 0) {
      setError("اختر وضع طلب واحدًا على الأقل للمتجر.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(current.id)}/fulfillment-modes`, {
        method: "POST",
        headers: partnerMutationHeaders(),
        body: JSON.stringify({ fulfillmentModes: selectedModes, expectedVersion: current.version }),
      });
      if (!response.ok) {
        await reconcileFailure(response, "تعذر حفظ أوضاع الطلب.");
        return;
      }
      const result = await response.json() as StoreFulfillmentModesResponse;
      await readStore(false);
      setSelectedModes(result.fulfillmentModes);
      setNotice("حُفظت أوضاع الطلب ثم أُعيدت قراءة سجل المتجر من DSH.");
    } catch {
      await readStore(false);
      setError("تعذر تأكيد حفظ أوضاع الطلب. تمت إعادة قراءة المتجر؛ راجع الحالة قبل إعادة المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  const store = publication?.store;
  return (
    <section className="workspace-page store-workspace" aria-labelledby="store-workspace-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">الشركاء · المتاجر · DSH</p>
        <h1 id="store-workspace-title">{store?.name ?? "ملف المتجر"}</h1>
        {store ? <p className="lead"><bdi dir="ltr">{store.id}</bdi></p> : null}
        <Link className="button button-secondary" href="/partners/stores">العودة إلى سجل المتاجر</Link>
      </div>

      {loading ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة الملف الكانوني من DSH</strong></div> : null}
      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر إكمال العملية</strong><p>{error}</p><button type="button" className="button button-secondary" disabled={busy} onClick={() => void readStore()}>إعادة قراءة المتجر</button></div> : null}
      {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}

      {store ? <>
        <section className="store-detail-section" aria-labelledby="store-detail-context-title">
          <div className="store-detail-heading"><div><p className="eyebrow">ملكية DSH</p><h2 id="store-detail-context-title">معلومات المتجر والعلاقات</h2></div><button type="button" className="button button-secondary" disabled={loading || busy} onClick={() => void readStore()}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button></div>
          <dl className="store-detail-facts">
            <div><dt>الشريك المالك</dt><dd><Link href={`/partners/actors/${encodeURIComponent(store.partnerActorId)}`}><bdi dir="ltr">{store.partnerActorId}</bdi></Link></dd></div>
            <div><dt>مدينة الخدمة</dt><dd>{store.serviceCityId ? <bdi dir="ltr">{store.serviceCityId}</bdi> : "غير محددة"}</dd></div>
            <div><dt>الفئة الرئيسية</dt><dd>{store.primaryVerticalId ? <bdi dir="ltr">{store.primaryVerticalId}</bdi> : "غير محددة"}</dd></div>
            <div><dt>نسخة المتجر</dt><dd>v{store.version}</dd></div>
            <div><dt>تاريخ الإنشاء</dt><dd><time dateTime={store.createdAt}>{new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(store.createdAt))}</time></dd></div>
            <div><dt>آخر تحديث</dt><dd><time dateTime={store.updatedAt}>{new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(store.updatedAt))}</time></dd></div>
          </dl>
        </section>

        <section className="store-detail-section" aria-labelledby="store-publication-title">
          <div className="store-detail-heading"><div><p className="eyebrow">حالة العرض للعميل</p><h2 id="store-publication-title">النشر والجاهزية</h2></div><span className={`status-badge status-${store.publicationState}`}>{publicationStateLabel(store.publicationState)}</span></div>
          <p>{store.publicationReadiness.ready ? "المتجر مستوفٍ لشروط النشر الحالية." : `الجاهزية: ${publicationReadinessBlockedReasonLabel(store.publicationReadiness.blockedReason)}`}</p>
          <div className="button-row"><button type="button" className="button button-primary" disabled={busy || loading || (!store.publicationReadiness.ready && store.publicationState !== "published")} onClick={() => void changePublication()}>{busy ? "جارٍ الحفظ…" : store.publicationState === "published" ? "إخفاء المتجر" : "نشر المتجر"}</button><button type="button" className="button button-secondary" disabled={busy || loading} onClick={() => void readStore()}>إعادة قراءة النشر</button></div>
        </section>

        <section className="store-detail-section" aria-labelledby="store-fulfillment-title">
          <div className="store-detail-heading"><div><p className="eyebrow">الطلبات</p><h2 id="store-fulfillment-title">أوضاع التنفيذ</h2></div></div>
          <fieldset className="store-fulfillment-options" disabled={busy || loading}>
            <legend>الأوضاع التي يتيحها المتجر</legend>
            {fulfillmentModeOptions.map((option) => <label key={option.value} className="store-fulfillment-option"><input type="checkbox" checked={selectedModes.includes(option.value)} onChange={() => setSelectedModes((current) => current.includes(option.value) ? current.filter((mode) => mode !== option.value) : [...current, option.value])} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}
          </fieldset>
          <div className="button-row"><button type="button" className="button button-primary" disabled={busy || loading || selectedModes.length === 0 || selectedModes.length === store.fulfillmentModes.length && selectedModes.every((mode) => store.fulfillmentModes.includes(mode))} onClick={() => void saveFulfillmentModes()}>{busy ? "جارٍ الحفظ…" : "حفظ أوضاع التنفيذ"}</button><button type="button" className="button button-secondary" disabled={busy || loading} onClick={() => { setSelectedModes(store.fulfillmentModes); setError(""); }}>إلغاء التغييرات</button></div>
        </section>

        <section className="store-detail-section" aria-labelledby="store-catalog-title">
          <div className="store-detail-heading"><div><p className="eyebrow">كتالوج المتجر</p><h2 id="store-catalog-title">منتجات وعروض المتجر</h2></div><Link href="/catalog/products">فتح مساحة الكتالوج</Link></div>
          <p className="muted">تُدار المنتجات والعروض من مسارات الكتالوج المعتمدة. ملف التشغيل يقرأ إعدادات المتجر ونشره فقط.</p>
        </section>
      </> : null}
    </section>
  );
}
