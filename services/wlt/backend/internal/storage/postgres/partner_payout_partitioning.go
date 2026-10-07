package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

var (
	ErrPartnerPayoutInvalidInput   = errors.New("partner payout request input is invalid")
	ErrPartnerPayoutStoreUnknown   = errors.New("requested Store is not known to WLT as owned by this Partner")
	ErrPartnerPayoutAttributionGap = errors.New("canonical wallet history has incomplete Store attribution; financial reconciliation is required before a new payout")
	ErrPartnerPayoutAmountExceeded = errors.New("requested Store payout exceeds that Store's attributed available allocation")
)

// PartnerPayoutScopeMode selects how the Store-scoped request resolves amounts.
// FULL_AVAILABLE pays each selected Store's attributed available allocation in
// full; SPECIFIED requires an explicit amount per Store and never invents a
// proportional split.
const (
	PartnerPayoutScopeFullAvailable = "FULL_AVAILABLE"
	PartnerPayoutScopeSpecified     = "SPECIFIED"
)

type PartnerPayoutStoreAmount struct {
	StoreID     string
	AmountMinor int64
}

type PartnerPayoutRequestInput struct {
	PartnerActorID    string
	ScopeMode         string
	RequestedStoreIDs []string
	StoreAmounts      []PartnerPayoutStoreAmount
	// BeneficiaryFacts carries current official-wallet identity facts per
	// beneficiary actor (the partner and any selected staff recipients). WLT
	// re-verifies every group destination against these facts inside the
	// transaction and fails closed on any mismatch.
	BeneficiaryFacts map[string]IdentityFacts
	IdempotencyKey   string
	CorrelationID    string
}

type PartnerPayoutStoreAllocationRecord struct {
	StoreID                    string
	AmountMinor                int64
	BeneficiaryActorID         string
	RecipientAssignmentVersion int64
	Currency                   string
}

type PartnerPayoutRequestRecord struct {
	ID               string
	PartnerActorID   string
	Status           string
	ScopeMode        string
	TotalAmountMinor int64
	Currency         string
	Stores           []PartnerPayoutStoreAllocationRecord
	Payouts          []PayoutRequestRecord
	CreatedAt        time.Time
}

func HashPartnerPayoutRequest(input PartnerPayoutRequestInput) string {
	stores := append([]PartnerPayoutStoreAmount(nil), input.StoreAmounts...)
	sort.Slice(stores, func(left, right int) bool { return stores[left].StoreID < stores[right].StoreID })
	amountFacts := make([]string, 0, len(stores)*2)
	for _, store := range stores {
		amountFacts = append(amountFacts, store.StoreID, formatInt64(store.AmountMinor))
	}
	requestedIDs := append([]string(nil), input.RequestedStoreIDs...)
	sort.Strings(requestedIDs)
	facts := []string{"partner-payout-request-v2", strings.TrimSpace(input.PartnerActorID), strings.TrimSpace(input.ScopeMode), formatInt(len(requestedIDs))}
	facts = append(facts, requestedIDs...)
	facts = append(facts, formatInt(len(stores)))
	facts = append(facts, amountFacts...)
	return hashFacts(facts...)
}

// CreatePartitionedPartnerPayoutRequest resolves the effective recipient per
// Store, partitions the selected Stores into beneficiary+destination groups,
// creates one child payout per group, and freezes immutable per-Store
// allocation lines. Stores with different beneficiaries or destinations never
// share an external transfer. The whole request is idempotent on the business
// intent and every child payout carries its own derived idempotency key.
func CreatePartitionedPartnerPayoutRequest(ctx context.Context, db *sql.DB, cipher *DestinationCipher, input PartnerPayoutRequestInput) (PartnerPayoutRequestRecord, bool, error) {
	input.PartnerActorID = strings.TrimSpace(input.PartnerActorID)
	input.ScopeMode = strings.ToUpper(strings.TrimSpace(input.ScopeMode))
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || cipher == nil || boundedText(input.PartnerActorID, 1, 128) == "" ||
		(input.ScopeMode != PartnerPayoutScopeFullAvailable && input.ScopeMode != PartnerPayoutScopeSpecified) ||
		len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return PartnerPayoutRequestRecord{}, false, ErrPartnerPayoutInvalidInput
	}
	if input.ScopeMode == PartnerPayoutScopeSpecified && len(input.StoreAmounts) == 0 {
		return PartnerPayoutRequestRecord{}, false, ErrPartnerPayoutInvalidInput
	}
	if input.ScopeMode == PartnerPayoutScopeFullAvailable && len(input.StoreAmounts) > 0 {
		return PartnerPayoutRequestRecord{}, false, ErrPartnerPayoutInvalidInput
	}
	seenStores := map[string]struct{}{}
	for index := range input.StoreAmounts {
		store := input.StoreAmounts[index]
		store.StoreID = strings.TrimSpace(store.StoreID)
		if boundedText(store.StoreID, 1, 128) == "" || store.AmountMinor <= 0 {
			return PartnerPayoutRequestRecord{}, false, ErrPartnerPayoutInvalidInput
		}
		if _, duplicate := seenStores[store.StoreID]; duplicate {
			return PartnerPayoutRequestRecord{}, false, ErrPartnerPayoutInvalidInput
		}
		seenStores[store.StoreID] = struct{}{}
		input.StoreAmounts[index] = store
	}
	if input.ScopeMode == PartnerPayoutScopeSpecified && len(input.RequestedStoreIDs) > 0 {
		ids := map[string]bool{}
		for _, id := range input.RequestedStoreIDs {
			id = strings.TrimSpace(id)
			if _, ok := seenStores[id]; !ok {
				return PartnerPayoutRequestRecord{}, false, ErrPartnerPayoutInvalidInput
			}
			ids[id] = true
		}
		if len(ids) != len(seenStores) {
			return PartnerPayoutRequestRecord{}, false, ErrPartnerPayoutInvalidInput
		}
	}
	requestedSet := map[string]bool{}
	for _, id := range input.RequestedStoreIDs {
		id = strings.TrimSpace(id)
		if boundedText(id, 1, 128) == "" {
			return PartnerPayoutRequestRecord{}, false, ErrPartnerPayoutInvalidInput
		}
		requestedSet[id] = true
	}
	if input.ScopeMode == PartnerPayoutScopeSpecified {
		for id := range seenStores {
			requestedSet[id] = true
		}
	}
	input.RequestedStoreIDs = make([]string, 0, len(requestedSet))
	for id := range requestedSet {
		input.RequestedStoreIDs = append(input.RequestedStoreIDs, id)
	}
	sort.Strings(input.RequestedStoreIDs)
	requestHash := HashPartnerPayoutRequest(input)

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PartnerPayoutRequestRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-payout:"+input.PartnerActorID); err != nil {
		return PartnerPayoutRequestRecord{}, false, err
	}

	var existingID string
	err = tx.QueryRowContext(ctx, "SELECT id FROM wlt.partner_payout_requests WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingID)
	if err == nil {
		existing, readErr := ReadPartnerPayoutRequestTx(ctx, tx, existingID)
		if readErr != nil {
			return PartnerPayoutRequestRecord{}, false, readErr
		}
		var storedHash string
		if err := tx.QueryRowContext(ctx, "SELECT request_hash FROM wlt.partner_payout_requests WHERE id=$1", existingID).Scan(&storedHash); err != nil {
			return PartnerPayoutRequestRecord{}, false, err
		}
		if storedHash != requestHash {
			return PartnerPayoutRequestRecord{}, false, ErrIdempotencyConflict
		}
		if err := tx.Commit(); err != nil {
			return PartnerPayoutRequestRecord{}, false, err
		}
		return existing, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PartnerPayoutRequestRecord{}, false, err
	}

	// The projection used by financial readback is the only Store amount source.
	finance, err := readPartnerStoreFinance(ctx, tx, input.PartnerActorID, nil)
	if err != nil {
		return PartnerPayoutRequestRecord{}, false, err
	}
	type storeRouting struct {
		storeID            string
		beneficiaryActorID string
		assignmentVersion  int64
		availableMinor     int64
		recipientState     string
	}
	routing := map[string]*storeRouting{}
	for _, store := range finance {
		if !store.AttributionComplete {
			return PartnerPayoutRequestRecord{}, false, ErrPartnerPayoutAttributionGap
		}
		routing[store.StoreID] = &storeRouting{storeID: store.StoreID, beneficiaryActorID: store.BeneficiaryActorID, assignmentVersion: store.RecipientAssignmentVersion, availableMinor: store.EligibleAvailableMinor, recipientState: store.RecipientState}
	}

	// Global wallet authority: every child amount together may never exceed the
	// Partner wallet's currently available balance.
	var grossAvailable, held int64
	if err := tx.QueryRowContext(ctx, `SELECT
		COALESCE((SELECT SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END) FROM wlt.ledger_entries WHERE account_code='PARTNER_WALLET' AND actor_id=$1),0),
		COALESCE((SELECT SUM(amount_minor) FROM wlt.payout_holds WHERE actor_type='partner' AND actor_id=$1 AND status='ACTIVE'),0)`, input.PartnerActorID).Scan(&grossAvailable, &held); err != nil {
		return PartnerPayoutRequestRecord{}, false, err
	}

	walletAvailable := grossAvailable - held

	selected := make([]*storeRouting, 0, len(routing))
	if input.ScopeMode == PartnerPayoutScopeSpecified {
		for _, store := range input.StoreAmounts {
			entry := routing[store.StoreID]
			if entry == nil {
				return PartnerPayoutRequestRecord{}, false, fmt.Errorf("%w: %s", ErrPartnerPayoutStoreUnknown, store.StoreID)
			}
			selected = append(selected, entry)
		}
	} else {
		requested := map[string]struct{}{}
		for _, storeID := range input.RequestedStoreIDs {
			storeID = strings.TrimSpace(storeID)
			if routing[storeID] == nil {
				return PartnerPayoutRequestRecord{}, false, ErrPartnerPayoutStoreUnknown
			}
			requested[storeID] = struct{}{}
		}
		for _, entry := range routing {
			if len(requested) > 0 {
				if _, wanted := requested[entry.storeID]; !wanted {
					continue
				}
			}
			selected = append(selected, entry)
		}
		sort.Slice(selected, func(left, right int) bool { return selected[left].storeID < selected[right].storeID })
	}

	for _, entry := range selected {
		if entry.recipientState == StorePayoutRecipientStateReviewRequired {
			return PartnerPayoutRequestRecord{}, false, ErrPayoutRecipientReviewRequired
		}
	}

	// Resolve per-Store amounts. FULL_AVAILABLE pays each selected Store's
	// attributed available allocation in full; a remainder the attribution
	// cannot explain fails closed instead of being invented.
	type storeAllocation struct {
		routing *storeRouting
		amount  int64
	}
	allocations := make([]storeAllocation, 0, len(selected))
	var total int64
	if input.ScopeMode == PartnerPayoutScopeSpecified {
		for _, store := range input.StoreAmounts {
			entry := routing[store.StoreID]
			if store.AmountMinor > entry.availableMinor {
				return PartnerPayoutRequestRecord{}, false, fmt.Errorf("%w: %s", ErrPartnerPayoutAmountExceeded, store.StoreID)
			}
			allocations = append(allocations, storeAllocation{routing: entry, amount: store.AmountMinor})
			if store.AmountMinor > math.MaxInt64-total {
				return PartnerPayoutRequestRecord{}, false, ErrPartnerPayoutInvalidInput
			}
			total += store.AmountMinor
		}
	} else {
		for _, entry := range selected {
			if entry.availableMinor <= 0 {
				continue
			}
			allocations = append(allocations, storeAllocation{routing: entry, amount: entry.availableMinor})
			if entry.availableMinor > math.MaxInt64-total {
				return PartnerPayoutRequestRecord{}, false, ErrPartnerPayoutInvalidInput
			}
			total += entry.availableMinor
		}
	}
	if total <= 0 {
		return PartnerPayoutRequestRecord{}, false, ErrPayoutNoFunds
	}
	if total > walletAvailable {
		return PartnerPayoutRequestRecord{}, false, ErrPartnerPayoutAttributionGap
	}

	sort.Slice(allocations, func(i, j int) bool {
		if allocations[i].routing.beneficiaryActorID == allocations[j].routing.beneficiaryActorID {
			return allocations[i].routing.storeID < allocations[j].routing.storeID
		}
		return allocations[i].routing.beneficiaryActorID < allocations[j].routing.beneficiaryActorID
	})

	// Group by beneficiary and verified destination: one external transfer
	// never pays two beneficiaries or two destinations.
	type payoutGroup struct {
		beneficiaryActorID string
		destinationID      string
		destinationVersion int
		amount             int64
		allocations        []storeAllocation
	}
	groups := map[string]*payoutGroup{}
	for _, allocation := range allocations {
		facts, provided := input.BeneficiaryFacts[allocation.routing.beneficiaryActorID]
		if !provided {
			return PartnerPayoutRequestRecord{}, false, fmt.Errorf("%w: %s", ErrReverificationRequired, allocation.routing.beneficiaryActorID)
		}
		if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:payout:partner:"+allocation.routing.beneficiaryActorID); err != nil {
			return PartnerPayoutRequestRecord{}, false, err
		}
		var destinationID string
		var destinationVersion int
		if err := tx.QueryRowContext(ctx, "SELECT id,version FROM wlt.official_wallet_destinations WHERE actor_type='partner' AND actor_id=$1 AND verification_status='VERIFIED' AND status='ACTIVE_FOR_PAYOUT' FOR UPDATE", allocation.routing.beneficiaryActorID).Scan(&destinationID, &destinationVersion); errors.Is(err, sql.ErrNoRows) {
			return PartnerPayoutRequestRecord{}, false, fmt.Errorf("%w: %s", ErrRecipientDestinationNotReady, allocation.routing.beneficiaryActorID)
		} else if err != nil {
			return PartnerPayoutRequestRecord{}, false, err
		}
		if err := facts.matchesStoredDestination(ctx, tx, cipher, destinationID, "partner", allocation.routing.beneficiaryActorID, true); err != nil {
			return PartnerPayoutRequestRecord{}, false, commitIdentityStaleness(tx, err)
		}
		groupKey := allocation.routing.beneficiaryActorID + "|" + destinationID + "|" + formatInt(destinationVersion)
		group := groups[groupKey]
		if group == nil {
			group = &payoutGroup{beneficiaryActorID: allocation.routing.beneficiaryActorID, destinationID: destinationID, destinationVersion: destinationVersion}
			groups[groupKey] = group
		}
		group.amount += allocation.amount
		group.allocations = append(group.allocations, allocation)
	}

	requestID, err := newID("ppr")
	if err != nil {
		return PartnerPayoutRequestRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.partner_payout_requests(id,idempotency_key,request_hash,partner_actor_id,scope_mode,status,total_amount_minor,currency)
		VALUES($1,$2,$3,$4,$5,'PARTITIONED',$6,'YER')`, requestID, input.IdempotencyKey, requestHash, input.PartnerActorID, input.ScopeMode, total); err != nil {
		return PartnerPayoutRequestRecord{}, false, err
	}

	groupKeys := make([]string, 0, len(groups))
	for groupKey := range groups {
		groupKeys = append(groupKeys, groupKey)
	}
	sort.Strings(groupKeys)
	for groupIndex, groupKey := range groupKeys {
		group := groups[groupKey]
		childID, err := newID("payout")
		if err != nil {
			return PartnerPayoutRequestRecord{}, false, err
		}
		holdID, err := newID("hold")
		if err != nil {
			return PartnerPayoutRequestRecord{}, false, err
		}
		childIdempotencyKey := hashFacts("partner-payout-child", input.IdempotencyKey, formatInt(groupIndex+1))
		childHash := hashFacts("payout-intent-v2", "partner", input.PartnerActorID, "SPECIFIED", formatInt64(group.amount), input.BeneficiaryFacts[group.beneficiaryActorID].fingerprint())
		policyVersion := "payout-eligibility-v1;destination-version=" + formatInt(group.destinationVersion) + ";partitioned=" + requestID
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.payout_requests(id,actor_type,actor_id,amount_mode,requested_amount_minor,resolved_amount_minor,destination_id,destination_version,status,policy_version,idempotency_key,request_hash)
			VALUES($1,'partner',$2,'SPECIFIED',$3,$3,$4,$5,'HELD',$6,$7,$8)`, childID, input.PartnerActorID, group.amount, group.destinationID, group.destinationVersion, policyVersion, childIdempotencyKey, childHash); err != nil {
			return PartnerPayoutRequestRecord{}, false, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.payout_holds(id,payout_id,actor_type,actor_id,amount_minor) VALUES($1,$2,'partner',$3,$4)`, holdID, childID, input.PartnerActorID, group.amount); err != nil {
			return PartnerPayoutRequestRecord{}, false, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.partner_payout_request_payouts(request_id,payout_id,group_index) VALUES($1,$2,$3)`, requestID, childID, groupIndex+1); err != nil {
			return PartnerPayoutRequestRecord{}, false, err
		}
		for _, allocation := range group.allocations {
			if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.payout_store_allocations(payout_id,store_id,beneficiary_actor_id,recipient_assignment_version,amount_minor,currency)
				VALUES($1,$2,$3,$4,$5,'YER')`, childID, allocation.routing.storeID, allocation.routing.beneficiaryActorID, allocation.routing.assignmentVersion, allocation.amount); err != nil {
				return PartnerPayoutRequestRecord{}, false, err
			}
		}
	}

	record, err := ReadPartnerPayoutRequestTx(ctx, tx, requestID)
	if err != nil {
		return PartnerPayoutRequestRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PartnerPayoutRequestRecord{}, false, err
	}
	return record, false, nil
}

// ReadPartnerPayoutRequest returns the canonical readback of one partitioned
// Partner payout request with its immutable Store allocations.
func ReadPartnerPayoutRequest(ctx context.Context, db *sql.DB, requestID string) (PartnerPayoutRequestRecord, error) {
	if db == nil || boundedText(requestID, 1, 128) == "" {
		return PartnerPayoutRequestRecord{}, ErrPartnerPayoutInvalidInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PartnerPayoutRequestRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	record, err := ReadPartnerPayoutRequestTx(ctx, tx, strings.TrimSpace(requestID))
	if err != nil {
		return PartnerPayoutRequestRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return PartnerPayoutRequestRecord{}, err
	}
	return record, nil
}

// ReadPartnerPayoutRequestTx reads one partitioned request inside the caller's
// transaction so replays observe exactly the committed state.
func ReadPartnerPayoutRequestTx(ctx context.Context, tx *sql.Tx, requestID string) (PartnerPayoutRequestRecord, error) {
	var record PartnerPayoutRequestRecord
	var createdAt time.Time
	err := tx.QueryRowContext(ctx, `SELECT id,partner_actor_id,status,scope_mode,total_amount_minor,currency,created_at FROM wlt.partner_payout_requests WHERE id=$1`, requestID).
		Scan(&record.ID, &record.PartnerActorID, &record.Status, &record.ScopeMode, &record.TotalAmountMinor, &record.Currency, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerPayoutRequestRecord{}, ErrPayoutNotFound
	}
	if err != nil {
		return PartnerPayoutRequestRecord{}, err
	}
	record.CreatedAt = createdAt
	allocations, err := tx.QueryContext(ctx, `SELECT a.store_id, a.beneficiary_actor_id, a.recipient_assignment_version, a.amount_minor, a.currency
		FROM wlt.payout_store_allocations a
		JOIN wlt.partner_payout_request_payouts l ON l.payout_id = a.payout_id
		WHERE l.request_id=$1
		ORDER BY a.store_id`, requestID)
	if err != nil {
		return PartnerPayoutRequestRecord{}, err
	}
	defer allocations.Close()
	for allocations.Next() {
		var allocation PartnerPayoutStoreAllocationRecord
		if err := allocations.Scan(&allocation.StoreID, &allocation.BeneficiaryActorID, &allocation.RecipientAssignmentVersion, &allocation.AmountMinor, &allocation.Currency); err != nil {
			return PartnerPayoutRequestRecord{}, err
		}
		record.Stores = append(record.Stores, allocation)
	}
	if err := allocations.Err(); err != nil {
		return PartnerPayoutRequestRecord{}, err
	}
	children, err := tx.QueryContext(ctx, `SELECT p.id FROM wlt.partner_payout_request_payouts l JOIN wlt.payout_requests p ON p.id=l.payout_id WHERE l.request_id=$1 ORDER BY l.group_index`, requestID)
	if err != nil {
		return PartnerPayoutRequestRecord{}, err
	}
	defer children.Close()
	childIDs := make([]string, 0, 2)
	for children.Next() {
		var childID string
		if err := children.Scan(&childID); err != nil {
			return PartnerPayoutRequestRecord{}, err
		}
		childIDs = append(childIDs, childID)
	}
	if err := children.Err(); err != nil {
		return PartnerPayoutRequestRecord{}, err
	}
	children.Close()
	for _, childID := range childIDs {
		child, err := readPayoutRequest(ctx, tx, childID)
		if err != nil {
			return PartnerPayoutRequestRecord{}, err
		}
		record.Payouts = append(record.Payouts, child)
	}
	return record, nil
}

// ReadPartnerPayoutRequestByKey recovers an uncertain response without reinterpreting
// a saved request against changed identity facts, grants or financial state.
func ReadPartnerPayoutRequestByKey(ctx context.Context, db *sql.DB, owner, key string) (PartnerPayoutRequestRecord, error) {
	owner, key = strings.TrimSpace(owner), strings.TrimSpace(key)
	if db == nil || boundedText(owner, 1, 128) == "" || boundedText(key, 8, 128) == "" {
		return PartnerPayoutRequestRecord{}, ErrPartnerPayoutInvalidInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PartnerPayoutRequestRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-payout:"+owner); err != nil {
		return PartnerPayoutRequestRecord{}, err
	}
	var id string
	if err = tx.QueryRowContext(ctx, "SELECT id FROM wlt.partner_payout_requests WHERE partner_actor_id=$1 AND idempotency_key=$2", owner, key).Scan(&id); errors.Is(err, sql.ErrNoRows) {
		return PartnerPayoutRequestRecord{}, ErrPayoutNotFound
	} else if err != nil {
		return PartnerPayoutRequestRecord{}, err
	}
	record, err := ReadPartnerPayoutRequestTx(ctx, tx, id)
	if err != nil {
		return PartnerPayoutRequestRecord{}, err
	}
	return record, tx.Commit()
}
