import { useCallback, useEffect, useRef, useState } from "react";

import type { PartnerAccessibleStore } from "@bthwani/dsh";
import { listPartnerAccessibleStores } from "./store-readback-client";

type StoreScopesState = { kind: "loading" } | { kind: "ready"; stores: ReadonlyArray<PartnerAccessibleStore> } | { kind: "error" };

export function usePartnerAccessibleStoreScopes() {
  const [state, setState] = useState<StoreScopesState>({ kind: "loading" });
  const sequence = useRef(0);

  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setState({ kind: "loading" });
    try {
      const stores: PartnerAccessibleStore[] = [];
      let cursor = "";
      do {
        const page = await listPartnerAccessibleStores(cursor);
        if (sequence.current !== current) return;
        stores.push(...page.stores);
        cursor = page.nextCursor;
      } while (cursor);
      setState({ kind: "ready", stores });
    } catch {
      if (sequence.current === current) setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => { sequence.current += 1; };
  }, [reload]);

  return { state, reload };
}
