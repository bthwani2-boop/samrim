import type { BaseUnit, CatalogAttributeRule, CatalogAttributeValueInput, CatalogIdentifierResolution, MeasurementKind, MediaProvenanceInput } from "@bthwani/dsh";

export type PricingBasis = "PER_UNIT" | "PER_MEASURE";

export type AttributeDrafts = Readonly<Record<string, string>>;
type AttributeInputSet = Readonly<{ productValues: ReadonlyArray<CatalogAttributeValueInput>; variantValues: ReadonlyArray<CatalogAttributeValueInput> }>;

export function expectedPricingBasisFor(measurementKind: MeasurementKind | undefined): PricingBasis | "" {
  if (measurementKind === "DISCRETE") return "PER_UNIT";
  if (measurementKind === "MEASURED") return "PER_MEASURE";
  return "";
}

export function emptyMediaProvenance(): MediaProvenanceInput {
  return { creator: "", sourceDescription: "", rightsStatement: "", rightsAttested: false };
}

export function buildAttributeInputs(rules: ReadonlyArray<CatalogAttributeRule>, drafts: AttributeDrafts): AttributeInputSet | null {
  const productValues: CatalogAttributeValueInput[] = [];
  const variantValues: CatalogAttributeValueInput[] = [];
  for (const rule of rules) {
    const raw = drafts[rule.attributeId]?.trim() ?? "";
    if (!raw) { if (rule.required) return null; continue; }
    let value: CatalogAttributeValueInput | null = null;
    switch (rule.valueKind) {
      case "TEXT": value = { attributeId: rule.attributeId, valueKind: rule.valueKind, textValue: raw }; break;
      case "INTEGER": { const parsed = Number(raw); if (!Number.isSafeInteger(parsed)) return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, integerValue: parsed }; break; }
      case "DECIMAL": { if (!Number.isFinite(Number(raw))) return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, decimalValue: raw }; break; }
      case "MEASUREMENT": { const measurementUnit = drafts[rule.attributeId + ":unit"]?.trim() ?? ""; if (!Number.isFinite(Number(raw)) || !measurementUnit) return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, decimalValue: raw, measurementUnit }; break; }
      case "BOOLEAN": if (raw !== "true" && raw !== "false") return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, booleanValue: raw === "true" }; break;
      case "ENUM": value = { attributeId: rule.attributeId, valueKind: rule.valueKind, enumValue: raw }; break;
      case "DATE": value = { attributeId: rule.attributeId, valueKind: rule.valueKind, dateValue: raw }; break;
    }
    if (!value) return null;
    (rule.variantAxis ? variantValues : productValues).push(value);
  }
  return { productValues, variantValues };
}

export function identifierResolutionNotice(match: CatalogIdentifierResolution): string {
  switch (match.outcome) {
    case "EXISTING_STORE_OFFER":
      return match.productName ? `هذا المنتج له عرض قائم في متجرك: ${match.productName}. عدّله من قائمة العروض أدناه.` : "هذا المنتج له عرض قائم في متجرك. عدّله من قائمة العروض أدناه.";
    case "UNKNOWN_IDENTIFIER":
      return "لم يُعثر على المنتج. أنشئ منتجًا خاصًا بهذا المتجر من قسم منتجات المتجر، أو أرسل مقترحًا للمراجعة.";
    case "VARIABLE_MEASURE_IDENTIFIER":
      return "هذا المنتج يباع بكمية متغيرة، ولا يمكن إنشاء عرض قابل للطلب حتى يكتمل مسار الكمية الفعلية.";
    case "UNAVAILABLE_IN_STORE":
      return "هذا المنتج مرتبط بمتجر آخر، ولا يمكن استخدامه في هذا المتجر.";
    default:
      return "تطابق الرمز مع أكثر من منتج. أوقف استخدامه واطلب مراجعة اسم المنتج.";
  }
}

export type ResolvedProductMatch = CatalogIdentifierResolution & { readonly outcome: "SHARED_PRODUCT_MATCH" | "STORE_LOCAL_PRODUCT_MATCH" };

export function isResolvedProductMatch(match: CatalogIdentifierResolution): match is ResolvedProductMatch {
  return match.outcome === "SHARED_PRODUCT_MATCH" || match.outcome === "STORE_LOCAL_PRODUCT_MATCH";
}

export function baseUnitOptions(kind: MeasurementKind | ""): BaseUnit[] {
  if (kind === "DISCRETE") return ["COUNT"];
  if (kind === "MEASURED" || kind === "VARIABLE_MEASURE") return ["GRAM", "MILLILITER"];
  return [];
}
