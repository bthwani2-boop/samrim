"use client";

import type { StoreOperationalAvailability, StoreOperationalChange } from "@bthwani/dsh";
import { Alert, Button, Form, Input, Space } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Props = Readonly<{ snapshot: StoreOperationalAvailability; actorId: string }>;

export default function StorePauseForm({ snapshot, actorId }: Props) {
  const router = useRouter();
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [pending, setPending] = useState<StoreOperationalChange | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const paused = Boolean(snapshot.pausedUntil && Date.parse(snapshot.pausedUntil) > Date.now());
  const duration = minutes.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15));
  const durationReady = /^\d{1,6}$/.test(duration) && Number(duration) > 0;
  const canSave = !busy && !reviewRequired && Boolean(pending || (reason.trim() && (paused || durationReady)));

  async function save() {
    if (!canSave || request.current || snapshot.weekly === null) return;
    const controller = new AbortController();
    const command = pending ?? {
      operationId: crypto.randomUUID(),
      expectedVersion: snapshot.version,
      weekly: snapshot.weekly,
      preparationMinutes: snapshot.preparationMinutes,
      pausedUntil: paused ? null : new Date(Date.now() + Number(duration) * 60000).toISOString(),
      reason: reason.trim(),
    };
    request.current = controller;
    setPending(command);
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/operations/stores/${encodeURIComponent(snapshot.storeId)}/availability`, {
        method: "PATCH",
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-BThwani-Operator": encodeURIComponent(actorId) },
        body: JSON.stringify(command),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      if (controller.signal.aborted) return;
      if (response.status === 204) {
        setPending(null);
        setReviewRequired(true);
        router.refresh();
      } else if (response.status === 400) {
        setPending(null);
        setNotice("رفض DSH التغيير. تحقّق من المدة والسبب وسياسة المدينة.");
      } else if ([401, 403, 404, 409].includes(response.status)) {
        setPending(null);
        setReviewRequired(true);
        setNotice(response.status === 409 ? "تغيّر السجل أو سياسته. راجع الحالة الحالية قبل الحفظ."
          : "تعذّر حفظ التغيير بصلاحية الجلسة الحالية.");
        if (response.status === 401 || response.status === 403) router.refresh();
      } else {
        setNotice("تعذّر تأكيد الحفظ. أعد التحقق من العملية نفسها.");
      }
    } catch {
      if (!controller.signal.aborted) setNotice("تعذّر تأكيد الحفظ. أعد التحقق من العملية نفسها.");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section aria-labelledby="store-pause-heading">
      <h2 id="store-pause-heading">التدخل التشغيلي</h2>
      {notice ? <Alert type="warning" showIcon message={notice} /> : null}
      <Form layout="vertical" onFinish={save} style={{ maxWidth: 480 }}>
        {!paused ? (
          <Form.Item label="مدة الإيقاف بالدقائق" htmlFor="store-pause-minutes">
            <Input id="store-pause-minutes" inputMode="numeric" maxLength={6}
              disabled={Boolean(pending || reviewRequired)} value={minutes}
              onChange={event => setMinutes(event.target.value)} />
          </Form.Item>
        ) : null}
        <Form.Item label="سبب التدخل" htmlFor="store-pause-reason">
          <Input.TextArea id="store-pause-reason" maxLength={300} value={reason}
            disabled={Boolean(pending || reviewRequired)}
            onChange={event => setReason(event.target.value)} />
        </Form.Item>
        <Space wrap>
          <Button type="primary" htmlType="submit" loading={busy} disabled={!canSave}>
            {pending ? "إعادة التحقق من الحفظ" : paused ? "إنهاء الإيقاف المؤقت" : "إيقاف المتجر مؤقتًا"}
          </Button>
          {reviewRequired ? <Button onClick={() => window.location.reload()}>إعادة قراءة حالة المتجر</Button> : null}
        </Space>
      </Form>
    </section>
  );
}
