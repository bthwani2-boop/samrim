"use client";

import type { ActorIdentity } from "@bthwani/identity";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Group = Readonly<{ key: string; label: string; status: "ready" | "error"; items: ReadonlyArray<{ label: string; href: string }> }>;
function isSearchResponse(value: unknown): value is { groups: Group[] } {
  if (!value || typeof value !== "object" || !("groups" in value) || !Array.isArray(value.groups) || value.groups.length > 4) return false;
  return value.groups.every((group: Group) => group && typeof group.key === "string" && typeof group.label === "string" && ["ready", "error"].includes(group.status) && Array.isArray(group.items) && group.items.length <= 5 && group.items.every((item) => item && typeof item.label === "string" && typeof item.href === "string" && /^\/(operations\/|partners\/(stores|actors)\/|catalog\?mode=edit&productId=)/.test(item.href)));
}

export function WorkspaceRecordSearch({ query, identity, onNavigate }: Readonly<{ query: string; identity: ActorIdentity; onNavigate: () => void }>) {
  const [result, setResult] = useState<{ query: string; groups: Group[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    setResult(null); setError(""); setBusy(false);
    return () => active.current?.abort();
  }, [query, identity.subject]);
  if (identity.role !== "operator" || !identity.permissions?.some((permission) => ["operations", "partners", "catalog"].includes(permission))) return null;

  async function search() {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/workspace/search", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: query.trim() }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
      const body: unknown = await response.json();
      if (!response.ok || !isSearchResponse(body)) throw new Error("تعذّر البحث في السجلات. أعد المحاولة.");
      if (!controller.signal.aborted) setResult({ query, groups: body.groups });
    } catch {
      if (!controller.signal.aborted) setError("تعذّر البحث في السجلات. أعد المحاولة.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <section className="workspace-record-search" aria-label="البحث في السجلات">
    <button type="button" className="button button-secondary" onClick={() => void search()} disabled={busy || query.trim().length < 2 || query.trim().length > 100}>{busy ? "جارٍ البحث…" : error ? "إعادة محاولة البحث في السجلات" : "بحث السجلات المصرّح بها"}</button>
    {busy ? <p role="status">جارٍ البحث في المصادر المصرّح بها…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {result?.query === query ? <>
      <p className="workspace-search-label">حتى خمس نتائج لكل نوع؛ النص يبقى داخل هذه الجلسة.</p>
      {result.groups.map((group) => <section key={group.key} aria-label={group.label}>
        <h3>{group.label}</h3>
        {group.status === "error" ? <p role="alert">تعذرت قراءة {group.label}. أعد البحث للمحاولة.</p> : group.items.length ? <ul>{group.items.map((item) => <li key={item.href}><Link href={item.href} onClick={onNavigate}><bdi>{item.label}</bdi></Link></li>)}</ul> : <p>لا نتائج مطابقة.</p>}
      </section>)}
    </> : null}
  </section>;
}
