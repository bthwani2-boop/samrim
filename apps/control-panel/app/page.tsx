"use client";

import { useEffect, useState } from "react";
import type { ActorIdentity } from "@bthwani/identity";

type ViewState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "signed_out" }>
  | Readonly<{ kind: "authenticated"; identity: ActorIdentity }>
  | Readonly<{ kind: "unavailable"; message: string }>;

async function responseMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: unknown } } | null;
  return typeof body?.error?.message === "string" ? body.error.message : "تعذر إكمال عملية الهوية.";
}

export default function Home() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeStarted, setChallengeStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function restore() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
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
      setView({ kind: "unavailable", message: "خدمة الهوية غير متاحة." });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void restore();
  }, []);

  async function startLogin() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      setPassword("");
      setChallengeStarted(true);
    } catch {
      setError("تعذر الوصول إلى خدمة الهوية.");
    } finally {
      setBusy(false);
    }
  }

  async function completeLogin() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      const body = (await response.json()) as { identity: ActorIdentity };
      setCode("");
      setChallengeStarted(false);
      setView({ kind: "authenticated", identity: body.identity });
    } catch {
      setError("تعذر الوصول إلى خدمة الهوية.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
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

  if (view.kind === "loading") {
    return <main><section className="identity-card"><h1>بثواني</h1><p>جارٍ التحقق من الجلسة الحية…</p></section></main>;
  }

  if (view.kind === "unavailable") {
    return (
      <main>
        <section className="identity-card">
          <h1>بثواني</h1>
          <p>{view.message}</p>
          <button disabled={busy} onClick={restore}>إعادة المحاولة</button>
        </section>
      </main>
    );
  }

  if (view.kind === "authenticated") {
    return (
      <main>
        <section className="identity-card">
          <h1>لوحة تحكم بثواني</h1>
          <p>جلسة المشغل موثقة بعاملين.</p>
          <dl>
            <div><dt>Actor</dt><dd>{view.identity.subject}</dd></div>
            <div><dt>Role</dt><dd>{view.identity.role}</dd></div>
            <div><dt>Surface</dt><dd>{view.identity.surface}</dd></div>
          </dl>
          {error ? <p className="identity-error">{error}</p> : null}
          <button disabled={busy} onClick={logout}>{busy ? "جارٍ التنفيذ…" : "تسجيل الخروج"}</button>
        </section>
      </main>
    );
  }

  return (
    <main>
      <section className="identity-card">
        <h1>لوحة تحكم بثواني</h1>
        <p>{challengeStarted ? "أدخل رمز التحقق الثاني" : "تسجيل دخول المشغل"}</p>
        <label>
          رقم الهاتف
          <input
            autoComplete="tel"
            disabled={challengeStarted}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>
        {challengeStarted ? (
          <label>
            رمز التحقق
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
        ) : (
          <label>
            كلمة المرور
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}
        {error ? <p className="identity-error">{error}</p> : null}
        {challengeStarted ? (
          <>
            <button disabled={busy || code.trim().length !== 6} onClick={completeLogin}>
              {busy ? "جارٍ التحقق…" : "إكمال تسجيل الدخول"}
            </button>
            <button disabled={busy} onClick={() => { setChallengeStarted(false); setCode(""); setError(""); }}>
              العودة
            </button>
          </>
        ) : (
          <button disabled={busy || !phone.trim() || password.length < 12} onClick={startLogin}>
            {busy ? "جارٍ التحقق…" : "متابعة"}
          </button>
        )}
      </section>
    </main>
  );
}
