package session

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

// ErrInitialOperatorBootstrapUnavailable intentionally does not say whether
// a Root Operator, pending ceremony, or another Operator already exists.
var ErrInitialOperatorBootstrapUnavailable = errors.New("initial Operator bootstrap unavailable")

type OperatorInitialRegistrationOptions struct {
	CeremonyID string                       `json:"ceremonyId"`
	Options    *protocol.CredentialCreation `json:"options"`
}

type initialOperatorUser struct {
	id     string
	handle []byte
}

func (u *initialOperatorUser) WebAuthnID() []byte                         { return append([]byte(nil), u.handle...) }
func (u *initialOperatorUser) WebAuthnName() string                       { return "BThwani Operator" }
func (u *initialOperatorUser) WebAuthnDisplayName() string                { return "BThwani Operator" }
func (u *initialOperatorUser) WebAuthnCredentials() []webauthn.Credential { return nil }

func decodeInitialProof(proof string) ([32]byte, bool) {
	var raw [32]byte
	if len(proof) != 43 {
		return raw, false
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(proof)
	if err != nil || len(decoded) != len(raw) || base64.RawURLEncoding.EncodeToString(decoded) != proof {
		return raw, false
	}
	copy(raw[:], decoded)
	return raw, true
}

func (s *OperatorPasskeyAuth) initialOwnerAvailable() bool {
	return s != nil && s.owner != nil && s.rp != nil &&
		s.rpID == "localhost" && s.initialRootOrigin == "http://localhost:13000" &&
		IsIsolatedTestSchema(s.owner.schema)
}

// lockInitialBootstrap serializes both issuing and consuming the one-time
// claim with any concurrent initial Operator creation. No app/HTTP route
// accepts an actor ID or permission; only a privileged local CLI may issue a
// claim, and the Owner creates all seven grants after WebAuthn verification.
func lockInitialBootstrap(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx,
		"LOCK TABLE operator_initial_bootstrap, operator_bootstrap, actor_roles IN SHARE ROW EXCLUSIVE MODE")
	return err
}

func noExistingInitialOperator(ctx context.Context, tx *sql.Tx) (bool, error) {
	var count int
	err := tx.QueryRowContext(ctx,
		"SELECT (SELECT count(*) FROM actor_roles WHERE role='operator') + (SELECT count(*) FROM operator_bootstrap)").
		Scan(&count)
	return count == 0, err
}

// IssueInitialOperatorTicket is an OFFLINE ONLY administration method. It
// must never be exposed by a public HTTP handler or called from server start.
// The caller must verify the human owner separately and hand the one-time
// secret directly to that owner. It refuses a namespace containing any
// Operator role, including synthetic fixtures from an earlier run.
func (s *OperatorPasskeyAuth) IssueInitialOperatorTicket(ctx context.Context) (string, error) {
	if !s.initialOwnerAvailable() {
		return "", ErrInitialOperatorBootstrapUnavailable
	}
	proof, err := operatorPasskeyRandom32()
	if err != nil {
		return "", err
	}
	handle, err := operatorPasskeyRandom32()
	if err != nil {
		return "", err
	}
	actorNonce, err := operatorPasskeyRandom32()
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(proof)
	actorID := "operator-root-" + base64.RawURLEncoding.EncodeToString(actorNonce)
	tx, err := s.owner.begin(ctx, false)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if err = lockInitialBootstrap(ctx, tx); err != nil {
		return "", err
	}
	empty, err := noExistingInitialOperator(ctx, tx)
	if err != nil {
		return "", err
	}
	if !empty {
		return "", ErrInitialOperatorBootstrapUnavailable
	}
	// An expired uncompleted claim can be replaced only by the offline
	// administrator, after an authoritative no-Operator recheck.
	result, err := tx.ExecContext(ctx, `WITH instant AS (SELECT clock_timestamp() AS at)
INSERT INTO operator_initial_bootstrap
  (singleton,proof_digest,actor_id,user_handle,created_at,expires_at)
SELECT true,$1,$2,$3,at,at+interval '10 minutes' FROM instant
ON CONFLICT (singleton) DO UPDATE
SET proof_digest=excluded.proof_digest,actor_id=excluded.actor_id,
    user_handle=excluded.user_handle,ceremony_id=NULL,session_data=NULL,
    created_at=excluded.created_at,expires_at=excluded.expires_at,
    consumed_at=NULL
WHERE operator_initial_bootstrap.consumed_at IS NULL
  AND operator_initial_bootstrap.expires_at<clock_timestamp()`,
		digest[:], actorID, handle)
	if err != nil {
		return "", err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return "", err
	}
	if rows != 1 {
		return "", ErrInitialOperatorBootstrapUnavailable
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(proof), nil
}

func (s *OperatorPasskeyAuth) BeginInitialOperatorRegistration(ctx context.Context, proof string) (OperatorInitialRegistrationOptions, error) {
	if !s.initialOwnerAvailable() {
		return OperatorInitialRegistrationOptions{}, ErrInitialOperatorBootstrapUnavailable
	}
	raw, ok := decodeInitialProof(proof)
	if !ok {
		return OperatorInitialRegistrationOptions{}, ErrUnauthorized
	}
	digest := sha256.Sum256(raw[:])
	tx, err := s.owner.begin(ctx, false)
	if err != nil {
		return OperatorInitialRegistrationOptions{}, err
	}
	defer tx.Rollback()
	if err = lockInitialBootstrap(ctx, tx); err != nil {
		return OperatorInitialRegistrationOptions{}, err
	}
	empty, err := noExistingInitialOperator(ctx, tx)
	if err != nil {
		return OperatorInitialRegistrationOptions{}, err
	}
	if !empty {
		return OperatorInitialRegistrationOptions{}, ErrUnauthorized
	}
	var actorID string
	var handle []byte
	err = tx.QueryRowContext(ctx, `SELECT actor_id,user_handle FROM operator_initial_bootstrap
WHERE singleton=true AND proof_digest=$1 AND consumed_at IS NULL
AND expires_at>clock_timestamp() FOR UPDATE`, digest[:]).Scan(&actorID, &handle)
	if errors.Is(err, sql.ErrNoRows) {
		return OperatorInitialRegistrationOptions{}, ErrUnauthorized
	}
	if err != nil {
		return OperatorInitialRegistrationOptions{}, err
	}
	user := &initialOperatorUser{id: actorID, handle: handle}
	options, data, err := s.rp.BeginRegistration(user,
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			UserVerification:   protocol.VerificationRequired,
			RequireResidentKey: protocol.ResidentKeyRequired(),
			ResidentKey:        "required",
		}))
	if err != nil {
		return OperatorInitialRegistrationOptions{}, err
	}
	if data.UserVerification != protocol.VerificationRequired ||
		options.Response.AuthenticatorSelection.UserVerification != protocol.VerificationRequired {
		return OperatorInitialRegistrationOptions{}, ErrUnauthorized
	}
	ceremony, err := operatorPasskeyRandom32()
	if err != nil {
		return OperatorInitialRegistrationOptions{}, err
	}
	serialized, err := json.Marshal(data)
	if err != nil {
		return OperatorInitialRegistrationOptions{}, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE operator_initial_bootstrap
SET ceremony_id=$2,session_data=$3
WHERE singleton=true AND proof_digest=$1 AND consumed_at IS NULL
AND expires_at>clock_timestamp()`, digest[:], ceremony, serialized)
	if err != nil {
		return OperatorInitialRegistrationOptions{}, err
	}
	if err = tx.Commit(); err != nil {
		return OperatorInitialRegistrationOptions{}, err
	}
	return OperatorInitialRegistrationOptions{
		CeremonyID: base64.RawURLEncoding.EncodeToString(ceremony), Options: options,
	}, nil
}

// FinishInitialOperatorRegistration creates the *first* Root only after the
// WebAuthn library verifies authenticator attestation, Origin/RP ID, one-use
// challenge, and user verification. Actor, grants, credential, immutable
// original-owner marker and audit are committed in ONE Owner transaction.
// No token is issued here: subsequent login must prove this new Passkey again.
func (s *OperatorPasskeyAuth) FinishInitialOperatorRegistration(ctx context.Context, proof, ceremonyID string, credentialJSON []byte) error {
	if !s.initialOwnerAvailable() {
		return ErrInitialOperatorBootstrapUnavailable
	}
	raw, ok := decodeInitialProof(proof)
	if !ok {
		return ErrUnauthorized
	}
	ceremony, ok := decodeInitialProof(ceremonyID)
	if !ok || len(credentialJSON) == 0 || len(credentialJSON) > 65536 {
		return ErrUnauthorized
	}
	digest := sha256.Sum256(raw[:])
	tx, err := s.owner.begin(ctx, false)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = lockInitialBootstrap(ctx, tx); err != nil {
		return err
	}
	empty, err := noExistingInitialOperator(ctx, tx)
	if err != nil {
		return err
	}
	if !empty {
		return ErrUnauthorized
	}
	var actorID string
	var userHandle []byte
	var sessionJSON []byte
	err = tx.QueryRowContext(ctx, `SELECT actor_id,user_handle,session_data
FROM operator_initial_bootstrap WHERE singleton=true AND proof_digest=$1
AND ceremony_id=$2 AND session_data IS NOT NULL AND consumed_at IS NULL
AND expires_at>clock_timestamp() FOR UPDATE`, digest[:], ceremony[:]).
		Scan(&actorID, &userHandle, &sessionJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUnauthorized
	}
	if err != nil {
		return err
	}
	var data webauthn.SessionData
	if err = json.Unmarshal(sessionJSON, &data); err != nil {
		return ErrUnauthorized
	}
	if data.UserVerification != protocol.VerificationRequired ||
		data.GetRelyingPartyID(s.rpID) != s.rpID {
		return ErrUnauthorized
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(credentialJSON)
	if err != nil {
		return ErrUnauthorized
	}
	user := &initialOperatorUser{id: actorID, handle: userHandle}
	credential, err := s.rp.CreateCredential(user, data, parsed)
	if err != nil || credential == nil || !credential.Flags.UserPresent ||
		!credential.Flags.UserVerified || len(credential.ID) < 16 || len(credential.ID) > 1024 {
		return ErrUnauthorized
	}
	encoded, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO actors(id,status) VALUES($1,'ACTIVE')`, actorID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO actor_roles(actor_id,role,status) VALUES($1,'operator','ACTIVE')`, actorID); err != nil {
		return err
	}
	for _, permission := range []string{"operations", "merchant", "catalog", "marketing", "finance", "hr", "platform_policies"} {
		if _, err = tx.ExecContext(ctx, `INSERT INTO operator_permissions(actor_id,role,permission,state)
VALUES($1,'operator',$2,'ACTIVE')`, actorID, permission); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO operator_bootstrap(singleton,actor_id,role)
VALUES(true,$1,'operator')`, actorID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO operator_passkey_users(rp_id,actor_id,user_handle)
VALUES($1,$2,$3)`, s.rpID, actorID, userHandle); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO operator_passkey_credentials
(rp_id,credential_id,actor_id,credential_json,sign_count,backup_eligible,backup_state)
VALUES($1,$2,$3,$4,$5,$6,$7)`,
		s.rpID, credential.ID, actorID, string(encoded), credential.Authenticator.SignCount,
		credential.Flags.BackupEligible, credential.Flags.BackupState); err != nil {
		return err
	}
	credentialDigest := sha256.Sum256(credential.ID)
	if err = operatorPasskeyAudit(ctx, tx, actorID, credentialDigest[:], "ENROLLED"); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `UPDATE operator_initial_bootstrap
SET consumed_at=clock_timestamp(),session_data=NULL,ceremony_id=NULL
WHERE singleton=true AND proof_digest=$1 AND consumed_at IS NULL`, digest[:])
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("initial Operator claim changed before commit")
	}
	return tx.Commit()
}
