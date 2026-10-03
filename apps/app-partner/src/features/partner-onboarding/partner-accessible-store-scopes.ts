import { useCallback, useEffect, useRef, useState } from "react";

import type { PartnerAccessibleStore } from "@bthwani/dsh";
import { listPartnerAccessibleStores } from "./store-readback-client";

type StoreScopesState = { kind: "loading" } | { kind: "ready"; stores: ReadonlyArray<PartnerAccessibleStore>; nextCursor: string } | { kind: "error" };

export function usePartnerAccessibleStoreScopes() {
  const [state, setState] = useState<StoreScopesState>({ kind: "loading" });
  const sequence = useRef(0);

  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setState({ kind: "loading" });
    try {
      const page = await listPartnerAccessibleStores();
      if (sequence.current === current) setState({ kind: "ready", stores: page.stores, nextCursor: page.nextCursor });
    } catch {
      if (sequence.current === current) setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => { sequence.current += 1; };
  }, [reload]);

  const loadMore = useCallback(async () => {
    if (state.kind !== "ready" || !state.nextCursor) return;
    const current = ++sequence.current;
    const previous = state;
    try {
      const page = await listPartnerAccessibleStores(previous.nextCursor);
      if (sequence.current === current) setState({ kind: "ready", stores: [...previous.stores, ...page.stores], nextCursor: page.nextCursor });
    } catch {
      if (sequence.current === current) setState(previous);
    }
  }, [state]);

  return { state, reload, loadMore };
}
