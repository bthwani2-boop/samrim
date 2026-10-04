import { type FieldAdmission } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient, isMissingFieldAdmission } from "./field-client";

export type OwnFieldAdmissionState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "ready"; admission: FieldAdmission }>
  | Readonly<{ kind: "error" }>;

export function useOwnFieldAdmission() {
  const [state, setState] = useState<OwnFieldAdmissionState>({ kind: "loading" });
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setState({ kind: "loading" });
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().readOwnFieldAdmission(token);
      if (requestSequence.current === sequence) setState({ kind: "ready", admission: response.admission });
    } catch (cause) {
      if (isMissingFieldAdmission(cause)) {
        if (requestSequence.current === sequence) setState({ kind: "missing" });
        return;
      }
      console.warn("DSH Field admission readback failed", cause);
      if (requestSequence.current === sequence) setState({ kind: "error" });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => () => { requestSequence.current += 1; }, []);

  return { state, refresh } as const;
}
