"use client";

import { type JoiningCaseView, fulfillmentModeLabel, joiningCaseStateLabel, type PartnerManagedStore, publicationStateLabel } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { partnerErrorMessage } from "./partner-error-message";
import { ActorLegalNameWorkspace } from "./actor-legal-name-workspace";
import "./partner-detail-workspace.module.css";
import "./partner-directory.module.css";

type PartnerDetail = Readonly<{ partner: ActorRoleView; joiningCase: JoiningCaseView | null }>;
type PartnerStoresPage = Readonly<{ stores: ReadonlyArray<PartnerManagedStore>; nextCursor?: string }>;
type PartnerDetailTab = "profile" | "stores";

export function PartnerDetailWorkspace({ actorId }: Readonly<{ actorId: string }>) {
  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [stores, setStores] = useState<ReadonlyArray<PartnerManagedStore>>([]);
  const [storesCursor, setStoresCursor] = useState("");
  const [storesPageStack, setStoresPageStack] = useState<ReadonlyArray<string>>([]);
  const [activeTab, setActiveTab] = useState<PartnerDetailTab>("profile");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingStores, setLoadingStores] = useState(false);
  const [error, setError] = useState("");
  const [storesError, setStoresError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await identityFetch(`/api/partners/roster/${encodeURIComponent(actorId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      setDetail(await response.json() as PartnerDetail);
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : cause instanceof Error ? cause.message : "تعذرت قراءة ملف الشريك.");
    } finally { setLoading(false); }
  }, [actorId]);

  const loadStores = useCallback(async (cursor = "", pageStack: ReadonlyArray<string> = []) => {
    setLoadingStores(true);
    setStoresError("");
    try {
      const params = new URLSearchParams({ limit: "10" });
      if (cursor) params.set("cursor", cursor);
      const response = await identityFetch(`/api/partners/roster/${encodeURIComponent(actorId)}/stores?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      const page = await response.json() as PartnerStoresPage;
      setStores(page.stores);
      setStoresCursor(page.nextCursor ?? "");
      setStoresPageStack(pageStack);
    } catch (cause) {
      setStoresError(isRequestFailure(cause) ? cause.message : cause instanceof Error ? cause.message : "تعذرت قراءة متاجر الشريك من DSH.");
      setStores([]);
      setStoresCursor("");
    } finally { setLoadingStores(false); }
  }, [actorId]);

  useEffect(() => {
    void loadDetail();
    const syncTab = () => setActiveTab(new URLSearchParams(window.location.search).get("view") === "stores" ? "stores" : "profile");
    syncTab();
    window.addEventListener("popstate", syncTab);
    return () => window.removeEventListener("popstate", syncTab);
  }, [loadDetail]);

  useEffect(() => {
    if (activeTab === "stores") {
      const cursor = new URLSearchParams(window.location.search).get("cursor") ?? "";
      void loadStores(cursor);
    }
  }, [activeTab, loadStores]);

  function navigateTab(tab: PartnerDetailTab) {
    const params = new URLSearchParams(window.location.search);
    if (tab === "stores") params.set("view", tab); else params.delete("view");
    params.delete("cursor");
    window.history.pushState({}, "", window.location.pathname + (params.size ? `?${params.toString()}` : ""));
    setActiveTab(tab);
    setStoresPageStack([]);
  }

  function navigateStorePage(cursor: string, stack: ReadonlyArray<string>) {
    const params = new URLSearchParams(window.location.search);
    params.set("view", "stores");
    if (cursor) params.set("cursor", cursor); else params.delete("cursor");
    window.history.pushState({}, "", `${window.location.pathname}?${params.toString()}`);
    void loadStores(cursor, stack);
  }

  async function changeStatus() {
    if (!detail) return;
    const normalizedReason = reason.trim();
    if (Array.from(normalizedReason).length < 5 || Array.from(normalizedReason).length > 500) {
      setError("اكتب سببًا من 5 إلى 500 حرف قبل تغيير حالة الشريك.");
      return;
    }
    if (detail.joiningCase?.state !== "approved" || !detail.partner.activatedAt || !detail.partner.securityEnabled) {
      setError("يتطلب تغيير دور الشريك اعتماد الانضمام، وتسجيل الهوية، وبقاء الهوية الأمنية نشطة.");
      return;
    }
    const desiredEnabled = !detail.partner.enabled;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/partners/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: desiredEnabled ? "activate" : "disable", actorId, expectedVersion: detail.partner.roleVersion, reason: normalizedReason }),
      });
      if (!response.ok) {
        const message = await partnerErrorMessage(response);
        if (response.status === 409 || response.status === 412) {
          await loadDetail();
          setError(`تغيّرت الحالة قبل الحفظ. أُعيدت قراءة الحقيقة الكانونية: ${message}`);
        } else setError(message);
        return;
      }
      const readbackResponse = await identityFetch(`/api/partners/roster/${encodeURIComponent(actorId)}`, { cache: "no-store" });
      if (!readbackResponse.ok) {
        setError("تم إرسال التغيير لكن تعذرت إعادة قراءة Identity وDSH. أعد القراءة قبل أي إجراء آخر.");
        return;
      }
      const canonical = await readbackResponse.json() as PartnerDetail;
      setDetail(canonical);
      const observedEnabled = canonical.partner.enabled;
      if (observedEnabled !== desiredEnabled) {
        setError("لم تطابق الحالة المقروءة النتيجة المطلوبة. اعتمد الحالة المعروضة قبل إجراء آخر.");
        return;
      }
      setReason("");
      setNotice(`أُعيدت قراءة الحالة الكانونية: الدور ${observedEnabled ? "مفعّل" : "موقوف"} · الانضمام ${canonical.joiningCase ? joiningCaseStateLabel(canonical.joiningCase.state) : "غير مرتبط"}.`);
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : cause instanceof Error ? cause.message : "تعذر تحديث حالة الشريك.");
    } finally { setBusy(false); }
  }

  const partner = detail?.partner;
  const canChangeStatus = detail?.joiningCase?.state === "approved" && Boolean(partner?.activatedAt) && Boolean(partner?.securityEnabled);

  return <section className="workspace-page partner-detail-workspace" aria-labelledby="partner-detail-title">
    <div className="workspace-page-heading partner-detail-page-heading">
      <div><p className="eyebrow">الشركاء · ملف تشغيلي</p><h1 id="partner-detail-title">{partner?.phoneE164 ? <bdi dir="ltr">{partner.phoneE164}</bdi> : "تفاصيل الشريك"}</h1></div>
      <Link className="button button-secondary" href="/partners">العودة للسجل</Link>
    </div>

    <nav className="partner-detail-tabs" aria-label="أقسام ملف الشريك">
      <button type="button" aria-current={activeTab === "profile" ? "page" : undefined} onClick={() => navigateTab("profile")}>الحساب والانضمام</button>
      <button type="button" aria-current={activeTab === "stores" ? "page" : undefined} onClick={() => navigateTab("stores")}>المتاجر</button>
    </nav>

    {notice ? <p className="success-inline" role="status">{notice}</p> : null}
    {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر إكمال الإجراء</strong><p>{error}</p><button type="button" className="button button-secondary" onClick={() => void loadDetail()} disabled={loading || busy}>إعادة قراءة الحساب</button></div> : null}
    {loading ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة ملف الشريك</strong></div> : null}
    {!loading && !detail && !error ? <div className="collection-state"><strong>ملف الشريك غير متاح</strong></div> : null}

    {detail && activeTab === "profile" ? <div className="partner-profile-grid">
      <section className="partner-detail-section" aria-labelledby="partner-identity-title">
        <div className="partner-detail-section-heading"><div><p className="eyebrow">Identity · DSH</p><h2 id="partner-identity-title">الحساب والانضمام</h2></div><button type="button" className="button button-secondary" onClick={() => void loadDetail()} disabled={loading || busy}>إعادة القراءة</button></div>
        <dl className="partner-detail-facts">
          <div><dt>الهاتف</dt><dd><bdi dir="ltr">{detail.partner.phoneE164}</bdi></dd></div>
          <div><dt>حالة الهوية</dt><dd>{detail.partner.securityEnabled ? "نشطة" : "موقوفة"}</dd></div>
          <div><dt>حالة الدور</dt><dd>{detail.partner.enabled ? detail.partner.activatedAt ? "مفعّل" : "بانتظار التفعيل" : "موقوف"}</dd></div>
          <div><dt>طلب الانضمام</dt><dd>{detail.joiningCase ? <><Link href={`/partners/${encodeURIComponent(detail.joiningCase.id)}`}>{joiningCaseStateLabel(detail.joiningCase.state)}</Link> · {detail.joiningCase.businessName}</> : "لا توجد حالة DSH مرتبطة"}</dd></div>
        </dl>
      </section>
      <section className="partner-detail-section partner-status-action" aria-labelledby="partner-status-action-title">
        <div><p className="eyebrow">إجراء موثق</p><h2 id="partner-status-action-title">{detail.partner.enabled ? "إيقاف دور الشريك" : "تفعيل دور الشريك"}</h2><p className="muted">يتطلب السبب ويُحفظ عبر Identity مع نسخة الدور الحالية.</p></div>
        <label className="field-label" htmlFor="partner-status-reason">سبب التغيير<input id="partner-status-reason" value={reason} minLength={5} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="اكتب سببًا واضحًا للتغيير" disabled={!canChangeStatus || busy} /></label>
        <button type="button" className={detail.partner.enabled ? "button button-secondary" : "button button-primary"} disabled={!canChangeStatus || busy || reason.trim().length < 5} onClick={() => void changeStatus()}>{busy ? "جارٍ التحديث والتحقق…" : detail.partner.enabled ? "إيقاف الدور" : "تفعيل الدور"}</button>
        {!canChangeStatus ? <p className="muted">يتاح التحكم بعد اعتماد الانضمام وتسجيل الهوية وبقاء الهوية الأمنية نشطة.</p> : null}
      </section>
      <ActorLegalNameWorkspace actorId={actorId} />
    </div> : null}

    {detail && activeTab === "stores" ? <section className="partner-detail-section" aria-labelledby="partner-stores-title">
      <div className="partner-detail-section-heading"><div><p className="eyebrow">العلاقة الكانونية · DSH</p><h2 id="partner-stores-title">متاجر الشريك</h2></div><button type="button" className="button button-secondary" disabled={loadingStores} onClick={() => void loadStores(storesPageStack.length ? new URLSearchParams(window.location.search).get("cursor") ?? "" : "", storesPageStack)}>{loadingStores ? "جارٍ القراءة…" : "إعادة القراءة"}</button></div>
      {storesError ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذرت قراءة المتاجر</strong><p>{storesError}</p><button type="button" className="button button-secondary" onClick={() => void loadStores(new URLSearchParams(window.location.search).get("cursor") ?? "", storesPageStack)} disabled={loadingStores}>إعادة المحاولة</button></div> : null}
      {loadingStores && stores.length === 0 ? <div className="collection-state" role="status"><strong>جارٍ قراءة المتاجر من DSH</strong></div> : null}
      {!loadingStores && !storesError && stores.length === 0 ? <div className="collection-state"><strong>لا توجد متاجر مرتبطة بهذا الشريك</strong><p>هذه نتيجة القراءة الحالية من DSH.</p></div> : null}
      {stores.length > 0 ? <>
        <div className="partner-stores-table-wrap"><table className="operations-table partner-detail-stores-table"><caption className="visually-hidden">صفحة متاجر الشريك</caption><thead><tr><th scope="col">المتجر</th><th scope="col">المدينة</th><th scope="col">الفئة</th><th scope="col">النشر</th><th scope="col">التنفيذ</th></tr></thead><tbody>{stores.map((store) => <tr key={store.id}><th scope="row"><Link href={`/partners/stores/${encodeURIComponent(store.id)}`}>{store.name}</Link></th><td><bdi dir="ltr">{store.serviceCityId || "غير محددة"}</bdi></td><td><bdi dir="ltr">{store.primaryVerticalId || "غير محددة"}</bdi></td><td>{publicationStateLabel(store.publicationState)}</td><td>{store.fulfillmentModes.map(fulfillmentModeLabel).join("، ") || "غير محددة"}</td></tr>)}</tbody></table></div>
        <nav className="partner-registry-pagination" aria-label="صفحات متاجر الشريك"><button type="button" className="button button-secondary" disabled={loadingStores || storesPageStack.length === 0} onClick={() => navigateStorePage(storesPageStack.at(-1) ?? "", storesPageStack.slice(0, -1))}>السابق</button><span>{storesPageStack.length + 1}</span><button type="button" className="button button-secondary" disabled={loadingStores || !storesCursor} onClick={() => navigateStorePage(storesCursor, [...storesPageStack, new URLSearchParams(window.location.search).get("cursor") ?? ""])}>التالي</button></nav>
      </> : null}
    </section> : null}
  </section>;
}
