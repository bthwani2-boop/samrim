export type PasskeyFinishPayload = Readonly<{
  ceremonyId: string;
  credential: Record<string, unknown>;
}>;

function asJsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizePasskeyFinishPayload(value: unknown): PasskeyFinishPayload {
  const body = asJsonObject(value);
  return {
    ceremonyId: typeof body.ceremonyId === "string" ? body.ceremonyId : "",
    credential: asJsonObject(body.credential),
  };
}
