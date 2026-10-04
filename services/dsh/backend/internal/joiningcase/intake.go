package joiningcase

import (
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func NormalizeCreateRequest(input contract.CreateJoiningCaseRequest) (postgres.JoiningCaseRequest, error) {
	phone := strings.TrimSpace(input.ContactPhoneE164)
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
	if !phoneE164Pattern.MatchString(phone) || utf8.RuneCountInString(ownerFullName) < 2 || utf8.RuneCountInString(ownerFullName) > 160 || utf8.RuneCountInString(businessName) < 2 || utf8.RuneCountInString(businessName) > 160 || utf8.RuneCountInString(firstStoreName) < 2 || utf8.RuneCountInString(firstStoreName) > 160 || utf8.RuneCountInString(firstStoreAddress) < 4 || utf8.RuneCountInString(firstStoreAddress) > 500 || len(proofNumber) < 1 || len(proofNumber) > 128 || utf8.RuneCountInString(notes) > 1000 || !validJoiningCaseProofType(proofType) || serviceCityID == "" || verticalID == "" || commercialTypeID == "" || !validCoordinates(input.FirstStoreLatitude, input.FirstStoreLongitude) {
		return postgres.JoiningCaseRequest{}, ErrInvalidInput
	}
	return postgres.JoiningCaseRequest{
		Phone:                  phone,
		OwnerFullName:          ownerFullName,
		BusinessName:           businessName,
		FirstStoreName:         firstStoreName,
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

func HashCreateRequest(keyring *postgres.JoiningCaseEvidenceKeyring, scope, actorID string, request postgres.JoiningCaseRequest) (string, error) {
	return keyring.RequestHash(scope, strings.TrimSpace(actorID), request.Phone, request.OwnerFullName, request.BusinessName, request.FirstStoreName, request.FirstStoreAddress, string(request.FirstStoreWorkingHours), request.FirstStoreProofType, request.FirstStoreProofNumber, request.FirstStoreNotes, request.ServiceCityID, request.VerticalID, request.CommercialTypeID, strconv.FormatFloat(request.Latitude, 'f', 6, 64), strconv.FormatFloat(request.Longitude, 'f', 6, 64), strings.Join(request.FulfillmentModes, ","))
}
