import { DshPublicError } from "./client-core.ts";
import { type EmployeeRegistration, validEmployeeRegistration } from "./employees.ts";
import { type PendingRegistration, parsePendingRegistration } from "./registration-attempt.ts";

export type EmployeeRegistrationDraft = Omit<EmployeeRegistration, "operationId">;
export type EmployeeRegistrationOutcome = "confirmed" | "invalid" | "denied" | "conflict" | "unknown";
export type EmployeeRegistrationAttempt = PendingRegistration & { readonly settled?: true };
export type EmployeeRegistrationRecovery = Readonly<{ key: string; attempt: EmployeeRegistrationAttempt | null }>;
export interface EmployeeRegistrationRecoveryPort {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  lock<T>(key: string, action: () => Promise<T>): Promise<T>;
  digest(value: string): Promise<string>;
  randomUUID(): string;
}

export function normalizeEmployeeRegistrationDraft(draft: EmployeeRegistrationDraft): EmployeeRegistrationDraft {
  return { displayName: draft.displayName.trim(), department: draft.department.trim(),
    jobTitle: draft.jobTitle.trim(), startDate: draft.startDate.trim() };
}

export function employeeRegistrationErrorOutcome(error: unknown): Exclude<EmployeeRegistrationOutcome, "confirmed"> {
  if (error instanceof DshPublicError) {
    if (error.status === 400 && error.code === "EMPLOYEE_REGISTRATION_INVALID") return "invalid";
    if (error.status === 409) return "conflict";
  }
  if (error && typeof error === "object" && "status" in error && (error.status === 401 || error.status === 403)) return "denied";
  return "unknown";
}

function parseAttempt(raw: string | null): EmployeeRegistrationAttempt | null {
  if (raw === null) return null;
  const pending = parsePendingRegistration(raw);
  if (pending) return pending;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Invalid employee recovery metadata"); }
  if (value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 3 && "settled" in value && value.settled === true &&
    "fingerprint" in value && "operationId" in value) {
    const record = parsePendingRegistration(JSON.stringify({ fingerprint: value.fingerprint, operationId: value.operationId }));
    if (record) return { ...record, settled: true };
  }
  throw new Error("Invalid employee recovery metadata");
}

function sameAttempt(a: EmployeeRegistrationAttempt | null, b: EmployeeRegistrationAttempt | null): boolean {
  return a === null || b === null ? a === b :
    a.operationId === b.operationId && a.fingerprint === b.fingerprint && a.settled === b.settled;
}

export async function openEmployeeRegistrationRecovery(port: EmployeeRegistrationRecoveryPort,
  employer: "company" | "merchant", actorId: string): Promise<EmployeeRegistrationRecovery> {
  if (!actorId.trim()) throw new Error("Missing employee recovery scope");
  // Preserve the existing Merchant actor-wide key: Store membership is not an employer.
  const scope = employer === "company" ? "operator" : "merchant";
  const key = `bthwani.${scope}.employee-attempt.${await port.digest(JSON.stringify([actorId, "employee-registration"]))}`;
  return { key, attempt: parseAttempt(await port.read(key)) };
}

type Claim = { status: "claimed"; recovery: EmployeeRegistrationRecovery; input: EmployeeRegistration; replay: boolean }
  | { status: "changed" | "mismatch" | "invalid" };

export async function claimEmployeeRegistration(port: EmployeeRegistrationRecoveryPort, recovery: EmployeeRegistrationRecovery,
  draft: EmployeeRegistrationDraft, signal?: AbortSignal): Promise<Claim> {
  const fields = normalizeEmployeeRegistrationDraft(draft);
  const fingerprint = await port.digest(JSON.stringify([fields.displayName, fields.department, fields.jobTitle, fields.startDate]));
  return port.lock(recovery.key, async () => {
    signal?.throwIfAborted();
    const raw = await port.read(recovery.key);
    signal?.throwIfAborted();
    const current = parseAttempt(raw);
    if (!sameAttempt(current, recovery.attempt)) return { status: "changed" };
    const pending = current && !current.settled ? current : null;
    if (pending && pending.fingerprint !== fingerprint) return { status: "mismatch" };
    const attempt = pending ?? { fingerprint, operationId: port.randomUUID() };
    const input = { ...fields, operationId: attempt.operationId };
    if (!validEmployeeRegistration(input)) return { status: "invalid" };
    if (!pending) {
      if (!parsePendingRegistration(JSON.stringify(attempt))) throw new Error("Invalid employee recovery identity");
      await port.write(recovery.key, JSON.stringify(attempt));
    }
    signal?.throwIfAborted();
    return { status: "claimed", recovery: { key: recovery.key, attempt }, input, replay: pending !== null };
  });
}

export async function settleEmployeeRegistration(port: EmployeeRegistrationRecoveryPort, recovery: EmployeeRegistrationRecovery,
  outcome: EmployeeRegistrationOutcome, replay: boolean): Promise<EmployeeRegistrationRecovery> {
  if (outcome !== "confirmed" && (outcome !== "invalid" || replay)) return recovery;
  if (!recovery.attempt || recovery.attempt.settled) throw new Error("Missing pending employee recovery identity");
  const attempt: EmployeeRegistrationAttempt = { ...recovery.attempt, settled: true };
  return port.lock(recovery.key, async () => {
    const current = parseAttempt(await port.read(recovery.key));
    if (sameAttempt(current, attempt)) return { key: recovery.key, attempt };
    if (!sameAttempt(current, recovery.attempt)) throw new Error("Employee recovery changed before settlement");
    // Retain only an opaque last-generation marker; deleting it permits stale tabs to claim anew.
    await port.write(recovery.key, JSON.stringify(attempt));
    return { key: recovery.key, attempt };
  });
}
