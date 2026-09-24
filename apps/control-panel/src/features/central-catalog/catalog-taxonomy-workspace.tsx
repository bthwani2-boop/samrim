"use client";

import type { CatalogCategory, CommerceVertical } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";
import { CatalogAttributePolicyWorkspace } from "./catalog-attribute-policy-workspace";
import { CatalogCategoryRegistry } from "./catalog-category-registry";
import { CatalogVerticalRegistry } from "./catalog-vertical-registry";

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body?.error?.message || "تعذر قراءة سجل الفئات.");
  return body as T;
}

export function CatalogTaxonomyWorkspace() {
  const [view, setView] = useState<"verticals" | "categories" | "attributes" | null>(null);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [verticalId, setVerticalId] = useState("");
  const [categories, setCategories] = useState<ReadonlyArray<CatalogCategory>>([]);
  const [categoryId, setCategoryId] = useState("");
  const [loadingVerticals, setLoadingVerticals] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [error, setError] = useState("");

  const loadVerticals = useCallback(async () => {
    setLoadingVerticals(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/verticals?includeInactive=true", { cache: "no-store" });
      const body = await readResponse<{ verticals: ReadonlyArray<CommerceVertical> }>(response);
      setVerticals(body.verticals);
      const shared = body.verticals.filter((item) => item.catalogModel === "SHARED_CATALOG");
      setVerticalId((current) => current && shared.some((item) => item.id === current) ? current : "");
    } catch (value) {
      setError(value instanceof Error ? value.message : "تعذر قراءة الفئات.");
    } finally {
      setLoadingVerticals(false);
    }
  }, []);

  const loadCategories = useCallback(async (nextVerticalId: string) => {
    if (!nextVerticalId) {
      setCategories([]);
      setCategoryId("");
      setLoadingCategories(false);
      return;
    }
    setLoadingCategories(true);
    setError("");
    try {
      const response = await fetch(`/api/catalog/categories?verticalId=${encodeURIComponent(nextVerticalId)}&includeInactive=true`, { cache: "no-store" });
      const body = await readResponse<{ categories: ReadonlyArray<CatalogCategory> }>(response);
      setCategories(body.categories);
      setCategoryId((current) => current && body.categories.some((item) => item.id === current) ? current : "");
    } catch (value) {
      setError(value instanceof Error ? value.message : "تعذر قراءة الفئات.");
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  useEffect(() => { void loadVerticals(); }, [loadVerticals]);
  useEffect(() => { void loadCategories(verticalId); }, [verticalId, loadCategories]);
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const selected = params.get("view");
    setView(selected === "verticals" || selected === "attributes" ? selected : "categories");
    setVerticalId(params.get("verticalId") ?? "");
    setCategoryId(params.get("categoryId") ?? "");
  }, []);

  const sharedVerticals = verticals.filter((item) => item.catalogModel === "SHARED_CATALOG");
  const chooseVertical = useCallback((nextVerticalId: string) => {
    setVerticalId(nextVerticalId);
    setCategoryId("");
  }, []);

  return <section className="catalog-taxonomy-workspace" aria-labelledby="catalog-taxonomy-workspace-title">
    <div className="access-card-heading">
      <span className="step-chip">DSH · سجل الفئات</span>
      <p className="eyebrow">إدارة موحدة</p>
      <h2 id="catalog-taxonomy-workspace-title">إدارة الفئات وخصائصها</h2>
      <p className="muted">أنشئ الفئات العليا، ثم نظّم الشجرة واربط تعريفات الخصائص وقواعدها من مساحة تحرير واحدة.</p>
    </div>
    <nav className="catalog-taxonomy-tabs workspace-route-tabs" aria-label="مسارات إدارة الفئات">
      <a className={`workspace-route-tab${view === "verticals" ? " is-active" : ""}`} href="/catalog/categories?view=verticals" aria-current={view === "verticals" ? "page" : undefined}>الفئات الرئيسية</a>
      <a className={`workspace-route-tab${view === "categories" ? " is-active" : ""}`} href={`/catalog/categories?view=categories${verticalId ? `&verticalId=${encodeURIComponent(verticalId)}` : ""}`} aria-current={view === "categories" ? "page" : undefined}>شجرة الفئات</a>
      <a className={`workspace-route-tab${view === "attributes" ? " is-active" : ""}`} href={`/catalog/categories?view=attributes${verticalId ? `&verticalId=${encodeURIComponent(verticalId)}` : ""}${categoryId ? `&categoryId=${encodeURIComponent(categoryId)}` : ""}`} aria-current={view === "attributes" ? "page" : undefined}>خصائص الفئات</a>
    </nav>
    {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" disabled={loadingVerticals || loadingCategories} onClick={() => { void loadVerticals(); if (verticalId) void loadCategories(verticalId); }}>إعادة قراءة السجل</button></p> : null}
    {view === "verticals" ? <CatalogVerticalRegistry verticals={verticals} onSaved={loadVerticals} /> : null}
    {view === "categories" ? <CatalogCategoryRegistry verticals={sharedVerticals} verticalId={verticalId} onVerticalChange={chooseVertical} categories={categories} categoryId={categoryId} onCategoryChange={setCategoryId} loading={loadingVerticals || loadingCategories} onSaved={() => loadCategories(verticalId)} /> : null}
    {view === "attributes" ? <CatalogAttributePolicyWorkspace verticalId={verticalId} categoryId={categoryId} /> : null}
  </section>;
}
