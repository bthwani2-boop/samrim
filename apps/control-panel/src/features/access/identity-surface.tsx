"use client";

import { toAsciiDigits } from "@bthwani/design-system";
import type { ActorIdentity, PasskeyOptions, WebAuthnJSON } from "@bthwani/identity";
import { Alert, Button, Input } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { identityFetch } from "../../session/identity-fetch";
import { useSession } from "../../session/session-provider";
import { ControlShell } from "../../shell/public-shell";
import { responseMessage } from "./identity-error-message";

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
  const developmentPasswordLoginEnabled = process.env.NEXT_PUBLIC_CONTROL_PANEL_DEVELOPMENT_LOGIN === "1";
  const [flow, setFlow] = useState<Flow>("access");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [code, setCode] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [challengeStarted, setChallengeStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recoveryCredential, setRecoveryCredential] = useState("");
  const [pendingIdentity, setPendingIdentity] = useState<ActorIdentity | null>(null);
  const flowPresentation = {
    access: {
      title: developmentPasswordLoginEnabled ? "الدخول بكلمة المرور" : "الدخول بمفتاح المرور",
    },
    enrollment: {
      title: "تفعيل بمفتاح مرور",
    },
    recovery: {
      title: "اطلب إعادة التسجيل",
    },
  }[flow];

  function reset() {
    setFlow("access");
    setPhone("");
    setPassword("");
    setToken("");
    setCode("");
    setRecoveryInput("");
    setChallengeStarted(false);
    setError("");
    setNotice("");
    setRecoveryCredential("");
    setPendingIdentity(null);
  }

  async function authenticateWithDevelopmentPassword() {
    setBusy(true);
    setError("");
    try {
      const response = await identityFetch("/api/auth/development/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "login"));
      const result = await response.json() as { identity?: ActorIdentity };
      if (!result.identity) throw new Error("تعذر فتح جلسة المشغّل المحلي.");
      setPassword("");
      authenticate(result.identity);
      router.replace("/workspace");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تسجيل الدخول المحلي.");
    } finally {
      setBusy(false);
    }
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

          <h1 id="recovery-credential-title">احفظ هذا الاعتماد الآن</h1>
          <p className="muted">يُعرض مرة واحدة؛ احفظه في مدير كلمات المرور.</p>
          <code className="code-output">{recoveryCredential}</code>
          <Button type="primary" onClick={() => { setRecoveryCredential(""); if (pendingIdentity) authenticate(pendingIdentity); setPendingIdentity(null); router.replace("/workspace"); }}>حفظت الاعتماد وفتح لوحة التحكم</Button>
        </section>
      ) : null}
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="identity-surface-title" hidden={Boolean(recoveryCredential)}>
          <div className="auth-card-header">


            <h1 id="identity-surface-title">{flowPresentation.title}</h1>

            {sessionState.kind === "signed_out" && sessionState.notice ? <div role="status"><Alert type="success" showIcon message={sessionState.notice} /></div> : null}
          </div>
          {flow === "access" && developmentPasswordLoginEnabled ? (
            <form className="form-section" onSubmit={(event) => { event.preventDefault(); void authenticateWithDevelopmentPassword(); }} noValidate>
              <label className="field-label" htmlFor="development-password">
                كلمة المرور
                <Input.Password id="development-password" autoComplete="current-password" disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              <div className="form-actions">
                <Button type="primary" htmlType="submit" loading={busy} disabled={!password}>دخول</Button>
              </div>
            </form>
          ) : null}
          {flow === "access" ? (
            <div className="form-actions">
              <Button type={developmentPasswordLoginEnabled ? "link" : "primary"} loading={busy} onClick={() => void authenticateWithPasskey()}>
                الدخول بمفتاح المرور
              </Button>
              <Button type="link" disabled={busy} onClick={() => { setFlow("enrollment"); setError(""); setNotice(""); }}>
                تفعيل حساب موظف
              </Button>
              <Button type="link" disabled={busy} onClick={() => { setFlow("recovery"); setError(""); setNotice(""); }}>
                استرداد الوصول
              </Button>
            </div>
          ) : null}
          {flow === "recovery" ? (
            <form className="form-section" onSubmit={(event) => { event.preventDefault(); if (challengeStarted) void beginRecoveryRegistration(); else void requestOperatorRecovery(); }} noValidate>
              <p className="security-note">اعتماد الاسترداد وإثبات الهاتف مطلوبان.</p>
              <label className="field-label" htmlFor="operator-recovery-phone">رقم الهاتف<Input id="operator-recovery-phone" autoComplete="tel" disabled={challengeStarted || busy} inputMode="tel" value={phone} onChange={(event) => setPhone(toAsciiDigits(event.target.value))} placeholder="مثال: 777 000 100 أو +967 777 000 100" /></label>
              <label className="field-label" htmlFor="operator-recovery-credential">اعتماد الاسترداد<Input.Password id="operator-recovery-credential" autoComplete="off" disabled={challengeStarted || busy} value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value.trim())} /></label>
              {challengeStarted ? <label className="field-label" htmlFor="operator-recovery-code">رمز إثبات الهاتف<Input id="operator-recovery-code" autoComplete="one-time-code" disabled={busy} inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(toAsciiDigits(event.target.value).replace(/\D/g, "").slice(0, 6))} /></label> : null}
              {error ? <div role="alert"><Alert type="error" showIcon message={error} /></div> : null}
              {notice ? <div role="status"><Alert type="success" showIcon message={notice} /></div> : null}
              <div className="form-actions">
                <Button type="primary" htmlType="submit" loading={busy} disabled={!phone.trim() || recoveryInput.trim().length < 24 || (challengeStarted && code.trim().length !== 6)}>
                  {challengeStarted ? "إثبات الهاتف وتسجيل مفتاح مرور بديل" : "إرسال رمز إثبات الهاتف"}
                </Button>
                <Button type="link" disabled={busy} onClick={reset}>العودة للدخول</Button>
              </div>
            </form>
          ) : null}
          {flow === "enrollment" ? (
            <form className="form-section" onSubmit={(event) => { event.preventDefault(); if (challengeStarted) void beginEnrollmentRegistration(); else void requestEnrollment(); }} noValidate>
              <label className="field-label" htmlFor="operator-phone">رقم الهاتف<Input id="operator-phone" autoComplete="tel" disabled={challengeStarted || busy} inputMode="tel" value={phone} onChange={(event) => setPhone(toAsciiDigits(event.target.value))} placeholder="مثال: 777 000 100 أو +967 777 000 100" /></label>
              <label className="field-label" htmlFor="operator-enrollment-token">دعوة التفعيل عالية الأمان<Input.Password id="operator-enrollment-token" autoComplete="off" disabled={challengeStarted || busy} maxLength={256} value={token} onChange={(event) => setToken(event.target.value.trim())} /></label>
              {challengeStarted ? <label className="field-label" htmlFor="operator-code">رمز إثبات الهاتف<Input id="operator-code" autoComplete="one-time-code" disabled={busy} inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(toAsciiDigits(event.target.value).replace(/\D/g, "").slice(0, 6))} /></label> : null}
              {error ? <div role="alert"><Alert type="error" showIcon message={error} /></div> : null}
              {notice ? <div role="status"><Alert type="success" showIcon message={notice} /></div> : null}
              <div className="form-actions">
                <Button type="primary" htmlType="submit" loading={busy} disabled={!phone.trim() || token.trim().length < 24 || (challengeStarted && code.trim().length !== 6)}>
                  {challengeStarted ? "إثبات الهاتف وتسجيل مفتاح المرور" : "إرسال رمز إثبات الهاتف"}
                </Button>
                <Button type="link" disabled={busy} onClick={reset}>العودة للدخول</Button>
              </div>
            </form>
          ) : null}
          {flow === "access" && error ? <div role="alert"><Alert type="error" showIcon message={error} /></div> : null}
        </section>
      </main>
    </ControlShell>
  );
}
