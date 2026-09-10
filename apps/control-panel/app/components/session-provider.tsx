"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ActorIdentity } from "@bthwani/identity";
import { identityFetch, responseMessage } from "./identity-client";

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

  const restore = useCallback(async () => {
    setBusy(true);
    setState({ kind: "loading" });
    try {
      const response = await identityFetch("/api/auth/session", { cache: "no-store" });
      if (response.status === 401) {
        setState({ kind: "signed_out" });
        return;
      }
      if (!response.ok) {
        setState({ kind: "unavailable", message: await responseMessage(response) });
        return;
      }
      const body = (await response.json()) as { identity?: ActorIdentity };
      if (!body.identity) {
        setState({ kind: "unavailable", message: "تعذر قراءة جلسة الهوية بعد التحقق." });
        return;
      }
      setState({ kind: "authenticated", identity: body.identity });
    } catch {
      setState({ kind: "unavailable", message: "تعذر الوصول إلى خدمة الهوية. تحقق من تشغيل الخدمة ثم أعد المحاولة." });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  const authenticate = useCallback((identity: ActorIdentity) => {
    setState({ kind: "authenticated", identity });
  }, []);

  const logout = useCallback(async () => {
    setBusy(true);
    let remoteRevocationConfirmed = true;
    try {
      const response = await identityFetch("/api/auth/logout", { method: "POST" });
      remoteRevocationConfirmed = response.ok;
    } catch {
      remoteRevocationConfirmed = false;
    } finally {
      setState(
        remoteRevocationConfirmed
          ? { kind: "signed_out" }
          : { kind: "signed_out", notice: "تم تسجيل الخروج من هذا الجهاز، لكن تعذر تأكيد إبطال الجلسة على الخادم." },
      );
      setBusy(false);
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
