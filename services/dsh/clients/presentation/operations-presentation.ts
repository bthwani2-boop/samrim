import type {
  BaseUnit,
  CaptainAdmission,
  CaptainAssignment,
  CaptainDeliveryTask,
  CaptainHandoff,
  CaptainOffer,
  CatalogProductProposal,
  CatalogStoreOffer,
  FieldAdmission,
  JoiningCaseState,
  MeasurementKind,
  PublicationState,
  StorePublicationReadiness,
  StoreOfferPublicationState,
} from "../generated/dsh-types";

const joiningCaseLabels: Record<JoiningCaseState, string> = {
  draft: "مسودة",
  submitted: "قيد المراجعة",
  needs_correction: "يحتاج إلى تصحيح",
  approved: "تمت الموافقة",
};

const publicationLabels: Record<PublicationState, string> = {
  unpublished: "غير منشور",
  published: "منشور",
  hidden: "مخفي",
};

type StorePublicationBlockedReason = Exclude<StorePublicationReadiness["blockedReason"], undefined>;

const publicationReadinessBlockedReasonLabels: Record<StorePublicationBlockedReason, string> = {
  PARTNER_IDENTITY_NOT_ELIGIBLE: "هوية الشريك أو صلاحية دوره غير جاهزة للنشر",
  SERVICE_CITY_NOT_ELIGIBLE: "مدينة خدمة المتجر غير مؤهلة للنشر",
  CATALOG_NOT_READY: "لا يوجد كتالوج أو عرض منشور صالح يجعل المتجر جاهزًا",
};

const storeOfferPublicationLabels: Record<StoreOfferPublicationState, string> = {
  draft: "مسودة",
  published: "منشور",
  hidden: "مخفي",
};

const proposalLabels: Record<CatalogProductProposal["state"], string> = {
  draft: "مسودة",
  submitted: "قيد المراجعة",
  needs_correction: "يحتاج إلى تصحيح",
  approved: "تمت الموافقة",
  rejected: "مرفوض",
};

const captainAdmissionLabels: Record<CaptainAdmission["state"], string> = {
  pending_identity: "بانتظار تثبيت الهوية",
  eligible: "مؤهل للتشغيل",
  suspended: "موقوف",
};

const captainAvailabilityLabels: Record<CaptainAdmission["availabilityState"], string> = {
  available: "متاح لاستقبال مهمة",
  unavailable: "غير متاح حاليًا",
};

const captainOfferLabels: Record<CaptainOffer["state"], string> = {
  offered: "عرض جديد",
  accepted: "تم قبول العرض",
  rejected: "تم رفض العرض",
  expired: "انتهت مهلة العرض",
  superseded: "استُبدل بعرض أحدث",
};

const captainAssignmentLabels: Record<CaptainAssignment["state"], string> = {
  assigned: "بانتظار الاستلام",
  in_custody: "مع الكابتن",
  delivered: "تم التسليم",
  delivery_failed: "تعذر التسليم",
  reassigned: "أُعيد إسناده",
};

const captainHandoffLabels: Record<CaptainHandoff["state"], string> = {
  pending: "بانتظار تأكيد المتجر",
  store_confirmed: "أكد المتجر التسليم",
  completed: "اكتمل التسليم للكابتن",
  superseded: "استُبدل بتكليف أحدث",
};

const fieldAdmissionLabels: Record<FieldAdmission["state"], string> = {
  pending_identity: "بانتظار تثبيت الهوية",
  eligible: "مؤهل لإنشاء الملفات",
  suspended: "موقوف",
};

const quantityPolicyLabels: Record<CatalogStoreOffer["quantityPolicy"], string> = {
  DISCRETE: "كمية بالقطعة",
  MEASURED: "كمية بمقاس ثابت",
  VARIABLE_MEASURE: "كمية بمقاس متغير",
};

const pricingBasisLabels: Record<CatalogStoreOffer["pricingBasis"], string> = {
  PER_UNIT: "لكل قطعة",
  PER_MEASURE: "لكل وحدة قياس",
};

const measurementKindLabels: Record<MeasurementKind, string> = {
  DISCRETE: "بالقطعة",
  MEASURED: "بالوزن أو الحجم",
  VARIABLE_MEASURE: "قياس متغير",
};

const baseUnitLabels: Record<BaseUnit, string> = {
  COUNT: "قطعة",
  GRAM: "غرام",
  MILLILITER: "مل",
};

export function joiningCaseStateLabel(state: JoiningCaseState): string {
  return joiningCaseLabels[state];
}

export function publicationStateLabel(state: PublicationState): string {
  return publicationLabels[state];
}

export function publicationReadinessBlockedReasonLabel(reason: StorePublicationReadiness["blockedReason"]): string {
  if (!reason) return "سبب حجب النشر غير متاح حاليًا.";
  return publicationReadinessBlockedReasonLabels[reason];
}

export function storeOfferPublicationStateLabel(state: StoreOfferPublicationState): string {
  return storeOfferPublicationLabels[state];
}

export function catalogProductProposalStateLabel(state: CatalogProductProposal["state"]): string {
  return proposalLabels[state];
}

export function captainAdmissionStateLabel(state: CaptainAdmission["state"]): string {
  return captainAdmissionLabels[state];
}

export function captainAvailabilityStateLabel(state: CaptainAdmission["availabilityState"]): string {
  return captainAvailabilityLabels[state];
}

export function captainOfferStateLabel(state: CaptainOffer["state"]): string {
  return captainOfferLabels[state];
}

export function captainAssignmentStateLabel(state: CaptainAssignment["state"]): string {
  return captainAssignmentLabels[state];
}

export function captainHandoffStateLabel(state: CaptainHandoff["state"]): string {
  return captainHandoffLabels[state];
}

export function captainTaskProgressLabel(task: Pick<CaptainDeliveryTask, "handoffState" | "deliveryState">): string {
  if (task.deliveryState === "delivered") return "اكتملت الرحلة وتم التسليم";
  if (task.deliveryState === "delivery_failed") return "تعذر التسليم — الطلب ما زال في عهدتك وبانتظار معالجة المشغل";
  if (task.deliveryState === "in_custody") return "الطلب في عهدتك — أكمل التسليم للعميل";
  if (task.handoffState === "store_confirmed") return "المتجر أكد الجاهزية — يمكنك تأكيد الاستلام";
  if (task.handoffState === "completed") return "تم استلام الطلب من المتجر";
  if (task.handoffState === "superseded") return "تم استبدال التسليم بتكليف أحدث";
  return "بانتظار تأكيد المتجر قبل الاستلام";
}

export function fieldAdmissionStateLabel(state: FieldAdmission["state"]): string {
  return fieldAdmissionLabels[state];
}

export function quantityPolicyLabel(policy: CatalogStoreOffer["quantityPolicy"]): string {
  return quantityPolicyLabels[policy];
}

export function pricingBasisLabel(basis: CatalogStoreOffer["pricingBasis"]): string {
  return pricingBasisLabels[basis];
}

export function measurementKindLabel(kind: MeasurementKind): string {
  return measurementKindLabels[kind];
}

export function baseUnitLabel(unit: BaseUnit): string {
  return baseUnitLabels[unit];
}
