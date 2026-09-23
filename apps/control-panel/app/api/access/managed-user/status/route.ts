import { NextResponse } from "next/server";

import type { ActorType } from "@bthwani/identity";
import { dshErrorPayload, dshHttpStatus, isDshClientError, readCaptainAdmissionByActor, readFieldAdmissionByActor } from "../../../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, lookupIdentityRoles, readOperatorSession } from "../../../../../src/server/identity/identity-bff";

const roles = new Set<ActorType>(["client", "partner", "captain", "field", "operator"]);

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "operator access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const params = new URL(request.url).searchParams;
  const phone = (params.get("phone") ?? "").trim();
  const role = (params.get("role") ?? "").trim().toLowerCase();
  if (!phone || !roles.has(role as ActorType)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "phone and role are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const records = await lookupIdentityRoles(phone);
    const record = records.find((candidate) => candidate.role === role);
    const captainAdmissions = new Map<string, Awaited<ReturnType<typeof readCaptainAdmissionByActor>>["admission"]>();
    await Promise.all(records.filter((candidate) => candidate.role === "captain").map(async (candidate) => {
      try {
        captainAdmissions.set(candidate.actorId, (await readCaptainAdmissionByActor(candidate.actorId, { operatorActorId: identity.subject })).admission);
      } catch (error) {
        if (!isDshClientError(error) || dshHttpStatus(error) !== 404) throw error;
      }
    }));
    const fieldAdmissions = new Map<string, Awaited<ReturnType<typeof readFieldAdmissionByActor>>["admission"]>();
    await Promise.all(records.filter((candidate) => candidate.role === "field").map(async (candidate) => {
      try {
        fieldAdmissions.set(candidate.actorId, (await readFieldAdmissionByActor(candidate.actorId, { operatorActorId: identity.subject })).admission);
      } catch (error) {
        if (!isDshClientError(error) || dshHttpStatus(error) !== 404) throw error;
      }
    }));
    const toStatus = (candidate: typeof record) => candidate ? {
      actorId: candidate.actorId,
      phoneE164: candidate.phoneE164,
      role: candidate.role,
      exists: true,
      enabled: candidate.enabled,
      activated: Boolean(candidate.activatedAt),
      securityEnabled: candidate.securityEnabled,
      reenrollable: Boolean(candidate.enabled && candidate.securityEnabled && candidate.activatedAt && ((candidate.role === "partner" || candidate.role === "captain") || (candidate.role === "field" && fieldAdmissions.get(candidate.actorId)?.state === "eligible"))),
      state: !candidate.securityEnabled ? "identity_disabled" : !candidate.enabled ? "role_disabled" : !candidate.activatedAt ? "pending_activation" : candidate.role === "captain" && !captainAdmissions.has(candidate.actorId) ? "operational_not_admitted" : candidate.role === "captain" && captainAdmissions.get(candidate.actorId)?.state === "suspended" ? "operational_suspended" : candidate.role === "field" && !fieldAdmissions.has(candidate.actorId) ? "operational_not_admitted" : candidate.role === "field" && fieldAdmissions.get(candidate.actorId)?.state === "suspended" ? "operational_suspended" : candidate.role === "captain" && captainAdmissions.get(candidate.actorId)?.availabilityState === "unavailable" ? "active_unavailable" : "active",
      operationalAdmissionState: candidate.role === "captain" ? captainAdmissions.get(candidate.actorId)?.state : candidate.role === "field" ? fieldAdmissions.get(candidate.actorId)?.state : undefined,
      operationalAvailabilityState: candidate.role === "captain" ? captainAdmissions.get(candidate.actorId)?.availabilityState : undefined,
      operationalAdmissionVersion: candidate.role === "field" ? fieldAdmissions.get(candidate.actorId)?.version : undefined,
      actorVersion: candidate.actorVersion,
      roleVersion: candidate.roleVersion,
      credentialVersion: candidate.credentialVersion,
    } : null;
    return NextResponse.json({
      actorId: record?.actorId ?? records[0]?.actorId,
      phoneE164: record?.phoneE164 ?? records[0]?.phoneE164 ?? phone,
      exists: Boolean(record),
      enabled: record?.enabled ?? false,
      activated: Boolean(record?.activatedAt),
      securityEnabled: record?.securityEnabled ?? false,
      reenrollable: toStatus(record)?.reenrollable ?? false,
      state: toStatus(record)?.state ?? "not_admitted",
      operationalAdmissionState: toStatus(record)?.operationalAdmissionState,
      operationalAvailabilityState: toStatus(record)?.operationalAvailabilityState,
      operationalAdmissionVersion: toStatus(record)?.operationalAdmissionVersion,
      role,
      actorVersion: record?.actorVersion,
      roleVersion: record?.roleVersion,
      credentialVersion: record?.credentialVersion,
      admittedRoles: records.map(toStatus),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = isDshClientError(error) ? dshErrorPayload(error) : identityErrorPayload(error);
    return NextResponse.json({ error: payload }, { status: isDshClientError(error) ? dshHttpStatus(error) : identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
