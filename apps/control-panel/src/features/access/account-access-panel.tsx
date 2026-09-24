"use client";

import { toAsciiDigits } from "@bthwani/design-system";
import type { OperatorEnrollmentToken } from "@bthwani/identity";
import { useEffect, useRef, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { useSession } from "../../session/session-provider";
import { responseMessage } from "./identity-error-message";

type OperatorPermissionAccess = Readonly<{ permission: "finance" | "platform_policies"; enabled: boolean; version: number; reason: string }>;
type ManagedOperatorStatus = Readonly<{
  role: "operator";
  actorId?: string;
  exists: boolean;
  enabled: boolean;
  activated: boolean;
  securityEnabled: boolean;
  state?: string;
  actorVersion?: number;
  roleVersion?: number;
  financeAccess?: OperatorPermissionAccess;
  platformPoliciesAccess?: OperatorPermissionAccess;
}>;

const permissionRows = [
  { key: "finance", label: "المالية", field: "financeAccess", reasonId: "finance-access-reason" },
  { key: "platform_policies", label: "سياسات المنصة", field: "platformPoliciesAccess", reasonId: "platform-policies-access-reason" },
] as const;

function accountStateLabel(state: string | undefined): string {
  if (state === "active") return "نشط";
  if (state === "identity_disabled") return "الهوية موقوفة";
  if (state === "role_disabled") return "الدور موقوف";
  if (state === "pending_activation") return "بانتظار التفعيل";
  return "غير مهيأ";
}

export function AccountAccessPanel({ selectedPhone = "" }: Readonly<{ selectedPhone?: string }>) {
  const { state: sessionState } = useSession();
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [permissionReasons, setPermissionReasons] = useState<Record<string, string>>({ finance: "", platform_policies: "" });
  const [status, setStatus] = useState<ManagedOperatorStatus | null>(null);
  const [result, setResult] = useState<OperatorEnrollmentToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [finalStateUnverified, setFinalStateUnverified] = useState(false);
  const requestId = useRef(0);

  useEffect(() => { if (selectedPhone) setPhone(toAsciiDigits(selectedPhone)); }, [selectedPhone]);

  async function readCanonicalStatus(): Promise<ManagedOperatorStatus> {
    const query = new URLSearchParams({ phone: phone.trim(), role: "operator" });
    const response = await identityFetch(`/api/access/managed-user/status?${query}`);
    if (!response.ok) throw { status: response.status, message: await responseMessage(response) } satisfies { status: number; message: string };
    return await response.json() as ManagedOperatorStatus;
  }

  async function refreshCanonicalStatus(): Promise<ManagedOperatorStatus> {
    const next = await readCanonicalStatus();
    setStatus(next);
    setFinalStateUnverified(false);
    return next;
  }

  async function reconcileAfterMutationFailure(): Promise<boolean> {
    try {
      await refreshCanonicalStatus();
      return true;
    } catch {
      setStatus(null);
      setFinalStateUnverified(true);
      return false;
    }
  }

  function markFinalStateUnverified() {
    setStatus(null);
    setFinalStateUnverified(true);
    setError("تم تنفيذ التغيير، لكن تعذر التحقق من الحالة النهائية. أعد تحميل الحالة قبل أي إجراء آخر.");
  }

  useEffect(() => {
    const value = phone.trim();
    const id = ++requestId.current;
    setResult(null);
    setError("");
    setReason("");
    setStatus(null);
    setFinalStateUnverified(false);
    if (value.length < 5) return;
    const timeout = window.setTimeout(() => void (async () => {
      try {
        const query = new URLSearchParams({ phone: value, role: "operator" });
        const response = await identityFetch(`/api/access/managed-user/status?${query}`);
        if (id !== requestId.current) return;
        if (!response.ok) {
          setError(await responseMessage(response));
          return;
        }
        setStatus(await response.json() as ManagedOperatorStatus);
        setFinalStateUnverified(false);
      } catch {
        if (id === requestId.current) setError("تعذر التحقق من حالة المشغّل حاليًا.");
      }
    })(), 450);
    return () => window.clearTimeout(timeout);
  }, [phone]);

  async function provision() {
    if (!phone.trim()) return;
    setBusy(true);
    setError("");
    setResult(null);
    let mutationApplied = false;
    try {
      const response = await identityFetch("/api/access/managed-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), role: "operator" }),
      });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      mutationApplied = true;
      setResult(await response.json() as OperatorEnrollmentToken);
      await refreshCanonicalStatus();
    } catch (cause) {
      if (mutationApplied) markFinalStateUnverified();
      else if (isRequestFailure(cause)) setError(cause.message);
      else setError("تعذر تهيئة مشغّل لوحة التحكم.");
    } finally {
      setBusy(false);
    }
  }

  async function changeAccount(action: "disable-role" | "enable-role" | "disable-identity" | "enable-identity") {
    const reasonLength = Array.from(reason.trim()).length;
    if (reasonLength < 5 || reasonLength > 500) {
      setError("اكتب سببًا من 5 إلى 500 حرف قبل تغيير الحالة.");
      return;
    }
    const expectedVersion = action.includes("identity") ? status?.actorVersion : status?.roleVersion;
    if (!status?.actorId || expectedVersion === undefined) {
      setError("تعذر تحديد إصدار حساب المشغّل. أعد تحميل الحالة قبل المحاولة.");
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
          ? reconciled ? "تغيرت حالة المشغّل بالتزامن. حُدّثت الحالة؛ راجعها ثم قرر من جديد." : "تعذر التحقق من حالة المشغّل بعد التعارض. أعد تحميلها قبل المحاولة."
          : await responseMessage(response));
        return;
      }
      mutationApplied = true;
      await refreshCanonicalStatus();
      setReason("");
    } catch (cause) {
      if (mutationApplied) markFinalStateUnverified();
      else if (isRequestFailure(cause)) setError(cause.message);
      else setError("تعذر تحديث حالة المشغّل.");
    } finally {
      setBusy(false);
    }
  }

  async function changePermission(permission: "finance" | "platform_policies") {
    const access = permission === "finance" ? status?.financeAccess : status?.platformPoliciesAccess;
    const permissionReason = permissionReasons[permission] ?? "";
    const reasonLength = Array.from(permissionReason.trim()).length;
    if (!status?.actorId || !status.enabled || !access) {
      setError("تعذر تحديد الصلاحية أو حالة المشغّل. أعد تحميل الحالة.");
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
          ? reconciled ? "تغيّرت الصلاحية بالتزامن. حُدّثت الحالة؛ راجعها ثم قرر من جديد." : "تعذر التحقق من حالة الصلاحية بعد التعارض. أعد تحميلها قبل المحاولة."
          : await responseMessage(response));
        return;
      }
      mutationApplied = true;
      await refreshCanonicalStatus();
      setPermissionReasons((current) => ({ ...current, [permission]: "" }));
    } catch (cause) {
      if (mutationApplied) markFinalStateUnverified();
      else if (isRequestFailure(cause)) setError(cause.message);
      else setError("تعذر تحديث صلاحية المشغّل.");
    } finally {
      setBusy(false);
    }
  }

  const canManagePermissionTarget = sessionState.kind === "authenticated" && sessionState.identity.canManageOperatorPermissions === true && status?.role === "operator" && Boolean(status.actorId) && status.actorId !== sessionState.identity.subject && Boolean(status.financeAccess) && Boolean(status.platformPoliciesAccess);
  const canViewOwnPermissions = sessionState.kind === "authenticated" && status?.role === "operator" && status.actorId === sessionState.identity.subject;
  const canIssueActivation = status !== null && !status.activated && (status.exists === false || status.enabled);

  return (
    <section className="access-card" aria-labelledby="account-access-title">
      <div className="access-card-heading">
        <span className="step-chip">المشغّلون فقط</span>
        <p className="eyebrow">الوصول والصلاحيات</p>
        <h2 id="account-access-title">إدارة حسابات مشغّلي لوحة التحكم</h2>
        <p className="muted">هذا المركز لإدارة موظفي لوحة التحكم وصلاحياتهم فقط. قبول الشركاء والكباتن والميدانيين وحالاتهم التشغيلية تُدار في مراكزهم المختصة.</p>
      </div>
      <div className="access-form">
        <label className="field-label" htmlFor="account-phone">رقم هاتف المشغّل<input id="account-phone" autoComplete="tel" disabled={busy} inputMode="tel" placeholder="مثال: 967 77 000 100" value={phone} onChange={(event) => setPhone(toAsciiDigits(event.target.value))} /></label>
        {canIssueActivation ? <button type="button" className="button button-primary" disabled={busy || !phone.trim()} onClick={() => void provision()}>{busy ? "جارٍ تجهيز الحساب…" : "تهيئة المشغّل وإصدار دعوة آمنة"}</button> : null}
      </div>
      {status ? (
        <div className={`managed-status ${status.exists && status.enabled && status.securityEnabled ? "managed-status-info" : "managed-status-warning"}`} role="status">
          {status.exists ? <>
            <strong>حساب المشغّل · {accountStateLabel(status.state)}</strong>
            <p>{status.activated ? "اكتمل تسجيل هذا المشغّل." : "لم يكتمل تفعيل هذا المشغّل بعد."} · الهوية {status.securityEnabled ? "مسموحة" : "موقوفة"}</p>
            {canManagePermissionTarget || canViewOwnPermissions ? <section className="managed-status managed-status-info" aria-label="صلاحيات مشغّل لوحة التحكم">
              <strong>الصلاحيات المفوضة</strong>
              <p>{canManagePermissionTarget ? "الصفة كمشغّل لا تمنح صلاحيات النطاق تلقائيًا. الحالة والسبب المسجل ظاهران لكل صلاحية." : "هذه صلاحيات الجلسة الحالية الصادرة من Identity. يحدّث Identity الجلسة بعد تغيير الصلاحيات."}</p>
              <div className="access-form">
                {permissionRows.map(({ key, label, field, reasonId }) => {
                  const access = canManagePermissionTarget ? status[field] : undefined;
                  const enabled = access?.enabled ?? (canViewOwnPermissions && sessionState.kind === "authenticated" && (sessionState.identity.permissions ?? []).includes(key));
                  return <section className="managed-status managed-status-info" aria-label={`صلاحية ${label}`} key={key}>
                    <strong><code>{key}</code> · {enabled ? "ممنوحة" : "غير ممنوحة"}</strong>
                    {access ? <><p>السبب المسجل: {access.reason || "لا يوجد سبب مسجل"}</p><label className="field-label" htmlFor={reasonId}>سبب التغيير<input id={reasonId} maxLength={500} value={permissionReasons[key] ?? ""} onChange={(event) => setPermissionReasons((current) => ({ ...current, [key]: event.target.value }))} disabled={busy} /></label><button type="button" className={enabled ? "button button-secondary" : "button button-primary"} disabled={busy || !status.enabled || !permissionReasons[key]?.trim()} onClick={() => void changePermission(key)}>{busy ? "جارٍ التحديث…" : enabled ? `سحب صلاحية ${label}` : `منح صلاحية ${label}`}</button></> : null}
                  </section>;
                })}
              </div>
            </section> : null}
            <label className="field-label" htmlFor="access-reason">سبب تغيير حالة الحساب<input id="access-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label>
            <div className="managed-status-actions">
              {status.enabled ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void changeAccount("disable-role")}>إيقاف المشغّل</button> : <button type="button" className="button button-primary" disabled={busy} onClick={() => void changeAccount("enable-role")}>إعادة تفعيل المشغّل</button>}
              {status.securityEnabled ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void changeAccount("disable-identity")}>إيقاف هوية المشغّل</button> : <button type="button" className="button button-primary" disabled={busy} onClick={() => void changeAccount("enable-identity")}>إعادة تفعيل الهوية</button>}
            </div>
          </> : <>
            <strong>لا يوجد مشغّل مهيأ لهذا الرقم.</strong>
            <p>يمكن إصدار دعوة تسجيل لمشغّل لوحة التحكم من هنا.</p>
          </>}
        </div>
      ) : null}
      {result ? <div className="code-output" role="status"><span className="summary-label">دعوة مشغّل عالية الأمان</span><code>{result.code}</code><p>تُعرض هذه الدعوة مرة واحدة وتُستخدم لتفعيل مشغّل لوحة التحكم، وتنتهي في {new Date(result.expiresAt).toLocaleString("ar-YE-u-nu-latn", { dateStyle: "medium", timeStyle: "short" })}.</p></div> : null}
      {finalStateUnverified ? <p className="identity-error" role="alert">الحالة النهائية غير متحققة؛ أعد تحميل الحالة قبل تنفيذ إجراء آخر.</p> : null}
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
    </section>
  );
}
