"use client";

import type { OperatorPermissionChange, OperatorPermissionRevision } from "@bthwani/identity";
import { Alert, Button, Form, Input, Select } from "antd";
import { useEffect, useRef, useState } from "react";
import { type OperatorPermission, operatorPermissionLabels, operatorPermissions } from "../session/operator-permissions";

const choices = operatorPermissions.map(value => ({ value, label: operatorPermissionLabels[value] }));
const unconfirmed = "تعذّر تأكيد الحفظ. أعد التحقق من الطلب نفسه قبل إجراء تعديل جديد.";
const denied = "تعذّر إكمال التغيير. أعد قراءة الصلاحيات بجلسة المشغّل الأساسية.";

type Attempt = OperatorPermissionChange & { permission: OperatorPermission };

export default function OperatorPermissionForm({ actorId, originalActorId, permissions }: Readonly<{
  actorId: string;
  originalActorId: string;
  permissions: readonly OperatorPermissionRevision[];
}>) {
  const [permission, setPermission] = useState<OperatorPermission>("operations");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [pending, setPending] = useState<Attempt | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const revision = permissions.find(item => item.permission === permission);
  const nextState = revision?.state === "ACTIVE" ? "REVOKED" : "ACTIVE";
  const cleanReason = reason.trim();
  const reasonLength = Array.from(cleanReason).length;
  const canSave = !busy && !reviewRequired && Boolean(pending || (reasonLength >= 10 && reasonLength <= 500));

  async function save() {
    if (!canSave || request.current) return;
    const command = pending ?? {
      permission,
      state: nextState,
      expectedVersion: revision?.version ?? 0,
      operationId: crypto.randomUUID(),
      reason: cleanReason,
    };
    const controller = new AbortController();
    request.current = controller;
    setPending(command);
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/access/operators/${encodeURIComponent(actorId)}/permissions/${command.permission}`, {
          method: "PATCH",
          credentials: "same-origin",
          redirect: "error",
          cache: "no-store",
          headers: { "X-BThwani-Operator": encodeURIComponent(originalActorId) },
          body: new URLSearchParams({
            state: command.state,
            expectedVersion: String(command.expectedVersion),
            operationId: command.operationId,
            reason: command.reason,
          }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        },
      );
      if (controller.signal.aborted) return;
      if (response.status === 200) {
        const result: OperatorPermissionRevision = await response.json();
        if (!controller.signal.aborted && result?.permission === command.permission &&
            result.state === command.state && result.version === command.expectedVersion + 1) {
          setReviewRequired(true);
          window.location.reload();
          return;
        }
        setNotice(unconfirmed);
      } else if (response.status === 400 && !pending) {
        setPending(null);
        setNotice("رُفض الطلب. تحقّق من سبب التغيير وأعد المحاولة.");
      } else if ([400, 401, 403, 404, 409].includes(response.status)) {
        setReviewRequired(true);
        setNotice(response.status === 409
          ? "تغيّر إصدار الصلاحية. أعد قراءتها قبل إرسال طلب جديد."
          : denied);
      } else {
        setNotice(unconfirmed);
      }
    } catch {
      if (!controller.signal.aborted) setNotice(unconfirmed);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section aria-labelledby="operator-permission-change-heading">
      <h2 id="operator-permission-change-heading">تغيير صلاحية</h2>
      <p>بعد اعتماد التغيير، يحتاج المشغّل المستهدف إلى تسجيل الدخول مجددًا.</p>
      {notice && <Alert type="warning" showIcon message={notice} />}
      <Form layout="vertical" onFinish={save} style={{ maxWidth: 480 }}>
        <Form.Item label="الصلاحية" htmlFor="operator-permission-change-scope">
          <Select id="operator-permission-change-scope" options={choices} value={permission}
            onChange={setPermission} disabled={Boolean(pending || reviewRequired)} />
        </Form.Item>
        <Form.Item label="سبب التغيير" htmlFor="operator-permission-change-reason" extra="من 10 إلى 500 حرف.">
          <Input id="operator-permission-change-reason" value={reason} maxLength={1000}
            onChange={event => setReason(event.target.value)} disabled={Boolean(pending || reviewRequired)} />
        </Form.Item>
        {reviewRequired ? <Button onClick={() => window.location.reload()}>إعادة قراءة الصلاحيات</Button> : (
          <Button type="primary" htmlType="submit" loading={busy} disabled={!canSave} danger={nextState === "REVOKED"}>
            {pending ? "التحقق من الطلب نفسه" : nextState === "ACTIVE" ? "منح الصلاحية" : "إلغاء الصلاحية"}
          </Button>
        )}
      </Form>
    </section>
  );
}
