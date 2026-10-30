package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"
)

const captainOfferTimeout = 10 * time.Minute

var (
	ErrCaptainAdmissionNotFound       = errors.New("captain admission was not found")
	ErrCaptainAdmissionExists         = errors.New("captain admission already exists")
	ErrCaptainAdmissionConflict       = errors.New("captain admission is in conflict")
	ErrCaptainAdmissionNotEligible    = errors.New("captain admission is not eligible")
	ErrCaptainOperationConflict       = errors.New("captain operation idempotency key was already used with different facts")
	ErrCaptainVersionConflict         = errors.New("captain state is stale")
	ErrCaptainNotEligible             = errors.New("captain is not eligible for this operation")
	ErrCaptainNoAvailable             = errors.New("no eligible available captain is available")
	ErrCaptainDispatchConflict        = errors.New("order already has an active dispatch decision")
	ErrCaptainOfferNotFound           = errors.New("captain dispatch offer was not found")
	ErrCaptainOfferExpired            = errors.New("captain dispatch offer has expired")
	ErrCaptainOfferConflict           = errors.New("captain dispatch offer is not actionable")
	ErrCaptainOfferForbidden          = errors.New("captain dispatch offer belongs to another captain")
	ErrCaptainAssignmentNotFound      = errors.New("captain assignment was not found")
	ErrCaptainDeliveryTaskNotFound    = errors.New("captain delivery task was not found")
	ErrCaptainDeliveryTaskInvalid     = errors.New("captain delivery task is not currently available")
	ErrCaptainAssignmentConflict      = errors.New("captain assignment is in conflict")
	ErrCaptainCustodyConflict         = errors.New("captain custody transition is not allowed")
	ErrCaptainTerminalConflict        = errors.New("captain assignment is already terminal")
	ErrCaptainCollectedAmountMismatch = errors.New("captain collected amount does not match the order cash amount")
	ErrDeliveryProofInvalid           = errors.New("delivery proof is invalid")
	ErrCaptainAdmissionRegistry       = errors.New("captain admission registry query is invalid")
)

type CaptainAdmissionPage struct {
	Admissions []CaptainAdmission
	NextCursor string
}
type captainAdmissionCursor struct {
	Version   int    `json:"v"`
	Query     string `json:"q"`
	State     string `json:"s"`
	Sort      string `json:"o"`
	CreatedAt string `json:"t"`
	ID        string `json:"i"`
}

type CaptainAdmission struct {
	ID                    string
	ActorID               string
	FullNameAr            string
	PhoneE164             string
	WalletProviderKey     string
	State                 string
	AvailabilityState     string
	RequiresProfileReview bool
	Version               int
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

type CaptainOffer struct {
	ID                   string
	OrderID              string
	CaptainActorID       string
	SourceStoreID        string
	State                string
	ExpiresAt            time.Time
	Version              int
	CreatedAt            time.Time
	UpdatedAt            time.Time
	StoreName            string
	StoreProfileImageURI string
	DeliveryAreaText     string
	AmountDueMinor       int64
	Currency             string
	PaymentMethod        string
	PaymentState         string
}

type CaptainHandoff struct {
	AssignmentID      string
	OrderID           string
	StoreID           string
	State             string
	Version           int
	StoreConfirmedAt  *time.Time
	CaptainPickedUpAt *time.Time
}

type CaptainAssignment struct {
	ID               string
	OrderID          string
	CaptainActorID   string
	AcceptedOfferID  string
	State            string
	Version          int
	CustodyStartedAt *time.Time
	TerminalResult   string
	TerminalAt       *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
	Handoff          CaptainHandoff
}

type CaptainOfferResult struct {
	Offer      CaptainOffer
	Assignment *CaptainAssignment
	Replayed   bool
}

type CaptainDeliveryTask struct {
	AssignmentID         string
	OrderReference       string
	StoreID              string
	StoreName            string
	StoreProfileImageURI string
	PickupLatitude       float64
	PickupLongitude      float64
	CustomerAddressText  string
	DestinationLatitude  float64
	DestinationLongitude float64
	OrderState           string
	HandoffState         string
	DeliveryState        string
	PaymentMethod        string
	PaymentState         string
	AmountDueMinor       int64
	DeliveryFeeMinor     *int64 // WLT-owned presentation only
	PaymentIntentID      string // internal WLT readback, not returned to app
	Currency             string
	FulfillmentMode      string
	Recipient            DeliveryRecipientRecord
}

type CaptainOperationResult struct {
	Assignment CaptainAssignment
	Replayed   bool
}

func HashCaptainAdmissionRequest(fullNameAr, phone, walletProviderKey string) string {
	return hashFacts("captain-admission", strings.TrimSpace(fullNameAr), strings.TrimSpace(phone), strings.TrimSpace(walletProviderKey))
}

func HashCaptainAdmissionTransition(operation, admissionID string) string {
	return hashFacts("captain-admission-"+strings.TrimSpace(operation), strings.TrimSpace(admissionID))
}

func HashCaptainAdmissionApprovalRequest(admissionID string, expectedVersion int) string {
	return hashFacts("captain-admission-approve", strings.TrimSpace(admissionID), strconv.Itoa(expectedVersion))
}

func HashCaptainAdmissionProfileRequest(admissionID, fullNameAr string, expectedVersion int) string {
	return hashFacts("captain-admission-profile", strings.TrimSpace(admissionID), strings.TrimSpace(fullNameAr), strconv.Itoa(expectedVersion))
}

func HashCaptainAdmissionProfileReviewRequest(admissionID string, expectedVersion int) string {
	return hashFacts("captain-admission-profile-review", strings.TrimSpace(admissionID), strconv.Itoa(expectedVersion))
}

func HashCaptainAvailabilityRequest(actorID string, available bool, expectedVersion int) string {
	return hashFacts("captain-availability", strings.TrimSpace(actorID), strconv.FormatBool(available), strconv.Itoa(expectedVersion))
}

func HashCaptainOperatorAvailabilityRequest(actorID string, available bool, expectedVersion int, reason string) string {
	return hashFacts("captain-operator-availability", strings.TrimSpace(actorID), strconv.FormatBool(available), strconv.Itoa(expectedVersion), strings.TrimSpace(reason))
}

func HashCaptainDispatchRequest(orderID string) string {
	return hashFacts("captain-dispatch", strings.TrimSpace(orderID))
}

func HashStoreCaptainDispatchRequest(storeID, orderID, captainActorID string, expectedOrderVersion int) string {
	return hashFacts("store-captain-dispatch", strings.TrimSpace(storeID), strings.TrimSpace(orderID), strings.TrimSpace(captainActorID), strconv.Itoa(expectedOrderVersion))
}

func HashCaptainOfferResponse(offerID, decision string, expectedVersion int) string {
	return hashFacts("captain-offer-response", strings.TrimSpace(offerID), strings.TrimSpace(decision), strconv.Itoa(expectedVersion))
}

func HashCaptainReassignmentRequest(orderID string) string {
	return hashFacts("captain-reassign", strings.TrimSpace(orderID))
}

func HashCaptainHandoffRequest(assignmentID, storeID string, expectedVersion int) string {
	return hashFacts("captain-store-handoff", strings.TrimSpace(assignmentID), strings.TrimSpace(storeID), strconv.Itoa(expectedVersion))
}

func HashCaptainPickupRequest(assignmentID string, expectedVersion int) string {
	return hashFacts("captain-pickup", strings.TrimSpace(assignmentID), strconv.Itoa(expectedVersion))
}

func HashCaptainCompletionRequest(assignmentID, result string, collectedAmountMinor int64, deliveryProofCode string, expectedVersion int) string {
	return hashFacts("captain-complete", strings.TrimSpace(assignmentID), strings.TrimSpace(result), strconv.FormatInt(collectedAmountMinor, 10), strings.TrimSpace(deliveryProofCode), strconv.Itoa(expectedVersion))
}

func legacyCaptainCompletionRequestHashes(assignmentID, result string, collectedAmountMinor int64, deliveryProofCode string, expectedVersion int) []string {
	assignmentID = strings.TrimSpace(assignmentID)
	result = strings.TrimSpace(result)
	amount := strconv.FormatInt(collectedAmountMinor, 10)
	version := strconv.Itoa(expectedVersion)
	return []string{
		HashCaptainCompletionRequest(assignmentID, result, collectedAmountMinor, deliveryProofCode, expectedVersion),
		hashFacts("captain-complete", assignmentID, result, amount, version),
		hashFacts("captain-complete", assignmentID, result, version),
	}
}

func captainCompletionReplayHashMatches(keys *DeliveryProofKeyring, storedHash string, requestFacts []string, assignmentID, submittedResult string, collectedAmountMinor int64, deliveryProofCode string, expectedVersion int) bool {
	if keys == nil {
		return false
	}
	if keys.VerifyIdempotencyHash(storedHash, "captain-completion", requestFacts...) {
		return true
	}
	for _, legacyHash := range legacyCaptainCompletionRequestHashes(assignmentID, submittedResult, collectedAmountMinor, deliveryProofCode, expectedVersion) {
		if keys.VerifyIdempotencyHash(storedHash, "captain-completion-legacy", legacyHash) {
			return true
		}
	}
	return false
}

func HashCaptainRecoveryRequest(assignmentID string, expectedVersion int) string {
	return hashFacts("captain-recover", strings.TrimSpace(assignmentID), strconv.Itoa(expectedVersion))
}

func HashCaptainAccessRequest(actorID, role string, enabled bool, expectedVersion int) string {
	return hashFacts("captain-access", strings.TrimSpace(actorID), strings.TrimSpace(role), strconv.FormatBool(enabled), strconv.Itoa(expectedVersion))
}

type captainOperation struct {
	AdmissionID   string
	OrderID       string
	OfferID       string
	AssignmentID  string
	ResultVersion int
}

func captainAdmissionAccessReplayTx(ctx context.Context, tx *sql.Tx, eventType, idempotencyKey, requestHash string) (bool, error) {
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "dsh:captain-access:"+idempotencyKey); err != nil {
		return false, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT event_type,request_hash FROM dsh.captain_admission_audit WHERE idempotency_key=$1 ORDER BY id FOR UPDATE`, idempotencyKey)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	count := 0
	matching := false
	for rows.Next() {
		var storedEventType, storedHash string
		if err := rows.Scan(&storedEventType, &storedHash); err != nil {
			return false, err
		}
		count++
		matching = matching || (storedEventType == eventType && storedHash == requestHash)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	if count == 0 {
		return false, nil
	}
	if count != 1 || !matching {
		return false, ErrCaptainOperationConflict
	}
	return true, nil
}

// CanonicalizeCaptainOffers applies the DSH timeout state transition for
// expired offers. It is deliberately lazy: every relevant read/write boundary
// invokes the same transaction-local implementation, so no worker or timer is
// a second owner of operational state.
func CanonicalizeCaptainOffers(ctx context.Context, db *sql.DB, actorID string) error {
	if db == nil {
		return ErrCaptainOperationConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := canonicalizeCaptainOffersTx(ctx, tx, strings.TrimSpace(actorID)); err != nil {
		return err
	}
	return tx.Commit()
}

func canonicalizeCaptainOffersTx(ctx context.Context, tx *sql.Tx, actorID string) error {
	query := `SELECT id,order_id,captain_actor_id,COALESCE(source_store_id,''),version FROM dsh.captain_dispatch_offers WHERE state='offered' AND expires_at <= clock_timestamp()`
	args := []any{}
	if strings.TrimSpace(actorID) != "" {
		query += " AND captain_actor_id=$1"
		args = append(args, strings.TrimSpace(actorID))
	}
	query += " ORDER BY id FOR UPDATE"
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	type expiredOffer struct {
		ID             string
		OrderID        string
		CaptainActorID string
		SourceStoreID  string
		Version        int
	}
	offers := make([]expiredOffer, 0)
	for rows.Next() {
		var offer expiredOffer
		if err := rows.Scan(&offer.ID, &offer.OrderID, &offer.CaptainActorID, &offer.SourceStoreID, &offer.Version); err != nil {
			_ = rows.Close()
			return err
		}
		offers = append(offers, offer)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, offer := range offers {
		var resultVersion int
		if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_dispatch_offers SET state='expired',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='offered' AND version=$2 RETURNING version`, offer.ID, offer.Version).Scan(&resultVersion); errors.Is(err, sql.ErrNoRows) {
			continue
		} else if err != nil {
			return err
		}
		key := "captain-timeout:" + offer.ID
		hash := hashFacts("captain-offer-expired", offer.ID)
		if offer.SourceStoreID == "" {
			if err := restoreCaptainAvailabilityTx(ctx, tx, offer.CaptainActorID, key, hash, "system:captain-timeout", key); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('dispatch_offer_expired',$1,$2,$3,$4,$5,$6,'offered','expired',$7,$8) ON CONFLICT (event_type,idempotency_key) DO NOTHING`, key, key, "system:captain-timeout", offer.OrderID, offer.ID, offer.CaptainActorID, resultVersion, hash); err != nil {
			return err
		}
		var paymentIntentID sql.NullString
		var paymentState string
		if err := tx.QueryRowContext(ctx, `SELECT payment_intent_id,payment_state FROM dsh.commerce_orders WHERE id=$1`, offer.OrderID).Scan(&paymentIntentID, &paymentState); err != nil {
			return err
		}
		if offer.SourceStoreID == "" && paymentIntentID.Valid && paymentState == "REQUIRES_COLLECTION" {
			if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "CAPTAIN_COD_RELEASE", SourceRef: offer.ID, OrderID: offer.OrderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: offer.CaptainActorID, IdempotencyKey: key, CorrelationID: key, ActingActorID: "system:captain-timeout"}); err != nil {
				return err
			}
		}
	}
	return nil
}

func captainOperationReplayTx(ctx context.Context, tx *sql.Tx, idempotencyKey, requestHash, operation string, hashMatchers ...func(string) bool) (*captainOperation, error) {
	var storedHash, storedOperation string
	var value captainOperation
	err := tx.QueryRowContext(ctx, `SELECT request_hash,operation,COALESCE(admission_id,''),COALESCE(order_id,''),COALESCE(offer_id,''),COALESCE(assignment_id,''),result_version FROM dsh.captain_operation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedOperation, &value.AdmissionID, &value.OrderID, &value.OfferID, &value.AssignmentID, &value.ResultVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	hashMatches := storedHash == requestHash
	if !hashMatches {
		for _, matcher := range hashMatchers {
			if matcher != nil && matcher(storedHash) {
				hashMatches = true
				break
			}
		}
	}
	if !hashMatches || storedOperation != operation {
		return nil, ErrCaptainOperationConflict
	}
	return &value, nil
}

func reserveCaptainAvailabilityTx(ctx context.Context, tx *sql.Tx, admissionID, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) error {
	var version int
	err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET availability_state='unavailable',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND actor_id=$2 AND state='eligible' AND requires_profile_review=false AND availability_state='available' RETURNING version`, admissionID, actorID).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrCaptainNoAvailable
	}
	if err != nil {
		return err
	}
	// An offer only reserves the captain temporarily. Keep their last fresh
	// presence so a rejected/expired offer can be dispatched again without
	// requiring a new GPS fix; the 15-minute freshness gate still applies.
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_availability_changed',$1,$2,$3,$4,$5,'available','unavailable',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, admissionID, actorID, version-1, version, requestHash)
	return err
}

func restoreCaptainAvailabilityTx(ctx context.Context, tx *sql.Tx, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) error {
	var admissionID, state, availability string
	var requiresProfileReview bool
	if err := tx.QueryRowContext(ctx, `SELECT id,state,availability_state,requires_profile_review FROM dsh.captain_admissions WHERE actor_id=$1 FOR UPDATE`, actorID).Scan(&admissionID, &state, &availability, &requiresProfileReview); errors.Is(err, sql.ErrNoRows) {
		return ErrCaptainNotEligible
	} else if err != nil {
		return err
	}
	if state != "eligible" || availability != "unavailable" || requiresProfileReview {
		return nil
	}
	var hasActiveWork bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM dsh.captain_dispatch_offers WHERE captain_actor_id=$1 AND state='offered') OR EXISTS (SELECT 1 FROM dsh.captain_assignments WHERE captain_actor_id=$1 AND state IN ('assigned','in_custody'))`, actorID).Scan(&hasActiveWork); err != nil {
		return err
	}
	if hasActiveWork {
		return nil
	}
	var version int
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET availability_state='available',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='eligible' AND requires_profile_review=false AND availability_state='unavailable' RETURNING version`, admissionID).Scan(&version); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_availability_changed',$1,$2,$3,$4,$5,'unavailable','available',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, admissionID, actorID, version-1, version, requestHash)
	return err
}

func readCaptainAdmissionTx(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, where string, args ...any) (CaptainAdmission, error) {
	var item CaptainAdmission
	var actorID string
	err := source.QueryRowContext(ctx, `SELECT id,COALESCE(actor_id,''),COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),COALESCE(wallet_provider_key,''),state,availability_state,requires_profile_review,version,created_at,updated_at FROM dsh.captain_admissions WHERE `+where, args...).Scan(&item.ID, &actorID, &item.FullNameAr, &item.PhoneE164, &item.WalletProviderKey, &item.State, &item.AvailabilityState, &item.RequiresProfileReview, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	item.ActorID = actorID
	return item, err
}

func readCaptainOfferTx(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, where string, args ...any) (CaptainOffer, error) {
	var item CaptainOffer
	err := source.QueryRowContext(ctx, `SELECT offer.id,offer.order_id,offer.captain_actor_id,COALESCE(offer.source_store_id,''),offer.state,offer.expires_at,offer.version,offer.created_at,offer.updated_at,s.name,COALESCE((SELECT uri FROM dsh.store_profile_media_assets m WHERE m.store_id=s.id AND m.state='active' AND m.rights_attested_at IS NOT NULL LIMIT 1),''),COALESCE((SELECT NULLIF(city.display_name_ar,'') FROM dsh.service_cities city WHERE city.id=o.service_city_id),'منطقة الخدمة'),o.payment_cash_amount_minor,o.currency,o.payment_method,o.payment_state
		FROM dsh.captain_dispatch_offers offer
		JOIN dsh.commerce_orders o ON o.id=offer.order_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE `+where, args...).Scan(&item.ID, &item.OrderID, &item.CaptainActorID, &item.SourceStoreID, &item.State, &item.ExpiresAt, &item.Version, &item.CreatedAt, &item.UpdatedAt, &item.StoreName, &item.StoreProfileImageURI, &item.DeliveryAreaText, &item.AmountDueMinor, &item.Currency, &item.PaymentMethod, &item.PaymentState)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, ErrCaptainOfferNotFound
	}
	return item, err
}

func readCaptainAssignmentTx(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, where string, args ...any) (CaptainAssignment, error) {
	var item CaptainAssignment
	var custodyStartedAt, terminalAt sql.NullTime
	var terminalResult sql.NullString
	err := source.QueryRowContext(ctx, `SELECT id,order_id,captain_actor_id,accepted_offer_id,state,version,custody_started_at,terminal_result,terminal_at,created_at,updated_at FROM dsh.captain_assignments WHERE `+where, args...).Scan(&item.ID, &item.OrderID, &item.CaptainActorID, &item.AcceptedOfferID, &item.State, &item.Version, &custodyStartedAt, &terminalResult, &terminalAt, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAssignment{}, ErrCaptainAssignmentNotFound
	}
	if err != nil {
		return CaptainAssignment{}, err
	}
	if custodyStartedAt.Valid {
		value := custodyStartedAt.Time
		item.CustodyStartedAt = &value
	}
	if terminalResult.Valid {
		item.TerminalResult = terminalResult.String
	}
	if terminalAt.Valid {
		value := terminalAt.Time
		item.TerminalAt = &value
	}
	err = source.QueryRowContext(ctx, `SELECT assignment_id,order_id,store_id,state,version,store_confirmed_at,captain_picked_up_at FROM dsh.captain_handoffs WHERE assignment_id=$1`, item.ID).Scan(&item.Handoff.AssignmentID, &item.Handoff.OrderID, &item.Handoff.StoreID, &item.Handoff.State, &item.Handoff.Version, &custodyStartedAt, &terminalAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAssignment{}, ErrCaptainAssignmentNotFound
	}
	if err != nil {
		return CaptainAssignment{}, err
	}
	if custodyStartedAt.Valid {
		value := custodyStartedAt.Time
		item.Handoff.StoreConfirmedAt = &value
	}
	if terminalAt.Valid {
		value := terminalAt.Time
		item.Handoff.CaptainPickedUpAt = &value
	}
	return item, nil
}
