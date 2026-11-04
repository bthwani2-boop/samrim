"use client";

import type { CatalogActivityItem, CatalogActivityPage } from "@bthwani/dsh";
import { Alert, Button, Card, Empty, Input, Select, Spin, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { activityActor, activityContext, activityTitle } from "./catalog-activity-presentation";
import "./catalog-activity.css";

type Filter = Readonly<{ q: string; kind: string; action: string; storeId: string; from: string; to: string }>;
type Result = Readonly<{ kind: "loading" | "error" }> | Readonly<{ kind: "ready"; page: CatalogActivityPage }>;
const emptyFilters: Filter = { q: "", kind: "", action: "", storeId: "", from: "", to: "" };
const actionLabels: Record<string, string> = { created: "إضافة", updated: "تعديل", migrated: "نقل بيانات" };
const kindLabels: Record<string, string> = { product: "منتج", offer: "عرض متجر" };
const stateLabels: Record<string, string> = {
  draft: "مسودة", published: "منشور", unpublished: "غير منشور",
  archived: "مؤرشف", active: "نشط", inactive: "غير نشط",
  available: "متاح", unavailable: "غير متاح",
};

function eventDate(raw: string) {
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? "تاريخ غير متاح" : new Intl.DateTimeFormat("ar-YE", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Aden",
  }).format(date);
}

function boundDate(value: string, end: boolean): string {
  if (!value) return "";
  const start = new Date(`${value}T00:00:00+03:00`);
  if (end) start.setTime(start.getTime() + 24 * 60 * 60 * 1000);
  return start.toISOString();
}

function price(value: number) {
  return `${value.toLocaleString("ar-YE")} ر.ي`;
}

function readableState(raw: string) {
  return stateLabels[raw.toLowerCase()] ?? "حالة أخرى";
}

function eventDetails(item: CatalogActivityItem) {
  const priceChanged = item.priceMinor != null && item.previousPriceMinor != null &&
    item.priceMinor !== item.previousPriceMinor;
  return <div className="activity-expanded">
    <dl className="activity-detail">
      <div><dt>نوع التغيير</dt><dd>{actionLabels[item.action] ?? "نشاط كتالوج"} · {kindLabels[item.kind] ?? "عنصر كتالوج"}</dd></div>
      <div><dt>المنتج</dt><dd>{item.subject || "اسم المنتج غير متاح"}</dd></div>
      {item.kind === "offer" ? <div><dt>المتجر</dt><dd>{item.storeName || "اسم المتجر غير متاح"}</dd></div> : null}
      <div><dt>التاريخ</dt><dd>{eventDate(item.at)}</dd></div>
      <div><dt>من نفّذ العملية؟</dt><dd>{activityActor(item.actorId)} — الاسم غير متاح في سجل التدقيق الحالي</dd></div>
      {item.fromState && item.fromState !== item.toState ? <div><dt>الحالة السابقة</dt><dd>{readableState(item.fromState)}</dd></div> : null}
      {item.toState ? <div><dt>الحالة بعد التغيير</dt><dd>{readableState(item.toState)}</dd></div> : null}
      {priceChanged && item.previousPriceMinor != null ? <div><dt>السعر السابق</dt><dd>{price(item.previousPriceMinor)}</dd></div> : null}
      {item.priceMinor != null ? <div><dt>{priceChanged ? "السعر الجديد" : "السعر المسجل"}</dt><dd>{price(item.priceMinor)}</dd></div> : null}
    </dl>
    <details className="activity-technical">
      <summary>معلومات فنية للدعم والتدقيق</summary>
      <dl className="activity-detail">
        <div><dt>مرجع الحدث</dt><dd><bdi dir="ltr">{item.id}</bdi></dd></div>
        <div><dt>معرّف المنفّذ</dt><dd><bdi dir="ltr">{item.actorId || "غير متاح"}</bdi></dd></div>
        <div><dt>معرّف العنصر</dt><dd><bdi dir="ltr">{item.entityId}</bdi></dd></div>
        {item.storeId ? <div><dt>معرّف المتجر</dt><dd><bdi dir="ltr">{item.storeId}</bdi></dd></div> : null}
        <div><dt>إصدار السجل</dt><dd>{item.version}</dd></div>
        {item.fromState ? <div><dt>رمز الحالة السابقة</dt><dd><bdi dir="ltr">{item.fromState}</bdi></dd></div> : null}
        {item.toState ? <div><dt>رمز الحالة الجديدة</dt><dd><bdi dir="ltr">{item.toState}</bdi></dd></div> : null}
      </dl>
    </details>
  </div>;
}

export function CatalogActivityWorkspace({ active = true }: Readonly<{ active?: boolean }> = {}) {
  const [draft, setDraft] = useState<Filter>(emptyFilters);
  const [applied, setApplied] = useState<Filter>(emptyFilters);
  const [cursor, setCursor] = useState("");
  const [previous, setPrevious] = useState<readonly string[]>([]);
  const [result, setResult] = useState<Result>({ kind: "loading" });
  const [expanded, setExpanded] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    void retry;
    if (!active) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ limit: "20" });
    for (const [key, value] of Object.entries(applied)) {
      if (value) query.set(key, key === "from" || key === "to" ? boundDate(value, key === "to") : value);
    }
    if (cursor) query.set("cursor", cursor);
    setResult({ kind: "loading" });
    void fetch(`/api/catalog-activity?${query.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("REQUEST_FAILED");
        return await response.json() as CatalogActivityPage;
      })
      .then(page => { if (!controller.signal.aborted) setResult({ kind: "ready", page }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ kind: "error" }); });
    return () => controller.abort();
  }, [active, applied, cursor, retry]);

  const update = (key: keyof Filter, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const apply = () => {
    setCursor("");
    setPrevious([]);
    setExpanded("");
    setApplied(draft);
    setRetry(n => n + 1);
  };
  const clear = () => {
    setDraft(emptyFilters);
    setApplied(emptyFilters);
    setPrevious([]);
    setCursor("");
    setExpanded("");
    setRetry(n => n + 1);
  };
  const page = result.kind === "ready" ? result.page : null;

  return <div className="activity-workspace">
    <header className="activity-heading">
      <h2>سجل نشاط الكتالوج</h2>
      <p>تعرّف على ما تغيّر في المنتجات وعروض المتاجر، ومتى حدث ذلك.</p>
    </header>
    <Card className="activity-filters">
      <form onSubmit={event => { event.preventDefault(); apply(); }}>
        <div className="activity-filter-grid">
          <label className="activity-query" htmlFor="activity-q">البحث
            <Input id="activity-q" placeholder="اسم منتج أو متجر" aria-label="البحث باسم المنتج أو المتجر" value={draft.q} maxLength={120} onChange={event => update("q", event.target.value)} allowClear />
          </label>
          <label htmlFor="activity-kind">نوع النشاط
            <Select id="activity-kind" aria-label="نوع النشاط" value={draft.kind} options={[{ value: "", label: "الكل" }, { value: "product", label: "المنتجات" }, { value: "offer", label: "عروض المتاجر" }]} onChange={value => update("kind", value)} />
          </label>
          <label htmlFor="activity-action">الإجراء
            <Select id="activity-action" aria-label="إجراء النشاط" value={draft.action} options={[{ value: "", label: "جميع الإجراءات" }, { value: "created", label: "إضافة" }, { value: "updated", label: "تعديل" }, { value: "migrated", label: "نقل بيانات" }]} onChange={value => update("action", value)} />
          </label>
          <label htmlFor="activity-from">من تاريخ
            <Input id="activity-from" type="date" aria-label="من تاريخ" value={draft.from} max={draft.to || undefined} onChange={event => update("from", event.target.value)} />
          </label>
          <label htmlFor="activity-to">إلى تاريخ
            <Input id="activity-to" type="date" aria-label="إلى تاريخ" value={draft.to} min={draft.from || undefined} onChange={event => update("to", event.target.value)} />
          </label>
        </div>
        <details className="activity-advanced">
          <summary>خيارات بحث متقدمة</summary>
          <label htmlFor="activity-store">معرّف المتجر (للتدقيق الفني)
            <Input id="activity-store" aria-label="معرّف المتجر للتدقيق الفني" dir="ltr" value={draft.storeId} maxLength={128} onChange={event => update("storeId", event.target.value)} allowClear />
          </label>
        </details>
        <div className="activity-filter-actions">
          <Button type="primary" htmlType="submit">عرض النتائج</Button>
          <Button htmlType="button" onClick={clear}>مسح الفلاتر</Button>
        </div>
      </form>
    </Card>
    <Card title="الأحداث المسجلة" className="activity-feed"
      extra={<Typography.Text type="secondary" className="activity-scope-note">تغييرات الكتالوج فقط</Typography.Text>}>
      {result.kind === "loading" ? <div className="activity-load" role="status"><Spin /> جارٍ تحميل الأنشطة...</div> : null}
      {result.kind === "error" ? <Alert type="error" showIcon message="تعذر تحميل سجل النشاط" description="تحقق من الاتصال والصلاحيات ثم حاول مجددًا." action={<Button onClick={() => setRetry(n => n + 1)}>إعادة المحاولة</Button>} /> : null}
      {page && page.items.length === 0 ? <Empty description="لا توجد أنشطة تطابق البحث. جرّب مسح الفلاتر." /> : null}
      {page?.items.map(item => <article key={item.id} className="activity-entry">
        <div className="activity-entry-summary">
          <div className="activity-entry-body">
            <div className="activity-entry-tags">
              <Tag>{kindLabels[item.kind] ?? "عنصر كتالوج"}</Tag>
              <Tag color={item.action === "created" ? "success" : "default"}>{actionLabels[item.action] ?? "نشاط"}</Tag>
            </div>
            <h3>{activityTitle(item)}</h3>
            <p className="activity-entry-context">{activityContext(item)}</p>
            <p className="activity-entry-meta">{eventDate(item.at)} · {activityActor(item.actorId)}</p>
          </div>
          <Button htmlType="button" aria-expanded={expanded === item.id} onClick={() => setExpanded(value => value === item.id ? "" : item.id)}>{expanded === item.id ? "إخفاء التفاصيل" : "عرض التفاصيل"}</Button>
        </div>
        {expanded === item.id ? eventDetails(item) : null}
      </article>)}
      {page ? <div className="activity-pagination">
        <Button disabled={previous.length === 0} onClick={() => { const stack = previous.slice(); setCursor(stack.pop() ?? ""); setPrevious(stack); setExpanded(""); }}>السابق</Button>
        <Button disabled={!page.nextCursor} onClick={() => { setPrevious(stack => [...stack, cursor]); setCursor(page.nextCursor); setExpanded(""); }}>التالي</Button>
        <Typography.Text type="secondary">الأحداث المعروضة: {page.items.length}</Typography.Text>
      </div> : null}
    </Card>
  </div>;
}
