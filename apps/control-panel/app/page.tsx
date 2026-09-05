"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { ActorIdentity, ControlPanelRole, ManagedActivationCode, ManagedActivationRole } from "@bthwani/identity";
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
    case "NOT_FOUND": return "لم يتم العثور على سجل الدور المطلوب.";
    case "FORBIDDEN": return "لا تملك الصلاحية لتنفيذ هذه العملية لهذا الدور.";
    case "INVALID_INPUT": return "راجع رقم الهاتف والبيانات المطلوبة ثم حاول مرة أخرى.";
    case "DSH_UNAVAILABLE": return "خدمة إدارة الأدوار غير متاحة. تحقق من تشغيل الحاويات ثم أعد المحاولة.";
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

function ManagedAccessPanel() {
  const [role, setRole] = useState<ManagedActivationRole>("partner");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<ManagedActivationCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function provisionAndIssue() {
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await identityFetch("/api/access/managed-user", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, role, ...(role === "operator" ? { password } : {}) }) });
      if (!response.ok) { setError(await responseMessage(response)); return; }
      setResult((await response.json()) as ManagedActivationCode);
      setPhone(""); setPassword("");
    } catch { setError("تعذر الوصول إلى خدمات إدارة الهوية. تحقق من تشغيل الحاويات ثم أعد المحاولة."); }
    finally { setBusy(false); }
  }

  const isOperator = role === "operator";
  const roleLabel = role === "partner" ? "الشريك" : role === "captain" ? "الكابتن" : role === "field" ? "الميداني" : "موظف لوحة التحكم";
  return <section className="access-card" aria-labelledby="managed-access-title"><div className="access-card-heading"><span className="step-chip">وصول محكوم</span><p className="eyebrow">إدارة الأجهزة المهيأة</p><h2 id="managed-access-title">تهيئة مستخدم وإصدار رمز</h2><p className="muted">ابدأ برقم الهاتف والدور. تُهيّئ المنصة الحساب عبر مالك المجال ثم تُصدر رمز تفعيل مرتبطًا به ويُستخدم مرة واحدة.</p></div><div className="access-form"><label className="field-label" htmlFor="managed-role">الدور<select id="managed-role" value={role} onChange={(event) => { setRole(event.target.value as ManagedActivationRole); setResult(null); setError(""); }}><option value="partner">الشريك</option><option value="captain">الكابتن</option><option value="field">الميداني</option><option value="operator">موظف لوحة التحكم</option></select></label><label className="field-label" htmlFor="managed-phone">رقم الهاتف<input id="managed-phone" autoComplete="tel" inputMode="tel" placeholder="مثال: 967 77 000 100" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>{isOperator ? <label className="field-label" htmlFor="managed-password">كلمة مرور الموظف<input id="managed-password" autoComplete="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /><span className="field-help">١٢ حرفاً على الأقل</span></label> : null}<button className="button button-primary" disabled={busy || !phone.trim() || (isOperator && password.length < 12)} onClick={() => void provisionAndIssue()}>{busy ? "جارٍ تهيئة الحساب وإصدار الرمز…" : "تهيئة الحساب وإصدار الرمز"}</button></div>{error ? <p className="identity-error" role="alert">{error}</p> : null}{result ? <div className="code-output" role="status"><span className="summary-label">رمز {roleLabel}</span><code>{result.code}</code><p>سيظهر الرمز مرة واحدة فقط. احفظه وسلّمه للقناة الآمنة الخاصة بالدور. تنتهي صلاحيته في {new Date(result.expiresAt).toLocaleTimeString("ar-YE", { hour: "2-digit", minute: "2-digit" })}.</p></div> : null}</section>;
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
  const [authMode, setAuthMode] = useState<"login" | "activate">("login");
  const [activationCode, setActivationCode] = useState("");
  const [code, setCode] = useState("");
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
      const body = (await response.json()) as { identity: ActorIdentity };
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
      const response = await identityFetch(authMode === "login" ? "/api/auth/login/start" : "/api/auth/activation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: authMode === "login" ? JSON.stringify({ phone, password, role: loginRole }) : JSON.stringify({ phone, activationCode }),
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
      const response = await identityFetch(authMode === "login" ? "/api/auth/login/complete" : "/api/auth/activation/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: authMode === "login" ? JSON.stringify({ phone, code, role: loginRole }) : JSON.stringify({ phone, activationCode, verificationCode: code }),
      });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      const body = (await response.json()) as { identity: ActorIdentity };
      setCode("");
      setActivationCode("");
      setChallengeStarted(false);
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
    return shell(<><section className="workspace-card"><div className="workspace-intro"><span className="success-badge"><span className="success-dot" aria-hidden="true" /> الجلسة نشطة</span><p className="eyebrow">مساحة {view.identity.role === "platform_owner" ? "مالك المنصة" : "المشغل"}</p><h1>أهلاً بك في لوحة التحكم</h1><p className="lead">تم توثيق جلستك بعاملين. يمكنك متابعة الوحدات المصرح بها من هذه المساحة.</p></div><div className="session-summary"><div><span className="summary-label">الدور</span><strong>{view.identity.role === "platform_owner" ? "مالك المنصة" : "موظف لوحة التحكم"}</strong></div><div><span className="summary-label">السطح</span><strong>{view.identity.surface}</strong></div><div><span className="summary-label">حالة الجلسة</span><strong className="summary-value-success">موثقة</strong></div></div><div className="workspace-note"><span className="note-mark" aria-hidden="true">✓</span><div><strong>الهوية جاهزة</strong><p>لا توجد بيانات تشغيلية معروضة هنا قبل ربط صلاحيات الوحدات؛ لن نعرض أرقاماً تجريبية أو حالة غير مؤكدة.</p></div></div>{error ? <p className="identity-error" role="alert">{error}</p> : null}<button className="button button-secondary" disabled={busy} onClick={() => void logout()}>{busy ? "جارٍ إنهاء الجلسة…" : "تسجيل الخروج"}</button></section>{view.identity.role === "platform_owner" ? <ManagedAccessPanel /> : null}</>, "workspace-shell");
  }

  const canStart = authMode === "login" ? phone.trim().length > 0 && password.length >= 12 : phone.trim().length > 0 && activationCode.trim().length >= 20;
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
          <p className="eyebrow">{authMode === "activate" ? "تفعيل موظف" : challengeStarted ? "التحقق الثاني" : "هوية لوحة التحكم"}</p>
          <h2>{authMode === "activate" ? "تفعيل حساب الموظف" : challengeStarted ? "تحقق من الجهاز الثاني" : "تسجيل دخول لوحة التحكم"}</h2>
          <p className="muted">{authMode === "activate" ? "أدخل رمز التفعيل الصادر من مالك المنصة، ثم رمز تحقق الهاتف." : challengeStarted ? "أدخل الرمز الأخير الذي وصلك عبر قناة التحقق المهيأة." : "اختر نوع الحساب واستخدم بيانات الهوية المعتمدة للمتابعة."}</p>
        </div>
        <div className="auth-mode-switch" role="group" aria-label="نوع العملية">
          <button className={authMode === "login" ? "text-button active" : "text-button"} type="button" disabled={busy || challengeStarted} onClick={() => { setAuthMode("login"); setLoginRole("operator"); setError(""); }}>تسجيل الدخول</button>
          <button className={authMode === "activate" ? "text-button active" : "text-button"} type="button" disabled={busy || challengeStarted} onClick={() => { setAuthMode("activate"); setLoginRole("operator"); setError(""); }}>تفعيل حساب موظف</button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); if (challengeStarted) void completeLogin(); else void startLogin(); }} noValidate>
          {authMode === "login" && !challengeStarted ? <label className="field-label" htmlFor="control-role">نوع الحساب<select id="control-role" value={loginRole} disabled={busy} onChange={(event) => setLoginRole(event.target.value as ControlPanelRole)}><option value="operator">موظف لوحة التحكم</option><option value="platform_owner">مالك المنصة</option></select></label> : null}
          <label className="field-label" htmlFor="operator-phone">رقم الهاتف<input id="operator-phone" autoComplete="tel" disabled={challengeStarted || busy} inputMode="tel" placeholder="مثال: 967 77 000 100" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          {authMode === "activate" && !challengeStarted ? <label className="field-label" htmlFor="activation-code">رمز التفعيل<input id="activation-code" autoComplete="one-time-code" value={activationCode} onChange={(event) => setActivationCode(event.target.value.toUpperCase())} placeholder="BTH-…" /></label> : null}
          {authMode === "login" && !challengeStarted ? <label className="field-label" htmlFor="operator-password">كلمة المرور<div className="password-field"><input aria-describedby="password-help" autoComplete="current-password" id="operator-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} /><button aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "إخفاء" : "إظهار"}</button></div><span className="field-help" id="password-help">١٢ حرفاً على الأقل</span></label> : null}
          {challengeStarted ? <label className="field-label" htmlFor="operator-code">رمز تحقق الهاتف<input aria-describedby="code-help" autoComplete="one-time-code" id="operator-code" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></label> : null}
          {challengeStarted ? <span className="field-help" id="code-help">الرمز مكوّن من ٦ أرقام</span> : null}
          {error ? <p className="identity-error" role="alert">{error}</p> : null}
          {challengeStarted ? <div className="form-actions"><button className="button button-primary" disabled={busy || code.trim().length !== 6} type="submit">{busy ? "جارٍ التحقق…" : authMode === "activate" ? "تفعيل الحساب" : "إكمال تسجيل الدخول"}</button><button className="text-button" disabled={busy} type="button" onClick={() => { setChallengeStarted(false); setCode(""); setError(""); }}>العودة لتعديل البيانات</button></div> : <div className="form-actions"><button className="button button-primary" disabled={busy || !canStart} type="submit">{busy ? "جارٍ بدء التحقق…" : authMode === "activate" ? "إرسال رمز تحقق الهاتف" : "متابعة إلى التحقق الثاني"}</button><p className="security-note"><span aria-hidden="true">⌁</span> {authMode === "activate" ? "رمز التفعيل لا يغني عن رمز تحقق الهاتف" : "يتطلب الدخول كلمة مرور ورمز تحقق ثانياً"}</p></div>}
        </form>
      </div>
    </section>,
    "auth-shell",
  );
}
