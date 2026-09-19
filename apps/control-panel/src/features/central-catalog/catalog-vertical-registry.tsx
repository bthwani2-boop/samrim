"use client";

import type { CommerceVertical } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";

function readError(value: unknown): string {
  if (!value || typeof value !== "object") return "تعذر تنفيذ العملية.";
  const nested = (value as { error?: unknown }).error;
  if (!nested || typeof nested !== "object") return "تعذر تنفيذ العملية.";
  const message = (nested as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : "تعذر تنفيذ العملية.";
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(readError(payload));
  return payload as T;
}

export function CatalogVerticalRegistry() {
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/verticals", { cache: "no-store" });
      setVerticals((await parseResponse<{ verticals: ReadonlyArray<CommerceVertical> }>(response)).verticals);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر قراءة المجالات التجارية.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    const normalizedNameAr = nameAr.trim();
    const normalizedNameEn = nameEn.trim();
    if (normalizedNameAr.length < 2 || normalizedNameAr.length > 160 || normalizedNameEn.length < 2 || normalizedNameEn.length > 160) {
      setError("يجب أن يتراوح الاسم العربي والإنجليزي بين حرفين و160 حرفًا.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/catalog/verticals", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ nameAr: normalizedNameAr, nameEn: normalizedNameEn, active }) });
      const payload = await parseResponse<{ vertical: CommerceVertical }>(response);
      setNotice(`تم حفظ المجال التجاري: ${payload.vertical.nameAr}.`);
      setNameAr("");
      setNameEn("");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر إنشاء المجال التجاري.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="access-card" aria-labelledby="catalog-vertical-registry-title">
      <div className="access-card-heading">
        <span className="step-chip">قاموس التجارة</span>
        <p className="eyebrow">المجالات التجارية</p>
        <h2 id="catalog-vertical-registry-title">إضافة مجال تجاري</h2>
        <p className="muted">المجال التجاري هو الفئة العليا التي يُربط بها المتجر والمنتج. الاسم العربي للواجهة، والاسم الإنجليزي للبيانات الوصفية والتكاملات؛ أما المعرف الداخلي فيولّده DSH تلقائيًا ويثبته ولا يظهر للعميل كاسم.</p>
      </div>
      <div className="access-form">
        <label className="field-label" htmlFor="catalog-vertical-name-ar">الاسم العربي<input id="catalog-vertical-name-ar" disabled={busy} value={nameAr} onChange={(event) => setNameAr(event.target.value)} placeholder="مطاعم" /></label>
        <label className="field-label" htmlFor="catalog-vertical-name-en">الاسم الإنجليزي<input id="catalog-vertical-name-en" disabled={busy} value={nameEn} onChange={(event) => setNameEn(event.target.value)} placeholder="Restaurants" /></label>
        <label className="field-label" htmlFor="catalog-vertical-active"><input id="catalog-vertical-active" type="checkbox" disabled={busy} checked={active} onChange={(event) => setActive(event.target.checked)} /> نشط عند الإنشاء</label>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void create()}>{busy ? "جارٍ الحفظ…" : "إضافة مجال تجاري"}</button>
      </div>
      {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}
      {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => void load()}>إعادة المحاولة</button></p> : null}
      <div className="managed-status managed-status-info">
        <strong>المجالات النشطة في السجل الكانوني</strong>
        {loading ? <p>جارٍ قراءة السجل…</p> : verticals.length === 0 ? <p>لا توجد مجالات تجارية بعد. أضف المجال قبل إنشاء طلب شريك أو منتج.</p> : <ul>{verticals.map((vertical) => <li key={vertical.id}><span>{vertical.nameAr} · {vertical.nameEn}</span></li>)}</ul>}
      </div>
    </section>
  );
}
