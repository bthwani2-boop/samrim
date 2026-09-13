package passkey

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/challenge"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
	"github.com/go-webauthn/webauthn/protocol"
	webauthn "github.com/go-webauthn/webauthn/webauthn"
)

const (
	ceremonyRegistration   = "operator_registration"
	ceremonyRecovery       = "operator_recovery_registration"
	ceremonyAuthentication = "operator_authentication"
	ceremonyLifetime       = 5 * time.Minute
)

type Config struct {
	RPID    string
	Origins []string
	RPName  string
}

type Service struct {
	db         *sql.DB
	sessions   *session.Service
	challenges *challenge.Service
	webauthn   *webauthn.WebAuthn
	now        func() time.Time
}

type operatorUser struct {
	id          string
	phone       string
	security    bool
	enabled     bool
	activated   bool
	credentials []webauthn.Credential
}

func New(db *sql.DB, sessions *session.Service, challenges *challenge.Service, config Config) (*Service, error) {
	if strings.TrimSpace(config.RPID) == "" || len(config.Origins) == 0 {
		return nil, errors.New("operator WebAuthn RP configuration is incomplete")
	}
	rp, err := webauthn.New(&webauthn.Config{
		RPID:                  config.RPID,
		RPDisplayName:         config.RPName,
		RPOrigins:             append([]string(nil), config.Origins...),
		RPTopOrigins:          append([]string(nil), config.Origins...),
		RPAllowCrossOrigin:    false,
		AttestationPreference: protocol.PreferNoAttestation,
	})
	if err != nil {
		return nil, fmt.Errorf("configure operator WebAuthn: %w", err)
	}
	return &Service{db: db, sessions: sessions, challenges: challenges, webauthn: rp, now: time.Now}, nil
}

func (s *Service) BeginAuthentication(ctx context.Context) (domain.PasskeyOptions, error) {
	assertion, data, err := s.webauthn.BeginDiscoverableLogin(
		webauthn.WithUserVerification(protocol.VerificationRequired),
	)
	if err != nil {
		return domain.PasskeyOptions{}, fmt.Errorf("begin operator passkey authentication: %w", err)
	}
	return s.storeCeremony(ctx, ceremonyAuthentication, "", *data, assertion.Response)
}

func (s *Service) BeginRegistration(ctx context.Context, input domain.OperatorPasskeyRegistrationOptionsRequest) (domain.PasskeyOptions, error) {
	actorID, err := s.challenges.ConsumeOperatorEnrollmentPhoneProof(ctx, input)
	if err != nil {
		return domain.PasskeyOptions{}, err
	}
	user, err := s.loadOperator(ctx, actorID)
	if err != nil {
		return domain.PasskeyOptions{}, err
	}
	creation, data, err := s.webauthn.BeginRegistration(
		user,
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			RequireResidentKey: protocol.ResidentKeyRequired(),
			ResidentKey:        protocol.ResidentKeyRequirementRequired,
			UserVerification:   protocol.VerificationRequired,
		}),
	)
	if err != nil {
		return domain.PasskeyOptions{}, fmt.Errorf("begin operator passkey registration: %w", err)
	}
	return s.storeCeremony(ctx, ceremonyRegistration, actorID, *data, creation.Response)
}

func (s *Service) BeginRecoveryRegistration(ctx context.Context, input domain.OperatorPasskeyRecoveryRegistrationOptionsRequest) (domain.PasskeyOptions, error) {
	actorID, err := s.challenges.ConsumeOperatorRecoveryPhoneProof(ctx, input)
	if err != nil {
		return domain.PasskeyOptions{}, err
	}
	user, err := s.loadOperator(ctx, actorID)
	if err != nil {
		return domain.PasskeyOptions{}, err
	}
	creation, data, err := s.webauthn.BeginRegistration(
		user,
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			RequireResidentKey: protocol.ResidentKeyRequired(),
			ResidentKey:        protocol.ResidentKeyRequirementRequired,
			UserVerification:   protocol.VerificationRequired,
		}),
	)
	if err != nil {
		return domain.PasskeyOptions{}, fmt.Errorf("begin operator recovery passkey registration: %w", err)
	}
	return s.storeCeremony(ctx, ceremonyRecovery, actorID, *data, creation.Response)
}

func (s *Service) FinishRegistration(ctx context.Context, input domain.OperatorPasskeyRegistrationFinishRequest) (domain.OperatorPasskeyRegistrationResponse, error) {
	return s.finishRegistration(ctx, input.CeremonyID, input.Credential, input.ClientInstanceId, ceremonyRegistration)
}

func (s *Service) FinishRecoveryRegistration(ctx context.Context, input domain.OperatorPasskeyRecoveryFinishRequest) (domain.OperatorPasskeyRegistrationResponse, error) {
	return s.finishRegistration(ctx, input.CeremonyID, input.Credential, input.ClientInstanceId, ceremonyRecovery)
}

func (s *Service) finishRegistration(ctx context.Context, ceremonyID string, rawCredential json.RawMessage, clientInstanceID, ceremonyKind string) (domain.OperatorPasskeyRegistrationResponse, error) {
	ceremony, err := s.loadCeremony(ctx, ceremonyID, ceremonyKind)
	if err != nil {
		return domain.OperatorPasskeyRegistrationResponse{}, err
	}
	if ceremony.actorID == "" {
		return domain.OperatorPasskeyRegistrationResponse{}, domain.ErrInvalidChallenge
	}
	user, err := s.loadOperator(ctx, ceremony.actorID)
	if err != nil {
		return domain.OperatorPasskeyRegistrationResponse{}, err
	}
	request, err := webauthnRequest(rawCredential)
	if err != nil {
		return domain.OperatorPasskeyRegistrationResponse{}, domain.ErrInvalidChallenge
	}
	credential, err := s.webauthn.FinishRegistration(user, ceremony.session, request)
	if err != nil {
		return domain.OperatorPasskeyRegistrationResponse{}, domain.ErrInvalidChallenge
	}
	if !credential.Flags.UserVerified {
		return domain.OperatorPasskeyRegistrationResponse{}, domain.ErrInvalidChallenge
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.OperatorPasskeyRegistrationResponse{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockUnconsumedCeremony(ctx, tx, ceremonyID, ceremonyKind); err != nil {
		return domain.OperatorPasskeyRegistrationResponse{}, err
	}
	if err := storeCredentialTx(ctx, tx, ceremony.actorID, s.webauthn.Config.GetRPID(), credential); err != nil {
		return domain.OperatorPasskeyRegistrationResponse{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_actor_roles SET activated_at=COALESCE(activated_at,clock_timestamp()),version=version+1,updated_at=clock_timestamp() WHERE actor_id=$1 AND role='operator' AND enabled=true", ceremony.actorID); err != nil {
		return domain.OperatorPasskeyRegistrationResponse{}, err
	}
	recoveryCredential, err := storeRecoveryCredentialTx(ctx, tx, ceremony.actorID)
	if err != nil {
		return domain.OperatorPasskeyRegistrationResponse{}, err
	}
	if err := markCeremonyConsumedTx(ctx, tx, ceremonyID); err != nil {
		return domain.OperatorPasskeyRegistrationResponse{}, err
	}
	if err := auditTx(ctx, tx, "operator.passkey_registered", ceremony.actorID, ceremony.actorID, "success", map[string]any{"userVerification": true, "ceremonyKind": ceremonyKind}); err != nil {
		return domain.OperatorPasskeyRegistrationResponse{}, err
	}
	pair, err := s.sessions.CreateTx(ctx, tx, ceremony.actorID, "operator", clientInstanceID)
	if err != nil {
		return domain.OperatorPasskeyRegistrationResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.OperatorPasskeyRegistrationResponse{}, err
	}
	return domain.OperatorPasskeyRegistrationResponse{TokenPair: pair, RecoveryCredential: recoveryCredential}, nil
}

func (s *Service) FinishAuthentication(ctx context.Context, input domain.OperatorPasskeyAuthenticationFinishRequest) (domain.TokenPair, error) {
	ceremony, err := s.loadCeremony(ctx, input.CeremonyID, ceremonyAuthentication)
	if err != nil {
		return domain.TokenPair{}, err
	}
	request, err := webauthnRequest(input.Credential)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidChallenge
	}
	user, credential, err := s.webauthn.FinishPasskeyLogin(s.discoverUser, ceremony.session, request)
	if err != nil {
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}
	operator, ok := user.(*operatorUser)
	if !ok || !operator.enabled || !operator.security || !operator.activated || operator.id == "" {
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.TokenPair{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockUnconsumedCeremony(ctx, tx, input.CeremonyID, ceremonyAuthentication); err != nil {
		return domain.TokenPair{}, err
	}
	if err := updateCredentialTx(ctx, tx, operator.id, s.webauthn.Config.GetRPID(), credential); err != nil {
		return domain.TokenPair{}, err
	}
	if err := markCeremonyConsumedTx(ctx, tx, input.CeremonyID); err != nil {
		return domain.TokenPair{}, err
	}
	if err := auditTx(ctx, tx, "operator.passkey_authenticated", operator.id, operator.id, "success", map[string]any{"userVerification": true}); err != nil {
		return domain.TokenPair{}, err
	}
	pair, err := s.sessions.CreateTx(ctx, tx, operator.id, "operator", input.ClientInstanceId)
	if err != nil {
		return domain.TokenPair{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.TokenPair{}, err
	}
	return pair, nil
}

type storedCeremony struct {
	id      string
	actorID string
	kind    string
	session webauthn.SessionData
}

func (s *Service) storeCeremony(ctx context.Context, kind, actorID string, data webauthn.SessionData, options any) (domain.PasskeyOptions, error) {
	id, err := identitysecurity.RandomToken(18)
	if err != nil {
		return domain.PasskeyOptions{}, err
	}
	dataJSON, err := json.Marshal(data)
	if err != nil {
		return domain.PasskeyOptions{}, err
	}
	optionsJSON, err := json.Marshal(options)
	if err != nil {
		return domain.PasskeyOptions{}, err
	}
	expires := s.now().UTC().Add(ceremonyLifetime)
	if _, err := s.db.ExecContext(ctx, `INSERT INTO identity_webauthn_ceremonies(id,kind,actor_id,challenge,session_data,expires_at) VALUES($1,$2,NULLIF($3,''),$4,$5,$6)`, id, kind, actorID, data.Challenge, dataJSON, expires); err != nil {
		return domain.PasskeyOptions{}, err
	}
	return domain.PasskeyOptions{CeremonyID: id, PublicKey: optionsJSON}, nil
}

func (s *Service) loadCeremony(ctx context.Context, id, kind string) (storedCeremony, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return storedCeremony{}, domain.ErrInvalidChallenge
	}
	var actorIDValue sql.NullString
	var dataJSON []byte
	var expires time.Time
	var consumedAt sql.NullTime
	var challengeValue string
	err := s.db.QueryRowContext(ctx, `SELECT actor_id,session_data,challenge,expires_at,consumed_at FROM identity_webauthn_ceremonies WHERE id=$1 AND kind=$2`, id, kind).Scan(&actorIDValue, &dataJSON, &challengeValue, &expires, &consumedAt)
	if err != nil || consumedAt.Valid || !expires.After(s.now().UTC()) {
		return storedCeremony{}, domain.ErrInvalidChallenge
	}
	var data webauthn.SessionData
	if err := json.Unmarshal(dataJSON, &data); err != nil || data.Challenge != challengeValue || data.RelyingPartyID != s.webauthn.Config.GetRPID() {
		return storedCeremony{}, domain.ErrInvalidChallenge
	}
	actorID := ""
	if actorIDValue.Valid {
		actorID = actorIDValue.String
	}
	return storedCeremony{id: id, actorID: actorID, kind: kind, session: data}, nil
}

func (s *Service) discoverUser(rawID, userHandle []byte) (webauthn.User, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var actorID string
	if len(rawID) > 0 {
		_ = s.db.QueryRowContext(ctx, "SELECT actor_id FROM identity_webauthn_credentials WHERE credential_id=$1 AND rp_id=$2 AND revoked_at IS NULL", rawID, s.webauthn.Config.GetRPID()).Scan(&actorID)
	}
	if actorID == "" && len(userHandle) > 0 {
		_ = s.db.QueryRowContext(ctx, "SELECT actor_id FROM identity_webauthn_users WHERE rp_id=$1 AND user_handle=$2", s.webauthn.Config.GetRPID(), userHandle).Scan(&actorID)
	}
	if actorID == "" {
		return nil, domain.ErrUnauthenticated
	}
	return s.loadOperator(ctx, actorID)
}

func (s *Service) loadOperator(ctx context.Context, actorID string) (*operatorUser, error) {
	var user operatorUser
	var activated sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT a.id,a.phone_e164,a.security_enabled,r.enabled,r.activated_at
FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id AND r.role='operator' WHERE a.id=$1`, actorID).Scan(&user.id, &user.phone, &user.security, &user.enabled, &activated)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, domain.ErrUnauthenticated
	}
	if err != nil {
		return nil, err
	}
	user.activated = activated.Valid
	rows, err := s.db.QueryContext(ctx, `SELECT credential_json FROM identity_webauthn_credentials WHERE actor_id=$1 AND rp_id=$2 AND revoked_at IS NULL ORDER BY created_at`, actorID, s.webauthn.Config.GetRPID())
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var credential webauthn.Credential
		if err := json.Unmarshal(raw, &credential); err != nil {
			return nil, err
		}
		user.credentials = append(user.credentials, credential)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &user, nil
}

func (u *operatorUser) WebAuthnID() []byte {
	digest := sha256.Sum256([]byte("bthwani:operator:webauthn:" + u.id))
	return digest[:]
}
func (u *operatorUser) WebAuthnName() string                       { return u.phone }
func (u *operatorUser) WebAuthnDisplayName() string                { return "مشغل بثواني" }
func (u *operatorUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

func webauthnRequest(raw json.RawMessage) (*http.Request, error) {
	if len(bytes.TrimSpace(raw)) == 0 || !json.Valid(raw) {
		return nil, domain.ErrInvalidChallenge
	}
	request, err := http.NewRequest(http.MethodPost, "http://localhost/auth/operator", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	return request, nil
}

func lockUnconsumedCeremony(ctx context.Context, tx *sql.Tx, id, kind string) error {
	var consumedAt sql.NullTime
	err := tx.QueryRowContext(ctx, "SELECT consumed_at FROM identity_webauthn_ceremonies WHERE id=$1 AND kind=$2 FOR UPDATE", id, kind).Scan(&consumedAt)
	if errors.Is(err, sql.ErrNoRows) || consumedAt.Valid {
		return domain.ErrInvalidChallenge
	}
	return err
}

func markCeremonyConsumedTx(ctx context.Context, tx *sql.Tx, id string) error {
	result, err := tx.ExecContext(ctx, "UPDATE identity_webauthn_ceremonies SET consumed_at=clock_timestamp() WHERE id=$1 AND consumed_at IS NULL", id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil || count != 1 {
		return domain.ErrInvalidChallenge
	}
	return nil
}

func storeCredentialTx(ctx context.Context, tx *sql.Tx, actorID, rpID string, credential *webauthn.Credential) error {
	raw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	handle := sha256.Sum256([]byte("bthwani:operator:webauthn:" + actorID))
	if _, err := tx.ExecContext(ctx, `INSERT INTO identity_webauthn_users(rp_id,actor_id,user_handle) VALUES($1,$2,$3) ON CONFLICT (rp_id,actor_id) DO UPDATE SET user_handle=EXCLUDED.user_handle`, rpID, actorID, handle[:]); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO identity_webauthn_credentials(actor_id,rp_id,credential_id,credential_json,sign_count,clone_warning,backup_state) VALUES($1,$2,$3,$4,$5,$6,$7)`, actorID, rpID, credential.ID, raw, credential.Authenticator.SignCount, credential.Authenticator.CloneWarning, credential.Flags.BackupState)
	return err
}

func storeRecoveryCredentialTx(ctx context.Context, tx *sql.Tx, actorID string) (string, error) {
	raw, err := identitysecurity.RandomRecoveryCredential()
	if err != nil {
		return "", err
	}
	id, err := identitysecurity.RandomToken(18)
	if err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_recovery_credentials SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE actor_id=$1 AND revoked_at IS NULL", actorID); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO identity_operator_recovery_credentials(id,actor_id,credential_hash) VALUES($1,$2,$3)", id, actorID, identitysecurity.SHA256Hex(raw)); err != nil {
		return "", err
	}
	return raw, nil
}

func updateCredentialTx(ctx context.Context, tx *sql.Tx, actorID, rpID string, credential *webauthn.Credential) error {
	raw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `UPDATE identity_webauthn_credentials SET credential_json=$1,sign_count=$2,clone_warning=$3,backup_state=$4,last_used_at=clock_timestamp() WHERE actor_id=$5 AND rp_id=$6 AND credential_id=$7 AND revoked_at IS NULL`, raw, credential.Authenticator.SignCount, credential.Authenticator.CloneWarning, credential.Flags.BackupState, actorID, rpID, credential.ID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil || count != 1 {
		return domain.ErrUnauthenticated
	}
	return nil
}

func auditTx(ctx context.Context, tx *sql.Tx, eventType, actorID, principal, outcome string, metadata map[string]any) error {
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO identity_security_audit(event_type,subject_actor_id,principal,outcome,metadata) VALUES($1,$2,$3,$4,$5::jsonb)", eventType, actorID, principal, outcome, string(raw))
	return err
}
