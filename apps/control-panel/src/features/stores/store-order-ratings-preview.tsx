"use client";

import type { StoreOrderRatingListResponse, StoreOrderRatingSummary } from "@bthwani/dsh";
import { useEffect, useState } from "react";

const PAGE_SIZE = 20;

function dateLabel(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("ar-YE", { timeZone: "Asia/Aden", dateStyle: "medium" });
}

export function StoreOrderRatingsPreview({ storeId }: Readonly<{ storeId: string }>) {
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<ReadonlyArray<string>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [items, setItems] = useState<StoreOrderRatingListResponse["ratings"]>([]);
  const [summary, setSummary] = useState<StoreOrderRatingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    // A retry deliberately starts another Store-scoped read.
    void retry;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setItems([]);
    setSummary(null);
    setNextCursor("");
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    void fetch("/api/stores/" + encodeURIComponent(storeId) + "/ratings?" + params, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("RATINGS_READ_FAILED");
        return await response.json() as StoreOrderRatingListResponse;
      })
      .then(page => {
        if (controller.signal.aborted) return;
        const stats = page.summary;
        if (!Array.isArray(page.ratings) || page.ratings.some(item => item.storeId !== storeId) ||
          !stats || !Number.isSafeInteger(stats.totalRatings) || stats.totalRatings < 0 ||
          !Number.isFinite(stats.averageRating) || stats.averageRating < 0 || stats.averageRating > 5 ||
          [stats.oneStar, stats.twoStars, stats.threeStars, stats.fourStars, stats.fiveStars].some(value => !Number.isSafeInteger(value) || value < 0) ||
          stats.oneStar + stats.twoStars + stats.threeStars + stats.fourStars + stats.fiveStars !== stats.totalRatings) throw new Error("RATINGS_SCOPE_OR_SUMMARY_MISMATCH");
        setItems(page.ratings);
        setSummary(stats);
        setNextCursor(page.nextCursor ?? "");
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("تعذرت قراءة تقييمات الطلبات. تحقق من الصلاحيات أو الاتصال ثم أعد المحاولة.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [storeId, cursor, retry]);

  return <section aria-label="تقييمات طلبات المتجر">
    <p className="store-profile-muted">ملاحظات العملاء بعد اكتمال الطلب، دون إظهار معرّف العميل أو بيانات تواصله المحفوظة. إحصاءات النجوم تشمل جميع تقييمات المتجر ولا تتغير مع ترقيم الصفحات.</p>
    {!loading && !error && summary ? <section className="store-profile-card" aria-label="ملخص جميع تقييمات المتجر">
      <dl className="store-profile-facts">
        <div><dt>متوسط المتجر</dt><dd>{summary.totalRatings ? summary.averageRating.toFixed(1) + " من 5" : "لا توجد تقييمات"}</dd></div>
        <div><dt>إجمالي التقييمات</dt><dd>{summary.totalRatings.toLocaleString("ar-YE")}</dd></div>
        {([5, 4, 3, 2, 1] as const).map(stars => <div key={stars}><dt>{stars} نجوم</dt>
          <dd>{(stars === 5 ? summary.fiveStars : stars === 4 ? summary.fourStars : stars === 3 ? summary.threeStars : stars === 2 ? summary.twoStars : summary.oneStar).toLocaleString("ar-YE")}</dd>
        </div>)}
      </dl>
    </section> : null}
    {loading ? <p role="status">جارٍ قراءة تقييمات المتجر…</p> : null}
    {error ? <p role="alert" className="identity-error">{error} <button type="button" className="button button-quiet" onClick={() => setRetry(value => value + 1)}>إعادة المحاولة</button></p> : null}
    {!loading && !error && items.length === 0 ? <p className="store-profile-empty">لا توجد تقييمات مكتملة معروضة لهذا المتجر.</p> : null}
    {!loading && !error ? <ul className="store-product-list">
      {items.map(item => <li key={item.orderId} className="store-product-row">
        <div className="store-product-description">
          <strong>{item.rating} من 5</strong>
          <span>{item.review.trim() || "تقييم دون تعليق"}</span>
          <time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time>
        </div>
      </li>)}
    </ul> : null}
    {!loading && !error && (nextCursor || history.length > 0) ? <nav className="store-product-actions" aria-label="صفحات تقييمات المتجر">
      <button type="button" className="button button-secondary" disabled={!history.length} onClick={() => {
        setCursor(history[history.length-1] ?? ""); setHistory(value => value.slice(0, -1));
      }}>السابق</button>
      <button type="button" className="button button-secondary" disabled={!nextCursor} onClick={() => {
        setHistory(value => [...value, cursor]); setCursor(nextCursor);
      }}>التالي</button>
    </nav> : null}
  </section>;
}
