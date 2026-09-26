package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

var (
	ErrFavoriteStoreIdempotencyConflict      = errors.New("favorite store idempotency key was already used with different facts")
	ErrFavoriteStoreUnavailable              = errors.New("store is not currently available for favorites")
	ErrFavoriteStoreOfferIdempotencyConflict = errors.New("favorite store offer idempotency key was already used with different facts")
	ErrFavoriteStoreOfferUnavailable         = errors.New("store offer is not currently available for favorites")
)

type FavoriteStoreMutationResult struct {
	StoreID    string
	IsFavorite bool
	Replayed   bool
}

func HashClientFavoriteStoreMutation(operation, storeID string) string {
	return hashFacts("client-favorite-store", strings.TrimSpace(operation), strings.TrimSpace(storeID))
}

func ListClientFavoriteStoreIDs(ctx context.Context, db *sql.DB, clientActorID string) ([]string, error) {
	if db == nil {
		return nil, errors.New("DSH database is nil")
	}
	clientActorID = strings.TrimSpace(clientActorID)
	if clientActorID == "" {
		return nil, errors.New("client actor id is required")
	}
	rows, err := db.QueryContext(ctx, `SELECT store_id
		FROM dsh.client_favorite_stores
		WHERE client_actor_id=$1
		ORDER BY created_at DESC, store_id ASC`, clientActorID)
	if err != nil {
		return nil, fmt.Errorf("list client favorite stores: %w", err)
	}
	defer rows.Close()
	storeIDs := make([]string, 0)
	for rows.Next() {
		var storeID string
		if err := rows.Scan(&storeID); err != nil {
			return nil, fmt.Errorf("scan client favorite store: %w", err)
		}
		storeIDs = append(storeIDs, storeID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read client favorite stores: %w", err)
	}
	return storeIDs, nil
}

func SetClientFavoriteStore(ctx context.Context, db *sql.DB, clientActorID, storeID, operation, idempotencyKey, requestHash, correlationID string) (FavoriteStoreMutationResult, error) {
	if db == nil {
		return FavoriteStoreMutationResult{}, errors.New("DSH database is nil")
	}
	clientActorID = strings.TrimSpace(clientActorID)
	storeID = strings.TrimSpace(storeID)
	operation = strings.TrimSpace(operation)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	requestHash = strings.TrimSpace(requestHash)
	correlationID = strings.TrimSpace(correlationID)
	if clientActorID == "" || storeID == "" || idempotencyKey == "" || requestHash == "" || correlationID == "" {
		return FavoriteStoreMutationResult{}, errors.New("favorite store mutation facts are invalid")
	}
	if operation != "add" && operation != "remove" {
		return FavoriteStoreMutationResult{}, errors.New("favorite store operation is invalid")
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FavoriteStoreMutationResult{}, fmt.Errorf("begin favorite store mutation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:client-favorite-store:idempotency:"+idempotencyKey); err != nil {
		return FavoriteStoreMutationResult{}, fmt.Errorf("lock favorite store idempotency: %w", err)
	}

	var storedHash, storedActorID, storedStoreID, storedOperation string
	var storedResult bool
	err = tx.QueryRowContext(ctx, `SELECT request_hash, client_actor_id, store_id, operation, result_is_favorite
		FROM dsh.client_favorite_store_mutation_idempotency
		WHERE idempotency_key=$1
		FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedActorID, &storedStoreID, &storedOperation, &storedResult)
	if err == nil {
		if storedHash != requestHash || storedActorID != clientActorID || storedStoreID != storeID || storedOperation != operation {
			return FavoriteStoreMutationResult{}, ErrFavoriteStoreIdempotencyConflict
		}
		if err := tx.Commit(); err != nil {
			return FavoriteStoreMutationResult{}, fmt.Errorf("commit idempotent favorite store mutation: %w", err)
		}
		return FavoriteStoreMutationResult{StoreID: storeID, IsFavorite: storedResult, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FavoriteStoreMutationResult{}, fmt.Errorf("read favorite store idempotency: %w", err)
	}

	var publicationState string
	if err := tx.QueryRowContext(ctx, "SELECT publication_state FROM dsh.stores WHERE id=$1 FOR SHARE", storeID).Scan(&publicationState); errors.Is(err, sql.ErrNoRows) {
		return FavoriteStoreMutationResult{}, ErrStoreNotFound
	} else if err != nil {
		return FavoriteStoreMutationResult{}, fmt.Errorf("read favorite store: %w", err)
	}
	if operation == "add" && publicationState != "published" {
		return FavoriteStoreMutationResult{}, ErrFavoriteStoreUnavailable
	}

	isFavorite := operation == "add"
	if isFavorite {
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.client_favorite_stores(client_actor_id, store_id)
			VALUES($1,$2)
			ON CONFLICT (client_actor_id, store_id) DO NOTHING`, clientActorID, storeID); err != nil {
			return FavoriteStoreMutationResult{}, fmt.Errorf("add client favorite store: %w", err)
		}
	} else if _, err := tx.ExecContext(ctx, "DELETE FROM dsh.client_favorite_stores WHERE client_actor_id=$1 AND store_id=$2", clientActorID, storeID); err != nil {
		return FavoriteStoreMutationResult{}, fmt.Errorf("remove client favorite store: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.client_favorite_store_mutation_idempotency
		(idempotency_key, request_hash, client_actor_id, store_id, operation, result_is_favorite)
		VALUES($1,$2,$3,$4,$5,$6)`, idempotencyKey, requestHash, clientActorID, storeID, operation, isFavorite); err != nil {
		return FavoriteStoreMutationResult{}, fmt.Errorf("record favorite store idempotency: %w", err)
	}
	eventType := "client_store_favorited"
	if !isFavorite {
		eventType = "client_store_unfavorited"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.client_favorite_store_audit
		(event_type, idempotency_key, correlation_id, acting_actor_id, client_actor_id, store_id, result_is_favorite, request_hash)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, eventType, idempotencyKey, correlationID, clientActorID, clientActorID, storeID, isFavorite, requestHash); err != nil {
		return FavoriteStoreMutationResult{}, fmt.Errorf("record favorite store audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return FavoriteStoreMutationResult{}, fmt.Errorf("commit favorite store mutation: %w", err)
	}
	return FavoriteStoreMutationResult{StoreID: storeID, IsFavorite: isFavorite}, nil
}

type FavoriteStoreOfferMutationResult struct {
	StoreOfferID string
	IsFavorite   bool
	Replayed     bool
}

func HashClientFavoriteStoreOfferMutation(operation, storeOfferID string) string {
	return hashFacts("client-favorite-store-offer", strings.TrimSpace(operation), strings.TrimSpace(storeOfferID))
}

func ListClientFavoriteStoreOfferIDs(ctx context.Context, db *sql.DB, clientActorID, storeID string) ([]string, error) {
	if db == nil {
		return nil, errors.New("DSH database is nil")
	}
	clientActorID = strings.TrimSpace(clientActorID)
	storeID = strings.TrimSpace(storeID)
	if clientActorID == "" || storeID == "" {
		return nil, errors.New("favorite store offer scope is required")
	}
	rows, err := db.QueryContext(ctx, `SELECT f.store_offer_id
		FROM dsh.client_favorite_store_offers f
		JOIN dsh.catalog_store_offers o ON o.id=f.store_offer_id
		WHERE f.client_actor_id=$1 AND o.store_id=$2
		ORDER BY f.created_at DESC, f.store_offer_id ASC`, clientActorID, storeID)
	if err != nil {
		return nil, fmt.Errorf("list client favorite store offers: %w", err)
	}
	defer rows.Close()
	offerIDs := make([]string, 0)
	for rows.Next() {
		var offerID string
		if err := rows.Scan(&offerID); err != nil {
			return nil, fmt.Errorf("scan client favorite store offer: %w", err)
		}
		offerIDs = append(offerIDs, offerID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read client favorite store offers: %w", err)
	}
	return offerIDs, nil
}

func SetClientFavoriteStoreOffer(ctx context.Context, db *sql.DB, clientActorID, storeOfferID, operation, idempotencyKey, requestHash, correlationID string) (FavoriteStoreOfferMutationResult, error) {
	facts := normalizeFavoriteStoreOfferMutation(clientActorID, storeOfferID, operation, idempotencyKey, requestHash, correlationID)
	if db == nil || facts.clientActorID == "" || facts.storeOfferID == "" || facts.idempotencyKey == "" || facts.requestHash == "" || facts.correlationID == "" || (facts.operation != "add" && facts.operation != "remove") {
		return FavoriteStoreOfferMutationResult{}, errors.New("favorite store offer mutation facts are invalid")
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FavoriteStoreOfferMutationResult{}, fmt.Errorf("begin favorite store offer mutation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockFavoriteStoreOfferMutationTx(ctx, tx, facts.idempotencyKey); err != nil {
		return FavoriteStoreOfferMutationResult{}, err
	}
	if replay, found, err := readFavoriteStoreOfferMutationReplayTx(ctx, tx, facts); err != nil {
		return FavoriteStoreOfferMutationResult{}, err
	} else if found {
		if err := tx.Commit(); err != nil {
			return FavoriteStoreOfferMutationResult{}, fmt.Errorf("commit idempotent favorite store offer mutation: %w", err)
		}
		return replay, nil
	}
	if err := validateFavoriteStoreOfferTargetTx(ctx, tx, facts.storeOfferID, facts.operation); err != nil {
		return FavoriteStoreOfferMutationResult{}, err
	}
	result, err := applyFavoriteStoreOfferMutationTx(ctx, tx, facts)
	if err != nil {
		return FavoriteStoreOfferMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return FavoriteStoreOfferMutationResult{}, fmt.Errorf("commit favorite store offer mutation: %w", err)
	}
	return result, nil
}

type favoriteStoreOfferMutationFacts struct {
	clientActorID  string
	storeOfferID   string
	operation      string
	idempotencyKey string
	requestHash    string
	correlationID  string
}

func normalizeFavoriteStoreOfferMutation(clientActorID, storeOfferID, operation, idempotencyKey, requestHash, correlationID string) favoriteStoreOfferMutationFacts {
	return favoriteStoreOfferMutationFacts{
		clientActorID:  strings.TrimSpace(clientActorID),
		storeOfferID:   strings.TrimSpace(storeOfferID),
		operation:      strings.TrimSpace(operation),
		idempotencyKey: strings.TrimSpace(idempotencyKey),
		requestHash:    strings.TrimSpace(requestHash),
		correlationID:  strings.TrimSpace(correlationID),
	}
}

func lockFavoriteStoreOfferMutationTx(ctx context.Context, tx *sql.Tx, idempotencyKey string) error {
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:client-favorite-store-offer:idempotency:"+idempotencyKey); err != nil {
		return fmt.Errorf("lock favorite store offer idempotency: %w", err)
	}
	return nil
}

func readFavoriteStoreOfferMutationReplayTx(ctx context.Context, tx *sql.Tx, facts favoriteStoreOfferMutationFacts) (FavoriteStoreOfferMutationResult, bool, error) {
	var storedHash, storedActorID, storedOfferID, storedOperation string
	var storedResult bool
	err := tx.QueryRowContext(ctx, `SELECT request_hash, client_actor_id, store_offer_id, operation, result_is_favorite
		FROM dsh.client_favorite_store_offer_mutation_idempotency
		WHERE idempotency_key=$1
		FOR UPDATE`, facts.idempotencyKey).Scan(&storedHash, &storedActorID, &storedOfferID, &storedOperation, &storedResult)
	if errors.Is(err, sql.ErrNoRows) {
		return FavoriteStoreOfferMutationResult{}, false, nil
	}
	if err != nil {
		return FavoriteStoreOfferMutationResult{}, false, fmt.Errorf("read favorite store offer idempotency: %w", err)
	}
	if storedHash != facts.requestHash || storedActorID != facts.clientActorID || storedOfferID != facts.storeOfferID || storedOperation != facts.operation {
		return FavoriteStoreOfferMutationResult{}, false, ErrFavoriteStoreOfferIdempotencyConflict
	}
	return FavoriteStoreOfferMutationResult{StoreOfferID: facts.storeOfferID, IsFavorite: storedResult, Replayed: true}, true, nil
}

func validateFavoriteStoreOfferTargetTx(ctx context.Context, tx *sql.Tx, storeOfferID, operation string) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM dsh.catalog_store_offers WHERE id=$1)", storeOfferID).Scan(&exists); err != nil {
		return fmt.Errorf("read favorite store offer existence: %w", err)
	}
	if !exists {
		return ErrCatalogOfferNotFound
	}
	if operation != "add" {
		return nil
	}
	conditions := append(customerVisibleOfferConditions(), "EXISTS (SELECT 1 FROM dsh.service_cities city WHERE city.id=s.service_city_id AND city.active=true)")
	query := `SELECT 1
		FROM dsh.catalog_store_offers o
		JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
		JOIN dsh.catalog_products p ON p.id=v.product_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE o.id=$1 AND ` + strings.Join(conditions, " AND ") + `
		FOR SHARE OF o,v,p,s`
	var visible int
	if err := tx.QueryRowContext(ctx, query, storeOfferID).Scan(&visible); errors.Is(err, sql.ErrNoRows) {
		return ErrFavoriteStoreOfferUnavailable
	} else if err != nil {
		return fmt.Errorf("verify customer-visible favorite store offer: %w", err)
	}
	return nil
}

func applyFavoriteStoreOfferMutationTx(ctx context.Context, tx *sql.Tx, facts favoriteStoreOfferMutationFacts) (FavoriteStoreOfferMutationResult, error) {
	isFavorite := facts.operation == "add"
	if isFavorite {
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.client_favorite_store_offers(client_actor_id, store_offer_id)
			VALUES($1,$2) ON CONFLICT (client_actor_id, store_offer_id) DO NOTHING`, facts.clientActorID, facts.storeOfferID); err != nil {
			return FavoriteStoreOfferMutationResult{}, fmt.Errorf("add client favorite store offer: %w", err)
		}
	} else if _, err := tx.ExecContext(ctx, "DELETE FROM dsh.client_favorite_store_offers WHERE client_actor_id=$1 AND store_offer_id=$2", facts.clientActorID, facts.storeOfferID); err != nil {
		return FavoriteStoreOfferMutationResult{}, fmt.Errorf("remove client favorite store offer: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.client_favorite_store_offer_mutation_idempotency
		(idempotency_key, request_hash, client_actor_id, store_offer_id, operation, result_is_favorite)
		VALUES($1,$2,$3,$4,$5,$6)`, facts.idempotencyKey, facts.requestHash, facts.clientActorID, facts.storeOfferID, facts.operation, isFavorite); err != nil {
		return FavoriteStoreOfferMutationResult{}, fmt.Errorf("record favorite store offer idempotency: %w", err)
	}
	eventType := "client_store_offer_favorited"
	if !isFavorite {
		eventType = "client_store_offer_unfavorited"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.client_favorite_store_offer_audit
		(event_type, idempotency_key, correlation_id, acting_actor_id, client_actor_id, store_offer_id, result_is_favorite, request_hash)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, eventType, facts.idempotencyKey, facts.correlationID, facts.clientActorID, facts.clientActorID, facts.storeOfferID, isFavorite, facts.requestHash); err != nil {
		return FavoriteStoreOfferMutationResult{}, fmt.Errorf("record favorite store offer audit: %w", err)
	}
	return FavoriteStoreOfferMutationResult{StoreOfferID: facts.storeOfferID, IsFavorite: isFavorite}, nil
}
