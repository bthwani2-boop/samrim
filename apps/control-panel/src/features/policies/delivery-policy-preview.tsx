"use client";

import { Alert, Button, InputNumber, Space, Typography } from "antd";
import { type CityDeliveryPolicy, type CityDeliveryPolicyPreview, isCityDeliveryPolicyPreview, isCityDeliveryPolicyPreviewInput } from "@bthwani/dsh";
import { useEffect, useRef, useState } from "react";

type Band = { upToMeters: number | null; ratePerKmMinor: number | null };

export default function DeliveryPolicyPreview({ policy, actorId, disabled, onDenied }: Readonly<{
  policy: CityDeliveryPolicy; actorId: string; disabled: boolean; onDenied: () => void;
}>) {
  const [radius, setRadius] = useState<number | null>(policy.radiusMetres);
  const [distance, setDistance] = useState<number | null>(null);
  const [bands, setBands] = useState<Band[]>(policy.distanceBands?.map(b => ({...b})) ?? [{ upToMeters: null, ratePerKmMinor: null }]);
  const [result, setResult] = useState<CityDeliveryPolicyPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const blocked = disabled || busy || stale;
  const input = { expectedVersion: policy.version, radiusMetres: radius, distanceMetres: distance, distanceBands: bands };
  const valid = isCityDeliveryPolicyPreviewInput(input);

  function clear() {
    active.current?.abort(); active.current = null; setResult(null); setError(""); setBusy(false);
  }
  function updateBand(index: number, field: keyof Band, value: number | null) {
    clear();
    setBands(old => old.map((band, i) => i === index ? { ...band, [field]: value } : band));
  }
  async function preview() {
    if (!valid || blocked || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setResult(null); setError("");
    try {
      const response = await fetch("/api/policies/cities/" + policy.cityId, {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json", "X-BThwani-Operator": encodeURIComponent(actorId) },
        body: JSON.stringify(input), signal: controller.signal,
      });
      if (controller.signal.aborted || active.current !== controller) return;
      if (response.status === 401 || response.status === 403) { onDenied(); return; }
      if (response.status === 409) { setStale(true); setError("تغير إصدار السياسة. أعد قراءة السياسة الحالية."); return; }
      if (!response.ok) throw new Error("unavailable");
      const value: unknown = await response.json();
      if (controller.signal.aborted || active.current !== controller) return;
      if (!isCityDeliveryPolicyPreview(value, policy.cityId, input)) throw new Error("invalid");
      setResult(value);
    } catch {
      if (!controller.signal.aborted && active.current === controller) setError("تعذرت معاينة التعرفة من DSH.");
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  return <section aria-label="معاينة سياسة رسوم التوصيل" style={{ marginBlockStart: 16 }}>
    <Typography.Title level={4}>شرائح رسوم التوصيل</Typography.Title>
    {policy.distanceBands ? <section aria-label="الشرائح الحالية">
      {policy.distanceBands.map((band, i) => <Typography.Paragraph key={i}>
        {band.upToMeters === null ? "المسافة المتبقية" : "حتى " + band.upToMeters + " متر"}: {band.ratePerKmMinor} ريال/كم
      </Typography.Paragraph>)}
    </section> : <Alert type="info" message="لا توجد تعرفة مسافة معتمدة لهذه المدينة." />}
    <Typography.Paragraph>معاينة تغيير النطاق والشرائح — الإصدار الحالي {policy.version}. الحساب تراكمي حسب سعر كل شريحة.</Typography.Paragraph>
    <Space direction="vertical" style={{ width: "100%" }}>
      <label>النطاق المقترح (متر)<InputNumber aria-label="النطاق المقترح" min={1} max={2147483647} precision={0} value={radius} disabled={blocked}
        onChange={v => { clear(); setRadius(v); }} style={{ width: "100%" }} /></label>
      {bands.map((band, i) => <Space key={i} wrap align="end">
        {i !== bands.length - 1 ? <label>حتى متر<InputNumber aria-label={"نهاية الشريحة " + (i + 1)} min={1} max={500000} precision={0}
          value={band.upToMeters} disabled={blocked} onChange={v => updateBand(i, "upToMeters", v)} /></label> : <Typography.Text>الشريحة الأخيرة المفتوحة</Typography.Text>}
        <label>ريال لكل كيلومتر<InputNumber aria-label={"سعر الشريحة " + (i + 1)} min={1} max={100000000} precision={0}
          value={band.ratePerKmMinor} disabled={blocked} onChange={v => updateBand(i, "ratePerKmMinor", v)} /></label>
        {i !== bands.length - 1 && <Button disabled={blocked} onClick={() => { clear(); setBands(old => old.filter((_, j) => j !== i)); }}>حذف الشريحة</Button>}
      </Space>)}
      <Button disabled={blocked || bands.length >= 30} onClick={() => { clear(); setBands(old => [...old.slice(0, -1), {upToMeters: null, ratePerKmMinor: null}, ...old.slice(-1)]); }}>إضافة شريحة</Button>
      <label>مسافة المعاينة (متر)<InputNumber aria-label="مسافة المعاينة" min={0} max={radius ?? 2147483647} precision={0}
        value={distance} disabled={blocked} onChange={v => { clear(); setDistance(v); }} style={{ width: "100%" }} /></label>
      <Button type="primary" disabled={blocked || !valid} loading={busy} onClick={() => void preview()}>معاينة الحساب من DSH</Button>
      {error && <Alert type="error" message={error} role="alert" />}
      {result && <Alert type="info" role="status" message={"تقدير الرسوم: " + new Intl.NumberFormat("ar-YE").format(BigInt(result.feeYer)) + " ريال يمني"}
        description="معاينة فقط — لا تحفظ السياسة ولا تسمح بالدفع أو تحصيل الأموال." />}
    </Space>
  </section>;
}
