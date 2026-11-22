"use client";

import type {
  OperatorStoreRegistrationChange, OperatorStoreRegistrationPolicy,
  StoreRegistrationRelation,
} from "@bthwani/dsh";
import { Alert, Button, Card, Checkbox, Form, Input, Radio, Space, Typography } from "antd";
import { useState } from "react";
import {
  matchesPendingPolicy, readStoreRegistrationPolicy, reconcileRegistrationPolicy,
} from "./store-registration-command";

const validCity = /^[a-z0-9-]{1,64}$/;

export default function StoreRegistrationPolicyEditor({ actorId }: Readonly<{ actorId: string }>) {
  const [city, setCity] = useState("");
  const [relation, setRelation] = useState<StoreRegistrationRelation>("MARKETPLACE");
  const [policy, setPolicy] = useState<OperatorStoreRegistrationPolicy | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [termsVersion, setTermsVersion] = useState("");
  const [termsText, setTermsText] = useState("");
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState<OperatorStoreRegistrationChange | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [needsRead, setNeedsRead] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const endpoint = validCity.test(city)
    ? `/api/policies/cities/${city}/store-registration/${relation}`
    : null;
  const locked = busy || pending !== null;
  const canWrite = !!endpoint && !needsRead && !busy && policy !== null &&
    /^[a-z0-9._-]{3,80}$/.test(termsVersion) &&
    termsText.trim().length >= 1 && [...termsText].length <= 4000 &&
    reason.trim().length >= 1 && [...reason].length <= 300 &&
    (!enabled || reviewed);

  function resetScope() {
    setPolicy(null);
    setPending(null);
    setUnknown(false);
    setNeedsRead(true);
    setTermsVersion("");
    setTermsText("");
    setReason("");
    setEnabled(false);
    setReviewed(false);
    setMessage("");
    setError("");
  }
  async function refresh() {
    if (!endpoint || busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const current = await readStoreRegistrationPolicy(endpoint, city, relation, actorId);
      setPolicy(current);
      setNeedsRead(false);
      if (pending) {
        if (matchesPendingPolicy(current, actorId, pending)) {
          setPending(null);
          setUnknown(false);
          setEnabled(current.enabled);
          setTermsVersion(current.termsVersion ?? "");
          setTermsText(current.termsText ?? "");
          setReviewed(false);
          setReason("");
          setMessage("تم تأكيد عملية التعديل من قراءة DSH المستقلة.");
        } else if (current.version > pending.expectedVersion + 1) {
          setPending(null);
          setUnknown(false);
          setNeedsRead(true);
          setError("تقدمت السياسة إلى إصدار أحدث؛ أعد القراءة قبل إنشاء عملية جديدة.");
        } else {
          setUnknown(true);
          setError("لا تثبت القراءة تنفيذ العملية. أعد إرسال العملية نفسها بمعرّفها المحفوظ.");
        }
      } else {
        setEnabled(current.enabled);
        setTermsVersion(current.termsVersion ?? "");
        setTermsText(current.termsText ?? "");
        setReviewed(false);
        setReason("");
        setMessage(current.version === 0 ?
          "لا توجد سياسة مسجلة؛ التسجيل مغلق، ويمكن إنشاء سياسة أولى بإصدار متوقع 0." :
          "تمت قراءة سياسة قبول المتاجر الحالية من DSH.");
      }
    } catch (cause) {
      setNeedsRead(true);
      setPolicy(null);
      setError(cause instanceof Error ? cause.message : "تعذرت قراءة السياسة من DSH.");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!endpoint || busy || (!pending && !canWrite)) return;
    const change: OperatorStoreRegistrationChange = pending ?? {
      operationId: crypto.randomUUID(),
      expectedVersion: policy?.version ?? 0,
      enabled,
      termsVersion,
      termsText,
      reason,
    };
    setPending(change);
    setBusy(true);
    setMessage("");
    setError("");
    const result = await reconcileRegistrationPolicy(endpoint, city, relation, actorId, change);
    setBusy(false);
    if (result.status === "confirmed") {
      setPending(null);
      setUnknown(false);
      setPolicy(result.current);
      setEnabled(result.current.enabled);
      setTermsVersion(result.current.termsVersion ?? "");
      setTermsText(result.current.termsText ?? "");
      setReason("");
      setReviewed(false);
      setNeedsRead(false);
      setMessage(result.superseded ? "نجحت العملية، ثم عدّل مشغّل آخر السياسة." :
        result.replay ? "أكد DSH استعادة نتيجة العملية السابقة دون تكرار." :
          "تم حفظ سياسة قبول المتاجر والتحقق من قراءتها لدى DSH.");
      return;
    }
    if (result.status === "unknown") {
      setUnknown(true);
      setError("نتيجة التعديل غير مؤكدة. حافظنا على معرّف العملية ونصها؛ اقرأ DSH أو أعد المحاولة نفسها.");
      return;
    }
    setPending(null);
    setUnknown(false);
    if (result.status === "conflict" || result.status === "denied") {
      setNeedsRead(true);
      setPolicy(null);
      setError(result.status === "conflict" ?
        "تغيّر الإصدار أو استخدم معرّف العملية لطلب آخر. اقرأ سياسة DSH قبل إعادة المحاولة." :
        "رفض Identity الصلاحية أو جلسة المشغّل؛ لن نكرر العملية دون تحقق جديد.");
    } else {
      setError("رفض DSH البيانات. راجع الشروط والإصدار والسبب قبل الإرسال مجددًا.");
    }
  }

  return (
    <main style={{ maxWidth: 900, marginInline: "auto", paddingBlock: 24 }} dir="rtl">
      <Typography.Title level={2}>سياسة قبول المتاجر الجديدة</Typography.Title>
      <Typography.Paragraph>
        يملك DSH قبول المتاجر الجديدة لكل مدينة وطريقة عمل. هذه السياسة لا تنشر متجرًا،
        ولا تمنح دور التاجر في Identity، ولا تفعّل الطلبات أو أي تسوية لدى WLT.
        لا يستطيع تغييرها إلا مشغّل مفوّض بصلاحية <code>platform_policies</code>.
      </Typography.Paragraph>
      <Card title="تحديد المدينة وطريقة عمل المتجر" style={{ marginBlockEnd: 16 }}>
        <Form layout="vertical" onFinish={() => void refresh()}>
          <Form.Item label="معرّف المدينة في DSH">
            <Input aria-label="معرّف مدينة قبول المتاجر" value={city} maxLength={64}
              disabled={locked} placeholder="مثال: sanaa" onChange={event => {
                setCity(event.target.value);
                resetScope();
              }} />
          </Form.Item>
          <Form.Item label="طريقة العمل">
            <Radio.Group value={relation} disabled={locked} onChange={event => {
              setRelation(event.target.value as StoreRegistrationRelation);
              resetScope();
            }}>
              <Radio value="MARKETPLACE">داخل سوق بثواني</Radio>
              <Radio value="DIRECT">متجر مباشر</Radio>
            </Radio.Group>
          </Form.Item>
          <Button htmlType="submit" disabled={!endpoint || busy} loading={busy}>قراءة السياسة من DSH</Button>
        </Form>
        {policy && (
          <Typography.Paragraph style={{ marginBlockStart: 14 }}>
            الإصدار: <strong>{policy.version}</strong> — الحالة: {policy.enabled ? "قبول التسجيل مفعّل" : "قبول التسجيل مغلق"}
            {policy.changedByActor ? ` — آخر مشغّل: ${policy.changedByActor}` : ""}
          </Typography.Paragraph>
        )}
      </Card>
      <Card title="تحديث سياسة التسجيل">
        <Form layout="vertical" onFinish={() => void save()}>
          <Form.Item label="حالة قبول متاجر جديدة">
            <Checkbox checked={enabled} disabled={locked || needsRead || !policy} onChange={event => {
              setEnabled(event.target.checked);
              setReviewed(false);
            }}>
              السماح بإنشاء متاجر جديدة لهذه المدينة وطريقة العمل فقط
            </Checkbox>
          </Form.Item>
          <Form.Item label="إصدار الشروط القانونية المعتمد">
            <Input aria-label="إصدار شروط قبول المتاجر" value={termsVersion} maxLength={80}
              disabled={locked || needsRead} onChange={event => setTermsVersion(event.target.value)}
              placeholder="مثال: merchant-terms-v1" />
          </Form.Item>
          <Form.Item label="نص الشروط الذي سيقرأه التاجر قبل الموافقة">
            <Input.TextArea aria-label="نص شروط تسجيل المتجر" value={termsText} rows={5}
              maxLength={4000} disabled={locked || needsRead}
              onChange={event => setTermsText(event.target.value)} />
          </Form.Item>
          <Form.Item label="سبب القرار (سجل تدقيق DSH)">
            <Input.TextArea aria-label="سبب قرار قبول المتاجر" value={reason} maxLength={300}
              rows={2} disabled={locked || needsRead}
              onChange={event => setReason(event.target.value)} />
          </Form.Item>
          {enabled && (
            <Checkbox checked={reviewed} disabled={locked || needsRead} onChange={event => setReviewed(event.target.checked)}>
              أؤكد مراجعة الشروط والمدينة وطريقة العمل قبل السماح بانضمام متاجر جديدة.
            </Checkbox>
          )}
          <Space wrap style={{ marginBlockStart: 16 }}>
            <Button type="primary" htmlType="submit" loading={busy}
              disabled={busy || (!pending && !canWrite)}>
              {unknown ? "إعادة العملية نفسها دون تكرار" : "حفظ سياسة قبول المتاجر في DSH"}
            </Button>
            {pending && <Button disabled={busy} onClick={() => void refresh()}>التحقق من نتيجة العملية لدى DSH</Button>}
          </Space>
          {pending && (
            <Typography.Paragraph style={{ marginBlockStart: 12 }}>
              معرّف العملية المحفوظ: <code>{pending.operationId}</code>. لا يتم إنشاء معرّف جديد حتى تتضح نتيجتها.
            </Typography.Paragraph>
          )}
        </Form>
      </Card>
      {message && <Alert type="success" showIcon role="status" message={message} style={{ marginBlockStart: 12 }} />}
      {error && <Alert type="error" showIcon role="alert" message={error} style={{ marginBlockStart: 12 }} />}
    </main>
  );
}
