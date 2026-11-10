"use client";

import type { ActorIdentity } from "@bthwani/identity";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { responseMessage } from "../features/access/identity-error-message";
import { identityFetch } from "./identity-fetch";

export type SessionState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "signed_out"; notice?: string }>
  | Readonly<{ kind: "authenticated"; identity: ActorIdentity }>
  | Readonly<{ kind: "unavailable"; message: string }>;

type SessionContextValue = Readonly<{
  state: SessionState;
  busy: boolean;
  restore: () => Promise<void>;
  authenticate: (identity: ActorIdentity) => void;
  logout: () => Promise<void>;
}>;

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, setState] = useState<SessionState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  // A later authentication decision always supersedes an earlier in-flight read.
  const sessionEpoch = useRef(0);

  const restore = useCallback(async () => {
    const epoch = ++sessionEpoch.current;
    const current = () => epoch === sessionEpoch.current;
    setBusy(true);
    setState({ kind: "loading" });
    try {
      const response = await identityFetch("/api/auth/session", { cache: "no-store" });
      if (!current()) return;
      if (response.status === 401) {
        setState({ kind: "signed_out" });
        return;
      }
      if (!response.ok) {
        const body = response.status === 409
          ? (await response.clone().json().catch(() => null)) as { error?: { code?: unknown } } | null
          : null;
        if (!current()) return;
        if (body?.error?.code === "CONFLICT") {
          setState({ kind: "signed_out", notice: "حساب المشغل غير جاهز لإنشاء جلسة آمنة. استخدم مفتاح المرور إن كان مفعّلًا، أو أكمل التفعيل أو الاسترداد المصرّح به." });
          return;
        }
        const message = await responseMessage(response);
        if (current()) setState({ kind: "unavailable", message });
        return;
      }
      const body = (await response.json()) as { identity?: ActorIdentity };
      if (!current()) return;
      if (!body.identity) {
        setState({ kind: "unavailable", message: "تعذر قراءة جلسة الهوية بعد التحقق." });
        return;
      }
      setState({ kind: "authenticated", identity: body.identity });
    } catch {
      if (current()) setState({ kind: "unavailable", message: "تعذر الوصول إلى خدمة الهوية. تحقق من تشغيل الخدمة ثم أعد المحاولة." });
    } finally {
      if (current()) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  const authenticate = useCallback((identity: ActorIdentity) => {
    sessionEpoch.current += 1;
    setBusy(false);
    setState({ kind: "authenticated", identity });
  }, []);

  const logout = useCallback(async () => {
    const epoch = ++sessionEpoch.current;
    setBusy(true);
    // Discard privileged UI immediately; do not expose login until old-cookie revocation returns.
    setState({ kind: "loading" });
    let remoteRevocationConfirmed = true;
    try {
      const response = await identityFetch("/api/auth/logout", { method: "POST" });
      remoteRevocationConfirmed = response.ok;
    } catch {
      remoteRevocationConfirmed = false;
    } finally {
      if (epoch === sessionEpoch.current) {
        setState(
          remoteRevocationConfirmed
            ? { kind: "signed_out" }
            : { kind: "signed_out", notice: "تم تسجيل الخروج من هذا الجهاز، لكن تعذر تأكيد إبطال الجلسة على الخادم." },
        );
        setBusy(false);
      }
    }
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ state, busy, restore, authenticate, logout }),
    [state, busy, restore, authenticate, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
