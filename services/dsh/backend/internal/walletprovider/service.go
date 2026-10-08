package walletprovider

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var ErrOperatorNotActive = errors.New("operator actor is not active")
var ErrOperatorPermission = errors.New("platform policies permission is required")

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func New(identity *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identity == nil || db == nil {
		return nil, errors.New("wallet provider service configuration is invalid")
	}
	return &Service{identity: identity, db: db}, nil
}
func (s *Service) List(ctx context.Context, all bool, actor string) ([]postgres.WalletProvider, error) {
	if e := s.requireOperator(ctx, actor); e != nil {
		return nil, e
	}
	return postgres.ListWalletProviders(ctx, s.db, !all)
}
func (s *Service) Create(ctx context.Context, name string, active bool, idem, actor, correlation string) (postgres.WalletProviderResult, error) {
	if e := s.requirePolicyOperator(ctx, actor); e != nil {
		return postgres.WalletProviderResult{}, e
	}
	idem = strings.TrimSpace(idem)
	if idem == "" {
		return postgres.WalletProviderResult{}, postgres.ErrWalletProviderInvalid
	}
	key := providerKeyForIdempotency(idem)
	return postgres.MutateWalletProvider(ctx, s.db, key, name, active, 0, idem, postgres.HashWalletProviderMutation(key, name, active, 0), actor, correlation)
}
func providerKeyForIdempotency(idem string) string {
	keyHash := sha256.Sum256([]byte("dsh:wallet-provider:" + strings.TrimSpace(idem)))
	return "wallet_provider_" + hex.EncodeToString(keyHash[:16])
}
func (s *Service) Mutate(ctx context.Context, key, name string, active bool, version int, idem, actor, correlation string) (postgres.WalletProviderResult, error) {
	if e := s.requirePolicyOperator(ctx, actor); e != nil {
		return postgres.WalletProviderResult{}, e
	}
	return postgres.MutateWalletProvider(ctx, s.db, key, name, active, version, idem, postgres.HashWalletProviderMutation(key, name, active, version), actor, correlation)
}
func (s *Service) requireOperator(ctx context.Context, actor string) error {
	role, e := s.identity.ReadActorRole(ctx, strings.TrimSpace(actor), "operator")
	if e != nil {
		return e
	}
	if role.Role != "operator" || !role.Enabled || !role.SecurityEnabled || role.ActivatedAt == nil {
		return ErrOperatorNotActive
	}
	return nil
}
func (s *Service) requirePolicyOperator(ctx context.Context, actor string) error {
	if e := s.requireOperator(ctx, actor); e != nil {
		return e
	}
	p, e := s.identity.ReadOperatorPermission(ctx, strings.TrimSpace(actor), "platform_policies")
	if e != nil {
		return e
	}
	if !p.Enabled {
		return ErrOperatorPermission
	}
	return nil
}
