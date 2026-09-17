import { useCallback, useEffect, useRef, useState } from "react";

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
  const [citiesError, setCitiesError] = useState(false);
  const reloadSequence = useRef(0);

  const reload = useCallback(async () => {
    const sequence = ++reloadSequence.current;
    setState({ kind: "loading" });
    setCitiesError(false);
    const [joiningCaseResult, citiesResult] = await Promise.allSettled([readOwnJoiningCase(), listActiveServiceCities()]);
    if (sequence !== reloadSequence.current) return;
    if (citiesResult.status === "fulfilled") setCities(citiesResult.value);
    else { setCities([]); setCitiesError(true); }
    if (joiningCaseResult.status === "fulfilled") setState({ kind: "ready", value: joiningCaseResult.value });
    else setState({ kind: isJoiningCaseNotFound(joiningCaseResult.reason) ? "empty" : "error" });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function update(value: JoiningCaseResponse) {
    setState({ kind: "ready", value });
  }

  return { cities, citiesError, state, update, reload };
}
