import { useEffect, useState } from "react";

import { type JoiningCaseResponse, type ServiceCity } from "@bthwani/dsh";
import { isJoiningCaseNotFound, listActiveServiceCities, readOwnJoiningCase } from "./store-readback-client";

export type PartnerStoreContextState =
  | { kind: "loading" }
  | { kind: "ready"; value: JoiningCaseResponse }
  | { kind: "empty" }
  | { kind: "error" };

export function usePartnerStoreContext() {
  const [state, setState] = useState<PartnerStoreContextState>({ kind: "loading" });
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);

  useEffect(() => {
    let active = true;
    void readOwnJoiningCase().then(
      (value) => { if (active) setState({ kind: "ready", value }); },
      (error) => { if (active) setState({ kind: isJoiningCaseNotFound(error) ? "empty" : "error" }); },
    );
    void listActiveServiceCities().then(
      (value) => { if (active) setCities(value); },
      () => { if (active) setCities([]); },
    );
    return () => { active = false; };
  }, []);

  function update(value: JoiningCaseResponse) {
    setState({ kind: "ready", value });
  }

  return { cities, state, update };
}
