"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Store = Readonly<{ id: string; name: string; partnerActorId: string; version: number; deletedAt?: string; deletedBy?: string; deletionReason?: string }>;
type StorePage = Readonly<{ stores: ReadonlyArray<Store>; nextCursor: string }>;

export function StoreTrash() {
  const [stores, setStores] = useState<ReadonlyArray<Store>>([]);
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<ReadonlyArray<string>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/stores/trash${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal });
      if (response.status === 403) { setForbidden(true); setStores([]); return; }
      const body: StorePage & { error?: { message?: string } } = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "تعذر تحميل المتاجر المحذوفة.");
      if (!signal.aborted) { setStores(body.stores); setNextCursor(body.nextCursor); setForbidden(false); }
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "تعذر تحميل المتاجر المحذوفة.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [cursor]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function restore(item: Store) {
    if (busy || loading) return;
    setBusy(item.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/stores/trash/${encodeURIComponent(item.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(item.version) },
        body: JSON.stringify({ action: "restore", reason: "" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "تعذرت استعادة المتجر.");
      setConfirmId("");
      setNotice(`تمت استعادة «${item.name}» بحالة مخفي. راجع جاهزيته ثم انشره يدويًا.`);
      setStores((current) => current.filter((store) => store.id !== item.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذرت استعادة المتجر."); }
    finally { setBusy(""); }
  }

  if (forbidden) return null;
  return <section className="access-card" aria-label="المتاجر المحذوفة">
    <div className="access-card-heading">
      <div><h2>المتاجر المحذوفة</h2><p className="muted">الاستعادة تعيد المتجر دون نشره تلقائيًا، وتحافظ على الطلبات والاتفاقيات والسجلات المالية.</p></div>
      <Link className="button button-secondary" href="/partners">الشركاء والمتاجر</Link>
    </div>
    {notice ? <p className="success-inline" role="status">{notice}</p> : null}
    {error ? <p className="identity-error" role="alert">{error}</p> : null}
    {loading ? <p className="muted">جارٍ تحميل المتاجر…</p> : !error && stores.length === 0 ? <p className="muted">لا توجد متاجر محذوفة في هذه الصفحة.</p> : null}
    {!loading && !error && stores.length > 0 ? <div className="partner-stores-table-wrap">
      <table className="operations-table"><thead><tr><th scope="col">المتجر</th><th scope="col">الحذف</th><th scope="col">السبب</th><th scope="col">الإجراء</th></tr></thead>
        <tbody>{stores.map((item) => <tr key={item.id}>
          <th scope="row">{item.name}<div className="muted"><bdi dir="ltr">{item.id}</bdi></div></th>
          <td>{item.deletedAt ? new Date(item.deletedAt).toLocaleString("ar-YE") : "—"}</td>
          <td>{item.deletionReason ?? "—"}</td>
          <td>{confirmId === item.id ? <div className="catalog-category-filters">
            <span>استعادة المتجر مخفيًا حتى تجتاز جاهزيته فحوص النشر؟</span>
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
