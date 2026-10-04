"use client";

import type { CatalogCategoryListResponse, CommerceVertical } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { CatalogCategoryRegistry } from "./catalog-category-registry";
import { CatalogCommercialStoreTypeRegistry } from "./catalog-commercial-store-type-registry";
import { CatalogVerticalRegistry } from "./catalog-vertical-registry";

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body?.error?.message || "تعذر قراءة سجل الفئات.");
  return body as T;
}

export function CatalogTaxonomyWorkspace() {
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [rootCategoryImages, setRootCategoryImages] = useState<Readonly<Record<string, string>>>({});
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
      const shared = body.verticals.filter((item) => item.active);
      const requestedVerticalId = new URL(window.location.href).searchParams.get("verticalId") ?? "";
      const requestedCategoryId = new URL(window.location.href).searchParams.get("categoryId") ?? "";
      setCategoryId((current) => current || requestedCategoryId);
      setVerticalId((current) => {
        const preferredId = current || requestedVerticalId;
        return shared.some((item) => item.id === preferredId) ? preferredId : shared.find((item) => item.active)?.id ?? "";
      });
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "تعذر قراءة الفئات.");
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
    } catch (error_) {
      if (requestId === categoryLoadSequence.current) setError(error_ instanceof Error ? error_.message : "تعذر قراءة الفئات.");
    } finally {
      if (!silent && requestId === categoryLoadSequence.current) setLoadingCategories(false);
    }
  }, []);

  const loadRootCategoryImages = useCallback(async (items: ReadonlyArray<CommerceVertical>) => {
    const shared = items.filter((item) => item.active);
    const images = await Promise.all(shared.map(async (vertical) => {
      const params = new URLSearchParams({ verticalId: vertical.id, status: "all", sort: "name_asc", limit: "100" });
      const response = await fetch(`/api/catalog/categories?${params.toString()}`, { cache: "no-store" });
      const body = await readResponse<CatalogCategoryListResponse>(response);
      const root = body.categories.find((category) => !category.parentCategoryId && category.active && category.imageUri);
      return [vertical.id, root?.imageUri?.trim() ?? ""] as const;
    }));
    setRootCategoryImages(Object.fromEntries(images.filter(([, uri]) => uri)));
  }, []);

  useEffect(() => { void loadVerticals(); }, [loadVerticals]);
  useEffect(() => { if (verticals.length) void loadRootCategoryImages(verticals).catch((error_) => setError(error_ instanceof Error ? error_.message : "تعذر تحميل صور المجالات.")); }, [verticals, loadRootCategoryImages]);
  useEffect(() => { void loadCategories(verticalId); }, [verticalId, loadCategories]);

  const sharedVerticals = verticals.filter((item) => item.active);
  const chooseVertical = useCallback((nextVerticalId: string) => {
    categoryLoadSequence.current += 1;
    setVerticalId(nextVerticalId);
    setCategories([]);
    setNextCursor("");
    setCategoryId("");
    setError("");
  }, []);

  return <section className="catalog-taxonomy-workspace" aria-label="إدارة الفئات">
    {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" disabled={loadingVerticals || loadingCategories} onClick={() => { void loadVerticals(); if (verticalId) void loadCategories(verticalId); }}>إعادة قراءة السجل</button></p> : null}
    <CatalogCategoryRegistry key={verticalId} verticals={sharedVerticals} verticalId={verticalId} onVerticalChange={chooseVertical} categories={categories} nextCursor={nextCursor} onFilter={(query, status, sort, cursor, append) => loadCategories(verticalId, query, status, sort, cursor, append)} categoryId={categoryId} onCategoryChange={setCategoryId} loading={loadingVerticals || loadingCategories} onSaved={() => loadCategories(verticalId, "", "all", "name_asc", "", false, true)} management={<details className="catalog-vertical-settings">
      <summary><span>إدارة المجالات التجارية</span><small>{verticals.length} مجال</small></summary>
      <p className="muted">إعدادات مصادر شجرة الفئات ومسار المنتجات.</p>
      <CatalogVerticalRegistry verticals={verticals} rootCategoryImages={rootCategoryImages} selectedVerticalId={verticalId} onSelectVertical={chooseVertical} onSaved={loadVerticals} />
      <CatalogCommercialStoreTypeRegistry verticals={verticals} verticalId={verticalId} />
    </details>} />
  </section>;
}
