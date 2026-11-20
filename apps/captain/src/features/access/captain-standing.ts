/** DSH current standing is separate from the Identity Captain role. */
export interface CaptainStanding {
  actorId: string;
  status: "APPROVED";
  version: number;
}
export class CaptainStandingError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.name = "CaptainStandingError";
  }
}
export function captainStandingFrom(value: unknown, actorId: string): CaptainStanding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CaptainStandingError(502, "OWNER_RESPONSE_INVALID");
  }
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 3 ||
    !["actorId", "status", "version"].every(k => Object.hasOwn(v, k)) ||
    typeof v.actorId !== "string" || v.actorId !== actorId ||
    v.status !== "APPROVED" || !Number.isSafeInteger(v.version) || (v.version as number) < 1) {
    throw new CaptainStandingError(502, "OWNER_RESPONSE_INVALID");
  }
  return v as unknown as CaptainStanding;
}
function checkedOrigin(origin: string): URL {
  let url: URL;
  try { url = new URL(origin); } catch { throw new CaptainStandingError(0, "DSH_ENDPOINT_INVALID"); }
  if (url.username || url.password || url.pathname !== "/" || url.hash || url.search ||
    !(url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname)))) {
    throw new CaptainStandingError(0, "DSH_ENDPOINT_UNSAFE");
  }
  return url;
}
async function currentStanding(
  origin: string, bearer: string, path: string, method: "GET" | "POST",
  signal?: AbortSignal,
): Promise<unknown> {
  const url = new URL(path, checkedOrigin(origin));
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(bearer)) {
    throw new CaptainStandingError(401, "UNAUTHORIZED");
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method, redirect: "error", cache: "no-store", credentials: "omit",
      headers: { Authorization: "Bearer " + bearer, Accept: "application/json" },
      signal: signal ?? null,
    });
  } catch {
    throw new CaptainStandingError(0, method === "POST" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_NETWORK_UNAVAILABLE");
  }
  if (signal?.aborted) throw new CaptainStandingError(0,
    method === "POST" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
  if (!res.ok) {
    throw new CaptainStandingError(res.status,
      res.status === 403 ? "CAPTAIN_NOT_ELIGIBLE" :
      res.status === 401 ? "UNAUTHORIZED" : res.status >= 500 ?
        (method === "POST" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE") : "OWNER_REQUEST_FAILED");
  }
  if (res.status !== 200 ||
    res.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
    !res.headers.get("Cache-Control")?.toLowerCase().split(",").map(s => s.trim()).includes("no-store")) {
    throw new CaptainStandingError(502, method === "POST" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  }
  let raw: string;
  try { raw = await res.text(); }
  catch { throw new CaptainStandingError(502, method === "POST" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID"); }
  if (raw.length > 4096) throw new CaptainStandingError(502, method === "POST" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  try { return JSON.parse(raw) as unknown; }
  catch { throw new CaptainStandingError(502, method === "POST" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID"); }
}
export async function readApprovedCaptainStanding(
  origin: string, bearer: string, role: "customer" | "captain",
  actorId: string, signal?: AbortSignal,
): Promise<CaptainStanding> {
  return captainStandingFrom(await currentStanding(origin, bearer,
    role === "customer" ? "/v1/actors/me/captain-eligibility" : "/v1/captains/me/standing",
    "GET", signal), actorId);
}
export type CaptainApplicationStatus = "PENDING" | "APPROVED";

function currentApplicationFrom(
  data: unknown, actorId: string, method: "GET" | "POST",
): CaptainApplicationStatus {
  const invalidCode = method === "POST" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID";
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new CaptainStandingError(502, invalidCode);
  }
  const v = data as Record<string, unknown>;
  if (Object.keys(v).length !== 3 || v.actorId !== actorId ||
    !["PENDING", "APPROVED"].includes(v.status as string) ||
    !Number.isSafeInteger(v.version) || (v.version as number) < 1) {
    throw new CaptainStandingError(502, invalidCode);
  }
  return v.status as CaptainApplicationStatus;
}

// Owner-backed read after an uncertain POST: never repeats the mutation or
// trusts a caller-provided actor ID without matching DSH's verified reply.
export async function readCaptainApplication(
  origin: string, customerBearer: string, actorId: string, signal?: AbortSignal,
): Promise<CaptainApplicationStatus> {
  return currentApplicationFrom(await currentStanding(origin, customerBearer,
    "/v1/actors/me/captain-application", "GET", signal), actorId, "GET");
}
export async function requestCaptainApplication(
  origin: string, customerBearer: string, actorId: string, signal?: AbortSignal,
): Promise<CaptainApplicationStatus> {
  return currentApplicationFrom(await currentStanding(origin, customerBearer,
    "/v1/actors/me/captain-application", "POST", signal), actorId, "POST");
}
