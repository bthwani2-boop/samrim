"use client";

import type { PartnerManagedStore, PartnerStoreListResponse } from "@bthwani/dsh";
import { publicationStateLabel } from "@bthwani/dsh";
import Link from "next/link";
import { useEffect, useState } from "react";
import { identityFetch } from "../../session/identity-fetch";

function isValidStoreBranchesPage(value: unknown): value is PartnerStoreListResponse {
  if (!value || typeof value !== "object" || !("stores" in value) || !Array.isArray(value.stores)) return false;
  if ("nextCursor" in value && value.nextCursor !== undefined && typeof value.nextCursor !== "string") return false;
  const ids = new Set<string>();
  return value.stores.every((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const store = item as Partial<PartnerManagedStore>;
    if (typeof store.id !== "string" || store.id.trim().length === 0 || store.id.length > 128 ||
        typeof store.name !== "string" || store.name.trim().length === 0 ||
        (store.publicationState !== "unpublished" && store.publicationState !== "published" && store.publicationState !== "hidden") ||
        (store.serviceCityName != null && typeof store.serviceCityName !== "string") ||
        (store.primaryVerticalName != null && typeof store.primaryVerticalName !== "string") ||
        ids.has(store.id)) return false;
    ids.add(store.id);
    return true;
  });
}

function StoreBranchesList({ actorId, currentStoreId }: Readonly<{ actorId: string; currentStoreId: string }>) {
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<ReadonlyArray<string>>([]);
  const [next, setNext] = useState("");
  const [stores, setStores] = useState<PartnerStoreListResponse["stores"]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry is the explicit user refresh generation for this server-owned page.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ limit: "10" });
    if (cursor) params.set("cursor", cursor);
    identityFetch(`/api/partners/roster/${encodeURIComponent(actorId)}/stores?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? "لا تملك صلاحية قراءة متاجر الشريك." : "تعذرت قراءة فروع الشريك.");
        return response.json() as Promise<unknown>;
      }).then((result) => {
        if (controller.signal.aborted) return;
        if (!isValidStoreBranchesPage(result)) throw new Error("استجابة المتاجر غير صالحة.");
        setStores(result.stores);
        setNext(result.nextCursor ?? "");
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setStores([]); setNext("");
          setError(cause instanceof Error ? cause.message : "تعذرت قراءة فروع الشريك.");
        }
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [actorId, cursor, retry]);

  return <section className="store-profile-card" aria-label="متاجر الشريك">
    <header className="store-profile-card-header"><h3>المتاجر والفروع المرتبطة بالشريك</h3></header>
    {loading ? <p className="store-profile-muted" role="status">جارٍ قراءة متاجر الشريك…</p> : null}
    {error ? <div role="alert" className="store-profile-offer-error">{error}<button className="button button-secondary" type="button" onClick={() => setRetry((n) => n + 1)}>إعادة المحاولة</button></div> : null}
    {!loading && !error && stores.length === 0 ? <p className="store-profile-muted">لا توجد متاجر مرتبطة في هذه الصفحة.</p> : null}
    {!loading && !error ? <div className="store-profile-branch-list">{stores.map((store) => <div key={store.id} className="store-profile-branch" data-current={store.id === currentStoreId}>
      <div><Link href={`/partners/stores?inspect=${encodeURIComponent(store.id)}`} title={`فتح ملف ${store.name}`}><strong>{store.name}</strong></Link><small>{[store.serviceCityName, store.primaryVerticalName].filter(Boolean).join(" · ")}{store.id === currentStoreId ? " · المتجر الحالي" : ""}</small></div>
      <span>{publicationStateLabel(store.publicationState)}</span>
    </div>)}</div> : null}
    {history.length || next ? <nav className="store-offers-pagination" aria-label="صفحات متاجر الشريك">
      <button type="button" className="button button-secondary" disabled={loading || !history.length} onClick={() => { setCursor(history.at(-1) ?? ""); setHistory((items) => items.slice(0,-1)); }}>السابق</button>
      <button type="button" className="button button-secondary" disabled={loading || Boolean(error) || !next} onClick={() => { setHistory((items) => [...items,cursor]); setCursor(next); }}>التالي</button>
    </nav> : null}
  </section>;
}

export function StoreBranchesPreview({ actorId, currentStoreId }: Readonly<{ actorId: string; currentStoreId: string }>) {
  return <StoreBranchesList key={JSON.stringify([actorId, currentStoreId])} actorId={actorId} currentStoreId={currentStoreId} />;
}
