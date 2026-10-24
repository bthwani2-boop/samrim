"use client";

import { useEffect, useState } from "react";
import { OperationLocationMap } from "./operation-location-map";

type Mission = Readonly<{
  assignmentId?: string;
  state: "NO_ACTIVE" | "NO_SIGNAL" | "FRESH" | "STALE" | "LOST";
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  recordedAt?: string;
  receivedAt?: string;
}>;

export function OperatorMissionLocation({ orderId }: Readonly<{ orderId: string }>) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [error, setError] = useState("");
  const [showMap, setShowMap] = useState(false);
  useEffect(() => {
    let live = true;
    async function poll() {
      try {
        const response = await fetch(`/api/operations/${encodeURIComponent(orderId)}/mission-location`,
          { cache: "no-store", signal: AbortSignal.timeout(12_000) });
        if (!response.ok) throw new Error("تعذر قراءة موقع المهمة");
        const result = await response.json() as { mission?: Mission };
        if (!result.mission || !["NO_ACTIVE", "NO_SIGNAL", "FRESH", "STALE", "LOST"].includes(result.mission.state)) {
          throw new Error("رد الموقع غير صالح");
        }
        if (!live) return;
        setMission(result.mission);
        setError("");
      } catch {
        if (live) {
          setMission(null);
          setError("تعذرت قراءة الموقع الحالي؛ لا يمكن تأكيد مكان الكابتن.");
        }
      }
    }
    setMission(null);
    setError("");
    setShowMap(false);
    void poll();
    const interval = window.setInterval(() => { if (!document.hidden) void poll(); }, 25_000);
    return () => { live = false; window.clearInterval(interval); };
  }, [orderId]);
  if (!mission && !error) return null;
  if (mission?.state === "NO_ACTIVE") return null;
  const point = mission && (mission.state === "FRESH" || mission.state === "STALE")
    && Number.isFinite(mission.latitude) && Number.isFinite(mission.longitude)
    && Math.abs(mission.latitude ?? 100) <= 90 && Math.abs(mission.longitude ?? 200) <= 180;
  return <section className="order-detail-panel" aria-labelledby="operator-mission-location-label">
    <h2 id="operator-mission-location-label">موقع الكابتن أثناء المهمة — للعمليات فقط</h2>
    {error ? <p role="alert">{error}</p> : null}
    {mission?.state === "NO_SIGNAL" ? <p role="status">المهمة نشطة، لكن لم تصل إشارة موقع بعد.</p> : null}
    {mission?.state === "LOST" ? <p role="status">انقطعت إشارة الموقع. لا تتوفر نقطة حية موثوقة.</p> : null}
    {mission?.state === "STALE" ? <p role="status">آخر إشارة قديمة؛ لا تعتبر الكابتن في هذا المكان حاليًا.</p> : null}
    {mission?.state === "FRESH" ? <p role="status">إشارة حديثة للمهمة الحالية.</p> : null}
    {point && mission ? <>
      <p className="muted">آخر قراءة: {mission.receivedAt ? new Date(mission.receivedAt).toLocaleString("ar-YE") : "غير متاحة"} · دقة تقريبية {Math.round(mission.accuracyMeters ?? 0)} متر</p>
      <button type="button" className="button button-secondary" onClick={() => setShowMap((visible) => !visible)}>
        {showMap ? "إخفاء الخريطة" : "عرض موقع المهمة"}
      </button>
      {showMap ? <OperationLocationMap latitude={mission.latitude!} longitude={mission.longitude!} label="المهمة النشطة" /> : null}
    </> : null}
  </section>;
}
