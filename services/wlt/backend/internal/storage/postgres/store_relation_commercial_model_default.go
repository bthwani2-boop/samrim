package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrStoreRelationCommercialDefaultInvalid   = errors.New("store relation commercial model default is invalid")
	ErrStoreRelationCommercialDefaultVersion   = errors.New("store relation commercial model default version changed")
	ErrStoreRelationCommercialDefaultUnchanged = errors.New("store relation commercial model default is unchanged")
)

type StoreRelationCommercialModelDefault struct {
	RelationModel    string    `json:"relationModel"`
	CommercialModel  string    `json:"commercialModel"`
	PolicyVersion    int       `json:"policyVersion"`
	UpdatedAt        time.Time `json:"updatedAt"`
	ChangedByActorID string    `json:"changedByActorId"`
	ChangeReason     string    `json:"changeReason"`
}

type StoreRelationCommercialModelDefaultUpdate struct {
	RelationModel   string
	CommercialModel string
	ExpectedVersion int
	ActingActorID   string
	Reason          string
	IdempotencyKey  string
	CorrelationID   string
}

func validStoreRelationCommercialModel(relation, model string) bool {
	return (relation == "BTHWANI_PARTNER" || relation == "INDEPENDENT_STORE") &&
		(model == "COMMISSION" || model == "SUBSCRIPTION")
}

func validStoreRelationCommercialModelUpdate(input StoreRelationCommercialModelDefaultUpdate) bool {
	return validStoreRelationCommercialModel(input.RelationModel, input.CommercialModel) &&
		input.ExpectedVersion >= 0 && input.ExpectedVersion < 1000000 &&
		len(input.ActingActorID) >= 1 && len(input.ActingActorID) <= 128 &&
		utf8.RuneCountInString(input.Reason) >= 8 && utf8.RuneCountInString(input.Reason) <= 500 &&
		len(input.IdempotencyKey) >= 8 && len(input.IdempotencyKey) <= 128 &&
		len(input.CorrelationID) >= 8 && len(input.CorrelationID) <= 128
}

func ReadStoreRelationCommercialModelDefaults(ctx context.Context, db *sql.DB) ([]StoreRelationCommercialModelDefault, error) {
	if db == nil {
		return nil, ErrStoreRelationCommercialDefaultInvalid
	}
	rows, err := db.QueryContext(ctx, `SELECT relation_model,commercial_model,policy_version,updated_at,last_changed_by_actor_id,last_change_reason
		FROM wlt.store_relation_commercial_model_defaults ORDER BY relation_model`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]StoreRelationCommercialModelDefault, 0, 2)
	for rows.Next() {
		var item StoreRelationCommercialModelDefault
		if err := rows.Scan(&item.RelationModel, &item.CommercialModel, &item.PolicyVersion,
			&item.UpdatedAt, &item.ChangedByActorID, &item.ChangeReason); err != nil {
			return nil, err
		}
		if !validStoreRelationCommercialModel(item.RelationModel, item.CommercialModel) || item.PolicyVersion < 1 {
			return nil, ErrStoreRelationCommercialDefaultInvalid
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func readStoreRelationCommercialModelDefault(ctx context.Context, tx *sql.Tx, relation string) (StoreRelationCommercialModelDefault, error) {
	var item StoreRelationCommercialModelDefault
	err := tx.QueryRowContext(ctx, `SELECT relation_model,commercial_model,policy_version,updated_at,last_changed_by_actor_id,last_change_reason
		FROM wlt.store_relation_commercial_model_defaults WHERE relation_model=$1`, relation).Scan(
		&item.RelationModel, &item.CommercialModel, &item.PolicyVersion,
		&item.UpdatedAt, &item.ChangedByActorID, &item.ChangeReason)
	return item, err
}

// WLT is the only writer. The suggested model is prospective: no Store agreement
// or payment state is updated. A replay returns the historical versioned receipt.
func UpdateStoreRelationCommercialModelDefault(ctx context.Context, db *sql.DB, input StoreRelationCommercialModelDefaultUpdate) (StoreRelationCommercialModelDefault, bool, error) {
	input.RelationModel = strings.TrimSpace(input.RelationModel)
	input.CommercialModel = strings.TrimSpace(input.CommercialModel)
	input.ActingActorID = strings.TrimSpace(input.ActingActorID)
	input.Reason = strings.TrimSpace(input.Reason)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || !validStoreRelationCommercialModelUpdate(input) {
		return StoreRelationCommercialModelDefault{}, false, ErrStoreRelationCommercialDefaultInvalid
	}
	hash := hashFacts("store-relation-commercial-model-default-v1", input.RelationModel, input.CommercialModel,
		strconv.Itoa(input.ExpectedVersion), input.ActingActorID, input.Reason)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreRelationCommercialModelDefault{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
		"wlt:store-relation-commercial-model:"+input.RelationModel); err != nil {
		return StoreRelationCommercialModelDefault{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
		"wlt:store-relation-commercial-model-idempotency:"+input.IdempotencyKey); err != nil {
		return StoreRelationCommercialModelDefault{}, false, err
	}

	var priorHash string
	var replay StoreRelationCommercialModelDefault
	err = tx.QueryRowContext(ctx, `SELECT request_hash,relation_model,new_model,new_policy_version,changed_at,changed_by_actor_id,reason
		FROM wlt.store_relation_commercial_model_default_events WHERE idempotency_key=$1`, input.IdempotencyKey).Scan(
		&priorHash, &replay.RelationModel, &replay.CommercialModel, &replay.PolicyVersion,
		&replay.UpdatedAt, &replay.ChangedByActorID, &replay.ChangeReason)
	if err == nil {
		if priorHash != hash {
			return StoreRelationCommercialModelDefault{}, false, ErrIdempotencyConflict
		}
		if err = tx.Commit(); err != nil {
			return StoreRelationCommercialModelDefault{}, false, err
		}
		return replay, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StoreRelationCommercialModelDefault{}, false, err
	}

	current, readErr := readStoreRelationCommercialModelDefault(ctx, tx, input.RelationModel)
	var oldModel any
	var oldVersion any
	var updatedAt time.Time
	version := 1
	if readErr == nil {
		if current.PolicyVersion != input.ExpectedVersion {
			return StoreRelationCommercialModelDefault{}, false, ErrStoreRelationCommercialDefaultVersion
		}
		if current.CommercialModel == input.CommercialModel {
			return StoreRelationCommercialModelDefault{}, false, ErrStoreRelationCommercialDefaultUnchanged
		}
		oldModel, oldVersion, version = current.CommercialModel, current.PolicyVersion, current.PolicyVersion+1
		err = tx.QueryRowContext(ctx, `UPDATE wlt.store_relation_commercial_model_defaults
			SET commercial_model=$2,policy_version=$3,updated_at=clock_timestamp(),
				last_changed_by_actor_id=$4,last_change_reason=$5 WHERE relation_model=$1
			RETURNING updated_at`,
			input.RelationModel, input.CommercialModel, version, input.ActingActorID, input.Reason).Scan(&updatedAt)
	} else if errors.Is(readErr, sql.ErrNoRows) {
		if input.ExpectedVersion != 0 {
			return StoreRelationCommercialModelDefault{}, false, ErrStoreRelationCommercialDefaultVersion
		}
		err = tx.QueryRowContext(ctx, `INSERT INTO wlt.store_relation_commercial_model_defaults
			(relation_model,commercial_model,policy_version,last_changed_by_actor_id,last_change_reason)
			VALUES($1,$2,1,$3,$4) RETURNING updated_at`,
			input.RelationModel, input.CommercialModel, input.ActingActorID, input.Reason).Scan(&updatedAt)
	} else {
		return StoreRelationCommercialModelDefault{}, false, readErr
	}
	if err != nil {
		return StoreRelationCommercialModelDefault{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO wlt.store_relation_commercial_model_default_events
		(idempotency_key,request_hash,relation_model,previous_model,new_model,previous_policy_version,
			new_policy_version,changed_by_actor_id,reason,correlation_id,changed_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, input.IdempotencyKey, hash, input.RelationModel,
		oldModel, input.CommercialModel, oldVersion, version, input.ActingActorID, input.Reason, input.CorrelationID, updatedAt); err != nil {
		return StoreRelationCommercialModelDefault{}, false, err
	}
	result, err := readStoreRelationCommercialModelDefault(ctx, tx, input.RelationModel)
	if err != nil {
		return StoreRelationCommercialModelDefault{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return StoreRelationCommercialModelDefault{}, false, err
	}
	return result, false, nil
}
