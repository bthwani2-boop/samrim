"use client";

import type { CatalogImportCommitResponse, CatalogImportItem, CatalogImportPreviewResponse, CatalogImportRunResponse, OperatorStoreListResponse } from "@bthwani/dsh";
import { useEffect, useRef, useState } from "react";

type ImportResult = CatalogImportPreviewResponse | CatalogImportRunResponse | CatalogImportCommitResponse;
type StoreImportOption = Readonly<{ id: string; name: string }>;
type StoreImportHistory = Readonly<{ storeCatalogImportCursors?: ReadonlyArray<string> }>;
const storePageSize = 50;

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
  const [selectedStore, setSelectedStore] = useState<StoreImportOption | null>(null);
  const [storeSearch, setStoreSearch] = useState("");
  const [appliedStoreSearch, setAppliedStoreSearch] = useState("");
  const [storeCursor, setStoreCursor] = useState("");
  const [storeCursorStack, setStoreCursorStack] = useState<ReadonlyArray<string>>([]);
  const [nextStoreCursor, setNextStoreCursor] = useState("");
  const [storeListReady, setStoreListReady] = useState(false);
  const [storeListRefresh, setStoreListRefresh] = useState(0);
  const [storesLoading, setStoresLoading] = useState(true);
  const [storesError, setStoresError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "read" | "commit" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewAttempt, setPreviewAttempt] = useState<Readonly<{ runId: string; idempotencyKey: string; correlationId: string }> | null>(null);
  const [commitAttempt, setCommitAttempt] = useState<Readonly<{ runId: string; idempotencyKey: string; correlationId: string }> | null>(null);
  const storeRequestSequence = useRef(0);

  useEffect(() => {
    const syncStoreListFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const query = params.get("storeQ")?.trim().slice(0, 128) ?? "";
      const history = window.history.state as StoreImportHistory | null;
      setStoreSearch(query);
      setAppliedStoreSearch(query);
      setStoreCursor(params.get("storeCursor") ?? "");
      setStoreCursorStack(history?.storeCatalogImportCursors ?? []);
    };
    syncStoreListFromUrl();
    setStoreListReady(true);
    window.addEventListener("popstate", syncStoreListFromUrl);
    return () => window.removeEventListener("popstate", syncStoreListFromUrl);
  }, []);

  useEffect(() => {
    if (!storeListReady) return;
    const controller = new AbortController();
    const sequence = storeRequestSequence.current + storeListRefresh + 1;
    storeRequestSequence.current = sequence;
    setStoresLoading(true);
    setStoresError("");
    const params = new URLSearchParams({ limit: String(storePageSize) });
    if (appliedStoreSearch) params.set("q", appliedStoreSearch);
    if (storeCursor) params.set("cursor", storeCursor);
    void fetch(`/api/partners/stores?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => await readJson<OperatorStoreListResponse>(response))
      .then((page) => {
        if (sequence !== storeRequestSequence.current) return;
        setStores(page.stores);
        setNextStoreCursor(page.nextCursor ?? "");
        setSelectedStore((current) => {
          if (!current) return current;
          const refreshed = page.stores.find((store) => store.id === current.id);
          return refreshed ? { id: refreshed.id, name: refreshed.name } : current;
        });
      })
      .catch((cause) => {
        if (controller.signal.aborted || sequence !== storeRequestSequence.current) return;
        setStores([]);
        setNextStoreCursor("");
        setStoresError(cause instanceof Error ? cause.message : "تعذر تحميل قائمة المتاجر.");
      })
      .finally(() => {
        if (sequence === storeRequestSequence.current) setStoresLoading(false);
      });
    return () => controller.abort();
  }, [appliedStoreSearch, storeCursor, storeListReady, storeListRefresh]);

  function navigateStoreList(query: string, cursor: string, cursorStack: ReadonlyArray<string>) {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("storeQ", query); else url.searchParams.delete("storeQ");
    if (cursor) url.searchParams.set("storeCursor", cursor); else url.searchParams.delete("storeCursor");
    const previousState = window.history.state;
    const historyState = previousState && typeof previousState === "object" ? previousState : {};
    window.history.pushState({ ...historyState, storeCatalogImportCursors: cursorStack }, "", `${url.pathname}${url.search}${url.hash}`);
    setStoreSearch(query);
    setAppliedStoreSearch(query);
    setStoreCursor(cursor);
    setStoreCursorStack(cursorStack);
  }

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
    const nextStore = stores.find((store) => store.id === nextStoreID);
    setSelectedStore(nextStore ? { id: nextStore.id, name: nextStore.name } : null);
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
    <div className="catalog-import-store-picker" aria-busy={storesLoading}>
      <form className="catalog-import-store-search" noValidate onSubmit={(event) => { event.preventDefault(); navigateStoreList(storeSearch.trim().slice(0, 128), "", []); }}>
        <label className="field-label" htmlFor="store-catalog-import-store-search">ابحث عن متجر بالاسم<input id="store-catalog-import-store-search" type="search" value={storeSearch} maxLength={128} onChange={(event) => setStoreSearch(event.target.value)} placeholder="اكتب اسم المتجر ثم ابحث" disabled={Boolean(busy)} /></label>
        <button type="submit" className="button button-secondary" disabled={storesLoading || Boolean(busy)}>بحث</button>
        {storeSearch || appliedStoreSearch ? <button type="button" className="button button-quiet" disabled={storesLoading || Boolean(busy)} onClick={() => navigateStoreList("", "", [])}>مسح البحث</button> : null}
      </form>
      {storesLoading ? <p className="muted" role="status">جارٍ تحميل صفحة محدودة من المتاجر…</p> : null}
      {storesError ? <div className="managed-status managed-status-error" role="alert"><p>{storesError}</p><button type="button" className="button button-secondary" onClick={() => setStoreListRefresh((value) => value + 1)}>إعادة المحاولة</button></div> : null}
      {!storesLoading && !storesError ? stores.length > 0
        ? <p className="muted" role="status">تعرض هذه الصفحة حتى {storePageSize} متجرًا{appliedStoreSearch ? ` مطابقًا للبحث «${appliedStoreSearch}»` : " من السجل"}. قد توجد نتائج في صفحات أخرى.</p>
        : <p className="muted" role="status">لا توجد متاجر مطابقة. جرّب اسمًا أقصر أو امسح البحث.</p> : null}
      <label className="field-label" htmlFor="store-catalog-import-store-select">المتجر المستهدف<select id="store-catalog-import-store-select" value={storeID} onChange={(event) => selectStore(event.target.value)} disabled={Boolean(busy) || storesLoading || Boolean(storesError) || stores.length === 0}>
        <option value="">اختر متجرًا من النتائج</option>
        {selectedStore && !stores.some((store) => store.id === selectedStore.id) ? <option value={selectedStore.id}>{selectedStore.name} · المحدد حاليًا</option> : null}
        {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
      </select></label>
      {storeID && selectedStore ? <p className="muted" aria-live="polite">المتجر المحدد: {selectedStore.name}</p> : null}
      {(storeCursorStack.length > 0 || nextStoreCursor) ? <nav className="catalog-import-store-pagination" aria-label="صفحات نتائج المتاجر">
        <button type="button" className="button button-secondary" disabled={storesLoading || Boolean(busy) || storeCursorStack.length === 0} onClick={() => { const previous = [...storeCursorStack]; const cursor = previous.pop() ?? ""; navigateStoreList(appliedStoreSearch, cursor, previous); }}>السابق</button>
        <span>صفحة {storeCursorStack.length + 1}</span>
        <button type="button" className="button button-secondary" disabled={storesLoading || Boolean(busy) || !nextStoreCursor} onClick={() => navigateStoreList(appliedStoreSearch, nextStoreCursor, [...storeCursorStack, storeCursor])}>التالي</button>
      </nav> : null}
    </div>
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
