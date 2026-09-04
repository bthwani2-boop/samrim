"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createIdentityClient,
  type IdentityClientError,
  type IdentityRuntimeStatus,
} from "./identity-client.ts";
import { resolveIdentityApiBaseUrl } from "./identity-api-config.ts";

export type IdentityRuntimeStatusState =
  | { readonly kind: "checking"; readonly previous?: IdentityRuntimeStatus }
  | { readonly kind: "resolved"; readonly value: IdentityRuntimeStatus }
  | { readonly kind: "unavailable"; readonly code: string; readonly message: string };

const MIN_MANUAL_REFRESH_INTERVAL_MS = 1_000;

function clientFailure(error: unknown): { code: string; message: string } {
  const typed = error as Partial<IdentityClientError>;
  if (typed.kind === "http") {
    return {
      code: typeof typed.code === "string" ? typed.code : "IDENTITY_ERROR",
      message: typeof typed.message === "string" ? typed.message : "identity request failed",
    };
  }
  return {
    code: "IDENTITY_UNAVAILABLE",
    message: "identity runtime is unavailable",
  };
}

export function useIdentityRuntimeStatus(pollMs = 30_000) {
  const client = useMemo(() => createIdentityClient(resolveIdentityApiBaseUrl()), []);
  const [state, setState] = useState<IdentityRuntimeStatusState>({ kind: "checking" });
  const inFlight = useRef<Promise<void> | null>(null);
  const lastStartedAt = useRef(0);

  const refresh = useCallback((force = false): Promise<void> => {
    if (inFlight.current !== null) return inFlight.current;
    if (!force && Date.now() - lastStartedAt.current < MIN_MANUAL_REFRESH_INTERVAL_MS) {
      return Promise.resolve();
    }
    lastStartedAt.current = Date.now();
    setState((current) => current.kind === "resolved"
      ? { kind: "checking", previous: current.value }
      : { kind: "checking" });

    const request = client.readiness()
      .then((value) => {
        setState({ kind: "resolved", value });
      })
      .catch((error: unknown) => {
        const failure = clientFailure(error);
        setState({ kind: "unavailable", ...failure });
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = request;
    return request;
  }, [client]);

  useEffect(() => {
    void refresh(true);
    const interval = setInterval(() => void refresh(true), pollMs);
    return () => clearInterval(interval);
  }, [pollMs, refresh]);

  return { state, refresh };
}
