"use client";

import type { CaptainOpportunityHeatmap } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";

type HeatCell = CaptainOpportunityHeatmap["cells"][number];
type MapCircleHandle = { setMap(map: null): void };
type MapHandle = { fitBounds(bounds: unknown): void; setCenter(position: { lat: number; lng: number }): void };
type MapsAPI = {
  Map: new (node: HTMLElement, options: Record<string, unknown>) => MapHandle;
  Circle: new (options: Record<string, unknown>) => MapCircleHandle;
  LatLngBounds: new () => { extend(position: { lat: number; lng: number }): void };
};
declare global { interface Window { google?: { maps: MapsAPI } } }

const activityColors = {
  ORDERS: { fillColor: "#EA6F24", strokeColor: "#C75A17" },
  CAPTAINS: { fillColor: "#0C9B97", strokeColor: "#087E7A" },
} as const;
const activityRadius = { LOW: 1050, MEDIUM: 1750, HIGH: 2450 } as const;
const activityOpacity = { LOW: 0.22, MEDIUM: 0.31, HIGH: 0.42 } as const;

function CircleMap({ cells }: { cells: ReadonlyArray<HeatCell> }) {
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<MapHandle | null>(null);
  const circles = useRef<MapCircleHandle[]>([]);
  const [loaded, setLoaded] = useState(Boolean(typeof window !== "undefined" && window.google?.maps));
  const [mapError, setMapError] = useState(false);
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY;

  useEffect(() => {
    if (!key || loaded) return;
    const id = "bthwani-ops-maps-sdk";
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const onLoad = () => setLoaded(Boolean(window.google?.maps));
    const onError = () => setMapError(true);
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    if (!existing) {
      script.id = id;
      script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key);
      script.async = true;
      document.head.appendChild(script);
    } else if (window.google?.maps) {
      setLoaded(true);
    }
    return () => { script.removeEventListener("load", onLoad); script.removeEventListener("error", onError); };
  }, [key, loaded]);

  useEffect(() => {
    const api = window.google?.maps;
    const first = cells[0];
    if (!loaded || !api || !node.current) return;
    if (!map.current) {
      map.current = new api.Map(node.current, {
        center: first ? { lat: first.latitude, lng: first.longitude } : { lat: 15.5, lng: 47.5 },
        zoom: first ? 11 : 6, mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
      });
    }
    for (const circle of circles.current) circle.setMap(null);
    circles.current = [];
    const bounds = new api.LatLngBounds();
    for (const cell of cells) {
      const center = { lat: cell.latitude, lng: cell.longitude };
      bounds.extend(center);
      circles.current.push(new api.Circle({
        map: map.current, center, radius: activityRadius[cell.intensity],
        fillColor: activityColors[cell.kind].fillColor, fillOpacity: activityOpacity[cell.intensity],
        strokeColor: activityColors[cell.kind].strokeColor, strokeOpacity: 0.86, strokeWeight: 1.5,
      }));
    }
    if (cells.length > 1) map.current.fitBounds(bounds);
    else if (first) map.current.setCenter({ lat: first.latitude, lng: first.longitude });
    return () => { for (const circle of circles.current) circle.setMap(null); circles.current = []; };
  }, [loaded, cells]);

  if (!key || mapError) return <p role="status">تعذر تحميل خرائط Google. تحقق من مفتاح الخرائط والصلاحيات.</p>;
  return <section aria-label="دوائر الطلبات والكباتن على خريطة واحدة" style={{ width: "100%", height: 360, borderRadius: 12, overflow: "hidden", position: "relative" }}>
    <div ref={node} style={{ width: "100%", height: "100%" }} />
    {!loaded ? <p role="status">جارٍ تحميل خريطة النشاط…</p> : null}
  </section>;
}

export function OpportunityZones() {
  const [value, setValue] = useState<CaptainOpportunityHeatmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operations/opportunities", {
        cache: "no-store", signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error("تعذر جلب خريطة النشاط؛ أعد المحاولة.");
      const body = await response.json() as CaptainOpportunityHeatmap;
      if (!body || body.signalType !== "RECENT_ACTIVITY" || !Array.isArray(body.cells)
        || typeof body.measuredAt !== "string" || !body.cells.every((cell) =>
          Number.isFinite(cell.latitude) && Number.isFinite(cell.longitude)
          && cell.intensity in activityRadius && (cell.kind === "ORDERS" || cell.kind === "CAPTAINS")
        )) throw new Error("بيانات خريطة النشاط غير صالحة.");
      setValue(body);
    } catch (cause) {
      if (!quiet) setValue(null);
      setError(cause instanceof Error ? cause.message : "تعذرت قراءة خريطة النشاط.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const cells = value?.cells ?? [];
  return <section className="ops-page-intro" aria-label="الخريطة الحرارية الآنية للطلبات والكباتن">
    <h2>الخريطة الحرارية الآنية</h2>
    <p>دوائر الطلبات والكباتن المتاحين معًا، خلال آخر 30 دقيقة. تتحدث كل دقيقة دون عرض مواقع الأفراد أو مساراتهم.</p>
    <p><strong style={{ color: activityColors.ORDERS.strokeColor }}>● الطلبات</strong>{" · "}
      <strong style={{ color: activityColors.CAPTAINS.strokeColor }}>● الكباتن المتاحون</strong>
      {" · "}الدائرة الأكبر تعني نشاطًا أعلى
    </p>
    {loading && !value ? <p role="status">جارٍ قراءة الخريطة…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {value ? <CircleMap cells={cells} /> : null}
    {value && !loading && cells.length === 0 ? <p>لا توجد عينة كافية لعرض دوائر النشاط بأمان حاليًا؛ لا يعني ذلك عدم وجود طلبات أو كباتن.</p> : null}
  </section>;
}
