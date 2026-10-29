"use client";
import { useCallback, useEffect, useState } from "react";

type Presentation = { placement: "HOME"; mode: "STATIC" | "CINEMATIC" | "CROSSFADE"; intervalSeconds: number; version: number };
const options = [
  { value: "STATIC", label: "ثابت" },
  { value: "CINEMATIC", label: "سينمائي" },
  { value: "CROSSFADE", label: "تلاشي" },
] as const;

export function MarketingBannerPresentation({ images = [] }: { images?: ReadonlyArray<{ id: string; titleAr: string; mediaUri: string }> }) {
  const [current, setCurrent] = useState<Presentation | null>(null);
  const [mode, setMode] = useState<Presentation["mode"]>("CINEMATIC");
  const [seconds, setSeconds] = useState(5);
  const [busy, setBusy] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/marketing/banner-presentation", { cache: "no-store" });
    if (!response.ok) throw new Error("تعذر قراءة إعدادات البنر");
    const value = await response.json() as Presentation;
    if (!options.some(item => item.value === value.mode) || !Number.isInteger(value.intervalSeconds) || !Number.isInteger(value.version)) throw new Error("إعدادات البنر غير صالحة");
    setCurrent(value); setMode(value.mode); setSeconds(value.intervalSeconds);
  }, []);
  useEffect(() => { void refresh().catch(() => setMessage("تعذر قراءة إعدادات البنر")); }, [refresh]);
  useEffect(() => {
    if (mode === "STATIC" || images.length < 2) return;
    const timer = setInterval(() => setPreviewIndex(index => (index + 1) % images.length), seconds * 1000);
    return () => clearInterval(timer);
  }, [mode, seconds, images.length]);
  async function save() {
    if (!current) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/marketing/banner-presentation", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, intervalSeconds: seconds, expectedVersion: current.version }),
      });
      if (!response.ok) throw new Error(response.status === 409 ? "تم تعديل الإعدادات من جلسة أخرى؛ أعد قراءة الإعدادات" : "تعذر حفظ إعدادات البنر");
      const body = await response.json() as { presentation: Presentation };
      setCurrent(body.presentation); setMode(body.presentation.mode); setSeconds(body.presentation.intervalSeconds);
      setMessage("تم حفظ إعدادات عرض البنر");
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر الحفظ"); }
    finally { setBusy(false); }
  }
  return <section className="access-card work-stack" aria-label="التحكم بعرض بنرات الرئيسية">
    <div className="access-card-heading"><h2>بنرات الرئيسية</h2><p className="muted">تحكم مركزي بالحركة. الصور والوجهات والترتيب من سجل المحتوى أدناه.</p></div>
    {images.length ? <section className="work-stack" aria-label="معاينة البنرات المنشورة">
      <div style={{ position: "relative", width: "100%", maxWidth: 420, aspectRatio: "1 / 1", overflow: "hidden", borderRadius: 14, background: "#0A2F5C" }}>
        {images.map((item, index) => <div key={item.id} style={{ position: "absolute", inset: 0, opacity: index === previewIndex % images.length ? 1 : 0, transform: mode === "CINEMATIC" && index !== previewIndex % images.length ? "translateX(7%)" : "translateX(0)", transition: mode === "STATIC" ? "none" : "opacity 550ms ease-in-out, transform 550ms ease-in-out", background: item.titleAr.includes("مقاضي") ? "linear-gradient(#195A54, #297A73, #56A59A)" : item.titleAr.includes("متاجر") ? "linear-gradient(#132E50, #1A4068, #4078A4)" : "linear-gradient(#A94316, #CB6131, #EFAD86)" }}>
          <img src={item.mediaUri} alt={item.titleAr} style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "57.14%", objectFit: "cover" }} />
          <div dir="rtl" aria-hidden="true" style={{ position: "absolute", insetInline: 0, top: 0, padding: 16, display: "grid", gap: 12, color: "white", pointerEvents: "none" }}>
            <strong style={{ fontSize: 25 }}>بثواني</strong>
            <span style={{ fontSize: 12 }}>مدينة الخدمة</span>
            <div style={{ borderRadius: 30, background: "white", color: "#506787", padding: 12, fontSize: 13 }}>ابحث عن متجر أو منتج</div>
          </div>
        </div>)}
      </div>
      {images.length > 1 ? <div className="action-row"><button className="button button-secondary" type="button" onClick={() => setPreviewIndex(index => (index + images.length - 1) % images.length)}>السابق</button><button className="button button-secondary" type="button" onClick={() => setPreviewIndex(index => (index + 1) % images.length)}>التالي</button></div> : null}
      <p className="muted">معاينة تخطيطية لمساحة البنر المربعة 1:1 في تطبيق العميل؛ تظهر الصورة الأفقية في الجزء السفلي دون تمديد. الشعار والبحث عناصر تفاعلية يضيفها التطبيق فوق البنر، والسحب اليدوي متاح فيه.</p>
    </section> : <p className="muted">لا توجد صور بنرات منشورة ضمن السجلات المحمّلة للمعاينة.</p>}
    <fieldset className="action-row" style={{ border: 0, padding: 0, margin: 0 }} aria-label="نمط الحركة">
      {options.map(option => <button type="button" key={option.value} disabled={!current || busy}
        aria-pressed={mode === option.value}
        className={mode === option.value ? "button button-primary" : "button button-secondary"}
        onClick={() => setMode(option.value)}>{option.label}</button>)}
    </fieldset>
    <label className="field-label">زمن عرض الصورة: {seconds} ثوانٍ
      <input type="range" min={3} max={10} step={1} value={seconds} disabled={!current || busy || mode === "STATIC"}
        onChange={event => setSeconds(Number(event.target.value))} />
    </label>
    <p className="muted">السحب اليدوي متاح دائمًا. توقف الحركة عند مغادرة الشاشة أو تفعيل تقليل الحركة.</p>
    <div className="action-row">
      <button type="button" className="button button-primary" disabled={!current || busy || (current.mode === mode && current.intervalSeconds === seconds)} onClick={() => void save()}>{busy ? "جارٍ الحفظ…" : "حفظ الحركة"}</button>
      <button type="button" className="button button-secondary" disabled={busy} onClick={() => void refresh().catch(() => setMessage("تعذر تحديث الإعدادات"))}>تحديث</button>
    </div>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
