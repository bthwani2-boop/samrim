"use client";

import type { CityStoreOperationalPolicy, CityStoreOperationalPolicyHistoryPage } from "@bthwani/dsh";
import { Alert, Button, Card, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { readCityPolicyHistory } from "./city-policy-command";

export default function CityPolicyHistory({ actorId, city, endpoint, current, onDraft }: Readonly<{
  actorId: string; city: string; endpoint: string;
  current: CityStoreOperationalPolicy | null;
  onDraft: ((entry: CityStoreOperationalPolicy) => void) | undefined;
}>) {
  const [page, setPage] = useState<CityStoreOperationalPolicyHistoryPage | null>(null);
  const [cursors, setCursors] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  async function read(target: readonly string[] = []) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setCursors(target);
    setBusy(true);
    setPage(null);
    setError(false);
    try {
      const result = await readCityPolicyHistory(endpoint, city, actorId, target.at(-1), controller.signal);
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

  const olderCursor = page?.nextBeforeVersion;
  return <Card title="سجل تغييرات سياسة المدينة" style={{ marginBlockEnd: 16 }}>
    <Typography.Paragraph>سجل DSH غير القابل للتعديل. لا تُعد السياسة التاريخية إتاحة حالية للمتاجر.</Typography.Paragraph>
    <Space wrap>
      <Button disabled={busy} loading={busy} onClick={() => void read()}>قراءة سجل الإصدارات</Button>
      {cursors.length > 0 && <Button disabled={busy}
        onClick={() => void read(cursors.slice(0, -1))}>الإصدارات الأحدث</Button>}
      {olderCursor && <Button disabled={busy}
        onClick={() => void read([...cursors, olderCursor])}>الإصدارات الأقدم</Button>}
    </Space>
    {error && <Alert showIcon type="error" role="alert" message="تعذرت قراءة السجل من DSH أو لم تعد الصلاحية متاحة."
      action={<Button onClick={() => void read(cursors)}>إعادة قراءة الصفحة</Button>} />}
    {page && (page.entries.length === 0 ? <p role="status">لا توجد إصدارات موثقة في هذه الصفحة.</p> :
      <ol aria-label="الإصدارات التاريخية">
        {page.entries.map(entry => <li key={entry.version} style={{ marginBlock: 12 }}>
          <strong>الإصدار {entry.version}</strong>
          <p>الحد الأقصى للإيقاف: {entry.maxPauseSeconds} ثانية — التحضير: {entry.maxPreparationMinutes} دقيقة.</p>
          <p>المشغّل: {entry.changedByActor} — <time dateTime={entry.updatedAt}>{entry.updatedAt}</time></p>
          <p>السبب: {entry.changeReason}</p>
          {current && current.cityId === city && entry.cityId === city && entry.version < current.version && (
            <section aria-label="مقارنة الإصدار التاريخي بالحالي">
              <Typography.Paragraph>مقارنة مع الإصدار الحالي {current.version} (التاريخي ← الحالي)</Typography.Paragraph>
              <p>الإيقاف: {entry.maxPauseSeconds} ← {current.maxPauseSeconds} ثانية</p>
              <p>التحضير: {entry.maxPreparationMinutes} ← {current.maxPreparationMinutes} دقيقة</p>
              {onDraft && <Button onClick={() => onDraft(entry)}>استخدام القيم كمسودة</Button>}
            </section>
          )}
        </li>)}
      </ol>)}
  </Card>;
}
