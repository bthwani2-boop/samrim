"use client";

import { isFreshOpportunitySample, type CaptainOpportunityHeatmap } from "@bthwani/dsh";
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

type ActivityColors = Record<HeatCell["kind"], string>;
const activityRadius = { LOW: 1050, MEDIUM: 1750, HIGH: 2450 } as const;
const activityOpacity = { LOW: 0.22, MEDIUM: 0.31, HIGH: 0.42 } as const;

function readActivityColors(): ActivityColors | null {
  const style = getComputedStyle(document.documentElement);
  const orders = style.getPropertyValue("--warning-text").trim();
  const captains = style.getPropertyValue("--success-text").trim();
  return orders && captains ? { ORDERS: orders, CAPTAINS: captains } : null;
}

function CircleMap({ cells }: { cells: ReadonlyArray<HeatCell> }) {
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<MapHandle | null>(null);
  const circles = useRef<MapCircleHandle[]>([]);
  const [loaded, setLoaded] = useState(Boolean(typeof window !== "undefined" && window.google?.maps));
  const [colors, setColors] = useState<ActivityColors | null>(null);
  const [mapError, setMapError] = useState(false);
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY;

  useEffect(() => {
    const update = () => {
      const next = readActivityColors();
      if (!next) return;
      setColors((current) => current?.ORDERS === next.ORDERS && current.CAPTAINS === next.CAPTAINS ? current : next);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!key || loaded) return;
    const id = "bthwani-ops-maps-sdk";
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const timeout = window.setTimeout(() => setMapError(true), 15_000);
    const onLoad = () => {
      clearTimeout(timeout);
      if (window.google?.maps) setLoaded(true);
      else setMapError(true);
    };
    const onError = () => { clearTimeout(timeout); setMapError(true); };
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
    return () => {
      clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
  }, [key, loaded]);

  useEffect(() => {
    const api = window.google?.maps;
    const first = cells[0];
    if (!loaded || !api || !node.current || !colors) return;
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
        fillColor: colors[cell.kind], fillOpacity: activityOpacity[cell.intensity],
        strokeColor: colors[cell.kind], strokeOpacity: 0.86, strokeWeight: 1.5,
      }));
    }
    if (cells.length > 1) map.current.fitBounds(bounds);
    else if (first) map.current.setCenter({ lat: first.latitude, lng: first.longitude });
    return () => { for (const circle of circles.current) circle.setMap(null); circles.current = []; };
  }, [loaded, cells, colors]);

  if (!key || mapError) return <p role="status">تعذر تحميل خرائط Google. تحقق من مفتاح الخرائط والصلاحيات.</p>;
  return <section aria-label="دوائر الطلبات والكباتن على خريطة واحدة" className="ops-activity-map">
    <div ref={node} className="ops-activity-map-canvas" />
    {!loaded ? <p role="status">جارٍ تحميل خريطة النشاط…</p> : null}
  </section>;
}

export function OpportunityZones() {
  const [value, setValue] = useState<CaptainOpportunityHeatmap | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [, setLoading] = useState(true);
  const [error, setError] = useState("");
  const latestRequest = useRef(0);

  const load = useCallback(async (quiet = false) => {
    const request = ++latestRequest.current;
    if (!quiet) setLoading(true);
    setError("");
    setValue((previous) => previous && !isFreshOpportunitySample(previous.measuredAt) ? null : previous);
    try {
      const response = await fetch("/api/operations/opportunities", {
        cache: "no-store", signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error("تعذر جلب خريطة النشاط؛ أعد المحاولة.");
      const body = await response.json() as CaptainOpportunityHeatmap;
      if (!body || body.signalType !== "RECENT_ACTIVITY" || !Array.isArray(body.cells)
        || !isFreshOpportunitySample(body.measuredAt) || !body.cells.every((cell) =>
          Number.isFinite(cell.latitude) && Number.isFinite(cell.longitude)
          && cell.intensity in activityRadius && (cell.kind === "ORDERS" || cell.kind === "CAPTAINS")
        )) throw new Error("بيانات خريطة النشاط غير صالحة.");
      if (request !== latestRequest.current) return;
      setValue(body);
    } catch (cause) {
      if (request !== latestRequest.current) return;
      // Quiet polling failures must also remove potentially stale circles.
      setValue(null);
      setError(cause instanceof Error ? cause.message : "تعذرت قراءة خريطة النشاط.");
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(true); }, 60_000);
    const refreshOnReturn = () => { if (!document.hidden) void load(true); };
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      latestRequest.current += 1;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [load]);

  const cells = value?.cells ?? [];
  // An empty or unverified activity sample is not a map and must not displace active work.
  if (error && !value) return <div className="ops-activity-failure" role="alert"><span>تعذرت قراءة خريطة النشاط.</span><button type="button" className="button button-secondary" onClick={() => void load()}>إعادة المحاولة</button></div>;
  if (!value || cells.length === 0) return null;
  return <details className="ops-activity-disclosure" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>خريطة النشاط · آخر 30 دقيقة</summary>
    <section className="ops-page-intro" aria-label="الخريطة الحرارية الآنية للطلبات والكباتن">
      <p>كثافة الطلبات والكباتن المتاحين دون عرض مواقع الأفراد.</p>
      <p><strong className="ops-activity-legend-orders">● الطلبات</strong>{" · "}
        <strong className="ops-activity-legend-captains">● الكباتن المتاحون</strong>
        {" · "}الدائرة الأكبر تعني نشاطًا أعلى
      </p>
      {expanded ? <CircleMap cells={cells} /> : null}
    </section>
  </details>;
}
