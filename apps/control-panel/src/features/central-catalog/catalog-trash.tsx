"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useReadOnReturn } from "../shared/use-read-on-return";

type TrashProduct = Readonly<{ id: string; canonicalName: string; version: number; deletedAt?: string; deletedBy?: string; deletionReason?: string }>;
type TrashPage = Readonly<{ products: ReadonlyArray<TrashProduct>; nextCursor: string }>;

export function CatalogTrash() {
  const [products, setProducts] = useState<ReadonlyArray<TrashProduct>>([]);
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<ReadonlyArray<string>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/catalog/trash${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal });
      const payload: TrashPage & { error?: { message?: string } } = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "تعذر تحميل سلة المحذوفات.");
      if (!signal.aborted) {
        setProducts(payload.products);
        setNextCursor(payload.nextCursor);
      }
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "تعذر تحميل سلة المحذوفات.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [cursor]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useReadOnReturn(() => { void load(new AbortController().signal); }, !loading && !busy && !confirmId);

  async function restore(product: TrashProduct) {
    if (busy || loading) return;
    setBusy(product.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/catalog/trash/${encodeURIComponent(product.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(product.version) },
        body: JSON.stringify({ action: "restore", reason: "" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "تعذرت استعادة المنتج.");
      setConfirmId("");
      setNotice(`تمت استعادة «${product.canonicalName}». يمكنك فتحه من قائمة المنتجات.`);
      setCursor("");
      setHistory([]);
      if (!cursor) await load(new AbortController().signal);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذرت استعادة المنتج.");
    } finally {
      setBusy("");
    }
  }

  const visible = products.filter((item) => item.canonicalName.includes(search.trim()) || item.id.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <div className="access-card">
      <div className="access-card-heading">
        <div>
          <h2>المنتجات المحذوفة</h2>
          <p className="muted">حذف آمن قابل للاستعادة؛ تبقى الطلبات والفواتير والروابط التاريخية محفوظة. حذف المتاجر غير متاح في هذه المرحلة.</p>
        </div>
        <Link className="button button-secondary" href="/catalog/products">العودة إلى المنتجات</Link>
      </div>
      <div className="catalog-category-filters">
        <label className="field-label" htmlFor="trash-product-search">بحث في الصفحة الحالية
          <input id="trash-product-search" type="search" value={search} maxLength={160} onChange={(event) => setSearch(event.target.value)} placeholder="اسم المنتج أو معرّفه" />
        </label>

      </div>
      {notice ? <p className="success-inline" role="status">{notice}</p> : null}
      {error ? <div role="alert"><p className="identity-error">{error}</p><button className="button button-secondary" type="button" disabled={loading} onClick={() => void load(new AbortController().signal)}>إعادة المحاولة</button></div> : null}
      {loading ? <p className="muted" role="status">جارٍ تحميل السلة…</p> : !error && products.length === 0 ? <p className="muted">لا توجد منتجات محذوفة في هذه الصفحة.</p> : !error && visible.length === 0 ? <p className="muted">لا توجد نتائج مطابقة في الصفحة الحالية.</p> : null}
      {!loading && !error && visible.length > 0 ? (
        <div className="partner-stores-table-wrap">
          <table className="operations-table">
            <thead><tr><th scope="col">المنتج</th><th scope="col">تاريخ الحذف</th><th scope="col">السبب</th><th scope="col">الإجراء</th></tr></thead>
            <tbody>{visible.map((product) => (
              <tr key={product.id}>
                <th scope="row">{product.canonicalName}
                  {product.deletedBy ? <details><summary>تفاصيل التدقيق</summary><dl><dt>معرّف منفذ الحذف</dt><dd><bdi dir="ltr">{product.deletedBy}</bdi></dd></dl></details> : null}
                </th>
                <td>{product.deletedAt ? new Date(product.deletedAt).toLocaleString("ar-YE") : "—"}</td>
                <td>{product.deletionReason || "—"}</td>
                <td>
                  {confirmId === product.id ? (
                    <div className="catalog-category-filters">
                      <span>استعادة المنتج وعروضه المؤهلة للظهور؟</span>
                      <button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => void restore(product)}>{busy === product.id ? "جارٍ الاستعادة…" : "تأكيد الاستعادة"}</button>
                      <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => setConfirmId("")}>إلغاء</button>
                    </div>
                  ) : (
                    <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => setConfirmId(product.id)}>استعادة</button>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      <div className="catalog-category-filters">
        <button className="button button-secondary" type="button" disabled={!history.length || loading || Boolean(busy)} onClick={() => { setCursor(history[history.length - 1] ?? ""); setHistory((items) => items.slice(0, -1)); setConfirmId(""); }}>السابق</button>
        <button className="button button-secondary" type="button" disabled={!nextCursor || loading || Boolean(busy)} onClick={() => { setHistory((items) => [...items, cursor]); setCursor(nextCursor); setConfirmId(""); }}>التالي</button>
      </div>
    </div>
  );
}
