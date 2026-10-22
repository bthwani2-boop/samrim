package postgres

import (
	"context"
	"database/sql"
	"errors"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"strings"
)

type WalletProviderLogoInput struct {
	ProviderKey                                                                                  string
	ExpectedVersion                                                                              int
	IdempotencyKey, ActingActorID, CorrelationID, ObjectKey, LogoURI, ContentSHA256, ContentType string
	Provenance                                                                                   media.Provenance
}

func walletLogoHash(in WalletProviderLogoInput) string {
	p := in.Provenance.Normalized()
	return hashFacts("wallet-provider-logo", in.ProviderKey, in.ObjectKey, in.ContentSHA256, in.ContentType, p.Creator, p.SourceDescription, p.SourceURI, p.RightsStatement, p.RightsURI, in.ActingActorID)
}

func ReadWalletProvider(ctx context.Context, db *sql.DB, key string) (WalletProvider, error) {
	return readWalletProvider(ctx, db, strings.TrimSpace(key))
}

func ReadWalletProviderLogoReplay(ctx context.Context, db *sql.DB, in WalletProviderLogoInput) (bool, bool, error) {
	var key, h string
	var ver int
	err := db.QueryRowContext(ctx, `SELECT provider_key,request_hash,expected_version FROM dsh.wallet_provider_logo_uploads WHERE idempotency_key=$1`, in.IdempotencyKey).Scan(&key, &h, &ver)
	if errors.Is(err, sql.ErrNoRows) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	return true, key == in.ProviderKey && h == walletLogoHash(in) && ver == in.ExpectedVersion, nil
}

func AttachWalletProviderLogo(ctx context.Context, db *sql.DB, in WalletProviderLogoInput) (WalletProviderResult, error) {
	in.Provenance = in.Provenance.Normalized()
	if !validWalletProviderKey(in.ProviderKey) || in.ExpectedVersion < 1 || len(in.IdempotencyKey) < 8 || len(in.ContentSHA256) != 64 || in.LogoURI == "" || in.ActingActorID == "" || in.CorrelationID == "" || in.Provenance.Validate() != nil {
		return WalletProviderResult{}, ErrWalletProviderInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return WalletProviderResult{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "dsh:wallet-provider:idempotency:"+in.IdempotencyKey)
	if err != nil {
		return WalletProviderResult{}, err
	}
	var otherKey, otherHash string
	var otherVersion int
	err = tx.QueryRowContext(ctx, `SELECT provider_key,request_hash,expected_version FROM dsh.wallet_provider_logo_uploads WHERE idempotency_key=$1`, in.IdempotencyKey).Scan(&otherKey, &otherHash, &otherVersion)
	if err == nil {
		if otherKey != in.ProviderKey || otherHash != walletLogoHash(in) || otherVersion != in.ExpectedVersion {
			return WalletProviderResult{}, ErrWalletProviderIdempotency
		}
		p, e := readWalletProvider(ctx, tx, in.ProviderKey)
		if e != nil {
			return WalletProviderResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return WalletProviderResult{}, e
		}
		return WalletProviderResult{Provider: p, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return WalletProviderResult{}, err
	}
	var used bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.wallet_provider_mutation_idempotency WHERE idempotency_key=$1)`, in.IdempotencyKey).Scan(&used); err != nil {
		return WalletProviderResult{}, err
	}
	if used {
		return WalletProviderResult{}, ErrWalletProviderIdempotency
	}
	var p WalletProvider
	err = tx.QueryRowContext(ctx, `SELECT key,display_name_ar,active,version,created_at,updated_at,logo_uri FROM dsh.wallet_providers WHERE key=$1 FOR UPDATE`, in.ProviderKey).Scan(&p.Key, &p.DisplayNameAr, &p.Active, &p.Version, &p.CreatedAt, &p.UpdatedAt, &p.LogoURI)
	if errors.Is(err, sql.ErrNoRows) {
		return WalletProviderResult{}, ErrWalletProviderNotFound
	}
	if err != nil {
		return WalletProviderResult{}, err
	}
	if p.Version != in.ExpectedVersion {
		return WalletProviderResult{}, ErrWalletProviderVersion
	}
	previousVersion := p.Version
	err = tx.QueryRowContext(ctx, `UPDATE dsh.wallet_providers SET logo_uri=$2,version=version+1,updated_at=clock_timestamp() WHERE key=$1 RETURNING key,display_name_ar,active,version,created_at,updated_at,logo_uri`, in.ProviderKey, in.LogoURI).Scan(&p.Key, &p.DisplayNameAr, &p.Active, &p.Version, &p.CreatedAt, &p.UpdatedAt, &p.LogoURI)
	if err != nil {
		return WalletProviderResult{}, err
	}
	h := walletLogoHash(in)
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.wallet_provider_logo_uploads(idempotency_key,provider_key,expected_version,request_hash,object_key,logo_uri,content_sha256,content_type,acting_actor_id,correlation_id,creator,source_description,source_uri,rights_statement,rights_uri) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, in.IdempotencyKey, in.ProviderKey, in.ExpectedVersion, h, in.ObjectKey, in.LogoURI, in.ContentSHA256, in.ContentType, in.ActingActorID, in.CorrelationID, in.Provenance.Creator, in.Provenance.SourceDescription, in.Provenance.SourceURI, in.Provenance.RightsStatement, in.Provenance.RightsURI)
	if err != nil {
		return WalletProviderResult{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.wallet_provider_audit(event_type,idempotency_key,correlation_id,acting_actor_id,provider_key,from_version,result_version,from_active,to_active,request_hash,display_name_ar) VALUES('wallet_provider_logo_updated',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, in.IdempotencyKey, in.CorrelationID, in.ActingActorID, in.ProviderKey, previousVersion, p.Version, p.Active, p.Active, h, p.DisplayNameAr)
	if err != nil {
		return WalletProviderResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return WalletProviderResult{}, err
	}
	return WalletProviderResult{Provider: p}, nil
}
