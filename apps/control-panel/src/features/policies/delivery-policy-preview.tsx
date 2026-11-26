"use client";

import { type CityDeliveryPolicy, type CityDeliveryPolicyChange, type CityDeliveryPolicyPreview, type CityDeliveryPolicyState, isCityDeliveryPolicy, isCityDeliveryPolicyChange, isCityDeliveryPolicyPreview, isCityDeliveryPolicyPreviewInput, isCityDeliveryPolicyResult, matchesCityDeliveryPolicy } from "@bthwani/dsh";
import { Alert, Button, Input, InputNumber, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";

type Band = { draftId: string; upToMeters: number | null; ratePerKmMinor: number | null };

export default function DeliveryPolicyPreview({ policy, actorId, disabled, onDenied, onLockChange, onCommitted }: Readonly<{
  policy: CityDeliveryPolicyState; actorId: string; disabled: boolean; onDenied: () => void;
  onLockChange: (locked: boolean) => void; onCommitted: (current: CityDeliveryPolicy) => void;
}>) {
  const [radius, setRadius] = useState<number | null>(policy.radiusMetres ?? null);
  const [distance, setDistance] = useState<number | null>(null);
  const [bands, setBands] = useState<Band[]>(policy.distanceBands?.map((b,i) => ({...b,draftId:`band-${i}`})) ?? [{ draftId:"band-0", upToMeters: null, ratePerKmMinor: null }]);
  const [result, setResult] = useState<CityDeliveryPolicyPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<CityDeliveryPolicyChange | null>(null);
  const active = useRef<AbortController | null>(null);
  const recoveryKey = `bthwani:delivery-policy:pending:${encodeURIComponent(actorId)}:${policy.cityId}`;
  const [recoveryReady,setRecoveryReady] = useState(false);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(recoveryKey);
      if (raw !== null) {
        const restored:unknown=JSON.parse(raw);
        if (!isCityDeliveryPolicyChange(restored)) throw new Error("invalid pending command");
        setPending(restored);
        onLockChange(true);
      }
      setRecoveryReady(true);
    } catch {
      setError("تعذر استرداد عملية الحفظ في جلسة المتصفح. لن تُرسل عملية جديدة قبل التحقق.");
    }
  }, [recoveryKey,onLockChange]);
  function clearPending() {
    window.sessionStorage.removeItem(recoveryKey);
    setPending(null);
    onLockChange(false);
  }
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const blocked = disabled || busy || stale || !recoveryReady || pending !== null;
  const distanceBands = bands.map(({upToMeters,ratePerKmMinor})=>({upToMeters,ratePerKmMinor}));
  const input = { expectedVersion: policy.version, radiusMetres: radius, distanceMetres: distance, distanceBands };
  const valid = isCityDeliveryPolicyPreviewInput(input);

  function clear() {
    active.current?.abort(); active.current = null; setResult(null); setError(""); setBusy(false);
  }
  function updateBand(index: number, field: "upToMeters" | "ratePerKmMinor", value: number | null) {
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
  async function save() {
    if (disabled || busy || active.current || stale || !recoveryReady) return;
    const candidate = pending ?? { operationId: crypto.randomUUID(), expectedVersion: policy.version,
      radiusMetres: radius, distanceBands, reason };
    if (!isCityDeliveryPolicyChange(candidate) || (!pending && !result)) return;
    try {
      window.sessionStorage.setItem(recoveryKey, JSON.stringify(candidate));
    } catch {
      setError("تعذر حفظ معرّف العملية في جلسة المتصفح. لم يُرسل التعديل.");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setPending(candidate); onLockChange(true); setBusy(true); setError("");
    const endpoint = "/api/policies/cities/" + policy.cityId + "?delivery=1";
    const binding = { "X-BThwani-Operator": encodeURIComponent(actorId) };
    const options = { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal } as const;
    try {
      const response = await fetch(endpoint, { ...options, method: "PATCH",
        headers: { ...binding, "Content-Type": "application/json" }, body: JSON.stringify(candidate) });
      if (controller.signal.aborted || active.current !== controller) return;
      if (response.status === 409 || (!pending && [400,401,403].includes(response.status))) {
        clearPending();
        if (response.status === 401 || response.status === 403) { onDenied(); return; }
        setStale(response.status === 409); setError("رفض DSH التعديل أو تغير الإصدار. أعد قراءة السياسة قبل المحاولة.");
        return;
      }
      if (response.status === 401 || response.status === 403) {
        onLockChange(false); onDenied(); return;
      }
      const saved: unknown = response.ok ? await response.json() : null;
      if (controller.signal.aborted || active.current !== controller) return;
      if (!isCityDeliveryPolicyResult(saved, policy.cityId, candidate)) throw new Error("unknown");
      const read = await fetch(endpoint, { ...options, method: "GET", headers: binding });
      if (controller.signal.aborted || active.current !== controller) return;
      if (read.status === 401 || read.status === 403) { onLockChange(false); onDenied(); return; }
      const current: unknown = read.ok ? await read.json() : null;
      if (controller.signal.aborted || active.current !== controller) return;
      if (!isCityDeliveryPolicy(current, policy.cityId) || current.version < candidate.expectedVersion + 1 ||
          (current.version === candidate.expectedVersion + 1 && (!matchesCityDeliveryPolicy(current, candidate) || current.updatedAt !== saved.policy.updatedAt))) throw new Error("unknown");
      clearPending(); onCommitted(current);
    } catch {
      if (!controller.signal.aborted && active.current === controller)
        setError("لم تتأكد نتيجة الحفظ. أعد إرسال نفس العملية دون تغيير معرّفها أو قيمها.");
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  if (pending) return <section aria-label="استرداد عملية سياسة التوصيل">
    <Alert type="warning" message="عملية حفظ بانتظار التحقق من DSH" description={pending.operationId} />
    <Typography.Paragraph>الإصدار السابق: {pending.expectedVersion} — النطاق: {pending.radiusMetres} متر</Typography.Paragraph>
    {pending.distanceBands.map(band => <Typography.Paragraph key={band.upToMeters ?? "open"}>
      {band.upToMeters === null ? "المسافة المتبقية" : `حتى ${band.upToMeters} متر`}: {band.ratePerKmMinor} ريال/كم
    </Typography.Paragraph>)}
    <Typography.Paragraph>سبب التعديل: {pending.reason}</Typography.Paragraph>
    {error && <Alert type="error" message={error} role="alert" />}
    <Button disabled={busy || disabled} loading={busy} onClick={() => void save()}>إعادة نفس العملية والتحقق</Button>
  </section>;
  return <section aria-label="معاينة سياسة رسوم التوصيل" style={{ marginBlockStart: 16 }}>
    <Typography.Title level={4}>شرائح رسوم التوصيل</Typography.Title>
    {policy.distanceBands ? <section aria-label="الشرائح الحالية">
      {policy.distanceBands.map(band => <Typography.Paragraph key={band.upToMeters ?? "open"}>
        {band.upToMeters === null ? "المسافة المتبقية" : "حتى " + band.upToMeters + " متر"}: {band.ratePerKmMinor} ريال/كم
      </Typography.Paragraph>)}
    </section> : <Alert type="info" message="لا توجد تعرفة مسافة معتمدة لهذه المدينة." />}
    <Typography.Paragraph>معاينة تغيير النطاق والشرائح — الإصدار الحالي {policy.version}. الحساب تراكمي حسب سعر كل شريحة.</Typography.Paragraph>
    <Space direction="vertical" style={{ width: "100%" }}>
      <label htmlFor="delivery-policy-radius">النطاق المقترح (متر)<InputNumber id="delivery-policy-radius" aria-label="النطاق المقترح" min={1} max={2147483647} precision={0} value={radius} disabled={blocked}
        onChange={v => { clear(); setRadius(v); }} style={{ width: "100%" }} /></label>
      {bands.map((band, i) => <Space key={band.draftId} wrap align="end">
        {i !== bands.length - 1 ? <label htmlFor={`delivery-bound-${band.draftId}`}>حتى متر<InputNumber id={`delivery-bound-${band.draftId}`} aria-label={"نهاية الشريحة " + (i + 1)} min={1} max={500000} precision={0}
          value={band.upToMeters} disabled={blocked} onChange={v => updateBand(i, "upToMeters", v)} /></label> : <Typography.Text>الشريحة الأخيرة المفتوحة</Typography.Text>}
        <label htmlFor={`delivery-rate-${band.draftId}`}>ريال لكل كيلومتر<InputNumber id={`delivery-rate-${band.draftId}`} aria-label={"سعر الشريحة " + (i + 1)} min={1} max={100000000} precision={0}
          value={band.ratePerKmMinor} disabled={blocked} onChange={v => updateBand(i, "ratePerKmMinor", v)} /></label>
        {i !== bands.length - 1 && <Button disabled={blocked} onClick={() => { clear(); setBands(old => old.filter((_, j) => j !== i)); }}>حذف الشريحة</Button>}
      </Space>)}
      <Button disabled={blocked || bands.length >= 30} onClick={() => { clear(); setBands(old => [...old.slice(0, -1), {draftId: crypto.randomUUID(), upToMeters: null, ratePerKmMinor: null}, ...old.slice(-1)]); }}>إضافة شريحة</Button>
      <label htmlFor="delivery-policy-distance">مسافة المعاينة (متر)<InputNumber id="delivery-policy-distance" aria-label="مسافة المعاينة" min={0} max={radius ?? 2147483647} precision={0}
        value={distance} disabled={blocked} onChange={v => { clear(); setDistance(v); }} style={{ width: "100%" }} /></label>
      <Button type="primary" disabled={blocked || !valid} loading={busy} onClick={() => void preview()}>معاينة الحساب من DSH</Button>
      {error && <Alert type="error" message={error} role="alert" />}
      {result && <Alert type="info" role="status" message={"تقدير الرسوم: " + new Intl.NumberFormat("ar-YE").format(BigInt(result.feeYer)) + " ريال يمني"}
        description="معاينة فقط — لا تحفظ السياسة ولا تسمح بالدفع أو تحصيل الأموال." />}
      <label htmlFor="delivery-policy-reason">سبب تغيير السياسة<Input id="delivery-policy-reason" aria-label="سبب تغيير سياسة التوصيل" maxLength={300} value={reason} disabled={blocked} onChange={event => setReason(event.target.value)} /></label>
      <Button disabled={blocked || !result || !reason.trim()} loading={busy} onClick={() => void save()}>حفظ سياسة التوصيل لدى DSH</Button>
      <Typography.Paragraph type="secondary">الحفظ في بيئة التطوير فقط؛ لا يفعّل الدفع أو الإسناد ولا يعدّل الطلبات السابقة.</Typography.Paragraph>
    </Space>
  </section>;
}
