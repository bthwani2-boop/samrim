import type { Order } from "./generated/dsh-types";

export const PARTNER_ORDER_REPORT_PAGE_SIZE = 50;
export const PARTNER_ORDER_REPORT_MAX_ROWS = 25_000;
type OrderExportEntry = Pick<Order, "id" | "storeId" | "state" | "createdAt" | "totalAmountMinor" | "fulfillmentMode">;
type OrderExportPage = Readonly<{ orders: ReadonlyArray<OrderExportEntry>; nextCursor?: string }>;
type ReadPage = (cursor: string) => Promise<OrderExportPage>;

function csvValue(value: string | number): string {
  const plain = String(value).replace(/[\r\n\t]+/g, " ");
  // Never allow spreadsheet formulas from order identifiers or other untrusted fields.
  const safe = typeof value === "string" && /^[\s\u200B-\u200D\u2060\uFEFF]*[=+\-@]/u.test(plain) ? "'" + plain : plain;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function buildPartnerOrderReportCsv(orders: ReadonlyArray<OrderExportEntry>): string {
  const rows: ReadonlyArray<ReadonlyArray<string | number>> = [
    ["رقم الطلب", "الحالة", "وقت الإنشاء ISO", "وضع التنفيذ", "قيمة الطلب المسجلة بوحدات DSH"],
    ...orders.map(order => [order.id, order.state, order.createdAt, order.fulfillmentMode, order.totalAmountMinor]),
  ];
  return "\uFEFF" + rows.map(row => row.map(csvValue).join(",")).join("\r\n");
}

// Collect from the authorized DSH Store-scoped Order endpoint; never export only a
// rendered page or silently omit the tail. This is an operational report, not WLT.
export async function collectPartnerOrderReportCsv(
  storeId: string,
  readPage: ReadPage,
  onProgress?: (count: number) => void,
): Promise<Readonly<{ csv: string; count: number }>> {
  if (!storeId.trim() || storeId.length > 128) throw new Error("ORDER_REPORT_SCOPE_INVALID");
  const rows: OrderExportEntry[] = [];
  const seenOrderIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor = "";
  for (;;) {
    if (seenCursors.has(cursor)) throw new Error("ORDER_REPORT_CURSOR_REPEATED");
    seenCursors.add(cursor);
    const page = await readPage(cursor);
    if (!page || !Array.isArray(page.orders) || page.orders.length > PARTNER_ORDER_REPORT_PAGE_SIZE ||
      (page.nextCursor !== undefined && typeof page.nextCursor !== "string")) {
      throw new Error("ORDER_REPORT_RESPONSE_INVALID");
    }
    for (const order of page.orders) {
      if (!order || order.storeId !== storeId || !order.id || seenOrderIds.has(order.id) ||
        !Number.isSafeInteger(order.totalAmountMinor) || order.totalAmountMinor < 0 ||
        typeof order.state !== "string" || typeof order.createdAt !== "string" ||
        typeof order.fulfillmentMode !== "string") {
        throw new Error("ORDER_REPORT_SCOPE_OR_DUPLICATE");
      }
      seenOrderIds.add(order.id);
      rows.push(order);
      if (rows.length > PARTNER_ORDER_REPORT_MAX_ROWS) throw new Error("ORDER_REPORT_TOO_LARGE_OR_INCONSISTENT");
    }
    onProgress?.(rows.length);
    const next = page.nextCursor ?? "";
    if (!next) break;
    if (!page.orders.length || rows.length >= PARTNER_ORDER_REPORT_MAX_ROWS) throw new Error("ORDER_REPORT_TOO_LARGE_OR_INCONSISTENT");
    cursor = next;
  }
  return { csv: buildPartnerOrderReportCsv(rows), count: rows.length };
}
