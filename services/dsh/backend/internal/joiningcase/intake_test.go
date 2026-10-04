package joiningcase

import (
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
)

func TestNormalizeCreateRequestCountsProofNumberRunes(t *testing.T) {
	request := contract.CreateJoiningCaseRequest{
		ContactPhoneE164:           "+967700000001",
		OwnerFullName:              "مالك المتجر",
		BusinessName:               "نشاط المتجر",
		FirstStoreName:             "متجر الاختبار",
		FirstStoreAddress:          "الشارع الرئيسي",
		ServiceCityID:              "city-1",
		FirstStoreVerticalID:       "vertical-1",
		FirstStoreCommercialTypeID: "store-type-1",
		FirstStoreLatitude:         15.369445,
		FirstStoreLongitude:        44.191006,
		FirstStoreWorkingHours: contract.StoreWeeklyWorkingHours{Intervals: []contract.StoreWorkingHoursInterval{{
			DayOfWeek: 1, OpensAt: "09:00", ClosesAt: "17:00",
		}}},
		FirstStoreProofType:        contract.JoiningCaseProofType("COMMERCIAL_REGISTRATION"),
		FirstStoreProofNumber:      strings.Repeat("文", 128),
		FirstStoreFulfillmentModes: []contract.StoreFulfillmentMode{contract.StoreFulfillmentMode("BTHWANI_CAPTAIN")},
	}
	if _, err := NormalizeCreateRequest(request); err != nil {
		t.Fatalf("128-codepoint proof number rejected: %v", err)
	}

	request.FirstStoreProofNumber = strings.Repeat("文", 129)
	if _, err := NormalizeCreateRequest(request); err != ErrInvalidInput {
		t.Fatalf("129-codepoint proof number error = %v, want %v", err, ErrInvalidInput)
	}
}

func TestValidJoiningCaseProofNumberBoundsUnicodeCodepoints(t *testing.T) {
	if !validJoiningCaseProofNumber(strings.Repeat("文", 128)) {
		t.Fatal("128-codepoint proof number rejected")
	}
	if validJoiningCaseProofNumber(strings.Repeat("文", 129)) {
		t.Fatal("129-codepoint proof number accepted")
	}
}

func TestNormalizeCreateRequestRequiresFulfillmentMode(t *testing.T) {
	request := contract.CreateJoiningCaseRequest{
		ContactPhoneE164:           "+967700000001",
		OwnerFullName:              "مالك المتجر",
		BusinessName:               "نشاط المتجر",
		FirstStoreName:             "متجر الاختبار",
		FirstStoreAddress:          "الشارع الرئيسي",
		ServiceCityID:              "city-1",
		FirstStoreVerticalID:       "vertical-1",
		FirstStoreCommercialTypeID: "store-type-1",
		FirstStoreLatitude:         15.369445,
		FirstStoreLongitude:        44.191006,
		FirstStoreWorkingHours: contract.StoreWeeklyWorkingHours{Intervals: []contract.StoreWorkingHoursInterval{{
			DayOfWeek: 1, OpensAt: "09:00", ClosesAt: "17:00",
		}}},
		FirstStoreProofType:   contract.JoiningCaseProofType("COMMERCIAL_REGISTRATION"),
		FirstStoreProofNumber: "12345",
	}
	if _, err := NormalizeCreateRequest(request); err != ErrInvalidInput {
		t.Fatalf("empty fulfillment modes error = %v, want %v", err, ErrInvalidInput)
	}
}
