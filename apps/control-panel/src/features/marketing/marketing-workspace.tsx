"use client";

import type { DiscoveryContentView, PromotionView } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";

type ApiError = { error?: { message?: string } };

function apiMessage(value: unknown): string {
  return value && typeof value === "object" && "error" in value && (value as ApiError).error?.message ? String((value as ApiError).error?.message) : "تعذر تنفيذ العملية.";
}

function futureDateInput(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
}

export default function MarketingWorkspace() {
  const [promotions, setPromotions] = useState<ReadonlyArray<PromotionView>>([]);
  const [content, setContent] = useState<ReadonlyArray<DiscoveryContentView>>([]);
  const [startsAt, setStartsAt] = useState(futureDateInput);
  const [contentStartsAt, setContentStartsAt] = useState(futureDateInput);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [promotionForm, setPromotionForm] = useState({ code: "", nameAr: "", descriptionAr: "", kind: "PERCENTAGE" as "PERCENTAGE" | "FIXED", valueMinor: "10" });
  const [contentForm, setContentForm] = useState({ titleAr: "", bodyAr: "", kind: "BANNER" as "BANNER" | "CAROUSEL" | "SHORT_FORM" });

  const load = useCallback(async () => {
    const [promotionResponse, contentResponse] = await Promise.all([fetch("/api/marketing/promotions", { cache: "no-store" }), fetch("/api/marketing/content", { cache: "no-store" })]);
    if (!promotionResponse.ok || !contentResponse.ok) throw new Error("MARKETING_READ_FAILED");
    const promotionBody = await promotionResponse.json() as { promotions?: ReadonlyArray<PromotionView> };
    const contentBody = await contentResponse.json() as { items?: ReadonlyArray<DiscoveryContentView> };
    setPromotions(promotionBody.promotions ?? []);
    setContent(contentBody.items ?? []);
  }, []);

  useEffect(() => { void load().catch(() => setMessage("تعذر قراءة سجل العروض والمحتوى.")); }, [load]);

  async function createPromotion() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/marketing/promotions", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ id: `promotion-${crypto.randomUUID()}`, code: promotionForm.code, nameAr: promotionForm.nameAr, descriptionAr: promotionForm.descriptionAr, kind: promotionForm.kind, valueMinor: Number(promotionForm.valueMinor), fundingSource: "MERCHANT", startsAt: new Date(startsAt).toISOString() }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body));
      setPromotionForm({ code: "", nameAr: "", descriptionAr: "", kind: "PERCENTAGE", valueMinor: "10" });
      await load();
      setMessage("تم إنشاء العرض كمسودة. انشره من السجل عندما يصبح جاهزًا.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر إنشاء العرض."); } finally { setBusy(false); }
  }

  async function createContent() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/marketing/content", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ id: `content-${crypto.randomUUID()}`, kind: contentForm.kind, titleAr: contentForm.titleAr, bodyAr: contentForm.bodyAr, targetType: "INFO", startsAt: new Date(contentStartsAt).toISOString(), ordinal: content.length }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body));
      setContentForm({ titleAr: "", bodyAr: "", kind: "BANNER" });
      await load();
      setMessage("تم إنشاء المحتوى كمسودة. انشره من السجل عندما يصبح جاهزًا.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر إنشاء المحتوى."); } finally { setBusy(false); }
  }

  async function publishPromotion(item: PromotionView, state: "PUBLISHED" | "PAUSED") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/marketing/promotions/${encodeURIComponent(item.id)}/publication`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(item.version) }, body: JSON.stringify({ state }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body));
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر تحديث نشر العرض."); } finally { setBusy(false); }
  }

  async function publishContent(item: DiscoveryContentView, state: "PUBLISHED" | "PAUSED") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/marketing/content/${encodeURIComponent(item.id)}/publication`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(item.version) }, body: JSON.stringify({ state }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body));
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر تحديث نشر المحتوى."); } finally { setBusy(false); }
  }

  return <div className="central-catalog-grid" data-testid="marketing-workspace">
    <section className="access-card">
      <div className="access-card-heading"><span className="step-chip">العروض</span><p className="eyebrow">تسويق مضبوط</p><h2>إنشاء عرض</h2><p className="muted">العرض يُنشأ كمسودة، ثم يُنشر بعد مراجعة النطاق والفترة.</p></div>
      <div className="catalog-search"><input aria-label="رمز العرض" placeholder="WELCOME10" value={promotionForm.code} onChange={(event) => setPromotionForm((current) => ({ ...current, code: event.target.value }))} /><input aria-label="اسم العرض" placeholder="خصم العملاء الجدد" value={promotionForm.nameAr} onChange={(event) => setPromotionForm((current) => ({ ...current, nameAr: event.target.value }))} /><input aria-label="وصف العرض" placeholder="خصم على أول طلب" value={promotionForm.descriptionAr} onChange={(event) => setPromotionForm((current) => ({ ...current, descriptionAr: event.target.value }))} /><select aria-label="نوع العرض" value={promotionForm.kind} onChange={(event) => setPromotionForm((current) => ({ ...current, kind: event.target.value as typeof current.kind }))}><option value="PERCENTAGE">نسبة مئوية</option><option value="FIXED">قيمة ثابتة</option></select><input aria-label="قيمة العرض" inputMode="numeric" type="number" min="1" value={promotionForm.valueMinor} onChange={(event) => setPromotionForm((current) => ({ ...current, valueMinor: event.target.value }))} /><input aria-label="بداية العرض" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /><button className="button" type="button" disabled={busy} onClick={() => void createPromotion()}>إنشاء مسودة العرض</button></div>
    </section>
    <section className="access-card">
      <div className="access-card-heading"><span className="step-chip">الاكتشاف</span><p className="eyebrow">محتوى منشور</p><h2>إنشاء بطاقة اكتشاف</h2><p className="muted">المحتوى العام لا يظهر إلا بعد نشره ومن خلال مسار DSH القانوني.</p></div>
      <div className="catalog-search"><input aria-label="عنوان المحتوى" placeholder="مختارات الأسبوع" value={contentForm.titleAr} onChange={(event) => setContentForm((current) => ({ ...current, titleAr: event.target.value }))} /><input aria-label="نص المحتوى" placeholder="اكتشف الجديد في مدينتك" value={contentForm.bodyAr} onChange={(event) => setContentForm((current) => ({ ...current, bodyAr: event.target.value }))} /><select aria-label="نوع المحتوى" value={contentForm.kind} onChange={(event) => setContentForm((current) => ({ ...current, kind: event.target.value as typeof current.kind }))}><option value="BANNER">شريط</option><option value="CAROUSEL">دوّار</option><option value="SHORT_FORM">قصة قصيرة</option></select><input aria-label="بداية المحتوى" type="datetime-local" value={contentStartsAt} onChange={(event) => setContentStartsAt(event.target.value)} /><button className="button" type="button" disabled={busy} onClick={() => void createContent()}>إنشاء مسودة المحتوى</button></div>
    </section>
    <section className="access-card" aria-labelledby="marketing-promotions-title"><div className="access-card-heading"><h2 id="marketing-promotions-title">سجل العروض</h2>{message ? <p role="status" className="muted">{message}</p> : null}</div>{promotions.length ? promotions.map((item) => <article className="access-card" key={item.id}><strong>{item.nameAr}</strong><p className="muted">{item.code} · {item.kind === "PERCENTAGE" ? `${item.valueMinor}%` : item.valueMinor} · {item.state}</p><button className="button button-secondary" type="button" disabled={busy} onClick={() => void publishPromotion(item, item.state === "PUBLISHED" ? "PAUSED" : "PUBLISHED")}>{item.state === "PUBLISHED" ? "إيقاف العرض" : "نشر العرض"}</button></article>) : <p className="muted">لا توجد عروض بعد.</p>}</section>
    <section className="access-card" aria-labelledby="marketing-content-title"><div className="access-card-heading"><h2 id="marketing-content-title">سجل محتوى الاكتشاف</h2></div>{content.length ? content.map((item) => <article className="access-card" key={item.id}><strong>{item.titleAr}</strong><p className="muted">{item.kind} · {item.state}</p><button className="button button-secondary" type="button" disabled={busy} onClick={() => void publishContent(item, item.state === "PUBLISHED" ? "PAUSED" : "PUBLISHED")}>{item.state === "PUBLISHED" ? "إيقاف المحتوى" : "نشر المحتوى"}</button></article>) : <p className="muted">لا يوجد محتوى بعد.</p>}</section>
  </div>;
}
