"use client";

import { useEffect, useState } from "react";
import { MarketingBannerPresentation } from "../marketing/marketing-banner-presentation";

type PublishedImage = Readonly<{ id: string; titleAr: string; mediaUri: string }>;
type RegistryRecord = Record<string, unknown>;
function isRecord(value: unknown): value is RegistryRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function PublishedBannerSettings() {
  const [images, setImages] = useState<ReadonlyArray<PublishedImage>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    setLoading(true);
    if (reload > 0) setError("");
    void (async () => {
      try {
        // The existing authorized, bounded marketing registry owns the published image selection.
        const response = await fetch("/api/marketing/content?kind=BANNER&state=PUBLISHED&limit=25&sort=priority", {
          cache: "no-store", signal: abort.signal,
        });
        if (!response.ok) throw new Error("تعذر قراءة البنرات المنشورة من مركز المحتوى.");
        const result = await response.json() as unknown;
        if (!isRecord(result) || !Array.isArray(result.items)) throw new Error("استجابة البنرات المنشورة غير صالحة.");
        const values: PublishedImage[] = result.items
          .filter((item: unknown): item is RegistryRecord =>
            isRecord(item) && item.kind === "BANNER" && item.state === "PUBLISHED" &&
            typeof item.id === "string" && typeof item.titleAr === "string" &&
            typeof item.mediaUri === "string" && /^(https?:\/\/|\/(?!\/))/.test(item.mediaUri))
          .slice(0, 8)
          .map((item: RegistryRecord) => ({ id: item.id as string, titleAr: item.titleAr as string, mediaUri: item.mediaUri as string }));
        if (active) setImages(values);
      } catch {
        if (active) {
          setImages([]);
          setError("تعذر قراءة البنرات المنشورة. أعد المحاولة أو افتح مركز المحتوى.");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; abort.abort(); };
  }, [reload]);

  return <section className="studio-published-panel" aria-label="البنرات المنشورة">
    {loading ? <p role="status">جارٍ قراءة البنرات المنشورة...</p> : null}
    {error ? <p role="alert">{error} <button type="button" className="button button-secondary" onClick={() => setReload((value) => value + 1)}>إعادة المحاولة</button></p> : null}
    {!loading && !error ? <p className="studio-guidance">تظهر صور البنرات المنشورة من أول 25 سجلًا بحسب أولوية المحتوى، بحد أقصى ثماني صور للمعاينة.</p> : null}
    <MarketingBannerPresentation images={images} />
  </section>;
}
