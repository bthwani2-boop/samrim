"use client";

import { useEffect } from "react";
import { buildStoreImportCsv, summarizeStoreImport } from "./store-import-data";

type ToolInput = Record<string, unknown>;
type ExecutionContext = { signal?: AbortSignal };
type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; consequentialHint?: boolean; untrustedContentHint: boolean };
  execute: (args: ToolInput, context?: ExecutionContext) => Promise<unknown>;
};
type ModelContext = { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> };
type ImportResponse = Parameters<typeof summarizeStoreImport>[0];

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unexpected server response.");
  return value as Record<string, unknown>;
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const result = record(await response.json().catch(() => ({})));
  if (!response.ok) {
    const detail = result.error && typeof result.error === "object" ? (result.error as { message?: unknown }).message : "";
    throw new Error(typeof detail === "string" && detail ? detail : "HTTP " + response.status);
  }
  return result;
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[\w-]{8,128}$/.test(value)) {
    throw new Error("Invalid " + label + ".");
  }
  return value;
}

function protectedTool(
  execute: (args: ToolInput, context?: ExecutionContext) => Promise<unknown>,
): Tool["execute"] {
  return async (args, context) => {
    try {
      return { ok: true, result: await execute(args, context) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "The request could not be completed." };
    }
  };
}

/** Optional site tools: API ownership, session enforcement, CSRF and idempotency stay on existing BFF/DSH routes. */
export function StoreCatalogWebMCPTools({ enabled }: Readonly<{ enabled: boolean }>) {
  useEffect(() => {
    if (!enabled) return;
    const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!modelContext?.registerTool) return;
    const controller = new AbortController();
    const commitKeys = new Map<string, string>();

    const tools: Tool[] = [
      {
        name: "bthwani_find_stores",
        description: "Find up to 25 authorized stores by Arabic or English name before selecting an exact store ID for an import. Read only.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", minLength: 1, maxLength: 128 },
          },
          required: ["query"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: protectedTool(async (args, context) => {
          if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 128) {
            throw new Error("Search text must be 1–128 characters.");
          }
          const params = new URLSearchParams({ q: args.query.trim(), limit: "25" });
          const data = await readResponse(await fetch("/api/catalog/stores?" + params, { cache: "no-store", signal: context?.signal ?? null }));
          const stores = Array.isArray(data.stores) ? data.stores : [];
          return { stores: stores.map((value: unknown) => {
            const store = record(value);
            return { id: store.id, name: store.name };
          }), nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : "" };
        }),
      },
      {
        name: "bthwani_preview_store_products",
        description: "Validate and preview up to 5000 store products/prices without applying them. Provide the exact store ID and products (name or barcode, integer priceYER, optional unit and variant). Returns import run ID and conflicts for review. No offers are published or committed by this tool.",
        inputSchema: {
          type: "object",
          properties: {
            storeId: { type: "string", minLength: 8, maxLength: 128 },
            rows: {
              type: "array", minItems: 1, maxItems: 5000,
              items: {
                type: "object",
                properties: {
                  name: { type: "string", maxLength: 160 },
                  barcode: { type: "string", maxLength: 128 },
                  priceYER: { type: "integer", minimum: 1 },
                  unit: { type: "string", enum: ["COUNT", "GRAM", "MILLILITER"] },
                  variant: { type: "string", maxLength: 160 },
                },
                required: ["priceYER"],
                additionalProperties: false,
              },
            },
          },
          required: ["storeId", "rows"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: protectedTool(async (args, context) => {
          const storeId = requiredId(args.storeId, "store ID");
          const csv = buildStoreImportCsv(args.rows);
          const form = new FormData();
          form.set("storeId", storeId);
          form.set("file", new File([csv], "webmcp-store-products.csv", { type: "text/csv;charset=utf-8" }));
          const data = await readResponse(await fetch("/api/catalog/store-imports/preview", {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID(), "X-Correlation-ID": crypto.randomUUID() },
            body: form,
            signal: context?.signal ?? null,
          }));
          return summarizeStoreImport(data as unknown as ImportResponse);
        }),
      },
      {
        name: "bthwani_read_store_import",
        description: "Check current persisted state, row classifications and errors for a previously previewed store import. Read only.",
        inputSchema: {
          type: "object",
          properties: { runId: { type: "string", minLength: 8, maxLength: 128 } },
          required: ["runId"], additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: protectedTool(async (args, context) => {
          const runId = requiredId(args.runId, "import run ID");
          const result = await readResponse(await fetch("/api/catalog/store-imports/" + encodeURIComponent(runId), {
            cache: "no-store", signal: context?.signal ?? null,
          }));
          return summarizeStoreImport(result as unknown as ImportResponse);
        }),
      },
      {
        name: "bthwani_commit_store_products",
        description: "CONSEQUENTIAL WRITE: Apply only the valid rows from an existing previewed store import. Review the run ID and conflicts first. Requires approve='IMPORT'. Uses existing operator authorization, DSH idempotency and readback. Products are not automatically published.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string", minLength: 8, maxLength: 128 },
            approve: { type: "string", enum: ["IMPORT"], description: "Explicit acknowledgement after reviewing this run's preview." },
          },
          required: ["runId", "approve"], additionalProperties: false,
        },
        annotations: { readOnlyHint: false, consequentialHint: true, untrustedContentHint: true },
        execute: protectedTool(async (args, context) => {
          const runId = requiredId(args.runId, "import run ID");
          if (args.approve !== "IMPORT") throw new Error("Review the preview and explicitly approve the import first.");
          const path = "/api/catalog/store-imports/" + encodeURIComponent(runId);
          const before = await readResponse(await fetch(path, { cache: "no-store", signal: context?.signal ?? null })) as unknown as ImportResponse;
          if (before.run.state === "committed") return summarizeStoreImport(before);
          if (before.run.state !== "previewed" && before.run.state !== "rejected") {
            throw new Error("This import is not ready for commit.");
          }
          if (before.run.acceptedCount < 1 &&
              !(before.run.state === "rejected" && before.items?.some(item => item.classification === "FAILED"))) {
            throw new Error("No eligible products to commit.");
          }
          const key = commitKeys.get(runId) ?? crypto.randomUUID();
          commitKeys.set(runId, key);
          await readResponse(await fetch(path, {
            method: "POST",
            headers: { "Idempotency-Key": key, "X-Correlation-ID": crypto.randomUUID() },
            signal: context?.signal ?? null,
          }));
          const after = await readResponse(await fetch(path, { cache: "no-store", signal: context?.signal ?? null })) as unknown as ImportResponse;
          if (after.run.state === "committed") commitKeys.delete(runId);
          return summarizeStoreImport(after);
        }),
      },
    ];

    for (const tool of tools) {
      try {
        void Promise.resolve(modelContext.registerTool(tool, { signal: controller.signal }))
          .catch((error: unknown) => console.warn("WebMCP registration failed:", tool.name, error));
      } catch (error) {
        console.warn("WebMCP registration failed:", tool.name, error);
      }
    }
    return () => controller.abort();
  }, [enabled]);

  return null;
}
