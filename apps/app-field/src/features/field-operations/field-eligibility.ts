import type { FieldAdmission } from "@bthwani/dsh";

export type FieldAdmissionActionability = "available" | "profile_review" | "not_eligible";

export function fieldAdmissionActionability(
  admission: Pick<FieldAdmission, "state" | "requiresProfileReview" | "fullNameAr">,
): FieldAdmissionActionability {
  if (admission.state !== "eligible") return "not_eligible";
  if (admission.requiresProfileReview || !admission.fullNameAr) return "profile_review";
  return "available";
}
