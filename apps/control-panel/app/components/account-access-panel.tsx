"use client";

import { useEffect, useRef, useState } from "react";
import {
  validatePasswordInputShape,
  type ActorType,
  type OperatorEnrollmentToken,
} from "@bthwani/identity";
import { identityFetch, isRequestFailure, responseMessage } from "./identity-client";

type ManagedAccountStatus = Readonly<{
  exists: boolean;
  enabled: boolean;
  activated: boolean;
  securityEnabled: boolean;
  role: ActorType;
  actorId?: string;
  actorVersion?: number;
  roleVersion?: number;
  credentialVersion?: number;
}>;

export function AccountAccessPanel() {
  const [role, setRole] = useState<ActorType>("partner");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<ManagedAccountStatus | null>(null);
  const [result, setResult] = useState<OperatorEnrollmentToken | null>(null);
  const [operatorResetPassword, setOperatorResetPassword] = useState("");
  const [operatorResetPasswordConfirmation, setOperatorResetPasswordConfirmation] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [finalStateUnverified, setFinalStateUnverified] = useState(false);
  const requestId = useRef(0);

  async function readCanonicalStatus(): Promise<ManagedAccountStatus> {
    const response = await identityFetch("/api/access/managed-user/status?" + new URLSearchParams({ phone: phone.trim(), role }));
    if (!response.ok) throw { status: response.status, message: await responseMessage(response) } satisfies { status: number; message: string };
    return await response.json() as ManagedAccountStatus;
  }

  async function refreshCanonicalStatus(): Promise<ManagedAccountStatus> {
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
    setOperatorResetPassword("");
    setOperatorResetPasswordConfirmation("");
    setResetSuccess("");
    setReason("");
    setStatus(null);
    setFinalStateUnverified(false);
    if (value.length < 5) return;
    const timeout = window.setTimeout(() => void (async () => {
      try {
        const response = await identityFetch("/api/access/managed-user/status?" + new URLSearchParams({ phone: value, role }));
        if (id !== requestId.current) return;
        if (!response.ok) {
          setStatus(null);
          setError(await responseMessage(response));
          return;
        }
        setStatus(await response.json() as ManagedAccountStatus);
        setFinalStateUnverified(false);
      } catch {
        if (id === requestId.current) {
          setStatus(null);
          setError("تعذر التحقق من حالة الرقم حاليًا.");
        }
      }
    })(), 450);
    return () => window.clearTimeout(timeout);
  }, [phone, role]);

  const managedRole = role === "partner" || role === "captain" || role === "field" || role === "operator";

  async function provision(recover = false) {
    setBusy(true);
    setError("");
    setResult(null);
    let mutationApplied = false;
    try {
      const response = await identityFetch("/api/access/managed-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, role, recover }),
      });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      mutationApplied = true;
      const payload = await response.json();
      setResult(role === "operator" ? payload as OperatorEnrollmentToken : null);
      await refreshCanonicalStatus();
    } catch (cause) {
      if (mutationApplied) markFinalStateUnverified();
      else if (isRequestFailure(cause)) setError(cause.message);
      else setError("تعذر الوصول إلى خدمات إدارة الهوية.");
    } finally {
      setBusy(false);
    }
  }

  async function changeAccess(action: "disable-role" | "enable-role" | "disable-identity" | "enable-identity") {
    if (reason.trim().length < 5) {
      setError("اكتب سببًا واضحًا من 5 أحرف على الأقل قبل تغيير الحالة.");
      return;
    }
    const expectedVersion = action.includes("identity") ? status?.actorVersion : status?.roleVersion;
    if (expectedVersion === undefined || expectedVersion === null) {
      setError("تعذر تحديد إصدار الحساب للتحقق من التزامن. أعد تحميل الحالة وحاول مرة أخرى.");
      return;
    }
    setBusy(true);
    setError("");
    let mutationApplied = false;
    try {
      const response = await identityFetch("/api/access/account-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, role, action, reason, expectedVersion }),
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        const reconciled = await reconcileAfterMutationFailure();
        if (response.status === 409 || response.status === 412) {
          setError(reconciled ? "تعارض في إصدار الحساب: قام مستخدم آخر بتعديل هذه الحالة. تم تحميل الحالة الكانونية، راجعها ثم حاول مجددًا." : "حدث تعارض في إصدار الحساب وتعذر التحقق من الحالة الكانونية. أعد تحميل الحالة قبل المحاولة.");
        } else {
          setError(message);
        }
        return;
      }
      mutationApplied = true;
      await refreshCanonicalStatus();
      setReason("");
    } catch (cause) {
      if (mutationApplied) markFinalStateUnverified();
      else if (isRequestFailure(cause)) setError(cause.message);
      else setError("تعذر تحديث حالة الحساب.");
    } finally {
      setBusy(false);
    }
  }

  async function resetOperatorCredential() {
    if (reason.trim().length < 5) {
      setError("اكتب سببًا واضحًا من 5 أحرف على الأقل قبل إعادة تعيين كلمة المرور.");
      return;
    }
    const validation = validatePasswordInputShape(operatorResetPassword, operatorResetPasswordConfirmation);
    if (!validation.valid) {
      setError(validation.message ?? "كلمة المرور غير صالحة.");
      return;
    }
    const expectedVersion = status?.credentialVersion;
    if (expectedVersion === undefined || expectedVersion === null || expectedVersion < 1) {
      setError("تعذر تحديد إصدار كلمة المرور للتحقق من التزامن. أعد تحميل الحالة وحاول مرة أخرى.");
      return;
    }
    setBusy(true);
    setError("");
    setResetSuccess("");
    let mutationApplied = false;
    try {
      const response = await identityFetch("/api/access/managed-user/operator-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password: operatorResetPassword, reason, expectedVersion }),
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        const reconciled = await reconcileAfterMutationFailure();
        if (response.status === 409 || response.status === 412) {
          setError(reconciled ? "تعارض في إصدار كلمة المرور: تم تحميل الحالة الكانونية، راجع الإصدار ثم أعد المحاولة." : "حدث تعارض في إصدار كلمة المرور وتعذر التحقق من الحالة الكانونية. أعد تحميل الحالة قبل المحاولة.");
        } else {
          setError(message);
        }
        return;
      }
      mutationApplied = true;
      setOperatorResetPassword("");
      setOperatorResetPasswordConfirmation("");
      await refreshCanonicalStatus();
      setResetSuccess("تمت إعادة تعيين كلمة مرور موظف لوحة التحكم بنجاح وإلغاء جميع الجلسات القديمة.");
    } catch (cause) {
      if (mutationApplied) markFinalStateUnverified();
      else if (isRequestFailure(cause)) setError(cause.message);
      else setError("تعذر إعادة تعيين كلمة مرور الموظف.");
    } finally {
      setBusy(false);
    }
  }

  const canIssueActivation = managedRole && status !== null && !status.activated;
  const canIssueRecovery = managedRole && role !== "operator" && status?.exists === true && status.activated && status.enabled && status.securityEnabled;
  const activationBlocked = status?.exists === true && status.enabled === false;
  const statusIsHealthy = status?.exists === false || (status?.enabled === true && status.securityEnabled === true);

  return (
    <section className="access-card" aria-labelledby="account-access-title">
      <div className="access-card-heading">
        <span className="step-chip">حماية الوصول</span>
        <p className="eyebrow">إدارة الحسابات والأدوار</p>
        <h2 id="account-access-title">تهيئة أو إيقاف الحساب</h2>
        <p className="muted">هذه شاشة إدارية مستقلة: اختر الدور ثم ابحث برقم الهاتف. لا تختار الدور في واجهة دخول الشريك أو الكابتن أو الميداني أو الموظف؛ هناك يحدده الرقم تلقائيًا.</p>
      </div>
      <div className="access-form">
        <label className="field-label" htmlFor="account-role">
          الدور الإداري
          <select id="account-role" value={role} disabled={busy} onChange={(event) => { setRole(event.target.value as ActorType); setStatus(null); setError(""); }}>
            <option value="client">العميل</option>
            <option value="partner">الشريك</option>
            <option value="captain">الكابتن</option>
            <option value="field">الميداني</option>
            <option value="operator">موظف لوحة التحكم</option>
          </select>
        </label>
        <label className="field-label" htmlFor="account-phone">
          رقم الهاتف
          <input id="account-phone" autoComplete="tel" disabled={busy} inputMode="tel" placeholder="مثال: 967 77 000 100" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
        {canIssueActivation ? (
          <button type="button" className="button button-primary" disabled={busy || !phone.trim() || activationBlocked} onClick={() => void provision()}>
            {busy ? "جارٍ تجهيز الحساب…" : role === "operator" ? "تهيئة الموظف وإصدار دعوة آمنة" : status.exists ? "إعادة فتح تفعيل الدور" : "تهيئة الدور"}
          </button>
        ) : <span className="form-action-placeholder" aria-hidden="true" />}
      </div>
      {status ? (
        <div className={"managed-status " + (statusIsHealthy ? "managed-status-info" : "managed-status-warning")} role="status">
          {status.exists ? (
            <>
              <strong>{status.enabled ? "الدور مفعّل" : "الدور موقوف"} · {status.securityEnabled ? "الهوية مسموحة" : "الهوية موقوفة بالكامل"}</strong>
              <p>{status.activated ? "يوجد تسجيل سابق لهذا الدور." : "الدور مهيأ ولم يكتمل تفعيله بعد."}</p>
              {status.activated && managedRole ? (
                <div className="managed-status managed-status-warning" role="alert">
                  <strong>تم تفعيل هذا الدور من قبل.</strong>
                  <p>{canIssueRecovery ? "يمكنك إصدار رمز جديد لاسترداد وإعادة تفعيل الحساب الموجود؛ ستُلغى الجلسات السابقة." : role === "operator" ? "حساب موظف لوحة التحكم مفعل. يمكنك إدارة حالته أو إعادة تعيين كلمة مروره إداريًا أدناه." : "أعد تفعيل الدور والهوية أولًا إذا كانا موقوفين."}</p>
                  {canIssueRecovery ? <button type="button" className="button button-primary" disabled={busy} onClick={() => void provision(true)}>{busy ? "جارٍ استرداد الحساب…" : "استرداد وإعادة تفعيل الحساب"}</button> : null}
                </div>
              ) : null}
              {role === "operator" && status.activated && status.enabled && status.securityEnabled ? (
                <section className="managed-status managed-status-info" aria-label="إعادة تعيين كلمة مرور الموظف">
                  <strong>إعادة تعيين كلمة مرور الموظف (إداريًا)</strong>
                  <p>بصفتك مالك المنصة، يمكنك تعيين كلمة مرور جديدة للموظف مع إلغاء كل جلساته القديمة فورًا (إصدار الاعتماد: {status.credentialVersion ?? "غير متاح"}).</p>
                  <label className="field-label" htmlFor="operator-reset-new-password">
                    كلمة المرور الجديدة
                    <input id="operator-reset-new-password" type="password" autoComplete="new-password" disabled={busy} value={operatorResetPassword} onChange={(event) => setOperatorResetPassword(event.target.value)} />
                    <span className="field-help">١٥ حرفاً على الأقل</span>
                  </label>
                  <label className="field-label" htmlFor="operator-reset-confirm-password">
                    تأكيد كلمة المرور
                    <input id="operator-reset-confirm-password" type="password" autoComplete="new-password" disabled={busy} value={operatorResetPasswordConfirmation} onChange={(event) => setOperatorResetPasswordConfirmation(event.target.value)} />
                  </label>
                  <button type="button" className="button button-primary" disabled={busy || !validatePasswordInputShape(operatorResetPassword, operatorResetPasswordConfirmation).valid || reason.trim().length < 5} onClick={() => void resetOperatorCredential()}>
                    {busy ? "جارٍ التعيين…" : "إعادة تعيين كلمة مرور الموظف"}
                  </button>
                  {resetSuccess ? <p className="success-inline" role="status">{resetSuccess}</p> : null}
                </section>
              ) : null}
              <label className="field-label" htmlFor="access-reason">
                سبب التغيير
                <input id="access-reason" maxLength={500} placeholder="مثال: انتهاء التعاقد أو استرداد الجهاز" value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <div className="managed-status-actions">
                {status.enabled ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void changeAccess("disable-role")}>إيقاف الدور</button> : <button type="button" className="button button-primary" disabled={busy} onClick={() => void changeAccess("enable-role")}>إعادة تفعيل الدور</button>}
                {status.securityEnabled ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void changeAccess("disable-identity")}>إيقاف الهوية بالكامل</button> : <button type="button" className="button button-primary" disabled={busy} onClick={() => void changeAccess("enable-identity")}>إعادة تفعيل الهوية</button>}
              </div>
            </>
          ) : (
            <>
              <strong>لا يوجد حساب مهيأ لهذا الدور.</strong>
              <p>{managedRole ? role === "operator" ? "يمكنك تهيئة الموظف وإصدار دعوة عالية الأمان تُستخدم مرة واحدة." : "يمكنك تهيئة الدور؛ سيكمل صاحبه التفعيل بإثبات رقم الهاتف فقط." : "تسجيل العميل يتم من تطبيق العميل، ولا يُصدر له رمز من هذه الشاشة."}</p>
            </>
          )}
        </div>
      ) : null}
      {result ? <div className="code-output" role="status"><span className="summary-label">دعوة موظف عالية الأمان</span><code>{result.code}</code><p>تُعرض هذه الدعوة مرة واحدة فقط وتُستخدم لتفعيل موظف لوحة التحكم، وتنتهي في {new Date(result.expiresAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" })}.</p></div> : null}
      {finalStateUnverified ? <p className="identity-error" role="alert">الحالة النهائية غير متحققة؛ أعد تحميل الحالة قبل تنفيذ إجراء آخر.</p> : null}
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
    </section>
  );
}
