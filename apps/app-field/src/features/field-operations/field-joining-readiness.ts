import { isValidStoreWorkingHours, type JoiningCaseView } from "@bthwani/dsh";

export type FieldJoiningRequirement = Readonly<{
  key: "basic" | "wallet" | "operation" | "proofNumber" | "storeImage";
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
    {
      key: "operation",
      label: "المدينة والتشغيل والموقع",
      saved: Boolean(saved?.serviceCityId && saved.firstStoreVerticalId && saved.firstStoreCommercialTypeId &&
        saved.firstStoreAddress?.trim() && saved.firstStoreLatitude != null && saved.firstStoreLongitude != null &&
        (saved.firstStoreLatitude !== 0 || saved.firstStoreLongitude !== 0) &&
        saved.firstStoreFulfillmentModes.length && isValidStoreWorkingHours(saved.firstStoreWorkingHours?.intervals ?? [])),
    },
    { key: "proofNumber", label: "نوع ورقم الإثبات", saved: Boolean(saved?.firstStoreProofType && saved.firstStoreProofNumberPresent) },
    { key: "storeImage", label: "شعار المتجر", saved: Boolean(saved?.storeProfileImage) },
  ];
}
