"use client";

import type { ActorIdentity } from "@bthwani/identity";
import { Alert, Button, Flex, Typography } from "antd";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Group = Readonly<{ key: string; label: string; status: "ready" | "error"; items: ReadonlyArray<{ label: string; href: string }> }>;

function isSearchResponse(value: unknown): value is { groups: Group[] } {
  if (!value || typeof value !== "object" || !("groups" in value) || !Array.isArray(value.groups) || value.groups.length > 4) return false;
  return value.groups.every((group: Group) => group && typeof group.key === "string" && typeof group.label === "string" && ["ready", "error"].includes(group.status) && Array.isArray(group.items) && group.items.length <= 5 && group.items.every((item) => item && typeof item.label === "string" && typeof item.href === "string" && /^\/(operations\/|partners\/(stores|actors)\/|catalog\?mode=edit&productId=)/.test(item.href)));
}

export function WorkspaceRecordSearch({ query, identity, onNavigate }: Readonly<{ query: string; identity: ActorIdentity; onNavigate: () => void }>) {
  const [result, setResult] = useState<{ query: string; subject: string; groups: Group[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    setResult((current) => current && (current.query !== query || current.subject !== identity.subject) ? null : current);
    setError("");
    setBusy(false);
    return () => active.current?.abort();
  }, [query, identity.subject]);

  if (identity.role !== "operator" || !identity.permissions?.some((permission) => ["operations", "partners", "catalog"].includes(permission))) return null;

  async function search() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/workspace/search", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isSearchResponse(body)) throw new Error("تعذّر البحث في السجلات. أعد المحاولة.");
      if (!controller.signal.aborted) setResult({ query, subject: identity.subject, groups: body.groups });
    } catch {
      if (!controller.signal.aborted) setError("تعذّر البحث في السجلات. أعد المحاولة.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="workspace-record-search" aria-label="البحث في السجلات">
      <Flex vertical gap="small">
        <Button
          block
          loading={busy}
          onClick={() => void search()}
          disabled={query.trim().length < 2 || query.trim().length > 100}
        >
          {error ? "إعادة محاولة البحث في السجلات" : "بحث السجلات المصرّح بها"}
        </Button>
        {busy ? <Typography.Text role="status" type="secondary">جارٍ البحث في المصادر المصرّح بها…</Typography.Text> : null}
        {error ? <Alert type="error" showIcon message={error} /> : null}
        {result?.query === query && result.subject === identity.subject ? (
          <Flex vertical gap="middle">
            <Typography.Text type="secondary">حتى خمس نتائج لكل نوع؛ النص يبقى داخل هذه الجلسة.</Typography.Text>
            {result.groups.map((group) => (
              <section key={group.key} aria-label={group.label}>
                <Flex vertical gap="small">
                  <Typography.Title level={5}>{group.label}</Typography.Title>
                  {group.status === "error" ? (
                    <Alert type="warning" showIcon message={`تعذرت قراءة ${group.label}. أعد البحث للمحاولة.`} />
                  ) : group.items.length ? (
                    <Flex vertical gap="small">
                      {group.items.map((item) => (
                        <Link key={item.href} href={item.href} onClick={onNavigate}>
                          <bdi>{item.label}</bdi>
                        </Link>
                      ))}
                    </Flex>
                  ) : <Typography.Text type="secondary">لا نتائج مطابقة.</Typography.Text>}
                </Flex>
              </section>
            ))}
          </Flex>
        ) : null}
      </Flex>
    </section>
  );
}
