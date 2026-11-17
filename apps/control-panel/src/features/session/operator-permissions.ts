export const operatorPermissions = [
  "operations", "partners", "catalog", "marketing", "finance", "hr", "platform_policies",
] as const;
export type OperatorPermission = (typeof operatorPermissions)[number];

export function isOperatorPermission(value: unknown): value is OperatorPermission {
  return typeof value === "string" && operatorPermissions.some((item) => item === value);
}

// Presentation-only hint. Identity must authorize every protected API request.
export function canShowNavigation(
  verified: boolean,
  grants: readonly OperatorPermission[],
  required: OperatorPermission | null,
): boolean {
  return verified && required !== null && grants.includes(required);
}
