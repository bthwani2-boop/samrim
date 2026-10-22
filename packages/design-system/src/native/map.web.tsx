import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { BthwaniMapProps } from "./map";
import "leaflet/dist/leaflet.css";

export type { BthwaniMapCoordinate, BthwaniMapMarker, BthwaniMapCircle, BthwaniMapProps } from "./map";

/** A selectable browser map; Android and iOS continue using react-native-maps. */
export function BthwaniMap({
  accessibilityLabel, markers = [], circles = [], selection, initialCoordinate,
  onSelectCoordinate, height = 220, edgeToEdge = false,
}: BthwaniMapProps) {
  const element = useRef<HTMLElement>(null);
  const initialView = useRef({
    coordinate: selection ?? initialCoordinate ?? markers[0]?.coordinate ?? { latitude: 15.5, longitude: 47.5 },
    zoom: selection || initialCoordinate || markers.length ? 13 : 6,
  });
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<LayerGroup | null>(null);
  const selectRef = useRef(onSelectCoordinate);
  const [unavailable, setUnavailable] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  selectRef.current = onSelectCoordinate;

  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | null = null;
    void import("leaflet").then((L) => {
      if (cancelled || !element.current) return;
      const { coordinate, zoom } = initialView.current;
      const map = L.map(element.current, {
        attributionControl: true, scrollWheelZoom: false,
      }).setView([coordinate.latitude, coordinate.longitude], zoom);
      mapRef.current = map;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      layersRef.current = L.layerGroup().addTo(map);
      map.on("click", (event) => selectRef.current?.({
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      }));
      if (typeof ResizeObserver !== "undefined" && element.current) {
        resize = new ResizeObserver(() => map.invalidateSize());
        resize.observe(element.current);
      }
      map.invalidateSize();
      setMapReady(true);
    }).catch(() => { if (!cancelled) setUnavailable(true); });
    return () => {
      cancelled = true;
      resize?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!mapReady || !map || !layers) return;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !mapRef.current || !layersRef.current) return;
      layers.clearLayers();
      const coordinates: Array<[number, number]> = [];
      for (const circle of circles) {
        const point: [number, number] = [circle.coordinate.latitude, circle.coordinate.longitude];
        coordinates.push(point);
        L.circle(point, { radius: circle.radiusMeters, color: circle.strokeColor, fillColor: circle.fillColor }).addTo(layers);
      }
      for (const marker of markers) {
        const point: [number, number] = [marker.coordinate.latitude, marker.coordinate.longitude];
        coordinates.push(point);
        const popup = document.createElement("span");
        popup.textContent = marker.description ? `${marker.title} — ${marker.description}` : marker.title;
        L.circleMarker(point, { radius: 9, color: "#0A2F5C", fillColor: "#FF500D", fillOpacity: 1, weight: 2 })
          .bindPopup(popup).addTo(layers);
      }
      if (selection) {
        const point: [number, number] = [selection.latitude, selection.longitude];
        coordinates.push(point);
        L.circleMarker(point, { radius: 10, color: "#FFFFFF", fillColor: "#FF500D", fillOpacity: 1, weight: 3 }).addTo(layers);
        map.panTo(point, { animate: false });
      } else if (coordinates.length > 1) {
        map.fitBounds(L.latLngBounds(coordinates), { padding: [24, 24], maxZoom: 14, animate: false });
      } else if (coordinates.length === 1) {
        map.panTo(coordinates[0]!, { animate: false });
      }
    });
    return () => { cancelled = true; };
  }, [markers, circles, selection, mapReady]);

  return <section
    aria-label={accessibilityLabel}
    dir="ltr"
    ref={element}
    style={{
      width: "100%", height, minHeight: height, overflow: "hidden",
      borderRadius: edgeToEdge ? 0 : 14, position: "relative", background: "#E7EDF3",
    }}
  >
    {unavailable ? <div dir="rtl" role="alert" style={{
      position: "absolute", zIndex: 1000, inset: 0, display: "grid",
      placeItems: "center", color: "#0A2F5C", background: "#F1F3F5", padding: 16,
    }}>تعذر تحميل الخريطة. تحقق من الاتصال ثم أعد المحاولة.</div> : null}
  </section>;
}
