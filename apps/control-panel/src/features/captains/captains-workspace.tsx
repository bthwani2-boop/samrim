"use client";

import { Alert, Button, Card, Select, Space, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  captainStatusLabels as labels, type CaptainPage as Page,
  readCaptainJson as readJson,
  type CaptainStanding as Standing, type CaptainStatus as Status,captainStatuses as statuses, isCaptainStanding as valid,
} from "./captains-read-client";

export default function CaptainsWorkspace({ title = "الكباتن" }: Readonly<{ title?: string }>) {
  const [status, setStatus] = useState<Status>("PENDING");
  const [cursor, setCursor] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [selected, setSelected] = useState<Standing | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const detailAbort = useRef<AbortController | null>(null);

  const refresh = useCallback(() => { setCursor(""); setSelected(null); setPage(null); setRevision(value => value + 1); }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh revision deliberately refetches the current page.
  useEffect(() => {
    const controller = new AbortController();
    detailAbort.current?.abort();
    setLoading(true);
    setError("");
    setPage(null);
    setSelected(null);
    const query = new URLSearchParams({ status, limit: "20" });
    if (cursor) query.set("cursor", cursor);
    void readJson(`/api/captains?${query.toString()}`, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        if (typeof value !== "object" || value === null || !Array.isArray((value as Page).items) ||
          !(value as Page).items.every(valid) ||
          ((value as Page).nextCursor !== undefined &&
            (typeof (value as Page).nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test((value as Page).nextCursor ?? "")))) {
          throw new Error("استجابة غير صالحة من خدمة الكباتن.");
        }
        setPage(value as Page);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "تعذّرت القراءة.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); detailAbort.current?.abort(); };
  }, [status, cursor, revision]);

  const showDetail = useCallback(async (actorId: string) => {
    detailAbort.current?.abort();
    const controller = new AbortController();
    detailAbort.current = controller;
    setSelected(null);
    setError("");
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
      const value = await readJson(`/api/captains/${encodeURIComponent(actorId)}/standing`, signal);
      if (!valid(value) || value.actorId !== actorId) throw new Error("تفاصيل غير صالحة من خدمة الكباتن.");
      if (!controller.signal.aborted) setSelected(value);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "تعذّرت قراءة التفاصيل.");
    } finally {
      if (detailAbort.current === controller) detailAbort.current = null;
    }
  }, []);

  return (
    <main style={{ padding: 24, maxWidth: 1100, marginInline: "auto" }} aria-labelledby="captains-heading">
      <Typography.Title level={2} id="captains-heading">{title}</Typography.Title>
      <Typography.Paragraph>مراجعة الحالة التشغيلية الحالية لدى DSH. هذه شاشة قراءة فقط؛ لا تمنح صلاحيات الكابتن ولا تغيّر حالته.</Typography.Paragraph>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select aria-label="تصفية حالة الكباتن" value={status} style={{ minWidth: 180 }}
          options={[...statuses]} onChange={(value: Status) => { setStatus(value); setCursor(""); setPage(null); setSelected(null); }} />
        <Button onClick={refresh} disabled={loading}>تحديث</Button>
      </Space>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Card title="سجل طلبات الكباتن">
        <Table<Standing> rowKey="actorId" size="middle" loading={loading} dataSource={page?.items ?? []}
          pagination={false} locale={{ emptyText: "لا توجد سجلات في هذه الحالة." }}
          columns={[
            { title: "معرّف الكابتن", dataIndex: "actorId", key: "actorId" },
            { title: "الحالة", dataIndex: "status", key: "status",
              render: (value: Status) => <Tag>{labels[value]}</Tag> },
            { title: "الإصدار", dataIndex: "version", key: "version" },
            { title: "التفاصيل", key: "action", render: (_, record) =>
              <Space>
                <Button onClick={() => { void showDetail(record.actorId); }}>عرض سريع</Button>
                <a href={`/captains/${encodeURIComponent(record.actorId)}`}>فتح الملف</a>
              </Space> },
          ]} />
        {page?.nextCursor && <Button style={{ marginTop: 16 }} disabled={loading}
          onClick={() => setCursor(page.nextCursor ?? "")}>الصفحة التالية</Button>}
      </Card>
      {selected && <Card style={{ marginTop: 16 }} title="الحالة الحالية للكابتن" extra={<Button onClick={() => setSelected(null)}>إغلاق</Button>}>
        <Typography.Paragraph>المعرّف: <Typography.Text copyable>{selected.actorId}</Typography.Text></Typography.Paragraph>
        <Typography.Paragraph>الحالة: {labels[selected.status]}</Typography.Paragraph>
        <Typography.Paragraph>الإصدار: {selected.version}</Typography.Paragraph>
      </Card>}
    </main>
  );
}
