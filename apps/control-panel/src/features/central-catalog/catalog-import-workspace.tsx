"use client";

import type { CatalogImportItem, CatalogImportPreviewResponse, CatalogImportRow, CatalogImportRunResponse } from "@bthwani/dsh";
import { useState } from "react";

type ImportResult = CatalogImportPreviewResponse | CatalogImportRunResponse;
type ParsedSource = { rows: ReadonlyArray<CatalogImportRow>; errors: ReadonlyArray<string> };

const classificationLabels: Record<CatalogImportItem["classification"], string> = {
  READY: "جاهز",
  DUPLICATE_INPUT: "مكرر في الملف",
  DUPLICATE_EXISTING: "مكرر في السجل",
  CONFLICT_EXISTING: "تعارض مع السجل",
  INVALID_INPUT: "بيانات غير صالحة",
  IMPORTED: "تم الاستيراد",
  REPLAYED: "إعادة تشغيل آمنة",
  FAILED: "فشل",
};

function responseError(value: unknown): string {
  if (!value || typeof value !== "object") return "تعذر تنفيذ العملية.";
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "تعذر تنفيذ العملية.";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : "تعذر تنفيذ العملية.";
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body));
  return body as T;
}

function field(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === "string" ? record[key].trim() : "";
}

function recordsFromCsv(text: string): ReadonlyArray<{ line: number; values: string[] }> {
  const records: { line: number; values: string[] }[] = [];
  let values: string[] = [];
  let value = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      values.push(value);
      value = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      values.push(value);
      value = "";
      if (values.some((item) => item.trim())) records.push({ line: recordLine, values });
      values = [];
      line += 1;
      recordLine = line;
      continue;
    }
    if (character === "\n") line += 1;
    value += character;
  }
  if (quoted) throw new Error("الملف يحتوي على قيمة CSV غير مغلقة.");
  if (value.length || values.length) {
    values.push(value);
    if (values.some((item) => item.trim())) records.push({ line: recordLine, values });
  }
  return records;
}

function normalizeRow(record: Record<string, unknown>, line: number): CatalogImportRow {
  const canonicalName = field(record, "canonicalName");
  const verticalId = field(record, "verticalId").toLowerCase();
  const scope = field(record, "scope").toUpperCase();
  const measurementKind = field(record, "measurementKind").toUpperCase();
  const baseUnit = field(record, "baseUnit").toUpperCase();
  const variantTitle = field(record, "variantTitle") || "الافتراضي";
  const storeId = field(record, "storeId");
  const brand = field(record, "brand");
  const identifierType = field(record, "identifierType").toUpperCase();
  const identifierValue = field(record, "identifierValue") || field(record, "barcode");
  const imageUri = field(record, "imageUri") || field(record, "canonicalImageUrl");
  const sourceCategories = Array.isArray(record.categoryIds) ? record.categoryIds : field(record, "categoryIds").split(/[|;]/);
  const categoryIds = [...new Set(sourceCategories.map((item) => String(item).trim()).filter(Boolean))];

  if (!canonicalName || [...canonicalName].length > 160) throw new Error(`السطر ${line}: الاسم القانوني مطلوب وبحد أقصى 160 حرفًا.`);
  if (!/^[a-z0-9][a-z0-9_-]{1,127}$/.test(verticalId)) throw new Error(`السطر ${line}: verticalId يجب أن يكون معرّفًا قانونيًا.`);
  if (!(scope === "SHARED" || scope === "STORE_SCOPED")) throw new Error(`السطر ${line}: scope غير صالح.`);
  if (!(measurementKind === "DISCRETE" || measurementKind === "MEASURED" || measurementKind === "VARIABLE_MEASURE")) throw new Error(`السطر ${line}: measurementKind غير صالح.`);
  if ((measurementKind === "DISCRETE" && baseUnit !== "COUNT") || (measurementKind !== "DISCRETE" && !(baseUnit === "GRAM" || baseUnit === "MILLILITER"))) throw new Error(`السطر ${line}: الوحدة لا تتوافق مع سياسة القياس.`);
  if (!variantTitle || [...variantTitle].length > 160) throw new Error(`السطر ${line}: اسم النسخة مطلوب وبحد أقصى 160 حرفًا.`);
  if (brand && [...brand].length > 160) throw new Error(`السطر ${line}: العلامة تتجاوز 160 حرفًا.`);
  if (!categoryIds.length) throw new Error(`السطر ${line}: categoryIds مطلوب.`);
  if (scope === "STORE_SCOPED" && !storeId) throw new Error(`السطر ${line}: storeId مطلوب للمنتج الخاص بالمتجر.`);
  if (scope === "SHARED" && storeId) throw new Error(`السطر ${line}: storeId غير مسموح للمنتج المشترك.`);
  if (identifierValue && !["GTIN", "EAN", "UPC", "SKU"].includes(identifierType)) throw new Error(`السطر ${line}: identifierType مطلوب عند وجود معرّف.`);
  if (identifierValue && !/^[A-Za-z0-9._-]{1,128}$/.test(identifierValue)) throw new Error(`السطر ${line}: قيمة المعرّف غير صالحة.`);
  if (imageUri) {
    try {
      const parsed = new URL(imageUri);
      if (!(parsed.protocol === "http:" || parsed.protocol === "https:") || !parsed.hostname || parsed.username || parsed.password) throw new Error("invalid");
    } catch {
      throw new Error(`السطر ${line}: رابط الصورة يجب أن يكون http(s) بلا بيانات اعتماد.`);
    }
  }

  const stableKey = identifierValue
    ? `identifier:${identifierType}:${identifierValue}`
    : `facts:${verticalId}:${scope}:${canonicalName}:${variantTitle}:${measurementKind}:${baseUnit}`;
  return {
    rowNumber: line,
    stableKey,
    verticalId,
    scope: scope as CatalogImportRow["scope"],
    ...(storeId ? { storeId } : {}),
    canonicalName,
    ...(brand ? { brand } : {}),
    variantTitle,
    measurementKind: measurementKind as CatalogImportRow["measurementKind"],
    baseUnit: baseUnit as CatalogImportRow["baseUnit"],
    categoryIds,
    ...(identifierValue ? { identifierType: identifierType as NonNullable<CatalogImportRow["identifierType"]>, identifierValue } : {}),
    ...(imageUri ? { imageUri } : {}),
  };
}

function parseSource(text: string, fileName: string): ParsedSource {
  const errors: string[] = [];
  const rows: CatalogImportRow[] = [];
  if (fileName.toLowerCase().endsWith(".csv")) {
    const records = recordsFromCsv(text);
    if (records.length < 2) return { rows, errors: ["ملف CSV يحتاج صف عناوين وصفًا واحدًا على الأقل."] };
    const firstRecord = records[0];
    if (!firstRecord) return { rows, errors: ["ملف CSV يحتاج صف عناوين وصفًا واحدًا على الأقل."] };
    const header = firstRecord.values.map((value) => value.trim());
    for (const record of records.slice(1)) {
      try {
        rows.push(normalizeRow(Object.fromEntries(header.map((key, index) => [key, record.values[index] ?? ""])), record.line));
      } catch (cause) {
        errors.push(cause instanceof Error ? cause.message : `السطر ${record.line}: تعذر قراءة الصف.`);
      }
    }
    return { rows, errors };
  }

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("كل سطر JSONL يجب أن يكون كائنًا.");
      rows.push(normalizeRow(parsed as Record<string, unknown>, index + 1));
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : `السطر ${index + 1}: تعذر قراءة الصف.`);
    }
  }
  return { rows, errors };
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function classificationLabel(item: CatalogImportItem): string {
  return classificationLabels[item.classification];
}

export function CatalogImportWorkspace() {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ReadonlyArray<CatalogImportRow>>([]);
  const [parseErrors, setParseErrors] = useState<ReadonlyArray<string>>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | "" | "read">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sourceHash, setSourceHash] = useState("");

  async function selectFile(file: File | undefined) {
    setSourceFile(file ?? null);
    setResult(null);
    setError("");
    setNotice("");
    setParseErrors([]);
    setRows([]);
    setSourceHash("");
    if (!file) return;
    try {
      const [text, hash] = await Promise.all([file.text(), sha256(file)]);
      const parsed = parseSource(text, file.name);
      setRows(parsed.rows);
      setParseErrors(parsed.errors);
      setSourceHash(hash);
      if (!parsed.rows.length) setError("لم ينتج الملف أي صف صالح للمعاينة.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر قراءة الملف.");
    }
  }

  async function preview() {
    if (!sourceFile || !rows.length || busy) return;
    if (rows.length > 1000) {
      setError("الحد الأقصى للمعاينة هو 1000 صف.");
      return;
    }
    setBusy("preview");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/catalog/imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ runId: crypto.randomUUID(), sourceSha256: sourceHash, rows }),
      });
      setResult(await readJson<ImportResult>(response));
      setNotice("تم إنشاء معاينة قانونية من الملف. لم تُكتب أي منتجات بعد.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء معاينة الاستيراد.");
    } finally {
      setBusy("");
    }
  }

  async function readRun(runId: string) {
    setBusy("read");
    try {
      const response = await fetch(`/api/catalog/imports/${encodeURIComponent(runId)}`, { cache: "no-store" });
      setResult(await readJson<ImportResult>(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إعادة قراءة نتيجة الاستيراد.");
    } finally {
      setBusy("");
    }
  }

  async function commit() {
    if (!result || result.run.state !== "previewed" || busy) return;
    setBusy("commit");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/catalog/imports/${encodeURIComponent(result.run.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      });
      const committed = await readJson<ImportResult>(response);
      setResult(committed);
      setNotice("تم الالتزام الصريح، ثم ستُعاد قراءة النتيجة القانونية من المصدر.");
      await readRun(committed.run.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر الالتزام بالاستيراد.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="access-card" aria-labelledby="catalog-import-title" data-testid="catalog-import-workspace">
      <div className="access-card-heading">
        <span className="step-chip">مصدر ملف</span>
        <p className="eyebrow">CSV أو JSONL</p>
        <h2 id="catalog-import-title">استيراد آمن: معاينة ثم التزام</h2>
        <p className="muted">استخدم نفس مصدر الملف المدعوم بأداة الاستيراد الحالية. لا تُقبل نصوص JSON ملصقة؛ تُقرأ الصفوف من ملف، وتُصنّف قبل أي كتابة.</p>
      </div>
      <label className="field-label" htmlFor="catalog-import-file">ملف المنتجات<input id="catalog-import-file" type="file" accept=".csv,.jsonl,.ndjson,text/csv,application/jsonl" disabled={Boolean(busy)} onChange={(event) => void selectFile(event.target.files?.[0])} /></label>
      <p className="muted">CSV يحتاج عناوين الحقول القانونية، وJSONL يحتاج كائنًا واحدًا في كل سطر. الحقول المستخدمة هي نفسها في أداة `import-catalog-products`.</p>
      {sourceFile ? <div className="managed-status managed-status-info"><strong>{sourceFile.name}</strong><p>الصفوف الصالحة: {rows.length} · الصفوف المرفوضة محليًا: {parseErrors.length}</p><code dir="ltr">SHA-256: {sourceHash}</code></div> : null}
      {parseErrors.length ? <div className="managed-status managed-status-warning" role="alert"><strong>صفوف تحتاج تصحيحًا قبل المعاينة</strong><ul>{parseErrors.map((message) => <li key={message}>{message}</li>)}</ul></div> : null}
      <button type="button" className="button button-primary" disabled={Boolean(busy) || !rows.length} onClick={() => void preview()}>{busy === "preview" ? "جارٍ إنشاء المعاينة…" : "معاينة الملف"}</button>
      {result ? (
        <div className="managed-status managed-status-info" role="status">
          <strong>حالة التشغيل: {result.run.state === "previewed" ? "معاينة جاهزة" : result.run.state === "committed" ? "تم الالتزام" : "مرفوض"}</strong>
          <p>المقبول: {result.run.acceptedCount} · التعارضات: {result.run.conflictCount} · العناصر المصنفة: {result.items.length}</p>
          <table>
            <caption>تصنيف صفوف الاستيراد</caption>
            <thead><tr><th scope="col">السطر</th><th scope="col">التصنيف</th><th scope="col">الحالة</th></tr></thead>
            <tbody>{result.items.map((item) => <tr key={`${item.rowNumber}-${item.stableKey}`}><td>{item.rowNumber}</td><td>{classificationLabel(item)}</td><td>{item.errorMessage || (item.committed ? "تمت الكتابة" : "بانتظار الالتزام")}</td></tr>)}</tbody>
          </table>
          {result.run.state === "previewed" ? <button type="button" className="button button-secondary" disabled={Boolean(busy) || result.run.conflictCount > 0} onClick={() => void commit()}>{busy === "commit" ? "جارٍ الالتزام…" : "الالتزام بعد المراجعة"}</button> : null}
          {result.run.state === "committed" ? <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => void readRun(result.run.id)}>{busy === "read" ? "جارٍ إعادة القراءة…" : "إعادة قراءة النتيجة"}</button> : null}
        </div>
      ) : null}
      {notice ? <p className="success-inline" role="status">{notice}</p> : null}
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
    </section>
  );
}
