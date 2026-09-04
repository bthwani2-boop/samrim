"use client";

import { useEffect, useState } from "react";
import type { ActorIdentity } from "@bthwani/identity";

type ViewState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "signed_out" }>
  | Readonly<{ kind: "authenticated"; identity: ActorIdentity }>
  | Readonly<{ kind: "unavailable"; message: string }>;

async function responseMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: unknown };
  } | null;
  return typeof body?.error?.message === "string" ? body.error.message : "تعذر إكمال عملية الهوية.";
}

export default function Home() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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

  async function login() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      const body = (await response.json()) as { identity: ActorIdentity };
      setPassword("");
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
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      setView({ kind: "signed_out" });
    } catch {
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
          <p>جلسة المشغل موثقة.</p>
          <dl>
            <div><dt>Actor</dt><dd>{view.identity.subject}</dd></div>
            <div><dt>Surface</dt><dd>{view.identity.sessionSurface}</dd></div>
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
        <p>تسجيل دخول المشغل</p>
        <label>
          اسم المستخدم
          <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          كلمة المرور
          <input
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="identity-error">{error}</p> : null}
        <button disabled={busy || !username.trim() || password.length < 12} onClick={login}>
          {busy ? "جارٍ التحقق…" : "تسجيل الدخول"}
        </button>
      </section>
    </main>
  );
}
