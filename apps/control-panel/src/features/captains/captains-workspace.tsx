"use client";

import { Alert, Button, Card, Select, Space, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  captainStatusLabels as labels, type CaptainPage as Page, readCaptainPage,
  readCaptainJson as readJson,
  type CaptainStanding as Standing, type CaptainStatus as Status,captainStatuses as statuses, isCaptainStanding as valid,
} from "./captains-read-client";

export default function CaptainsWorkspace({ title = "الكباتن" }: Readonly<{ title?: string }>) {
  const [status, setStatus] = useState<Status>("PENDING");
  const [cursors, setCursors] = useState([""]);
  const cursor = cursors.at(-1) ?? "";
  const [page, setPage] = useState<(Page & { operatorBinding: string }) | null>(null);
  const [selected, setSelected] = useState<Standing | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const detailAbort = useRef<AbortController | null>(null);
  const listAbort = useRef<AbortController | null>(null);
  const activePage = useRef<(Page & { operatorBinding: string }) | null>(null);
  const binding = useRef<string | undefined>(undefined);

  const invalidate = useCallback(() => {
    listAbort.current?.abort();
    detailAbort.current?.abort();
    activePage.current = null;
    setLoading(true);
    setError("");
    setPage(null);
    setSelected(null);
  }, []);
  const refresh = useCallback(() => {
    invalidate();
    binding.current = undefined;
    setCursors([""]);
    setRevision(value => value + 1);
  }, [invalidate]);

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [refresh]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh revision deliberately refetches the current page.
  useEffect(() => {
    invalidate();
    const controller = new AbortController();
    listAbort.current = controller;
    const query = new URLSearchParams({ status, limit: "20" });
    if (cursor) query.set("cursor", cursor);
    void readCaptainPage(`/api/captains?${query.toString()}`, controller.signal, binding.current)
      .then(({ value, operatorBinding }) => {
        if (controller.signal.aborted) return;
        if (typeof value !== "object" || value === null || !Array.isArray((value as Page).items) ||
          !(value as Page).items.every(valid) ||
          ((value as Page).nextCursor !== undefined &&
            (typeof (value as Page).nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test((value as Page).nextCursor ?? "")))) {
          throw new Error("استجابة غير صالحة من خدمة الكباتن.");
        }
        const current = { ...(value as Page), operatorBinding };
        binding.current = operatorBinding;
        activePage.current = current;
        setPage(current);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "تعذّرت القراءة.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
        if (listAbort.current === controller) listAbort.current = null;
      });
    return () => { controller.abort(); detailAbort.current?.abort(); activePage.current = null; };
  }, [status, cursor, revision, invalidate]);

  const showDetail = useCallback(async (actorId: string) => {
    if (!page || activePage.current !== page || !page.items.some(item => item.actorId === actorId)) return;
    const { operatorBinding } = page;
    detailAbort.current?.abort();
    const controller = new AbortController();
    detailAbort.current = controller;
    setSelected(null);
    setError("");
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
      const value = await readJson(`/api/captains/${encodeURIComponent(actorId)}/standing`, signal, operatorBinding);
      if (!valid(value) || value.actorId !== actorId) throw new Error("تفاصيل غير صالحة من خدمة الكباتن.");
      if (!controller.signal.aborted && activePage.current === page) setSelected(value);
    } catch (reason) {
      if (!controller.signal.aborted && activePage.current === page) {
        activePage.current = null;
        setPage(null);
        setError(reason instanceof Error ? reason.message : "تعذّرت قراءة التفاصيل.");
      }
    } finally {
      if (detailAbort.current === controller) detailAbort.current = null;
    }
  }, [page]);

  const navigate = (next: string[]) => {
    if (!page || activePage.current !== page || next.at(-1) === cursor) return;
    invalidate();
    setCursors(next);
  };

  return (
    <main style={{ padding: 24, maxWidth: 1100, marginInline: "auto" }} aria-labelledby="captains-heading">
      <Typography.Title level={1} id="captains-heading">{title}</Typography.Title>
      <Typography.Paragraph>مراجعة الحالة التشغيلية الحالية لدى DSH. هذه شاشة قراءة فقط؛ لا تمنح صلاحيات الكابتن ولا تغيّر حالته.</Typography.Paragraph>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select aria-label="تصفية حالة الكباتن" value={status} style={{ minWidth: 180 }}
          options={[...statuses]} onChange={(value: Status) => { setStatus(value); refresh(); }} />
        <a href="/captains/registrations">تسجيلات الراغبين بالانضمام</a>
      </Space>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }}
        action={<Button onClick={refresh} disabled={loading}>إعادة المحاولة</Button>} />}
      {(loading || (page !== null && !error)) && <Card title="سجل أهلية الكباتن">
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
        {(cursor || page?.nextCursor) && <Space wrap style={{ marginTop: 16 }}>
          {cursor && <Button disabled={loading} onClick={() => navigate(cursors.slice(0, -1))}>الصفحة السابقة</Button>}
          {cursors.length > 2 && <Button disabled={loading} onClick={() => navigate([""])}>الصفحة الأولى</Button>}
          {page?.nextCursor && !cursors.includes(page.nextCursor) && <Button disabled={loading}
            onClick={() => { if (page.nextCursor) navigate([...cursors, page.nextCursor]); }}>الصفحة التالية</Button>}
        </Space>}
      </Card>}
      {selected && <Card style={{ marginTop: 16 }} title="الحالة الحالية للكابتن" extra={<Button onClick={() => setSelected(null)}>إغلاق</Button>}>
        <Typography.Paragraph>المعرّف: <Typography.Text copyable>{selected.actorId}</Typography.Text></Typography.Paragraph>
        <Typography.Paragraph>الحالة: {labels[selected.status]}</Typography.Paragraph>
        <Typography.Paragraph>الإصدار: {selected.version}</Typography.Paragraph>
      </Card>}
    </main>
  );
}
