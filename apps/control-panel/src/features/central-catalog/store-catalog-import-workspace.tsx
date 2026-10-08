"use client";

import type { CatalogImportCommitResponse, CatalogImportItem, CatalogImportPreviewResponse, CatalogImportRunResponse, OperatorStoreListResponse } from "@bthwani/dsh";
import { useEffect, useState } from "react";

type ImportResult = CatalogImportPreviewResponse | CatalogImportRunResponse | CatalogImportCommitResponse;

function responseError(value: unknown): string {
  if (!value || typeof value !== "object") return "تعذر تنفيذ العملية.";
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "تعذر تنفيذ العملية.";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : "تعذر تنفيذ العملية.";
}

async function readJson<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(value));
  return value as T;
}

function classificationLabel(item: CatalogImportItem): string {
  switch (item.classification) {
    case "READY": return "جاهز";
    case "NEEDS_REVIEW": return "باركود غير معروف للمراجعة";
    case "DUPLICATE_INPUT": return "مكرر في الملف";
    case "DUPLICATE_EXISTING": return "مطابق للسجل";
    case "CONFLICT_EXISTING": return "تعارض مع السجل";
    case "INVALID_INPUT": return "بيانات غير صالحة";
    case "IMPORTED": return "تم التطبيق";
    case "REPLAYED": return "إعادة آمنة";
    case "FAILED": return "فشل";
    default: return "غير مصنف";
  }
}

export function StoreCatalogImportWorkspace() {
  const [stores, setStores] = useState<OperatorStoreListResponse["stores"]>([]);
  const [storeID, setStoreID] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "read" | "commit" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewAttempt, setPreviewAttempt] = useState<Readonly<{ runId: string; idempotencyKey: string; correlationId: string }> | null>(null);
  const [commitAttempt, setCommitAttempt] = useState<Readonly<{ runId: string; idempotencyKey: string; correlationId: string }> | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/partners/stores?limit=50", { cache: "no-store" })
      .then(async (response) => await readJson<OperatorStoreListResponse>(response))
      .then((page) => { if (active) setStores(page.stores); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  function selectFile(nextFile: File | null) {
    setFile(nextFile);
    setResult(null);
    setError("");
    setNotice("");
    setPreviewAttempt(null);
    setCommitAttempt(null);
  }

  function selectStore(nextStoreID: string) {
    if (nextStoreID === storeID) return;
    setStoreID(nextStoreID);
    setResult(null);
    setError("");
    setNotice("");
    setPreviewAttempt(null);
    setCommitAttempt(null);
  }

  async function preview() {
    if (!file || !storeID.trim() || busy) return;
    if (file.size < 1 || file.size > 20 * 1024 * 1024 || !/\.(csv|xlsx)$/i.test(file.name)) {
      setError("اختر ملف جدول صالحًا بحجم لا يتجاوز 20 ميغابايت.");
      return;
    }
    const attempt = result?.run.state === "rejected" || !previewAttempt
      ? { runId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() }
      : previewAttempt;
    setPreviewAttempt(attempt);
    setCommitAttempt(null);
    setResult(null);
    setBusy("preview");
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.append("storeId", storeID.trim());
      body.append("file", file, file.name);
      const response = await fetch("/api/catalog/store-imports/preview", {
        method: "POST",
        headers: { "Idempotency-Key": attempt.idempotencyKey, "X-Correlation-ID": attempt.correlationId },
        body,
      });
      setResult(await readJson<ImportResult>(response));
      setNotice("أنشأ النظام معاينة مرتبطة بنطاق المتجر. لم تُكتب الأسعار قبل اعتمادك.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء معاينة الأسعار.");
    } finally {
      setBusy("");
    }
  }

  async function readRun(runID: string) {
    setBusy("read");
    setError("");
    try {
      setResult(await readJson<ImportResult>(await fetch(`/api/catalog/store-imports/${encodeURIComponent(runID)}`, { cache: "no-store" })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذرت إعادة قراءة نتيجة الاستيراد.");
    } finally {
      setBusy("");
    }
  }

  async function commit() {
    if (!result || !previewAttempt || busy || result.run.acceptedCount < 1 || result.run.state !== "previewed") return;
    const attempt = commitAttempt?.runId === result.run.id ? commitAttempt : { runId: result.run.id, idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() };
    setCommitAttempt(attempt);
    setBusy("commit");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/catalog/store-imports/${encodeURIComponent(result.run.id)}`, {
        method: "POST",
        headers: { "Idempotency-Key": attempt.idempotencyKey, "X-Correlation-ID": attempt.correlationId },
      });
      const committed = await readJson<ImportResult>(response);
      setResult(committed);
      if (committed.run.state === "committed") setCommitAttempt(null);
      setNotice(committed.run.state === "committed"
        ? "اعتمد النظام الصفوف الصالحة، وتم حفظ الصفوف غير المعروفة للمراجعة دون إنشاء منتجات."
        : "لم يعتمد النظام هذه المعاينة. أعد قراءة الحالة ثم أنشئ معاينة جديدة قبل أي محاولة أخرى.");
      await readRun(committed.run.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر اعتماد الأسعار.");
    } finally {
      setBusy("");
    }
  }

  return <section className="access-card" aria-labelledby="store-catalog-import-title" data-testid="store-catalog-import-workspace">
    <div className="access-card-heading">
      <span className="step-chip">أسعار المتجر</span>
      <h2 id="store-catalog-import-title">استيراد كتالوج المتجر</h2>
      <p className="muted">ارفع ملف CSV أو Excel لمراجعة المنتجات والأسعار قبل الحفظ. الحد 5000 صف و20 ميغابايت.</p>
    </div>
    {stores.length ? <label className="field-label" htmlFor="store-catalog-import-store-select">المتجر من القائمة<select id="store-catalog-import-store-select" value={stores.some((store) => store.id === storeID) ? storeID : ""} onChange={(event) => selectStore(event.target.value)} disabled={Boolean(busy)}><option value="">اختر متجرًا</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label> : <p className="muted">المتجر المحدد غير متاح في القائمة الحالية.</p>}
    {storeID && stores.some((store) => store.id === storeID) ? <p className="muted" aria-live="polite">المتجر المحدد: {stores.find((store) => store.id === storeID)?.name}</p> : null}
    <label className="field-label" htmlFor="store-catalog-import-file">ملف الباركود والأسعار<input id="store-catalog-import-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={Boolean(busy)} onChange={(event) => selectFile(event.target.files?.[0] ?? null)} /></label>
    {file ? <p className="muted">{file.name} · {(file.size / (1024 * 1024)).toFixed(2)} ميغابايت</p> : null}
    <button type="button" className="button button-primary" disabled={Boolean(busy) || !file || !storeID.trim()} onClick={() => void preview()}>{busy === "preview" ? "جارٍ إنشاء المعاينة…" : "معاينة الملف"}</button>
    {result ? <div className="managed-status managed-status-info" role="status">
      <strong>الحالة: {result.run.state === "previewed" ? "معاينة جاهزة" : result.run.state === "committed" ? "تم الاعتماد" : "تحتاج مراجعة"} · الجاهز: {result.run.acceptedCount} · المراجعة أو التعارض: {result.run.conflictCount}</strong>
      <p>يُحل كل باركود على الكتالوج المشترك ومحلي المتجر. الباركود غير المعروف لا ينشئ منتجًا تلقائيًا.</p>
      <ol>{result.items.map((item) => <li key={`${item.rowNumber}-${item.stableKey}`}>السطر {item.rowNumber} · {classificationLabel(item)}{item.errorMessage ? ` · ${item.errorMessage}` : item.committed ? " · كُتب " : ""}</li>)}</ol>
      {result.run.state === "previewed" && result.run.acceptedCount > 0 ? <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => void commit()}>{busy === "commit" ? "جارٍ الاعتماد…" : "اعتماد الصفوف الصالحة"}</button> : null}
      {result.run.state === "rejected" ? <p className="muted">انتهت هذه المعاينة بعد تعارض أثناء الاعتماد. أعد معاينة الملف لقراءة البيانات الحالية قبل اعتماد الصفوف مجددًا.</p> : null}
      {result.run.state === "committed" ? <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => void readRun(result.run.id)}>{busy === "read" ? "جارٍ إعادة القراءة…" : "إعادة قراءة النتيجة"}</button> : null}
    </div> : null}
    {notice ? <p className="success-inline" role="status">{notice}</p> : null}
    {error ? <p className="identity-error" role="alert">{error}</p> : null}
  </section>;
}
