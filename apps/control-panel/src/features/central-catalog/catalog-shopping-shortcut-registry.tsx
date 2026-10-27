"use client";

import type { CatalogCategoryListItem, CommercialStoreType, ShoppingShortcut } from "@bthwani/dsh";
import { Button, Checkbox, Form, Input, InputNumber } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { retainSelectedCategoryOptions } from "./catalog-shopping-shortcut-selection";

type Option = Readonly<{ id: string; nameAr: string; active: boolean; pathAr: string }>;
type FormValues = Readonly<{ titleAr: string; ordinal: number; active: boolean; reason: string }>;
type Options = Readonly<{ types: ReadonlyArray<CommercialStoreType>; categories: ReadonlyArray<Option>; selectedCategories: ReadonlyArray<Option>; nextCursor?: string }>;
type CategoryDetailResponse = Readonly<{ category: CatalogCategoryListItem }>;
type CategoryResponse = Readonly<{ categories: ReadonlyArray<CatalogCategoryListItem>; nextCursor?: string }>;

function errorMessage(input: unknown): string {
  if (input && typeof input === "object" && "error" in input) {
    const error = (input as { error?: { message?: string } }).error;
    if (typeof error?.message === "string" && error.message.trim()) return error.message;
  }
  return "تعذر تنفيذ العملية. أعد المحاولة.";
}

function toOption(item: CatalogCategoryListItem): Option {
  return { id: item.id, nameAr: item.nameAr, active: item.active, pathAr: item.pathAr };
}

async function readCategoryPage(verticalId: string, search: string, cursor = ""): Promise<CategoryResponse> {
  const query = new URLSearchParams({ verticalId, status: "all", sort: "name_asc", limit: "50" });
  if (search.trim()) query.set("query", search.trim());
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/api/catalog/categories?${query}`, { cache: "no-store" });
  const body = await response.json().catch(() => null) as CategoryResponse | { error?: unknown } | null;
  if (!response.ok || !body || !("categories" in body)) throw new Error(errorMessage(body));
  return body;
}

async function readOptions(verticalId: string, selectedCategoryIds: ReadonlyArray<string>): Promise<Options> {
  const [typesResponse, categoryPage, selectedResponses] = await Promise.all([
    fetch(`/api/catalog/commercial-store-types?${new URLSearchParams({ verticalId, includeInactive: "true" })}`, { cache: "no-store" }),
    readCategoryPage(verticalId, ""),
    Promise.all(selectedCategoryIds.map(async (id) => {
      const response = await fetch(`/api/catalog/categories/${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as CategoryDetailResponse | { error?: unknown } | null;
      if (!response.ok || !body || !("category" in body)) throw new Error(errorMessage(body));
      return body.category;
    })),
  ]);
  const typesBody = await typesResponse.json().catch(() => null) as { storeTypes?: ReadonlyArray<CommercialStoreType>; error?: unknown } | null;
  if (!typesResponse.ok || !typesBody?.storeTypes) throw new Error(errorMessage(typesBody));
  return { types: typesBody.storeTypes, categories: categoryPage.categories.map(toOption), selectedCategories: selectedResponses.map(toOption), ...(categoryPage.nextCursor ? { nextCursor: categoryPage.nextCursor } : {}) };
}

export function CatalogShoppingShortcutEditor({ verticalId, initialShortcut, onSaved, onClose }: Readonly<{
  verticalId: string;
  initialShortcut?: ShoppingShortcut | undefined;
  onSaved: (saved: ShoppingShortcut) => Promise<void>;
  onClose: () => void;
}>) {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("catalog") === true;
  const [form] = Form.useForm<FormValues>();
  const [types, setTypes] = useState<ReadonlyArray<CommercialStoreType>>([]);
  const [categories, setCategories] = useState<ReadonlyArray<Option>>([]);
  const [selectedCategories, setSelectedCategories] = useState<ReadonlyArray<Option>>([]);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [categoryCursor, setCategoryCursor] = useState("");
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const [typeIds, setTypeIds] = useState<ReadonlyArray<string>>(initialShortcut?.storeTypeIds ?? []);
  const [categoryIds, setCategoryIds] = useState<ReadonlyArray<string>>(initialShortcut?.categoryIds ?? []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const requestSequence = useRef(0);
  const categoryRequestSequence = useRef(0);
  const categoryRetry = useRef<Readonly<{ query: string; cursor: string; append: boolean }> | null>(null);
  const lifeSequence = useRef(0);
  const lifeScope = useRef(verticalId);
  const idempotency = useRef<Readonly<{ fingerprint: string; key: string }> | null>(null);

  useEffect(() => {
    if (lifeScope.current !== verticalId) {
      lifeScope.current = verticalId;
      lifeSequence.current += 1;
    }
  }, [verticalId]);

  useEffect(() => () => { lifeSequence.current += 1; }, []);

  const loadOptions = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const options = await readOptions(verticalId, initialShortcut?.categoryIds ?? []);
      if (request !== requestSequence.current) return;
      setTypes(options.types);
      setCategories(options.categories);
      setSelectedCategories(options.selectedCategories);
      setCategoryCursor(options.nextCursor ?? "");
    } catch (cause: unknown) {
      if (request === requestSequence.current) setLoadError(cause instanceof Error ? cause.message : "تعذرت قراءة خيارات الاختصار.");
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, [initialShortcut?.categoryIds, verticalId]);

  useEffect(() => {
    void loadOptions();
    return () => { requestSequence.current += 1; };
  }, [loadOptions]);

  useEffect(() => () => {
    categoryRequestSequence.current += 1;
    categoryRetry.current = null;
  }, []);

  const loadCategoryPage = useCallback(async (search: string, cursor = "", append = false) => {
    const request = ++categoryRequestSequence.current;
    categoryRetry.current = { query: search, cursor, append };
    setCategoryLoading(true);
    setCategoryError("");
    try {
      const page = await readCategoryPage(verticalId, search, cursor);
      if (request !== categoryRequestSequence.current) return;
      const options = page.categories.map(toOption);
      setCategories((current) => append ? [...new Map([...current, ...options].map((item) => [item.id, item])).values()] : options);
      setCategoryCursor(page.nextCursor ?? "");
      setSelectedCategories((current) => retainSelectedCategoryOptions(current, options, categoryIds));
    } catch (cause: unknown) {
      if (request === categoryRequestSequence.current) setCategoryError(cause instanceof Error ? cause.message : "\u062a\u0639\u0630\u0631 \u0628\u062d\u062b \u0627\u0644\u0641\u0626\u0627\u062a. \u0623\u0639\u062f \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629.");
    } finally {
      if (request === categoryRequestSequence.current) setCategoryLoading(false);
    }
  }, [categoryIds, verticalId]);

  async function save(values: FormValues) {
    if (!canEdit || !verticalId || busy) return;
    const cleanTitle = values.titleAr.trim();
    const reason = values.reason.trim();
    const targetCount = typeIds.length + categoryIds.length;
    if (cleanTitle.length < 2 || cleanTitle.length > 160 || !Number.isInteger(values.ordinal) || values.ordinal < 0 || values.ordinal > 9999 ||
        targetCount === 0 || targetCount > 25 || reason.length < 5 || reason.length > 500) {
      setSaveError("تحقق من الاسم والترتيب والمصادر وسبب التغيير قبل الحفظ.");
      return;
    }
    setSaveError("");
    setSelectionError("");
    setBusy(true);
    const body = {
      verticalId,
      titleAr: cleanTitle,
      ordinal: values.ordinal,
      active: values.active,
      expectedVersion: initialShortcut?.version ?? 0,
      storeTypeIds: [...typeIds],
      categoryIds: [...categoryIds],
      reason,
    };
    const fingerprint = JSON.stringify([initialShortcut?.id ?? "", body]);
    if (idempotency.current?.fingerprint !== fingerprint) {
      idempotency.current = { fingerprint, key: crypto.randomUUID() };
    }
    const life = lifeSequence.current;
    try {
      const response = await fetch(initialShortcut
        ? `/api/catalog/shopping-shortcuts/${encodeURIComponent(initialShortcut.id)}`
        : "/api/catalog/shopping-shortcuts", {
        method: initialShortcut ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotency.current.key },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { shortcut?: ShoppingShortcut; error?: unknown } | null;
      if (!response.ok || !payload?.shortcut) throw new Error(errorMessage(payload));
      if (life !== lifeSequence.current) return;
      await onSaved(payload.shortcut);
      if (life === lifeSequence.current) onClose();
    } catch (cause: unknown) {
      if (life === lifeSequence.current) setSaveError(cause instanceof Error ? cause.message : "تعذر حفظ اختصار التسوق. احتفظنا بالمسودة؛ أعد المحاولة.");
    } finally {
      if (life === lifeSequence.current) setBusy(false);
    }
  }

  function changeTargets(kind: "type" | "category", selected: ReadonlyArray<string>) {
    const currentCount = typeIds.length + categoryIds.length;
    const nextCount = selected.length + (kind === "type" ? categoryIds.length : typeIds.length);
    if (nextCount > 25 && nextCount > currentCount) {
      setSelectionError("يمكن اختيار 25 نوعًا وفئة كحد أقصى.");
      return;
    }
    setSelectionError("");
    if (kind === "type") setTypeIds(selected);
    else {
      setCategoryIds(selected);
      setSelectedCategories((current) => retainSelectedCategoryOptions(current, categories, selected));
    }
  }

  const selectedTargets = typeIds.length + categoryIds.length;
  const categoryChoices = [...new Map([...selectedCategories, ...categories].map((item) => [item.id, item])).values()];
  return <section className="catalog-taxonomy-section" aria-label="محرر اختصار التسوق">
    {loading ? <p role="status">جارٍ قراءة الأنواع والفئات…</p> : null}
    {loadError ? <div>
      <p className="identity-error" role="alert">{loadError}</p>
      {!busy ? <Button type="link" onClick={() => void loadOptions()}>إعادة المحاولة</Button> : null}
      <Button disabled={busy} onClick={onClose}>إلغاء</Button>
    </div> : null}
    <Form form={form} hidden={loading || Boolean(loadError)} layout="vertical" className="access-form"
      initialValues={initialShortcut
        ? { titleAr: initialShortcut.titleAr, ordinal: initialShortcut.ordinal, active: initialShortcut.active, reason: "" }
        : { titleAr: "", ordinal: 0, active: true, reason: "" }}
      onFinish={(values: FormValues) => void save(values)}>
      <Form.Item label="اسم الاختصار الظاهر للعميل" name="titleAr" rules={[
        { required: true, whitespace: true, message: "أدخل اسم الاختصار بالعربية." },
        { min: 2, max: 160, whitespace: true, message: "يجب أن يتراوح الاسم بين حرفين و160 حرفًا." },
      ]}>
        <Input autoComplete="off" maxLength={160} disabled={busy || !canEdit} />
      </Form.Item>
      <Form.Item label="ترتيب الظهور" name="ordinal" rules={[
        { required: true, type: "integer", min: 0, max: 9999, message: "أدخل ترتيبًا صحيحًا من 0 إلى 9999." },
      ]}>
        <InputNumber min={0} max={9999} precision={0} disabled={busy || !canEdit} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item name="active" valuePropName="checked">
        <Checkbox disabled={busy || !canEdit}>تفعيل الاختصار</Checkbox>
      </Form.Item>
      <Form.Item label={`أنواع المتاجر المناسبة (${typeIds.length} محدد)`}>
        <details open>
          <summary>اختيار أنواع المتاجر</summary>
          <Checkbox.Group value={[...typeIds]} disabled={busy || !canEdit} options={types
            .filter((item) => item.active || typeIds.includes(item.id))
            .map((item) => ({
              label: `${item.nameAr}${item.active ? "" : " (غير نشط)"}`,
              value: item.id,
              disabled: !item.active && !typeIds.includes(item.id),
            }))}
            onChange={(values) => changeTargets("type", values.map(String))} />
        </details>
      </Form.Item>
      <Form.Item label={`فئات المنتجات المناسبة (${categoryIds.length} محددة)`}>
        <details>
          <summary>اختيار فئات المنتجات</summary>
          <Input.Search aria-label={"\u0628\u062d\u062b \u0641\u064a \u0627\u0644\u0641\u0626\u0627\u062a"} value={categoryQuery} onChange={(event) => { setCategoryQuery(event.target.value); setCategoryCursor(""); }} onSearch={(value) => void loadCategoryPage(value)} enterButton={"\u0628\u062d\u062b"} disabled={busy || !canEdit || categoryLoading} />
          {categoryError ? <p role="alert" className="identity-error">{categoryError} <Button type="link" disabled={categoryLoading} onClick={() => { const retry = categoryRetry.current; if (retry) void loadCategoryPage(retry.query, retry.cursor, retry.append); }}>{"\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629"}</Button></p> : null}
          <Checkbox.Group value={[...categoryIds]} disabled={busy || !canEdit || categoryLoading} options={categoryChoices
            .filter((item) => item.active || categoryIds.includes(item.id))
            .map((item) => ({
              label: `${item.pathAr || item.nameAr}${item.active ? "" : " (غير نشطة)"}`,
              value: item.id,
              disabled: !item.active && !categoryIds.includes(item.id),
            }))}
            onChange={(values) => changeTargets("category", values.map(String))} />
          {categoryLoading ? <p role="status">{"\u062c\u0627\u0631\u064d \u0628\u062d\u062b \u0627\u0644\u0641\u0626\u0627\u062a\u2026"}</p> : null}
          {categoryCursor ? <Button type="link" disabled={busy || !canEdit || categoryLoading} onClick={() => void loadCategoryPage(categoryQuery, categoryCursor, true)}>{"\u062a\u062d\u0645\u064a\u0644 \u0645\u0632\u064a\u062f \u0645\u0646 \u0627\u0644\u0641\u0626\u0627\u062a"}</Button> : null}
          {!categoryLoading && !categoryError && categories.length === 0 ? <p role="status">{"\u0644\u0627 \u062a\u0648\u062c\u062f \u0641\u0626\u0627\u062a \u0645\u0637\u0627\u0628\u0642\u0629."}</p> : null}
        </details>
      </Form.Item>
      <p role={selectionError ? "alert" : "status"}>{selectionError || `المجموع: ${selectedTargets} من 25`}</p>
      <Form.Item label="سبب الإضافة أو التعديل" name="reason" rules={[
        { required: true, whitespace: true, min: 5, max: 500, message: "أدخل سببًا واضحًا من 5 إلى 500 حرف." },
      ]}>
        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={500} disabled={busy || !canEdit} />
      </Form.Item>
      {saveError ? <p role="alert" className="identity-error">{saveError}</p> : null}
      <div className="catalog-registry-actions unified-taxonomy-save-actions">
        <Button type="primary" htmlType="submit" loading={busy} disabled={!canEdit || loading}
          onClick={() => { if (selectedTargets === 0) setSelectionError("اختر نوع متجر أو فئة واحدة على الأقل."); }}>
          {busy ? "جارٍ الحفظ…" : "حفظ الاختصار"}
        </Button>
        <Button disabled={busy} onClick={onClose}>إلغاء</Button>
      </div>
    </Form>
  </section>;
}
