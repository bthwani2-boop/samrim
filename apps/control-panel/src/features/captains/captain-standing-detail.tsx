"use client";

import { Alert, Button, Card, Space, Spin, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CaptainStanding,
  captainStatusLabels, isCaptainStanding, readCaptainJson,
} from "./captains-read-client";

export default function CaptainStandingDetail({ actorId }: Readonly<{ actorId: string }>) {
  const [standing, setStanding] = useState<CaptainStanding | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
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
      if (!controller.signal.aborted) setStanding(value);
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

  return (
    <main style={{ padding: 24, maxWidth: 900, marginInline: "auto" }} aria-labelledby="captain-detail-heading">
      <Space wrap style={{ marginBottom: 16 }}>
        <a href="/captains">العودة إلى قائمة الكباتن</a>
        <Button onClick={() => { void load(); }} disabled={loading}>تحديث الحالة</Button>
      </Space>
      <Typography.Title level={2} id="captain-detail-heading">ملف الكابتن</Typography.Title>
      <Typography.Paragraph>البيانات الحالية من DSH للقراءة فقط؛ لا يغيّر عرض الملف الحالة أو صلاحيات Identity.</Typography.Paragraph>
      {loading && <Spin tip="جارٍ قراءة الحالة" size="large"><div style={{ minHeight: 80 }} /></Spin>}
      {error && <Alert type="error" showIcon message={error} />}
      {standing && (
        <Card title="الحالة التشغيلية">
          <Typography.Paragraph>معرّف الكابتن: <Typography.Text copyable>{standing.actorId}</Typography.Text></Typography.Paragraph>
          <Typography.Paragraph>الحالة: {captainStatusLabels[standing.status]}</Typography.Paragraph>
          <Typography.Paragraph>الإصدار الحالي: {standing.version}</Typography.Paragraph>
        </Card>
      )}
    </main>
  );
}
