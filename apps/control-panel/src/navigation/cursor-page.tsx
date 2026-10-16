"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

type Position = Readonly<{ cursor: string; previous: ReadonlyArray<string> }>;

// Identity cursors can encode personal facts. Keep them and private filters in tab state.
export function useCursorPage(parameter: string, filterKey = "", privateCursor: boolean | "mixed" = false, restoreFilters?: (key: string) => void) {
  const [position, setPosition] = useState<Position>({ cursor: "", previous: [] });
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState(filterKey);
  const historyKey = `registry:${parameter}`;
  const initialFilters = useRef(filterKey);
  const restoringHistory = useRef(false);
  const restoreSavedFilters = useEffectEvent((key: string) => restoreFilters?.(key));

  useEffect(() => {
    const sync = (event?: PopStateEvent) => {
      if (event) restoringHistory.current = true;
      const state = event ? event.state : window.history.state;
      const saved = state?.[historyKey];
      const previous = Array.isArray(saved?.previous) && saved.previous.every((value: unknown) => typeof value === "string") ? saved.previous : [];
      const marker = new URLSearchParams(window.location.search).get(parameter) ?? "";
      const protectedMarker = privateCursor === true || (privateCursor === "mixed" && /^page-\d+$/.test(marker));
      const cursor = protectedMarker ? (marker === `page-${previous.length + 1}` && typeof saved?.cursor === "string" ? saved.cursor : "") : marker;
      const restoredFilters = typeof saved?.filterKey === "string" ? saved.filterKey : initialFilters.current;
      setFilters(restoredFilters);
      if (privateCursor) {
        restoreSavedFilters(restoredFilters);
        const url = new URL(window.location.href);
        if (!cursor) url.searchParams.delete(parameter);
        window.history.replaceState({ ...state, [historyKey]: { cursor, previous: cursor ? previous : [], filterKey: restoredFilters } }, "", `${url.pathname}${url.search}${url.hash}`);
      }
      setPosition({ cursor, previous: cursor ? previous : [] });
      setReady(true);
    };
    sync();
    window.addEventListener("popstate", sync, true);
    return () => window.removeEventListener("popstate", sync, true);
  // Filter restoration callbacks are mount/event readers, not resubscription triggers.
  }, [historyKey, parameter, privateCursor]);

  const navigate = useCallback((cursor: string, previous: ReadonlyArray<string>, replace = false) => {
    const url = new URL(window.location.href);
    const protectedCursor = privateCursor === true || (privateCursor === "mixed" && cursor.startsWith("p1."));
    if (cursor) url.searchParams.set(parameter, protectedCursor ? `page-${previous.length + 1}` : cursor); else url.searchParams.delete(parameter);
    const state = { ...window.history.state, [historyKey]: { cursor, previous, filterKey } };
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (replace) window.history.replaceState(state, "", path); else window.history.pushState(state, "", path);
    setPosition({ cursor, previous });
  }, [filterKey, historyKey, parameter, privateCursor]);

  const filtersChanged = filters !== filterKey;
  const cursor = filtersChanged ? "" : position.cursor;
  const previous = filtersChanged ? [] : position.previous;
  const reset = useCallback(() => navigate("", [], true), [navigate]);
  const clearForNavigation = useCallback(() => setPosition({ cursor: "", previous: [] }), []);
  useEffect(() => {
    if (!restoringHistory.current) return;
    if (filters === filterKey) restoringHistory.current = false;
  }, [filterKey, filters]);
  useEffect(() => {
    if (restoringHistory.current) return;
    if (!filtersChanged) return;
    if (privateCursor === true) {
      const marker = new URLSearchParams(window.location.search).get(parameter);
      const savedFilterKey = window.history.state?.[historyKey]?.filterKey;
      if (marker && savedFilterKey === filterKey) return;
    }
    if (privateCursor !== true) {
      // Filter links already drop public cursors. Never erase a restored Back entry.
      if (new URLSearchParams(window.location.search).has(parameter)) return;
      setPosition({ cursor: "", previous: [] });
      setFilters(filterKey);
      return;
    }
    navigate("", [], true);
    setFilters(filterKey);
  }, [filterKey, filtersChanged, historyKey, navigate, parameter, privateCursor]);
  return {
    cursor, clearForNavigation, ready, canPrevious: Boolean(cursor) || previous.length > 0,
    previousLabel: previous.length > 0 ? "السابق" : "الأولى",
    reset,
    next: (nextCursor: string) => navigate(nextCursor, [...previous, cursor]),
    previous: () => navigate(previous.at(-1) ?? "", previous.slice(0, -1)),
  };
}

export function CursorPagination({ page, nextCursor, disabled, label }: Readonly<{
  page: ReturnType<typeof useCursorPage>; nextCursor: string; disabled: boolean; label: string;
}>) {
  if (!page.canPrevious && !nextCursor) return null;
  return <nav className="pagination" aria-label={label}>
    <button className="button button-secondary" type="button" disabled={disabled || !page.canPrevious} onClick={page.previous}>{page.previousLabel}</button>
    <button className="button button-secondary" type="button" disabled={disabled || !nextCursor} onClick={() => page.next(nextCursor)}>التالي</button>
  </nav>;
}
