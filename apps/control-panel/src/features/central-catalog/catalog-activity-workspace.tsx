"use client";

import type { CatalogActivityItem, CatalogActivityPage } from "@bthwani/dsh";
import { Alert, Button, Card, Empty, Input, Select, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { CommandFrame } from "../shared/command-surface";
import "./catalog-activity.css";

type Filter = Readonly<{ q: string; kind: string; action: string; storeId: string; from: string; to: string }>;
type Result = Readonly<{ kind: "loading" | "error" }> | Readonly<{ kind: "ready"; page: CatalogActivityPage }>;
const emptyFilters: Filter = { q: "", kind: "", action: "", storeId: "", from: "", to: "" };
const actionLabels: Record<string, string> = { created: "إنشاء", updated: "تعديل", migrated: "نقل بيانات" };
const kindLabels: Record<string, string> = { product: "منتج", offer: "عرض متجر" };
function eventDate(raw: string) {
  return new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Aden" }).format(new Date(raw));
}
function boundDate(value: string, end: boolean): string {
  if (!value) return "";
  const start = new Date(value + "T00:00:00+03:00");
  if (end) start.setTime(start.getTime() + 24 * 60 * 60 * 1000);
  return start.toISOString();
}
function eventDetails(item: CatalogActivityItem) {
  return <dl className="activity-detail">
    <div><dt>معرف العملية</dt><dd dir="ltr">{item.id}</dd></div>
    <div><dt>معرف الفاعل</dt><dd dir="ltr">{item.actorId}</dd></div>
    <div><dt>الكيان</dt><dd dir="ltr">{item.entityId}</dd></div>
    <div><dt>المتجر</dt><dd dir="ltr">{item.storeId || "الكتالوج المشترك"}</dd></div>
    <div><dt>الإصدار</dt><dd>{item.version}</dd></div>
    {item.fromState ? <div><dt>الحالة السابقة</dt><dd>{item.fromState}</dd></div> : null}
    {item.toState ? <div><dt>الحالة الجديدة</dt><dd>{item.toState}</dd></div> : null}
    {item.previousPriceMinor != null ? <div><dt>السعر السابق</dt><dd>{item.previousPriceMinor.toLocaleString("ar-YE")} ر.ي</dd></div> : null}
    {item.priceMinor != null ? <div><dt>السعر</dt><dd>{item.priceMinor.toLocaleString("ar-YE")} ر.ي</dd></div> : null}
  </dl>;
}

export function CatalogActivityWorkspace() {
  const [draft, setDraft] = useState<Filter>(emptyFilters);
  const [applied, setApplied] = useState<Filter>(emptyFilters);
  const [cursor, setCursor] = useState("");
  const [previous, setPrevious] = useState<readonly string[]>([]);
  const [result, setResult] = useState<Result>({ kind: "loading" });
  const [expanded, setExpanded] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    void retry; // Intentional explicit reload when the user retries a failed request.
    const controller = new AbortController();
    const query = new URLSearchParams({ limit: "20" });
    for (const [key, value] of Object.entries(applied)) {
      if (value) query.set(key, key === "from" || key === "to" ? boundDate(value, key === "to") : value);
    }
    if (cursor) query.set("cursor", cursor);
    setResult({ kind: "loading" });
    void fetch("/api/catalog-activity?" + query.toString(), { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("REQUEST_FAILED");
        return await response.json() as CatalogActivityPage;
      })
      .then(page => { if (!controller.signal.aborted) setResult({ kind: "ready", page }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ kind: "error" }); });
    return () => controller.abort();
  }, [applied, cursor, retry]);

  const update = (key: keyof Filter, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const apply = () => { setCursor(""); setPrevious([]); setExpanded(""); setApplied(draft); setRetry(n => n + 1); };
  const page = result.kind === "ready" ? result.page : null;
  return <CommandFrame title="سجل نشاط الكتالوج" subtitle="تاريخ إنشاء وتعديل المنتجات وعروض المتاجر المسجّل فعليًا في خدمة الكتالوج.">
    <Card title="البحث والتصفية">
      <form onSubmit={event => { event.preventDefault(); apply(); }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space wrap>
            <label htmlFor="activity-q">البحث باسم المنتج أو معرف الفاعل <Input id="activity-q" aria-label="البحث في نشاط الكتالوج" value={draft.q} maxLength={120} onChange={event => update("q", event.target.value)} allowClear /></label>
            <label htmlFor="activity-store">معرف المتجر <Input id="activity-store" aria-label="معرف المتجر" dir="ltr" value={draft.storeId} maxLength={128} onChange={event => update("storeId", event.target.value)} allowClear /></label>
            <label htmlFor="activity-kind">الفئة <Select id="activity-kind" aria-label="فئة النشاط" value={draft.kind} style={{ minWidth: 130 }} options={[{ value: "", label: "الكل" }, { value: "product", label: "المنتجات" }, { value: "offer", label: "عروض المتاجر" }]} onChange={value => update("kind", value)} /></label>
            <label htmlFor="activity-action">الإجراء <Select id="activity-action" aria-label="إجراء النشاط" value={draft.action} style={{ minWidth: 130 }} options={[{ value: "", label: "جميع الإجراءات" }, { value: "created", label: "إنشاء" }, { value: "updated", label: "تعديل" }, { value: "migrated", label: "نقل بيانات" }]} onChange={value => update("action", value)} /></label>
            <label htmlFor="activity-from">من تاريخ <Input id="activity-from" type="date" aria-label="من تاريخ" value={draft.from} max={draft.to || undefined} onChange={event => update("from", event.target.value)} /></label>
            <label htmlFor="activity-to">إلى تاريخ <Input id="activity-to" type="date" aria-label="إلى تاريخ" value={draft.to} min={draft.from || undefined} onChange={event => update("to", event.target.value)} /></label>
          </Space>
          <Space>
            <Button type="primary" htmlType="submit">تطبيق التصفية</Button>
            <Button htmlType="button" onClick={() => { setDraft(emptyFilters); setApplied(emptyFilters); setPrevious([]); setCursor(""); setExpanded(""); setRetry(n => n + 1); }}>مسح</Button>
          </Space>
        </Space>
      </form>
    </Card>
    <Card title="الأحداث المسجلة" extra={<Typography.Text type="secondary">السجل يعرض تغييرات الكتالوج فقط، وليس جميع أنشطة الحساب</Typography.Text>}>
      {result.kind === "loading" ? <div role="status"><Spin /> جارٍ تحميل السجل...</div> : null}
      {result.kind === "error" ? <Alert type="error" showIcon message="تعذر قراءة السجل" action={<Button onClick={() => setRetry(n => n + 1)}>إعادة المحاولة</Button>} /> : null}
      {page && page.items.length === 0 ? <Empty description="لا توجد تغييرات مسجلة وفق المرشحات المحددة" /> : null}
      {page?.items.map(item => <section key={item.id} className="activity-entry">
        <div className="activity-entry-summary">
          <div><Tag>{kindLabels[item.kind] ?? item.kind}</Tag><Tag color={item.action === "created" ? "success" : "default"}>{actionLabels[item.action] ?? item.action}</Tag>
            <strong>{item.subject}</strong>
            <div><Typography.Text type="secondary">{eventDate(item.at)} · {item.actorId}</Typography.Text></div>
          </div>
          <Button type="link" aria-expanded={expanded === item.id} onClick={() => setExpanded(value => value === item.id ? "" : item.id)}>{expanded === item.id ? "إخفاء التفاصيل" : "عرض التفاصيل"}</Button>
        </div>
        {expanded === item.id ? eventDetails(item) : null}
      </section>)}
      {page ? <Space style={{ marginTop: 16 }}>
        <Button disabled={previous.length === 0} onClick={() => { const stack = previous.slice(); setCursor(stack.pop() ?? ""); setPrevious(stack); setExpanded(""); }}>السابق</Button>
        <Button disabled={!page.nextCursor} onClick={() => { setPrevious(stack => [...stack, cursor]); setCursor(page.nextCursor); setExpanded(""); }}>التالي</Button>
        <Typography.Text type="secondary">عدد الأحداث في الصفحة: {page.items.length}</Typography.Text>
      </Space> : null}
    </Card>
  </CommandFrame>;
}
