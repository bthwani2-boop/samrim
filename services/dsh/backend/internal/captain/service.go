package captain

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var (
	ErrInvalidInput                = errors.New("captain input is invalid")
	ErrOperatorNotActive           = errors.New("operator is not active")
	ErrCaptainSessionForbidden     = errors.New("an active app-captain session is required")
	ErrPartnerSessionForbidden     = errors.New("an active app-partner session is required")
	ErrManagedRoleClosed           = errors.New("managed role mutation is outside the DSH-owned domain boundary")
	ErrManagedRoleNotEligible      = errors.New("managed role is not currently eligible in its owning domain")
	ErrManagedRoleVersionConflict  = errors.New("managed role version is stale")
	ErrCaptainIdentityUnavailable  = errors.New("captain identity was not provisioned")
	ErrPaymentUnavailable          = errors.New("payment collection is unavailable")
	ErrCollectionAmountMismatch    = errors.New("collected amount does not match the order amount")
	ErrLocationStateConflict       = errors.New("captain location is only publishable while the order is in custody")
	ErrLocationIdempotencyConflict = errors.New("captain location idempotency key conflicts with a previous request")
)

var phoneE164Pattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
	payment  *wlt.Client
}

func New(identity *identityintegration.Client, db *sql.DB, payment *wlt.Client) (*Service, error) {
	if identity == nil || db == nil || payment == nil {
		return nil, errors.New("captain configuration is invalid")
	}
	return &Service{identity: identity, db: db, payment: payment}, nil
}

func (s *Service) Admit(ctx context.Context, phone, idempotencyKey, actingActorID, correlationID string) (postgres.CaptainAdmission, bool, error) {
	phone = strings.TrimSpace(phone)
	if !phoneE164Pattern.MatchString(phone) || !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.CaptainAdmission{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainAdmission{}, false, err
	}
	hash := postgres.HashCaptainAdmissionRequest(phone)
	admission, replayed, err := postgres.CreateCaptainAdmissionCandidate(ctx, s.db, phone, strings.TrimSpace(idempotencyKey), hash, strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
	if err != nil {
		return postgres.CaptainAdmission{}, false, err
	}
	if admission.State == "eligible" {
		return admission, replayed, nil
	}
	role, err := s.identity.ProvisionCaptainWithContext(ctx, identityintegration.ActorInput{PhoneE164: phone}, correlationID, actingActorID)
	if err != nil {
		return postgres.CaptainAdmission{}, false, err
	}
	if role.Role != "captain" || strings.TrimSpace(role.ActorID) == "" {
		return postgres.CaptainAdmission{}, false, ErrCaptainIdentityUnavailable
	}
	bound, err := postgres.BindCaptainAdmission(ctx, s.db, admission.ID, role.ActorID, strings.TrimSpace(idempotencyKey), hash, strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
	if err != nil {
		return postgres.CaptainAdmission{}, false, err
	}
	return bound, false, nil
}

func (s *Service) ReadForOperator(ctx context.Context, admissionID, actingActorID string) (postgres.CaptainAdmission, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainAdmission{}, err
	}
	return postgres.ReadCaptainAdmission(ctx, s.db, admissionID)
}

func (s *Service) ReadForOperatorByActor(ctx context.Context, actorID, actingActorID string) (postgres.CaptainAdmission, error) {
	if strings.TrimSpace(actorID) == "" {
		return postgres.CaptainAdmission{}, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainAdmission{}, err
	}
	return postgres.ReadCaptainAdmissionForActor(ctx, s.db, actorID)
}

func (s *Service) ReadForCaptain(ctx context.Context, accessToken string) (postgres.CaptainAdmission, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.CaptainAdmission{}, err
	}
	return postgres.ReadCaptainAdmissionForActor(ctx, s.db, identity.Subject)
}

func (s *Service) ReadForPartner(ctx context.Context, accessToken, storeID, orderID string) (postgres.CaptainAssignment, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return postgres.CaptainAssignment{}, err
	}
	if _, err := postgres.ReadStoreOwnedByPartner(ctx, s.db, strings.TrimSpace(storeID), identity.Subject); err != nil {
		if errors.Is(err, postgres.ErrStoreNotFound) {
			return postgres.CaptainAssignment{}, ErrPartnerSessionForbidden
		}
		return postgres.CaptainAssignment{}, err
	}
	assignment, err := postgres.ReadCaptainAssignmentForOrder(ctx, s.db, strings.TrimSpace(orderID))
	if err != nil {
		return postgres.CaptainAssignment{}, err
	}
	if assignment.Handoff.StoreID != strings.TrimSpace(storeID) {
		return postgres.CaptainAssignment{}, ErrPartnerSessionForbidden
	}
	return assignment, nil
}

func (s *Service) SetAvailability(ctx context.Context, accessToken string, available bool, expectedVersion int, idempotencyKey, correlationID string) (postgres.CaptainAdmission, bool, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.CaptainAdmission{}, false, err
	}
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.CaptainAdmission{}, false, ErrInvalidInput
	}
	return postgres.SetCaptainAvailability(ctx, s.db, identity.Subject, available, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCaptainAvailabilityRequest(identity.Subject, available, expectedVersion), identity.Subject, strings.TrimSpace(correlationID))
}

func (s *Service) ListOffers(ctx context.Context, accessToken string, limit int) ([]postgres.CaptainOffer, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 {
		return nil, ErrInvalidInput
	}
	return postgres.ListCaptainOffers(ctx, s.db, identity.Subject, limit)
}

func (s *Service) RespondToOffer(ctx context.Context, accessToken, offerID, decision string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CaptainOfferResult, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.CaptainOfferResult{}, err
	}
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.CaptainOfferResult{}, ErrInvalidInput
	}
	return postgres.RespondToCaptainOffer(ctx, s.db, strings.TrimSpace(offerID), identity.Subject, decision, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCaptainOfferResponse(offerID, decision, expectedVersion), strings.TrimSpace(correlationID))
}

func (s *Service) ListAssignments(ctx context.Context, accessToken string, limit int) ([]postgres.CaptainAssignment, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 {
		return nil, ErrInvalidInput
	}
	return postgres.ListCaptainAssignments(ctx, s.db, identity.Subject, limit)
}

func (s *Service) ReadDeliveryTask(ctx context.Context, accessToken, assignmentID string) (postgres.CaptainDeliveryTask, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.CaptainDeliveryTask{}, err
	}
	if strings.TrimSpace(assignmentID) == "" {
		return postgres.CaptainDeliveryTask{}, ErrInvalidInput
	}
	return postgres.ReadCaptainDeliveryTask(ctx, s.db, strings.TrimSpace(assignmentID), identity.Subject)
}

func (s *Service) UpdateLocation(ctx context.Context, accessToken, assignmentID string, latitude, longitude float64, idempotencyKey, correlationID string) (postgres.CaptainLocationResult, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.CaptainLocationResult{}, err
	}
	if !validMutation(idempotencyKey, correlationID, identity.Subject) || strings.TrimSpace(assignmentID) == "" {
		return postgres.CaptainLocationResult{}, ErrInvalidInput
	}
	result, err := postgres.UpdateCaptainLocation(ctx, s.db, strings.TrimSpace(assignmentID), identity.Subject, latitude, longitude, strings.TrimSpace(idempotencyKey), postgres.HashCaptainLocationRequest(assignmentID, latitude, longitude), strings.TrimSpace(correlationID))
	if errors.Is(err, postgres.ErrCaptainLocationConflict) {
		return postgres.CaptainLocationResult{}, ErrLocationStateConflict
	}
	if errors.Is(err, postgres.ErrCaptainLocationIdempotency) {
		return postgres.CaptainLocationResult{}, ErrLocationIdempotencyConflict
	}
	return result, err
}

func (s *Service) Pickup(ctx context.Context, accessToken, assignmentID string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CaptainAssignment, bool, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.CaptainAssignment{}, false, err
	}
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.CaptainAssignment{}, false, ErrInvalidInput
	}
	return postgres.CompleteCaptainPickup(ctx, s.db, strings.TrimSpace(assignmentID), identity.Subject, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCaptainPickupRequest(assignmentID, expectedVersion), strings.TrimSpace(correlationID))
}

func (s *Service) Complete(ctx context.Context, accessToken, assignmentID, result string, collectedAmountMinor int64, expectedVersion int, idempotencyKey, correlationID string) (postgres.CaptainAssignment, bool, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.CaptainAssignment{}, false, err
	}
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.CaptainAssignment{}, false, ErrInvalidInput
	}
	if collectedAmountMinor < 0 {
		return postgres.CaptainAssignment{}, false, ErrInvalidInput
	}
	assignment, err := postgres.ReadCaptainAssignment(ctx, s.db, strings.TrimSpace(assignmentID))
	if err != nil {
		return postgres.CaptainAssignment{}, false, err
	}
	paymentState := ""
	if strings.ToLower(strings.TrimSpace(result)) == "delivered" {
		order, orderErr := postgres.ReadOrder(ctx, s.db, assignment.OrderID)
		if orderErr != nil {
			return postgres.CaptainAssignment{}, false, orderErr
		}
		if order.PaymentState == "REQUIRES_COLLECTION" && order.PaymentIntentID != nil {
			if collectedAmountMinor <= 0 || collectedAmountMinor != order.TotalAmountMinor {
				return postgres.CaptainAssignment{}, false, ErrCollectionAmountMismatch
			}
			intent, collectErr := s.payment.EnsureCollected(ctx, *order.PaymentIntentID, identity.Subject, wlt.DerivedExternalReference("cash", idempotencyKey), collectedAmountMinor, wlt.DerivedIdempotencyKey("collect", idempotencyKey), correlationID)
			if collectErr != nil || intent.State != "COLLECTED" {
				if collectErr != nil {
					return postgres.CaptainAssignment{}, false, fmt.Errorf("%w: %v", ErrPaymentUnavailable, collectErr)
				}
				return postgres.CaptainAssignment{}, false, ErrPaymentUnavailable
			}
			paymentState = "COLLECTED"
		} else if order.PaymentState == "COLLECTED" {
			if collectedAmountMinor != 0 && collectedAmountMinor != order.TotalAmountMinor {
				return postgres.CaptainAssignment{}, false, ErrCollectionAmountMismatch
			}
			paymentState = "COLLECTED"
		} else if order.PaymentState != "NOT_LINKED" {
			return postgres.CaptainAssignment{}, false, postgres.ErrPaymentStateConflict
		}
	} else if collectedAmountMinor != 0 {
		return postgres.CaptainAssignment{}, false, ErrInvalidInput
	}
	return postgres.CompleteCaptainAssignment(ctx, s.db, strings.TrimSpace(assignmentID), identity.Subject, result, paymentState, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCaptainCompletionRequest(assignmentID, result, collectedAmountMinor, expectedVersion), strings.TrimSpace(correlationID))
}

func (s *Service) Recover(ctx context.Context, assignmentID, actingActorID string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CaptainAssignment, bool, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	assignmentID = strings.TrimSpace(assignmentID)
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, actingActorID) || assignmentID == "" {
		return postgres.CaptainAssignment{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainAssignment{}, false, err
	}
	return postgres.RecoverCaptainAssignment(ctx, s.db, assignmentID, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCaptainRecoveryRequest(assignmentID, expectedVersion), actingActorID, strings.TrimSpace(correlationID))
}

func (s *Service) Dispatch(ctx context.Context, orderID, actingActorID, idempotencyKey, correlationID string) (postgres.CaptainOffer, bool, error) {
	if !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.CaptainOffer{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainOffer{}, false, err
	}
	return postgres.CreateCaptainDispatchOffer(ctx, s.db, strings.TrimSpace(orderID), strings.TrimSpace(idempotencyKey), postgres.HashCaptainDispatchRequest(orderID), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
}

func (s *Service) Reassign(ctx context.Context, orderID, actingActorID, idempotencyKey, correlationID string) (postgres.CaptainOffer, bool, error) {
	if !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.CaptainOffer{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainOffer{}, false, err
	}
	return postgres.ReassignCaptain(ctx, s.db, strings.TrimSpace(orderID), strings.TrimSpace(idempotencyKey), postgres.HashCaptainReassignmentRequest(orderID), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
}

func (s *Service) ConfirmStoreHandoff(ctx context.Context, accessToken, orderID, storeID, assignmentID string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CaptainAssignment, bool, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return postgres.CaptainAssignment{}, false, err
	}
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.CaptainAssignment{}, false, ErrInvalidInput
	}
	if _, err := postgres.ReadStoreOwnedByPartner(ctx, s.db, strings.TrimSpace(storeID), identity.Subject); err != nil {
		if errors.Is(err, postgres.ErrStoreNotFound) {
			return postgres.CaptainAssignment{}, false, ErrPartnerSessionForbidden
		}
		return postgres.CaptainAssignment{}, false, err
	}
	return postgres.ConfirmStoreHandoff(ctx, s.db, strings.TrimSpace(orderID), strings.TrimSpace(storeID), strings.TrimSpace(assignmentID), expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCaptainHandoffRequest(assignmentID, storeID, expectedVersion), identity.Subject, strings.TrimSpace(correlationID))
}

func (s *Service) SetManagedRoleEnabled(ctx context.Context, role, actorID, operatorActorID, correlationID, idempotencyKey, reason string, expectedVersion int, enabled bool) error {
	role = strings.TrimSpace(role)
	actorID = strings.TrimSpace(actorID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if (role != "partner" && role != "captain") || actorID == "" || strings.TrimSpace(correlationID) == "" || idempotencyKey == "" || expectedVersion < 1 {
		return ErrInvalidInput
	}
	if err := s.requireOperator(ctx, operatorActorID); err != nil {
		return err
	}
	identityRole, err := s.identity.ReadActorRole(ctx, actorID, role)
	if err != nil {
		return err
	}
	if identityRole.Role != role {
		return ErrManagedRoleNotEligible
	}
	if identityRole.Enabled != enabled && identityRole.RoleVersion != expectedVersion {
		return ErrManagedRoleVersionConflict
	}

	if role == "partner" {
		if enabled {
			joining, err := postgres.ReadJoiningCaseForPartner(ctx, s.db, actorID)
			if err != nil {
				return err
			}
			switch joining.Case.State {
			case "submitted", "needs_correction", "approved":
			default:
				return ErrManagedRoleNotEligible
			}
		}
		if identityRole.Enabled == enabled {
			return nil
		}
		return s.identity.SetRoleEnabledWithContext(ctx, actorID, role, enabled, strings.TrimSpace(correlationID), strings.TrimSpace(reason), strings.TrimSpace(operatorActorID), expectedVersion)
	}

	accessHash := postgres.HashCaptainAccessRequest(actorID, role, enabled, expectedVersion)
	if enabled {
		if identityRole.Enabled != enabled {
			if err := s.identity.SetRoleEnabledWithContext(ctx, actorID, role, true, strings.TrimSpace(correlationID), strings.TrimSpace(reason), strings.TrimSpace(operatorActorID), expectedVersion); err != nil {
				return err
			}
		}
		_, err := postgres.RestoreCaptainAdmission(ctx, s.db, actorID, idempotencyKey, accessHash, strings.TrimSpace(operatorActorID), strings.TrimSpace(correlationID))
		return err
	}

	if _, err := postgres.SuspendCaptainAdmission(ctx, s.db, actorID, idempotencyKey, accessHash, strings.TrimSpace(operatorActorID), strings.TrimSpace(correlationID)); err != nil {
		return err
	}
	if identityRole.Enabled == enabled {
		return nil
	}
	return s.identity.SetRoleEnabledWithContext(ctx, actorID, role, false, strings.TrimSpace(correlationID), strings.TrimSpace(reason), strings.TrimSpace(operatorActorID), expectedVersion)
}

func (s *Service) requireCaptain(ctx context.Context, accessToken string) (identityclient.ActorIdentity, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return identityclient.ActorIdentity{}, err
	}
	if identity.Role != "captain" || identity.Surface != "app-captain" || strings.TrimSpace(identity.Subject) == "" {
		return identityclient.ActorIdentity{}, ErrCaptainSessionForbidden
	}
	return identity, nil
}

func (s *Service) requirePartner(ctx context.Context, accessToken string) (identityclient.ActorIdentity, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return identityclient.ActorIdentity{}, err
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
		return identityclient.ActorIdentity{}, ErrPartnerSessionForbidden
	}
	return identity, nil
}

func (s *Service) requireOperator(ctx context.Context, actorID string) error {
	operator, err := s.identity.ReadActorRole(ctx, strings.TrimSpace(actorID), "operator")
	if err != nil {
		return err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return ErrOperatorNotActive
	}
	return nil
}

func validMutation(idempotencyKey, correlationID, actingActorID string) bool {
	return len(strings.TrimSpace(idempotencyKey)) >= 8 && len(strings.TrimSpace(idempotencyKey)) <= 128 && len(strings.TrimSpace(correlationID)) >= 8 && len(strings.TrimSpace(correlationID)) <= 128 && strings.TrimSpace(actingActorID) != ""
}
