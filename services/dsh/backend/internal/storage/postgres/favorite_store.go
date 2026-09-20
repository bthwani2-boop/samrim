package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

var (
	ErrFavoriteStoreIdempotencyConflict = errors.New("favorite store idempotency key was already used with different facts")
	ErrFavoriteStoreUnavailable         = errors.New("store is not currently available for favorites")
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
