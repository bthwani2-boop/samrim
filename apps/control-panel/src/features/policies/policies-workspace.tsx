"use client";

import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, Space, Typography } from "antd";
import { useState } from "react";
import {
  type CityPolicy, type CityPolicyChange, parseCityPolicy, reconcileCityPolicy,
} from "./city-policy-command";

const validCity = /^[a-z0-9-]{1,64}$/;

export default function PoliciesWorkspace({ actorId }: Readonly<{ actorId: string }>) {
  const [city, setCity] = useState("");
  const [policy, setPolicy] = useState<CityPolicy | null>(null);
  const [maxPause, setMaxPause] = useState<number | null>(null);
  const [maxPreparation, setMaxPreparation] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [provision, setProvision] = useState(false);
  const [pending, setPending] = useState<CityPolicyChange | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [requiresRead, setRequiresRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const endpoint = validCity.test(city) ? `/api/policies/cities/${city}` : null;
  const readyForChange = !requiresRead && endpoint && (policy !== null || provision) &&
    maxPause !== null && Number.isSafeInteger(maxPause) && maxPause >= 0 && maxPause <= 31536000 &&
    maxPreparation !== null && Number.isSafeInteger(maxPreparation) &&
    maxPreparation >= 0 && maxPreparation <= 1440 &&
    reason.trim().length >= 1 && [...reason].length <= 300;

  function resetCommand() {
    setPending(null);
    setUncertain(false);
    setMessage("");
    setErrorMessage("");
  }

  async function readCurrent() {
    if (!endpoint || busy) return;
    setBusy(true);
    setMessage("");
    setErrorMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "GET", credentials: "same-origin", cache: "no-store",
        headers: { "X-BThwani-Operator": encodeURIComponent(actorId) },
      });
      if (!response.ok) {
        throw new Error(response.status === 403 || response.status === 401
          ? "Identity لا يثبت صلاحية إدارة السياسات الحالية."
          : "تعذر قراءة سياسة المدينة من DSH. لا توجد قيم افتراضية مفترضة؛ لا تعتبر 503 دليلًا على غياب السياسة.");
      }
      const current = parseCityPolicy(await response.json(), city);
      if (!current) throw new Error("أعاد DSH بيانات سياسة غير معتمدة.");
      setPolicy(current);
      setRequiresRead(false);
      setProvision(false);
      if (!uncertain) {
        setMaxPause(current.maxPauseSeconds);
        setMaxPreparation(current.maxPreparationMinutes);
      }
      setMessage("تمت قراءة السياسة الحالية.");
    } catch (error) {
      setPolicy(null);
      setProvision(false);
      setErrorMessage(error instanceof Error ? error.message : "تعذر قراءة السياسة.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!endpoint || busy) return;
    let change = pending;
    if (!change) {
      if (!readyForChange || maxPause === null || maxPreparation === null) return;
      change = {
        operationId: crypto.randomUUID(),
        expectedVersion: policy?.version ?? 0,
        maxPauseSeconds: maxPause,
        maxPreparationMinutes: maxPreparation,
        reason,
      };
    }
    setPending(change);
    setBusy(true);
    setMessage("");
    setErrorMessage("");
    const result = await reconcileCityPolicy(endpoint, city, actorId, change);
    setBusy(false);

    if (result.status === "confirmed") {
      setPolicy(result.current);
      setMaxPause(result.current.maxPauseSeconds);
      setMaxPreparation(result.current.maxPreparationMinutes);
      setReason("");
      setPending(null);
      setUncertain(false);
      setProvision(false);
      setRequiresRead(false);
      setMessage(result.superseded
        ? "تم تأكيد العملية. يعرض النموذج إصدارًا أحدث قرأه من DSH."
        : result.replay ? "تم تأكيد العملية السابقة دون تكرار التعديل."
          : "تم اعتماد السياسة والتحقق من الإصدار والقيم الحالية.");
      return;
    }
    if (result.status === "conflict") {
      setPending(null);
      setUncertain(false);
      setPolicy(null);
      setProvision(false);
      setRequiresRead(true);
      setErrorMessage("تعارض إصدار السياسة أو معرّف العملية. اقرأ السياسة الحالية قبل التعديل.");
      return;
    }
    if (result.status === "unknown" || uncertain) {
      setUncertain(true);
      setErrorMessage(result.status === "denied"
        ? "تعذّر التحقق من الصلاحية لاسترداد العملية. احتفظ بمعرّفها حتى استعادة الصلاحية."
        : "نتيجة التعديل غير مؤكدة. أعد إرسال الأمر بنفس المعرّف للتحقق منه.");
      return;
    }
    setPending(null);
    if (result.status === "denied") {
      setPolicy(null);
      setProvision(false);
      setRequiresRead(true);
    }
    setErrorMessage(result.status === "denied"
      ? "لم تؤكد Identity صلاحية تعديل السياسة."
      : "رفض DSH أمر السياسة. راجع المدخلات قبل المحاولة.");
  }

  return (
    <main style={{ maxWidth: 900, marginInline: "auto", paddingBlock: 24 }}>
      <Typography.Title level={2}>السياسات</Typography.Title>
      <Typography.Paragraph>
        إدارة حدود إتاحة المتاجر لكل مدينة عبر DSH. تتطلب جلسة Operator وصلاحية
        <code> platform_policies </code> مؤكَّدتين من Identity؛ ولا تغيّر الطلبات أو الاتفاقيات المالية.
      </Typography.Paragraph>
      <Card title="قراءة سياسة المدينة" style={{ marginBlockEnd: 16 }}>
        <Form layout="vertical" onFinish={() => void readCurrent()}>
          <Form.Item label="معرّف المدينة المعتمد في DSH">
            <Input aria-label="معرّف المدينة" value={city} maxLength={64}
              disabled={busy || uncertain} placeholder="مثال لمعرّف مدينة فعلي في DSH"
              onChange={event => {
                setCity(event.target.value);
                setPolicy(null);
                setRequiresRead(false);
                setMaxPause(null);
                setMaxPreparation(null);
                setReason("");
                setProvision(false);
                resetCommand();
              }} />
          </Form.Item>
          <Button htmlType="submit" disabled={!endpoint || busy} loading={busy}>قراءة السياسة الحالية</Button>
        </Form>
        {policy && (
          <section aria-label="السياسة الحالية" style={{ marginBlockStart: 16 }}>
            <Typography.Paragraph>الإصدار: <strong>{policy.version}</strong> — المدينة: {policy.cityId}</Typography.Paragraph>
            <Typography.Paragraph>أقصى مدة إيقاف: {policy.maxPauseSeconds} ثانية؛ أقصى تحضير: {policy.maxPreparationMinutes} دقيقة.</Typography.Paragraph>
            <Typography.Paragraph>آخر تعديل بواسطة: {policy.changedByActor} — {policy.updatedAt}</Typography.Paragraph>
            <Typography.Paragraph>سبب التعديل الأخير: {policy.changeReason}</Typography.Paragraph>
          </section>
        )}
      </Card>
      <Card title="تغيير سياسة إتاحة المتاجر" style={{ marginBlockEnd: 16 }}>
        {!policy && (
          <Checkbox checked={provision} disabled={busy || uncertain || requiresRead} onChange={event => {
            setProvision(event.target.checked);
            resetCommand();
          }}>
            تهيئة أول إصدار لمدينة نشطة عمدًا (expectedVersion=0). لا تعني حالة 503 غياب سياسة.
          </Checkbox>
        )}
        <Form layout="vertical" style={{ marginBlockStart: 16 }} onFinish={() => void apply()}>
          <Form.Item label="الحد الأعلى لإيقاف المتجر بالثواني">
            <InputNumber aria-label="حد الإيقاف بالثواني" style={{ width: "100%" }}
              min={0} max={31536000} precision={0} value={maxPause}
              disabled={busy || uncertain || (!policy && !provision)}
              onChange={value => { setMaxPause(value); resetCommand(); }} />
          </Form.Item>
          <Form.Item label="الحد الأعلى لوقت التحضير بالدقائق">
            <InputNumber aria-label="حد التحضير بالدقائق" style={{ width: "100%" }}
              min={0} max={1440} precision={0} value={maxPreparation}
              disabled={busy || uncertain || (!policy && !provision)}
              onChange={value => { setMaxPreparation(value); resetCommand(); }} />
          </Form.Item>
          <Form.Item label="سبب التغيير (يُسجّل عند المالك)">
            <Input.TextArea aria-label="سبب تغيير السياسة" value={reason} maxLength={300}
              disabled={busy || uncertain || (!policy && !provision)} rows={3}
              onChange={event => { setReason(event.target.value); resetCommand(); }} />
          </Form.Item>
          <Space wrap>
            <Button type="primary" htmlType="submit" loading={busy}
              disabled={busy || (!pending && !readyForChange)}>
              {uncertain ? "إعادة إرسال نفس العملية" : "اعتماد سياسة المدينة في DSH"}
            </Button>
            {uncertain && <Button type="default" disabled={busy} onClick={() => void readCurrent()}>
              قراءة الحالة لدى المالك
            </Button>}
          </Space>
        </Form>
        {pending && <Typography.Paragraph style={{ marginBlockStart: 12 }}>
          معرّف العملية الثابت للمصالحة: <code>{pending.operationId}</code>
          {uncertain ? " — احتفظ به؛ لا تغير الأمر إلى أن تتضح النتيجة." : null}
        </Typography.Paragraph>}
      </Card>
      {message && <Alert type="success" showIcon message={message} role="status" />}
      {errorMessage && <Alert type="error" showIcon message={errorMessage} role="alert" />}
    </main>
  );
}
