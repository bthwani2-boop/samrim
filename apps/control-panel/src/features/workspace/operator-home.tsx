"use client";

import {
  type CatalogProductProposal, catalogProductProposalStateLabel,
  type JoiningCaseSummary, joiningCaseStateLabel,
  type OperatorOperationListItem, type OperatorOperationsSummary, orderStateLabel,
} from "@bthwani/dsh";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { PageHeader } from "../../shell/page-header";
import { OperationalIcon, type OperationalIconName } from "../../shell/workspace-icon";
import { responseMessage } from "../access/identity-error-message";
import { operationResponseMessage } from "../operations/operator-actions";
import { useReadOnReturn } from "../shared/use-read-on-return";


type QueueKey = "operations" | "operationsLive" | "joiningCases" | "joiningAdmissions" | "proposals";
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
  const [operations, setOperations] = useState<ReadonlyArray<OperatorOperationListItem>>([]);
  const [summary, setSummary] = useState<OperatorOperationsSummary | null>(null);
  const [joiningCases, setJoiningCases] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [joiningAdmissions, setJoiningAdmissions] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [proposals, setProposals] = useState<ReadonlyArray<CatalogProductProposal>>([]);
  const [loading, setLoading] = useState(true);
  const [loadingQueues, setLoadingQueues] = useState<ReadonlySet<QueueKey>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<Readonly<Partial<Record<QueueKey, string>>>>({});
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const hasLoaded = useRef(false);
  const activeActor = useRef<string | null>(null);
  const actorKey = sessionState.kind === "authenticated" ? sessionState.identity.subject : null;
  const actorChanging = !sessionReady || activeActor.current !== actorKey;
  const pageLoading = loading || actorChanging;

  const loadQueues = useCallback(async () => {
    if (!sessionReady) return;
    const sequence = ++requestSequence.current;
    if (activeActor.current !== actorKey) {
      activeActor.current = actorKey;
      hasLoaded.current = false;
      setOperations([]);
      setSummary(null);
      setJoiningCases([]);
      setJoiningAdmissions([]);
      setProposals([]);
      setLastChecked(null);
      setErrors({});
    }
    if (hasLoaded.current) setRefreshing(true);
    else setLoading(true);

    const requests: QueueRequest[] = [
      ...(canReadOperations ? [
        { key: "operations" as const, url: "/api/operations?limit=8&actionableOnly=true" },
        { key: "operationsLive" as const, url: "/api/operations?limit=1" },
      ] : []),
      ...(canReadPartners ? [
        { key: "joiningAdmissions" as const, url: "/api/partners/joining-cases?state=admission_requested&limit=4" },
        { key: "joiningCases" as const, url: "/api/partners/joining-cases?state=submitted&limit=4" },
      ] : []),
      ...(canReadCatalog ? [{ key: "proposals" as const, url: "/api/catalog/proposals?state=submitted&limit=8" }] : []),
    ];
    setLoadingQueues(new Set(requests.map(({ key }) => key)));
    setErrors({});
    const readAndApply = async ({ key, url }: QueueRequest) => {
      let failure: string | null = null;
      try {
        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
        if (!response.ok) throw new Error(await (key === "operations" || key === "operationsLive" ? operationResponseMessage(response) : responseMessage(response)));
        const body = await response.json().catch(() => null) as unknown;
        if (sequence !== requestSequence.current) return;
        const collectionKey = key === "operations" || key === "operationsLive" ? "operations"
          : key === "proposals" ? "proposals" : "cases";
        const data = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
        if (!data || !Array.isArray(data[collectionKey])
          || ((key === "operations" || key === "operationsLive") && !validOperations(data.operations))
          || (key === "operationsLive" && data.summary !== undefined && !validSummary(data.summary))) {
          if (key === "operationsLive") setSummary(null);
          throw new Error("استجابة قائمة العمل غير صالحة.");
        }
        if (key === "operations") setOperations(data.operations as ReadonlyArray<OperatorOperationListItem>);
        else if (key === "operationsLive") {
          setSummary(validSummary(data.summary) ? data.summary : null);
        } else if (key === "joiningCases") setJoiningCases(data.cases as ReadonlyArray<JoiningCaseSummary>);
        else if (key === "joiningAdmissions") setJoiningAdmissions(data.cases as ReadonlyArray<JoiningCaseSummary>);
        else if (key === "proposals") setProposals(data.proposals as ReadonlyArray<CatalogProductProposal>);

      } catch (cause) {
        if (sequence !== requestSequence.current) return;
        if (key === "operationsLive") setSummary(null);
        failure = queueFailureMessage(cause);
      } finally {
        if (sequence === requestSequence.current) {
          setErrors((current) => {
            const next = { ...current };
            if (failure) next[key] = failure;
            else delete next[key];
            return next;
          });
          setLoadingQueues((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        }
      }
    };
    await Promise.all(requests.map(readAndApply));
    if (sequence !== requestSequence.current) return;
    setLastChecked(new Date().toISOString());
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
  const hasLoadingActionQueues = (canReadOperations && loadingQueues.has("operations"))
    || (canReadPartners && (loadingQueues.has("joiningAdmissions") || loadingQueues.has("joiningCases")))
    || (canReadCatalog && loadingQueues.has("proposals"));

  return (
    <section className="bt-home-page" aria-labelledby="workspace-title">
      <PageHeader id="workspace-title" title="الرئيسية" status={<span className="bt-home-refreshStatus" role="status">
        {refreshing ? "جارٍ تحديث البيانات…" : loading ? "جارٍ قراءة البيانات…" : lastChecked ? <>آخر تحقق: <time dateTime={lastChecked}>{formatHomeDate(lastChecked)}</time></> : "البيانات غير متاحة"}
      </span>} actions={Object.keys(errors).length > 0
        ? <button type="button" className="button button-secondary" onClick={() => void loadQueues()} disabled={pageLoading || refreshing}>إعادة المحاولة</button>
        : undefined} />
      {actorChanging ? <div className="collection-state" role="status">جارٍ تجهيز مساحة العمل…</div> : <div className="bt-home-homeDashboard home-dashboard">
        <div className="bt-home-intro"><div><h2>الأولوية الآن</h2><p>المهام التي تحتاج متابعة، بحسب صلاحيات حسابك.</p></div></div>
        {canReadOperations ? <section className="bt-home-metrics" aria-label="مؤشرات التشغيل">
          <Metric label="تحتاج قرارًا" value={summary?.actionableCount ?? null} href="/operations?view=attention" tone="danger" pending={loadingQueues.has("operationsLive")} />
          <Metric label="بانتظار كابتن" value={summary?.awaitingDispatchCount ?? null} href="/operations?view=dispatch" tone="warning" pending={loadingQueues.has("operationsLive")} />
          <Metric label="قيد التنفيذ" value={summary?.activeCount ?? null} href="/operations" tone="info" pending={loadingQueues.has("operationsLive")} />
        </section> : null}
        {canReadOperations && (errors.operationsLive || !loadingQueues.has("operationsLive") && !summary) ? <p className="bt-home-metricsNote" role="status">
          {errors.operationsLive ? "تعذرت قراءة مؤشرات التشغيل." : "إجماليات التشغيل غير متاحة حاليًا."}
        </p> : null}
          <section className={"home-work-area home-priority-work " + "bt-home-priorityPanel"} aria-labelledby="home-work-title">
            <div className={"bt-home-panelHeading"}><div><h2 id="home-work-title">مهام تحتاج متابعة</h2></div></div>
            {!hasActionQueues ? <p className="empty-inline">لا توجد قوائم عمل متاحة للصلاحيات الحالية.</p> : null}
            {hasActionQueues && !hasActionableItems && !hasQueueError && hasLoadingActionQueues ? <p className="empty-inline" role="status">جارٍ قراءة قوائم العمل المتاحة…</p> : null}
            {hasActionQueues && !hasActionableItems && !hasQueueError && !hasLoadingActionQueues ? <div className="home-queue-empty">
              <p><OperationalIcon name="active" />لا توجد مهام في القوائم المعروضة.</p>
            </div> : null}
            {hasActionQueues && (hasActionableItems || hasQueueError) ? <div className="home-queue-list">
              {canReadOperations ? <HomeQueue id="operations" icon="operations" title="طلبات تحتاج إجراءً" href="/operations?lane=attention" error={errors.operations} loading={loadingQueues.has("operations")} empty={operations.length === 0} emptyMessage="لا عناصر في هذه المعاينة.">
                <ul className="home-list">{operations.slice(0, 2).map((item) => <HomeRecord key={item.orderId} href={"/operations/" + encodeURIComponent(item.orderId)} title={item.storeName} state={orderStateLabel(item.state)} updatedAt={item.updatedAt} />)}</ul>
              </HomeQueue> : null}
              {canReadPartners ? <>
                <HomeQueue id="admissions" icon="review" title="إحالات تنتظر القبول" href="/partners/joining?state=admission_requested" error={errors.joiningAdmissions} loading={loadingQueues.has("joiningAdmissions")} empty={joiningAdmissions.length === 0} emptyMessage="لا إحالات في هذه المعاينة.">
                  <ul className="home-list">{joiningAdmissions.slice(0, 2).map((item) => <HomeRecord key={item.id} href={"/partners/" + encodeURIComponent(item.id)} title={item.businessName} summary={item.firstStoreName} state={joiningCaseStateLabel(item.state)} updatedAt={item.updatedAt} />)}</ul>
                </HomeQueue>
                <HomeQueue id="joining" icon="partners" title="طلبات انضمام قيد المراجعة" href="/partners/joining?state=submitted" error={errors.joiningCases} loading={loadingQueues.has("joiningCases")} empty={joiningCases.length === 0} emptyMessage="لا طلبات في هذه المعاينة.">
                  <ul className="home-list">{joiningCases.slice(0, 2).map((item) => <HomeRecord key={item.id} href={"/partners/" + encodeURIComponent(item.id)} title={item.businessName} summary={item.firstStoreName} state={joiningCaseStateLabel(item.state)} updatedAt={item.updatedAt} />)}</ul>
                </HomeQueue>
              </> : null}
              {canReadCatalog ? <HomeQueue id="proposals" icon="catalog" title="مقترحات منتجات بانتظار المراجعة" href="/catalog/proposals" error={errors.proposals} loading={loadingQueues.has("proposals")} empty={proposals.length === 0} emptyMessage="لا مقترحات في هذه المعاينة.">
                <ul className="home-list">{proposals.slice(0, 2).map((item) => <HomeRecord key={item.id} href={"/catalog/proposals?proposalId=" + encodeURIComponent(item.id)} title={item.proposedName} summary={item.proposedBrand ?? ""} state={catalogProductProposalStateLabel(item.state)} updatedAt={item.updatedAt} />)}</ul>
              </HomeQueue> : null}
            </div> : null}
          </section>
      </div>}
    </section>
  );
}

function Metric({ label, value, href, tone = "default", pending = false }: Readonly<{ label: string; value: number | null; href: string; tone?: string; pending?: boolean }>) {
  return <Link href={href} className={"bt-home-metric"} data-tone={tone}><span>{label}</span><strong>{value === null ? <><span aria-hidden="true">{pending ? "…" : "—"}</span><span className="visually-hidden">{pending ? "جارٍ التحميل" : "غير متاح"}</span></> : <bdi dir="ltr">{value.toLocaleString("en-US")}</bdi>}</strong></Link>;
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
function HomeRecord({ href, title, summary, state, updatedAt }: Readonly<{ href: string; title: string; summary?: string; state: string; updatedAt: string }>) {
  return <li><Link className="home-record-link" href={href}>
    <span className="home-record-copy"><strong>{title}</strong>{summary ? <small>{summary}</small> : null}</span>
    <span className="home-record-meta"><span className="home-record-state"><OperationalIcon name="review" />{state}</span>
      <small>آخر تحديث <time dateTime={updatedAt}>{formatHomeDate(updatedAt)}</time></small></span>
  </Link></li>;
}
function QueueContent({ error, loading, emptyMessage, hasItems, children }: Readonly<{ error: string | undefined; loading: boolean; emptyMessage: string; hasItems: boolean; children: ReactNode }>) {
  if (error) return <p className="home-queue-error" role="alert">تعذرت القراءة: {error}</p>;
  if (loading && !hasItems) return <p className="empty-inline" role="status">جارٍ قراءة هذه المعاينة…</p>;
  if (!hasItems) return <p className="empty-inline">{emptyMessage}</p>;
  return <>{children}</>;
}
function HomeQueue({ id, icon, title, href, error, loading, empty, emptyMessage, children }: Readonly<{ id: string; icon: OperationalIconName; title: string; href: string; error: string | undefined; loading: boolean; empty: boolean; emptyMessage: string; children: ReactNode }>) {
  if (empty && !loading && !error) return null;
  return <section className="home-queue" aria-labelledby={"home-queue-" + id + "-title"}>
    <div className="home-queue-heading"><div><OperationalIcon name={icon} /><h3 id={"home-queue-" + id + "-title"}>{title}</h3></div><Link href={href}>فتح القائمة</Link></div>
    <QueueContent error={error} loading={loading} emptyMessage={emptyMessage} hasItems={!empty}>{children}</QueueContent>
  </section>;
}
