"use client";

import { toAsciiDigits } from "@bthwani/design-system";
import type { OperatorPermission, OperatorPermissionAccess } from "@bthwani/identity";
import { useCallback, useEffect, useRef, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { operatorWorkspacePermissions } from "../../session/operator-permissions";
import { useSession } from "../../session/session-provider";
import { responseMessage } from "./identity-error-message";

type ManagedOperatorStatus = Readonly<{
  role: "operator";
  actorId?: string;
  fullNameAr?: string;
  phoneE164: string;
  jobTitle?: string;
  department?: string;
  exists: boolean;
  enabled: boolean;
  activated: boolean;
  securityEnabled: boolean;
  state?: string;
  createdAt?: string;
  activatedAt?: string;
  lastAuthenticatedAt?: string;
  actorVersion?: number;
  roleVersion?: number;
  operatorPermissions?: Partial<Record<OperatorPermission, OperatorPermissionAccess>>;
}>;

function accountStateLabel(state: string | undefined): string {
  if (state === "active") return "نشط";
  if (state === "identity_disabled") return "الهوية موقوفة";
  if (state === "role_disabled") return "الدور موقوف";
  if (state === "pending_activation") return "بانتظار التفعيل";
  return "غير مهيأ";
}

function accountStateTone(status: ManagedOperatorStatus): string {
  if (!status.exists || !status.enabled || !status.securityEnabled) return "is-paused";
  if (!status.activated) return "is-waiting";
  return "is-active";
}

function accessDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ar-YE-u-nu-latn", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AccountAccessPanel({ selectedPhone, onClear, onBusyChange }: Readonly<{ selectedPhone: string; onClear: () => void; onBusyChange?: (busy: boolean) => void }>) {
  const { state: sessionState } = useSession();
  const [reason, setReason] = useState("");
  const [permissionReasons, setPermissionReasons] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ManagedOperatorStatus | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [error, setError] = useState("");
  const [finalStateUnverified, setFinalStateUnverified] = useState(false);
  const requestId = useRef(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const applyStatus = useCallback((next: ManagedOperatorStatus) => {
    setStatus(next);
    setJobTitle(next.jobTitle ?? "");
    setDepartment(next.department ?? "");
  }, []);

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  useEffect(() => {
    if (!selectedPhone) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedPhone]);

  function closeDetails() {
    if (busy) return;
    if (dialogRef.current?.open) dialogRef.current.close();
    onClear();
  }

  async function readCanonicalStatus(): Promise<ManagedOperatorStatus> {
    const query = new URLSearchParams({ phone: toAsciiDigits(selectedPhone).trim(), role: "operator" });
    const response = await identityFetch(`/api/access/managed-user/status?${query}`);
    if (!response.ok) throw { status: response.status, message: await responseMessage(response) } satisfies { status: number; message: string };
    return await response.json() as ManagedOperatorStatus;
  }

  async function refreshCanonicalStatus() {
    if (toAsciiDigits(selectedPhone).trim().length < 5) return;
    const id = ++requestId.current;
    setLoadingStatus(true);
    setError("");
    try {
      const next = await readCanonicalStatus();
      if (requestId.current !== id) return;
      applyStatus(next);
      setFinalStateUnverified(false);
    } catch (cause) {
      if (requestId.current !== id) return;
      if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") setError(cause.message);
      else if (isRequestFailure(cause)) setError(cause.message);
      else setError("تعذر التحقق من حالة المشغّل حاليًا.");
    } finally {
      if (requestId.current === id) setLoadingStatus(false);
    }
  }

  async function reconcileAfterMutationFailure(): Promise<boolean> {
    try {
      const next = await readCanonicalStatus();
      applyStatus(next);
      setFinalStateUnverified(false);
      return true;
    } catch {
      setStatus(null);
      setFinalStateUnverified(true);
      return false;
    }
  }

  function markFinalStateUnverified() {
    setStatus(null);
    setJobTitle("");
    setDepartment("");
    setFinalStateUnverified(true);
    setError("نُفّذ التغيير، لكن تعذر تأكيد الحالة النهائية. حدّثها قبل إجراء آخر.");
  }

  useEffect(() => {
    const id = ++requestId.current;
    setError("");
    setReason("");
    setPermissionReasons({});
    setStatus(null);
    setJobTitle("");
    setDepartment("");
    setLoadingStatus(false);
    setFinalStateUnverified(false);
    if (toAsciiDigits(selectedPhone).trim().length < 5) return;
    setLoadingStatus(true);
    const timeout = window.setTimeout(() => void (async () => {
      try {
        const query = new URLSearchParams({ phone: toAsciiDigits(selectedPhone).trim(), role: "operator" });
        const response = await identityFetch(`/api/access/managed-user/status?${query}`);
        if (id !== requestId.current) return;
        if (!response.ok) {
          setError(await responseMessage(response));
          return;
        }
        applyStatus(await response.json() as ManagedOperatorStatus);
      } catch {
        if (id === requestId.current) setError("تعذر قراءة حالة المشغّل. أعد المحاولة.");
      } finally {
        if (id === requestId.current) setLoadingStatus(false);
      }
    })(), 300);
    return () => {
      window.clearTimeout(timeout);
      if (requestId.current === id) requestId.current++;
    };
  }, [applyStatus, selectedPhone]);

  async function changeAccount(action: "disable-role" | "enable-role" | "disable-identity" | "enable-identity") {
    const reasonLength = Array.from(reason.trim()).length;
    if (reasonLength < 5 || reasonLength > 500) {
      setError("اكتب سببًا من 5 إلى 500 حرف قبل تغيير الحالة.");
      return;
    }
    const expectedVersion = action.includes("identity") ? status?.actorVersion : status?.roleVersion;
    if (!status?.actorId || expectedVersion === undefined) {
      setError("تعذر تحديد إصدار الحساب. أعد قراءة الحالة قبل المحاولة.");
      return;
    }
    setBusy(true);
    setError("");
    let mutationApplied = false;
    try {
      const response = await identityFetch("/api/access/account-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId: status.actorId, role: "operator", action, reason: reason.trim(), expectedVersion }),
      });
      if (!response.ok) {
        const reconciled = await reconcileAfterMutationFailure();
        setError(response.status === 409 || response.status === 412
          ? reconciled ? "تغيّرت الحالة بالتزامن. راجع الحالة المحدّثة ثم قرر من جديد." : "تعذر التحقق من الحالة بعد التعارض. أعد قراءتها قبل المحاولة."
          : await responseMessage(response));
        return;
      }
      mutationApplied = true;
      applyStatus(await readCanonicalStatus());
      setFinalStateUnverified(false);
      setReason("");
    } catch (cause) {
      if (mutationApplied) markFinalStateUnverified();
      else if (isRequestFailure(cause)) setError(cause.message);
      else setError("تعذر تحديث حالة الحساب.");
    } finally {
      setBusy(false);
    }
  }

  async function changePermission(permission: OperatorPermission) {
    const access = status?.operatorPermissions?.[permission];
    const permissionReason = permissionReasons[permission] ?? "";
    const reasonLength = Array.from(permissionReason.trim()).length;
    if (!status?.actorId || !status.enabled || !access) {
      setError("تعذر تحديد الصلاحية أو حالة المشغّل. أعد قراءة الحالة.");
      return;
    }
    if (reasonLength < 5 || reasonLength > 500) {
      setError("اكتب سببًا من 5 إلى 500 حرف قبل تغيير الصلاحية.");
      return;
    }
    setBusy(true);
    setError("");
    let mutationApplied = false;
    try {
      const response = await identityFetch("/api/access/operator-permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId: status.actorId, permission, enabled: !access.enabled, expectedVersion: access.version, reason: permissionReason.trim() }),
      });
      if (!response.ok) {
        const reconciled = await reconcileAfterMutationFailure();
        setError(response.status === 409
          ? reconciled ? "تغيّرت الصلاحية بالتزامن. راجع الحالة المحدّثة ثم قرر من جديد." : "تعذر التحقق من الصلاحية بعد التعارض. أعد قراءتها قبل المحاولة."
          : await responseMessage(response));
        return;
      }
      mutationApplied = true;
      applyStatus(await readCanonicalStatus());
      setFinalStateUnverified(false);
      setPermissionReasons((current) => ({ ...current, [permission]: "" }));
    } catch (cause) {
      if (mutationApplied) markFinalStateUnverified();
      else if (isRequestFailure(cause)) setError(cause.message);
      else setError("تعذر تحديث صلاحية المشغّل.");
    } finally {
      setBusy(false);
    }
  }

  async function changeOperatorDetails() {
    const nextTitle = jobTitle.trim();
    const nextDepartment = department.trim();
    if (!status?.actorId || status.roleVersion === undefined || Array.from(nextTitle).length < 1 || Array.from(nextTitle).length > 80 || Array.from(nextDepartment).length < 1 || Array.from(nextDepartment).length > 80) {
      setError("أدخل المسمى الوظيفي والقسم، كل منهما حتى 80 حرفًا.");
      return;
    }
    if (nextTitle === (status.jobTitle ?? "") && nextDepartment === (status.department ?? "")) return;
    setBusy(true);
    setError("");
    let mutationApplied = false;
    try {
      const response = await identityFetch("/api/access/managed-user/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId: status.actorId, jobTitle: nextTitle, department: nextDepartment, expectedVersion: status.roleVersion }),
      });
      if (!response.ok) {
        const reconciled = await reconcileAfterMutationFailure();
        setError(response.status === 409 || response.status === 412
          ? reconciled ? "تغيّرت بيانات المشغّل بالتزامن. راجع القراءة المحدّثة ثم احفظ من جديد." : "تعذر التحقق من البيانات بعد التعارض. أعد قراءتها قبل المحاولة."
          : await responseMessage(response));
        return;
      }
      mutationApplied = true;
      applyStatus(await readCanonicalStatus());
    } catch (cause) {
      if (mutationApplied) markFinalStateUnverified();
      else if (isRequestFailure(cause)) setError(cause.message);
      else setError("تعذر حفظ بيانات المشغّل.");
    } finally {
      setBusy(false);
    }
  }

  const canManagePermissionTarget = sessionState.kind === "authenticated" && sessionState.identity.canManageOperatorPermissions === true && status?.role === "operator" && Boolean(status.actorId) && status.actorId !== sessionState.identity.subject && operatorWorkspacePermissions.every(({ key }) => Boolean(status.operatorPermissions?.[key]));
  const canViewOwnPermissions = sessionState.kind === "authenticated" && status?.role === "operator" && status.actorId === sessionState.identity.subject;

  return <dialog id="account-access-dialog" className="access-details-dialog" ref={dialogRef} aria-labelledby="account-access-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClear(); }}>
    <section className="access-workspace-section account-access-panel">
    <header className="access-section-heading account-access-heading">
      <div>
        <h2 id="account-access-title" ref={headingRef} tabIndex={-1}>{status?.fullNameAr?.trim() || <bdi dir="ltr">{status?.phoneE164 ?? selectedPhone}</bdi>}</h2>
        {status?.fullNameAr?.trim() ? <bdi className="access-target-phone" dir="ltr">{status.phoneE164}</bdi> : null}
      </div>
      <div className="access-target-actions"><button type="button" className="access-clear-target" disabled={busy} onClick={closeDetails} aria-label="إغلاق تفاصيل المشغّل">إغلاق</button></div>
    </header>

    {loadingStatus ? <p className="access-loading" role="status"><span className="loading-mark" aria-hidden="true" /> جارٍ قراءة الحالة والصلاحيات…</p> : null}
    {error ? <div className="managed-status managed-status-warning" role="alert"><strong>{finalStateUnverified ? "الحالة تحتاج إلى تحقق" : "تعذر إكمال العملية"}</strong><p>{error}</p><button type="button" className="button button-secondary" disabled={busy || loadingStatus} onClick={() => void refreshCanonicalStatus()}>إعادة القراءة</button></div> : null}

    {status ? (status.exists ? <>
      <div className="access-account-summary" role="status"><span className={`access-state-pill ${accountStateTone(status)}`}>{accountStateLabel(status.state)}</span></div>
      <dl className="access-account-details">
        <div><dt>المسمى الوظيفي</dt><dd>{status.jobTitle || "غير محدد"}</dd></div>
        <div><dt>القسم</dt><dd>{status.department || "غير محدد"}</dd></div>
        <div><dt>انضم للفريق</dt><dd>{status.createdAt ? <time dateTime={status.createdAt}>{accessDate(status.createdAt)}</time> : "—"}</dd></div>
        <div><dt>تفعيل الحساب</dt><dd>{status.activatedAt ? <time dateTime={status.activatedAt}>{accessDate(status.activatedAt)}</time> : "لم يُفعّل بعد"}</dd></div>
        <div><dt>آخر تسجيل دخول</dt><dd>{status.lastAuthenticatedAt ? <time dateTime={status.lastAuthenticatedAt}>{accessDate(status.lastAuthenticatedAt)}</time> : "لم يسجّل دخولًا بعد"}</dd></div>
        <div><dt>حالة الهوية</dt><dd>{status.securityEnabled ? "مفعّلة" : "موقوفة"}</dd></div>
      </dl>

      {sessionState.kind === "authenticated" && sessionState.identity.canManageOperatorPermissions === true ? <details className="access-account-controls">
        <summary>تعديل المسمى والقسم</summary>
        <div className="access-account-controls-content">
          <label className="field-label" htmlFor="operator-job-title">المسمى الوظيفي<input id="operator-job-title" required minLength={1} maxLength={80} value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} disabled={busy} /></label>
          <label className="field-label" htmlFor="operator-department">القسم<input id="operator-department" required minLength={1} maxLength={80} value={department} onChange={(event) => setDepartment(event.target.value)} disabled={busy} /></label>
          <button type="button" className="button button-primary" disabled={busy || !jobTitle.trim() || !department.trim() || jobTitle.trim() === (status.jobTitle ?? "") && department.trim() === (status.department ?? "")} onClick={() => void changeOperatorDetails()}>{busy ? "جارٍ الحفظ…" : "حفظ البيانات"}</button>
        </div>
      </details> : null}

      {canManagePermissionTarget || canViewOwnPermissions ? <section className="access-permission-section" aria-labelledby="operator-permissions-title">
        <header className="access-permission-heading"><h3 id="operator-permissions-title">نطاقات الوصول</h3><p>{canManagePermissionTarget ? "افتح النطاق لتغيير منحه مع تسجيل السبب." : "الصلاحيات الحالية لهذا الحساب."}</p></header>
        <div className="access-permission-list">
          {operatorWorkspacePermissions.map(({ key, label }) => {
            const reasonId = `operator-permission-reason-${key}`;
            const access = canManagePermissionTarget ? status.operatorPermissions?.[key] : undefined;
            const enabled = access?.enabled ?? (canViewOwnPermissions && sessionState.kind === "authenticated" && (sessionState.identity.permissions ?? []).includes(key));
            const stateLabel = enabled ? "ممنوحة" : "غير ممنوحة";
            return canManagePermissionTarget && access ? <details className="access-permission-item" key={key}>
              <summary>
                <strong>{label}</strong>
                <span className={`access-permission-state ${enabled ? "is-granted" : "is-not-granted"}`}>{stateLabel}</span>
                <span className="access-permission-edit">تعديل</span>
              </summary>
              <div className="access-permission-edit-panel">
                <p className="access-audit-reason">آخر سبب مسجّل: {access.reason || "لا يوجد سبب مسجل"}</p>
                <label className="field-label" htmlFor={reasonId}>سبب التغيير<input id={reasonId} minLength={5} maxLength={500} value={permissionReasons[key] ?? ""} onChange={(event) => setPermissionReasons((current) => ({ ...current, [key]: event.target.value }))} disabled={busy || !status.enabled} /></label>
                <button type="button" className={enabled ? "button button-secondary" : "button button-primary"} disabled={busy || !status.enabled || Array.from((permissionReasons[key] ?? "").trim()).length < 5} onClick={() => void changePermission(key)}>{busy ? "جارٍ الحفظ…" : enabled ? "سحب الصلاحية" : "منح الصلاحية"}</button>
              </div>
            </details> : <div className="access-permission-item is-readonly" key={key}>
              <strong>{label}</strong><span className={`access-permission-state ${enabled ? "is-granted" : "is-not-granted"}`}>{stateLabel}</span>
            </div>;
          })}
        </div>
        {sessionState.kind === "authenticated" && status.actorId !== sessionState.identity.subject && !canManagePermissionTarget ? <p className="access-readonly-note">تعذر تحميل النطاقات كاملة؛ أعد قراءة الحالة قبل إدارتها.</p> : null}
      </section> : <p className="access-readonly-note">لا تتوفر صلاحيات نطاق لهذا الحساب.</p>}

      {sessionState.kind === "authenticated" && sessionState.identity.canManageOperatorPermissions === true ? <details className="access-account-controls">
        <summary>تغيير حالة الحساب</summary>
        <div className="access-account-controls-content">
          <p>تغيير الحالة يوقف الدخول إلى حساب المشغّل أو هويته.</p>
          <label className="field-label" htmlFor="access-reason">سبب التغيير<input id="access-reason" minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label>
          <div className="access-account-actions">
            {status.enabled ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void changeAccount("disable-role")}>إيقاف الدور</button> : <button type="button" className="button button-primary" disabled={busy} onClick={() => void changeAccount("enable-role")}>إعادة تفعيل الدور</button>}
            {status.securityEnabled ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void changeAccount("disable-identity")}>إيقاف الهوية</button> : <button type="button" className="button button-primary" disabled={busy} onClick={() => void changeAccount("enable-identity")}>إعادة تفعيل الهوية</button>}
          </div>
        </div>
      </details> : null}
    </> : <div className="collection-state"><strong>لا يوجد حساب مشغّل لهذا الرقم</strong><p>أنشئ ملفًا من تبويب ملفات المشغّلين ثم راجعه.</p></div>) : null}
    </section>
  </dialog>;
}
