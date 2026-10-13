import type { JoiningCaseResponse, ServiceCity } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
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
    return () => { reloadSequence.current += 1; };
  }, [reload]);

  function update(value: JoiningCaseResponse) {
    // A canonical write/readback must outrank any older in-flight read.
    reloadSequence.current += 1;
    setState({ kind: "ready", value });
  }

  return { cities, citiesError, state, update, reload };
}
