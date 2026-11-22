/** DSH SDK entrypoint: preserve the package's public exports and owner boundaries. */


export type { CaptainApplicationStatus, CaptainStanding } from "./captain-standing.ts";
export type { CaptainInterestInput, CaptainPhoneType, CaptainVehicleType, OperatorCaptainInterest, OperatorCaptainInterestFilter, OperatorCaptainInterestPage } from "./captain-interest.ts";
export { captainVehicleTypes, captainPhoneTypes, validCaptainInterest, isOperatorCaptainInterest, submitCaptainInterest, listOperatorCaptainInterest, markOperatorCaptainInterestContacted } from "./captain-interest.ts";
// DSH-owned Captain eligibility and application transport. No client-side role grant.
export {
  CaptainStandingError, captainStandingFrom, readApprovedCaptainStanding,
  readCaptainApplication, requestCaptainApplication,
} from "./captain-standing.ts";
export type {
  CityStoreOperationalPolicy, CityStoreOperationalPolicyChange, CityStoreOperationalPolicyResult,
} from "./city-policies.ts";
export { getCityStoreOperationalPolicy, replaceCityStoreOperationalPolicy } from "./city-policies.ts";
export type { CustomerCart, CustomerCartChange, CustomerCartLine, CustomerCartMerchandiseEstimate, CustomerCartMerchandiseEstimateLine, CustomerCartResult } from "./customer-cart.ts";
export { DshCartError, parseCustomerCart, parseCustomerCartMerchandiseEstimate, parseCustomerCartResult, readCurrentCustomerCart, readCurrentCustomerCartMerchandiseEstimate, replaceCurrentCustomerCart } from "./customer-cart.ts";
export type { CompanyEmployee, CompanyEmployeeRegistration } from "./employees.ts";
export { getCompanyEmployee, isCompanyEmployeeId, listCompanyEmployees, registerCompanyEmployee } from "./employees.ts";
export { dshOperations } from "./generated/dsh-operations.ts";
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
export type { OperatorStoreRegistrationChange, OperatorStoreRegistrationPolicy, OperatorStoreRegistrationResult, StoreRegistrationRelation } from "./operator-store-registration-policy.ts";
export { changeOperatorStoreRegistrationPolicy, getOperatorStoreRegistrationPolicy, isOperatorStoreRegistrationPolicy, validOperatorStoreRegistrationChange } from "./operator-store-registration-policy.ts";
export type { PublicOffer, PublicOfferEstimate, PublicPage, PublicStore, PublicVertical } from "./public-discovery.ts";
export {
  DshPublicError, estimatePublicOffer, getPublicStore, isPublicOfferPriceYer, listPublicCities, listPublicOffers, listPublicStores, listPublicVerticals,
  parseOfferEstimateQuantity,
} from "./public-discovery.ts";
export type {
  StoreOperationalAvailability, StoreOperationalChange, StoreOperationalResult, StoreWeeklyWindow,
} from "./store-availability.ts";
export { getStoreOperationalAvailability, updateStoreOperationalAvailability } from "./store-availability.ts";
