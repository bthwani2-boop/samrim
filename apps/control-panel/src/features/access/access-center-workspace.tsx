"use client";

import { TextArea } from "@bthwani/design-system/web";
import type { ActorRoleView, OperatorProfile, OperatorProfilePage } from "@bthwani/identity";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HRAccessRequest, HRAccessRequestPage } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";
import { operatorWorkspacePermissions } from "../../session/operator-permissions";
import { useSession } from "../../session/session-provider";
import { AdaptiveRecordPanel, AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { AccountAccessPanel } from "./account-access-panel";
import { HRPermissionReview } from "./hr-permission-review";

type Source = "requests" | "profiles" | "operators";
type Mode = "all" | "attention" | "requests" | "profiles" | "operators" | "active" | "paused";
type Coverage = "all" | "none" | "some" | "complete";
type OperatorPage = Readonly<{ items: ReadonlyArray<ActorRoleView>; nextCursor?: string }>;
type Pages = Readonly<{ requests: readonly HRAccessRequest[]; profiles: readonly OperatorProfile[]; operators: readonly ActorRoleView[] }>;
type Cursors = Readonly<Record<Source, string>>;
type Row = Readonly<{
  key: string;
  kind: Source;
  name: string;
  phone: string;
  job: string;
  department: string;
  state: string;
  tone: string;
  action: string;
  attention: boolean;
  timestamp: string;
  permissions: string;
  request?: HRAccessRequest | undefined;
  profile?: OperatorProfile;
  operator?: ActorRoleView;
}>;

const emptyPages: Pages = { requests: [], profiles: [], operators: [] };
const emptyCursors: Cursors = { requests: "", profiles: "", operators: "" };
const sources: readonly Source[] = ["requests", "profiles", "operators"];

function displayDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ar-YE-u-nu-latn", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function operatorState(item: ActorRoleView) {
  if (!item.securityEnabled) return { state: "الهوية موقوفة", tone: "is-paused", attention: true };
  if (!item.enabled) return { state: "الدور موقوف", tone: "is-paused", attention: true };
  if (!item.activatedAt) return { state: "بانتظار التفعيل", tone: "is-waiting", attention: true };
  return { state: "نشط", tone: "is-active", attention: false };
}

function profileState(item: OperatorProfile) {
  if (item.state === "pending_review") return { state: "ملف ينتظر المراجعة", action: "اعتماد الملف", attention: true };
  if (item.state === "approved") return { state: "معتمد · ينتظر الدور", action: "منح الدور", attention: true };
  if (!item.roleEnabled || !item.securityEnabled) return { state: "الحساب موقوف", action: "مراجعة الحساب", attention: true };
  if (!item.activatedAt) return { state: "بانتظار التفعيل", action: "إصدار دعوة", attention: true };
  return { state: "نشط", action: "عرض الملف", attention: false };
}

function requestState(item: HRAccessRequest) {
  if (item.state === "pending_review") return { state: "طلب ينتظر المراجعة", action: "مراجعة الطلب", attention: true };
  if (item.state === "identity_provisioning") return { state: "ملف الهوية قيد الإنشاء", action: "استكمال الربط", attention: true };
  if (item.state === "rejected") return { state: "طلب مرفوض", action: "عرض السبب", attention: false };
  return { state: "أُحيل إلى الهوية", action: "عرض حالة الطلب", attention: false };
}

/** These are bounded source pages, not a fabricated platform-wide total or a guessed join by phone. */
function rowsFromPages(pages: Pages): Row[] {
  const operatorIds = new Set(pages.operators.map((item) => item.actorId));
  const profileIds = new Set(pages.profiles.map((item) => item.id));
  const latestRequests = [...pages.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Preserve the actionable review record until its activation invitation is issued.
  const invitationPendingActorIds = new Set(pages.profiles
    .filter((profile) => profile.actorId && profile.state === "admitted" && profile.roleEnabled && profile.securityEnabled && !profile.activatedAt)
    .map((profile) => profile.actorId!));
  const rows: Row[] = pages.operators.filter((item) => !invitationPendingActorIds.has(item.actorId)).map((item) => {
    const result = operatorState(item);
    const count = item.operatorEnabledPermissionCount;
    return {
      key: "operator:" + item.actorId, kind: "operators", name: item.fullNameAr || item.phoneE164,
      phone: item.phoneE164, job: item.jobTitle || "المسمى غير مسجل", department: item.department || "القسم غير مسجل",
      state: result.state, tone: result.tone, action: result.attention ? "إدارة الحساب" : "مراجعة الصلاحيات",
      attention: result.attention, timestamp: item.lastAuthenticatedAt || "",
      permissions: typeof count === "number" ? count + " من " + operatorWorkspacePermissions.length : "غير متاحة",
      operator: item,
      request: latestRequests.find((request) => request.operatorActorId === item.actorId),
    };
  });

  for (const profile of pages.profiles) {
    if (profile.actorId && operatorIds.has(profile.actorId) && !invitationPendingActorIds.has(profile.actorId)) continue;
    const result = profileState(profile);
    rows.push({
      key: "profile:" + profile.id, kind: "profiles", name: profile.fullNameAr,
      phone: profile.phoneE164 || "", job: profile.jobTitle || "المسمى غير مسجل",
      department: profile.department || "القسم غير مسجل", state: result.state,
      tone: result.attention ? "is-waiting" : "is-active", attention: result.attention,
      action: result.action, timestamp: profile.updatedAt || profile.createdAt, permissions: "بانتظار قراءة الهوية",
      profile,
      request: latestRequests.find((request) => request.operatorProfileId === profile.id || Boolean(profile.actorId && request.operatorActorId === profile.actorId)),
    });
  }
  const employeeIds = new Set<string>();
  for (const request of latestRequests) {
    // Linked records are represented by their profile/account when that owner was actually loaded.
    if (request.operatorActorId && operatorIds.has(request.operatorActorId)) continue;
    if (request.operatorProfileId && profileIds.has(request.operatorProfileId)) continue;
    if (employeeIds.has(request.employeeId)) continue;
    employeeIds.add(request.employeeId);
    const result = requestState(request);
    rows.push({
      key: "request:" + request.id, kind: "requests", name: request.employeeName,
      phone: request.phoneE164, job: request.jobTitle, department: request.department,
      state: result.state, tone: result.attention ? "is-waiting" : "is-paused",
      action: result.action, attention: result.attention, timestamp: request.createdAt,
      permissions: request.requestedPermissions.length + " مقترحة · غير ممنوحة تلقائيًا", request,
    });
  }
  return rows.sort((a, b) => Number(b.attention) - Number(a.attention) || b.timestamp.localeCompare(a.timestamp) || a.key.localeCompare(b.key));
}

function sourceLabel(source: Source) {
  return source === "requests" ? "طلبات الوصول" : source === "profiles" ? "ملفات المراجعة" : "الحسابات";
}

function isMatch(row: Row, query: string) {
  const value = query.trim().toLocaleLowerCase("ar");
  return !value || [row.name, row.phone, row.job, row.department, row.state].some((field) => field.toLocaleLowerCase("ar").includes(value));
}

export function AccessCenterWorkspace() {
  const { state: session } = useSession();
  const searchParams = useSearchParams();
  const root = session.kind === "authenticated" && session.identity.canManageOperatorPermissions === true;
  const [pages, setPages] = useState<Pages>(emptyPages);
  const [cursors, setCursors] = useState<Cursors>(emptyCursors);
  const [mode, setMode] = useState<Mode>(() => {
    const oldView = searchParams.get("view");
    return oldView === "requests" ? "requests" : oldView === "operators" || oldView === "profiles" ? "profiles" : oldView === "permissions" ? "operators" : "all";
  });
  const [coverage, setCoverage] = useState<Coverage>("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Source, string>>>({});
  const [message, setMessage] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const epoch = useRef(0);
  const rejectMutation = useRef<{ signature: string; key: string } | null>(null);
  const requested = useRef(false);

  const load = useCallback(async (more: boolean, applied = search, permissionFilter = coverage) => {
    const id = ++epoch.current;
    setLoading(true);
    setErrors({});
    const nextPages: Pages = more ? pages : emptyPages;
    const nextCursors: Cursors = more ? cursors : emptyCursors;
    const eligible = more ? sources.filter((source) => Boolean(nextCursors[source])) : sources;
    const results = await Promise.allSettled(eligible.map(async (source) => {
      const params = new URLSearchParams();
      if (more && nextCursors[source]) params.set("cursor", nextCursors[source]);
      if (source !== "requests") {
        params.set("q", applied);
        params.set("limit", "25");
        if (source === "operators" && permissionFilter !== "all") params.set("permissionCoverage", permissionFilter);
      }
      const response = await identityFetch("/api/access/" + (
        source === "requests" ? "hr-requests" : source === "profiles" ? "operator-profiles" : "operators"
      ) + "?" + params.toString(), { cache: "no-store" });
      if (!response.ok) throw new Error("تعذرت قراءة " + sourceLabel(source) + " (" + response.status + ").");
      const data = await response.json() as HRAccessRequestPage & OperatorProfilePage & OperatorPage;
      return { source, items: data.items, nextCursor: data.nextCursor || "" };
    }));
    // A failed source does not erase successfully loaded sources or masquerade as an empty registry.
    if (id !== epoch.current) return false;
    const merged: Record<Source, readonly unknown[]> = {
      requests: nextPages.requests, profiles: nextPages.profiles, operators: nextPages.operators,
    };
    const next: Record<Source, string> = { ...nextCursors };
    const faults: Partial<Record<Source, string>> = {};
    results.forEach((result, index) => {
      const source = eligible[index];
      if (!source) return;
      if (result.status === "fulfilled") {
        const value = result.value;
        merged[source] = more ? [...merged[source], ...value.items] : value.items;
        next[source] = value.nextCursor;
      } else {
        faults[source] = "تعذرت قراءة " + sourceLabel(source) + ". حاول تحديث القائمة.";
      }
    });
    setPages(merged as Pages);
    setCursors(next);
    setErrors(faults);
    setLoading(false);
    return Object.keys(faults).length === 0;
  }, [pages, cursors, search, coverage]);

  useEffect(() => {
    if (!root || requested.current) return;
    requested.current = true;
    void load(false, "");
  }, [root, load]);

  const rows = useMemo(() => rowsFromPages(pages), [pages]);
  const visible = useMemo(() => rows.filter((row) => {
    // Identity applies its canonical server search; only HR requests lack a server query.
    if (row.kind === "requests" && !isMatch(row, search)) return false;
    if (mode === "attention") return row.attention;
    if (mode === "requests") return row.kind === "requests";
    if (mode === "profiles") return row.kind === "profiles";
    if (mode === "operators") return row.kind === "operators";
    if (mode === "active") return row.kind === "operators" && row.state === "نشط";
    if (mode === "paused") return row.kind === "operators" && row.state !== "نشط";
    return true;
  }), [rows, search, mode]);
  const current = rows.find((row) => row.key === selected);
  const pending = rows.filter((row) => row.attention).length;
  const active = rows.filter((row) => row.kind === "operators" && row.state === "نشط").length;
  const awaiting = rows.filter((row) => row.state === "بانتظار التفعيل").length;
  const paused = rows.filter((row) => row.kind === "operators" && row.state !== "نشط" && row.state !== "بانتظار التفعيل").length;
  const hasMore = sources.some((source) => Boolean(cursors[source]));
  const hasErrors = Object.values(errors).some(Boolean);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = query.trim().slice(0, 100);
    setSearch(next);
    setSelected(null);
    setPages(emptyPages);
    setCursors(emptyCursors);
    void load(false, next);
  }

  function changeCoverage(next: Coverage) {
    setCoverage(next);
    setMode("operators");
    setSelected(null);
    setPages(emptyPages);
    setCursors(emptyCursors);
    void load(false, search, next);
  }

  function select(row: Row) {
    if (busy) return;
    setSelected(row.key);
    setReason("");
    setMessage("");
    setInvitationCode("");
  }

  async function act(path: string, body: object, success: string, idempotencyKey?: string) {
    setBusy(true);
    setMessage("");
    setInvitationCode("");
    try {
      const response = await identityFetch(path, {
        method: "POST", headers: {
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(response.status === 409 || response.status === 412
        ? "تغيرت حالة السجل. حدّث بياناته قبل اتخاذ قرار جديد."
        : "تعذر إكمال الإجراء (" + response.status + ").");
      if (body && "action" in body && body.action === "invitation") {
        const responseData = await response.json() as { enrollmentToken?: { code?: string } };
        setInvitationCode(responseData.enrollmentToken?.code || "");
      }
      setReason("");
      const verified = await load(false);
      setMessage(verified ? success : "قُبل الإجراء، لكن تعذرت قراءة الحالة النهائية من جميع المصادر. حدّث السجل قبل إجراء آخر.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر إكمال الإجراء.");
    } finally {
      setBusy(false);
    }
  }

  async function actOnCurrent() {
    if (!current || busy) return;
    if (current.kind === "requests" && current.request) {
      if (current.request.state === "pending_review" || current.request.state === "identity_provisioning") {
        await act("/api/access/hr-requests/" + encodeURIComponent(current.request.id) + "/profile", {},
          "تمت معالجة طلب إنشاء ملف الهوية. راجع الحالة المحدّثة.");
      }
      return;
    }
    if (current.kind === "profiles" && current.profile) {
      const profile = current.profile;
      const action = profile.state === "pending_review" ? "approve" : profile.state === "approved" ? "grant" : "invitation";
      if (action === "invitation" && (profile.state !== "admitted" || profile.activatedAt || !profile.roleEnabled || !profile.securityEnabled)) return;
      if (action === "approve" && (!profile.jobTitle?.trim() || !profile.department?.trim())) {
        setMessage("يجب استكمال المسمى والقسم قبل الاعتماد.");
        return;
      }
      await act("/api/access/operator-profiles/" + encodeURIComponent(profile.id), { action, ...(action !== "invitation" ? { expectedVersion: profile.version } : {}) },
        action === "approve" ? "اعتُمد الملف. الخطوة التالية منح الدور." : action === "grant" ? "مُنح الدور. راجع دعوة التفعيل." : "أُصدرت دعوة التفعيل.");
    }
  }

  async function rejectRequest() {
    if (!current?.request || current.request.state !== "pending_review" || reason.trim().length < 8 || reason.trim().length > 500) return;
    const signature = JSON.stringify({ id: current.request.id, version: current.request.version, reason: reason.trim() });
    if (rejectMutation.current?.signature !== signature) rejectMutation.current = { signature, key: crypto.randomUUID() };
    await act("/api/access/hr-requests/" + encodeURIComponent(current.request.id) + "/reject",
      { expectedVersion: current.request.version, reason: reason.trim() }, "رُفض الطلب مع تسجيل السبب.", rejectMutation.current.key);
  }

  if (!root) return <div className="collection-state" role="status"><strong>إدارة الوصول والصلاحيات مقيّدة</strong><p>لا يملك حسابك تفويض إدارة المشغّلين. تُدار هذه الصلاحيات من المشغّل الأساسي.</p></div>;

  const closeSelected = () => { if (!busy) { setSelected(null); setInvitationCode(""); setMessage(""); } };
  return <AdaptiveRecordWorkspace open={Boolean(current)} preferenceKey="access" onClose={closeSelected} detail={current ? <AdaptiveRecordPanel title={current.name} subtitle={current.job + " · " + current.department} onClose={closeSelected}>
      <div className="access-center-details">
        <div className="access-center-detail-status"><span className={"access-state-pill " + current.tone}>{current.state}</span><span>{sourceLabel(current.kind)}</span></div>
        {current.request && current.kind !== "requests" ? <section className="access-center-linked-request" aria-label="طلب الوصول المرتبط">
          <h3>طلب الوصول المرتبط</h3>
          <p><strong>السبب:</strong> {current.request.reason}</p>
          <p><strong>المقترحة من الموارد البشرية:</strong> {current.request.requestedPermissions.map((key) => operatorWorkspacePermissions.find((entry) => entry.key === key)?.label || "صلاحية غير معروفة").join("، ") || "لا توجد"}</p>
          {current.request.operatorActorId ? <HRPermissionReview key={current.request.id} request={current.request} /> : <p>الصلاحيات المقترحة ليست منحًا فعليًا.</p>}
        </section> : null}
        {message ? <p role="status" className="access-center-message">{message}</p> : null}
        {invitationCode ? <div className="access-center-invitation"><strong>رمز دعوة التفعيل (يظهر مرة واحدة)</strong><code>{invitationCode}</code><p>سلّمه للشخص المعني عبر قناة آمنة.</p></div> : null}
        {current.kind === "operators" && current.operator ? <>
          <AccountAccessPanel key={current.operator.actorId} selectedPhone={current.operator.phoneE164} onClear={() => setSelected(null)} embedded />
          <Link className="button button-secondary" href={"/access/operators/" + encodeURIComponent(current.operator.phoneE164)}>فتح ملف المشغّل الكامل</Link>
        </> : null}
        {current.kind === "profiles" && current.profile ? <>
          <dl className="access-center-facts"><div><dt>الهاتف</dt><dd><bdi dir="ltr">{current.phone || "غير متاح"}</bdi></dd></div><div><dt>تاريخ إنشاء الملف</dt><dd>{displayDate(current.profile.createdAt)}</dd></div><div><dt>المرحلة</dt><dd>{current.state}</dd></div></dl>
          {current.profile.actorId && current.profile.phoneE164 ? <Link className="button button-secondary" href={"/access/operators/" + encodeURIComponent(current.profile.phoneE164)}>ملف الحساب المرتبط</Link> : null}
          {(current.profile.state === "pending_review" || current.profile.state === "approved" || current.profile.state === "admitted" && !current.profile.activatedAt && current.profile.roleEnabled && current.profile.securityEnabled) ?
            <button className="button button-primary" disabled={busy} type="button" onClick={() => void actOnCurrent()}>{busy ? "جارٍ التنفيذ…" : current.action}</button> : null}
          {current.profile.state === "pending_review" && (!current.profile.jobTitle?.trim() || !current.profile.department?.trim()) ? <p>المسمى الوظيفي والقسم مطلوبان قبل الاعتماد؛ راجع الملف الوظيفي المرتبط.</p> : null}
        </> : null}
        {current.kind === "requests" && current.request ? <>
          <dl className="access-center-facts">
            <div><dt>الهاتف</dt><dd><bdi dir="ltr">{current.phone}</bdi></dd></div>
            <div><dt>سبب طلب الوصول</dt><dd>{current.request.reason}</dd></div>
            <div><dt>الصلاحيات المقترحة</dt><dd>{current.request.requestedPermissions.map((key) => operatorWorkspacePermissions.find((permission) => permission.key === key)?.label || "صلاحية غير معروفة").join("، ") || "لا توجد"}</dd></div>
            <div><dt>تاريخ الطلب</dt><dd>{displayDate(current.request.createdAt)}</dd></div>
          </dl>
          {current.request.rejectionReason ? <p>سبب الرفض: {current.request.rejectionReason}</p> : null}
          {(current.request.state === "pending_review" || current.request.state === "identity_provisioning") ? <>
            <button className="button button-primary" type="button" disabled={busy} onClick={() => void actOnCurrent()}>{busy ? "جارٍ التنفيذ…" : current.action}</button>
            {current.request.state === "pending_review" ? <div className="access-center-reject"><label htmlFor="access-reject-reason">سبب رفض الطلب</label>
              <TextArea className="resize-none" id="access-reject-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} placeholder="سبب واضح لإعادة الطلب إلى الموارد البشرية" />
              <button type="button" className="button button-secondary" disabled={busy || reason.trim().length < 8} onClick={() => void rejectRequest()}>رفض الطلب مع السبب</button>
            </div> : null}
          </> : null}
          {current.request.operatorActorId ? <HRPermissionReview key={current.request.id} request={current.request} /> : null}
          <Link className="button button-quiet" href={"/hr/employees/" + encodeURIComponent(current.request.employeeId)}>ملف الموظف</Link>
        </> : null}
      </div>
    </AdaptiveRecordPanel> : null}>
    <section className="access-center" aria-label="السجل الموحد للوصول والصلاحيات">
    {!current && message ? <p role="status" className="access-center-message">{message}</p> : null}
    {!current && invitationCode ? <div className="access-center-invitation" role="status"><strong>رمز التفعيل (يظهر مرة واحدة)</strong><code>{invitationCode}</code><button type="button" className="button button-secondary" onClick={() => setInvitationCode("")}>إغلاق الرمز</button></div> : null}
    <section className="access-center-metrics" aria-label="مؤشرات السجلات المحمّلة">
      <button type="button" onClick={() => setMode("attention")} aria-pressed={mode === "attention"}><small>تحتاج متابعة</small><strong>{loading && !rows.length ? "—" : pending}</strong></button>
      <button type="button" onClick={() => setMode("all")} aria-pressed={mode === "all"}><small>سجلات محمّلة</small><strong>{loading && !rows.length ? "—" : rows.length}</strong></button>
      <button type="button" onClick={() => setMode("active")} aria-pressed={mode === "active"}><small>حسابات نشطة</small><strong>{loading && !rows.length ? "—" : active}</strong></button>
      <button type="button" onClick={() => setMode("paused")} aria-pressed={mode === "paused"}><small>حسابات موقوفة</small><strong>{loading && !rows.length ? "—" : paused}</strong></button>
    </section>
    <div className="access-center-toolbar">
      <form className="access-center-search" noValidate onSubmit={submitSearch}>
        <label className="visually-hidden" htmlFor="access-center-search">بحث عن موظف أو مشغّل</label>
        <input id="access-center-search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder="بحث بالاسم أو الهاتف أو القسم" />
        <button className="button button-secondary" type="submit" disabled={loading}>بحث</button>
        {search ? <button className="button button-quiet" type="button" onClick={() => { setQuery(""); setSearch(""); setPages(emptyPages); setCursors(emptyCursors); void load(false, ""); }}>مسح</button> : null}
      </form>
      <label className="access-center-mode"><span>عرض</span><select value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
        <option value="all">جميع السجلات</option>
        <option value="attention">تحتاج متابعة</option>
        <option value="requests">طلبات الوصول</option>
        <option value="profiles">ملفات المراجعة</option>
        <option value="operators">حسابات المشغّلين</option>
        <option value="active">الحسابات النشطة</option>
        <option value="paused">غير النشطة</option>
      </select></label>
      <label className="access-center-mode"><span>الصلاحيات</span><select aria-label="تصفية حسب نطاق الصلاحيات" value={coverage} onChange={(event) => changeCoverage(event.target.value as Coverage)} disabled={loading}>
        <option value="all">كل النطاقات</option>
        <option value="none">بدون صلاحيات</option>
        <option value="some">صلاحيات جزئية</option>
        <option value="complete">وصول كامل</option>
      </select></label>
      <button type="button" className="button button-secondary" disabled={loading || busy} onClick={() => void load(false)}>تحديث</button>
      <Link className="button button-quiet" href="/hr/employees">الموظفون</Link>
    </div>
    <p className="access-center-scope">الأرقام والفرز تخص السجلات المحمّلة فقط. بحث المشغّلين خادمي؛ أما طلبات الموارد البشرية فيُبحث داخل صفحاتها المحمّلة.</p>
    {search && cursors.requests ? <p className="access-center-scope">قد توجد طلبات وصول مطابقة في صفحات أخرى؛ استخدم «تحميل المزيد» لاستكمال نتائج الطلبات.</p> : null}
    {hasErrors ? <div className="managed-status managed-status-warning" role="alert"><strong>بعض المصادر لم تُحمَّل</strong><p>{Object.values(errors).filter(Boolean).join(" ")}</p><button className="button button-secondary" type="button" onClick={() => void load(false)}>إعادة المحاولة</button></div> : null}
    <div className="access-center-table-wrap" aria-busy={loading}>
      <table className="operations-table access-table access-center-table">
        <caption className="visually-hidden">السجل الموحد لطلبات الوصول وملفات المراجعة والحسابات</caption>
        <thead><tr><th scope="col">الموظف / المشغّل</th><th scope="col">حالة الوصول</th><th scope="col">الصلاحيات</th><th scope="col">آخر نشاط / تحديث</th><th scope="col">الإجراء التالي</th></tr></thead>
        <tbody>
          {visible.map((row) => <tr key={row.key}>
            <th scope="row"><div className="access-center-person"><strong>{row.name}</strong><span>{row.job} · {row.department}</span><small>{sourceLabel(row.kind)}{row.phone ? " · " : ""}<bdi dir="ltr">{row.phone}</bdi></small></div></th>
            <td><span className={"access-state-pill " + row.tone}>{row.state}</span></td>
            <td><span className="access-center-permissions">{row.permissions}</span></td>
            <td><span className="access-center-event-type">{row.kind === "requests" ? "تاريخ الطلب" : row.kind === "profiles" ? "تحديث الملف" : "آخر دخول موثّق"}</span>{row.timestamp ? <time dateTime={row.timestamp}>{displayDate(row.timestamp)}</time> : <span className="access-center-event-missing">لم يسجل دخولًا</span>}</td>
            <td><button className="button button-secondary access-row-action" type="button" onClick={() => select(row)}>{row.action}</button></td>
          </tr>)}
          {!visible.length && !loading && !hasErrors ? <tr><td colSpan={5}><div className="collection-state"><strong>لا توجد سجلات مطابقة في النتائج المحمّلة</strong><p>غيّر التصفية أو حمّل صفحات إضافية إن كانت متاحة.</p></div></td></tr> : null}
          {loading && !rows.length ? <tr><td colSpan={5}>جارٍ قراءة بيانات الوصول والصلاحيات…</td></tr> : null}
        </tbody>
      </table>
      <ul className="access-center-mobile" aria-label="سجلات الوصول والصلاحيات">
        {visible.map((row) => <li key={row.key}>
          <div className="access-center-mobile-heading">
            <strong>{row.name}</strong>
            <span className={"access-state-pill " + row.tone}>{row.state}</span>
          </div>
          <p>{row.job} · {row.department}</p>
          <small>{sourceLabel(row.kind)}{row.phone ? " · " : ""}<bdi dir="ltr">{row.phone}</bdi></small>
          <div className="access-center-mobile-meta">
            <span>{row.permissions}</span>
            {row.timestamp ? <time dateTime={row.timestamp}>{displayDate(row.timestamp)}</time> : <span>آخر نشاط غير متاح</span>}
          </div>
          <button className="button button-secondary access-row-action" type="button" onClick={() => select(row)}>{row.action}</button>
        </li>)}
        {!visible.length && !loading && !hasErrors ? <li className="collection-state">لا توجد سجلات مطابقة في النتائج المحمّلة</li> : null}
        {loading && !rows.length ? <li className="collection-state">جارٍ قراءة بيانات الوصول والصلاحيات…</li> : null}
      </ul>
    </div>
    <div className="access-center-footer">
      <span>{visible.length} سجلًا ظاهرًا{hasMore ? " · توجد صفحات أخرى" : ""}{awaiting ? " · " + awaiting + " بانتظار التفعيل" : ""}</span>
      {hasMore ? <button type="button" className="button button-secondary" disabled={loading || busy} onClick={() => void load(true)}>{loading ? "جارٍ التحميل…" : "تحميل المزيد"}</button> : null}
    </div>

    </section>
  </AdaptiveRecordWorkspace>;
}
