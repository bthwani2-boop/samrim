"use client";

import {
  parseStudioLayoutPublication, type StudioLayoutPublication,
  type StudioLayoutHistory,
} from "@bthwani/dsh";
import { useEffect, useRef, useState } from "react";
import { parseStudioDraft, studioSectionLabels, type StudioDraft, type StudioSectionId } from "./studio-draft";

type LayoutHistoryItem = StudioLayoutHistory["items"][number];
type PublicationAction = "ACTIVATE_DRAFT" | "RESTORE_DEFAULTS" | "ROLLBACK";

function parseHistory(value: unknown): ReadonlyArray<LayoutHistoryItem> | null {
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items)) return null;
  if (value.items.some((item: unknown) => !item || typeof item !== "object" ||
      !("version" in item) || !Number.isSafeInteger(item.version) || Number(item.version) < 2 ||
      !("action" in item) || !["ACTIVATE_DRAFT", "RESTORE_DEFAULTS", "ROLLBACK"].includes(String(item.action)) ||
      !("publishedByActorId" in item) || typeof item.publishedByActorId !== "string" ||
      !("createdAt" in item) || typeof item.createdAt !== "string")) return null;
  return value.items.slice(0, 20) as LayoutHistoryItem[];
}

export function PublishedLayoutSettings({ shared, dirty }: Readonly<{
  shared: Readonly<{ version: number; document: StudioDraft | null }> | null;
  dirty: boolean;
}>) {
  const [published, setPublished] = useState<StudioLayoutPublication | null>(null);
  const [history, setHistory] = useState<ReadonlyArray<LayoutHistoryItem>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const pending = useRef<{ fingerprint: string; key: string; expectedVersion: number } | null>(null);
  const unsupportedVisible = shared?.document?.sections.filter((section) => section.visible && (section.id === "topSellers" || section.id === "testimonials")) ?? [];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    if (revision > 0) setNotice("");
    setError("");
    void (async () => {
      try {
        const [live, past] = await Promise.all([
          fetch("/api/marketing/studio-layout", { cache: "no-store", signal: controller.signal }),
          fetch("/api/marketing/studio-layout?history=1", { cache: "no-store", signal: controller.signal }),
        ]);
        if (!live.ok || !past.ok) throw new Error("تعذر قراءة التخطيط المنشور أو سجل الإصدارات.");
        const publication = parseStudioLayoutPublication(await live.json() as unknown);
        const items = parseHistory(await past.json() as unknown);
        if (!publication || !items) throw new Error("استجابة خدمة تخطيط الرئيسية غير صالحة.");
        if (!controller.signal.aborted) {
          if (pending.current && publication.version !== pending.current.expectedVersion) {
            pending.current = null;
            setNotice("تغيّر إصدار التخطيط على DSH. راجع التخطيط المنشور وسجل التغييرات قبل إصدار أمر جديد.");
          }
          setPublished(publication);
          setHistory(items);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setPublished(null);
          setError(cause instanceof Error ? cause.message : "تعذر قراءة تخطيط الرئيسية.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);

  async function publish(action: PublicationAction, target = 0) {
    if (!published || loading || busy) return;
    if (action === "ACTIVATE_DRAFT" && unsupportedVisible.length) {
      setError("أخفِ أقسام الأكثر مبيعًا وآراء العملاء قبل النشر؛ لا توجد بيانات معتمدة لهذين القسمين في رئيسية العميل بعد.");
      return;
    }
    if (action === "ACTIVATE_DRAFT" && (!shared?.document || dirty || !parseStudioDraft(shared.document))) {
      setError("احفظ جميع تعديلات الاستوديو في مسودة الفريق قبل نشر التخطيط.");
      return;
    }
    const sourceVersion = action === "ACTIVATE_DRAFT" ? shared!.version : 0;
    const fingerprint = JSON.stringify([action, published.version, sourceVersion, target]);
    if (pending.current && pending.current.fingerprint !== fingerprint) {
      setError("هناك نتيجة نشر سابقة غير مؤكدة. حدّث الإصدار المنشور قبل تنفيذ أمر مختلف.");
      return;
    }
    const confirmation = action === "ACTIVATE_DRAFT"
      ? `نشر ترتيب الأقسام والشرائح من مسودة الفريق رقم ${sourceVersion} إلى رئيسية العميل؟ لا تتغير ألوان التطبيقات ولا بيانات المتاجر.`
      : action === "RESTORE_DEFAULTS"
        ? "استعادة تخطيط الرئيسية الافتراضي؟ ستظل ألوان التطبيقات المنشورة كما هي."
        : `العودة إلى تخطيط الإصدار ${target}؟ سيتم إنشاء إصدار جديد يحفظ سجل التغييرات.`;
    if (!window.confirm(confirmation)) return;
    const requestKey = pending.current?.key ?? crypto.randomUUID();
    pending.current = { fingerprint, key: requestKey, expectedVersion: published.version };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/marketing/studio-layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          expectedVersion: published.version,
          expectedDraftVersion: sourceVersion,
          targetPublicationVersion: action === "ROLLBACK" ? target : 0,
          idempotencyKey: requestKey,
        }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          pending.current = null;
          setRevision((current) => current + 1);
          throw new Error("تغيّر إصدار النشر أو المسودة. اقرأ الحالة المحدثة وقارنها قبل المحاولة.");
        }
        throw new Error("تعذر تأكيد عملية النشر. حدّث حالة الخادم قبل أي أمر مختلف.");
      }
      const body = await response.json() as { publication?: unknown };
      const saved = parseStudioLayoutPublication(body.publication);
      if (!saved) throw new Error("استجابة النشر غير صالحة. تحقق من الإصدار المحفوظ على DSH.");
      pending.current = null;
      setPublished(saved);
      setNotice(`تم حفظ تخطيط الرئيسية بإصدار ${saved.version}. تُطبقه أجهزة العميل عند تحديث قراءة الحالة المنشورة.`);
      setRevision((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر التأكد من حالة نشر التخطيط.");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="إدارة نشر تخطيط رئيسية العميل" className="studio-published-panel">
    <h3>نشر تخطيط الصفحة الرئيسية</h3>
    <p className="studio-guidance">التحكم في ترتيب الأقسام وإظهارها وإعدادات الشرائح منفصل عن نشر ألوان التطبيقات. لا تظهر مسودة الفريق للعامة قبل النشر.</p>
    {loading ? <p role="status">جارٍ تحميل التخطيط المنشور...</p> : null}
    <p role="status">{published
      ? `الإصدار المنشور: ${published.version} · ${published.document ? "تخطيط مخصص" : "تخطيط افتراضي"}`
      : "تعذر تحديد الإصدار المنشور"}</p>
    {dirty ? <p role="alert" className="studio-warning">هناك تغييرات محلية غير محفوظة في الفريق. لن تنشر حتى يتم حفظها أولًا.</p> : null}
    {unsupportedVisible.length ? <p role="alert" className="studio-warning">أخفِ «الأكثر مبيعًا» و«آراء العملاء»؛ هذه الأقسام تنتظر مصدر بيانات DSH معتمدًا.</p> : null}
    <div className="studio-topbar-actions">
      <button type="button" className="button button-secondary" disabled={busy} onClick={() => setRevision((current) => current + 1)}>تحديث حالة النشر</button>
      <button type="button" className="button button-primary" disabled={busy || loading || !published || dirty || !shared?.document || unsupportedVisible.length > 0} onClick={() => void publish("ACTIVATE_DRAFT")}>نشر تخطيط مسودة الفريق</button>
      <button type="button" className="button button-secondary" disabled={busy || loading || !published || !published.document} onClick={() => void publish("RESTORE_DEFAULTS")}>استعادة التخطيط الافتراضي</button>
    </div>
    {published?.document ? <div className="studio-inspector-content">
      <h4>ترتيب الأقسام المنشور</h4>
      <ol>{published.document.sections.filter((section) => section.visible).map((section) =>
        <li key={section.id}>{studioSectionLabels[section.id as StudioSectionId]} — {section.title}</li>,
      )}</ol>
      <p className="studio-guidance">هذه نسخة الخادم المنشورة؛ معاينة المحرر بالأعلى تعرض المسودة الحالية وقد تختلف عنها.</p>
    </div> : null}
    {history.length ? <div className="studio-inspector-content">
      <h4>سجل إصدارات التخطيط</h4>
      {history.map((item) => <div key={item.version} className="studio-topbar-actions">
        <span>الإصدار {item.version} · {item.action} · {item.createdAt}</span>
        <button type="button" className="button button-secondary" disabled={busy || loading || !published || item.version >= published.version} onClick={() => void publish("ROLLBACK", item.version)}>استعادة هذا الإصدار</button>
      </div>)}
    </div> : null}
    {notice ? <p role="status" className="studio-valid">{notice}</p> : null}
    {error ? <p role="alert" className="studio-warning">{error}</p> : null}
  </section>;
}
