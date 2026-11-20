/** DSH SDK entrypoint: preserve the package's public exports and owner boundaries. */


export type { CaptainApplicationStatus, CaptainStanding } from "./captain-standing.ts";
// DSH-owned Captain eligibility and application transport. No client-side role grant.
export {
  CaptainStandingError, captainStandingFrom, readApprovedCaptainStanding,
  readCaptainApplication, requestCaptainApplication,
} from "./captain-standing.ts";
export type {
  CityStoreOperationalPolicy, CityStoreOperationalPolicyChange, CityStoreOperationalPolicyResult,
} from "./city-policies.ts";
export { getCityStoreOperationalPolicy, replaceCityStoreOperationalPolicy } from "./city-policies.ts";
export { dshOperations } from "./generated/dsh-operations.ts";
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
export type { PublicOffer, PublicPage, PublicStore, PublicVertical } from "./public-discovery.ts";
export {
  DshPublicError, getPublicStore, listPublicOffers, listPublicStores, listPublicVerticals,
} from "./public-discovery.ts";
export type {
  StoreOperationalAvailability, StoreOperationalChange, StoreOperationalResult, StoreWeeklyWindow,
} from "./store-availability.ts";
export { getStoreOperationalAvailability, updateStoreOperationalAvailability } from "./store-availability.ts";
