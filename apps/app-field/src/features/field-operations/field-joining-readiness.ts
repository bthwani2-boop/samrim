import { isValidStoreWorkingHours, type JoiningCaseView } from "@bthwani/dsh";

export type FieldJoiningRequirement = Readonly<{
  key: "basic" | "wallet" | "city" | "vertical" | "storeType" | "address" | "location" | "hours" | "fulfillment" | "proofNumber";
  label: string;
  saved: boolean;
}>;

// One source for the draft checklist and submission preflight.
// Only canonical DSH readback may mark a requirement as saved.
export function getFieldJoiningRequirements(saved: JoiningCaseView | null): ReadonlyArray<FieldJoiningRequirement> {
  return [
    {
      key: "basic",
      label: "بيانات المالك والمتجر",
      saved: Boolean(saved?.ownerFullName?.trim() && saved.businessName.trim() && saved.firstStoreName.trim() && saved.contactPhoneE164),
    },
    { key: "wallet", label: "المحفظة الرسمية", saved: Boolean(saved?.walletProviderKey) },
    { key: "city", label: "مدينة الخدمة", saved: Boolean(saved?.serviceCityId) },
    { key: "vertical", label: "النشاط التجاري", saved: Boolean(saved?.firstStoreVerticalId) },
    { key: "storeType", label: "نوع المتجر", saved: Boolean(saved?.firstStoreCommercialTypeId) },
    { key: "address", label: "عنوان المتجر", saved: Boolean(saved?.firstStoreAddress && Array.from(saved.firstStoreAddress.trim()).length >= 4) },
    { key: "location", label: "موقع المتجر", saved: Boolean(saved?.firstStoreLatitude != null && saved.firstStoreLongitude != null && (saved.firstStoreLatitude !== 0 || saved.firstStoreLongitude !== 0)) },
    { key: "hours", label: "ساعات العمل", saved: Boolean(saved?.firstStoreWorkingHours?.intervals?.length && isValidStoreWorkingHours(saved.firstStoreWorkingHours.intervals)) },
    { key: "fulfillment", label: "طرق التوصيل", saved: Boolean(saved?.firstStoreFulfillmentModes.length) },
    { key: "proofNumber", label: "نوع ورقم الإثبات", saved: Boolean(saved?.firstStoreProofType && saved.firstStoreProofNumberPresent) },
  ];
}
