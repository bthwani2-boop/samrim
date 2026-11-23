"use client";

import type { CityStoreOperationalPolicyHistoryPage } from "@bthwani/dsh";
import { Alert, Button, Card, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { readCityPolicyHistory } from "./city-policy-command";

export default function CityPolicyHistory({ actorId, city, endpoint }: Readonly<{
  actorId: string; city: string; endpoint: string;
}>) {
  const [page, setPage] = useState<CityStoreOperationalPolicyHistoryPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  async function read(beforeVersion?: string) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setPage(null);
    setError(false);
    try {
      const result = await readCityPolicyHistory(endpoint, city, actorId, beforeVersion, controller.signal);
      if (!controller.signal.aborted && active.current === controller) setPage(result);
    } catch {
      if (!controller.signal.aborted && active.current === controller) setError(true);
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  return <Card title="سجل تغييرات سياسة المدينة" style={{ marginBlockEnd: 16 }}>
    <Typography.Paragraph>سجل DSH غير القابل للتعديل. لا تُعد السياسة التاريخية إتاحة حالية للمتاجر.</Typography.Paragraph>
    <Space wrap>
      <Button disabled={busy} loading={busy} onClick={() => void read()}>قراءة سجل الإصدارات</Button>
      {page?.nextBeforeVersion && <Button disabled={busy}
        onClick={() => void read(page.nextBeforeVersion)}>الإصدارات الأقدم</Button>}
    </Space>
    {error && <Alert showIcon type="error" role="alert" message="تعذرت قراءة السجل من DSH أو لم تعد الصلاحية متاحة." />}
    {page && (page.entries.length === 0 ? <p role="status">لا توجد إصدارات موثقة في هذه الصفحة.</p> :
      <ol aria-label="الإصدارات التاريخية">
        {page.entries.map(entry => <li key={entry.version} style={{ marginBlock: 12 }}>
          <strong>الإصدار {entry.version}</strong>
          <p>الحد الأقصى للإيقاف: {entry.maxPauseSeconds} ثانية — التحضير: {entry.maxPreparationMinutes} دقيقة.</p>
          <p>المشغّل: {entry.changedByActor} — <time dateTime={entry.updatedAt}>{entry.updatedAt}</time></p>
          <p>السبب: {entry.changeReason}</p>
        </li>)}
      </ol>)}
  </Card>;
}
