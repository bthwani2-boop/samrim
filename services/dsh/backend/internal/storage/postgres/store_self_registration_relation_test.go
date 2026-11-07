package postgres

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func TestFirstStoreRelationRetainsLegacyMarketplaceID(t *testing.T) {
	input := SelfStoreInput{
		RelationModel: StoreRelationBThwaniPartner,
		Name:          "Shop Alpha", ServiceCityID: "sanaa", VerticalID: "market",
		CommercialTypeID: "small", Address: "Sanaa Main Road",
		Latitude: 15.36, Longitude: 44.20,
		FulfillmentModes: []string{"CUSTOMER_PICKUP"},
	}
	legacy := struct {
		Name             string
		ServiceCityID    string
		VerticalID       string
		CommercialTypeID string
		Address          string
		Latitude         float64
		Longitude        float64
		FulfillmentModes []string
	}{
		input.Name, input.ServiceCityID, input.VerticalID, input.CommercialTypeID,
		input.Address, input.Latitude, input.Longitude, input.FulfillmentModes,
	}
	oldCanonical, err := json.Marshal(struct {
		Owner string
		Input any
	}{"same-owner", legacy})
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(oldCanonical)
	originalID := "store_" + hex.EncodeToString(sum[:16])

	actualID, err := firstStoreDeterministicID("same-owner", input)
	if err != nil || actualID != originalID {
		t.Fatalf("marketplace creation changed legacy canonical id: %s vs %s err=%v", actualID, originalID, err)
	}
	independent := input
	independent.RelationModel = StoreRelationIndependent
	separateID, err := firstStoreDeterministicID("same-owner", independent)
	if err != nil || separateID == originalID {
		t.Fatalf("independent relationship must not alias marketplace id, got %s: %v", separateID, err)
	}
}
