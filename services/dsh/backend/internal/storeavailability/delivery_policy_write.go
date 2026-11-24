package storeavailability

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type CityDeliveryPolicyWriter interface {
	ApplyCityDeliveryPolicy(context.Context, string, string, string, int64, int64, []DistanceBand, string) (CityDeliveryPolicy, bool, error)
}

func validDeliveryPolicyChange(city, operation string, expected, radius int64, bands []DistanceBand, reason string) bool {
	raw, err := json.Marshal(bands)
	_, valid := DecodeDistanceBands(raw)
	return err == nil && valid && cityPolicyIDRule.MatchString(city) && operationIDRule.MatchString(operation) &&
		expected >= 1 && expected < 9007199254740991 && radius >= 1 && radius <= 2147483647 &&
		utf8.ValidString(reason) && utf8.RuneCountInString(reason) <= 300 && strings.TrimSpace(reason) != ""
}

func cityDeliveryPolicyWriteHandler(identity IdentitySessions, writer CityDeliveryPolicyWriter) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		actor, ok := authorizeCityPolicyOperator(w, r, identity)
		if !ok {
			return
		}
		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || media != "application/json" || r.URL.ForceQuery {
			writeFailure(w, ErrInvalidChange)
			return
		}
		var input struct {
			OperationID     string          `json:"operationId"`
			ExpectedVersion *int64          `json:"expectedVersion"`
			RadiusMetres    *int64          `json:"radiusMetres"`
			DistanceBands   json.RawMessage `json:"distanceBands"`
			Reason          string          `json:"reason"`
		}
		if decodeUniqueJSON(w, r, 8192, &input) != nil || input.ExpectedVersion == nil || input.RadiusMetres == nil {
			writeFailure(w, ErrInvalidChange)
			return
		}
		bands, valid := DecodeDistanceBands(input.DistanceBands)
		city := r.PathValue("cityID")
		if !valid || !validDeliveryPolicyChange(city, input.OperationID, *input.ExpectedVersion, *input.RadiusMetres, bands, input.Reason) {
			writeFailure(w, ErrInvalidChange)
			return
		}
		current, ok := authorizeCityPolicyOperator(w, r, identity)
		if !ok {
			return
		}
		if current != actor {
			writeFailure(w, ErrForbidden)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()
		p, replay, err := writer.ApplyCityDeliveryPolicy(ctx, actor, city, input.OperationID, *input.ExpectedVersion, *input.RadiusMetres, bands, strings.TrimSpace(input.Reason))
		if err != nil {
			writeFailure(w, err)
			return
		}
		if p.CityID != city || p.Version != *input.ExpectedVersion+1 {
			writeFailure(w, ErrUnknownResult)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			Policy CityDeliveryPolicy `json:"policy"`
			Replay bool               `json:"replay"`
		}{p, replay})
	}
}

func readDeliveryCommand(ctx context.Context, tx *sql.Tx, city, operation, hash string) (CityDeliveryPolicy, bool, error) {
	var p CityDeliveryPolicy
	var storedHash string
	var raw []byte
	err := tx.QueryRowContext(ctx, `SELECT city_id,resulting_version,radius_metres,distance_bands,changed_at,request_hash
 FROM service_city_delivery_policy_commands WHERE city_id=$1 AND operation_id=$2`, city, operation).Scan(&p.CityID, &p.Version, &p.RadiusMetres, &raw, &p.UpdatedAt, &storedHash)
	if errors.Is(err, sql.ErrNoRows) {
		return CityDeliveryPolicy{}, false, nil
	}
	if err != nil {
		return CityDeliveryPolicy{}, false, err
	}
	if storedHash != hash {
		return CityDeliveryPolicy{}, false, ErrOperationConflict
	}
	var valid bool
	p.DistanceBands, valid = DecodeDistanceBands(raw)
	if !valid || p.UpdatedAt.IsZero() {
		return CityDeliveryPolicy{}, false, ErrPolicyUnavailable
	}
	p.UpdatedAt = p.UpdatedAt.UTC()
	return p, true, nil
}

func (source *PostgresPolicySource) ApplyCityDeliveryPolicy(ctx context.Context, actor, city, operation string, expected, radius int64, bands []DistanceBand, reason string) (CityDeliveryPolicy, bool, error) {
	if source == nil || source.db == nil {
		return CityDeliveryPolicy{}, false, ErrPolicyUnavailable
	}
	if !validDeliveryPolicyChange(city, operation, expected, radius, bands, reason) || actor == "" || len(actor) > 128 || !utf8.ValidString(actor) || strings.TrimSpace(actor) != actor {
		return CityDeliveryPolicy{}, false, ErrInvalidChange
	}
	reason = strings.TrimSpace(reason)
	raw, err := json.Marshal(bands)
	if err != nil {
		return CityDeliveryPolicy{}, false, ErrInvalidChange
	}
	payload, err := json.Marshal(struct {
		Actor, City, Operation, Reason string
		Expected, Radius               int64
		Bands                          json.RawMessage
	}{actor, city, operation, reason, expected, radius, raw})
	if err != nil {
		return CityDeliveryPolicy{}, false, ErrInvalidChange
	}
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])
	tx, err := beginScopedStoreTx(ctx, source.db, source.schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return CityDeliveryPolicy{}, false, ErrPolicyUnavailable
	}
	defer tx.Rollback()
	var active bool
	if err = tx.QueryRowContext(ctx, `SELECT active FROM service_cities WHERE id=$1 FOR UPDATE`, city).Scan(&active); err != nil || !active {
		return CityDeliveryPolicy{}, false, ErrPolicyUnavailable
	}
	prior, found, err := readDeliveryCommand(ctx, tx, city, operation, hash)
	if errors.Is(err, ErrOperationConflict) {
		return CityDeliveryPolicy{}, false, err
	}
	if err != nil {
		return CityDeliveryPolicy{}, false, ErrPolicyUnavailable
	}
	if found {
		if tx.Commit() != nil {
			return CityDeliveryPolicy{}, false, ErrUnknownResult
		}
		return prior, true, nil
	}
	var p CityDeliveryPolicy
	err = tx.QueryRowContext(ctx, `UPDATE service_city_delivery_policies SET version=version+1,radius_metres=$3,distance_bands=$4::jsonb,updated_at=transaction_timestamp()
 WHERE city_id=$1 AND version=$2 RETURNING city_id,version,radius_metres,updated_at`, city, expected, radius, string(raw)).Scan(&p.CityID, &p.Version, &p.RadiusMetres, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CityDeliveryPolicy{}, false, ErrPolicyVersionConflict
	}
	if err != nil {
		return CityDeliveryPolicy{}, false, ErrPolicyUnavailable
	}
	p.DistanceBands = bands
	p.UpdatedAt = p.UpdatedAt.UTC()
	_, err = tx.ExecContext(ctx, `INSERT INTO service_city_delivery_policy_commands(city_id,operation_id,request_hash,acting_actor_id,reason,resulting_version,radius_metres,distance_bands,changed_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`, city, operation, hash, actor, reason, p.Version, p.RadiusMetres, string(raw), p.UpdatedAt)
	if err != nil {
		return CityDeliveryPolicy{}, false, ErrPolicyUnavailable
	}
	if err = tx.Commit(); err == nil {
		return p, false, nil
	}
	// A lost commit reply is not proof of rollback. Only an identical command may be reconciled.
	read, err := beginScopedStoreTx(ctx, source.db, source.schema, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return CityDeliveryPolicy{}, false, ErrUnknownResult
	}
	defer read.Rollback()
	prior, found, err = readDeliveryCommand(ctx, read, city, operation, hash)
	if errors.Is(err, ErrOperationConflict) {
		return CityDeliveryPolicy{}, false, err
	}
	if err == nil && found && read.Commit() == nil {
		return prior, true, nil
	}
	return CityDeliveryPolicy{}, false, ErrUnknownResult
}
