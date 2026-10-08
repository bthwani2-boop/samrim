package joiningcase

import (
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	phoneformat "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/phone"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func NormalizeCreateRequest(input contract.CreateJoiningCaseRequest) (postgres.JoiningCaseRequest, error) {
	phone := phoneformat.NormalizeYemenE164(input.ContactPhoneE164)
	ownerFullName := strings.TrimSpace(input.OwnerFullName)
	businessName := strings.TrimSpace(input.BusinessName)
	firstStoreName := strings.TrimSpace(input.FirstStoreName)
	firstStoreAddress := strings.TrimSpace(input.FirstStoreAddress)
	proofType := strings.TrimSpace(string(input.FirstStoreProofType))
	proofNumber := strings.TrimSpace(input.FirstStoreProofNumber)
	notes := strings.TrimSpace(input.FirstStoreNotes)
	serviceCityID := strings.TrimSpace(input.ServiceCityID)
	verticalID := strings.TrimSpace(input.FirstStoreVerticalID)
	commercialTypeID := strings.TrimSpace(input.FirstStoreCommercialTypeID)
	walletProviderKey, providerKeyValid := postgres.NormalizeWalletProviderKey(input.WalletProviderKey)
	workingHours, hoursErr := json.Marshal(input.FirstStoreWorkingHours)
	if hoursErr != nil || !postgres.ValidateStoreWorkingHours(workingHours) || len(input.FirstStoreFulfillmentModes) == 0 {
		return postgres.JoiningCaseRequest{}, ErrInvalidInput
	}
	rawModes := make([]string, len(input.FirstStoreFulfillmentModes))
	for index, mode := range input.FirstStoreFulfillmentModes {
		rawModes[index] = string(mode)
	}
	fulfillmentModes, modesErr := postgres.NormalizeStoreFulfillmentModes(rawModes)
	if modesErr != nil {
		return postgres.JoiningCaseRequest{}, ErrInvalidInput
	}
	if !phoneformat.IsE164(phone) || utf8.RuneCountInString(ownerFullName) < 2 || utf8.RuneCountInString(ownerFullName) > 160 || utf8.RuneCountInString(businessName) < 2 || utf8.RuneCountInString(businessName) > 160 || utf8.RuneCountInString(firstStoreName) < 2 || utf8.RuneCountInString(firstStoreName) > 160 || utf8.RuneCountInString(firstStoreAddress) < 4 || utf8.RuneCountInString(firstStoreAddress) > 500 || !validJoiningCaseProofNumber(proofNumber) || utf8.RuneCountInString(notes) > 1000 || !validJoiningCaseProofType(proofType) || serviceCityID == "" || verticalID == "" || commercialTypeID == "" || !providerKeyValid || !validCoordinates(input.FirstStoreLatitude, input.FirstStoreLongitude) {
		return postgres.JoiningCaseRequest{}, ErrInvalidInput
	}
	return postgres.JoiningCaseRequest{
		Phone:                  phone,
		OwnerFullName:          ownerFullName,
		BusinessName:           businessName,
		FirstStoreName:         firstStoreName,
		WalletProviderKey:      walletProviderKey,
		FirstStoreAddress:      firstStoreAddress,
		FirstStoreWorkingHours: workingHours,
		FirstStoreProofType:    proofType,
		FirstStoreProofNumber:  proofNumber,
		FirstStoreNotes:        notes,
		ServiceCityID:          serviceCityID,
		VerticalID:             verticalID,
		CommercialTypeID:       commercialTypeID,
		Latitude:               input.FirstStoreLatitude,
		Longitude:              input.FirstStoreLongitude,
		FulfillmentModes:       fulfillmentModes,
	}, nil
}

// NormalizeFieldDraftRequest accepts an incomplete Field draft while applying
// the same canonical normalization and per-field limits used at submission.
// Completeness and active catalog checks remain enforced at submit time.
func NormalizeFieldDraftRequest(input contract.CreateJoiningCaseRequest) (postgres.JoiningCaseRequest, error) {
	phone := phoneformat.NormalizeYemenE164(input.ContactPhoneE164)
	if !phoneformat.IsE164(phone) {
		return postgres.JoiningCaseRequest{}, ErrInvalidInput
	}
	ownerFullName := strings.TrimSpace(input.OwnerFullName)
	businessName := strings.TrimSpace(input.BusinessName)
	firstStoreName := strings.TrimSpace(input.FirstStoreName)
	address := strings.TrimSpace(input.FirstStoreAddress)
	proofType := strings.TrimSpace(string(input.FirstStoreProofType))
	proofNumber := strings.TrimSpace(input.FirstStoreProofNumber)
	notes := strings.TrimSpace(input.FirstStoreNotes)
	if (ownerFullName != "" && (utf8.RuneCountInString(ownerFullName) < 2 || utf8.RuneCountInString(ownerFullName) > 160)) ||
		(businessName != "" && (utf8.RuneCountInString(businessName) < 2 || utf8.RuneCountInString(businessName) > 160)) ||
		(firstStoreName != "" && (utf8.RuneCountInString(firstStoreName) < 2 || utf8.RuneCountInString(firstStoreName) > 160)) ||
		(address != "" && (utf8.RuneCountInString(address) < 4 || utf8.RuneCountInString(address) > 500)) || utf8.RuneCountInString(notes) > 1000 ||
		(proofNumber != "" && !validJoiningCaseProofNumber(proofNumber)) || (proofType != "" && !validJoiningCaseProofType(proofType)) {
		return postgres.JoiningCaseRequest{}, ErrInvalidInput
	}
	hours := json.RawMessage(nil)
	if len(input.FirstStoreWorkingHours.Intervals) > 0 {
		var err error
		hours, err = json.Marshal(input.FirstStoreWorkingHours)
		if err != nil || !postgres.ValidateStoreWorkingHours(hours) {
			return postgres.JoiningCaseRequest{}, ErrInvalidInput
		}
	}
	modes := []string{}
	if len(input.FirstStoreFulfillmentModes) > 0 {
		raw := make([]string, len(input.FirstStoreFulfillmentModes))
		for i, mode := range input.FirstStoreFulfillmentModes {
			raw[i] = string(mode)
		}
		var err error
		modes, err = postgres.NormalizeStoreFulfillmentModes(raw)
		if err != nil {
			return postgres.JoiningCaseRequest{}, ErrInvalidInput
		}
	}
	provider := strings.TrimSpace(input.WalletProviderKey)
	if provider != "" {
		var ok bool
		provider, ok = postgres.NormalizeWalletProviderKey(provider)
		if !ok {
			return postgres.JoiningCaseRequest{}, ErrInvalidInput
		}
	}
	serviceCityID := strings.TrimSpace(input.ServiceCityID)
	verticalID := strings.TrimSpace(input.FirstStoreVerticalID)
	commercialTypeID := strings.TrimSpace(input.FirstStoreCommercialTypeID)
	coordinatesSupplied := input.FirstStoreLatitude != 0 || input.FirstStoreLongitude != 0
	if coordinatesSupplied && (!validCoordinates(input.FirstStoreLatitude, input.FirstStoreLongitude) || (input.FirstStoreLatitude == 0 && input.FirstStoreLongitude == 0)) {
		return postgres.JoiningCaseRequest{}, ErrInvalidInput
	}
	return postgres.JoiningCaseRequest{
		Phone: phone, OwnerFullName: ownerFullName, BusinessName: businessName, FirstStoreName: firstStoreName,
		WalletProviderKey: provider, FirstStoreAddress: address, FirstStoreWorkingHours: hours,
		FirstStoreProofType: proofType, FirstStoreProofNumber: proofNumber, FirstStoreNotes: notes,
		ServiceCityID: serviceCityID, VerticalID: verticalID, CommercialTypeID: commercialTypeID,
		Latitude: input.FirstStoreLatitude, Longitude: input.FirstStoreLongitude, FulfillmentModes: modes,
	}, nil
}

func validJoiningCaseProofNumber(value string) bool {
	runeCount := utf8.RuneCountInString(value)
	return runeCount >= 1 && runeCount <= 128
}

func HashCreateRequest(keyring *postgres.JoiningCaseEvidenceKeyring, scope, actorID string, request postgres.JoiningCaseRequest) (string, error) {
	return keyring.RequestHash(scope, strings.TrimSpace(actorID), request.Phone, request.OwnerFullName, request.BusinessName, request.FirstStoreName, request.WalletProviderKey, request.FirstStoreAddress, string(request.FirstStoreWorkingHours), request.FirstStoreProofType, request.FirstStoreProofNumber, request.FirstStoreNotes, request.ServiceCityID, request.VerticalID, request.CommercialTypeID, strconv.FormatFloat(request.Latitude, 'f', 6, 64), strconv.FormatFloat(request.Longitude, 'f', 6, 64), strings.Join(request.FulfillmentModes, ","))
}

func HashFieldDraftUpdateRequest(keyring *postgres.JoiningCaseEvidenceKeyring, actorID, caseID string, expectedVersion int, preserveProofNumber bool, request postgres.JoiningCaseRequest) (string, error) {
	scope := "field-joining-case-draft-update:" + strings.TrimSpace(caseID) + ":" + strconv.Itoa(expectedVersion) + ":" + strconv.FormatBool(preserveProofNumber)
	return HashCreateRequest(keyring, scope, actorID, request)
}
