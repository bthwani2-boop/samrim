"use client";

import type { CatalogStoreOffer, CatalogStoreOfferListResponse } from "@bthwani/dsh";
import { useEffect, useState } from "react";

export function StoreOffersPreview({ storeId }: Readonly<{ storeId: string }>) {
  const [offers, setOffers] = useState<ReadonlyArray<CatalogStoreOffer>>([]);
  const [cursor, setCursor] = useState("");
  const [back, setBack] = useState<ReadonlyArray<string>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry is the explicit user refresh generation for this server-owned page.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/stores/${encodeURIComponent(storeId)}/offers?limit=8&cursor=${encodeURIComponent(cursor)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? "لا تملك صلاحية قراءة عروض المتجر." : "تعذرت قراءة عروض المتجر من مصدرها.");
        return response.json() as Promise<CatalogStoreOfferListResponse>;
      }).then((result) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.offers) || (result.nextCursor !== undefined && typeof result.nextCursor !== "string") || result.offers.some((offer) => offer.storeId !== storeId)) {
          throw new Error("استجابة منتجات المتجر غير صالحة.");
        }
        setOffers(result.offers);
        setNextCursor(result.nextCursor ?? "");
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "تعذرت قراءة عروض المتجر.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [storeId, cursor, retry]);

  return <div className="store-offers-preview">
    {loading ? <p role="status" className="store-profile-muted">جارٍ قراءة منتجات المتجر…</p> : null}
    {error ? <div className="store-profile-offer-error" role="alert">{error}<button type="button" className="button button-secondary" onClick={() => setRetry((value) => value + 1)}>إعادة القراءة</button></div> : null}
    {!loading && !error && offers.length === 0 ? <div className="store-profile-empty"><span aria-hidden="true">▧</span><p>لا توجد عروض مسجلة لهذا المتجر في هذه الصفحة.</p></div> : null}
    {!loading && !error && offers.length ? <div className="store-offers-grid">
      {offers.map((offer) => <article className="store-offer-item" key={offer.offerId}>
        {offer.media[0]?.uri ? <img src={offer.media[0].uri} alt={offer.productName} loading="lazy" /> : <div className="store-offer-item-placeholder" role="img" aria-label="بدون صورة منتج">▧</div>}
        <div className="store-offer-item-body">
          <span className="store-offer-availability" data-ready={offer.availability && offer.publicationState === "published"}>{offer.availability && offer.publicationState === "published" ? "متاح" : offer.publicationState === "published" ? "غير متاح" : "غير منشور"}</span>
          <strong title={offer.productName}>{offer.productName}</strong>
          {offer.variantTitle ? <small>{offer.variantTitle}</small> : null}
          <bdi dir="rtl">{new Intl.NumberFormat("ar-YE").format(offer.priceMinor)} ر.ي</bdi>
        </div>
      </article>)}
    </div> : null}
    {((!loading && !error && nextCursor) || back.length > 0) ? <nav className="store-offers-pagination" aria-label="صفحات عروض المتجر">
      <button type="button" className="button button-secondary" disabled={loading || back.length === 0} onClick={() => { setCursor(back[back.length - 1] ?? ""); setBack((all) => all.slice(0,-1)); }}>السابق</button>
      <button type="button" className="button button-secondary" disabled={loading || !nextCursor} onClick={() => { setBack((all) => [...all,cursor]); setCursor(nextCursor); }}>التالي</button>
    </nav> : null}
  </div>;
}
