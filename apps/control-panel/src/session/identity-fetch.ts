export type RequestFailure = Readonly<{ status: number; message: string }>;

export async function identityFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

export function isRequestFailure(value: unknown): value is RequestFailure {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { status?: unknown }).status === "number" &&
    typeof (value as { message?: unknown }).message === "string",
  );
}
