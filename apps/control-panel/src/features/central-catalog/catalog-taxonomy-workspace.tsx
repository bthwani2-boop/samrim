"use client";

import type { CatalogCategoryListResponse, CommerceVertical } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { CatalogCategoryRegistry } from "./catalog-category-registry";
import { CatalogCommercialStoreTypeRegistry } from "./catalog-commercial-store-type-registry";
import { CatalogShoppingShortcutRegistry } from "./catalog-shopping-shortcut-registry";
import { CatalogVerticalRegistry } from "./catalog-vertical-registry";

type CatalogTab = "categories" | "types" | "shortcuts" | "verticals";

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body?.error?.message || "تعذّر تحميل بيانات الكتالوج.");
  return body as T;
}

const tabs: ReadonlyArray<Readonly<{ id: CatalogTab; label: string }>> = [
  { id: "categories", label: "فئات المنتجات" },
  { id: "types", label: "أنواع المتاجر" },
  { id: "shortcuts", label: "اختصارات التسوق" },
  { id: "verticals", label: "المجالات" },
];

export function CatalogTaxonomyWorkspace() {
  const [activeTab, setActiveTab] = useState<CatalogTab>("categories");
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [verticalId, setVerticalId] = useState("");
  const [categories, setCategories] = useState<CatalogCategoryListResponse["categories"]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [loadingVerticals, setLoadingVerticals] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [error, setError] = useState("");
  const categoryLoadSequence = useRef(0);

  const loadVerticals = useCallback(async () => {
    setLoadingVerticals(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/verticals?includeInactive=true", { cache: "no-store" });
      const body = await readResponse<{ verticals: ReadonlyArray<CommerceVertical> }>(response);
      setVerticals(body.verticals);
      const requestedVerticalId = new URL(window.location.href).searchParams.get("verticalId") ?? "";
      const requestedCategoryId = new URL(window.location.href).searchParams.get("categoryId") ?? "";
      setCategoryId((current) => current || requestedCategoryId);
      setVerticalId((current) => {
        const preferredId = current || requestedVerticalId;
        return body.verticals.some((item) => item.id === preferredId)
          ? preferredId
          : body.verticals.find((item) => item.active)?.id ?? "";
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر تحميل المجالات.");
    } finally {
      setLoadingVerticals(false);
    }
  }, []);

  const loadCategories = useCallback(async (nextVerticalId: string, query = "", status = "all", sort = "name_asc", cursor = "", append = false, silent = false) => {
    const requestId = ++categoryLoadSequence.current;
    if (!nextVerticalId) {
      setCategories([]);
      setNextCursor("");
      setCategoryId("");
      if (!silent) setLoadingCategories(false);
      return;
    }
    if (!silent) setLoadingCategories(true);
    setError("");
    try {
      const params = new URLSearchParams({ verticalId: nextVerticalId, status, sort, limit: "50" });
      if (query.trim()) params.set("query", query.trim());
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/catalog/categories?${params.toString()}`, { cache: "no-store" });
      const body = await readResponse<CatalogCategoryListResponse>(response);
      if (requestId !== categoryLoadSequence.current) return;
      setCategories((current) => append ? [...current, ...body.categories] : body.categories);
      setNextCursor(body.nextCursor ?? "");
    } catch (cause) {
      if (requestId === categoryLoadSequence.current) setError(cause instanceof Error ? cause.message : "تعذّر تحميل فئات المنتجات.");
    } finally {
      if (!silent && requestId === categoryLoadSequence.current) setLoadingCategories(false);
    }
  }, []);

  useEffect(() => { void loadVerticals(); }, [loadVerticals]);
  useEffect(() => {
    if (activeTab === "categories") void loadCategories(verticalId);
  }, [activeTab, verticalId, loadCategories]);

  const chooseVertical = useCallback((nextVerticalId: string) => {
    categoryLoadSequence.current += 1;
    setVerticalId(nextVerticalId);
    setCategories([]);
    setNextCursor("");
    setCategoryId("");
    setError("");
  }, []);

  return <section className="catalog-taxonomy-workspace" aria-label="إدارة الكتالوج">
    <div className="catalog-taxonomy-toolbar">
      <nav className="catalog-taxonomy-tabs" aria-label="مساحات إدارة الكتالوج">
        {tabs.map((tab) => <button key={tab.id} type="button" className="catalog-taxonomy-tab"
          aria-current={activeTab === tab.id ? "page" : undefined}
          onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
      </nav>
      <label className="catalog-taxonomy-scope" htmlFor="catalog-taxonomy-vertical">
        <span>المجال</span>
        <select id="catalog-taxonomy-vertical" value={verticalId} disabled={loadingVerticals || verticals.length === 0}
          onChange={(event) => chooseVertical(event.target.value)}>
          {verticals.length === 0 ? <option value="">لا توجد مجالات متاحة</option> : null}
          {verticals.map((item) => <option key={item.id} value={item.id}>{item.nameAr}{!item.active ? " — معطّل" : ""}</option>)}
        </select>
      </label>
    </div>
    {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary"
      disabled={loadingVerticals || loadingCategories}
      onClick={() => { void loadVerticals(); if (activeTab === "categories" && verticalId) void loadCategories(verticalId); }}>إعادة المحاولة</button></p> : null}
    {activeTab === "categories" ? <CatalogCategoryRegistry key={verticalId} verticals={verticals} verticalId={verticalId}
      onVerticalChange={chooseVertical} categories={categories} nextCursor={nextCursor}
      onFilter={(query, status, sort, cursor, append) => loadCategories(verticalId, query, status, sort, cursor, append)}
      categoryId={categoryId} onCategoryChange={setCategoryId} loading={loadingVerticals || loadingCategories}
      onSaved={() => loadCategories(verticalId, "", "all", "name_asc", "", false, true)}
      onManageVerticals={() => setActiveTab("verticals")} /> : null}
    {activeTab === "types" && verticalId ? <CatalogCommercialStoreTypeRegistry verticals={verticals} verticalId={verticalId} /> : null}
    {activeTab === "shortcuts" && verticalId ? <CatalogShoppingShortcutRegistry verticalId={verticalId} /> : null}
    {activeTab === "verticals" ? <CatalogVerticalRegistry verticals={verticals} selectedVerticalId={verticalId}
      onSelectVertical={chooseVertical} onSaved={loadVerticals} /> : null}
    {!verticalId && activeTab !== "verticals" ? <p role="status" className="catalog-taxonomy-empty">أنشئ مجالًا أو فعّل أحد المجالات لبدء إدارة الكتالوج.</p> : null}
  </section>;
}
