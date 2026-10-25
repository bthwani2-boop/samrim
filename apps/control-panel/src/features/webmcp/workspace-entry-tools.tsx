"use client";

import type { ActorIdentity } from "@bthwani/identity";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { allowedWorkspaceEntries, canDraftWorkspaceFields } from "./workspace-entry-access";
import "./workspace-entry-tools.css";

type AgentTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; consequentialHint?: boolean; untrustedContentHint: boolean };
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};
type ModelContext = { registerTool: (tool: AgentTool, options: { signal: AbortSignal }) => void | Promise<void> };
type InputField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type FieldInfo = Readonly<{
  index: number;
  label: string;
  kind: string;
  required: boolean;
  editable: boolean;
  signature: string;
  element: InputField;
}>;
type ProposedField = Readonly<{ index: number; label: string; value: string; signature: string }>;
type Proposal = Readonly<{ path: string; fields: ProposedField[] }>;

const exposedInputs = new Set(["text", "number", "email", "tel", "url", "date", "time", "search"]);
const draftTypes = new Set(["text", "number", "email", "tel", "url", "date", "time", "textarea"]);
const sensitive = /(?:password|secret|token|passkey|session|otp|pin|cvv|cvc|credit.?card|bank|iban|access.?key|api.?key)/i;

function visible(element: Element): boolean {
  return element.getClientRects().length > 0 && !element.closest("[hidden], [aria-hidden='true'], [inert]");
}

function labelFor(element: InputField): string {
  const text = element.getAttribute("aria-label")
    || (element.labels?.[0]?.textContent ?? "").trim()
    || element.getAttribute("placeholder")
    || element.getAttribute("name")
    || element.id
    || "";
  return text.trim().slice(0, 120);
}

function currentFields(pathname: string): FieldInfo[] {
  const root = document.getElementById("workspace-main");
  if (!root) return [];
  const fields: FieldInfo[] = [];
  for (const element of root.querySelectorAll("input, textarea, select")) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue;
    if (!visible(element)) continue;
    const kind = element instanceof HTMLInputElement ? element.type.toLowerCase()
      : element instanceof HTMLSelectElement ? "select" : "textarea";
    if (element instanceof HTMLInputElement && !exposedInputs.has(kind)) continue;
    const label = labelFor(element);
    if (!label || sensitive.test([label, element.id, element.name, element.getAttribute("autocomplete") ?? ""].join(" "))) continue;
    const editable = canDraftWorkspaceFields(pathname) && draftTypes.has(kind)
      && !element.disabled && !(element instanceof HTMLSelectElement) && !element.readOnly
      && element.getAttribute("aria-readonly") !== "true";
    const index = fields.length;
    const signature = [element.tagName, kind, element.id, element.name, label].join("|");
    fields.push({ index, label, kind, required: element.required, editable, signature, element });
    if (fields.length >= 80) break;
  }
  return fields;
}

function applyValue(field: InputField, value: string) {
  if (field instanceof HTMLSelectElement) throw new Error("Selectors require the existing page workflow.");
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) throw new Error("This input cannot be updated safely.");
  setter.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function toolResult(execute: AgentTool["execute"]): AgentTool["execute"] {
  return async args => {
    try { return { ok: true, result: await execute(args) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Tool execution failed." }; }
  };
}

/** Agent can discover ALL authorized workspaces and prepare safe text drafts.
 *  No generic API writes, save/submit clicks, credentials or privileged policy edits. */
export function WorkspaceEntryWebMCPTools({ identity }: Readonly<{ identity: ActorIdentity }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const proposalRef = useRef<Proposal | null>(null);
  const [message, setMessage] = useState("");
  const cancelButton = useRef<HTMLButtonElement>(null);
  const applyButton = useRef<HTMLButtonElement>(null);
  const enabled = identity.role === "operator";
  const entries = useMemo(() => allowedWorkspaceEntries(identity), [identity]);

  useEffect(() => {
    if (!pathname || !identity.subject) return;
    proposalRef.current = null;
    setProposal(null);
    setMessage("");
  }, [pathname, identity.subject]);
  useEffect(() => {
    if (!proposal) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButton.current?.focus();
    return () => previous?.focus();
  }, [proposal]);

  useEffect(() => {
    if (!enabled) return;
    const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!modelContext?.registerTool) return;
    const controller = new AbortController();

    const tools: AgentTool[] = [
      {
        name: "bthwani_list_workspace_entries",
        description: "Find allowed operator workspace pages across operations, partners, catalogs, marketing, finance, policies, people and access. Returns exact internal paths and names; never reveals data or creates records.",
        inputSchema: {
          type: "object", properties: { query: { type: "string", maxLength: 100, description: "Optional text filter in Arabic or English." } },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: toolResult(async args => {
          if (args.query !== undefined && typeof args.query !== "string") throw new Error("Invalid search text.");
          const query = (args.query as string | undefined ?? "").trim().toLocaleLowerCase("ar");
          if (query.length > 100) throw new Error("Search too long.");
          const matches = entries.filter(item => !query || [item.href, item.label, item.context].join(" ").toLocaleLowerCase("ar").includes(query));
          return { entries: matches.slice(0, 40), total: matches.length, limited: matches.length > 40 };
        }),
      },
      {
        name: "bthwani_open_workspace_entry",
        description: "Navigate to a precise, authorized control panel entry returned by bthwani_list_workspace_entries. No arbitrary URLs or API calls. Saves on the current page must be completed before navigation.",
        inputSchema: {
          type: "object", properties: { href: { type: "string", minLength: 1, maxLength: 220 } },
          required: ["href"], additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: toolResult(async args => {
          const found = entries.find(entry => entry.href === args.href);
          if (!found) throw new Error("Unknown or unauthorized entry.");
          if (proposalRef.current) throw new Error("Finish or discard the pending draft first.");
          router.push(found.href);
          return { navigationRequested: true, path: found.href, label: found.label };
        }),
      },
      {
        name: "bthwani_list_current_entry_fields",
        description: "Discover labels and kinds of visible fields on the current control panel screen for guided data entry. Returns no field values, credentials or hidden fields. Does not change any data.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: toolResult(async () => ({
          path: pathname,
          fields: currentFields(pathname).map(({ index, label, kind, required, editable }) => ({ index, label, kind, required, editable })),
          draftAvailable: canDraftWorkspaceFields(pathname),
          note: "Agents cannot save or submit forms. Editable draft fields require explicit user review on the page. Other fields use their normal workflow.",
        })),
      },
      {
        name: "bthwani_prepare_entry_draft",
        description: "Stage several visible TEXT field values for explicit human review on this page. Does not update fields or save data. User must press Apply in the visible review dialog; no automatic form submission. Financial, operations, HR, access and policy pages are not eligible for generic drafts.",
        inputSchema: {
          type: "object",
          properties: {
            fields: {
              type: "array", minItems: 1, maxItems: 30,
              items: {
                type: "object", properties: {
                  index: { type: "integer", minimum: 0, maximum: 79 },
                  value: { type: "string", maxLength: 4000 },
                },
                required: ["index", "value"], additionalProperties: false,
              },
            },
          },
          required: ["fields"], additionalProperties: false,
        },
        annotations: { readOnlyHint: false, consequentialHint: true, untrustedContentHint: true },
        execute: toolResult(async args => {
          if (!canDraftWorkspaceFields(pathname)) throw new Error("This page requires its own controlled editor.");
          if (proposalRef.current) throw new Error("An entry draft is awaiting review.");
          if (!Array.isArray(args.fields) || args.fields.length < 1 || args.fields.length > 30) throw new Error("Provide 1–30 field values.");
          const allowed = currentFields(pathname);
          const used = new Set<number>();
          const pending: ProposedField[] = [];
          for (const row of args.fields) {
            if (!row || typeof row !== "object") throw new Error("Invalid field.");
            const input = row as { index?: unknown; value?: unknown };
            if (!Number.isInteger(input.index) || typeof input.value !== "string") throw new Error("Each field needs an index and text value.");
            const index = input.index as number;
            if (used.has(index)) throw new Error("Duplicate field index.");
            used.add(index);
            const found = allowed[index];
            if (!found?.editable) throw new Error("Field " + index + " is not eligible.");
            if (input.value.length > (!(found.element instanceof HTMLSelectElement) && found.element.maxLength >= 0 ? found.element.maxLength : found.kind === "textarea" ? 4000 : 500)) {
              throw new Error("Value exceeds the field limit: " + found.label);
            }
            if (found.kind === "number" && input.value.trim() && !Number.isFinite(Number(input.value))) {
              throw new Error("Invalid numeric value: " + found.label);
            }
            pending.push({ index, label: found.label, value: input.value, signature: found.signature });
          }
          if (pending.reduce((sum, field) => sum + field.value.length, 0) > 8000) throw new Error("Draft content is too large.");
          const staged = { path: pathname, fields: pending };
          proposalRef.current = staged;
          setProposal(staged);
          setMessage("");
          return { status: "awaiting_user_review", path: pathname, fields: pending.map(({ index, label }) => ({ index, label })), saved: false };
        }),
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(modelContext.registerTool(tool, { signal: controller.signal }))
          .catch((error: unknown) => console.warn("WebMCP registration failed:", tool.name, error));
      } catch (error) { console.warn("WebMCP registration failed:", tool.name, error); }
    }
    return () => controller.abort();
  }, [enabled, pathname, entries, router]);

  function approveDraft() {
    if (!proposal || proposal.path !== pathname) { proposalRef.current = null; setProposal(null); return; }
    const fields = currentFields(pathname);
    for (const proposed of proposal.fields) {
      const field = fields[proposed.index];
      if (!field?.editable || field.signature !== proposed.signature) {
        setMessage("تغيّرت الحقول. أغلق المعاينة واطلب إعداد المسودة مجددًا.");
        return;
      }
    }
    try {
      for (const proposed of proposal.fields) applyValue(fields[proposed.index]!.element, proposed.value);
      proposalRef.current = null;
      setProposal(null);
      setMessage("");
    } catch {
      setMessage("تعذّر تطبيق الحقول. راجع القيم الظاهرة في الصفحة.");
    }
  }

  if (!proposal) return null;
  return (
    <div className="webmcp-review-backdrop">
      <section role="dialog" aria-modal="true" aria-labelledby="webmcp-review-title" className="webmcp-review-panel" onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); proposalRef.current = null; setProposal(null); setMessage(""); }
        if (event.key === "Tab") { event.preventDefault(); (document.activeElement === cancelButton.current ? applyButton.current : cancelButton.current)?.focus(); }
      }}>
        <h2 id="webmcp-review-title">مراجعة حقول الإدخال</h2>
        <p>لن تُحفظ البيانات تلقائيًا من الأداة. اضغط تطبيق الحقول لتعبئة هذه الشاشة، ثم راجعها واحفظها بالطريقة المعتادة. بعض الحقول قد تتفاعل عند تغيير قيمتها.</p>
        <ul>{proposal.fields.map(item => <li key={item.index}><strong>{item.label}</strong><span dir="auto">{item.value}</span></li>)}</ul>
        {message ? <p role="alert">{message}</p> : null}
        <div className="webmcp-review-actions">
          <button ref={cancelButton} className="button button-secondary" type="button" onClick={() => { proposalRef.current = null; setProposal(null); setMessage(""); }}>إلغاء</button>
          <button ref={applyButton} className="button button-primary" type="button" onClick={approveDraft}>تطبيق الحقول</button>
        </div>
      </section>
    </div>
  );
}
