"use client";

import { parseStudioPalette, parseStudioThemePublication, type StudioThemePublication } from "@bthwani/design-system";
import { useEffect, useState } from "react";
import type { StudioDraft } from "./studio-draft";

type ThemeHistoryItem = Readonly<{
  version: number;
  action: "ACTIVATE_DRAFT" | "RESTORE_DEFAULTS" | "ROLLBACK";
  publishedByActorId: string;
  createdAt: string;
}>;

function parseHistory(value: unknown): ThemeHistoryItem[] | null {
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items)) return null;
  const items: ThemeHistoryItem[] = [];
  for (const item of value.items) {
    if (!item || typeof item !== "object" ||
        !Number.isInteger(item.version) || Number(item.version) < 2 ||
        !["ACTIVATE_DRAFT", "RESTORE_DEFAULTS", "ROLLBACK"].includes(item.action) ||
        typeof item.publishedByActorId !== "string" || typeof item.createdAt !== "string") return null;
    items.push(item as ThemeHistoryItem);
  }
  return items.slice(0, 20);
}

export function PublishedThemeSettings({ shared }: Readonly<{
  shared: Readonly<{ version: number; document: StudioDraft | null }> | null;
}>) {
  const [publication, setPublication] = useState<StudioThemePublication | null>(null);
  const [history, setHistory] = useState<ThemeHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    if (revision > 0) setNotice("");
    setError("");
    void (async () => {
      try {
        const [publishedResponse, historyResponse] = await Promise.all([
          fetch("/api/marketing/studio-theme", { cache: "no-store", signal: controller.signal }),
          fetch("/api/marketing/studio-theme?history=1", { cache: "no-store", signal: controller.signal }),
        ]);
        if (!publishedResponse.ok || !historyResponse.ok) throw new Error("تعذر قراءة الإصدار المنشور أو سجل النشر.");
        const published = parseStudioThemePublication(await publishedResponse.json() as unknown);
        const past = parseHistory(await historyResponse.json() as unknown);
        if (!published || !past) throw new Error("إعدادات النشر المستلمة غير صالحة.");
        if (!controller.signal.aborted) { setPublication(published); setHistory(past); }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setPublication(null);
          setError(cause instanceof Error ? cause.message : "تعذر قراءة إعدادات النشر.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);

  async function publish(action: "ACTIVATE_DRAFT" | "RESTORE_DEFAULTS" | "ROLLBACK", target = 0) {
    if (!publication || busy || loading) return;
    if (action === "ACTIVATE_DRAFT" && (!shared?.document || !parseStudioPalette(shared.document.palette))) {
      setError("لا يمكن نشر ألوان مسودة فريق غير محفوظة أو لا تجتاز التباين. احفظ مسودة الفريق أولًا.");
      return;
    }
    const prompt = action === "ACTIVATE_DRAFT"
      ? `نشر الألوان الخمسة من مسودة الفريق رقم ${shared!.version} إلى التطبيقات المدعومة؟ لن تُنشر أقسام الصفحة أو الوسائط.`
      : action === "RESTORE_DEFAULTS"
        ? "استعادة ألوان الكود الافتراضية على التطبيقات المدعومة؟"
        : `الرجوع إلى ألوان الإصدار المنشور رقم ${target}؟`;
    if (!window.confirm(prompt)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/marketing/studio-theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          expectedVersion: publication.version,
          expectedDraftVersion: action === "ACTIVATE_DRAFT" ? shared!.version : 0,
          targetPublicationVersion: action === "ROLLBACK" ? target : 0,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!response.ok) {
        if (response.status === 409) throw new Error("تغيّر الإصدار من جلسة أخرى؛ حدّث سجل النشر قبل اتخاذ قرار جديد.");
        throw new Error("لم يتأكد نشر الألوان. اقرأ الإصدار الحالي قبل إعادة الأمر.");
      }
      const result = await response.json() as { publication?: unknown };
      const saved = parseStudioThemePublication(result.publication);
      if (!saved) throw new Error("استجابة النشر غير صالحة. حدّث حالة الخادم ولا تعِد العملية دون مراجعتها.");
      setPublication(saved);
      setNotice(`حُفظ إصدار الألوان المنشور ${saved.version}. لا يعني ذلك أن كل جهاز متصل حدّث واجهته فورًا.`);
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إثبات حالة النشر.");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="نشر ألوان الاستوديو" className="studio-published-panel">
    <h3>إدارة ألوان التطبيقات المنشورة</h3>
    <p className="studio-guidance">يتم نشر الألوان الخمسة فقط. الأقسام والشرائح تبقى مسودات؛ القيم الافتراضية داخل التطبيقات ثابتة عند غياب نشر صالح.</p>
    {loading ? <p role="status">جارٍ قراءة سجل نشر الألوان...</p> : null}
    <p role="status">{publication ? `الإصدار المنشور: ${publication.version} — ${publication.palette ? "ألوان مخصصة" : "ألوان الكود الافتراضية"}` : "الإصدار المنشور غير متاح"}</p>
    <div className="studio-topbar-actions">
      <button type="button" className="button button-secondary" disabled={busy} onClick={() => setRevision((value) => value + 1)}>تحديث حالة النشر</button>
      <button type="button" className="button button-primary" disabled={busy || loading || !publication || !shared?.document || !parseStudioPalette(shared.document.palette)} onClick={() => void publish("ACTIVATE_DRAFT")}>نشر ألوان مسودة الفريق</button>
      <button type="button" className="button button-secondary" disabled={busy || loading || !publication || !publication.palette} onClick={() => void publish("RESTORE_DEFAULTS")}>استعادة ألوان الكود</button>
    </div>
    {history.length ? <div className="studio-inspector-content">
      <h4>الإصدارات السابقة</h4>
      {history.map((item) => <div key={item.version} className="studio-topbar-actions">
        <span>الإصدار {item.version} · {item.action} · {item.createdAt}</span>
        <button type="button" className="button button-secondary" disabled={busy || loading || !publication || item.version >= publication.version} onClick={() => void publish("ROLLBACK", item.version)}>العودة إلى هذا الإصدار</button>
      </div>)}
    </div> : null}
    {notice ? <p role="status" className="studio-valid">{notice}</p> : null}
    {error ? <p role="alert" className="studio-warning">{error}</p> : null}
  </section>;
}
