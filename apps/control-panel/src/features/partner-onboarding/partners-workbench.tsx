"use client";

import { fulfillmentModeLabel, type JoiningCaseSummary, joiningCaseStateLabel, type OperatorStoreSummary, publicationStateLabel, type StoreAccessGrant } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import Link from "next/link";
import { Input, Select, Tabs } from "antd";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CursorPagination, useCursorPage } from "../../navigation/cursor-page";
import { AdaptiveRecordPanel, AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { PageHeader } from "../../shell/page-header";
import { PartnerDetailWorkspace } from "../partners/partner-detail-workspace";
import { partnerErrorMessage } from "../partners/partner-error-message";
import { RecordIndicator } from "../shared/record-indicator";
import { RegistryColumnHeader } from "../shared/registry-column-header";
import { downloadRegistryCsv } from "../shared/registry-csv";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { AccountIndicator, FulfillmentIndicators, PublicationIndicator } from "../stores/store-indicators";
import { StoreInspector } from "../stores/store-inspector";
import { StoreLogo } from "../stores/store-logo";
import { StoreOperationalDecision } from "../stores/store-registry-decision";
import { JoiningCaseDetail } from "./joining-case-detail";

type Row =
  | { kind: "joining"; case: JoiningCaseSummary }
  | { kind: "access"; grant: StoreAccessGrant }
  | { kind: "store"; store: OperatorStoreSummary; partnerRole: ActorRoleView | null }
  | { kind: "partner"; actor: ActorRoleView };
type Kind = "joining" | "access" | "store" | "partner";
type WorkspaceTab = "directory" | "joining" | "access";
const typesByTab: Record<WorkspaceTab, ReadonlyArray<{ value: Kind; label: string }>> = {
  directory: [{ value: "store", label: "المتاجر" }, { value: "partner", label: "الشركاء دون متجر" }],
  joining: [{ value: "joining", label: "طلبات الانضمام" }],
  access: [{ value: "access", label: "اعتمادات الوصول" }],
};
const defaultKindByTab: Record<WorkspaceTab, Kind> = { directory: "store", joining: "joining", access: "access" };
const statusesByKind: Record<Kind, ReadonlyArray<{ value: string; label: string }>> = {
  joining: [
    { value: "", label: "جميع الحالات" }, { value: "submitted", label: "للمراجعة" },
    { value: "admission_requested", label: "طلب قبول" }, { value: "needs_correction", label: "يحتاج تصحيحًا" },
    { value: "draft", label: "مسودة" }, { value: "approved", label: "معتمد" },
  ],
  access: [{ value: "", label: "جميع الحالات" }, { value: "pending_role_admission", label: "اعتماد وصول معلق" }],
  store: [
    { value: "", label: "جميع الحالات" }, { value: "published", label: "منشور" },
    { value: "unpublished", label: "غير منشور" }, { value: "hidden", label: "مخفي" },
  ],
  partner: [{ value: "", label: "جميع الحالات" }],
};
const permissionLabels: Record<string, string> = {
  orders: "إدارة الطلبات", catalog: "إدارة الكتالوج", store_operations: "التحكم في الإتاحة",
};
const rowId = (row: Row) => row.kind === "joining" ? "joining:" + row.case.id :
  row.kind === "access" ? "access:" + row.grant.id : row.kind === "store" ? "store:" + row.store.id : "partner:" + row.actor.actorId;
const date = (value?: string) => value ? new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium" }).format(new Date(value)) : "—";
const isPhone = (value: string) => /^\+?[\d\s-]{5,}$/.test(value) && value.replace(/\D/g, "").length >= 5;
const caption = (row: Row) => row.kind === "joining" ? "طلب انضمام" : row.kind === "access" ? "اعتماد وصول" : row.kind === "store" ? "متجر" : "شريك دون متجر";

export function PartnersWorkbench() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  const legacyView = params.get("view");
  const requestedStatus = params.get("status") || params.get("state") || "";
  const requestedTab = params.get("tab");
  const requestedKindParam = params.get("kind");
  const activeTab: WorkspaceTab = requestedTab === "joining" || requestedTab === "access" ? requestedTab
    : requestedTab === "directory" ? "directory"
    : requestedKindParam === "joining" || legacyView === "joining" ? "joining"
    : requestedKindParam === "access" || legacyView === "access" || requestedStatus === "pending_role_admission" ? "access"
    : requestedTab === "requests" || requestedKindParam === "requests" ? "joining" : "directory";
  const legacyKind = legacyView === "joining" || legacyView === "access" ? legacyView :
    legacyView === "accounts" || params.get("mode") === "without_store" ? "partner" : params.get("mode") === "stores" ? "store" : "";
  const requestedKind = requestedKindParam || legacyKind || defaultKindByTab[activeTab];
  const kindOptions = typesByTab[activeTab];
  const kind: Kind = kindOptions.some((entry) => entry.value === requestedKind) ? requestedKind as Kind : defaultKindByTab[activeTab];
  const statusOptions = statusesByKind[kind];
  const status = statusOptions.some((entry) => entry.value === requestedStatus) ? requestedStatus : "";
  const city = activeTab === "directory" && kind === "store" ? (params.get("serviceCityId") ?? "").slice(0, 128) : "";
  const sort = params.get("sort") === "oldest" || params.get("sort") === "updated_asc" ? "oldest" : "newest";
  const urlSearch = (params.get("q") ?? "").slice(0, 100).trim();
  const [privateSearch, setPrivateSearch] = useState("");
  const appliedSearch = urlSearch || privateSearch;
  const [search, setSearch] = useState(appliedSearch);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cities, setCities] = useState<ReadonlyArray<{ id: string; displayNameAr: string }>>([]);
  const [rows, setRows] = useState<ReadonlyArray<Row>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [busyGrant, setBusyGrant] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const attempts = useRef(new Map<string, { idempotencyKey: string; correlationId: string }>());
  const sequence = useRef(0);
  const openStore = (params.get("inspect") ?? "").slice(0, 128);
  const openCase = (params.get("case") ?? "").slice(0, 128);
  const openGrant = (params.get("grant") ?? "").slice(0, 128);
  const openPartner = (params.get("actor") ?? "").slice(0, 128);
  const selectedGrant = rows.find((r) => r.kind === "access" && r.grant.id === openGrant);
  const selectedPartner = rows.find((r) => r.kind === "partner" && r.actor.actorId === openPartner);
  const selectedId = openStore || openCase || openGrant || openPartner;
  const page = useCursorPage("cursor", JSON.stringify([activeTab, kind, status, city, sort, appliedSearch]), true);
  const cursor = page.cursor;

  useEffect(() => setSearch(appliedSearch), [appliedSearch]);
  useEffect(() => {
    const sync = () => setPrivateSearch(typeof window.history.state?.partnerWorkbenchPhone === "string" ? window.history.state.partnerWorkbenchPhone : "");
    const initial = new URLSearchParams(window.location.search);
    const q = initial.get("q") ?? "";
    if (isPhone(q)) {
      initial.delete("q");
      window.history.replaceState({ ...window.history.state, partnerWorkbenchPhone: q }, "", window.location.pathname + (initial.size ? "?" + initial : ""));
    }
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    let active = true;
    void fetch("/api/service-cities", { cache: "no-store" }).then((res) => res.ok ? res.json() as Promise<{cities?: {id:string;displayNameAr:string}[]}> : null)
      .then((data) => { if (active && data?.cities) setCities(data.cities); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const navigate = (nextTab: WorkspaceTab, nextKind: Kind, nextStatus: string, nextCity: string, nextSort: string, nextQuery: string) => {
    page.clearForNavigation();
    const url = new URLSearchParams();
    if (nextTab !== "directory") url.set("tab", nextTab);
    if (nextKind !== defaultKindByTab[nextTab]) url.set("kind", nextKind);
    if (nextStatus) url.set("status", nextStatus);
    if (nextCity) url.set("serviceCityId", nextCity);
    if (nextSort === "oldest") url.set("sort", "oldest");
    if (nextQuery && !isPhone(nextQuery)) url.set("q", nextQuery);
    const href = pathname + (url.size ? "?" + url : "");
    if (isPhone(nextQuery)) {
      window.history.pushState({ ...window.history.state, partnerWorkbenchPhone: nextQuery }, "", href);
      setPrivateSearch(nextQuery);
      setRevision((current) => current + 1);
    } else {
      setPrivateSearch("");
      router.push(href, { scroll: false });
    }
    setSelected(new Set());
  };
  const selectTab = (nextTab: WorkspaceTab) => navigate(nextTab, defaultKindByTab[nextTab], "", "", "newest", appliedSearch);

  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ kind, sort });
      if (status) query.set("status", status);
      if (city) query.set("serviceCityId", city);
      if (cursor) query.set("cursor", cursor);
      if (appliedSearch && !isPhone(appliedSearch)) query.set("q", appliedSearch);
      const response = await fetch("/api/partners/workbench?" + query, {
        method: isPhone(appliedSearch) ? "POST" : "GET",
        ...(isPhone(appliedSearch) ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: appliedSearch }) } : {}),
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      if (request !== sequence.current) return;
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      const result = await response.json() as { rows?: Row[]; nextCursor?: string };
      if (!Array.isArray(result.rows) || typeof result.nextCursor !== "string") throw new Error("استجابة السجل غير صالحة.");
      setRows(result.rows);
      setNextCursor(result.nextCursor);
      setSelected((previous) => new Set(result.rows!.filter((row) => previous.has(rowId(row))).map(rowId)));
    } catch (cause) {
      if (request !== sequence.current) return;
      setError(cause instanceof Error ? cause.message : "تعذرت قراءة السجلات.");
      setRows([]);
      setNextCursor("");
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [kind, status, city, sort, appliedSearch, cursor]);
  useEffect(() => {
    if (page.ready && revision >= 0) void load();
    return () => { sequence.current += 1; };
  }, [page.ready, load, revision]);
  useReadOnReturn(load, page.ready && !loading && !busyGrant);

  const inspect = (type: "inspect" | "case" | "grant" | "actor", id: string) => {
    const q = new URLSearchParams(window.location.search);
    for (const k of ["inspect", "case", "grant", "actor"]) q.delete(k);
    q.set(type, id);
    router.push(pathname + "?" + q, { scroll: false });
  };
  const close = () => {
    const q = new URLSearchParams(window.location.search);
    for (const k of ["inspect", "case", "grant", "actor"]) q.delete(k);
    router.replace(pathname + (q.size ? "?" + q : ""), { scroll: false });
    void load();
  };
  async function approve(grant: StoreAccessGrant) {
    if (busyGrant) return;
    const key = grant.id + ":" + grant.version;
    const attempt = attempts.current.get(key) ?? {
      idempotencyKey: "store_access_admission_" + crypto.randomUUID(),
      correlationId: "store_access_admission_corr_" + crypto.randomUUID(),
    };
    attempts.current.set(key, attempt);
    setBusyGrant(grant.id);
    setError("");
    try {
      const response = await fetch("/api/partners/store-access-admissions/" + encodeURIComponent(grant.id) + "/provision", {
        method: "POST", headers: { "Idempotency-Key": attempt.idempotencyKey, "X-Correlation-ID": attempt.correlationId },
      });
      if (!response.ok) throw new Error(await partnerErrorMessage(response));
      attempts.current.delete(key);
      close();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر اعتماد الدور.");
      await load();
    } finally { setBusyGrant(""); }
  }
  const selectedRecords = rows.filter((row) => (row.kind === "store" || row.kind === "joining") && selected.has(rowId(row)));
  const exportSelected = () => {
    downloadRegistryCsv("selected-partners.csv", ["نوع السجل", "المتجر", "الشريك", "الهاتف", "المدينة", "الحالة", "آخر تحديث"],
      selectedRecords.flatMap((row) => row.kind === "store" ?
        [["متجر", row.store.name, row.store.partnerName || "", row.partnerRole?.phoneE164 || "", row.store.serviceCityName || "", publicationStateLabel(row.store.publicationState), row.store.updatedAt]] :
        row.kind === "joining" ? [["طلب انضمام", row.case.firstStoreName || "", row.case.businessName, row.case.contactPhoneE164, "", joiningCaseStateLabel(row.case.state), row.case.updatedAt]] : []));
  };

  function renderRow(row: Row) {
    if (row.kind === "joining") {
      const c = row.case;
      return <tr key={rowId(row)} data-kind="joining">
        <th scope="row"><div className="store-registry-identity"><input type="checkbox" aria-label={"تحديد طلب " + c.businessName} checked={selected.has(rowId(row))} onChange={(event) => { const updated = new Set(selected); if (event.target.checked) updated.add(rowId(row)); else updated.delete(rowId(row)); setSelected(updated); }} /><span className="partner-attention-avatar" aria-hidden="true">+</span><div className="store-registry-identity-copy"><strong>{c.firstStoreName || c.businessName}</strong><small>{c.businessName}</small><a href={"tel:" + c.contactPhoneE164}><bdi dir="ltr">{c.contactPhoneE164}</bdi></a></div></div></th>
        <td><div className="store-registry-cell-stack"><strong>طلب انضمام</strong><small>{c.origin === "field" ? "سجل تاريخي" : c.origin === "self_service" ? "تسجيل ذاتي" : "عبر المشغّل"}</small></div></td>
        <td><span className="partner-state-tag is-pending">{joiningCaseStateLabel(c.state)}</span></td>
        <td><div className="store-registry-cell-stack"><span>{c.state === "submitted" ? "ينتظر قرار المراجعة" : c.state === "admission_requested" ? "ينتظر قبول الإحالة" : c.state === "needs_correction" ? "ينتظر استكمال التصحيح" : c.state === "approved" ? "استكمال التفعيل" : "استكمال الطلب"}</span><small>إنشاء: {date(c.createdAt)}</small></div></td>
        <td><time dateTime={c.updatedAt}>{date(c.updatedAt)}</time></td>
        <td><button className="partner-row-action" type="button" data-adaptive-record-trigger={`partner-case-${c.id}`} onClick={() => inspect("case", c.id)}>مراجعة الطلب ←</button></td>
      </tr>;
    }
    if (row.kind === "access") {
      const g = row.grant;
      return <tr key={rowId(row)} data-kind="access">
        <th scope="row"><div className="store-registry-identity"><span className="partner-attention-avatar" aria-hidden="true">✓</span><div className="store-registry-identity-copy"><strong>{g.storeName}</strong><small>مدعو: <bdi dir="ltr">{g.delegatePhoneMasked || "هاتف محجوب"}</bdi></small></div></div></th>
        <td>اعتماد وصول</td><td><span className="partner-state-tag is-pending">اعتماد دور معلق</span></td>
        <td><div className="store-registry-cell-stack"><span>{g.permissions.map((p) => permissionLabels[p] || "صلاحية إضافية").join("، ") || "لم تحدد صلاحيات"}</span><small>انتهاء الدعوة: {date(g.expiresAt)}</small></div></td>
        <td><time dateTime={g.updatedAt}>{date(g.updatedAt)}</time></td>
        <td><button className="partner-row-action" type="button" data-adaptive-record-trigger={`partner-grant-${g.id}`} onClick={() => inspect("grant", g.id)}>مراجعة الاعتماد ←</button></td>
      </tr>;
    }
    if (row.kind === "partner") {
      const a = row.actor;
      return <tr key={rowId(row)} data-kind="partner"><th scope="row"><bdi dir="ltr">{a.phoneE164}</bdi><small className="store-registry-secondary">شريك دون متجر</small></th>
        <td>حساب شريك</td><td><AccountIndicator role={a} /></td><td>لم يُربط متجر بهذا الحساب</td><td>—</td>
        <td><button type="button" className="partner-row-action" data-adaptive-record-trigger={`partner-actor-${a.actorId}`} onClick={() => inspect("actor", a.actorId)}>ملف الحساب ←</button></td></tr>;
    }
    const s = row.store;
    return <tr key={rowId(row)} data-kind="store" tabIndex={0} onClick={(event) => {
      if (event.target instanceof Element && !event.target.closest("a,button,input,label,select")) inspect("inspect", s.id);
    }} onKeyDown={(event) => {
      if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); inspect("inspect", s.id); }
    }}>
      <th scope="row"><div className="store-registry-identity"><input type="checkbox" aria-label={"تحديد متجر " + s.name} checked={selected.has(rowId(row))} onChange={(event) => { const updated = new Set(selected); if (event.target.checked) updated.add(rowId(row)); else updated.delete(rowId(row)); setSelected(updated); }} /><StoreLogo name={s.name} uri={s.storeProfileImage?.uri} /><div className="store-registry-identity-copy"><strong>{s.name}</strong>{s.partnerActorId ? <Link href={`/partners/actors/${encodeURIComponent(s.partnerActorId)}`} title="فتح ملف الشريك المالك">{s.partnerName || "ملف الشريك"}</Link> : <small>حساب الشريك غير محدد</small>}</div></div></th>
      <td><div className="store-registry-cell-stack"><strong>{s.primaryVerticalName || "متجر"}</strong><small>{s.serviceCityName || "المدينة غير محددة"}</small></div></td>
      <td><div className="store-registry-cell-stack"><span>{publicationStateLabel(s.publicationState)} <PublicationIndicator state={s.publicationState} /></span><span><AccountIndicator role={row.partnerRole} /></span></div></td>
      <td><span className="store-registry-fulfillment-summary" title={s.fulfillmentModes.map(fulfillmentModeLabel).join("، ") || "لا توجد أوضاع توصيل"}>{s.fulfillmentModes.map(fulfillmentModeLabel).join("، ") || "لا توجد أوضاع توصيل"}</span></td>
      <td><time dateTime={s.updatedAt}>{date(s.updatedAt)}</time></td>
      <td><StoreOperationalDecision store={s} role={row.partnerRole} onInspect={() => inspect("inspect", s.id)} /></td>
    </tr>;
  }

  function renderCard(row: Row) {
    const title = row.kind === "joining" ? row.case.firstStoreName || row.case.businessName :
      row.kind === "access" ? row.grant.storeName : row.kind === "store" ? row.store.name : row.actor.phoneE164;
    const subtitle = row.kind === "joining" ? row.case.businessName + " · " + row.case.contactPhoneE164 :
      row.kind === "access" ? "المدعو: " + (row.grant.delegatePhoneMasked || "هاتف محجوب") :
      row.kind === "store" ? (row.store.partnerName || "شريك المتجر") + " · " + (row.store.serviceCityName || "المدينة غير محددة") : "شريك دون متجر";
    const state = row.kind === "joining" ? joiningCaseStateLabel(row.case.state) :
      row.kind === "access" ? "اعتماد دور معلق" : row.kind === "store" ? publicationStateLabel(row.store.publicationState) :
      row.actor.enabled && row.actor.securityEnabled ? "حساب مفعل" : "حساب موقوف";
    const details = row.kind === "joining" ? (row.case.origin === "field" ? "سجل تاريخي" : row.case.origin === "self_service" ? "تسجيل ذاتي" : "عبر المشغّل") + " · آخر تحديث: " + date(row.case.updatedAt) :
      row.kind === "access" ? row.grant.permissions.map((p) => permissionLabels[p] || "صلاحية إضافية").join("، ") + " · انتهاء: " + date(row.grant.expiresAt) :
      row.kind === "store" ? [row.store.primaryVerticalName || "متجر", row.store.fulfillmentModes.map(fulfillmentModeLabel).join("، ") || "بدون توصيل", "تحديث: " + date(row.store.updatedAt)].join(" · ") : "لم يُربط متجر بهذا الحساب";
    const type = row.kind === "joining" ? "case" : row.kind === "access" ? "grant" : row.kind === "store" ? "inspect" : "actor";
    const id = row.kind === "joining" ? row.case.id : row.kind === "access" ? row.grant.id : row.kind === "store" ? row.store.id : row.actor.actorId;
    return <li className="partner-unified-card" key={rowId(row)} data-kind={row.kind}>
      <div className="partner-unified-card-head"><strong>{title}</strong><span className="partner-state-tag is-muted">{caption(row)}</span></div>
      <span className="partner-unified-card-sub">{subtitle}</span>
      <div className="partner-unified-card-details"><span>{state}</span><span>{details}</span></div>
      <div className="partner-unified-card-actions">
        {row.kind === "store" || row.kind === "joining" ? <label className="partner-unified-select"><input type="checkbox" aria-label={"تحديد " + title} checked={selected.has(rowId(row))} onChange={(event) => {
          const updated = new Set(selected);
          if (event.target.checked) updated.add(rowId(row)); else updated.delete(rowId(row));
          setSelected(updated);
        }} /> تحديد</label> : null}
        <button className="partner-row-action" type="button" data-adaptive-record-trigger={`partner-${row.kind}-${id}`} onClick={() => inspect(type, id)}>
          {row.kind === "joining" ? "مراجعة الطلب" : row.kind === "access" ? "اعتماد الوصول" : row.kind === "store" ? "إدارة المتجر" : "ملف الشريك"} ←
        </button>
      </div>
    </li>;
  }

  const grant = selectedGrant?.kind === "access" ? selectedGrant.grant : null;
  const actor = selectedPartner?.kind === "partner" ? selectedPartner.actor : null;
  const detail = openStore ? <StoreInspector key={openStore} storeId={openStore} onClose={close} onUpdated={() => void load()} /> :
    openCase ? <AdaptiveRecordPanel title="ملف طلب الانضمام" onClose={close}><JoiningCaseDetail key={openCase} caseId={openCase} embedded /></AdaptiveRecordPanel> :
    grant ? <AdaptiveRecordPanel title="مراجعة اعتماد الوصول" subtitle={grant.storeName} onClose={close}>
      <dl className="facts-grid"><div><dt>المتجر</dt><dd>{grant.storeName}</dd></div><div><dt>المدعو</dt><dd><bdi dir="ltr">{grant.delegatePhoneMasked || "محجوب"}</bdi></dd></div><div><dt>الصلاحيات المطلوبة</dt><dd>{grant.permissions.map((p) => permissionLabels[p] || "صلاحية إضافية").join("، ")}</dd></div><div><dt>تنتهي الدعوة</dt><dd>{date(grant.expiresAt)}</dd></div><div><dt>آخر تحديث</dt><dd>{date(grant.updatedAt)}</dd></div></dl>
      <p className="store-registry-secondary">يُعتمد الدور فقط إذا كانت الدعوة مقبولة ومستوفية لشروط الوصول. يتحقق الخادم من ذلك قبل الحفظ.</p>
      <button type="button" className="button button-primary" disabled={Boolean(busyGrant)} onClick={() => void approve(grant)}>{busyGrant ? "جارٍ الاعتماد…" : "اعتماد دور الشريك"}</button>
    </AdaptiveRecordPanel> :
    actor ? <AdaptiveRecordPanel title="إدارة حساب الشريك" onClose={close}>
      <PartnerDetailWorkspace key={actor.actorId} actorId={actor.actorId} embedded />
    </AdaptiveRecordPanel> : null;

  const workspaceTabs: ReadonlyArray<{ key: WorkspaceTab; label: string }> = [
    { key: "directory", label: "\u0627\u0644\u0645\u062a\u0627\u062c\u0631 \u0648\u0627\u0644\u0634\u0631\u0643\u0627\u0621" },
    { key: "joining", label: "\u0637\u0644\u0628\u0627\u062a \u0627\u0644\u0627\u0646\u0636\u0645\u0627\u0645" },
    { key: "access", label: "\u0627\u0639\u062a\u0645\u0627\u062f\u0627\u062a \u0627\u0644\u0648\u0635\u0648\u0644" },
  ];
  const registryPanel = <section className="partner-unified-tab-panel">
      <form className="workspace-toolbar partner-unified-toolbar" noValidate onSubmit={(event) => event.preventDefault()}>
        <div className="field-label"><label htmlFor="partner-unified-search">{activeTab === "directory" ? "بحث في المتاجر والشركاء" : activeTab === "joining" ? "بحث في طلبات الانضمام" : "بحث في اعتمادات الوصول"}</label>
          <Input.Search id="partner-unified-search" aria-label={activeTab === "directory" ? "بحث في المتاجر والشركاء" : activeTab === "joining" ? "بحث في طلبات الانضمام" : "بحث في اعتمادات الوصول"} value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} onSearch={(value) => navigate(activeTab, kind, status, city, sort, value.trim().slice(0, 100))} placeholder={activeTab === "directory" ? "المتجر أو الشريك أو رقم الهاتف" : activeTab === "joining" ? "اسم النشاط أو رقم الهاتف" : "اسم المتجر أو هاتف المدعو"} allowClear enterButton="بحث" />
        </div>
        {activeTab === "directory" ? <div className="field-label"><label htmlFor="partner-unified-kind">نوع السجل</label>
          <Select id="partner-unified-kind" aria-label="نوع السجل" value={kind} onChange={(value: Kind) => navigate(activeTab, value, "", "", sort, appliedSearch)} options={[...kindOptions]} />
        </div> : null}
        <div className="field-label"><label htmlFor="partner-unified-status">الحالة</label>
          <Select id="partner-unified-status" aria-label="الحالة" value={status} onChange={(next: string) => navigate(activeTab, kind, next, city, sort, appliedSearch)} options={[...statusOptions]} />
        </div>
        <button type="button" className="button button-secondary" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>خيارات إضافية</button>
        {filtersOpen ? <div className="partner-unified-extra">
          <div className="field-label"><label htmlFor="partner-unified-sort">ترتيب السجلات</label>
            <Select id="partner-unified-sort" aria-label="ترتيب السجلات" value={sort} onChange={(value: string) => navigate(activeTab, kind, status, city, value, appliedSearch)} options={[{ value: "newest", label: "الأحدث أولًا" }, { value: "oldest", label: "الأقدم أولًا" }]} />
          </div>
          {activeTab === "directory" ? <div className="field-label"><label htmlFor="partner-unified-city">مدينة المتاجر فقط</label>
            <Select id="partner-unified-city" aria-label="مدينة المتاجر فقط" value={city} onChange={(value: string) => navigate("directory", "store", status, value, sort, appliedSearch)} options={[{ value: "", label: "كل المدن" }, ...cities.map((entry) => ({ value: entry.id, label: entry.displayNameAr }))]} />
          </div> : null}
        </div> : null}
      </form>
      {kind !== defaultKindByTab[activeTab] || status || city || appliedSearch ? <div className="partner-unified-active"><span>تم تطبيق مرشحات على العرض الحالي</span><button type="button" className="button button-secondary" onClick={() => { setSearch(""); navigate(activeTab, defaultKindByTab[activeTab], "", "", "newest", ""); }}>مسح المرشحات</button></div> : null}
      <div className="partner-registry-summary"><span>{activeTab === "joining" ? "طلبات الانضمام" : activeTab === "access" ? "اعتمادات الوصول" : "المتاجر وحسابات الشركاء"} · {rows.length} سجلًا في الصفحة</span>
        {selectedRecords.length ? <div className="partner-registry-bulk-actions"><span>{selectedRecords.length} سجل محدد</span><button type="button" className="button button-secondary" onClick={exportSelected}>تصدير المحدد</button><button type="button" className="button button-secondary" onClick={() => setSelected(new Set())}>إلغاء التحديد</button></div> : null}</div>
      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذرت قراءة السجلات</strong><p>{error}</p><button type="button" className="button button-secondary" onClick={() => void load()}>إعادة المحاولة</button></div> : null}
      {loading && !rows.length ? <div className="collection-state" role="status">جارٍ تحميل سجلات الشركاء والمتاجر…</div> : null}
      {!loading && !error && !rows.length ? <div className="collection-state"><strong>{nextCursor ? "لا توجد مطابقة في هذه الصفحة" : "لا توجد سجلات مطابقة"}</strong><p>{nextCursor ? "قد توجد نتائج أخرى في الصفحة التالية." : activeTab === "directory" ? "جرّب تغيير نوع السجل أو المرشحات." : "جرّب تغيير الحالة أو كلمات البحث."}</p></div> : null}
      {rows.length > 0 ? <div className="store-registry-table-wrap partner-unified-table-wrap"><table className="operations-table partner-registry-table partner-unified-table">
        <caption className="visually-hidden">{activeTab === "joining" ? "طلبات انضمام الشركاء" : activeTab === "access" ? "اعتمادات وصول المتاجر" : kind === "partner" ? "حسابات الشركاء دون متجر" : "دليل المتاجر والشركاء"}</caption>
        <thead><tr>
          <th scope="col">الشريك / المتجر</th>
          {activeTab === "directory" ? <RegistryColumnHeader label="النوع والموقع" active={Boolean(city || kind !== defaultKindByTab[activeTab])}>
            <label>نوع السجل<select value={kind} onChange={(event) => navigate(activeTab, event.target.value as Kind, "", "", sort, appliedSearch)}>
              {kindOptions.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select></label>
            <label>المدينة<select value={city} onChange={(event) => navigate("directory", "store", status, event.target.value, sort, appliedSearch)}>
              <option value="">كل المدن</option>{cities.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayNameAr}</option>)}
            </select></label>
          </RegistryColumnHeader> : <th scope="col">النوع والموقع</th>}
          {statusOptions.length > 1 ? <RegistryColumnHeader label="الحالة" active={Boolean(status)}>
            <label>حالة السجل<select value={status} onChange={(event) => navigate(activeTab, kind, event.target.value, city, sort, appliedSearch)}>
              {statusOptions.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select></label>
          </RegistryColumnHeader> : <th scope="col">الحالة</th>}
          <th scope="col">البيانات والخطوة المطلوبة</th>
          <RegistryColumnHeader label="آخر تحديث" active={sort === "oldest"}>
            <label>الترتيب<select value={sort} onChange={(event) => navigate(activeTab, kind, status, city, event.target.value, appliedSearch)}>
              <option value="newest">الأحدث أولًا</option><option value="oldest">الأقدم أولًا</option>
            </select></label>
          </RegistryColumnHeader>
          <th scope="col">الإجراء</th>
        </tr></thead>
        <tbody>{rows.map(renderRow)}</tbody>
      </table></div> : null}
      {rows.length > 0 ? <ul className="partner-unified-cards" aria-label="سجلات الشركاء على الهاتف">{rows.map(renderCard)}</ul> : null}
      {activeTab === "directory" && kind === "store" && rows.length > 0 ? <details className="partner-legend-details"><summary>دليل رموز الحالة</summary><aside className="record-legend partner-registry-legend" aria-label="دليل رموز الحساب والنشر والتوصيل">
        <div><strong>الحساب</strong><RecordIndicator legend icon="active" label="الحساب نشط" tone="success" /><RecordIndicator legend icon="pending" label="الحساب بانتظار التفعيل" tone="warning" /><RecordIndicator legend icon="paused" label="الحساب موقوف" tone="warning" /><RecordIndicator legend icon="unknown" label="حالة الحساب غير متاحة" /></div>
        <div><strong>النشر</strong><RecordIndicator legend icon="published" label="منشور" tone="success" /><RecordIndicator legend icon="unpublished" label="غير منشور" /><RecordIndicator legend icon="hidden" label="مخفي" /></div>
        <div><strong>التوصيل</strong><RecordIndicator legend icon="rider" label="توصيل بثواني" /><RecordIndicator legend icon="storeDelivery" label="توصيل المتجر" /><RecordIndicator legend icon="pickup" label="استلم بنفسك من المتجر" /></div>
      </aside></details> : null}
      <footer className="registry-footer"><CursorPagination page={page} nextCursor={nextCursor} disabled={loading || Boolean(busyGrant)} label="صفحات السجل الموحد للشركاء" /></footer>
      </section>;

  const triggerKey = openStore ? `partner-store-${openStore}` : openCase ? `partner-case-${openCase}` : openGrant ? `partner-grant-${openGrant}` : openPartner ? `partner-actor-${openPartner}` : undefined;
  return <AdaptiveRecordWorkspace open={Boolean(selectedId)} detail={detail} preferenceKey="partners-unified" {...(triggerKey ? { triggerKey } : {})} onClose={close}>
    <section className="workspace-page partners-unified-workbench store-registry" aria-label="السجل الموحد للشركاء والمتاجر">
      <PageHeader id="partners-unified-title" title="الشركاء والمتاجر" actions={activeTab === "joining" ? <Link className="button button-primary" href="/partners/new">+ طلب انضمام جديد</Link> : null} />
      <Tabs id="partners-workspace" activeKey={activeTab} onChange={(key) => { if (key === "directory" || key === "joining" || key === "access") selectTab(key); }} renderTabBar={(props, DefaultTabBar) => <DefaultTabBar {...{ ...props, "aria-label": "\u0623\u0642\u0633\u0627\u0645 \u0627\u0644\u0634\u0631\u0643\u0627\u0621 \u0648\u0627\u0644\u0645\u062a\u0627\u062c\u0631" }} />} classNames={{ header: "partner-unified-section-tabs" }} items={workspaceTabs.map((tab) => ({ key: tab.key, label: tab.label, children: activeTab === tab.key ? registryPanel : null }))} />
    </section>
  </AdaptiveRecordWorkspace>;
}
