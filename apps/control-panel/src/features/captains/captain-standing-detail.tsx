"use client";

import { Alert, Button, Card, Input, Popconfirm, Select, Space, Spin, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CaptainStanding,
  captainStatusLabels, isCaptainStanding, readCaptainJson,
} from "./captains-read-client";

type ReviewTarget = "APPROVED" | "SUSPENDED" | "REVOKED";
type ReviewDraft = { target: ReviewTarget; reason: string };

export default function CaptainStandingDetail({ actorId, operatorId }: Readonly<{ actorId: string; operatorId: string }>) {
  const operatorBinding = encodeURIComponent(operatorId);
  const [standing, setStanding] = useState<CaptainStanding | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<ReviewDraft>({ target: "APPROVED", reason: "" });
  const { target, reason } = draft;
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState("");
  const [writeBlocked, setWriteBlocked] = useState(false);
  const request = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);
  const activeStanding = useRef<CaptainStanding | null>(null);
  const activeDraft = useRef(draft);
  const mounted = useRef(false);
  const replaceDraft = useCallback((next: ReviewDraft) => {
    activeDraft.current = next;
    setDraft(next);
  }, []);
  const blockWrite = useCallback(() => {
    activeStanding.current = null;
    setStanding(null);
    setWriteBlocked(true);
  }, []);

  const load = useCallback(async () => {
    if (!mounted.current) return;
    const previous = activeStanding.current;
    activeStanding.current = null;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    setStanding(null);
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
      const value = await readCaptainJson(`/api/captains/${encodeURIComponent(actorId)}/standing`, signal, operatorBinding);
      if (!isCaptainStanding(value) || value.actorId !== actorId) {
        throw new Error("استجابة تفاصيل الكابتن غير صالحة.");
      }
      if (!controller.signal.aborted) {
        activeStanding.current = value;
        setStanding(value);
        replaceDraft(previous?.actorId === value.actorId && previous.version === value.version && previous.status === value.status
          ? { ...activeDraft.current }
          : { target: value.status === "APPROVED" ? "SUSPENDED" : "APPROVED", reason: "" });
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "تعذّرت قراءة التفاصيل.");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (request.current === controller) request.current = null;
    }
  }, [actorId, operatorBinding, replaceDraft]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const onReturn = () => {
      if (document.visibilityState === "visible" && !submittingRef.current) void load();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      mounted.current = false;
      activeStanding.current = null;
      request.current?.abort();
    };
  }, [load]);

  const updateStanding = useCallback(async () => {
    if (!mounted.current || !standing || activeStanding.current !== standing || activeDraft.current !== draft ||
      submittingRef.current || submitting || writeBlocked || standing.status === "REVOKED" || target === standing.status ||
      !reason.trim() || reason.trim().length > 300) return;
    submittingRef.current = true;
    // A consumed confirmation cannot send a new operation, even after a definite rejection.
    replaceDraft({ ...draft });
    setSubmitting(true);
    setWriteError("");
    const controller = new AbortController();
    const operationId = crypto.randomUUID();
    try {
      const response = await fetch(`/api/captains/${encodeURIComponent(actorId)}/standing`, {
        method: "PATCH", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-BThwani-Operator": operatorBinding },
        body: JSON.stringify({ status: target, expectedVersion: standing.version, operationId, reason: reason.trim() }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      if (!mounted.current) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          activeStanding.current = null;
          setStanding(null);
          throw new Error(response.status === 401 ? "انتهت جلسة المشغّل؛ سجّل الدخول مجددًا."
            : "تعذّر تأكيد صلاحية جلسة المشغّل لهذه المراجعة. أعد فتح الملف.");
        }
        if (response.status === 400) throw new Error("الطلب غير صالح؛ تحقق من السبب والحالة.");
        if (response.status === 409) {
          blockWrite();
          throw new Error("تغيرت الحالة أثناء المراجعة؛ حدّث الملف قبل أي قرار آخر.");
        }
        blockWrite();
        throw new Error(`نتيجة العملية غير مؤكدة (المعرف: ${operationId}). افحص حالة DSH قبل أي إجراء آخر.`);
      }
      let result: unknown;
      try { result = await response.json(); } catch {
        if (!mounted.current) return;
        blockWrite();
        throw new Error(`تعذر تأكيد نتيجة العملية (المعرف: ${operationId}). افحص حالة DSH.`);
      }
      if (!mounted.current) return;
      if (response.headers.get("X-BThwani-Operator") !== operatorBinding || !isCaptainStanding(result) ||
        result.actorId !== actorId || result.status !== target || result.version !== standing.version + 1) {
        blockWrite();
        throw new Error(`تعذر تأكيد نتيجة العملية (المعرف: ${operationId}). افحص حالة DSH.`);
      }
      activeStanding.current = null;
      replaceDraft({ target: result.status === "APPROVED" ? "SUSPENDED" : "APPROVED", reason: "" });
      void load();
    } catch (cause) {
      if (!mounted.current) return;
      if (!(cause instanceof Error) || cause.name === "TimeoutError" || cause.name === "AbortError" || cause instanceof TypeError) {
        blockWrite();
        setWriteError(`نتيجة العملية غير مؤكدة (المعرف: ${operationId}). افحص حالة DSH قبل أي إجراء آخر.`);
      } else {
        setWriteError(cause.message);
      }
    } finally {
      controller.abort();
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }, [actorId, blockWrite, draft, load, operatorBinding, reason, replaceDraft, standing, submitting, target, writeBlocked]);

  return (
    <main style={{ padding: 24, maxWidth: 900, marginInline: "auto" }} aria-labelledby="captain-detail-heading">
      <Space wrap style={{ marginBottom: 16 }}>
        <a href="/captains">العودة إلى قائمة الكباتن</a>
      </Space>
      <Typography.Title level={2} id="captain-detail-heading">ملف الكابتن</Typography.Title>
      <Typography.Paragraph>حالة الكابتن تُقرأ وتُراجع لدى DSH. قرارات المراجعة تسجل سببًا وإصدارًا، ولا تمنح دور Identity تلقائيًا.</Typography.Paragraph>
      {loading && <Spin tip="جارٍ قراءة الحالة" size="large"><div style={{ minHeight: 80 }} /></Spin>}
      {error && <Alert type="error" showIcon message={error} />}
      {writeError && <Alert type="error" showIcon message={writeError} style={{ marginBottom: 16 }} />}
      {(error || writeBlocked) && <Button onClick={() => { if (!submittingRef.current) void load(); }}
        disabled={loading || submitting} style={{ marginBottom: 16 }}>
        {writeBlocked ? "التحقق من الحالة لدى DSH" : "إعادة المحاولة"}
      </Button>}
      {standing && (
        <Card title="الحالة التشغيلية">
          <Typography.Paragraph>معرّف الكابتن: <Typography.Text copyable>{standing.actorId}</Typography.Text></Typography.Paragraph>
          <Typography.Paragraph>الحالة: {captainStatusLabels[standing.status]}</Typography.Paragraph>
          <Typography.Paragraph>الإصدار الحالي: {standing.version}</Typography.Paragraph>
          {standing.status !== "REVOKED" && (
            <Space direction="vertical" style={{ width: "100%", maxWidth: 460 }}>
              <Typography.Text strong>مراجعة الحالة التشغيلية</Typography.Text>
              <Select aria-label="قرار المراجعة" value={target} disabled={loading || submitting || writeBlocked}
                onChange={(value: ReviewTarget) => {
                  if (activeStanding.current === standing && !submittingRef.current && !writeBlocked) {
                    replaceDraft({ ...activeDraft.current, target: value });
                  }
                }}
                options={[
                  ...(standing.status !== "APPROVED" ? [{ value: "APPROVED", label: "اعتماد" }] : []),
                  ...(standing.status === "APPROVED" ? [{ value: "SUSPENDED", label: "إيقاف" }] : []),
                  { value: "REVOKED", label: "إلغاء نهائي" },
                ]} />
              <Input.TextArea aria-label="سبب القرار" placeholder="سبب القرار (إلزامي للتدقيق)"
                maxLength={300} showCount rows={3} value={reason} disabled={loading || submitting || writeBlocked}
                onChange={event => {
                  if (activeStanding.current === standing && !submittingRef.current && !writeBlocked) {
                    replaceDraft({ ...activeDraft.current, reason: event.target.value });
                  }
                }} />
              <Popconfirm title="تأكيد قرار الكابتن" description="سيُسجل القرار لدى DSH مع المعرّف والإصدار الحالي."
                okText="تأكيد" cancelText="تراجع" disabled={loading || submitting || writeBlocked}
                onConfirm={() => { void updateStanding(); }}>
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
