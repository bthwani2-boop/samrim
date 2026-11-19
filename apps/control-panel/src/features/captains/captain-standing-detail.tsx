"use client";

import { Alert, Button, Card, Input, Popconfirm, Select, Space, Spin, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CaptainStanding,
  captainStatusLabels, isCaptainStanding, readCaptainJson,
} from "./captains-read-client";

export default function CaptainStandingDetail({ actorId }: Readonly<{ actorId: string }>) {
  const [standing, setStanding] = useState<CaptainStanding | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<"APPROVED" | "SUSPENDED" | "REVOKED">("APPROVED");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState("");
  const [writeBlocked, setWriteBlocked] = useState(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    setStanding(null);
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
      const value = await readCaptainJson(`/api/captains/${encodeURIComponent(actorId)}/standing`, signal);
      if (!isCaptainStanding(value) || value.actorId !== actorId) {
        throw new Error("استجابة تفاصيل الكابتن غير صالحة.");
      }
      if (!controller.signal.aborted) {
        setStanding(value);
        setTarget(value.status === "APPROVED" ? "SUSPENDED" : "APPROVED");
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "تعذّرت قراءة التفاصيل.");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (request.current === controller) request.current = null;
    }
  }, [actorId]);

  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load]);

  const updateStanding = useCallback(async () => {
    if (!standing || submitting || writeBlocked || !reason.trim() || reason.trim().length > 300) return;
    setSubmitting(true);
    setWriteError("");
    const controller = new AbortController();
    const operationId = crypto.randomUUID();
    try {
      const response = await fetch(`/api/captains/${encodeURIComponent(actorId)}/standing`, {
        method: "PATCH", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target, expectedVersion: standing.version, operationId, reason: reason.trim() }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error("انتهت جلسة المشغّل؛ سجّل الدخول مجددًا.");
        if (response.status === 403) throw new Error("ليس لديك إذن لتغيير حالة الكابتن.");
        if (response.status === 400) throw new Error("الطلب غير صالح؛ تحقق من السبب والحالة.");
        if (response.status === 409) {
          setWriteBlocked(true);
          throw new Error("تغيرت الحالة أثناء المراجعة؛ حدّث الملف قبل أي قرار آخر.");
        }
        setWriteBlocked(true);
        throw new Error(`نتيجة العملية غير مؤكدة (المعرف: ${operationId}). افحص حالة DSH قبل أي إجراء آخر.`);
      }
      let result: unknown;
      try { result = await response.json(); } catch {
        setWriteBlocked(true);
        throw new Error(`تعذر تأكيد نتيجة العملية (المعرف: ${operationId}). افحص حالة DSH.`);
      }
      if (!isCaptainStanding(result) || result.actorId !== actorId || result.status !== target ||
        result.version < standing.version) {
        setWriteBlocked(true);
        throw new Error(`تعذر تأكيد نتيجة العملية (المعرف: ${operationId}). افحص حالة DSH.`);
      }
      setStanding(result);
      setTarget(result.status === "APPROVED" ? "SUSPENDED" : "APPROVED");
      setReason("");
    } catch (cause) {
      if (!(cause instanceof Error) || cause.name === "TimeoutError" || cause.name === "AbortError" || cause instanceof TypeError) {
        setWriteBlocked(true);
        setWriteError(`نتيجة العملية غير مؤكدة (المعرف: ${operationId}). افحص حالة DSH قبل أي إجراء آخر.`);
      } else {
        setWriteError(cause.message);
      }
    } finally { controller.abort(); setSubmitting(false); }
  }, [actorId, reason, standing, submitting, target, writeBlocked]);

  return (
    <main style={{ padding: 24, maxWidth: 900, marginInline: "auto" }} aria-labelledby="captain-detail-heading">
      <Space wrap style={{ marginBottom: 16 }}>
        <a href="/captains">العودة إلى قائمة الكباتن</a>
        <Button onClick={() => { void load(); }} disabled={loading || submitting}>تحديث الحالة</Button>
      </Space>
      <Typography.Title level={2} id="captain-detail-heading">ملف الكابتن</Typography.Title>
      <Typography.Paragraph>حالة الكابتن تُقرأ وتُراجع لدى DSH. قرارات المراجعة تسجل سببًا وإصدارًا، ولا تمنح دور Identity تلقائيًا.</Typography.Paragraph>
      {loading && <Spin tip="جارٍ قراءة الحالة" size="large"><div style={{ minHeight: 80 }} /></Spin>}
      {error && <Alert type="error" showIcon message={error} />}
      {writeError && <Alert type="error" showIcon message={writeError} style={{ marginBottom: 16 }} />}
      {standing && (
        <Card title="الحالة التشغيلية">
          <Typography.Paragraph>معرّف الكابتن: <Typography.Text copyable>{standing.actorId}</Typography.Text></Typography.Paragraph>
          <Typography.Paragraph>الحالة: {captainStatusLabels[standing.status]}</Typography.Paragraph>
          <Typography.Paragraph>الإصدار الحالي: {standing.version}</Typography.Paragraph>
          {standing.status !== "REVOKED" && (
            <Space direction="vertical" style={{ width: "100%", maxWidth: 460 }}>
              <Typography.Text strong>مراجعة الحالة التشغيلية</Typography.Text>
              <Select aria-label="قرار المراجعة" value={target} onChange={setTarget}
                options={[
                  ...(standing.status !== "APPROVED" ? [{ value: "APPROVED", label: "اعتماد" }] : []),
                  ...(standing.status === "APPROVED" ? [{ value: "SUSPENDED", label: "إيقاف" }] : []),
                  { value: "REVOKED", label: "إلغاء نهائي" },
                ]} />
              <Input.TextArea aria-label="سبب القرار" placeholder="سبب القرار (إلزامي للتدقيق)"
                maxLength={300} showCount rows={3} value={reason} onChange={event => setReason(event.target.value)} />
              <Popconfirm title="تأكيد قرار الكابتن" description="سيُسجل القرار لدى DSH مع المعرّف والإصدار الحالي."
                okText="تأكيد" cancelText="تراجع" onConfirm={() => { void updateStanding(); }}>
                <Button type="primary" loading={submitting} disabled={loading || submitting || writeBlocked ||
                  reason.trim().length === 0 || reason.trim().length > 300 || target === standing.status}>
                  تطبيق القرار
                </Button>
              </Popconfirm>
              {writeBlocked && <Typography.Text type="warning">توقفت إجراءات التغيير حتى التحقق من الحالة الأخيرة. أعد فتح الملف بعد المراجعة.</Typography.Text>}
            </Space>
          )}
        </Card>
      )}
    </main>
  );
}
