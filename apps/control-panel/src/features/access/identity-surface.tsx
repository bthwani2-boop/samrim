"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActorIdentity, PasskeyOptions, WebAuthnJSON } from "@bthwani/identity";

import { responseMessage } from "./identity-error-message";
import { identityFetch } from "../../session/identity-fetch";
import { useSession } from "../../session/session-provider";
import { ControlShell } from "../../shell/public-shell";

type Flow = "access" | "enrollment" | "recovery";

function toBytes(value: unknown): Uint8Array {
  if (typeof value !== "string") throw new Error("WEBAUTHN_OPTION_INVALID");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseRequestOptions(publicKey: WebAuthnJSON): PublicKeyCredentialRequestOptions {
  const parser = (PublicKeyCredential as unknown as { parseRequestOptionsFromJSON?: (value: unknown) => PublicKeyCredentialRequestOptions }).parseRequestOptionsFromJSON;
  if (parser) return parser(publicKey);
  const value = { ...publicKey } as Record<string, unknown>;
  value.challenge = toBytes(value.challenge);
  return value as unknown as PublicKeyCredentialRequestOptions;
}

function parseCreationOptions(publicKey: WebAuthnJSON): PublicKeyCredentialCreationOptions {
  const parser = (PublicKeyCredential as unknown as { parseCreationOptionsFromJSON?: (value: unknown) => PublicKeyCredentialCreationOptions }).parseCreationOptionsFromJSON;
  if (parser) return parser(publicKey);
  const value = { ...publicKey } as Record<string, unknown>;
  value.challenge = toBytes(value.challenge);
  const user = value.user;
  if (user && typeof user === "object") (user as Record<string, unknown>).id = toBytes((user as Record<string, unknown>).id);
  return value as unknown as PublicKeyCredentialCreationOptions;
}

function credentialJSON(credential: Credential | null): WebAuthnJSON {
  if (!credential || !("toJSON" in credential) || typeof (credential as Credential & { toJSON?: unknown }).toJSON !== "function") {
    throw new Error("WEBAUTHN_CREDENTIAL_UNAVAILABLE");
  }
  return (credential as Credential & { toJSON(): WebAuthnJSON }).toJSON();
}

async function readPasskeyOptions(path: string, body?: unknown): Promise<PasskeyOptions> {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await identityFetch(path, {
    ...init,
  });
  if (!response.ok) throw new Error(await responseMessage(response, "login"));
  return await response.json() as PasskeyOptions;
}

type FinishResponse = Readonly<{ identity?: ActorIdentity; recoveryCredential?: string }>;

async function finishPasskey(path: string, options: PasskeyOptions, creation: boolean): Promise<FinishResponse> {
  if (!window.PublicKeyCredential || !navigator.credentials) throw new Error("هذا المتصفح لا يدعم مفاتيح المرور.");
  const credential = creation
    ? await navigator.credentials.create({ publicKey: parseCreationOptions(options.publicKey) })
    : await navigator.credentials.get({ publicKey: parseRequestOptions(options.publicKey) });
  const response = await identityFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ceremonyId: options.ceremonyId, credential: credentialJSON(credential) }),
  });
  if (!response.ok) throw new Error(await responseMessage(response, "login"));
  return await response.json() as FinishResponse;
}

export function IdentitySurface() {
  const router = useRouter();
  const { authenticate, state: sessionState } = useSession();
  const [flow, setFlow] = useState<Flow>("access");
  const [phone, setPhone] = useState("");
  const [token, setToken] = useState("");
  const [code, setCode] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [challengeStarted, setChallengeStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recoveryCredential, setRecoveryCredential] = useState("");
  const [pendingIdentity, setPendingIdentity] = useState<ActorIdentity | null>(null);

  function reset() {
    setFlow("access");
    setPhone("");
    setToken("");
    setCode("");
    setRecoveryInput("");
    setChallengeStarted(false);
    setError("");
    setNotice("");
    setRecoveryCredential("");
    setPendingIdentity(null);
  }

  async function authenticateWithPasskey() {
    setBusy(true);
    setError("");
    try {
      const passkeyOptions = await readPasskeyOptions("/api/auth/passkey/options");
      const result = await finishPasskey("/api/auth/passkey/finish", passkeyOptions, false);
      if (!result.identity) throw new Error("تعذر قراءة جلسة المشغل بعد التحقق.");
      authenticate(result.identity);
      router.replace("/workspace");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إكمال تحقق مفتاح المرور.");
    } finally {
      setBusy(false);
    }
  }

  async function requestEnrollment() {
    setBusy(true);
    setError("");
    try {
      const response = await identityFetch("/api/auth/activation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, operatorEnrollmentToken: token }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "login"));
      setChallengeStarted(true);
      setNotice("إذا كانت الدعوة صالحة، سيصلك رمز إثبات الهاتف عبر القناة المهيأة.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر بدء تفعيل المشغل.");
    } finally {
      setBusy(false);
    }
  }

  async function requestOperatorRecovery() {
    setBusy(true);
    setError("");
    try {
      const response = await identityFetch("/api/auth/operator/recovery/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, recoveryCredential: recoveryInput }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "login"));
      setChallengeStarted(true);
      setNotice("إذا كان اعتماد الاسترداد صالحًا، سيصلك رمز إثبات الهاتف عبر القناة المهيأة.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر بدء استرداد المشغل.");
    } finally {
      setBusy(false);
    }
  }

  async function beginEnrollmentRegistration() {
    setBusy(true);
    setError("");
    try {
      const passkeyOptions = await readPasskeyOptions("/api/auth/activation/complete", { phone, operatorEnrollmentToken: token, verificationCode: code });
      const result = await finishPasskey("/api/auth/passkey/registration/finish", passkeyOptions, true);
      if (!result.identity) throw new Error("تعذر قراءة جلسة المشغل بعد التسجيل.");
      if (result.recoveryCredential) {
        setPendingIdentity(result.identity);
        setRecoveryCredential(result.recoveryCredential);
      } else {
        authenticate(result.identity);
        router.replace("/workspace");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تسجيل مفتاح المرور.");
    } finally {
      setBusy(false);
    }
  }

  async function beginRecoveryRegistration() {
    setBusy(true);
    setError("");
    try {
      const passkeyOptions = await readPasskeyOptions("/api/auth/operator/recovery/options", { phone, recoveryCredential: recoveryInput, verificationCode: code });
      const result = await finishPasskey("/api/auth/operator/recovery/finish", passkeyOptions, true);
      if (!result.identity) throw new Error("تعذر قراءة جلسة المشغل بعد الاسترداد.");
      if (result.recoveryCredential) {
        setPendingIdentity(result.identity);
        setRecoveryCredential(result.recoveryCredential);
      } else {
        authenticate(result.identity);
        router.replace("/workspace");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إكمال إعادة تسجيل مفتاح المرور.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ControlShell className="auth-shell">
      {recoveryCredential ? (
        <section className="state-card" aria-labelledby="recovery-credential-title">
          <p className="eyebrow">اعتماد استرداد محكوم</p>
          <h1 id="recovery-credential-title">احفظ هذا الاعتماد الآن</h1>
          <p className="muted">يُعرض مرة واحدة فقط. خزّنه في مدير أسرار محكوم؛ لا نحتفظ بالنص الخام على الخادم.</p>
          <code className="code-output">{recoveryCredential}</code>
          <button className="button button-primary" type="button" onClick={() => { setRecoveryCredential(""); if (pendingIdentity) authenticate(pendingIdentity); setPendingIdentity(null); router.replace("/workspace"); }}>حفظت الاعتماد وفتح لوحة التحكم</button>
        </section>
      ) : null}
      <main className="auth-layout">
        <div className="auth-context">
          <span className="context-kicker">بوابة التشغيل</span>
          <h1>وصول واضح،<br /><em>وحماية أقوى.</em></h1>
          <p>يفتح المشغل لوحة التحكم بمفتاح مرور موثّق من المتصفح، دون كلمة مرور أو رسالة SMS في الدخول اليومي.</p>
          <div className="context-list">
            <div><span className="context-check">01</span><span>مفتاح مرور مقاوم للتصيد</span></div>
            <div><span className="context-check">02</span><span>تحقق مستخدم مطلوب</span></div>
            <div><span className="context-check">03</span><span>جلسة خادم محمية</span></div>
          </div>
        </div>
        <section className="auth-card" aria-labelledby="identity-surface-title" hidden={Boolean(recoveryCredential)}>
          <div className="auth-card-header">
            <span className="step-chip">هوية المشغل</span>
            <p className="eyebrow">{flow === "enrollment" ? "تفعيل حساب المشغل" : flow === "recovery" ? "استرداد وصول محكوم" : "دخول آمن"}</p>
            <h2 id="identity-surface-title">{flow === "enrollment" ? "تفعيل بمفتاح مرور" : flow === "recovery" ? "اطلب إعادة التسجيل" : "الدخول بمفتاح المرور"}</h2>
            <p className="muted">{flow === "enrollment" ? "تحتاج إلى دعوة محكومة ورمز إثبات الهاتف، ثم يسجّل المتصفح مفتاح مرور جديداً." : flow === "recovery" ? "لا يعيد الهاتف وحده إنشاء وصول المشغل. اطلب إعادة التسجيل من مشغل مخول أو استخدم اعتماد الاسترداد المحكوم." : "استخدم native passkey gesture للوصول إلى لوحة التحكم."}</p>
            {sessionState.kind === "signed_out" && sessionState.notice ? <p className="success-inline" role="status">{sessionState.notice}</p> : null}
          </div>
          {flow === "access" ? (
            <div className="form-actions">
              <button className="button button-primary" disabled={busy} type="button" onClick={() => void authenticateWithPasskey()}>
                {busy ? "جارٍ التحقق…" : "الدخول بمفتاح المرور"}
              </button>
              <button className="text-button" disabled={busy} type="button" onClick={() => { setFlow("enrollment"); setError(""); setNotice(""); }}>
                تفعيل حساب موظف
              </button>
              <button className="text-button" disabled={busy} type="button" onClick={() => { setFlow("recovery"); setError(""); setNotice(""); }}>
                استرداد الوصول
              </button>
            </div>
          ) : flow === "recovery" ? (
            <form onSubmit={(event) => { event.preventDefault(); if (challengeStarted) void beginRecoveryRegistration(); else void requestOperatorRecovery(); }} noValidate>
              <p className="security-note">أدخل اعتماد الاسترداد الذي عُرض مرة واحدة بعد تفعيل المشغل. يلزم أيضًا إثبات الهاتف؛ الهاتف وحده لا يمنح وصولًا.</p>
              <label className="field-label" htmlFor="operator-recovery-phone">رقم الهاتف<input id="operator-recovery-phone" autoComplete="tel" disabled={challengeStarted || busy} inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="مثال: 967 77 000 100" /></label>
              <label className="field-label" htmlFor="operator-recovery-credential">اعتماد الاسترداد<input id="operator-recovery-credential" autoComplete="one-time-code" disabled={challengeStarted || busy} value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value.trim())} /></label>
              {challengeStarted ? <label className="field-label" htmlFor="operator-recovery-code">رمز إثبات الهاتف<input id="operator-recovery-code" autoComplete="one-time-code" disabled={busy} inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label> : null}
              {error ? <p className="identity-error" role="alert">{error}</p> : null}
              {notice ? <p className="success-inline" role="status">{notice}</p> : null}
              <div className="form-actions">
                <button className="button button-primary" disabled={busy || !phone.trim() || recoveryInput.trim().length < 24 || (challengeStarted && code.trim().length !== 6)} type="submit">
                  {busy ? "جارٍ التنفيذ…" : challengeStarted ? "إثبات الهاتف وتسجيل مفتاح مرور بديل" : "إرسال رمز إثبات الهاتف"}
                </button>
                <button className="text-button" disabled={busy} type="button" onClick={reset}>العودة للدخول</button>
              </div>
            </form>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); if (challengeStarted) void beginEnrollmentRegistration(); else void requestEnrollment(); }} noValidate>
              <label className="field-label" htmlFor="operator-phone">رقم الهاتف<input id="operator-phone" autoComplete="tel" disabled={challengeStarted || busy} inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="مثال: 967 77 000 100" /></label>
              <label className="field-label" htmlFor="operator-enrollment-token">دعوة التفعيل عالية الأمان<input id="operator-enrollment-token" autoComplete="one-time-code" disabled={challengeStarted || busy} maxLength={256} value={token} onChange={(event) => setToken(event.target.value.trim())} /></label>
              {challengeStarted ? <label className="field-label" htmlFor="operator-code">رمز إثبات الهاتف<input id="operator-code" autoComplete="one-time-code" disabled={busy} inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label> : null}
              {error ? <p className="identity-error" role="alert">{error}</p> : null}
              {notice ? <p className="success-inline" role="status">{notice}</p> : null}
              <div className="form-actions">
                <button className="button button-primary" disabled={busy || !phone.trim() || token.trim().length < 24 || (challengeStarted && code.trim().length !== 6)} type="submit">
                  {busy ? "جارٍ التنفيذ…" : challengeStarted ? "إثبات الهاتف وتسجيل مفتاح المرور" : "إرسال رمز إثبات الهاتف"}
                </button>
                <button className="text-button" disabled={busy} type="button" onClick={reset}>العودة للدخول</button>
              </div>
            </form>
          )}
          {flow === "access" && error ? <p className="identity-error" role="alert">{error}</p> : null}
        </section>
      </main>
    </ControlShell>
  );
}
