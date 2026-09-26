"use client";

import { type CatalogProductProposal, catalogProductProposalStateLabel, type JoiningCaseSummary, joiningCaseStateLabel, type Notification, type OperatorOperationListItem, orderStateLabel } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { responseMessage } from "../access/identity-error-message";
import { notificationKindLabel } from "../notifications/notification-presentation";
import "./operator-home.module.css";

export function OperatorHome() {
  const { state: sessionState } = useSession();
  const permissions = sessionState.kind === "authenticated" ? sessionState.identity.permissions ?? [] : [];
  const sessionReady = sessionState.kind !== "loading";
  const canReadOperations = permissions.includes("operations");
  const canReadPartners = permissions.includes("partners");
  const canReadCatalog = permissions.includes("catalog");
  const [operations, setOperations] = useState<ReadonlyArray<OperatorOperationListItem>>([]);
  const [joiningCases, setJoiningCases] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [proposals, setProposals] = useState<ReadonlyArray<CatalogProductProposal>>([]);
  const [unreadNotifications, setUnreadNotifications] = useState<ReadonlyArray<Notification>>([]);
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
      ...(canReadPartners ? [{ key: "joiningCases", url: "/api/partners/joining-cases?state=submitted&limit=8" }] : []),
      ...(canReadCatalog ? [{ key: "proposals", url: "/api/catalog/proposals?state=submitted&limit=8" }] : []),
      { key: "notifications", url: "/api/notifications?limit=100" },
    ] as const;
    const results = await Promise.allSettled(requests.map(async ({ key, url }) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      return { key, body: await response.json() as unknown };
    }));
    if (sequence !== requestSequence.current) return;
    const nextErrors: Record<string, string> = {};
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        nextErrors[requests[index]!.key] = result.reason instanceof Error ? result.reason.message : "تعذرت قراءة قائمة العمل.";
        return;
      }
      const { key, body } = result.value;
      if (!body || typeof body !== "object") {
        nextErrors[key] = "استجابة قائمة العمل غير صالحة.";
        return;
      }
      if (key === "operations") setOperations((body as { operations?: ReadonlyArray<OperatorOperationListItem> }).operations ?? []);
      else if (key === "joiningCases") setJoiningCases((body as { cases?: ReadonlyArray<JoiningCaseSummary> }).cases ?? []);
      else if (key === "proposals") setProposals((body as { proposals?: ReadonlyArray<CatalogProductProposal> }).proposals ?? []);
      else if (key === "notifications") setUnreadNotifications(((body as { notifications?: ReadonlyArray<Notification> }).notifications ?? []).filter((item) => !item.readAt).slice(0, 4));
    });
    setErrors(nextErrors);
    setLoading(false);
  }, [canReadCatalog, canReadOperations, canReadPartners, sessionReady]);

  useEffect(() => {
    void loadQueues();
    return () => { requestSequence.current += 1; };
  }, [loadQueues]);

  return (
    <section className="workspace-page" aria-labelledby="workspace-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">مركز العمل الحالي</p>
        <h1 id="workspace-title">الرئيسية</h1>
        <p className="lead">تجمع هذه الصفحة الأعمال التي تحتاج انتباه المشغل الآن من قراءات DSH الكانونية، دون مؤشرات تحليلية مخترعة.</p>
        <button type="button" className="button button-secondary" onClick={() => void loadQueues()} disabled={loading}>إعادة قراءة قوائم العمل</button>
      </div>
      {loading ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ تجهيز مركز العمل</strong></div> : null}
      {!loading ? (
        <div className="home-work-areas">
          {canReadOperations ? <section className="home-work-area" aria-labelledby="home-operations-title">
            <div className="home-work-area-heading"><div><p className="eyebrow">التشغيل</p><h2 id="home-operations-title">طلبات تحتاج إجراءً</h2></div><Link href="/operations">فتح العمليات</Link></div>
            {errors.operations ? <QueueError message={errors.operations} /> : operations.length === 0 ? <p className="empty-inline">لا توجد طلبات تحتاج إجراءً في القراءة الحالية.</p> : <ul className="home-list">{operations.slice(0, 4).map((item) => <li key={item.orderId}><Link href={`/operations/${encodeURIComponent(item.orderId)}`}><span><strong>{item.storeName}</strong><small><bdi dir="ltr">{item.orderId}</bdi></small></span><strong>{orderStateLabel(item.state)}</strong></Link></li>)}</ul>}
          </section> : null}
          {canReadPartners ? <section className="home-work-area" aria-labelledby="home-joining-title">
            <div className="home-work-area-heading"><div><p className="eyebrow">الشركاء</p><h2 id="home-joining-title">طلبات الانضمام المقدمة</h2></div><Link href="/partners">فتح الشركاء</Link></div>
            {errors.joiningCases ? <QueueError message={errors.joiningCases} /> : joiningCases.length === 0 ? <p className="empty-inline">لا توجد طلبات انضمام مقدمة تحتاج المراجعة.</p> : <ul className="home-list">{joiningCases.slice(0, 4).map((item) => <li key={item.id}><Link href={`/partners/${encodeURIComponent(item.id)}`}><span><strong>{item.businessName}</strong><small><bdi dir="ltr">{item.id}</bdi></small></span><strong>{joiningCaseStateLabel(item.state)}</strong></Link></li>)}</ul>}
          </section> : null}
          {canReadCatalog ? <section className="home-work-area" aria-labelledby="home-proposals-title">
            <div className="home-work-area-heading"><div><p className="eyebrow">الكتالوج</p><h2 id="home-proposals-title">مقترحات منتجات للمراجعة</h2></div><Link href="/catalog/proposals">فتح المقترحات</Link></div>
            {errors.proposals ? <QueueError message={errors.proposals} /> : proposals.length === 0 ? <p className="empty-inline">لا توجد مقترحات مقدمة تنتظر المراجعة.</p> : <ul className="home-list">{proposals.slice(0, 4).map((item) => <li key={item.id}><Link href={`/catalog/proposals?proposalId=${encodeURIComponent(item.id)}`}><span><strong>{item.proposedName}</strong><small><bdi dir="ltr">{item.id}</bdi></small></span><strong>{catalogProductProposalStateLabel(item.state)}</strong></Link></li>)}</ul>}
          </section> : null}
          <section className="home-work-area" aria-labelledby="home-notifications-title">
            <div className="home-work-area-heading"><div><p className="eyebrow">الإشعارات</p><h2 id="home-notifications-title">إشعارات غير مقروءة</h2></div><Link href="/notifications">فتح الإشعارات</Link></div>
            {errors.notifications ? <QueueError message={errors.notifications} /> : unreadNotifications.length === 0 ? <p className="empty-inline">لا توجد إشعارات غير مقروءة ضمن القراءة الحالية.</p> : <ul className="home-list">{unreadNotifications.map((item) => <li key={item.id}><Link href="/notifications"><span><strong>{item.title}</strong><small>{item.body}</small></span><strong>{notificationKindLabel(item.kind)}</strong></Link></li>)}</ul>}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function QueueError({ message }: Readonly<{ message: string }>) {
  return <p className="home-queue-error" role="alert">تعذرت قراءة هذا الطابور: {message}</p>;
}
