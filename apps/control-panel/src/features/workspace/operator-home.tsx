"use client";

import { type CatalogProductProposal, catalogProductProposalStateLabel, type JoiningCaseSummary, joiningCaseStateLabel, type Notification, type OperatorOperationListItem, orderStateLabel } from "@bthwani/dsh";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { PageHeader } from "../../shell/page-header";
import { responseMessage } from "../access/identity-error-message";
import { notificationKindLabel } from "../notifications/notification-presentation";
import { operationResponseMessage } from "../operations/operator-actions";
import { useReadOnReturn } from "../shared/use-read-on-return";
export function OperatorHome() {
  const { state: sessionState } = useSession();
  const permissions = sessionState.kind === "authenticated" ? sessionState.identity.permissions ?? [] : [];
  const sessionReady = sessionState.kind !== "loading";
  const canReadOperations = permissions.includes("operations");
  const canReadPartners = permissions.includes("partners");
  const canReadCatalog = permissions.includes("catalog");
  const [operations, setOperations] = useState<ReadonlyArray<OperatorOperationListItem>>([]);
  const [joiningCases, setJoiningCases] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [joiningAdmissions, setJoiningAdmissions] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [proposals, setProposals] = useState<ReadonlyArray<CatalogProductProposal>>([]);
  const [unreadNotifications, setUnreadNotifications] = useState<ReadonlyArray<Notification>>([]);
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const requestSequence = useRef(0);

  const loadQueues = useCallback(async () => {
    if (!sessionReady) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setErrors({});
    const requests = [
      ...(canReadOperations ? [{ key: "operations", url: "/api/operations?limit=8&actionableOnly=true" }] : []),
      ...(canReadPartners ? [
        { key: "joiningAdmissions", url: "/api/partners/joining-cases?state=admission_requested&limit=4" },
        { key: "joiningCases", url: "/api/partners/joining-cases?state=submitted&limit=4" },
      ] : []),
      ...(canReadCatalog ? [{ key: "proposals", url: "/api/catalog/proposals?state=submitted&limit=8" }] : []),
      { key: "notifications", url: "/api/notifications?limit=50" },
    ] as const;
    const results = await Promise.allSettled(requests.map(async ({ key, url }) => {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(await (key === "operations" ? operationResponseMessage(response) : responseMessage(response)));
      return { key, body: await response.json().catch(() => null) as unknown };
    }));
    if (sequence !== requestSequence.current) return;
    const nextErrors: Record<string, string> = {};
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        nextErrors[requests[index]!.key] = result.reason instanceof Error ? result.reason.message : "تعذرت قراءة قائمة العمل.";
        if (requests[index]!.key === "notifications") setUnreadTotal(null);
        return;
      }
      const { key, body } = result.value;
      if (!body || typeof body !== "object") {
        nextErrors[key] = "استجابة قائمة العمل غير صالحة.";
        if (key === "notifications") setUnreadTotal(null);
        return;
      }
      const collectionKey = key === "operations" ? "operations" : key === "proposals" ? "proposals" : key === "notifications" ? "notifications" : "cases";
      if (!Array.isArray((body as Record<string, unknown>)[collectionKey])) {
        nextErrors[key] = "استجابة قائمة العمل غير صالحة.";
        if (key === "notifications") { setUnreadNotifications([]); setUnreadTotal(null); }
        return;
      }
      if (key === "operations") setOperations((body as { operations: ReadonlyArray<OperatorOperationListItem> }).operations);
      else if (key === "joiningCases") setJoiningCases((body as { cases: ReadonlyArray<JoiningCaseSummary> }).cases);
      else if (key === "joiningAdmissions") setJoiningAdmissions((body as { cases: ReadonlyArray<JoiningCaseSummary> }).cases);
      else if (key === "proposals") setProposals((body as { proposals: ReadonlyArray<CatalogProductProposal> }).proposals);
      else if (key === "notifications") {
        const payload = body as { notifications: ReadonlyArray<Notification>; unreadCount?: unknown };
        setUnreadNotifications(payload.notifications.filter((item) => !item.readAt).slice(0, 4));
        setUnreadTotal(typeof payload.unreadCount === "number" && Number.isSafeInteger(payload.unreadCount) && payload.unreadCount >= 0 ? payload.unreadCount : null);
      }
    });
    setErrors(nextErrors);
    setLoading(false);
  }, [canReadCatalog, canReadOperations, canReadPartners, sessionReady]);
  useReadOnReturn(loadQueues, sessionReady && !loading);

  useEffect(() => {
    void loadQueues();
    return () => { requestSequence.current += 1; };
  }, [loadQueues]);

  return (
    <section className="workspace-page" aria-labelledby="workspace-title">
      <PageHeader id="workspace-title" title="الرئيسية" actions={Object.keys(errors).length ? <button type="button" className="button button-secondary" onClick={() => void loadQueues()} disabled={loading}>إعادة المحاولة</button> : null} />
      {loading ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ تجهيز مركز العمل</strong></div> : null}
      {!loading ? (
        <div className="home-work-areas">
          {canReadOperations ? <section className="home-work-area" aria-labelledby="home-operations-title">
            <div className="home-work-area-heading"><div><h2 id="home-operations-title">طلبات تحتاج إجراءً</h2></div><Link href="/operations?lane=attention">عرض الكل</Link></div>
            <QueueContent error={errors.operations} emptyMessage="لا توجد طلبات في هذه القائمة." hasItems={operations.length > 0}>
              <ul className="home-list">{operations.slice(0, 4).map((item) => <li key={item.orderId}><Link href={`/operations/${encodeURIComponent(item.orderId)}`}><span><strong>{item.storeName}</strong></span><strong>{orderStateLabel(item.state)}</strong></Link></li>)}</ul>
            </QueueContent>
          </section> : null}
          {canReadPartners ? <>
            <section className="home-work-area" aria-labelledby="home-joining-admission-title">
              <div className="home-work-area-heading"><div><h2 id="home-joining-admission-title">قبول إحالات الميدانيين</h2></div><Link href="/partners/joining?state=admission_requested">عرض الكل</Link></div>
              <QueueContent error={errors.joiningAdmissions} emptyMessage="لا توجد إحالات في هذه القائمة." hasItems={joiningAdmissions.length > 0}>
                <ul className="home-list">{joiningAdmissions.map((item) => <li key={item.id}><Link href={`/partners/${encodeURIComponent(item.id)}`}><span><strong>{item.businessName}</strong></span><strong>{joiningCaseStateLabel(item.state)}</strong></Link></li>)}</ul>
              </QueueContent>
            </section>
            <section className="home-work-area" aria-labelledby="home-joining-title">
              <div className="home-work-area-heading"><div><h2 id="home-joining-title">طلبات الانضمام</h2></div><Link href="/partners/joining?state=submitted">عرض الكل</Link></div>
              <QueueContent error={errors.joiningCases} emptyMessage="لا توجد طلبات في هذه القائمة." hasItems={joiningCases.length > 0}>
                <ul className="home-list">{joiningCases.map((item) => <li key={item.id}><Link href={`/partners/${encodeURIComponent(item.id)}`}><span><strong>{item.businessName}</strong></span><strong>{joiningCaseStateLabel(item.state)}</strong></Link></li>)}</ul>
              </QueueContent>
            </section>
          </> : null}
          {canReadCatalog ? <section className="home-work-area" aria-labelledby="home-proposals-title">
            <div className="home-work-area-heading"><div><h2 id="home-proposals-title">مقترحات المنتجات</h2></div><Link href="/catalog/proposals">عرض الكل</Link></div>
            <QueueContent error={errors.proposals} emptyMessage="لا توجد مقترحات في هذه القائمة." hasItems={proposals.length > 0}>
              <ul className="home-list">{proposals.slice(0, 4).map((item) => <li key={item.id}><Link href={`/catalog/proposals?proposalId=${encodeURIComponent(item.id)}`}><span><strong>{item.proposedName}</strong></span><strong>{catalogProductProposalStateLabel(item.state)}</strong></Link></li>)}</ul>
            </QueueContent>
          </section> : null}
          <section className="home-work-area" aria-labelledby="home-notifications-title">
            <div className="home-work-area-heading"><div><h2 id="home-notifications-title">أحدث الإشعارات غير المقروءة</h2><p className="muted">{unreadTotal === null ? "العدد الإجمالي غير متاح" : `إجمالي غير المقروءة: ${unreadTotal}`}</p></div><Link href="/notifications">عرض الكل</Link></div>
            <QueueContent error={errors.notifications} emptyMessage={unreadTotal === 0 ? "لا توجد إشعارات غير مقروءة." : unreadTotal === null ? "عدد الإشعارات غير معروف. راجع صندوق الإشعارات." : "توجد إشعارات غير مقروءة في صفحات أقدم. افتح صندوق الإشعارات."} hasItems={unreadNotifications.length > 0}>
              <ul className="home-list">{unreadNotifications.map((item) => <li key={item.id}><Link href="/notifications"><span><strong>{item.title}</strong></span><strong>{notificationKindLabel(item.kind)}</strong></Link></li>)}</ul>
            </QueueContent>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function QueueError({ message }: Readonly<{ message: string }>) {
  return <p className="home-queue-error" role="alert">تعذرت القراءة: {message}</p>;
}

function QueueContent({ error, emptyMessage, hasItems, children }: Readonly<{ error: string | undefined; emptyMessage: string; hasItems: boolean; children: ReactNode }>) {
  if (error) return <QueueError message={error} />;
  if (!hasItems) return <p className="empty-inline">{emptyMessage}</p>;
  return <>{children}</>;
}
