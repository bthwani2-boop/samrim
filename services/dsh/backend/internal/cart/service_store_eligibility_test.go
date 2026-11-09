package cart

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestStoreCheckoutEligibilityRequiresPublishedPartnerOwnedFulfillment(t *testing.T) {
	store := postgres.StoreRecord{
		RelationModel:    postgres.StoreRelationBThwaniPartner,
		PublicationState: "published",
		PartnerActorID:   "partner-1",
		FulfillmentModes: []string{
			FulfillmentModeBthwaniCaptain,
			FulfillmentModePartnerCaptain,
			FulfillmentModeCustomerPickup,
		},
	}
	for _, tc := range []struct {
		name  string
		store postgres.StoreRecord
		mode  string
		want  bool
	}{
		{name: "bthwani delivery permitted", store: store, mode: FulfillmentModeBthwaniCaptain, want: true},
		{name: "partner delivery permitted", store: store, mode: FulfillmentModePartnerCaptain, want: true},
		{name: "customer pickup permitted", store: store, mode: FulfillmentModeCustomerPickup, want: true},
		{name: "independent relation cannot quote marketplace pickup", store: postgres.StoreRecord{RelationModel: postgres.StoreRelationIndependent, PublicationState: "published", PartnerActorID: "partner-1", FulfillmentModes: store.FulfillmentModes}, mode: FulfillmentModeCustomerPickup},
		{name: "unknown relation cannot quote marketplace pickup", store: postgres.StoreRecord{RelationModel: "UNKNOWN", PublicationState: "published", PartnerActorID: "partner-1", FulfillmentModes: store.FulfillmentModes}, mode: FulfillmentModeCustomerPickup},
		{name: "unrecorded relation cannot quote marketplace pickup", store: postgres.StoreRecord{PublicationState: "published", PartnerActorID: "partner-1", FulfillmentModes: store.FulfillmentModes}, mode: FulfillmentModeCustomerPickup},
		{name: "missing partner owner", store: postgres.StoreRecord{PublicationState: "published", FulfillmentModes: store.FulfillmentModes}, mode: FulfillmentModeCustomerPickup},
		{name: "whitespace partner owner", store: postgres.StoreRecord{RelationModel: postgres.StoreRelationBThwaniPartner, PublicationState: "published", PartnerActorID: "   ", FulfillmentModes: store.FulfillmentModes}, mode: FulfillmentModeCustomerPickup},
		{name: "store draft", store: postgres.StoreRecord{RelationModel: postgres.StoreRelationBThwaniPartner, PublicationState: "draft", PartnerActorID: "partner-1", FulfillmentModes: store.FulfillmentModes}, mode: FulfillmentModeCustomerPickup},
		{name: "store paused", store: postgres.StoreRecord{RelationModel: postgres.StoreRelationBThwaniPartner, PublicationState: "paused", PartnerActorID: "partner-1", FulfillmentModes: store.FulfillmentModes}, mode: FulfillmentModeCustomerPickup},
		{name: "mode not offered", store: postgres.StoreRecord{RelationModel: postgres.StoreRelationBThwaniPartner, PublicationState: "published", PartnerActorID: "partner-1", FulfillmentModes: []string{FulfillmentModeCustomerPickup}}, mode: FulfillmentModePartnerCaptain},
		{name: "no modes", store: postgres.StoreRecord{RelationModel: postgres.StoreRelationBThwaniPartner, PublicationState: "published", PartnerActorID: "partner-1"}, mode: FulfillmentModeCustomerPickup},
		{name: "unknown mode", store: store, mode: "UNKNOWN"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := storeAllowsCheckout(tc.store, tc.mode); got != tc.want {
				t.Fatalf("storeAllowsCheckout(%+v, %q) = %t, want %t", tc.store, tc.mode, got, tc.want)
			}
		})
	}
}
