/** DSH SDK entrypoint: preserve the package's public exports and owner boundaries. */


export type { CaptainInterestInput, CaptainPhoneType, CaptainVehicleType, OperatorCaptainInterest, OperatorCaptainInterestFilter, OperatorCaptainInterestPage } from "./captain-interest.ts";
export { captainPhoneTypes, captainVehicleTypes, isOperatorCaptainInterest, listOperatorCaptainInterest, markOperatorCaptainInterestContacted, submitCaptainInterest, validCaptainInterest } from "./captain-interest.ts";
export type { CaptainApplicationStatus, CaptainStanding } from "./captain-standing.ts";
// DSH-owned Captain eligibility and application transport. No client-side role grant.
export {
  CaptainStandingError, captainStandingFrom, readApprovedCaptainStanding,
  readCaptainApplication, requestCaptainApplication,
} from "./captain-standing.ts";
export type { MerchantCatalogImportChange, MerchantCatalogImportOutcome, MerchantCatalogImportResult, MerchantCatalogImportRow } from "./catalog-import.ts";
export { merchantCatalogImport, parseMerchantCatalogImportResult, validMerchantCatalogImportChange } from "./catalog-import.ts";
export type {
  CityDeliveryDistanceBand, CityDeliveryPolicy, CityDeliveryPolicyChange, CityDeliveryPolicyPreview, CityDeliveryPolicyPreviewInput, CityDeliveryPolicyResult, CityDeliveryPolicyState, CityStoreOperationalPolicy, CityStoreOperationalPolicyChange, CityStoreOperationalPolicyHistoryPage, CityStoreOperationalPolicyResult,
} from "./city-policies.ts";
export { getCityDeliveryPolicy, getCityStoreOperationalPolicy, isCityDeliveryDistanceBands, isCityDeliveryPolicy, isCityDeliveryPolicyChange, isCityDeliveryPolicyPreview, isCityDeliveryPolicyPreviewInput, isCityDeliveryPolicyResult, isCityDeliveryPolicyState, isCityStoreOperationalPolicyHistoryPage, listCityStoreOperationalPolicyHistory, matchesCityDeliveryPolicy, previewCityDeliveryPolicy, replaceCityDeliveryPolicy, replaceCityStoreOperationalPolicy } from "./city-policies.ts";
export type { CustomerAddress, CustomerAddressChange, CustomerAddressPage, CustomerAddressRead, CustomerAddressResult, DeliveryServiceability } from "./customer-addresses.ts";
export { evaluateDeliveryServiceability, getCustomerAddress, isCustomerAddressId, listCustomerAddresses, parseCustomerAddress, parseCustomerAddressPage, parseCustomerAddressResult, parseDeliveryServiceability, saveCustomerAddress, validCustomerAddressChange } from "./customer-addresses.ts";
export type { CustomerCart, CustomerCartChange, CustomerCartLine, CustomerCartMerchandiseEstimate, CustomerCartMerchandiseEstimateLine, CustomerCartResult } from "./customer-cart.ts";
export { DshCartError, parseCustomerCart, parseCustomerCartMerchandiseEstimate, parseCustomerCartResult, readCurrentCustomerCart, readCurrentCustomerCartMerchandiseEstimate, replaceCurrentCustomerCart } from "./customer-cart.ts";
export type { CheckoutFulfillmentMode, CheckoutRecipientPurpose, CustomerCheckoutBlocker, CustomerCheckoutReview, CustomerCheckoutReviewInput } from "./customer-checkout-review.ts";
export { parseCustomerCheckoutReview, reviewCurrentCustomerCheckout, validCustomerCheckoutReviewInput } from "./customer-checkout-review.ts";
export type { CompanyEmployee, CompanyEmployeeRegistration, CompanyEmployeeRegistrationAudit, EmployeeRecord, EmployeeRegistration } from "./employees.ts";
export { getCompanyEmployee, getCompanyEmployeeRegistrationAudit, getMerchantEmployee, getMerchantEmployeeRegistrationAudit, isCompanyEmployeeId, listCompanyEmployees, listMerchantEmployees, parseEmployeeDetail, parseEmployeePage, parseEmployeeRegistrationAudit, registerCompanyEmployee, registerMerchantEmployee, validEmployeeRegistration } from "./employees.ts";
export { dshOperations } from "./generated/dsh-operations.ts";
export type { MerchantCatalogDraftChange, MerchantCatalogDraftEditChange, MerchantCatalogDraftEditResult, MerchantCatalogDraftResult, MerchantCatalogOffer, MerchantCatalogPage, MerchantCatalogStatus, MerchantInventorySummary } from "./merchant-catalog.ts";
export { createMerchantCatalogDraft, listMerchantCatalog, parseMerchantCatalogDraftEditResult, parseMerchantCatalogDraftResult, parseMerchantCatalogPage, parseMerchantInventorySummary, readMerchantInventorySummary, updateMerchantCatalogDraft, validMerchantCatalogDraft, validMerchantCatalogDraftEdit, validMerchantCatalogSearch, validMerchantCatalogStatus } from "./merchant-catalog.ts";
export type { MerchantRegistrationChoice, MerchantRegistrationOptions, MerchantRegistrationResult, MerchantStoreRegistration } from "./merchant-registration.ts";
export { parseMerchantRegistrationOptions, parseMerchantRegistrationResult, readMerchantRegistrationOptions, registerMerchantStore, validMerchantStoreRegistration } from "./merchant-registration.ts";
// DSH-owned Merchant standing contract and transport.
export type { MerchantDSHStanding, MerchantOwnedStore } from "./merchant-standing.ts";
export { MerchantStandingError, readMerchantDSHStanding, standingFrom } from "./merchant-standing.ts";
export type {
  CaptainStandingStatus, OperatorCaptainStanding, OperatorCaptainStandingChange,
  OperatorCaptainStandingPage,
} from "./operator-captains.ts";
export {
  captainStandingStatuses, changeOperatorCaptainStanding, getOperatorCaptainStanding,
  isCaptainStandingActorId, listOperatorCaptainStandings,
} from "./operator-captains.ts";
export type { PublicationReviewItem, PublicationReviewPage } from "./operator-publication-review.ts";
export { isPublicationReviewPage, listOperatorStorePublicationReview } from "./operator-publication-review.ts";
export type { OperatorStoreRegistrationChange, OperatorStoreRegistrationPolicy, OperatorStoreRegistrationResult, StoreRegistrationRelation } from "./operator-store-registration-policy.ts";
export { changeOperatorStoreRegistrationPolicy, getOperatorStoreRegistrationPolicy, isOperatorStoreRegistrationPolicy, validOperatorStoreRegistrationChange } from "./operator-store-registration-policy.ts";
export type { OperatorStoreRegistrationPolicyHistoryEntry, OperatorStoreRegistrationPolicyHistoryPage } from "./operator-store-registration-policy-history.ts";
export { isStoreRegistrationPolicyHistoryPage, listOperatorStoreRegistrationPolicyHistory } from "./operator-store-registration-policy-history.ts";
export type { PublicOffer, PublicOfferEstimate, PublicPage, PublicStore, PublicVertical } from "./public-discovery.ts";
export {
  DshPublicError, estimatePublicOffer, getPublicStore, isPublicOfferPriceYer, listPublicCities, listPublicOffers, listPublicStores, listPublicVerticals,
  parseOfferEstimateQuantity,
} from "./public-discovery.ts";
export type {
  StoreOperationalAvailability, StoreOperationalChange, StoreOperationalResult, StoreWeeklyWindow,
} from "./store-availability.ts";
export { getStoreOperationalAvailability, updateStoreOperationalAvailability } from "./store-availability.ts";

export type { FavoriteStoreState, FavoriteStorePage } from "./favorite-stores.ts";
export { isFavoriteStoreId, parseFavoriteStorePage, parseFavoriteStoreState, listCustomerFavoriteStores, getCustomerFavoriteStore, setCustomerFavoriteStore } from "./favorite-stores.ts";
