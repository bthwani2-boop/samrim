"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkspaceEntry } from "../navigation/workspace-registry";
import { OperatorIcon } from "./operator-icon";
import styles from "./operator-shell.module.css";

export default function OperatorNavigationSearch({ entries }: Readonly<{ entries: readonly WorkspaceEntry[] }>) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
      } else if (event.key === "Escape" && document.activeElement === input.current) {
        setQuery("");
        input.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Search only current Identity-approved destinations; no private data lookup.
  const normalized = query.trim().toLocaleLowerCase("ar");
  const matches = normalized
    ? entries.filter(entry => entry.label.toLocaleLowerCase("ar").includes(normalized)).slice(0, 6)
    : [];

  return (
    <div className={styles.commandSearch}>
      <form aria-label="البحث في أقسام لوحة التحكم" className={styles.searchForm}
        onSubmit={event => {
          event.preventDefault();
          if (matches[0]) window.location.assign(matches[0].href);
        }}>
        <OperatorIcon name="search" />
        <input ref={input} type="search" value={query}
          aria-label="بحث عن قسم أو وظيفة مسموح بها" placeholder="ابحث في لوحة التحكم..."
          onChange={event => setQuery(event.target.value)} autoComplete="off" />
        <kbd>Ctrl K</kbd>
      </form>
      {normalized && (
        <div className={styles.searchResults} role="status">
          {matches.length > 0 ? (
            <nav aria-label="نتائج البحث في الأقسام">
              <ul>{matches.map(entry => <li key={entry.href}>
                <a href={entry.href}>{entry.label}<OperatorIcon name="arrow" /></a>
              </li>)}</ul>
            </nav>
          ) : <p>لا توجد أقسام مسموح بها تطابق البحث.</p>}
        </div>
      )}
    </div>
  );
}
