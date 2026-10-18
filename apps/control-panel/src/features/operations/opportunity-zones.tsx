"use client";

import type { CaptainOpportunityHeatmap } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";

const intensityLabel = { LOW: "نشاط منخفض", MEDIUM: "نشاط متوسط", HIGH: "نشاط مرتفع" } as const;

export function OpportunityZones() {
  const [value, setValue] = useState<CaptainOpportunityHeatmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operations/opportunities", {
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error("تعذر جلب فرص المناطق؛ أعد المحاولة.");
      const body = await response.json() as CaptainOpportunityHeatmap;
      if (!body || !Array.isArray(body.cells) || typeof body.measuredAt !== "string"
        || !body.cells.every((cell) => Number.isFinite(cell.latitude) && Number.isFinite(cell.longitude) && cell.intensity in intensityLabel)) {
        throw new Error("بيانات المناطق غير صالحة.");
      }
      setValue(body);
    } catch (cause) {
      setValue(null);
      setError(cause instanceof Error ? cause.message : "تعذر قراءة نشاط المناطق.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <section className="ops-page-intro" aria-label="نشاط مناطق الطلبات">
    <h2>نشاط مناطق الطلبات</h2>
    <p>مؤشر تاريخي تقريبي حسب مواقع المتاجر، وليس حركة الكباتن أو عناوين العملاء. لا يضمن وجود طلب متاح.</p>
    <button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>تحديث المؤشر</button>
    {loading ? <p role="status">جارٍ قراءة نشاط المناطق…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {!loading && value?.sampleStatus === "INSUFFICIENT_DATA" ? <p>لا توجد عينة كافية لعرض مناطق نشاط آمنة؛ لا يعني ذلك عدم وجود طلبات.</p> : null}
    {!loading && value?.sampleStatus === "AVAILABLE" ? <>
      <p className="muted">نشاط تاريخي خلال الأيام السبعة الكاملة السابقة. آخر حساب: {new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium" }).format(new Date(value.measuredAt))}.</p>
      <ul>
        {value.cells.map((cell) => <li key={cell.latitude + ":" + cell.longitude}>
          <a href={`https://www.google.com/maps/search/?api=1&query=${cell.latitude}%2C${cell.longitude}`} target="_blank" rel="noopener noreferrer">
            منطقة تقريبية على الخريطة: {intensityLabel[cell.intensity]}
          </a>
        </li>)}
      </ul>
    </> : null}
  </section>;
}
