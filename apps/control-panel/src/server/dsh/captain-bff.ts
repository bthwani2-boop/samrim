import { normalizeYemenPhoneE164 } from "@bthwani/identity/phone";
import { type CaptainAdmissionListResponse, type CaptainAdmissionRequest, type CaptainAdmissionResponse, type CaptainAssignmentResponse, type CaptainOfferResponse, dshOperationPaths, type ManagedCaptainAvailabilityRequest, type ManagedRoleMutationRequest, type ManagedRoleReenrollmentRequest } from "@bthwani/dsh";
import { requestDshJson, validateAttributedMutationContext, validateVersionedMutationContext, type DshAttributedMutationContext, type DshOperatorReadContext, type DshVersionedMutationContext, type JoiningCaseMutationContext } from "./dsh-transport";

type DshManagedRoleMutationContext = DshVersionedMutationContext & Readonly<{ idempotencyKey: string }>;

async function setDshManagedRoleEnabled(path: string, input: ManagedRoleMutationRequest, context: DshManagedRoleMutationContext): Promise<void> {
	validateVersionedMutationContext(context);
	if (!context.idempotencyKey.trim()) throw new Error("DSH_MANAGED_ROLE_IDEMPOTENCY_INVALID");
	if (input.reason !== undefined && input.reason.trim().length > 500) throw new Error("DSH_MANAGED_ROLE_REASON_INVALID");
	await requestDshJson<undefined>("POST", path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim(), "X-Expected-Version": String(context.expectedVersion) });
}

export async function setDshPartnerRoleEnabled(actorId: string, input: ManagedRoleMutationRequest, context: DshManagedRoleMutationContext): Promise<void> {
  const normalized = actorId.trim();
  if (!normalized) throw new Error("DSH_MANAGED_ROLE_ACTOR_REQUIRED");
  await setDshManagedRoleEnabled(dshOperationPaths.setPartnerManagedRoleEnabled.path.replace("{actorId}", encodeURIComponent(normalized)), input, context);
}

export async function setDshCaptainRoleEnabled(actorId: string, input: ManagedRoleMutationRequest, context: DshManagedRoleMutationContext): Promise<void> {
  const normalized = actorId.trim();
  if (!normalized) throw new Error("DSH_MANAGED_ROLE_ACTOR_REQUIRED");
  await setDshManagedRoleEnabled(dshOperationPaths.setCaptainManagedRoleEnabled.path.replace("{actorId}", encodeURIComponent(normalized)), input, context);
}

export async function setDshCaptainAvailability(actorId: string, input: ManagedCaptainAvailabilityRequest, context: DshManagedRoleMutationContext): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  const normalized = actorId.trim();
  if (!normalized || !Number.isSafeInteger(context.expectedVersion) || context.expectedVersion < 1) throw new Error("DSH_CAPTAIN_AVAILABILITY_INPUT_INVALID");
  const reasonLength = Array.from(input.reason.trim()).length;
  if (reasonLength < 5 || reasonLength > 500) throw new Error("DSH_CAPTAIN_AVAILABILITY_REASON_INVALID");
  const path = dshOperationPaths.setOperatorCaptainAvailability.path.replace("{actorId}", encodeURIComponent(normalized));
  return requestDshJson<CaptainAdmissionResponse>(dshOperationPaths.setOperatorCaptainAvailability.method, path, input, {
    "X-Acting-Actor-ID": context.operatorActorId.trim(),
    "X-Correlation-ID": context.correlationId.trim(),
    "X-Expected-Version": String(context.expectedVersion),
    "Idempotency-Key": context.idempotencyKey.trim(),
  });
}

export async function admitCaptain(input: CaptainAdmissionRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  if (Array.from(input.fullNameAr.trim()).length < 2 || Array.from(input.fullNameAr.trim()).length > 120) throw new Error("DSH_CAPTAIN_NAME_INVALID");
  const contactPhoneE164 = normalizeYemenPhoneE164(input.contactPhoneE164);
  if (!/^\+[1-9][0-9]{7,14}$/.test(contactPhoneE164)) throw new Error("DSH_CAPTAIN_PHONE_INVALID");
  const walletProviderKey = input.walletProviderKey.trim();
  if (Array.from(walletProviderKey).length < 1 || Array.from(walletProviderKey).length > 64 || /\p{Cc}/u.test(walletProviderKey)) throw new Error("DSH_CAPTAIN_WALLET_PROVIDER_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CAPTAIN_IDEMPOTENCY_INVALID");
  return requestDshJson<CaptainAdmissionResponse>(dshOperationPaths.admitCaptain.method, dshOperationPaths.admitCaptain.path, { fullNameAr: input.fullNameAr.trim(), contactPhoneE164, walletProviderKey }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listCaptainAdmissions(query: string, state: string, sort: string, limit: number, cursor: string, context: DshOperatorReadContext): Promise<CaptainAdmissionListResponse> {
  const params = new URLSearchParams({ q: query.trim(), state, sort, limit: String(limit) }); if (cursor) params.set("cursor", cursor);
  return (await requestDshJson<CaptainAdmissionListResponse>("GET", `${dshOperationPaths.listCaptainAdmissions.path}?${params}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function approveCaptainAdmission(admissionId: string, expectedVersion: number, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  const path = dshOperationPaths.approveCaptainAdmission.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<CaptainAdmissionResponse>("POST", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim(), "X-Expected-Version": String(expectedVersion) });
}

export async function provisionCaptainAdmission(admissionId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  const path = dshOperationPaths.provisionCaptainAdmission.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<CaptainAdmissionResponse>("POST", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateCaptainAdmissionProfile(admissionId: string, fullNameAr: string, context: DshOperatorReadContext & Readonly<{ correlationId: string; idempotencyKey: string; expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  const path = dshOperationPaths.updateCaptainAdmissionProfile.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<CaptainAdmissionResponse>("PATCH", path, { fullNameAr: fullNameAr.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function reviewCaptainAdmissionProfile(admissionId: string, context: DshOperatorReadContext & Readonly<{ correlationId: string; idempotencyKey: string; expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
	const path = dshOperationPaths.reviewCaptainAdmissionProfile.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
	return requestDshJson<CaptainAdmissionResponse>("POST", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readCaptainAdmissionByActor(actorId: string, context: DshOperatorReadContext): Promise<CaptainAdmissionResponse> {
  const normalized = actorId.trim();
  if (!normalized || !context.operatorActorId.trim()) throw new Error("DSH_CAPTAIN_ADMISSION_READ_INPUT_INVALID");
  const path = dshOperationPaths.readCaptainAdmissionForOperatorActor.path.replace("{actorId}", encodeURIComponent(normalized));
  return (await requestDshJson<CaptainAdmissionResponse>(dshOperationPaths.readCaptainAdmissionForOperatorActor.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

type DshManagedRoleReenrollmentContext = DshAttributedMutationContext & Readonly<{ expectedDomainVersion: number }>;

async function authorizeDshManagedRoleReenrollment(path: string, actorId: string, input: ManagedRoleReenrollmentRequest, context: DshManagedRoleReenrollmentContext): Promise<void> {
  const normalized = actorId.trim();
  if (!normalized || normalized.length > 128 || !context.operatorActorId.trim() || context.correlationId.trim().length < 8 || !Number.isSafeInteger(context.expectedDomainVersion) || context.expectedDomainVersion < 1) throw new Error("DSH_MANAGED_ROLE_REENROLLMENT_CONTEXT_INVALID");
  const reasonLength = Array.from(input.reason.trim()).length;
  if (!Number.isSafeInteger(input.expectedActorVersion) || input.expectedActorVersion < 1 || !Number.isSafeInteger(input.expectedRoleVersion) || input.expectedRoleVersion < 1 || reasonLength < 5 || reasonLength > 500) throw new Error("DSH_MANAGED_ROLE_REENROLLMENT_INPUT_INVALID");
  await requestDshJson<void>("POST", path.replace("{actorId}", encodeURIComponent(normalized)), input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedDomainVersion) });
}

export async function authorizeDshPartnerReenrollment(actorId: string, input: ManagedRoleReenrollmentRequest, context: DshManagedRoleReenrollmentContext): Promise<void> {
  await authorizeDshManagedRoleReenrollment(dshOperationPaths.authorizePartnerReenrollment.path, actorId, input, context);
}

export async function authorizeDshCaptainReenrollment(actorId: string, input: ManagedRoleReenrollmentRequest, context: DshManagedRoleReenrollmentContext): Promise<void> {
  await authorizeDshManagedRoleReenrollment(dshOperationPaths.authorizeCaptainReenrollment.path, actorId, input, context);
}

export async function dispatchCaptainOffer(orderId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainOfferResponse }>> {
  if (!orderId.trim()) throw new Error("DSH_CAPTAIN_ORDER_REQUIRED");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CAPTAIN_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.dispatchCaptainOffer.path.replace("{orderId}", encodeURIComponent(orderId.trim()));
  return requestDshJson<CaptainOfferResponse>(dshOperationPaths.dispatchCaptainOffer.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function reassignCaptainOffer(orderId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainOfferResponse }>> {
  if (!orderId.trim()) throw new Error("DSH_CAPTAIN_ORDER_REQUIRED");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CAPTAIN_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.reassignCaptainOffer.path.replace("{orderId}", encodeURIComponent(orderId.trim()));
  return requestDshJson<CaptainOfferResponse>(dshOperationPaths.reassignCaptainOffer.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function recoverCaptainDelivery(assignmentId: string, context: DshVersionedMutationContext & Readonly<{ idempotencyKey: string }>): Promise<Readonly<{ status: number; payload: CaptainAssignmentResponse }>> {
  if (!assignmentId.trim()) throw new Error("DSH_CAPTAIN_ASSIGNMENT_REQUIRED");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CAPTAIN_RECOVERY_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.recoverCaptainDelivery.path.replace("{assignmentId}", encodeURIComponent(assignmentId.trim()));
  return requestDshJson<CaptainAssignmentResponse>(dshOperationPaths.recoverCaptainDelivery.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim(), "X-Expected-Version": String(context.expectedVersion) });
}
