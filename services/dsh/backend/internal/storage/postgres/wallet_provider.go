package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
)

type WalletProvider struct {
	Key                  string
	DisplayNameAr        string
	Active               bool
	Version              int
	CreatedAt, UpdatedAt time.Time
}
type WalletProviderResult struct {
	Provider WalletProvider
	Replayed bool
}

var ErrWalletProviderNotFound = errors.New("wallet provider was not found")
var ErrWalletProviderExists = errors.New("wallet provider already exists")
var ErrWalletProviderVersion = errors.New("wallet provider version is stale")
var ErrWalletProviderIdempotency = errors.New("wallet provider idempotency conflict")
var ErrWalletProviderInvalid = errors.New("wallet provider facts are invalid")

func HashWalletProviderMutation(key, name string, active bool, version int) string {
	return hashFacts("wallet-provider", strings.TrimSpace(key), strings.TrimSpace(name), fmt.Sprint(active), fmt.Sprint(version))
}

func ListWalletProviders(ctx context.Context, db *sql.DB, activeOnly bool) ([]WalletProvider, error) {
	query := `SELECT key,display_name_ar,active,version,created_at,updated_at FROM dsh.wallet_providers`
	if activeOnly {
		query += ` WHERE active=true`
	}
	query += ` ORDER BY key`
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]WalletProvider, 0)
	for rows.Next() {
		var p WalletProvider
		if err := rows.Scan(&p.Key, &p.DisplayNameAr, &p.Active, &p.Version, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, p)
	}
	return items, rows.Err()
}
func IsActiveWalletProvider(ctx context.Context, db *sql.DB, key string) (bool, error) {
	var active bool
	err := db.QueryRowContext(ctx, `SELECT active FROM dsh.wallet_providers WHERE key=$1`, strings.TrimSpace(key)).Scan(&active)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return active, err
}
func MutateWalletProvider(ctx context.Context, db *sql.DB, key, name string, active bool, expected int, idem, hash, actor, correlation string) (WalletProviderResult, error) {
	key, name, idem, hash, actor, correlation = strings.TrimSpace(key), strings.TrimSpace(name), strings.TrimSpace(idem), strings.TrimSpace(hash), strings.TrimSpace(actor), strings.TrimSpace(correlation)
	if db == nil || !validWalletProviderKey(key) || !validWalletProviderName(name) || idem == "" || hash == "" || actor == "" || correlation == "" || expected < 0 {
		return WalletProviderResult{}, ErrWalletProviderInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return WalletProviderResult{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, `dsh:wallet-provider:idempotency:`+idem)
	if err != nil {
		return WalletProviderResult{}, err
	}
	var oldHash, oldKey, operation string
	var oldVersion sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT request_hash,provider_key,operation,expected_version FROM dsh.wallet_provider_mutation_idempotency WHERE idempotency_key=$1`, idem).Scan(&oldHash, &oldKey, &operation, &oldVersion)
	if err == nil {
		if oldHash != hash || oldKey != key || (expected == 0 && operation != "create") || (expected > 0 && (operation != "update" || !oldVersion.Valid || int(oldVersion.Int64) != expected)) {
			return WalletProviderResult{}, ErrWalletProviderIdempotency
		}
		var p WalletProvider
		if e := tx.QueryRowContext(ctx, `SELECT provider_key,display_name_ar,to_active,result_version FROM dsh.wallet_provider_audit WHERE idempotency_key=$1`, idem).Scan(&p.Key, &p.DisplayNameAr, &p.Active, &p.Version); e != nil {
			return WalletProviderResult{}, e
		}
		if e := tx.Commit(); e != nil {
			return WalletProviderResult{}, e
		}
		return WalletProviderResult{Provider: p, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return WalletProviderResult{}, err
	}
	_, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:wallet-provider:name:"+strings.ToLower(name))
	if err != nil {
		return WalletProviderResult{}, err
	}
	var existingKey string
	if expected == 0 {
		err = tx.QueryRowContext(ctx, `SELECT key FROM dsh.wallet_providers WHERE lower(btrim(display_name_ar))=lower(btrim($1))`, name).Scan(&existingKey)
	} else {
		err = tx.QueryRowContext(ctx, `SELECT key FROM dsh.wallet_providers WHERE lower(btrim(display_name_ar))=lower(btrim($1)) AND key<>$2`, name, key).Scan(&existingKey)
	}
	if err == nil {
		return WalletProviderResult{}, ErrWalletProviderExists
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return WalletProviderResult{}, err
	}
	var p WalletProvider
	event := "wallet_provider_created"
	fromVersion := 0
	var fromActive any
	if expected == 0 {
		err = tx.QueryRowContext(ctx, `INSERT INTO dsh.wallet_providers(key,display_name_ar,active) VALUES($1,$2,$3) RETURNING key,display_name_ar,active,version,created_at,updated_at`, key, name, active).Scan(&p.Key, &p.DisplayNameAr, &p.Active, &p.Version, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "duplicate") {
				return WalletProviderResult{}, ErrWalletProviderExists
			}
			return WalletProviderResult{}, err
		}
	} else {
		event = "wallet_provider_updated"
		err = tx.QueryRowContext(ctx, `SELECT key,display_name_ar,active,version,created_at,updated_at FROM dsh.wallet_providers WHERE key=$1 FOR UPDATE`, key).Scan(&p.Key, &p.DisplayNameAr, &p.Active, &p.Version, &p.CreatedAt, &p.UpdatedAt)
		if errors.Is(err, sql.ErrNoRows) {
			return WalletProviderResult{}, ErrWalletProviderNotFound
		}
		if err != nil {
			return WalletProviderResult{}, err
		}
		if p.Version != expected {
			return WalletProviderResult{}, ErrWalletProviderVersion
		}
		fromVersion = p.Version
		fromActive = p.Active
		err = tx.QueryRowContext(ctx, `UPDATE dsh.wallet_providers SET display_name_ar=$2,active=$3,version=version+1,updated_at=clock_timestamp() WHERE key=$1 RETURNING key,display_name_ar,active,version,created_at,updated_at`, key, name, active).Scan(&p.Key, &p.DisplayNameAr, &p.Active, &p.Version, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return WalletProviderResult{}, err
		}
	}
	var expectedValue any
	if expected > 0 {
		expectedValue = expected
	}
	op := "create"
	if expected > 0 {
		op = "update"
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.wallet_provider_mutation_idempotency(idempotency_key,request_hash,provider_key,operation,expected_version) VALUES($1,$2,$3,$4,$5)`, idem, hash, key, op, expectedValue); err != nil {
		return WalletProviderResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.wallet_provider_audit(event_type,idempotency_key,correlation_id,acting_actor_id,provider_key,from_version,result_version,from_active,to_active,request_hash,display_name_ar) VALUES($1,$2,$3,$4,$5,NULLIF($6,0),$7,$8,$9,$10,$11)`, event, idem, correlation, actor, key, fromVersion, p.Version, fromActive, p.Active, hash, p.DisplayNameAr); err != nil {
		return WalletProviderResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return WalletProviderResult{}, fmt.Errorf("commit wallet provider mutation: %w", err)
	}
	return WalletProviderResult{Provider: p}, nil
}
func readWalletProvider(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, key string) (WalletProvider, error) {
	var p WalletProvider
	err := q.QueryRowContext(ctx, `SELECT key,display_name_ar,active,version,created_at,updated_at FROM dsh.wallet_providers WHERE key=$1`, key).Scan(&p.Key, &p.DisplayNameAr, &p.Active, &p.Version, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrWalletProviderNotFound
	}
	return p, err
}
func validWalletProviderKey(key string) bool {
	if len(key) < 20 || len(key) > 78 || !strings.HasPrefix(key, "wallet_provider_") {
		return false
	}
	for _, c := range key {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_') {
			return false
		}
	}
	return true
}

func validWalletProviderName(value string) bool {
	value = strings.TrimSpace(value)
	if len([]rune(value)) < 2 || len([]rune(value)) > 80 {
		return false
	}
	hasArabic := false
	for _, c := range value {
		switch {
		case unicode.Is(unicode.Arabic, c):
			hasArabic = true
		case unicode.IsSpace(c), unicode.IsDigit(c), unicode.IsMark(c), unicode.IsPunct(c):
		default:
			return false
		}
	}
	return hasArabic
}
