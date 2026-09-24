"use client";

import type { ActorRoleView, OperatorPermission } from "@bthwani/identity";
import { useCallback, useEffect, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { operatorWorkspacePermissions } from "../../session/operator-permissions";
import { responseMessage } from "./identity-error-message";

type OperatorRow = ActorRoleView & Readonly<{ permissions: ReadonlyArray<Readonly<{ permission: OperatorPermission; enabled: boolean }>> | null }>;
type OperatorPage = Readonly<{ items: ReadonlyArray<OperatorRow>; nextCursor?: string }>;
export function OperatorDirectory({ onSelectPhone }: Readonly<{ onSelectPhone: (phone: string) => void }>) {
  const [query, setQuery] = useState("");
  const [enabled, setEnabled] = useState("");
  const [items, setItems] = useState<ReadonlyArray<OperatorRow>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (cursor = "", append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: query.trim(), limit: "10" });
      if (cursor) params.set("cursor", cursor);
      if (enabled) params.set("enabled", enabled);
      const response = await identityFetch(`/api/access/operators?${params}`);
      if (!response.ok) { setError(await responseMessage(response)); return; }
      const page = await response.json() as OperatorPage;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر قراءة سجل مشغّلي لوحة التحكم.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [enabled, query]);

  useEffect(() => { void load(); }, [load]);

  return <section className="access-card" aria-labelledby="operator-directory-title">
    <div className="access-card-heading"><span className="step-chip">مشغّلو لوحة التحكم فقط</span><h2 id="operator-directory-title">قائمة المشغّلين وصلاحياتهم</h2><p className="muted">الأدوار والصلاحيات الإدارية محصورة هنا بمشغّلي لوحة التحكم، وكل صلاحية نطاق مستقلة عن غيرها.</p></div>
    <div className="workspace-toolbar"><label className="field-label" htmlFor="operator-search">بحث برقم الهاتف<input id="operator-search" inputMode="tel" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في أرقام المشغّلين" /></label><label className="field-label" htmlFor="operator-enabled-filter">حالة الحساب<select id="operator-enabled-filter" value={enabled} onChange={(event) => setEnabled(event.target.value)}><option value="">كل الحالات</option><option value="true">مفعّل</option><option value="false">موقوف</option></select></label><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button></div>
    {error ? <div className="managed-status managed-status-warning" role="alert"><p>{error}</p><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>إعادة المحاولة</button></div> : null}
    {loading && items.length === 0 ? <p role="status">جارٍ قراءة المشغّلين…</p> : null}
    {!loading && !error && items.length === 0 ? <div className="collection-state"><strong>لا توجد نتائج</strong><p>جرّب إزالة المرشح أو البحث برقم آخر.</p></div> : null}
    {items.length > 0 ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th scope="col">المشغّل</th><th scope="col">الحساب</th>{operatorWorkspacePermissions.map(({ key, label }) => <th key={key} scope="col">{label}</th>)}<th scope="col">إجراء</th></tr></thead><tbody>
      {items.map((operator) => <tr key={operator.actorId}><th scope="row"><bdi dir="ltr">{operator.phoneE164}</bdi></th><td>{!operator.securityEnabled ? "الهوية موقوفة" : !operator.enabled ? "الدور موقوف" : !operator.activatedAt ? "بانتظار التفعيل" : "نشط"}</td>{operatorWorkspacePermissions.map(({ key: permission }) => {
        const access = operator.permissions?.find((item) => item.permission === permission);
        return <td key={permission}>{access ? access.enabled ? "ممنوحة" : "غير ممنوحة" : operator.permissions === null ? "غير متاحة لهذه الجلسة" : operator.permissions ? "غير ممنوحة" : "—"}</td>;
      })}<td><button type="button" className="button button-secondary" onClick={() => onSelectPhone(operator.phoneE164)}>إدارة الحساب</button></td></tr>)}
    </tbody></table></div> : null}
    {nextCursor ? <div className="workspace-toolbar"><button type="button" className="button button-secondary" disabled={loadingMore} onClick={() => void load(nextCursor, true)}>{loadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد"}</button></div> : null}
  </section>;
}
