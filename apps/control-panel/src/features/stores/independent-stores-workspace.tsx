"use client";

import type { OperatorStoreListResponse } from "@bthwani/dsh";
import { useEffect, useState } from "react";

type PublicationFilter = "" | "unpublished" | "hidden";

function publicationLabel(state: string) {
  switch (state) {
    case "unpublished": return "قيد التجهيز — غير منشور";
    case "hidden": return "محجوب عن النشر";
    default: return "حالة نشر غير متوقعة — تتطلب مراجعة";
  }
}

export function IndependentStoresWorkspace() {
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<PublicationFilter>("");
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState<OperatorStoreListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      setLoading(true);
      setError("");
      setPage(null);
      try {
        const params = new URLSearchParams({ limit: "25", refresh: String(refresh) });
        if (query) params.set("q", query);
        if (state) params.set("state", state);
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`/api/independent-stores?${params}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("READ_FAILED");
        const next = await response.json() as OperatorStoreListResponse;
        if (!Array.isArray(next.stores) || next.stores.some((store) => store.relationModel !== "INDEPENDENT_STORE")) {
          throw new Error("STORE_RELATION_MISMATCH");
        }
        if (!controller.signal.aborted) setPage(next);
      } catch {
        if (!controller.signal.aborted) setError("تعذر تحميل سجل المتاجر المستقلة. تحقق من اتصال DSH وأعد المحاولة.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void read();
    return () => controller.abort();
  }, [query, state, cursor, refresh]);

  return <section className="workspace-page" aria-labelledby="independent-stores-title" data-testid="independent-stores-workspace">
    <header className="workspace-page-heading">
      <div>
        <h1 id="independent-stores-title">المتاجر المستقلة</h1>
        <p className="muted">سجل مستقل لإدارة إشراف المنصة على متاجر الويب الخاصة، دون ضمها إلى شبكة طلبات شركاء بثواني.</p>
      </div>
      <button type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>تحديث القائمة</button>
    </header>
    <p className="muted">
      يدير مالك المتجر هويته وكتالوجه ومحتواه. البنرات الخاصة وسجل عملاء الطلبات المباشرة يخضعان لمسار نشر وخصوصية منفصل لم يُفعّل بعد؛
      لا يسمح هذا السجل بتفعيل الطلب أو الدفع أو عرض بيانات العملاء في سوق بثواني.
    </p>
    <search><form className="registry-toolbar" onSubmit={(event) => {
      event.preventDefault();
      setHistory([]);
      setCursor("");
      setQuery(draftQuery.trim());
      setRefresh((value) => value + 1);
    }}>
      <label>
        <span>بحث في المتاجر المستقلة</span>
        <input aria-label="البحث عن متجر مستقل" value={draftQuery} maxLength={128} onChange={(event) => setDraftQuery(event.target.value)} placeholder="اسم المتجر أو المعرّف" />
      </label>
      <label>
        <span>حالة سجل المتجر</span>
        <select aria-label="تصفية المتاجر المستقلة" value={state} onChange={(event) => {
          setState(event.target.value as PublicationFilter);
          setHistory([]);
          setCursor("");
        }}>
          <option value="">جميع الحالات</option>
          <option value="unpublished">غير منشور</option>
          <option value="hidden">محجوب</option>
        </select>
      </label>
      <button type="submit" disabled={loading}>بحث</button>
    </form></search>
    {error ? <div className="state-card" role="alert"><p>{error}</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>إعادة المحاولة</button></div> : null}
    {loading ? <p className="muted" role="status">جارٍ قراءة السجل من DSH…</p> : null}
    {!loading && page && page.stores.length === 0 ? <p className="muted" role="status">لا توجد متاجر مستقلة مطابقة لهذه الصفحة أو معايير البحث.</p> : null}
    {!loading && page && page.stores.length > 0 ? <div className="store-registry-table-wrap">
      <table className="operations-table partner-registry-table">
        <caption>متاجر مستقلة من DSH، بترقيم صفحات خادمي. العدد المعروض يخص الصفحة الحالية فقط.</caption>
        <thead><tr><th scope="col">المتجر</th><th scope="col">المالك</th><th scope="col">المدينة / النشاط</th><th scope="col">حالة النشر</th><th scope="col">التفاصيل</th></tr></thead>
        <tbody>{page.stores.map((store) => <tr key={store.id}>
          <th scope="row">{store.name}</th>
          <td>{store.partnerName || "مالك مسجل"} <small><bdi dir="ltr">{store.partnerActorId}</bdi></small></td>
          <td>{store.serviceCityName || "غير محددة"} — {store.primaryVerticalName || "نشاط غير محدد"}</td>
          <td>{publicationLabel(store.publicationState)}</td>
          <td><details><summary>بيانات المتجر</summary>
            <dl>
              <dt>معرّف Store</dt><dd><bdi dir="ltr">{store.id}</bdi></dd>
              <dt>نوع النشاط</dt><dd>{store.commercialStoreTypeNameAr || "غير محدد"}</dd>
              <dt>آخر تحديث</dt><dd>{new Date(store.updatedAt).toLocaleDateString("ar-YE")}</dd>
              <dt>العلاقة التجارية</dt><dd>متجر مستقل، بلا عمولة أو طلبات سوق مفعّلة</dd>
            </dl>
          </details></td>
        </tr>)}</tbody>
      </table>
    </div> : null}
    {!loading && page ? <nav aria-label="صفحات المتاجر المستقلة" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" disabled={history.length === 0} onClick={() => {
        setCursor(history[history.length - 1] ?? "");
        setHistory((old) => old.slice(0, -1));
      }}>السابق</button>
      <span className="muted">صفحة {history.length + 1}</span>
      <button type="button" disabled={!page.nextCursor} onClick={() => {
        setHistory((old) => [...old, cursor]);
        setCursor(page.nextCursor ?? "");
      }}>التالي</button>
    </nav> : null}
  </section>;
}
