"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { identityErrorMessage, validatePasswordInputShape, type ActorIdentity, type ActorType, type ControlPanelRole, type OperatorEnrollmentToken } from "@bthwani/identity";

type ViewState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "signed_out" }>
  | Readonly<{ kind: "authenticated"; identity: ActorIdentity }>
  | Readonly<{ kind: "unavailable"; message: string }>;

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

async function responseMessage(response: Response, context: "general" | "login" | "recovery" = "general"): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
  const code = typeof body?.error?.code === "string" ? body.error.code : "";
  switch (code) {
    case "RECOVERY_UNSUPPORTED": return "استرداد موظف لوحة التحكم يتم من أدوات إدارة المشغل المخصصة.";
    case "NOT_FOUND": return "لم يتم العثور على سجل الدور المطلوب.";
    case "DSH_UNAVAILABLE": return "خدمة إدارة الأدوار غير متاحة. تحقق من تشغيل الحاويات ثم أعد المحاولة.";
    case "DSH_CONFIG_ERROR": return "إعدادات خدمة إدارة الأدوار غير مكتملة. أعد تشغيل لوحة التحكم المحلية ثم حاول مرة أخرى.";
    default: return identityErrorMessage({ kind: "http", status: response.status, code, message: "" }, context);
  }
}

async function identityFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

type RequestFailure = Readonly<{ status: number; message: string }>;

function isRequestFailure(value: unknown): value is RequestFailure {
  return Boolean(value && typeof value === "object" && typeof (value as { status?: unknown }).status === "number" && typeof (value as { message?: unknown }).message === "string");
}

function AccountAccessPanel() {
  const [role, setRole] = useState<ActorType>("partner");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<ManagedAccountStatus | null>(null);
  const [result, setResult] = useState<OperatorEnrollmentToken | null>(null);
  const [operatorResetPassword, setOperatorResetPassword] = useState("");
  const [operatorResetPasswordConfirmation, setOperatorResetPasswordConfirmation] = useState("");
  const [showOperatorResetPassword, setShowOperatorResetPassword] = useState(false);
  const [showOperatorResetPasswordConfirmation, setShowOperatorResetPasswordConfirmation] = useState(false);
  const [resetSuccess, setResetSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [finalStateUnverified, setFinalStateUnverified] = useState(false);
  const requestId = useRef(0);

  async function readCanonicalStatus(): Promise<ManagedAccountStatus> {
    const response = await identityFetch(`/api/access/managed-user/status?${new URLSearchParams({ phone: phone.trim(), role })}`);
    if (!response.ok) throw { status: response.status, message: await responseMessage(response) } satisfies RequestFailure;
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
    setResult(null); setError(""); setOperatorResetPassword(""); setOperatorResetPasswordConfirmation(""); setResetSuccess(""); setReason(""); setStatus(null); setFinalStateUnverified(false);
    if (value.length < 5) return;
    const timeout = window.setTimeout(() => void (async () => {
      try {
        const response = await identityFetch(`/api/access/managed-user/status?${new URLSearchParams({ phone: value, role })}`);
        if (id !== requestId.current) return;
        if (!response.ok) { setStatus(null); setError(await responseMessage(response)); return; }
        setStatus(await response.json() as ManagedAccountStatus); setFinalStateUnverified(false);
      } catch { if (id === requestId.current) { setStatus(null); setError("تعذر التحقق من حالة الرقم حاليًا."); } }
    })(), 450);
    return () => window.clearTimeout(timeout);
  }, [phone, role]);

  const managedRole = role === "partner" || role === "captain" || role === "field" || role === "operator";

  async function provision(recover = false) {
    setBusy(true); setError(""); setResult(null);
    let mutationApplied = false;
    try {
      const response = await identityFetch("/api/access/managed-user", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, role, recover }) });
      if (!response.ok) { setError(await responseMessage(response)); return; }
      mutationApplied = true;
      const payload = await response.json();
      setResult(role === "operator" ? payload as OperatorEnrollmentToken : null);
      await refreshCanonicalStatus();
    } catch (cause) {
      if (mutationApplied) markFinalStateUnverified();
      else if (isRequestFailure(cause)) setError(cause.message);
      else setError("تعذر الوصول إلى خدمات إدارة الهوية.");
    } finally { setBusy(false); }
  }

  async function changeAccess(action: "disable-role" | "enable-role" | "disable-identity" | "enable-identity") {
    if (reason.trim().length < 5) { setError("اكتب سببًا واضحًا من 5 أحرف على الأقل قبل تغيير الحالة."); return; }
    const expectedVersion = action.includes("identity") ? status?.actorVersion : status?.roleVersion;
    if (expectedVersion === undefined || expectedVersion === null) {
      setError("تعذر تحديد إصدار الحساب للتحقق من التزامن. أعد تحميل الحالة وحاول مرة أخرى.");
      return;
    }
    setBusy(true); setError("");
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
    } finally { setBusy(false); }
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
    setBusy(true); setError(""); setResetSuccess("");
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
      setShowOperatorResetPassword(false);
      setShowOperatorResetPasswordConfirmation(false);
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
  return <section className="access-card" aria-labelledby="account-access-title">
    <div className="access-card-heading">
      <span className="step-chip">حماية الوصول</span>
      <p className="eyebrow">إدارة الحسابات والأدوار</p>
      <h2 id="account-access-title">تهيئة أو إيقاف الحساب</h2>
      <p className="muted">هذه شاشة إدارية مستقلة: اختر الدور ثم ابحث برقم الهاتف. لا تختار الدور في واجهة دخول الشريك أو الكابتن أو الميداني أو الموظف؛ هناك يحدده الرقم تلقائيًا.</p>
    </div>
    <div className="access-form">
      <label className="field-label" htmlFor="account-role">الدور الإداري
        <select id="account-role" value={role} disabled={busy} onChange={(event) => { setRole(event.target.value as ActorType); setStatus(null); setError(""); }}>
          <option value="client">العميل</option><option value="partner">الشريك</option><option value="captain">الكابتن</option><option value="field">الميداني</option><option value="operator">موظف لوحة التحكم</option>
        </select>
      </label>
      <label className="field-label" htmlFor="account-phone">رقم الهاتف
        <input id="account-phone" autoComplete="tel" disabled={busy} inputMode="tel" placeholder="مثال: 967 77 000 100" value={phone} onChange={(event) => setPhone(event.target.value)} />
      </label>
      {canIssueActivation ? <button type="button" className="button button-primary" disabled={busy || !phone.trim() || activationBlocked} onClick={() => void provision()}>{busy ? "جارٍ تجهيز الحساب…" : role === "operator" ? "تهيئة الموظف وإصدار دعوة آمنة" : status.exists ? "إعادة فتح تفعيل الدور" : "تهيئة الدور"}</button> : <span className="form-action-placeholder" aria-hidden="true" />}
    </div>
    {status ? <div className={`managed-status ${statusIsHealthy ? "managed-status-info" : "managed-status-warning"}`} role="status">
      {status.exists ? <>
        <strong>{status.enabled ? "الدور مفعّل" : "الدور موقوف"} · {status.securityEnabled ? "الهوية مسموحة" : "الهوية موقوفة بالكامل"}</strong>
        <p>{status.activated ? "يوجد تسجيل سابق لهذا الدور." : "الدور مهيأ ولم يكتمل تفعيله بعد."}</p>
        {status.activated && managedRole ? <div className="managed-status managed-status-warning" role="alert">
          <strong>تم تفعيل هذا الدور من قبل.</strong>
          <p>{canIssueRecovery ? "يمكنك إصدار رمز جديد لاسترداد وإعادة تفعيل الحساب الموجود؛ ستُلغى الجلسات السابقة." : role === "operator" ? "حساب موظف لوحة التحكم مفعل. يمكنك إدارة حالته أو إعادة تعيين كلمة مروره إداريًا أدناه." : "أعد تفعيل الدور والهوية أولًا إذا كانا موقوفين."}</p>
          {canIssueRecovery ? <button type="button" className="button button-primary" disabled={busy} onClick={() => void provision(true)}>{busy ? "جارٍ استرداد الحساب…" : "استرداد وإعادة تفعيل الحساب"}</button> : null}
        </div> : null}
        {role === "operator" && status.activated && status.enabled && status.securityEnabled ? <section className="managed-status managed-status-info" aria-label="إعادة تعيين كلمة مرور الموظف">
          <strong>إعادة تعيين كلمة مرور الموظف (إداريًا)</strong>
          <p>بصفتك مالك المنصة، يمكنك تعيين كلمة مرور جديدة للموظف مع إلغاء كل جلساته القديمة فورًا (إصدار الاعتماد: {status.credentialVersion ?? "غير متاح"}).</p>
          <label className="field-label" htmlFor="operator-reset-new-password">كلمة المرور الجديدة
            <div className="password-field"><input id="operator-reset-new-password" type={showOperatorResetPassword ? "text" : "password"} autoComplete="new-password" disabled={busy} value={operatorResetPassword} onChange={(e) => setOperatorResetPassword(e.target.value)} /><button aria-label={showOperatorResetPassword ? "إخفاء كلمة المرور الجديدة" : "إظهار كلمة المرور الجديدة"} className="password-toggle" type="button" onClick={() => setShowOperatorResetPassword((visible) => !visible)}>{showOperatorResetPassword ? "إخفاء" : "إظهار"}</button></div>
            <span className="field-help">٨ أحرف على الأقل</span>
          </label>
          <label className="field-label" htmlFor="operator-reset-confirm-password">تأكيد كلمة المرور
            <div className="password-field"><input id="operator-reset-confirm-password" type={showOperatorResetPasswordConfirmation ? "text" : "password"} autoComplete="new-password" disabled={busy} value={operatorResetPasswordConfirmation} onChange={(e) => setOperatorResetPasswordConfirmation(e.target.value)} /><button aria-label={showOperatorResetPasswordConfirmation ? "إخفاء تأكيد كلمة المرور" : "إظهار تأكيد كلمة المرور"} className="password-toggle" type="button" onClick={() => setShowOperatorResetPasswordConfirmation((visible) => !visible)}>{showOperatorResetPasswordConfirmation ? "إخفاء" : "إظهار"}</button></div>
          </label>
          <button type="button" className="button button-primary" disabled={busy || !validatePasswordInputShape(operatorResetPassword, operatorResetPasswordConfirmation).valid || reason.trim().length < 5} onClick={() => void resetOperatorCredential()}>{busy ? "جارٍ التعيين…" : "إعادة تعيين كلمة مرور الموظف"}</button>
          {resetSuccess ? <p className="success-inline" role="status">{resetSuccess}</p> : null}
        </section> : null}
        <label className="field-label" htmlFor="access-reason">سبب التغيير
          <input id="access-reason" maxLength={500} placeholder="مثال: انتهاء التعاقد أو استرداد الجهاز" value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <div className="managed-status-actions">
          {status.enabled ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void changeAccess("disable-role")}>إيقاف الدور</button> : <button type="button" className="button button-primary" disabled={busy} onClick={() => void changeAccess("enable-role")}>إعادة تفعيل الدور</button>}
          {status.securityEnabled ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void changeAccess("disable-identity")}>إيقاف الهوية بالكامل</button> : <button type="button" className="button button-primary" disabled={busy} onClick={() => void changeAccess("enable-identity")}>إعادة تفعيل الهوية</button>}
        </div>
      </> : <>
        <strong>لا يوجد حساب مهيأ لهذا الدور.</strong>
        <p>{managedRole ? role === "operator" ? "يمكنك تهيئة الموظف وإصدار دعوة عالية الأمان تُستخدم مرة واحدة." : "يمكنك تهيئة الدور؛ سيكمل صاحبه التفعيل بإثبات رقم الهاتف فقط." : "تسجيل العميل يتم من تطبيق العميل، ولا يُصدر له رمز من هذه الشاشة."}</p>
      </>}
    </div> : null}
    {result ? <div className="code-output" role="status"><span className="summary-label">دعوة موظف عالية الأمان</span><code>{result.code}</code><p>تُعرض هذه الدعوة مرة واحدة فقط وتُستخدم لتفعيل موظف لوحة التحكم، وتنتهي في {new Date(result.expiresAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" })}.</p></div> : null}
    {finalStateUnverified ? <p className="identity-error" role="alert">الحالة النهائية غير متحققة؛ أعد تحميل الحالة قبل تنفيذ إجراء آخر.</p> : null}
    {error ? <p className="identity-error" role="alert">{error}</p> : null}
  </section>;
}


export default function Home() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loginRole, setLoginRole] = useState<ControlPanelRole>("operator");
  const [authMode, setAuthMode] = useState<"login" | "activate" | "recover">("login");
  const [controlStep, setControlStep] = useState<"phone" | "password" | "activation" | "recovery">("phone");
  const [operatorEnrollmentToken, setOperatorEnrollmentToken] = useState("");
  const [code, setCode] = useState("");
  const [activationPassword, setActivationPassword] = useState("");
  const [activationPasswordConfirmation, setActivationPasswordConfirmation] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryPasswordConfirmation, setRecoveryPasswordConfirmation] = useState("");
  const [showActivationPassword, setShowActivationPassword] = useState(false);
  const [showActivationPasswordConfirmation, setShowActivationPasswordConfirmation] = useState(false);
  const [showRecoveryPassword, setShowRecoveryPassword] = useState(false);
  const [showRecoveryPasswordConfirmation, setShowRecoveryPasswordConfirmation] = useState(false);
  const [challengeStarted, setChallengeStarted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function resetSignedOutAuthState() {
    setAuthMode("login");
    setControlStep("phone");
    setChallengeStarted(false);
    setPhone("");
    setPassword("");
    setCode("");
    setActivationPassword("");
    setActivationPasswordConfirmation("");
    setRecoveryPassword("");
    setRecoveryPasswordConfirmation("");
    setShowActivationPassword(false);
    setShowActivationPasswordConfirmation(false);
    setShowRecoveryPassword(false);
    setShowRecoveryPasswordConfirmation(false);
    setOperatorEnrollmentToken("");
    setShowPassword(false);
    setError("");
    setNotice("");
  }

  const restore = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await identityFetch("/api/auth/session", { cache: "no-store" });
      if (response.status === 401) {
        setView({ kind: "signed_out" });
        return;
      }
      if (!response.ok) {
        setView({ kind: "unavailable", message: await responseMessage(response) });
        return;
      }
      const body = (await response.json()) as { identity?: ActorIdentity };
      if (!body.identity) { setError("تعذر قراءة جلسة الهوية بعد التحقق."); return; }
      setView({ kind: "authenticated", identity: body.identity });
    } catch {
      setView({ kind: "unavailable", message: "تعذر الوصول إلى خدمة الهوية. تحقق من تشغيل الخدمة ثم أعد المحاولة." });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void restore(); }, [restore]);

  async function startLogin() {
    setBusy(true);
    setError("");
    try {
      if (!challengeStarted && controlStep === "phone") {
        setControlStep(authMode === "activate" ? "activation" : authMode === "recover" ? "recovery" : "password");
        return;
      }
      const response = await identityFetch(authMode === "login" ? "/api/auth/login/start" : authMode === "activate" ? "/api/auth/activation/start" : "/api/auth/recovery/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: authMode === "login" ? JSON.stringify({ phone, password, role: loginRole }) : authMode === "activate" ? JSON.stringify({ phone, operatorEnrollmentToken }) : JSON.stringify({ phone, role: loginRole }),
      });
      if (!response.ok) {
        setError(await responseMessage(response, authMode === "login" ? "login" : authMode === "recover" ? "recovery" : "general"));
        return;
      }
      setPassword("");
      setShowPassword(false);
      setChallengeStarted(true);
    } catch {
      setError("تعذر الوصول إلى خدمة الهوية. تحقق من الاتصال ثم أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  async function completeLogin() {
    setBusy(true);
    setError("");
    try {
      if (authMode === "recover") {
        const validation = validatePasswordInputShape(recoveryPassword, recoveryPasswordConfirmation);
        if (code.trim().length !== 6) {
          setError("أدخل رمز التحقق المكوّن من ٦ أرقام.");
          return;
        }
        if (!validation.valid) {
          setError(validation.message ?? "تحقق من كلمة المرور الجديدة وتأكيدها.");
          return;
        }
      }
      const response = await identityFetch(authMode === "login" ? "/api/auth/login/complete" : authMode === "activate" ? "/api/auth/activation/complete" : "/api/auth/recovery/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: authMode === "login" ? JSON.stringify({ phone, code, role: loginRole }) : authMode === "activate" ? JSON.stringify({ phone, operatorEnrollmentToken, verificationCode: code, password: activationPassword }) : JSON.stringify({ phone, role: loginRole, code, password: recoveryPassword }),
      });
      if (!response.ok) {
        setError(await responseMessage(response, authMode === "login" ? "login" : authMode === "recover" ? "recovery" : "general"));
        return;
      }
      const body = (await response.json()) as { identity?: ActorIdentity; status?: string };
      setCode("");
      setOperatorEnrollmentToken("");
      setActivationPassword("");
      setActivationPasswordConfirmation("");
      setRecoveryPassword("");
      setRecoveryPasswordConfirmation("");
      setChallengeStarted(false);
      if (authMode === "recover") {
        resetSignedOutAuthState();
        setNotice(body.status === "recovery_complete" ? "تم تغيير كلمة المرور. سجّل الدخول الآن باستخدام الكلمة الجديدة." : "اكتملت العملية. سجّل الدخول للمتابعة.");
        return;
      }
      if (!body.identity) { setError("تعذر قراءة جلسة الهوية بعد التحقق."); return; }
      resetSignedOutAuthState();
      setView({ kind: "authenticated", identity: body.identity });
    } catch {
      setError("تعذر الوصول إلى خدمة الهوية. تحقق من الاتصال ثم أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
    setNotice("");
    let remoteRevocationConfirmed = true;
    try {
      const response = await identityFetch("/api/auth/logout", { method: "POST" });
      remoteRevocationConfirmed = response.ok;
    } catch {
      remoteRevocationConfirmed = false;
    } finally {
      resetSignedOutAuthState();
      setView({ kind: "signed_out" });
      if (!remoteRevocationConfirmed) setNotice("تم تسجيل الخروج من هذا الجهاز، لكن تعذر تأكيد إبطال الجلسة على الخادم.");
      setBusy(false);
    }
  }

  const shell = (content: React.ReactNode, className = "") => (
    <main className={`control-shell ${className}`}>
      <div className="ambient-orb ambient-orb-one" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-two" aria-hidden="true" />
      <div className="control-frame">
        <header className="brand-header">
          <div className="brand-lockup"><span className="brand-rail" aria-hidden="true" /><span className="brand-name">بثواني</span></div>
          <span className="surface-label">لوحة التحكم</span>
        </header>
        {content}
        <footer className="quiet-footer"><span>هوية موثقة</span><span className="footer-separator" aria-hidden="true" /> <span>بيئة تشغيل محكومة</span></footer>
      </div>
    </main>
  );

  if (view.kind === "loading") {
    return shell(<section className="state-card" aria-live="polite"><span className="loading-mark" aria-hidden="true" /><p className="eyebrow">بثواني</p><h1>جارٍ تجهيز لوحة التحكم</h1><p className="muted">نستعيد جلسة المشغل بأمان.</p></section>, "state-shell");
  }

  if (view.kind === "unavailable") {
    return shell(<section className="state-card" role="alert"><span className="state-icon state-icon-warning" aria-hidden="true">!</span><p className="eyebrow">الخدمة تحتاج انتباهاً</p><h1>تعذر الوصول إلى الهوية</h1><p className="muted">{view.message}</p><button type="button" className="button button-primary" disabled={busy} onClick={() => void restore()}>{busy ? "جارٍ التحقق…" : "إعادة المحاولة"}</button></section>, "state-shell");
  }

  if (view.kind === "authenticated") {
    return shell(<><section className="workspace-card"><div className="workspace-intro"><span className="success-badge"><span className="success-dot" aria-hidden="true" /> الجلسة نشطة</span><p className="eyebrow">مساحة {view.identity.role === "platform_owner" ? "مالك المنصة" : "المشغل"}</p><h1>أهلاً بك في لوحة التحكم</h1><p className="lead">تم توثيق جلستك بعاملين. يمكنك متابعة الوحدات المصرح بها من هذه المساحة.</p></div><div className="session-summary"><div><span className="summary-label">الدور</span><strong>{view.identity.role === "platform_owner" ? "مالك المنصة" : "موظف لوحة التحكم"}</strong></div><div><span className="summary-label">السطح</span><strong>{view.identity.surface}</strong></div><div><span className="summary-label">حالة الجلسة</span><strong className="summary-value-success">موثقة</strong></div></div><div className="workspace-note"><span className="note-mark" aria-hidden="true">✓</span><div><strong>الهوية جاهزة</strong><p>لا توجد بيانات تشغيلية معروضة هنا قبل ربط صلاحيات الوحدات؛ لن نعرض أرقاماً تجريبية أو حالة غير مؤكدة.</p></div></div>{error ? <p className="identity-error" role="alert">{error}</p> : null}<button type="button" className="button button-secondary" disabled={busy} onClick={() => void logout()}>{busy ? "جارٍ إنهاء الجلسة…" : "تسجيل الخروج"}</button></section>{view.identity.role === "platform_owner" ? <AccountAccessPanel /> : null}</>, "workspace-shell");
  }

  const canStart = controlStep === "phone" || controlStep === "recovery" ? phone.trim().length > 0 : controlStep === "password" ? phone.trim().length > 0 && validatePasswordInputShape(password).valid : phone.trim().length > 0 && operatorEnrollmentToken.trim().length >= 24;
  const canCompleteActivation = code.trim().length === 6 && validatePasswordInputShape(activationPassword, activationPasswordConfirmation).valid;
  const recoveryPasswordShape = validatePasswordInputShape(recoveryPassword);
  const recoveryPasswordValidation = validatePasswordInputShape(recoveryPassword, recoveryPasswordConfirmation);
  return shell(
    <section className="auth-layout">
      <div className="auth-context">
        <span className="context-kicker">بوابة التشغيل</span>
        <h1>قرارات أوضح،<br /><em>تشغيل أهدأ.</em></h1>
        <p>لوحة التحكم تجمع أدوات المشغل المصرح بها في مساحة واحدة، وتبدأ من هوية موثقة لا من شاشات مزدحمة.</p>
        <div className="context-list"><div><span className="context-check">01</span><span>تسجيل دخول محمي</span></div><div><span className="context-check">02</span><span>تحقق ثانٍ قبل الوصول</span></div><div><span className="context-check">03</span><span>صلاحيات واضحة لكل وحدة</span></div></div>
      </div>
      <div className="auth-card">
        <div className="auth-card-header">
          <span className="step-chip">{challengeStarted ? "02 / 02" : "01 / 02"}</span>
          <p className="eyebrow">{controlStep === "activation" ? "تفعيل موظف" : controlStep === "recovery" ? "استرداد موظف" : challengeStarted ? "التحقق الثاني" : "هوية لوحة التحكم"}</p>
          <h2>{controlStep === "phone" ? "ابدأ برقم الهاتف" : controlStep === "activation" ? "تفعيل حساب الموظف" : controlStep === "recovery" ? "استعادة كلمة المرور" : challengeStarted ? "تحقق من الجهاز الثاني" : "تسجيل دخول لوحة التحكم"}</h2>
          <p className="muted">{controlStep === "phone" ? "اختر الدور والغرض من الدخول؛ لن نكشف حالة الحساب قبل اكتمال التحقق." : controlStep === "activation" ? "أدخل رمز التفعيل الصادر من مالك المنصة، ثم رمز تحقق الهاتف." : controlStep === "recovery" ? "أثبت ملكية الهاتف برمز تحقق ثم أنشئ كلمة مرور جديدة." : challengeStarted ? "أدخل الرمز الأخير الذي وصلك عبر قناة التحقق المهيأة." : "أدخل كلمة المرور للمتابعة إلى التحقق الثاني."}</p>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); if (challengeStarted) void completeLogin(); else void startLogin(); }} noValidate>
          {controlStep === "phone" && !challengeStarted ? <><label className="field-label" htmlFor="login-role">الدور<select id="login-role" value={loginRole} disabled={busy} onChange={(event) => setLoginRole(event.target.value as ControlPanelRole)}><option value="operator">موظف لوحة التحكم</option><option value="platform_owner">مالك المنصة</option></select></label>{loginRole === "operator" || loginRole === "platform_owner" ? <div className="auth-intent-actions">{loginRole === "operator" ? <button className="text-button" disabled={busy} type="button" onClick={() => { setAuthMode("activate"); setControlStep("activation"); setError(""); setNotice(""); }}>تفعيل حساب موظف</button> : null}<button className="text-button" disabled={busy} type="button" onClick={() => { setAuthMode("recover"); setControlStep("recovery"); setError(""); setNotice(""); }}>استرداد كلمة المرور</button></div> : null}</> : null}          {controlStep !== "phone" && !challengeStarted ? <p className="field-help">الدور المختار: {loginRole === "platform_owner" ? "مالك المنصة" : "موظف لوحة التحكم"}</p> : null}
          <label className="field-label" htmlFor="operator-phone">رقم الهاتف<input id="operator-phone" autoComplete="tel" disabled={challengeStarted || busy} inputMode="tel" placeholder="مثال: 967 77 000 100" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          {controlStep === "activation" && !challengeStarted ? <label className="field-label" htmlFor="operator-enrollment-token">دعوة الموظف الآمنة<input id="operator-enrollment-token" autoComplete="one-time-code" maxLength={256} value={operatorEnrollmentToken} onChange={(event) => setOperatorEnrollmentToken(event.target.value.trim())} placeholder="ألصق الدعوة عالية الأمان" /></label> : null}
          {controlStep === "password" && !challengeStarted ? <label className="field-label" htmlFor="operator-password">كلمة المرور<div className="password-field"><input aria-describedby="password-help" autoComplete="current-password" id="operator-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} /><button aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "إخفاء" : "إظهار"}</button></div><span className="field-help" id="password-help">٨ أحرف على الأقل</span></label> : null}
          {challengeStarted ? <label className="field-label" htmlFor="operator-code">رمز تحقق الهاتف<input aria-describedby="code-help" autoComplete="one-time-code" id="operator-code" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label> : null}
          {challengeStarted ? <span className="field-help" id="code-help">الرمز مكوّن من ٦ أرقام</span> : null}
          {authMode === "activate" && challengeStarted ? <><label className="field-label" htmlFor="activation-password">إنشاء كلمة المرور<div className="password-field"><input autoComplete="new-password" id="activation-password" type={showActivationPassword ? "text" : "password"} value={activationPassword} onChange={(event) => setActivationPassword(event.target.value)} /><button aria-label={showActivationPassword ? "إخفاء كلمة المرور الجديدة" : "إظهار كلمة المرور الجديدة"} className="password-toggle" type="button" onClick={() => setShowActivationPassword((visible) => !visible)}>{showActivationPassword ? "إخفاء" : "إظهار"}</button></div><span className="field-help">٨ أحرف على الأقل</span></label><label className="field-label" htmlFor="activation-password-confirmation">تأكيد كلمة المرور<div className="password-field"><input autoComplete="new-password" id="activation-password-confirmation" type={showActivationPasswordConfirmation ? "text" : "password"} value={activationPasswordConfirmation} onChange={(event) => setActivationPasswordConfirmation(event.target.value)} /><button aria-label={showActivationPasswordConfirmation ? "إخفاء تأكيد كلمة المرور" : "إظهار تأكيد كلمة المرور"} className="password-toggle" type="button" onClick={() => setShowActivationPasswordConfirmation((visible) => !visible)}>{showActivationPasswordConfirmation ? "إخفاء" : "إظهار"}</button></div></label></> : null}
          {authMode === "recover" && challengeStarted ? <><label className="field-label" htmlFor="recovery-password">كلمة المرور الجديدة<div className="password-field"><input aria-invalid={recoveryPassword.length > 0 && !recoveryPasswordShape.valid} autoComplete="new-password" id="recovery-password" type={showRecoveryPassword ? "text" : "password"} value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} /><button aria-label={showRecoveryPassword ? "إخفاء كلمة المرور الجديدة" : "إظهار كلمة المرور الجديدة"} className="password-toggle" type="button" onClick={() => setShowRecoveryPassword((visible) => !visible)}>{showRecoveryPassword ? "إخفاء" : "إظهار"}</button></div><span className="field-help">٨ أحرف على الأقل</span>{recoveryPassword.length > 0 && !recoveryPasswordShape.valid ? <span className="field-error">{recoveryPasswordShape.message}</span> : null}</label><label className="field-label" htmlFor="recovery-password-confirmation">تأكيد كلمة المرور<div className="password-field"><input aria-invalid={recoveryPasswordConfirmation.length > 0 && recoveryPasswordValidation.code === "MISMATCH"} autoComplete="new-password" id="recovery-password-confirmation" type={showRecoveryPasswordConfirmation ? "text" : "password"} value={recoveryPasswordConfirmation} onChange={(event) => setRecoveryPasswordConfirmation(event.target.value)} /><button aria-label={showRecoveryPasswordConfirmation ? "إخفاء تأكيد كلمة المرور" : "إظهار تأكيد كلمة المرور"} className="password-toggle" type="button" onClick={() => setShowRecoveryPasswordConfirmation((visible) => !visible)}>{showRecoveryPasswordConfirmation ? "إخفاء" : "إظهار"}</button></div>{recoveryPasswordConfirmation.length > 0 && recoveryPasswordValidation.code === "MISMATCH" ? <span className="field-error">كلمتا المرور غير متطابقتين</span> : null}</label></> : null}
          {error ? <p className="identity-error" role="alert">{error}</p> : null}
          {notice ? <p className="success-inline" role="status" aria-live="polite">{notice}</p> : null}
          {challengeStarted ? <div className="form-actions"><button className="button button-primary" disabled={busy || (authMode === "activate" ? !canCompleteActivation : code.trim().length !== 6)} type="submit">{busy ? "جارٍ التحقق…" : authMode === "activate" ? "حفظ كلمة المرور وتفعيل الحساب" : authMode === "recover" ? "تغيير كلمة المرور" : "إكمال تسجيل الدخول"}</button><button className="text-button" disabled={busy} type="button" onClick={resetSignedOutAuthState}>العودة لتعديل البيانات</button></div> : <div className="form-actions"><button className="button button-primary" disabled={busy || !canStart} type="submit">{busy ? "جارٍ التنفيذ…" : controlStep === "phone" ? "متابعة" : controlStep === "activation" ? "إرسال رمز تحقق الهاتف" : controlStep === "recovery" ? "إرسال رمز الاسترداد" : "متابعة إلى التحقق الثاني"}</button>{controlStep === "password" && (loginRole === "operator" || loginRole === "platform_owner") ? <button className="text-button" disabled={busy} type="button" onClick={() => { setAuthMode("recover"); setControlStep("recovery"); setError(""); setNotice(""); }}>نسيت كلمة المرور؟</button> : null}<p className="security-note"><span aria-hidden="true">⌁</span> {controlStep === "activation" ? "رمز التفعيل ثم رمز تحقق الهاتف" : controlStep === "recovery" ? "سيتم إلغاء الجلسات القديمة بعد تغيير كلمة المرور" : "اخترت العملية والدور يدويًا؛ لا تظهر حالة الحساب قبل التحقق."}</p></div>}
        </form>
      </div>
    </section>,
    "auth-shell",
  );
}
