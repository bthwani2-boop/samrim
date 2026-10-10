export const FIELD_JOINING_CASE_STEPS = [
  { id: "owner", title: "بيانات المالك" },
  { id: "store", title: "النشاط والمتجر" },
  { id: "evidence", title: "الإثبات" },
  { id: "location", title: "التوصيل والموقع" },
  { id: "operations", title: "ساعات العمل والواجهة" },
] as const;

export type FieldJoiningCaseStepID = (typeof FIELD_JOINING_CASE_STEPS)[number]["id"];

export function getFieldJoiningCaseStepProgress(stepID: FieldJoiningCaseStepID) {
  const index = FIELD_JOINING_CASE_STEPS.findIndex((step) => step.id === stepID);
  const step = FIELD_JOINING_CASE_STEPS[index] ?? FIELD_JOINING_CASE_STEPS[0];
  return {
    current: index + 1,
    total: FIELD_JOINING_CASE_STEPS.length,
    progressPercent: Math.round(((index + 1) / FIELD_JOINING_CASE_STEPS.length) * 100),
    title: step.title,
  };
}

export function moveFieldJoiningCaseStep(stepID: FieldJoiningCaseStepID, direction: -1 | 1): FieldJoiningCaseStepID {
  const index = FIELD_JOINING_CASE_STEPS.findIndex((step) => step.id === stepID);
  const nextIndex = Math.max(0, Math.min(FIELD_JOINING_CASE_STEPS.length - 1, index + direction));
  return FIELD_JOINING_CASE_STEPS[nextIndex]?.id ?? FIELD_JOINING_CASE_STEPS[0].id;
}
