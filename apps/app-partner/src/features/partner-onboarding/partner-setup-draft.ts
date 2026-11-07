import type { StoreFulfillmentMode } from "@bthwani/dsh";
import type { FirstStoreRelation } from "./first-store-relation-choice";

/** In-memory form progress only. DSH remains the authority for a created Store. */
export type PartnerSetupDraft = Readonly<{
  step: 0 | 1 | 2 | 3;
  name: string;
  relation: FirstStoreRelation | "";
  address: string;
  city: string;
  vertical: string;
  storeType: string;
  modes: ReadonlyArray<StoreFulfillmentMode>;
  lat: string;
  lng: string;
}>;

// Keep only one active session's unsaved form; never persist owner/location data
// across app restarts or let a different Identity session read the old form.
let pending: { scope: string; draft: PartnerSetupDraft } | null = null;

export function readPartnerSetupDraft(scope: string): PartnerSetupDraft | null {
  if (!scope || pending?.scope !== scope) {
    pending = null;
    return null;
  }
  return { ...pending.draft, modes: [...pending.draft.modes] };
}

export function rememberPartnerSetupDraft(scope: string, draft: PartnerSetupDraft): void {
  if (!scope) return;
  pending = { scope, draft: { ...draft, modes: [...draft.modes] } };
}

export function clearPartnerSetupDraft(scope: string): void {
  if (scope && pending?.scope === scope) pending = null;
}
