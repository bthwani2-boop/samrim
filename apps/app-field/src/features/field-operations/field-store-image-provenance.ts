import type { MediaProvenanceInput } from "@bthwani/dsh";

// Source is determined by the action the field worker chose; the rights
// declaration remains explicit and can never be silently pre-checked.
export function fieldStoreImageProvenance(
  source: "camera" | "library",
  ownerName: string,
  fieldName = "",
): MediaProvenanceInput {
  if (source === "camera") {
    return {
      creator: fieldName.trim() || "موظف الميدان",
      sourceDescription: "صورة التقطها موظف الميدان بكاميرته في المتجر.",
      rightsStatement: "أؤكد أن الصورة التقطت للمحل بموافقة صاحبه، ويجوز عرضها على بثواني.",
      rightsAttested: false,
      sourceUri: "",
      rightsUri: "",
    };
  }
  return {
    creator: ownerName.trim() || "مالك المتجر",
    sourceDescription: "صورة قدمها مالك المتجر بعد إقراره بحقه في عرضها.",
    rightsStatement: "أؤكد أن مالك المتجر قدم الصورة وأجاز عرضها على بثواني.",
    rightsAttested: false,
    sourceUri: "",
    rightsUri: "",
  };
}
