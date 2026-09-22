"use client";

import { type JoiningCaseListResponse, joiningCaseStateLabel } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";

export function JoiningCaseQueue() {
  const [cases, setCases] = useState<JoiningCaseListResponse["cases"]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadQueue = useCallback(async (cursor?: string, append = false) => {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/partners/joining-cases?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        setError(await partnerErrorMessage(response));
        return;
      }
      const payload = await response.json() as JoiningCaseListResponse;
      setCases((current) => append ? [...current, ...payload.cases] : payload.cases);
      setNextCursor(payload.nextCursor);
    } catch {
      setError("تعذر قراءة طابور حالات الانضمام.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  return (
    <section className="access-card" aria-labelledby="joining-case-queue-title">
      <div className="access-card-heading">
        <span className="step-chip">المورد: حالات الانضمام</span>
        <p className="eyebrow">إدارة الشركاء</p>
        <h2 id="joining-case-queue-title">طابور حالات انضمام الشركاء</h2>
        <p className="muted">اختر حالة لفتح تفاصيلها وعملياتها القانونية. القراءة من DSH ولا تعتمد على حالة محلية في المتصفح.</p>
      </div>
      <div className="managed-status managed-status-info">
        <div className="button-row">
          <Link className="button button-primary" href="/partners/new">إضافة شريك</Link>
          <Link className="button button-secondary" href="/partners/service-cities">إدارة مدن الخدمة</Link>
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => void loadQueue()}>إعادة القراءة</button>
        </div>
        {busy && cases.length === 0 ? <p role="status">جارٍ تحميل الطابور…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {!busy && !error && cases.length === 0 ? <p>لا توجد حالات انضمام حاليًا.</p> : null}
        {cases.length > 0 ? (
          <ul>
            {cases.map((item) => (
              <li key={item.id}>
                <Link href={`/partners/${encodeURIComponent(item.id)}`}>
                  {joiningCaseStateLabel(item.state)} · {item.businessName} · {item.firstStoreName}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {nextCursor ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void loadQueue(nextCursor, true)}>تحميل المزيد</button> : null}
      </div>
    </section>
  );
}
