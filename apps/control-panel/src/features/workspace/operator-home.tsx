"use client";

import { type CatalogProductProposal, catalogProductProposalStateLabel, type JoiningCaseSummary, joiningCaseStateLabel, type Notification, type OperatorOperationListItem, orderStateLabel } from "@bthwani/dsh";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { PageHeader } from "../../shell/page-header";
import { OperationalIcon, type OperationalIconName } from "../../shell/workspace-icon";
import { responseMessage } from "../access/identity-error-message";
import { notificationHref, notificationKindLabel, notificationKindTone } from "../notifications/notification-presentation";
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
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const requestSequence = useRef(0);
  const hasLoaded = useRef(false);
  const activeActor = useRef<string | null>(null);
  const actorKey = sessionState.kind === "authenticated" ? sessionState.identity.subject : null;
  const pageLoading = loading || activeActor.current !== actorKey;

  const loadQueues = useCallback(async () => {
    if (!sessionReady) return;
    const sequence = ++requestSequence.current;
    if (activeActor.current !== actorKey) {
      activeActor.current = actorKey;
      hasLoaded.current = false;
      setOperations([]);
      setJoiningCases([]);
      setJoiningAdmissions([]);
      setProposals([]);
      setUnreadNotifications([]);
      setUnreadTotal(null);
      setErrors({});
    }
    if (hasLoaded.current) setRefreshing(true); else setLoading(true);
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
      const request = requests[index];
      if (!request) return;
      if (result.status === "rejected") {
        nextErrors[request.key] = queueFailureMessage(result.reason);
        if (request.key === "notifications") setUnreadTotal(null);
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
    hasLoaded.current = true;
    setLoading(false);
    setRefreshing(false);
  }, [actorKey, canReadCatalog, canReadOperations, canReadPartners, sessionReady]);

  useReadOnReturn(loadQueues, sessionReady && !pageLoading && !refreshing);

  useEffect(() => {
    void loadQueues();
    return () => { requestSequence.current += 1; };
  }, [loadQueues]);

  const hasActionQueues = canReadOperations || canReadPartners || canReadCatalog;
  const hasActionableItems = (canReadOperations && operations.length > 0)
    || (canReadPartners && (joiningAdmissions.length > 0 || joiningCases.length > 0))
    || (canReadCatalog && proposals.length > 0);
  const hasQueueError = (canReadOperations && Boolean(errors.operations))
    || (canReadPartners && (Boolean(errors.joiningAdmissions) || Boolean(errors.joiningCases)))
    || (canReadCatalog && Boolean(errors.proposals));
  const hasUnreadPreview = unreadNotifications.length > 0;

  return (
    <section className="workspace-page" aria-labelledby="workspace-title">
      <PageHeader
        id="workspace-title"
        title="الرئيسية"
        status={refreshing ? <span className="home-refresh-status" role="status">جارٍ تحديث المعاينات</span> : null}
        actions={Object.keys(errors).length ? <button type="button" className="button button-secondary" onClick={() => void loadQueues()} disabled={pageLoading || refreshing}>إعادة المحاولة</button> : null}
      />
      {pageLoading ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ تجهيز مساحة العمل</strong></div> : null}
      {!pageLoading ? (
        <div className="home-dashboard">
          <section className="home-work-area home-priority-work" aria-labelledby="home-work-title">
            <div className="home-work-area-heading">
              <div>
                <h2 id="home-work-title">أعمال تحتاج متابعة</h2>
                <p className="muted">معاينات محدودة؛ افتح القائمة للاطلاع على النتائج كاملة.</p>
              </div>
            </div>
            {!hasActionQueues ? <p className="empty-inline">لا توجد قوائم عمل متاحة للصلاحيات الحالية.</p> : null}
            {hasActionQueues && !hasActionableItems && !hasQueueError ? (
              <div className="home-queue-empty">
                <p><OperationalIcon name="active" />لا عناصر في معاينات العمل الحالية.</p>
                <nav aria-label="فتح قوائم العمل" className="home-queue-shortcuts">
                  {canReadOperations ? <HomeQueueShortcut icon="operations" title="العمليات" href="/operations?lane=attention" /> : null}
                  {canReadPartners ? <>
                    <HomeQueueShortcut icon="review" title="إحالات الميدانيين" href="/partners/joining?state=admission_requested" />
                    <HomeQueueShortcut icon="partners" title="طلبات الانضمام" href="/partners/joining?state=submitted" />
                  </> : null}
                  {canReadCatalog ? <HomeQueueShortcut icon="catalog" title="مقترحات المنتجات" href="/catalog/proposals" /> : null}
                </nav>
              </div>
            ) : null}
            {hasActionQueues && (hasActionableItems || hasQueueError) ? (
              <div className="home-queue-list">
                {canReadOperations ? <HomeQueue id="operations" icon="operations" title="طلبات تحتاج إجراءً" href="/operations?lane=attention" error={errors.operations} empty={operations.length === 0} emptyMessage="لا عناصر في هذه المعاينة.">
                    <ul className="home-list">{operations.slice(0, 3).map((item) => <HomeRecord key={item.orderId} href={`/operations/${encodeURIComponent(item.orderId)}`} title={item.storeName} state={orderStateLabel(item.state)} updatedAt={item.updatedAt} />)}</ul>
                </HomeQueue> : null}
                {canReadPartners ? <>
                  <HomeQueue id="admissions" icon="review" title="إحالات تنتظر القبول" href="/partners/joining?state=admission_requested" error={errors.joiningAdmissions} empty={joiningAdmissions.length === 0} emptyMessage="لا إحالات في هذه المعاينة.">
                    <ul className="home-list">{joiningAdmissions.map((item) => <HomeRecord key={item.id} href={`/partners/${encodeURIComponent(item.id)}`} title={item.businessName} summary={item.firstStoreName} state={joiningCaseStateLabel(item.state)} updatedAt={item.updatedAt} />)}</ul>
                  </HomeQueue>
                  <HomeQueue id="joining" icon="partners" title="طلبات انضمام قيد المراجعة" href="/partners/joining?state=submitted" error={errors.joiningCases} empty={joiningCases.length === 0} emptyMessage="لا طلبات في هذه المعاينة.">
                    <ul className="home-list">{joiningCases.map((item) => <HomeRecord key={item.id} href={`/partners/${encodeURIComponent(item.id)}`} title={item.businessName} summary={item.firstStoreName} state={joiningCaseStateLabel(item.state)} updatedAt={item.updatedAt} />)}</ul>
                  </HomeQueue>
                </> : null}
                {canReadCatalog ? <HomeQueue id="proposals" icon="catalog" title="مقترحات منتجات بانتظار المراجعة" href="/catalog/proposals" error={errors.proposals} empty={proposals.length === 0} emptyMessage="لا مقترحات في هذه المعاينة.">
                    <ul className="home-list">{proposals.slice(0, 3).map((item) => <HomeRecord key={item.id} href={`/catalog/proposals?proposalId=${encodeURIComponent(item.id)}`} title={item.proposedName} summary={item.proposedBrand ?? ""} state={catalogProductProposalStateLabel(item.state)} updatedAt={item.updatedAt} />)}</ul>
                </HomeQueue> : null}
              </div>
            ) : null}
          </section>

          <section className="home-work-area home-notifications" aria-labelledby="home-notifications-title">
            <div className="home-work-area-heading home-notifications-heading">
              <div>
                <h2 id="home-notifications-title">الإشعارات</h2>
                <p className="home-unread-total" aria-live="polite">
                  {unreadTotal === null ? "إجمالي غير المقروءة غير متاح" : <>إجمالي غير المقروءة: <strong>{unreadTotal.toLocaleString("ar-YE")}</strong></>}
                </p>
              </div>
              <Link href="/notifications">صندوق الإشعارات</Link>
            </div>
            <QueueContent
              error={errors.notifications}
              emptyMessage={unreadTotal === 0 ? "أنت على اطلاع؛ لا إشعارات غير مقروءة." : unreadTotal === null ? "تعذر تحديد العدد. افتح صندوق الإشعارات للتحقق." : "لا إشعارات غير مقروءة في هذه المعاينة؛ راجع الصندوق لبقية النتائج."}
              hasItems={hasUnreadPreview}
            >
              <ul className="home-list home-notification-list">
                {unreadNotifications.map((item) => (
                  <li key={item.id}>
                    <Link className="home-notification-link" href={notificationHref(item) ?? "/notifications"}>
                      <span className={`operator-notification-kind operator-notification-kind-${notificationKindTone(item.kind)}`}>{notificationKindLabel(item.kind)}</span>
                      <span className="home-notification-copy">
                        <strong>{item.title}</strong>
                        {item.body ? <small>{item.body}</small> : null}
                        <time dateTime={item.createdAt}>{formatHomeDate(item.createdAt)}</time>
                      </span>
                      <span className="home-link-cue">فتح</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </QueueContent>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function HomeQueueShortcut({ icon, title, href }: Readonly<{ icon: OperationalIconName; title: string; href: string }>) {
  return <Link className="home-queue-shortcut" href={href}><OperationalIcon name={icon} /><span>{title}</span><span className="home-link-cue">فتح</span></Link>;
}

function HomeRecord({ href, title, summary, state, updatedAt }: Readonly<{ href: string; title: string; summary?: string; state: string; updatedAt: string }>) {
  return (
    <li>
      <Link className="home-record-link" href={href}>
        <span className="home-record-copy"><strong>{title}</strong>{summary ? <small>{summary}</small> : null}</span>
        <span className="home-record-meta">
          <span className="home-record-state"><OperationalIcon name="review" />{state}</span>
          <small>آخر تحديث <time dateTime={updatedAt}>{formatHomeDate(updatedAt)}</time></small>
        </span>
      </Link>
    </li>
  );
}

function QueueError({ message }: Readonly<{ message: string }>) {
  return <p className="home-queue-error" role="alert">تعذرت القراءة: {message}</p>;
}

function queueFailureMessage(reason: unknown) {
  if (!(reason instanceof Error)) return "تعذر الاتصال بقائمة العمل. أعد المحاولة بعد قليل.";
  if (reason.name === "TimeoutError" || /timed?\s*out|network|fetch failed|failed to fetch/i.test(reason.message)) return "انتهت مهلة الاتصال بالقائمة. أعد المحاولة بعد قليل.";
  return reason.message;
}

function QueueContent({ error, emptyMessage, hasItems, children }: Readonly<{ error: string | undefined; emptyMessage: string; hasItems: boolean; children: ReactNode }>) {
  if (error) return <QueueError message={error} />;
  if (!hasItems) return <p className="empty-inline">{emptyMessage}</p>;
  return <>{children}</>;
}

function HomeQueue({ id, icon, title, href, error, empty, emptyMessage, children }: Readonly<{ id: string; icon: OperationalIconName; title: string; href: string; error: string | undefined; empty: boolean; emptyMessage: string; children: ReactNode }>) {
  return (
    <section className="home-queue" aria-labelledby={`home-queue-${id}-title`}>
      <div className="home-queue-heading">
        <div><OperationalIcon name={icon} /><h3 id={`home-queue-${id}-title`}>{title}</h3></div>
        <Link href={href}>فتح القائمة</Link>
      </div>
      <QueueContent error={error} emptyMessage={emptyMessage} hasItems={!empty}>{children}</QueueContent>
    </section>
  );
}

function formatHomeDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" }) : "وقت غير متاح";
}
