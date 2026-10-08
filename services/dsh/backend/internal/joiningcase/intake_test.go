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
		WalletProviderKey:          "provider-yemen",
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
		WalletProviderKey:          "provider-yemen",
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

func TestNormalizeFieldDraftRequestAcceptsPartialIntakeAndKeepsLocationUnset(t *testing.T) {
	request := contract.CreateJoiningCaseRequest{ContactPhoneE164: "+967700000001"}
	normalized, err := NormalizeFieldDraftRequest(request)
	if err != nil {
		t.Fatalf("partial Field draft was rejected: %v", err)
	}
	if normalized.Phone != "+967700000001" || normalized.ServiceCityID != "" || normalized.Latitude != 0 || normalized.Longitude != 0 || len(normalized.FulfillmentModes) != 0 {
		t.Fatalf("partial draft normalization invented facts: %+v", normalized)
	}
}

func TestNormalizeFieldDraftRequestRequiresPhoneAndValidatesProvidedFields(t *testing.T) {
	if _, err := NormalizeFieldDraftRequest(contract.CreateJoiningCaseRequest{}); err != ErrInvalidInput {
		t.Fatalf("missing contact phone error = %v, want %v", err, ErrInvalidInput)
	}
	request := contract.CreateJoiningCaseRequest{ContactPhoneE164: "+967700000001"}
	normalized, err := NormalizeFieldDraftRequest(request)
	if err != nil || normalized.Latitude != 0 || normalized.Longitude != 0 {
		t.Fatalf("unset location must remain unconfirmed: normalized=%+v error=%v", normalized, err)
	}
	request.FirstStoreLatitude, request.FirstStoreLongitude = 15.3, 44.2
	request.FirstStoreWorkingHours = contract.StoreWeeklyWorkingHours{Intervals: []contract.StoreWorkingHoursInterval{{DayOfWeek: 1, OpensAt: "17:00", ClosesAt: "09:00"}}}
	if _, err := NormalizeFieldDraftRequest(request); err != ErrInvalidInput {
		t.Fatalf("malformed provided hours error = %v, want %v", err, ErrInvalidInput)
	}
}
