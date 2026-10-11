"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Category = Readonly<{ id: string; verticalId: string; nameAr: string; version: number; deletedAt?: string; deletedBy?: string; deletionReason?: string }>;
type Page = Readonly<{ categories: ReadonlyArray<Category>; nextCursor: string }>;

export function CatalogCategoryTrash() {
  const [categories, setCategories] = useState<ReadonlyArray<Category>>([]);
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<ReadonlyArray<string>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/catalog/category-trash${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal });
      const body: Page & { error?: { message?: string } } = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "تعذر تحميل الفئات المحذوفة.");
      if (!signal.aborted) { setCategories(body.categories); setNextCursor(body.nextCursor); }
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "تعذر تحميل الفئات المحذوفة.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [cursor]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function restore(item: Category) {
    if (busy || loading) return;
    setBusy(item.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/catalog/category-trash/${encodeURIComponent(item.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(item.version) },
        body: JSON.stringify({ action: "restore", reason: "" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "تعذرت استعادة الفئة.");
      setConfirmId("");
      setNotice(`تمت استعادة «${item.nameAr}» بحالة غير نشطة. يمكن تفعيلها بعد مراجعتها من صفحة الفئات.`);
      setCategories((current) => current.filter((category) => category.id !== item.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذرت استعادة الفئة."); }
    finally { setBusy(""); }
  }

  return <section className="access-card" aria-label="الفئات المحذوفة">
    <div className="access-card-heading">
      <div><h2>الفئات المحذوفة</h2><p className="muted">استعادة آمنة دون إعادة النشر تلقائيًا. يجب نقل الفئات الفرعية قبل حذف الفئة الأم.</p></div>
      <Link className="button button-secondary" href="/catalog/categories">إدارة الفئات</Link>
    </div>
    {notice ? <p className="success-inline" role="status">{notice}</p> : null}
    {error ? <p className="identity-error" role="alert">{error}</p> : null}
    {loading ? <p className="muted">جارٍ تحميل الفئات…</p> : !error && categories.length === 0 ? <p className="muted">لا توجد فئات محذوفة في هذه الصفحة.</p> : null}
    {!loading && !error && categories.length > 0 ? <div className="partner-stores-table-wrap">
      <table className="operations-table"><thead><tr><th scope="col">الفئة</th><th scope="col">الحذف</th><th scope="col">السبب</th><th scope="col">الإجراء</th></tr></thead>
        <tbody>{categories.map((item) => <tr key={item.id}>
          <th scope="row">{item.nameAr}<div className="muted"><bdi dir="ltr">{item.id}</bdi></div></th>
          <td>{item.deletedAt ? new Date(item.deletedAt).toLocaleString("ar-YE") : "—"}</td>
          <td>{item.deletionReason ?? "—"}</td>
          <td>{confirmId === item.id ? <div className="catalog-category-filters">
            <span>هل تريد استعادة الفئة غير نشطة؟</span>
            <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => void restore(item)}>{busy === item.id ? "جارٍ الاستعادة…" : "تأكيد"}</button>
            <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => setConfirmId("")}>إلغاء</button>
          </div> : <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => setConfirmId(item.id)}>استعادة</button>}</td>
        </tr>)}</tbody>
      </table>
    </div> : null}
    <div className="catalog-category-filters">
      <button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={() => void load(new AbortController().signal)}>تحديث</button>
      <button type="button" className="button button-secondary" disabled={loading || !history.length} onClick={() => { setCursor(history[history.length - 1] ?? ""); setHistory((items) => items.slice(0, -1)); }}>السابق</button>
      <button type="button" className="button button-secondary" disabled={loading || !nextCursor} onClick={() => { setHistory((items) => [...items, cursor]); setCursor(nextCursor); }}>التالي</button>
    </div>
  </section>;
}
