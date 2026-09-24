import type { OperatorPermission } from "@bthwani/identity";

export const operatorWorkspacePermissions = [
  { key: "operations", label: "العمليات" },
  { key: "partners", label: "الشركاء" },
  { key: "catalog", label: "الكتالوج" },
  { key: "marketing", label: "التسويق والمحتوى" },
  { key: "finance", label: "المالية" },
  { key: "platform_policies", label: "سياسات المنصة" },
] as const satisfies ReadonlyArray<Readonly<{ key: OperatorPermission; label: string }>>;

export type OperatorWorkspacePermission = (typeof operatorWorkspacePermissions)[number]["key"];
