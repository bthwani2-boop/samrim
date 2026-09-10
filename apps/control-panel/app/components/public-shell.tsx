"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { validatePasswordInputShape, type ActorIdentity, type ControlPanelRole } from "@bthwani/identity";
import { identityFetch, responseMessage } from "./identity-client";
import { useSession } from "./session-provider";

function BrandHeader() {
  return (
    <header className="brand-header">
      <div className="brand-lockup">
        <span className="brand-rail" aria-hidden="true" />
        <span className="brand-name">بثواني</span>
      </div>
      <span className="surface-label">لوحة التحكم</span>
    </header>
  );
}

function QuietFooter() {
  return (
    <footer className="quiet-footer">
      <span>هوية موثقة</span>
      <span className="footer-separator" aria-hidden="true" />
      <span>بيئة تشغيل محكومة</span>
    </footer>
  );
}

export function ControlShell({
  children,
  className = "",
  header = <BrandHeader />,
  footer = <QuietFooter />,
}: Readonly<{ children: ReactNode; className?: string; header?: ReactNode; footer?: ReactNode }>) {
  return (
    <div className={"control-shell " + className}>
      <div className="ambient-orb ambient-orb-one" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-two" aria-hidden="true" />
      <div className="control-frame">
        {header}
        {children}
        {footer}
      </div>
    </div>
  );
}

export function LoadingState({ title = "جارٍ تجهيز لوحة التحكم", message = "نستعيد جلسة المشغل بأمان." }: Readonly<{ title?: string; message?: string }>) {
  return (
    <ControlShell className="state-shell">
      <main className="state-content" aria-live="polite">
        <section className="state-card">
          <span className="loading-mark" aria-hidden="true" />
          <p className="eyebrow">بثواني</p>
          <h1>{title}</h1>
          <p className="muted">{message}</p>
        </section>
      </main>
    </ControlShell>
  );
}

export function UnavailableState({ message, onRetry, busy }: Readonly<{ message: string; onRetry: () => void; busy: boolean }>) {
  return (
    <ControlShell className="state-shell">
      <main className="state-content">
        <section className="state-card" role="alert">
          <span className="state-icon state-icon-warning" aria-hidden="true">!</span>
          <p className="eyebrow">الخدمة تحتاج انتباهاً</p>
          <h1>تعذر الوصول إلى الهوية</h1>
          <p className="muted">{message}</p>
          <button type="button" className="button button-primary" disabled={busy} onClick={onRetry}>
            {busy ? "جارٍ التحقق…" : "إعادة المحاولة"}
          </button>
        </section>
      </main>
    </ControlShell>
  );
}

export function IdentitySurface() {
  const router = useRouter();
  const { state, authenticate } = useSession();
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
  const [challengeStarted, setChallengeStarted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(state.kind === "signed_out" ? state.notice ?? "" : "");

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
    setOperatorEnrollmentToken("");
    setShowPassword(false);
    setError("");
    setNotice("");
  }

  async function startLogin() {
    setBusy(true);
    setError("");
    try {
      if (!challengeStarted && controlStep === "phone") {
        setControlStep(authMode === "activate" ? "activation" : authMode === "recover" ? "recovery" : "password");
        return;
      }
      const response = await identityFetch(
        authMode === "login" ? "/api/auth/login/start" : authMode === "activate" ? "/api/auth/activation/start" : "/api/auth/recovery/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: authMode === "login"
            ? JSON.stringify({ phone, password, role: loginRole })
            : authMode === "activate"
              ? JSON.stringify({ phone, operatorEnrollmentToken })
              : JSON.stringify({ phone }),
        },
      );
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
      const response = await identityFetch(
        authMode === "login" ? "/api/auth/login/complete" : authMode === "activate" ? "/api/auth/activation/complete" : "/api/auth/recovery/complete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: authMode === "login"
            ? JSON.stringify({ phone, code, role: loginRole })
            : authMode === "activate"
              ? JSON.stringify({ phone, operatorEnrollmentToken, verificationCode: code, password: activationPassword })
              : JSON.stringify({ phone, code, password: recoveryPassword }),
        },
      );
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
      if (!body.identity) {
        setError("تعذر قراءة جلسة الهوية بعد التحقق.");
        return;
      }
      resetSignedOutAuthState();
      authenticate(body.identity);
      router.replace("/workspace");
    } catch {
      setError("تعذر الوصول إلى خدمة الهوية. تحقق من الاتصال ثم أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  const canStart = controlStep === "phone" || controlStep === "recovery"
    ? phone.trim().length > 0
    : controlStep === "password"
      ? phone.trim().length > 0 && validatePasswordInputShape(password).valid
      : phone.trim().length > 0 && operatorEnrollmentToken.trim().length >= 24;
  const canCompleteActivation = code.trim().length === 6 && validatePasswordInputShape(activationPassword, activationPasswordConfirmation).valid;
  const canCompleteRecovery = code.trim().length === 6 && validatePasswordInputShape(recoveryPassword, recoveryPasswordConfirmation).valid;

  return (
    <ControlShell className="auth-shell">
      <main className="auth-layout">
        <div className="auth-context">
          <span className="context-kicker">بوابة التشغيل</span>
          <h1>قرارات أوضح،<br /><em>تشغيل أهدأ.</em></h1>
          <p>لوحة التحكم تجمع أدوات المشغل المصرح بها في مساحة واحدة، وتبدأ من هوية موثقة لا من شاشات مزدحمة.</p>
          <div className="context-list">
            <div><span className="context-check">01</span><span>تسجيل دخول محمي</span></div>
            <div><span className="context-check">02</span><span>تحقق ثانٍ قبل الوصول</span></div>
            <div><span className="context-check">03</span><span>صلاحيات واضحة لكل وحدة</span></div>
          </div>
        </div>
        <div className="auth-card">
          <div className="auth-card-header">
            <span className="step-chip">{challengeStarted ? "02 / 02" : "01 / 02"}</span>
            <p className="eyebrow">{controlStep === "activation" ? "تفعيل موظف" : controlStep === "recovery" ? "استرداد موظف" : challengeStarted ? "التحقق الثاني" : "هوية لوحة التحكم"}</p>
            <h2>{controlStep === "phone" ? "ابدأ برقم الهاتف" : controlStep === "activation" ? "تفعيل حساب الموظف" : controlStep === "recovery" ? "استعادة كلمة المرور" : challengeStarted ? "تحقق من الجهاز الثاني" : "تسجيل دخول لوحة التحكم"}</h2>
            <p className="muted">{controlStep === "phone" ? "اختر الدور والغرض من الدخول؛ لن نكشف حالة الحساب قبل اكتمال التحقق." : controlStep === "activation" ? "أدخل رمز التفعيل الصادر من مالك المنصة، ثم رمز تحقق الهاتف." : controlStep === "recovery" ? "أثبت ملكية الهاتف برمز تحقق ثم أنشئ كلمة مرور جديدة." : challengeStarted ? "أدخل الرمز الأخير الذي وصلك عبر قناة التحقق المهيأة." : "أدخل كلمة المرور للمتابعة إلى التحقق الثاني."}</p>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); if (challengeStarted) void completeLogin(); else void startLogin(); }} noValidate>
            {controlStep === "phone" && !challengeStarted ? (
              <>
                <label className="field-label" htmlFor="login-role">
                  الدور
                  <select id="login-role" value={loginRole} disabled={busy} onChange={(event) => setLoginRole(event.target.value as ControlPanelRole)}>
                    <option value="operator">موظف لوحة التحكم</option>
                    <option value="platform_owner">مالك المنصة</option>
                  </select>
                </label>
                {loginRole === "operator" ? (
                  <div className="auth-intent-actions">
                    <button className="text-button" disabled={busy} type="button" onClick={() => { setAuthMode("activate"); setControlStep("activation"); setError(""); setNotice(""); }}>
                      تفعيل حساب موظف
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
            {controlStep !== "phone" && !challengeStarted ? <p className="field-help">الدور المختار: {loginRole === "platform_owner" ? "مالك المنصة" : "موظف لوحة التحكم"}</p> : null}
            <label className="field-label" htmlFor="operator-phone">
              رقم الهاتف
              <input id="operator-phone" autoComplete="tel" disabled={challengeStarted || busy} inputMode="tel" placeholder="مثال: 967 77 000 100" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </label>
            {controlStep === "activation" && !challengeStarted ? (
              <label className="field-label" htmlFor="operator-enrollment-token">
                دعوة الموظف الآمنة
                <input id="operator-enrollment-token" autoComplete="one-time-code" maxLength={256} value={operatorEnrollmentToken} onChange={(event) => setOperatorEnrollmentToken(event.target.value.trim())} placeholder="ألصق الدعوة عالية الأمان" />
              </label>
            ) : null}
            {controlStep === "password" && !challengeStarted ? (
              <label className="field-label" htmlFor="operator-password">
                كلمة المرور
                <div className="password-field">
                  <input aria-describedby="password-help" autoComplete="current-password" id="operator-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} />
                  <button aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)}>
                    {showPassword ? "إخفاء" : "إظهار"}
                  </button>
                </div>
                <span className="field-help" id="password-help">١٥ حرفاً على الأقل</span>
              </label>
            ) : null}
            {challengeStarted ? (
              <label className="field-label" htmlFor="operator-code">
                رمز تحقق الهاتف
                <input aria-describedby="code-help" autoComplete="one-time-code" id="operator-code" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
              </label>
            ) : null}
            {challengeStarted ? <span className="field-help" id="code-help">الرمز مكوّن من ٦ أرقام</span> : null}
            {authMode === "activate" && challengeStarted ? (
              <>
                <label className="field-label" htmlFor="activation-password">
                  إنشاء كلمة المرور
                  <input autoComplete="new-password" id="activation-password" type="password" value={activationPassword} onChange={(event) => setActivationPassword(event.target.value)} />
                  <span className="field-help">١٥ حرفاً على الأقل</span>
                </label>
                <label className="field-label" htmlFor="activation-password-confirmation">
                  تأكيد كلمة المرور
                  <input autoComplete="new-password" id="activation-password-confirmation" type="password" value={activationPasswordConfirmation} onChange={(event) => setActivationPasswordConfirmation(event.target.value)} />
                </label>
              </>
            ) : null}
            {authMode === "recover" && challengeStarted ? (
              <>
                <label className="field-label" htmlFor="recovery-password">
                  كلمة المرور الجديدة
                  <input autoComplete="new-password" id="recovery-password" type="password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} />
                  <span className="field-help">١٥ حرفاً على الأقل</span>
                </label>
                <label className="field-label" htmlFor="recovery-password-confirmation">
                  تأكيد كلمة المرور
                  <input autoComplete="new-password" id="recovery-password-confirmation" type="password" value={recoveryPasswordConfirmation} onChange={(event) => setRecoveryPasswordConfirmation(event.target.value)} />
                </label>
              </>
            ) : null}
            {error ? <p className="identity-error" role="alert">{error}</p> : null}
            {notice ? <p className="success-inline" role="status" aria-live="polite">{notice}</p> : null}
            {challengeStarted ? (
              <div className="form-actions">
                <button className="button button-primary" disabled={busy || (authMode === "activate" ? !canCompleteActivation : authMode === "recover" ? !canCompleteRecovery : code.trim().length !== 6)} type="submit">
                  {busy ? "جارٍ التحقق…" : authMode === "activate" ? "حفظ كلمة المرور وتفعيل الحساب" : authMode === "recover" ? "تغيير كلمة المرور" : "إكمال تسجيل الدخول"}
                </button>
                <button className="text-button" disabled={busy} type="button" onClick={resetSignedOutAuthState}>العودة لتعديل البيانات</button>
              </div>
            ) : (
              <div className="form-actions">
                <button className="button button-primary" disabled={busy || !canStart} type="submit">
                  {busy ? "جارٍ التنفيذ…" : controlStep === "phone" ? "متابعة" : controlStep === "activation" ? "إرسال رمز تحقق الهاتف" : controlStep === "recovery" ? "إرسال رمز الاسترداد" : "متابعة إلى التحقق الثاني"}
                </button>
                {controlStep === "password" && loginRole === "operator" ? (
                  <button className="text-button" disabled={busy} type="button" onClick={() => { setAuthMode("recover"); setControlStep("recovery"); setError(""); setNotice(""); }}>
                    نسيت كلمة المرور؟
                  </button>
                ) : null}
                <p className="security-note"><span aria-hidden="true">⌁</span> {controlStep === "activation" ? "رمز التفعيل ثم رمز تحقق الهاتف" : controlStep === "recovery" ? "سيتم إلغاء الجلسات القديمة بعد تغيير كلمة المرور" : "اخترت العملية والدور يدويًا؛ لا تظهر حالة الحساب قبل التحقق."}</p>
              </div>
            )}
          </form>
        </div>
      </main>
    </ControlShell>
  );
}
