package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

var ErrWalletProviderIntentNotFound = errors.New("wallet provider intent was not found for the active beneficiary")

type WalletProviderIntent struct {
	ActorType   string
	ActorID     string
	ProviderKey string
	SourceID    string
}

func NormalizeWalletProviderKey(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" || utf8.RuneCountInString(value) > 64 {
		return "", false
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return "", false
		}
	}
	return value, true
}

func ReadWalletProviderIntent(ctx context.Context, db *sql.DB, actorType, actorID string) (WalletProviderIntent, error) {
	actorType, actorID = strings.ToLower(strings.TrimSpace(actorType)), strings.TrimSpace(actorID)
	if db == nil || actorID == "" || len(actorID) > 128 {
		return WalletProviderIntent{}, ErrWalletProviderIntentNotFound
	}
	var intent WalletProviderIntent
	intent.ActorType, intent.ActorID = actorType, actorID
	var query string
	switch actorType {
	case "partner":
		query = `SELECT id,COALESCE(wallet_provider_key,'') FROM dsh.joining_cases WHERE partner_actor_id=$1 AND state='approved'`
	case "field":
		query = `SELECT id,COALESCE(wallet_provider_key,'') FROM dsh.field_admissions WHERE actor_id=$1 AND state='eligible' AND requires_profile_review=false`
	case "captain":
		query = `SELECT id,COALESCE(wallet_provider_key,'') FROM dsh.captain_admissions WHERE actor_id=$1 AND state='eligible' AND requires_profile_review=false`
	default:
		return WalletProviderIntent{}, ErrWalletProviderIntentNotFound
	}
	if err := db.QueryRowContext(ctx, query, actorID).Scan(&intent.SourceID, &intent.ProviderKey); errors.Is(err, sql.ErrNoRows) {
		return WalletProviderIntent{}, ErrWalletProviderIntentNotFound
	} else if err != nil {
		return WalletProviderIntent{}, err
	}
	provider, valid := NormalizeWalletProviderKey(intent.ProviderKey)
	if !valid {
		return WalletProviderIntent{}, ErrWalletProviderIntentNotFound
	}
	intent.ProviderKey = provider
	return intent, nil
}
