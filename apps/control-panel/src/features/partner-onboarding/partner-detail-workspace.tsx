"use client";

import { type JoiningCaseView, joiningCaseStateLabel, type PartnerManagedStore } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";
import "./partner-detail-workspace.module.css";

type PartnerDetail = Readonly<{ partner: ActorRoleView; joiningCase: JoiningCaseView | null }>;
type PartnerStoresPage = Readonly<{ stores: ReadonlyArray<PartnerManagedStore>; nextCursor?: string }>;

export function PartnerDetailWorkspace({ actorId }: Readonly<{ actorId: string }>) {
  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [stores, setStores] = useState<ReadonlyArray<PartnerManagedStore>>([]);
  const [storesCursor, setStoresCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingStores, setLoadingStores] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [storesError, setStoresError] = useState("");

  const loadStores = useCallback(async (cursor = "", append = false) => {
    if (append) setLoadingMore(true); else setLoadingStores(true);
    setStoresError("");
    try {
      const params = new URLSearchParams({ limit: "25" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/partners/roster/${encodeURIComponent(actorId)}/stores?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      const payload = await response.json() as PartnerStoresPage;
      setStores((current) => append ? [...current, ...payload.stores] : payload.stores);
      setStoresCursor(payload.nextCursor ?? "");
    } catch (cause) {
      setStoresError(cause instanceof Error ? cause.message : "تعذرت قراءة متاجر الشريك من DSH.");
    } finally {
      setLoadingStores(false);
      setLoadingMore(false);
    }
  }, [actorId]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/partners/roster/${encodeURIComponent(actorId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await partnerErrorMessage(response));
        return await response.json() as PartnerDetail;
      })
      .then((payload) => { if (active) setDetail(payload); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "تعذرت قراءة ملف الشريك."); })
      .finally(() => { if (active) setLoading(false); });
    void loadStores();
    return () => { active = false; };
  }, [actorId, loadStores]);

  return (
    <section className="workspace-page partner-detail-workspace" aria-labelledby="partner-detail-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">الشركاء · ملف تشغيلي</p>
        <h1 id="partner-detail-title">{detail?.partner.phoneE164 ? <bdi dir="ltr">{detail.partner.phoneE164}</bdi> : "تفاصيل الشريك"}</h1>
        <p className="lead">هوية الشريك من Identity، وحالة الانضمام والمتاجر من DSH. تعرض الصفحة قراءة حالية لكل مالك دون نسخ بياناته.</p>
        <Link className="button button-secondary" href="/partners">العودة إلى قائمة الشركاء</Link>
      </div>

      {loading ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة ملف الشريك</strong></div> : null}
      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذرت قراءة ملف الشريك</strong><p>{error}</p></div> : null}
      {detail ? (
        <section className="partner-detail-section" aria-labelledby="partner-identity-title">
          <h2 id="partner-identity-title">الحساب والانضمام</h2>
          <dl className="partner-detail-facts">
            <div><dt>رقم الهاتف</dt><dd><bdi dir="ltr">{detail.partner.phoneE164}</bdi></dd></div>
            <div><dt>حالة الهوية</dt><dd>{detail.partner.securityEnabled ? "محمية" : "موقوفة"}</dd></div>
            <div><dt>حالة دور الشريك</dt><dd>{detail.partner.enabled ? detail.partner.activatedAt ? "مفعّل" : "بانتظار التفعيل" : "موقوف"}</dd></div>
            <div><dt>حالة الانضمام</dt><dd>{detail.joiningCase ? joiningCaseStateLabel(detail.joiningCase.state) : "لا توجد حالة انضمام مرتبطة"}</dd></div>
            {detail.joiningCase ? <div><dt>الاسم التجاري</dt><dd>{detail.joiningCase.businessName}</dd></div> : null}
            {detail.joiningCase ? <div><dt>طلب الانضمام</dt><dd><Link href={`/partners/${encodeURIComponent(detail.joiningCase.id)}`}>فتح حالة الانضمام</Link></dd></div> : null}
          </dl>
        </section>
      ) : null}

      <section className="partner-detail-section" aria-labelledby="partner-stores-title">
        <div className="partner-detail-section-heading"><div><p className="eyebrow">DSH</p><h2 id="partner-stores-title">متاجر الشريك</h2></div><button type="button" className="button button-secondary" disabled={loadingStores || loadingMore} onClick={() => void loadStores()}>{loadingStores ? "جارٍ القراءة…" : "إعادة قراءة المتاجر"}</button></div>
        {storesError ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذرت قراءة المتاجر</strong><p>{storesError}</p><button type="button" className="button button-secondary" onClick={() => void loadStores()} disabled={loadingStores}>إعادة المحاولة</button></div> : null}
        {!loadingStores && !storesError && stores.length === 0 ? <div className="collection-state"><strong>لا توجد متاجر مرتبطة بهذا الشريك</strong><p>هذه نتيجة قراءة DSH الحالية.</p></div> : null}
        {stores.length > 0 ? <div className="partner-stores-table-wrap"><table className="operations-table"><caption className="visually-hidden">متاجر الشريك</caption><thead><tr><th scope="col">المتجر</th><th scope="col">مدينة الخدمة</th><th scope="col">الفئة الرئيسية</th><th scope="col">النشر</th><th scope="col">أنماط التنفيذ</th></tr></thead><tbody>{stores.map((store) => <tr key={store.id}><th scope="row">{store.name}</th><td><bdi dir="ltr">{store.serviceCityId || "غير محددة"}</bdi></td><td><bdi dir="ltr">{store.primaryVerticalId || "غير محددة"}</bdi></td><td>{store.publicationState === "published" ? "منشور" : "غير منشور"}</td><td>{store.fulfillmentModes.join("، ") || "غير محددة"}</td></tr>)}</tbody></table></div> : null}
        {storesCursor ? <button type="button" className="button button-secondary" disabled={loadingMore} onClick={() => void loadStores(storesCursor, true)}>{loadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد من المتاجر"}</button> : null}
      </section>
    </section>
  );
}
