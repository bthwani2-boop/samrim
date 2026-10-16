"use client";

import {
  type CatalogProductProposal, catalogProductProposalStateLabel,
  type JoiningCaseSummary, joiningCaseStateLabel,
  type Notification, type OperatorHomeAnalytics, type OperatorOperationListItem, type OperatorOperationsSummary, orderStateLabel,
} from "@bthwani/dsh";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { PageHeader } from "../../shell/page-header";
import { OperationalIcon, type OperationalIconName } from "../../shell/workspace-icon";
import { responseMessage } from "../access/identity-error-message";
import { notificationBody, notificationHref, notificationKindLabel, notificationKindTone, notificationTitle } from "../notifications/notification-presentation";
import { operationResponseMessage } from "../operations/operator-actions";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { isOperatorHomeAnalytics, OperatorHomeCharts } from "./operator-home-analytics";


type QueueKey = "operations" | "operationsLive" | "homeAnalytics" | "joiningCases" | "joiningAdmissions" | "proposals" | "notifications";
type QueueRequest = Readonly<{ key: QueueKey; url: string }>;

function validSummary(value: unknown): value is OperatorOperationsSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const fields = ["totalCount", "actionableCount", "awaitingDispatchCount", "activeCount", "deliveredCount"];
  return fields.every((field) => Number.isSafeInteger(record[field]) && Number(record[field]) >= 0 && Number(record[field]) <= Number(record.totalCount))
    && typeof record.measuredAt === "string" && Number.isFinite(Date.parse(record.measuredAt));
}

function validOperations(value: unknown): value is ReadonlyArray<OperatorOperationListItem> {
  return Array.isArray(value) && value.every((item) => item && typeof item.orderId === "string"
    && typeof item.storeName === "string" && typeof item.state === "string"
    && typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt)));
}

export function OperatorHome() {
  const { state: sessionState } = useSession();
  const permissions = sessionState.kind === "authenticated" ? sessionState.identity.permissions ?? [] : [];
  const sessionReady = sessionState.kind !== "loading";
  const canReadOperations = permissions.includes("operations");
  const canReadPartners = permissions.includes("partners");
  const canReadCatalog = permissions.includes("catalog");
  const canReadPolicies = permissions.includes("platform_policies");
  const [operations, setOperations] = useState<ReadonlyArray<OperatorOperationListItem>>([]);
  const [liveOperations, setLiveOperations] = useState<ReadonlyArray<OperatorOperationListItem>>([]);
  const [summary, setSummary] = useState<OperatorOperationsSummary | null>(null);
  const [analytics, setAnalytics] = useState<OperatorHomeAnalytics | null>(null);
  const [joiningCases, setJoiningCases] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [joiningAdmissions, setJoiningAdmissions] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [proposals, setProposals] = useState<ReadonlyArray<CatalogProductProposal>>([]);
  const [unreadNotifications, setUnreadNotifications] = useState<ReadonlyArray<Notification>>([]);
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<Readonly<Partial<Record<QueueKey, string>>>>({});
  const [lastChecked, setLastChecked] = useState<string | null>(null);
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
      setLiveOperations([]);
      setSummary(null);
      setAnalytics(null);
      setJoiningCases([]);
      setJoiningAdmissions([]);
      setProposals([]);
      setUnreadNotifications([]);
      setUnreadTotal(null);
      setLastChecked(null);
      setErrors({});
    }
    if (hasLoaded.current) setRefreshing(true);
    else setLoading(true);

    const requests: QueueRequest[] = [
      ...(canReadOperations ? [
        { key: "operations" as const, url: "/api/operations?limit=8&actionableOnly=true" },
        { key: "operationsLive" as const, url: "/api/operations?limit=12" },
        { key: "homeAnalytics" as const, url: "/api/operations/home-analytics" },
      ] : []),
      ...(canReadPartners ? [
        { key: "joiningAdmissions" as const, url: "/api/partners/joining-cases?state=admission_requested&limit=4" },
        { key: "joiningCases" as const, url: "/api/partners/joining-cases?state=submitted&limit=4" },
      ] : []),
      ...(canReadCatalog ? [{ key: "proposals" as const, url: "/api/catalog/proposals?state=submitted&limit=8" }] : []),
      { key: "notifications", url: "/api/notifications?limit=50" },
    ];
    const results = await Promise.allSettled(requests.map(async ({ key, url }) => {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(await (key === "operations" || key === "operationsLive" ? operationResponseMessage(response) : responseMessage(response)));
      return { key, body: await response.json().catch(() => null) as unknown };
    }));
    if (sequence !== requestSequence.current) return;
    const nextErrors: Partial<Record<QueueKey, string>> = {};
    results.forEach((result, index) => {
      const request = requests[index];
      if (!request) return;
      if (result.status === "rejected") {
        nextErrors[request.key] = queueFailureMessage(result.reason);
        if (request.key === "notifications") setUnreadTotal(null);
        if (request.key === "operationsLive") setSummary(null);
        if (request.key === "homeAnalytics") setAnalytics(null);
        return;
      }
      const { key, body } = result.value;
      if (key === "homeAnalytics") {
        if (isOperatorHomeAnalytics(body)) setAnalytics(body);
        else { nextErrors.homeAnalytics = "استجابة التحليلات غير صالحة."; setAnalytics(null); }
        return;
      }
      const collectionKey = key === "operations" || key === "operationsLive" ? "operations"
        : key === "proposals" ? "proposals" : key === "notifications" ? "notifications" : "cases";
      const data = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
      if (!data || !Array.isArray(data[collectionKey])
        || ((key === "operations" || key === "operationsLive") && !validOperations(data.operations))
        || (key === "operationsLive" && data.summary !== undefined && !validSummary(data.summary))) {
        nextErrors[key] = "استجابة قائمة العمل غير صالحة.";
        if (key === "notifications") { setUnreadNotifications([]); setUnreadTotal(null); }
        if (key === "operationsLive") setSummary(null);
        return;
      }
      if (key === "operations") setOperations(data.operations as ReadonlyArray<OperatorOperationListItem>);
      else if (key === "operationsLive") {
        setLiveOperations(data.operations as ReadonlyArray<OperatorOperationListItem>);
        setSummary(validSummary(data.summary) ? data.summary : null);
      } else if (key === "joiningCases") setJoiningCases(data.cases as ReadonlyArray<JoiningCaseSummary>);
      else if (key === "joiningAdmissions") setJoiningAdmissions(data.cases as ReadonlyArray<JoiningCaseSummary>);
      else if (key === "proposals") setProposals(data.proposals as ReadonlyArray<CatalogProductProposal>);
      else if (key === "notifications") {
        const notifications = data.notifications as ReadonlyArray<Notification>;
        setUnreadNotifications(notifications.filter((item) => !item.readAt).slice(0, 4));
        setUnreadTotal(typeof data.unreadCount === "number" && Number.isSafeInteger(data.unreadCount) && data.unreadCount >= 0 ? data.unreadCount : null);
      }
    });
    setLastChecked(new Date().toISOString());
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
  useEffect(() => {
    if (!sessionReady || pageLoading) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && !refreshing) void loadQueues();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadQueues, pageLoading, refreshing, sessionReady]);

  const hasActionQueues = canReadOperations || canReadPartners || canReadCatalog;
  const hasActionableItems = (canReadOperations && operations.length > 0)
    || (canReadPartners && (joiningAdmissions.length > 0 || joiningCases.length > 0))
    || (canReadCatalog && proposals.length > 0);
  const hasQueueError = (canReadOperations && Boolean(errors.operations))
    || (canReadPartners && (Boolean(errors.joiningAdmissions) || Boolean(errors.joiningCases)))
    || (canReadCatalog && Boolean(errors.proposals));

  return (
    <section className={"bt-home-page"} aria-labelledby="workspace-title">
      <PageHeader id="workspace-title" title="الرئيسية" status={<span className={"bt-home-refreshStatus"} role="status">
        {refreshing ? "جارٍ تحديث البيانات…" : lastChecked ? <>آخر تحقق: <time dateTime={lastChecked}>{formatHomeDate(lastChecked)}</time></> : "مركز قيادة المنصة"}
      </span>} actions={<button type="button" className="button button-secondary" onClick={() => void loadQueues()} disabled={pageLoading || refreshing}>
        {Object.keys(errors).length ? "إعادة المحاولة" : "تحديث البيانات"}
      </button>} />
      {pageLoading ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ تجهيز مركز القيادة</strong></div> : null}
      {!pageLoading ? <div className={"home-dashboard " + "bt-home-homeDashboard"}>
        <div className={"bt-home-intro"}>
          <div><h2>مركز قيادة بثواني</h2><p>ابدأ بما يحتاج تدخلًا، ثم راقب حركة الطلبات. جميع البيانات من سجلات النظام الفعلية.</p></div>
          {canReadOperations ? <Link className={"bt-home-primaryLink"} href="/operations">فتح مركز العمليات <span aria-hidden="true">←</span></Link> : null}
        </div>

        {canReadOperations ? <section className={"bt-home-metrics"} aria-label="مؤشرات التشغيل">
          <Metric label="جميع الطلبات المسجلة" value={summary?.totalCount ?? null} href="/operations" />
          <Metric label="قيد التنفيذ" value={summary?.activeCount ?? null} href="/operations" tone="info" />
          <Metric label="بانتظار الإسناد" value={summary?.awaitingDispatchCount ?? null} href="/operations?view=dispatch" tone="warning" />
          <Metric label="تحتاج إجراءً" value={summary?.actionableCount ?? null} href="/operations?view=attention" tone="danger" />
          <Metric label="تم تسليمها" value={summary?.deliveredCount ?? null} href="/operations?view=delivered" tone="success" />
        </section> : null}
        {canReadOperations && (errors.operationsLive || !summary) ? <p className={"bt-home-metricsNote"} role="status">
          {errors.operationsLive ? "تعذر قراءة مؤشرات التشغيل؛ استخدم إعادة المحاولة." : "مؤشرات الإجمالي غير متاحة من الاستجابة الحالية؛ لن تُعرض أرقام تقديرية."}
        </p> : null}

        <div className={"bt-home-commandGrid"}>
          <section className={"bt-home-operationsPanel"} aria-labelledby="home-operations-title">
            <div className={"bt-home-panelHeading"}>
              <div><p className={"bt-home-eyebrow"}><span className={"bt-home-liveDot"} /> المتابعة التشغيلية</p><h2 id="home-operations-title">آخر الطلبات وحالتها</h2>
                <p>معاينة أحدث السجلات؛ العدد الإجمالي يُعرض أعلاه، والإجراءات الكاملة في ملف الطلب.</p></div>
              {canReadOperations ? <Link href="/operations" className={"bt-home-subtleLink"}>كل الطلبات ←</Link> : null}
            </div>
            {!canReadOperations ? <p className={"bt-home-panelEmpty"}>متابعة الطلبات غير متاحة لصلاحيات الحساب.</p>
              : errors.operationsLive ? <div role="alert" className={"bt-home-panelError"}>تعذرت قراءة الطلبات: {errors.operationsLive}</div>
              : liveOperations.length === 0 ? <div className={"bt-home-panelEmpty"}>لا توجد طلبات في المعاينة الحالية. <Link href="/operations">فتح العمليات</Link></div>
              : <div className={"bt-home-tableScroll"}><table className={"bt-home-operationsTable"}>
                <thead><tr><th scope="col">الشريك</th><th scope="col">الحالة</th><th scope="col">آخر تحديث</th><th scope="col">الإجراء</th></tr></thead>
                <tbody>{liveOperations.map((item) => <tr key={item.orderId}>
                  <th scope="row" className={"bt-home-storeName"}>{item.storeName}</th>
                  <td><span className={"bt-home-stateChip"} data-tone={operationTone(item.state)}>{orderStateLabel(item.state)}</span></td>
                  <td><time dateTime={item.updatedAt}>{formatHomeDate(item.updatedAt)}</time></td>
                  <td><Link className={"bt-home-rowLink"} href={"/operations/" + encodeURIComponent(item.orderId)}>فتح الطلب ←</Link></td>
                </tr>)}</tbody>
              </table></div>}
            {canReadOperations && summary ? <div className={"bt-home-panelFoot"}><span>إحصاءات السجل الحالي، وليست إحصاءات اليوم</span><time dateTime={summary.measuredAt}>قيست: {formatHomeDate(summary.measuredAt)}</time></div> : null}
          </section>

          <section className={"home-work-area home-priority-work " + "bt-home-priorityPanel"} aria-labelledby="home-work-title">
            <div className={"bt-home-panelHeading"}><div><p className={"bt-home-eyebrow"}>حسب الصلاحية والأولوية</p><h2 id="home-work-title">قرارات تحتاج متابعة</h2><p>افتح القائمة المعنية لمعالجة الحالة من مصدرها.</p></div></div>
            {!hasActionQueues ? <p className="empty-inline">لا توجد قوائم عمل متاحة للصلاحيات الحالية.</p> : null}
            {hasActionQueues && !hasActionableItems && !hasQueueError ? <div className="home-queue-empty">
              <p><OperationalIcon name="active" />لا عناصر في معاينات العمل الحالية.</p>
              <nav aria-label="فتح قوائم العمل" className="home-queue-shortcuts">
                {canReadOperations ? <HomeQueueShortcut icon="operations" title="العمليات" href="/operations?lane=attention" /> : null}
                {canReadPartners ? <>
                  <HomeQueueShortcut icon="review" title="إحالات الميدانيين" href="/partners/joining?state=admission_requested" />
                  <HomeQueueShortcut icon="partners" title="طلبات الانضمام" href="/partners/joining?state=submitted" />
                </> : null}
                {canReadCatalog ? <HomeQueueShortcut icon="catalog" title="مقترحات المنتجات" href="/catalog/proposals" /> : null}
              </nav>
            </div> : null}
            {hasActionQueues && (hasActionableItems || hasQueueError) ? <div className="home-queue-list">
              {canReadOperations ? <HomeQueue id="operations" icon="operations" title="طلبات تحتاج إجراءً" href="/operations?lane=attention" error={errors.operations} empty={operations.length === 0} emptyMessage="لا عناصر في هذه المعاينة.">
                <ul className="home-list">{operations.slice(0, 2).map((item) => <HomeRecord key={item.orderId} href={"/operations/" + encodeURIComponent(item.orderId)} title={item.storeName} state={orderStateLabel(item.state)} updatedAt={item.updatedAt} />)}</ul>
              </HomeQueue> : null}
              {canReadPartners ? <>
                <HomeQueue id="admissions" icon="review" title="إحالات تنتظر القبول" href="/partners/joining?state=admission_requested" error={errors.joiningAdmissions} empty={joiningAdmissions.length === 0} emptyMessage="لا إحالات في هذه المعاينة.">
                  <ul className="home-list">{joiningAdmissions.slice(0, 2).map((item) => <HomeRecord key={item.id} href={"/partners/" + encodeURIComponent(item.id)} title={item.businessName} summary={item.firstStoreName} state={joiningCaseStateLabel(item.state)} updatedAt={item.updatedAt} />)}</ul>
                </HomeQueue>
                <HomeQueue id="joining" icon="partners" title="طلبات انضمام قيد المراجعة" href="/partners/joining?state=submitted" error={errors.joiningCases} empty={joiningCases.length === 0} emptyMessage="لا طلبات في هذه المعاينة.">
                  <ul className="home-list">{joiningCases.slice(0, 2).map((item) => <HomeRecord key={item.id} href={"/partners/" + encodeURIComponent(item.id)} title={item.businessName} summary={item.firstStoreName} state={joiningCaseStateLabel(item.state)} updatedAt={item.updatedAt} />)}</ul>
                </HomeQueue>
              </> : null}
              {canReadCatalog ? <HomeQueue id="proposals" icon="catalog" title="مقترحات منتجات بانتظار المراجعة" href="/catalog/proposals" error={errors.proposals} empty={proposals.length === 0} emptyMessage="لا مقترحات في هذه المعاينة.">
                <ul className="home-list">{proposals.slice(0, 2).map((item) => <HomeRecord key={item.id} href={"/catalog/proposals?proposalId=" + encodeURIComponent(item.id)} title={item.proposedName} summary={item.proposedBrand ?? ""} state={catalogProductProposalStateLabel(item.state)} updatedAt={item.updatedAt} />)}</ul>
              </HomeQueue> : null}
            </div> : null}
          </section>
        </div>

        {canReadOperations ? <OperatorHomeCharts report={analytics} error={errors.homeAnalytics} /> : null}

        <div className={"bt-home-bottomGrid"}>
          <section className={"home-work-area home-notifications " + "bt-home-activityPanel"} aria-labelledby="home-notifications-title">
            <div className="home-work-area-heading home-notifications-heading">
              <div><h2 id="home-notifications-title">آخر التنبيهات</h2><p className="home-unread-total" aria-live="polite">
                {unreadTotal === null ? "إجمالي غير المقروءة غير متاح" : <>إجمالي غير المقروءة: <strong>{unreadTotal.toLocaleString("ar-YE")}</strong></>}
              </p></div><Link href="/notifications">صندوق الإشعارات ←</Link>
            </div>
            <QueueContent error={errors.notifications} emptyMessage={unreadTotal === 0 ? "أنت على اطلاع؛ لا إشعارات غير مقروءة." : unreadTotal === null ? "تعذر تحديد العدد. افتح صندوق الإشعارات للتحقق." : "لا إشعارات غير مقروءة في هذه المعاينة؛ راجع الصندوق لبقية النتائج."} hasItems={unreadNotifications.length > 0}>
              <ul className="home-list home-notification-list">{unreadNotifications.map((item) => <li key={item.id}>
                <Link className="home-notification-link" href={notificationHref(item) ?? "/notifications"}>
                  <span className={"operator-notification-kind operator-notification-kind-" + notificationKindTone(item.kind)}>{notificationKindLabel(item.kind)}</span>
                  <span className="home-notification-copy"><strong>{notificationTitle(item)}</strong>{item.body ? <small>{notificationBody(item)}</small> : null}<time dateTime={item.createdAt}>{formatHomeDate(item.createdAt)}</time></span><span className="home-link-cue">فتح</span>
                </Link>
              </li>)}</ul>
            </QueueContent>
          </section>
          <section className={"bt-home-shortcutsPanel"} aria-labelledby="home-shortcuts-title">
            <div className={"bt-home-panelHeading"}><div><p className={"bt-home-eyebrow"}>وصول سريع</p><h2 id="home-shortcuts-title">إجراءات المشغّل</h2><p>انتقل مباشرة إلى مكان الإدارة، دون تكرار الأدوات هنا.</p></div></div>
            <nav className={"bt-home-quickLinks"} aria-label="إجراءات المشغّل">
              {canReadOperations ? <Link href="/operations?view=attention"><OperationalIcon name="operations" /> إدارة الطلبات <span aria-hidden="true">←</span></Link> : null}
              {canReadPartners ? <Link href="/partners/joining?state=submitted"><OperationalIcon name="partners" /> مراجعة الانضمام <span aria-hidden="true">←</span></Link> : null}
              {canReadCatalog ? <Link href="/catalog/proposals"><OperationalIcon name="catalog" /> مقترحات المنتجات <span aria-hidden="true">←</span></Link> : null}
              {canReadPolicies ? <Link href="/policies"><OperationalIcon name="review" /> إدارة السياسات <span aria-hidden="true">←</span></Link> : null}
              {!canReadOperations && !canReadPartners && !canReadCatalog && !canReadPolicies ? <p>لا توجد إجراءات سريعة متاحة لصلاحيات الحساب.</p> : null}
            </nav>
          </section>
        </div>
      </div> : null}
    </section>
  );
}

function Metric({ label, value, href, tone = "default" }: Readonly<{ label: string; value: number | null; href: string; tone?: string }>) {
  return <Link href={href} className={"bt-home-metric"} data-tone={tone}><span>{label}</span><strong>{value === null ? <><span aria-hidden="true">—</span><span className="visually-hidden">غير متاح</span></> : value.toLocaleString("ar-YE")}</strong><span className={"bt-home-metricCue"}>استعراض السجلات ←</span></Link>;
}

function operationTone(state: string) {
  if (state === "DELIVERY_FAILED" || state === "REJECTED" || state === "CANCELLED") return "danger";
  if (state === "READY_FOR_DISPATCH" || state === "CAPTAIN_ASSIGNED") return "warning";
  if (state === "DELIVERED") return "success";
  return "info";
}
function formatHomeDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" }) : "وقت غير متاح";
}
function queueFailureMessage(reason: unknown) {
  if (!(reason instanceof Error)) return "تعذر الاتصال بالقائمة. أعد المحاولة بعد قليل.";
  if (reason.name === "TimeoutError" || /timed?\s*out|network|fetch failed|failed to fetch/i.test(reason.message)) return "انتهت مهلة الاتصال بالقائمة. أعد المحاولة بعد قليل.";
  return reason.message;
}
function HomeQueueShortcut({ icon, title, href }: Readonly<{ icon: OperationalIconName; title: string; href: string }>) {
  return <Link className="home-queue-shortcut" href={href}><OperationalIcon name={icon} /><span>{title}</span><span className="home-link-cue">فتح</span></Link>;
}
function HomeRecord({ href, title, summary, state, updatedAt }: Readonly<{ href: string; title: string; summary?: string; state: string; updatedAt: string }>) {
  return <li><Link className="home-record-link" href={href}>
    <span className="home-record-copy"><strong>{title}</strong>{summary ? <small>{summary}</small> : null}</span>
    <span className="home-record-meta"><span className="home-record-state"><OperationalIcon name="review" />{state}</span>
      <small>آخر تحديث <time dateTime={updatedAt}>{formatHomeDate(updatedAt)}</time></small></span>
  </Link></li>;
}
function QueueContent({ error, emptyMessage, hasItems, children }: Readonly<{ error: string | undefined; emptyMessage: string; hasItems: boolean; children: ReactNode }>) {
  if (error) return <p className="home-queue-error" role="alert">تعذرت القراءة: {error}</p>;
  if (!hasItems) return <p className="empty-inline">{emptyMessage}</p>;
  return <>{children}</>;
}
function HomeQueue({ id, icon, title, href, error, empty, emptyMessage, children }: Readonly<{ id: string; icon: OperationalIconName; title: string; href: string; error: string | undefined; empty: boolean; emptyMessage: string; children: ReactNode }>) {
  return <section className="home-queue" aria-labelledby={"home-queue-" + id + "-title"}>
    <div className="home-queue-heading"><div><OperationalIcon name={icon} /><h3 id={"home-queue-" + id + "-title"}>{title}</h3></div><Link href={href}>فتح القائمة</Link></div>
    <QueueContent error={error} emptyMessage={emptyMessage} hasItems={!empty}>{children}</QueueContent>
  </section>;
}
