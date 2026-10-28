package joiningcase

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// A Partner joining case created through Operator or self-service intake may be
// attributed to a verified Field representative without changing its owner.
// without giving that Field representative ownership of the joining case.
func (s *Service) AttributeFieldAcquisitionForOperator(ctx context.Context, caseID, fieldActorID, reason string, expectedVersion int, idempotencyKey, correlationID, operatorActorID string) (postgres.JoiningCaseResult, error) {
	if err := s.requireOperator(ctx, operatorActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	caseID, fieldActorID, reason = strings.TrimSpace(caseID), strings.TrimSpace(fieldActorID), strings.TrimSpace(reason)
	if caseID == "" || len(caseID) > 128 || fieldActorID == "" || len(fieldActorID) > 128 || expectedVersion < 1 || utf8.RuneCountInString(reason) < 8 || utf8.RuneCountInString(reason) > 400 {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	current, err := postgres.ReadJoiningCase(ctx, s.db, caseID)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if !postgres.CanAttributeJoiningCaseAcquisition(current.Case) || current.Case.FirstStoreServiceCityID == "" {
		return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseState
	}
	role, err := s.identity.ReadActorRole(ctx, fieldActorID, "field")
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	admission, err := postgres.ReadFieldAdmissionForActor(ctx, s.db, fieldActorID)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if role.Role != "field" || !role.Enabled || !role.SecurityEnabled || role.ActivatedAt == nil || admission.State != "eligible" || admission.RequiresProfileReview || admission.ActorID != fieldActorID || admission.FullNameAr == "" || !fieldScopeAdmitsServiceCity(admission.AllServiceCities, admission.ServiceCityIDs, current.Case.FirstStoreServiceCityID) {
		return postgres.JoiningCaseResult{}, postgres.ErrFieldAdmissionNotEligible
	}
	return postgres.AttributeJoiningCaseAcquisition(ctx, s.db, caseID, fieldActorID, operatorActorID, reason, expectedVersion, idempotencyKey, correlationID)
}

func fieldScopeAdmitsServiceCity(allCities bool, cityIDs []string, selectedCityID string) bool {
	if selectedCityID == "" {
		return false
	}
	if allCities {
		return true
	}
	for _, cityID := range cityIDs {
		if cityID == selectedCityID {
			return true
		}
	}
	return false
}
