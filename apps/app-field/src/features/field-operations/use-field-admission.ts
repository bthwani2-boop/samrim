import { type FieldAdmission } from "@bthwani/dsh";
import { createContext, createElement, type PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from "react";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient, isMissingFieldAdmission } from "./field-client";

export type OwnFieldAdmissionState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "ready"; admission: FieldAdmission }>
  | Readonly<{ kind: "error" }>;

type OwnFieldAdmissionContextValue = Readonly<{
  state: OwnFieldAdmissionState;
  verification: "checking" | "verified" | "failed";
  refresh: () => Promise<void>;
}>;

const OwnFieldAdmissionContext = createContext<OwnFieldAdmissionContextValue | null>(null);

export function FieldAdmissionProvider({ children }: Readonly<PropsWithChildren>) {
  const [state, setState] = useState<OwnFieldAdmissionState>({ kind: "loading" });
  const [verification, setVerification] = useState<OwnFieldAdmissionContextValue["verification"]>("checking");
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    // Keep mounted forms intact while revalidating; the gate blocks interaction until readback.
    setVerification("checking");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().readOwnFieldAdmission(token);
      if (requestSequence.current === sequence) {
        setState({ kind: "ready", admission: response.admission });
        setVerification("verified");
      }
    } catch (cause) {
      if (requestSequence.current !== sequence) return;
      if (isMissingFieldAdmission(cause)) {
        setState({ kind: "missing" });
        setVerification("verified");
        return;
      }
      console.warn("DSH Field admission readback failed", cause);
      setState((current) => current.kind === "ready" ? current : { kind: "error" });
      setVerification("failed");
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { requestSequence.current += 1; };
  }, [refresh]);

  return createElement(OwnFieldAdmissionContext.Provider, { value: { state, verification, refresh } }, children);
}

export function useOwnFieldAdmission() {
  const value = useContext(OwnFieldAdmissionContext);
  if (!value) throw new Error("FIELD_ADMISSION_PROVIDER_REQUIRED");
  return value;
}
