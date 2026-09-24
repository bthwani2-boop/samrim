"use client";

import { type JoiningCaseView, joiningCaseStateLabel, type PartnerManagedStore } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { partnerErrorMessage } from "./partner-error-message";

type PartnerRecord = ActorRoleView & Readonly<{ joiningCase: JoiningCaseView | null }>;
type PartnerPage = Readonly<{ items: ReadonlyArray<PartnerRecord>; nextCursor?: string }>;
type PartnerStorePage = Readonly<{ stores: ReadonlyArray<PartnerManagedStore>; nextCursor?: string }>;

export function PartnerDirectory() {
  const [query, setQuery] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [items, setItems] = useState<ReadonlyArray<PartnerRecord>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [storesByPartner, setStoresByPartner] = useState<Record<string, PartnerStorePage>>({});
  const [expandedPartners, setExpandedPartners] = useState<Record<string, boolean>>({});
  const [loadingStores, setLoadingStores] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (cursor = "", append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "25", q: query.trim() });
      if (cursor) params.set("cursor", cursor);
      if (enabledFilter) params.set("enabled", enabledFilter);
      const response = await identityFetch(`/api/partners/roster?${params}`);
      if (!response.ok) { setError(await partnerErrorMessage(response)); return; }
      const page = await response.json() as PartnerPage;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر قراءة قائمة الشركاء.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [enabledFilter, query]);

  useEffect(() => { void load(); }, [load]);

  async function changeStatus(partner: PartnerRecord) {
    const reason = reasons[partner.actorId]?.trim() ?? "";
    if (Array.from(reason).length < 5 || Array.from(reason).length > 500) { setError("اكتب سببًا من 5 إلى 500 حرف قبل تغيير حالة الشريك."); return; }
    if (partner.joiningCase?.state !== "approved" || !partner.activatedAt) { setError("يتطلب تفعيل حساب الشريك حالة انضمام معتمدة وتسجيل هوية مكتملًا."); return; }
    const action = partner.enabled ? "disable" : "activate";
    setBusy(partner.actorId);
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/partners/roster", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, actorId: partner.actorId, expectedVersion: partner.roleVersion, reason }) });
      if (!response.ok) {
        const message = await partnerErrorMessage(response);
        if (response.status === 409 || response.status === 412) {
          await load();
          setError(`تغيرت نسخة حالة الشريك قبل الحفظ. أُعيد تحميل الحالة الكانونية: ${message}`);
        } else setError(message);
        return;
      }
      const readbackParams = new URLSearchParams({ limit: "10", q: partner.phoneE164 });
      const readbackResponse = await identityFetch(`/api/partners/roster?${readbackParams}`);
      if (!readbackResponse.ok) { setError("تم التغيير لكن تعذرت إعادة قراءة الشريك من Identity وDSH. أعد القراءة قبل إجراء آخر."); return; }
      const readback = await readbackResponse.json() as PartnerPage;
      const canonical = readback.items.find((item) => item.actorId === partner.actorId);
      if (!canonical) { setError("تم التغيير لكن لم يظهر الشريك في إعادة القراءة الكانونية. أعد القراءة قبل إجراء آخر."); return; }
      setReasons((current) => ({ ...current, [partner.actorId]: "" }));
      setNotice(`أعيدت قراءة الحالة: الهوية ${canonical.enabled ? "نشطة" : "موقوفة"} · الانضمام ${canonical.joiningCase ? joiningCaseStateLabel(canonical.joiningCase.state) : "غير مرتبط بحالة انضمام"}.`);
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر تحديث حالة الشريك.");
    } finally { setBusy(""); }
  }

  async function loadPartnerStores(actorId: string, cursor = "", append = false) {
    setLoadingStores(actorId);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "25" });
      if (cursor) params.set("cursor", cursor);
      const response = await identityFetch(`/api/partners/roster/${encodeURIComponent(actorId)}/stores?${params}`);
      if (!response.ok) { setError(await partnerErrorMessage(response)); return; }
      const page = await response.json() as PartnerStorePage;
      setStoresByPartner((current) => {
        const existing = current[actorId]?.stores ?? [];
        return { ...current, [actorId]: { stores: append ? [...existing, ...page.stores] : page.stores, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) } };
      });
      setExpandedPartners((current) => ({ ...current, [actorId]: true }));
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذرت قراءة متاجر الشريك من DSH.");
    } finally {
      setLoadingStores("");
    }
  }

  return <section className="access-card" aria-labelledby="partner-directory-title">
    <div className="access-card-heading"><span className="step-chip">الشركاء المقبولون</span><h2 id="partner-directory-title">قائمة الشركاء وحالة تشغيلهم</h2><p className="muted">تأتي هوية الحساب والانضمام والمتاجر من Identity وDSH كلٌّ حسب مالكه. صلاحية التشغيل منفصلة عن إثبات الهوية.</p></div>
    <div className="workspace-toolbar"><label className="field-label" htmlFor="partner-roster-search">بحث برقم الهاتف<input id="partner-roster-search" inputMode="tel" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في أرقام الشركاء" /></label><label className="field-label" htmlFor="partner-roster-status">حالة الدور<select id="partner-roster-status" value={enabledFilter} onChange={(event) => setEnabledFilter(event.target.value)}><option value="">كل الحالات</option><option value="true">مفعّل</option><option value="false">موقوف</option></select></label><button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={() => void load()}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button></div>
    {notice ? <p className="success-inline" role="status">{notice}</p> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}
    {loading && items.length === 0 ? <p role="status">جارٍ قراءة قائمة الشركاء…</p> : null}{!loading && !error && items.length === 0 ? <div className="collection-state"><strong>لا توجد نتائج</strong><p>جرّب إزالة المرشح أو البحث برقم آخر.</p></div> : null}
    {items.length > 0 ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th scope="col">هاتف الشريك</th><th scope="col">الحساب</th><th scope="col">الانضمام</th><th scope="col">المتاجر</th><th scope="col">إدارة التشغيل</th></tr></thead><tbody>
      {items.map((partner, index) => {
        const storesPage = storesByPartner[partner.actorId];
        return <tr key={partner.actorId}>
          <th scope="row"><bdi dir="ltr">{partner.phoneE164}</bdi></th>
          <td>{!partner.securityEnabled ? "الهوية موقوفة" : !partner.enabled ? "الدور موقوف" : !partner.activatedAt ? "بانتظار التفعيل" : "نشط"}</td>
          <td>{partner.joiningCase ? joiningCaseStateLabel(partner.joiningCase.state) : "لا توجد حالة DSH"}</td>
          <td><div className="access-form">
            <button type="button" className="button button-secondary" aria-expanded={expandedPartners[partner.actorId] === true} aria-controls={`partner-stores-${index}`} disabled={loadingStores === partner.actorId} onClick={() => {
              if (expandedPartners[partner.actorId]) setExpandedPartners((current) => ({ ...current, [partner.actorId]: false }));
              else if (storesPage) setExpandedPartners((current) => ({ ...current, [partner.actorId]: true }));
              else void loadPartnerStores(partner.actorId);
            }}>{loadingStores === partner.actorId ? "جارٍ القراءة…" : expandedPartners[partner.actorId] ? "إخفاء المتاجر" : storesPage ? "عرض المتاجر" : "قراءة المتاجر"}</button>
            {expandedPartners[partner.actorId] ? <section id={`partner-stores-${index}`} aria-label={`متاجر الشريك ${index + 1}`}>
              {storesPage ? storesPage.stores.length ? <ul>{storesPage.stores.map((store) => <li key={store.id}><strong>{store.name}</strong> · {store.publicationState === "published" ? "منشور" : "غير منشور"} · {store.serviceCityId || "مدينة غير محددة"}</li>)}</ul> : <p className="muted">لا توجد متاجر مسجلة في DSH.</p> : null}
              {storesPage?.nextCursor ? <button type="button" className="button button-secondary" disabled={loadingStores === partner.actorId} onClick={() => void loadPartnerStores(partner.actorId, storesPage.nextCursor, true)}>تحميل المزيد من المتاجر</button> : null}
            </section> : null}
          </div></td>
          <td>{partner.joiningCase?.state === "approved" && partner.activatedAt ? <div className="access-form"><label className="field-label" htmlFor={`partner-roster-reason-${index}`}>سبب التغيير<input id={`partner-roster-reason-${index}`} maxLength={500} value={reasons[partner.actorId] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [partner.actorId]: event.target.value }))} disabled={Boolean(busy)} /></label><div className="button-row"><button type="button" className={partner.enabled ? "button button-secondary" : "button button-primary"} disabled={Boolean(busy) || (reasons[partner.actorId] ?? "").trim().length < 5} onClick={() => void changeStatus(partner)}>{busy === partner.actorId ? "جارٍ التحديث…" : partner.enabled ? "إيقاف التشغيل" : "إعادة التفعيل"}</button><Link className="button button-secondary" href={`/partners/${encodeURIComponent(partner.joiningCase.id)}`}>تفاصيل الانضمام</Link></div></div> : <span className="muted">يتطلب التحكم اعتماد الانضمام وتسجيل الهوية.</span>}</td>
        </tr>;
      })}
    </tbody></table></div> : null}
    {nextCursor ? <div className="workspace-toolbar"><button type="button" className="button button-secondary" disabled={loadingMore || Boolean(busy)} onClick={() => void load(nextCursor, true)}>{loadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد"}</button></div> : null}
  </section>;
}
