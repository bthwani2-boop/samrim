"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ActorIdentity, ActorType, ControlPanelRole, ManagedActivationCode } from "@bthwani/identity";
import { colorRoles } from "@bthwani/design-system";

type ViewState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "signed_out" }>
  | Readonly<{ kind: "authenticated"; identity: ActorIdentity }>
  | Readonly<{ kind: "unavailable"; message: string }>;

function readableMessage(message: unknown): string {
  const raw = typeof message === "string" ? message.toLowerCase() : "";
  if (raw.includes("fetch failed") || raw.includes("network") || raw.includes("service")) return "تعذر الوصول إلى خدمة الهوية. تحقق من تشغيل الخدمة ثم أعد المحاولة.";
  if (raw.includes("authentication") || raw.includes("unauthorized") || raw.includes("invalid") || raw.includes("credential")) return "بيانات التحقق غير صحيحة أو انتهت صلاحيتها. راجعها وحاول مرة أخرى.";
  if (raw.includes("challenge") || raw.includes("code")) return "تعذر التحقق من الرمز. تأكد من إدخال الرمز الأخير ثم أعد المحاولة.";
  return "تعذر إكمال العملية. راجع البيانات وحاول مرة أخرى.";
}

async function responseMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
  const code = typeof body?.error?.code === "string" ? body.error.code : "";
  switch (code) {
    case "CONFLICT": return "هذا الحساب مفعّل مسبقًا أو توجد حالة تفعيل قائمة لهذا الدور.";
    case "RECOVERY_UNSUPPORTED": return "استرداد موظف لوحة التحكم يتم من أدوات إدارة المشغل المخصصة.";
    case "NOT_FOUND": return "لم يتم العثور على سجل الدور المطلوب.";
    case "FORBIDDEN": return "لا تملك الصلاحية لتنفيذ هذه العملية لهذا الدور.";
    case "INVALID_INPUT": return "راجع رقم الهاتف والبيانات المطلوبة ثم حاول مرة أخرى.";
    case "DSH_UNAVAILABLE": return "خدمة إدارة الأدوار غير متاحة. تحقق من تشغيل الحاويات ثم أعد المحاولة.";
    case "DSH_CONFIG_ERROR": return "إعدادات خدمة إدارة الأدوار غير مكتملة. أعد تشغيل لوحة التحكم المحلية ثم حاول مرة أخرى.";
    case "IDENTITY_UNAVAILABLE": return "خدمة الهوية غير متاحة. تحقق من تشغيل الحاويات ثم أعد المحاولة.";
    default: return readableMessage(body?.error?.message);
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

function AccountAccessPanel() {
  const [role, setRole] = useState<ActorType>("partner");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<{ exists: boolean; enabled: boolean; activated: boolean; securityEnabled: boolean; role: ActorType } | null>(null);
  const [result, setResult] = useState<ManagedActivationCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    const value = phone.trim();
    const id = ++requestId.current;
    setResult(null); setError("");
    if (value.length < 5) { setStatus(null); return; }
    const timeout = window.setTimeout(() => void (async () => {
      try {
        const response = await identityFetch(`/api/access/managed-user/status?${new URLSearchParams({ phone: value, role })}`);
        if (id !== requestId.current) return;
        if (!response.ok) { setStatus(null); setError(await responseMessage(response)); return; }
        setStatus(await response.json() as { exists: boolean; enabled: boolean; activated: boolean; securityEnabled: boolean; role: ActorType });
      } catch { if (id === requestId.current) { setStatus(null); setError("تعذر التحقق من حالة الرقم حاليًا."); } }
    })(), 450);
    return () => window.clearTimeout(timeout);
  }, [phone, role]);

  const roleLabel = role === "client" ? "العميل" : role === "partner" ? "الشريك" : role === "captain" ? "الكابتن" : role === "field" ? "الميداني" : "موظف لوحة التحكم";
  const managedRole = role === "partner" || role === "captain" || role === "field" || role === "operator";

  async function provision(recover = false) {
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await identityFetch("/api/access/managed-user", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, role, recover }) });
      if (!response.ok) { setError(await responseMessage(response)); return; }
      const payload = await response.json();
      setResult(role === "operator" ? payload as ManagedActivationCode : null); setStatus(null);
    } catch { setError("تعذر الوصول إلى خدمات إدارة الهوية."); } finally { setBusy(false); }
  }

  async function changeAccess(action: "disable-role" | "enable-role" | "disable-identity" | "enable-identity") {
    if (reason.trim().length < 5) { setError("اكتب سببًا واضحًا من 5 أحرف على الأقل قبل تغيير الحالة."); return; }
    setBusy(true); setError("");
    try {
      const response = await identityFetch("/api/access/account-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, role, action, reason }) });
      if (!response.ok) { setError(await responseMessage(response)); return; }
      setReason("");
      const refresh = await identityFetch(`/api/access/managed-user/status?${new URLSearchParams({ phone, role })}`);
      if (refresh.ok) setStatus(await refresh.json() as { exists: boolean; enabled: boolean; activated: boolean; securityEnabled: boolean; role: ActorType });
    } catch { setError("تعذر تحديث حالة الحساب."); } finally { setBusy(false); }
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
      {canIssueActivation ? <button className="button button-primary" disabled={busy || !phone.trim() || activationBlocked} onClick={() => void provision()}>{busy ? "جارٍ تجهيز الحساب…" : role === "operator" ? "تهيئة الموظف وإصدار دعوة آمنة" : status.exists ? "إعادة فتح تفعيل الدور" : "تهيئة الدور"}</button> : <span className="form-action-placeholder" aria-hidden="true" />}
    </div>
    {status ? <div className={`managed-status ${statusIsHealthy ? "managed-status-info" : "managed-status-warning"}`} role="status">
      {status.exists ? <>
        <strong>{status.enabled ? "الدور مفعّل" : "الدور موقوف"} · {status.securityEnabled ? "الهوية مسموحة" : "الهوية موقوفة بالكامل"}</strong>
        <p>{status.activated ? "يوجد تسجيل سابق لهذا الدور." : "الدور مهيأ ولم يكتمل تفعيله بعد."}</p>
        {status.activated && managedRole ? <div className="managed-status managed-status-warning" role="alert">
          <strong>تم تفعيل هذا الدور من قبل.</strong>
          <p>{canIssueRecovery ? "يمكنك إصدار رمز جديد لاسترداد وإعادة تفعيل الحساب الموجود؛ ستُلغى الجلسات السابقة." : role === "operator" ? "استرداد كلمة مرور الموظف يتم من مسار الدخول المخصص، ولا تُصدر هذه الشاشة دعوة ثانية للحساب المفعّل." : "أعد تفعيل الدور والهوية أولًا إذا كانا موقوفين."}</p>
          {canIssueRecovery ? <button className="button button-primary" disabled={busy} onClick={() => void provision(true)}>{busy ? "جارٍ استرداد الحساب…" : "استرداد وإعادة تفعيل الحساب"}</button> : null}
        </div> : null}
        <label className="field-label" htmlFor="access-reason">سبب التغيير
          <input id="access-reason" maxLength={500} placeholder="مثال: انتهاء التعاقد أو استرداد الجهاز" value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <div className="managed-status-actions">
          {status.enabled ? <button className="button button-secondary" disabled={busy} onClick={() => void changeAccess("disable-role")}>إيقاف الدور</button> : <button className="button button-primary" disabled={busy} onClick={() => void changeAccess("enable-role")}>إعادة تفعيل الدور</button>}
          {status.securityEnabled ? <button className="button button-secondary" disabled={busy} onClick={() => void changeAccess("disable-identity")}>إيقاف الهوية بالكامل</button> : <button className="button button-primary" disabled={busy} onClick={() => void changeAccess("enable-identity")}>إعادة تفعيل الهوية</button>}
        </div>
      </> : <>
        <strong>لا يوجد حساب مهيأ لهذا الدور.</strong>
        <p>{managedRole ? role === "operator" ? "يمكنك تهيئة الموظف وإصدار دعوة عالية الأمان تُستخدم مرة واحدة." : "يمكنك تهيئة الدور؛ سيكمل صاحبه التفعيل بإثبات رقم الهاتف فقط." : "تسجيل العميل يتم من تطبيق العميل، ولا يُصدر له رمز من هذه الشاشة."}</p>
      </>}
    </div> : null}
    {result ? <div className="code-output" role="status"><span className="summary-label">دعوة موظف عالية الأمان</span><code>{result.code}</code><p>تُعرض هذه الدعوة مرة واحدة فقط وتُستخدم لتفعيل موظف لوحة التحكم، وتنتهي في {new Date(result.expiresAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" })}.</p></div> : null}
    {error ? <p className="identity-error" role="alert">{error}</p> : null}
  </section>;
}

const visualTokens = {
  "--brand-action": colorRoles.brandAction,
  "--brand-structure": colorRoles.brandStructure,
  "--surface-warm": colorRoles.surfaceWarm,
  "--surface-base": colorRoles.surfaceBase,
  "--text-muted": colorRoles.textMuted,
  "--border-subtle": colorRoles.borderSubtle,
} as CSSProperties;

export default function Home() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loginRole, setLoginRole] = useState<ControlPanelRole>("operator");
  const [authMode, setAuthMode] = useState<"login" | "activate" | "recover">("login");
  const [controlStep, setControlStep] = useState<"phone" | "password" | "activation" | "recovery">("phone");
  const [activationCode, setActivationCode] = useState("");
  const [code, setCode] = useState("");
  const [activationPassword, setActivationPassword] = useState("");
  const [activationPasswordConfirmation, setActivationPasswordConfirmation] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryPasswordConfirmation, setRecoveryPasswordConfirmation] = useState("");
  const [challengeStarted, setChallengeStarted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function restore() {
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
  }

  useEffect(() => { void restore(); }, []);

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
        body: authMode === "login" ? JSON.stringify({ phone, password, role: loginRole }) : authMode === "activate" ? JSON.stringify({ phone, activationCode }) : JSON.stringify({ phone }),
      });
      if (!response.ok) {
        setError(await responseMessage(response));
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
      const response = await identityFetch(authMode === "login" ? "/api/auth/login/complete" : authMode === "activate" ? "/api/auth/activation/complete" : "/api/auth/recovery/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: authMode === "login" ? JSON.stringify({ phone, code, role: loginRole }) : authMode === "activate" ? JSON.stringify({ phone, activationCode, verificationCode: code, password: activationPassword }) : JSON.stringify({ phone, code, password: recoveryPassword }),
      });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      const body = (await response.json()) as { identity?: ActorIdentity; status?: string };
      setCode("");
      setActivationCode("");
      setActivationPassword("");
      setActivationPasswordConfirmation("");
      setRecoveryPassword("");
      setRecoveryPasswordConfirmation("");
      setChallengeStarted(false);
      if (authMode === "recover") {
        setError(body.status === "recovery_complete" ? "تم تغيير كلمة المرور. سجّل الدخول الآن باستخدام الكلمة الجديدة." : "اكتملت العملية. سجّل الدخول للمتابعة.");
        setControlStep("password");
        setAuthMode("login");
        return;
      }
      if (!body.identity) { setError("تعذر قراءة جلسة الهوية بعد التحقق."); return; }
      setControlStep("phone");
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
    try {
      const response = await identityFetch("/api/auth/logout", { method: "POST" });
      setView({ kind: "signed_out" });
      setChallengeStarted(false);
      setControlStep("phone");
      if (!response.ok) setError(await responseMessage(response));
    } catch {
      setView({ kind: "signed_out" });
      setError("تعذر إنهاء الجلسة على الخادم.");
    } finally {
      setBusy(false);
    }
  }

  const shell = (content: React.ReactNode, className = "") => (
    <main className={`control-shell ${className}`} style={visualTokens}>
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
    return shell(<section className="state-card" role="alert"><span className="state-icon state-icon-warning" aria-hidden="true">!</span><p className="eyebrow">الخدمة تحتاج انتباهاً</p><h1>تعذر الوصول إلى الهوية</h1><p className="muted">{view.message}</p><button className="button button-primary" disabled={busy} onClick={() => void restore()}>{busy ? "جارٍ التحقق…" : "إعادة المحاولة"}</button></section>, "state-shell");
  }

  if (view.kind === "authenticated") {
    return shell(<><section className="workspace-card"><div className="workspace-intro"><span className="success-badge"><span className="success-dot" aria-hidden="true" /> الجلسة نشطة</span><p className="eyebrow">مساحة {view.identity.role === "platform_owner" ? "مالك المنصة" : "المشغل"}</p><h1>أهلاً بك في لوحة التحكم</h1><p className="lead">تم توثيق جلستك بعاملين. يمكنك متابعة الوحدات المصرح بها من هذه المساحة.</p></div><div className="session-summary"><div><span className="summary-label">الدور</span><strong>{view.identity.role === "platform_owner" ? "مالك المنصة" : "موظف لوحة التحكم"}</strong></div><div><span className="summary-label">السطح</span><strong>{view.identity.surface}</strong></div><div><span className="summary-label">حالة الجلسة</span><strong className="summary-value-success">موثقة</strong></div></div><div className="workspace-note"><span className="note-mark" aria-hidden="true">✓</span><div><strong>الهوية جاهزة</strong><p>لا توجد بيانات تشغيلية معروضة هنا قبل ربط صلاحيات الوحدات؛ لن نعرض أرقاماً تجريبية أو حالة غير مؤكدة.</p></div></div>{error ? <p className="identity-error" role="alert">{error}</p> : null}<button className="button button-secondary" disabled={busy} onClick={() => void logout()}>{busy ? "جارٍ إنهاء الجلسة…" : "تسجيل الخروج"}</button></section>{view.identity.role === "platform_owner" ? <AccountAccessPanel /> : null}</>, "workspace-shell");
  }

  const canStart = controlStep === "phone" || controlStep === "recovery" ? phone.trim().length > 0 : controlStep === "password" ? phone.trim().length > 0 && password.length >= 15 : phone.trim().length > 0 && activationCode.trim().length >= 24;
  const canCompleteActivation = code.trim().length === 6 && activationPassword.length >= 15 && activationPassword === activationPasswordConfirmation;
  const canCompleteRecovery = code.trim().length === 6 && recoveryPassword.length >= 15 && recoveryPassword === recoveryPasswordConfirmation;
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
          {controlStep === "phone" && !challengeStarted ? <><label className="field-label" htmlFor="login-role">الدور<select id="login-role" value={loginRole} disabled={busy} onChange={(event) => setLoginRole(event.target.value as ControlPanelRole)}><option value="operator">موظف لوحة التحكم</option><option value="platform_owner">مالك المنصة</option></select></label>{loginRole === "operator" ? <div className="auth-intent-actions"><button className="text-button" disabled={busy} type="button" onClick={() => { setAuthMode("activate"); setControlStep("activation"); }}>تفعيل حساب موظف</button><button className="text-button" disabled={busy} type="button" onClick={() => { setAuthMode("recover"); setControlStep("recovery"); }}>استرداد كلمة المرور</button></div> : null}</> : null}          {controlStep !== "phone" && !challengeStarted ? <p className="field-help">الدور المختار: {loginRole === "platform_owner" ? "مالك المنصة" : "موظف لوحة التحكم"}</p> : null}
          <label className="field-label" htmlFor="operator-phone">رقم الهاتف<input id="operator-phone" autoComplete="tel" disabled={challengeStarted || busy} inputMode="tel" placeholder="مثال: 967 77 000 100" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          {controlStep === "activation" && !challengeStarted ? <label className="field-label" htmlFor="activation-code">دعوة الموظف الآمنة<input id="activation-code" autoComplete="one-time-code" maxLength={256} value={activationCode} onChange={(event) => setActivationCode(event.target.value.trim())} placeholder="ألصق الدعوة عالية الأمان" /></label> : null}
          {controlStep === "password" && !challengeStarted ? <label className="field-label" htmlFor="operator-password">كلمة المرور<div className="password-field"><input aria-describedby="password-help" autoComplete="current-password" id="operator-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} /><button aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "إخفاء" : "إظهار"}</button></div><span className="field-help" id="password-help">١٥ حرفاً على الأقل</span></label> : null}
          {challengeStarted ? <label className="field-label" htmlFor="operator-code">رمز تحقق الهاتف<input aria-describedby="code-help" autoComplete="one-time-code" id="operator-code" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label> : null}
          {challengeStarted ? <span className="field-help" id="code-help">الرمز مكوّن من ٦ أرقام</span> : null}
          {authMode === "activate" && challengeStarted ? <><label className="field-label" htmlFor="activation-password">إنشاء كلمة المرور<input autoComplete="new-password" id="activation-password" type="password" value={activationPassword} onChange={(event) => setActivationPassword(event.target.value)} /><span className="field-help">١٥ حرفاً على الأقل</span></label><label className="field-label" htmlFor="activation-password-confirmation">تأكيد كلمة المرور<input autoComplete="new-password" id="activation-password-confirmation" type="password" value={activationPasswordConfirmation} onChange={(event) => setActivationPasswordConfirmation(event.target.value)} /></label></> : null}
          {authMode === "recover" && challengeStarted ? <><label className="field-label" htmlFor="recovery-password">كلمة المرور الجديدة<input autoComplete="new-password" id="recovery-password" type="password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} /><span className="field-help">١٥ حرفاً على الأقل</span></label><label className="field-label" htmlFor="recovery-password-confirmation">تأكيد كلمة المرور<input autoComplete="new-password" id="recovery-password-confirmation" type="password" value={recoveryPasswordConfirmation} onChange={(event) => setRecoveryPasswordConfirmation(event.target.value)} /></label></> : null}
          {error ? <p className="identity-error" role="alert">{error}</p> : null}
          {challengeStarted ? <div className="form-actions"><button className="button button-primary" disabled={busy || (authMode === "activate" ? !canCompleteActivation : authMode === "recover" ? !canCompleteRecovery : code.trim().length !== 6)} type="submit">{busy ? "جارٍ التحقق…" : authMode === "activate" ? "حفظ كلمة المرور وتفعيل الحساب" : authMode === "recover" ? "تغيير كلمة المرور" : "إكمال تسجيل الدخول"}</button><button className="text-button" disabled={busy} type="button" onClick={() => { setChallengeStarted(false); setCode(""); setActivationPassword(""); setActivationPasswordConfirmation(""); setRecoveryPassword(""); setRecoveryPasswordConfirmation(""); setError(""); }}>العودة لتعديل البيانات</button></div> : <div className="form-actions"><button className="button button-primary" disabled={busy || !canStart} type="submit">{busy ? "جارٍ التنفيذ…" : controlStep === "phone" ? "متابعة" : controlStep === "activation" ? "إرسال رمز تحقق الهاتف" : controlStep === "recovery" ? "إرسال رمز الاسترداد" : "متابعة إلى التحقق الثاني"}</button>{controlStep === "password" && loginRole === "operator" ? <button className="text-button" disabled={busy} type="button" onClick={() => { setAuthMode("recover"); setControlStep("recovery"); setError(""); }}>نسيت كلمة المرور؟</button> : null}<p className="security-note"><span aria-hidden="true">⌁</span> {controlStep === "activation" ? "رمز التفعيل ثم رمز تحقق الهاتف" : controlStep === "recovery" ? "سيتم إلغاء الجلسات القديمة بعد تغيير كلمة المرور" : "اخترت العملية والدور يدويًا؛ لا تظهر حالة الحساب قبل التحقق."}</p></div>}
        </form>
      </div>
    </section>,
    "auth-shell",
  );
}
