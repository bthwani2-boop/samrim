package session

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

// OperatorRecoveryOptions is a one-use WebAuthn creation challenge. It never
// authenticates an Operator or conveys role/permission authority.
type OperatorRecoveryOptions = OperatorInitialRegistrationOptions

// recoveryAvailable only permits the existing isolated Identity WebAuthn owner.
// In particular, it cannot silently activate protected account recovery.
func (s *OperatorPasskeyAuth) recoveryAvailable() bool {
	return s != nil && s.owner != nil && s.rp != nil &&
		s.initialRootOrigin != "" && IsIsolatedTestSchema(s.owner.schema)
}

// Migration 006 permits 16–64 bytes. Recovered authenticators must retain
// existing valid handles, not silently reject a non-32-byte Operator handle.
func validRecoveryUserHandle(handle []byte) bool {
	return len(handle) >= 16 && len(handle) <= 64
}

// Lock the canonical actor before its recovery proof. This lock ordering
// prevents two independently issued proofs for the same actor from deadlocking
// when successful recovery invalidates all other outstanding proofs.
func lockApprovedRecoveryActor(ctx context.Context, tx *sql.Tx, digest [32]byte) (string, error) {
	var actor string
	// The first lookup is NOT authoritative. The actor and proof are rechecked
	// after acquiring locks, so concurrent revocation/consumption fails closed.
	err := tx.QueryRowContext(ctx, `SELECT actor_id FROM operator_passkey_recovery_proofs
WHERE proof_digest=$1`, digest[:]).Scan(&actor)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrUnauthorized
	}
	if err != nil {
		return "", err
	}
	var lockedActor string
	err = tx.QueryRowContext(ctx, `SELECT a.id FROM actors a JOIN actor_roles ar
ON ar.actor_id=a.id AND ar.role='operator'
WHERE a.id=$1 AND a.status='ACTIVE' AND ar.status='ACTIVE'
FOR UPDATE OF a,ar`, actor).Scan(&lockedActor)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrUnauthorized
	}
	if err != nil {
		return "", err
	}
	var proofActor string
	err = tx.QueryRowContext(ctx, `SELECT actor_id FROM operator_passkey_recovery_proofs
WHERE proof_digest=$1 AND actor_id=$2 AND consumed_at IS NULL
AND revoked_at IS NULL AND created_at<=clock_timestamp()
AND expires_at>clock_timestamp()
AND expires_at<=created_at+interval '10 minutes' FOR UPDATE`, digest[:], actor).Scan(&proofActor)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrUnauthorized
	}
	if err != nil {
		return "", err
	}
	if proofActor != lockedActor {
		return "", ErrUnauthorized
	}
	return lockedActor, nil
}

// The proof must already have been approved by an independent, offline
// identity-continuity procedure. This HTTP path cannot create one or select
// an actor. No original/root marker or permissions are ever changed here.
func (s *OperatorPasskeyAuth) BeginRecovery(ctx context.Context, proof string) (OperatorRecoveryOptions, error) {
	if !s.recoveryAvailable() {
		return OperatorRecoveryOptions{}, ErrUnauthorized
	}
	raw, ok := decodeInitialProof(proof)
	if !ok {
		return OperatorRecoveryOptions{}, ErrUnauthorized
	}
	digest := sha256.Sum256(raw[:])
	tx, err := s.owner.begin(ctx, false)
	if err != nil {
		return OperatorRecoveryOptions{}, err
	}
	defer tx.Rollback()
	actor, err := lockApprovedRecoveryActor(ctx, tx, digest)
	if err != nil {
		return OperatorRecoveryOptions{}, err
	}
	var priorHandle []byte
	err = tx.QueryRowContext(ctx, `SELECT user_handle FROM operator_passkey_users
WHERE actor_id=$1 AND rp_id=$2 FOR UPDATE`, actor, s.rpID).Scan(&priorHandle)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return OperatorRecoveryOptions{}, err
	}
	if len(priorHandle) == 0 {
		priorHandle, err = operatorPasskeyRandom32()
		if err != nil {
			return OperatorRecoveryOptions{}, err
		}
	}
	user := &initialOperatorUser{id: actor, handle: priorHandle}
	options, data, err := s.rp.BeginRegistration(user,
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			UserVerification:   protocol.VerificationRequired,
			RequireResidentKey: protocol.ResidentKeyRequired(),
			ResidentKey:        "required",
		}))
	if err != nil {
		return OperatorRecoveryOptions{}, err
	}
	if data.UserVerification != protocol.VerificationRequired ||
		options.Response.AuthenticatorSelection.UserVerification != protocol.VerificationRequired ||
		!bytes.Equal(data.UserID, priorHandle) || data.GetRelyingPartyID(s.rpID) != s.rpID {
		return OperatorRecoveryOptions{}, ErrUnauthorized
	}
	challenge, err := base64.RawURLEncoding.Strict().DecodeString(data.Challenge)
	if err != nil || len(challenge) < 32 {
		return OperatorRecoveryOptions{}, ErrUnauthorized
	}
	ceremony, err := operatorPasskeyRandom32()
	if err != nil {
		return OperatorRecoveryOptions{}, err
	}
	sessionJSON, err := json.Marshal(data)
	if err != nil {
		return OperatorRecoveryOptions{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO operator_passkey_ceremonies
(ceremony_id,challenge,kind,rp_id,actor_id,session_data,expires_at)
VALUES($1,$2,'RECOVER',$3,$4,$5,clock_timestamp()+interval '4 minutes')`,
		ceremony, challenge, s.rpID, actor, string(sessionJSON))
	if err != nil {
		return OperatorRecoveryOptions{}, err
	}
	if err = operatorPasskeyAudit(ctx, tx, actor, nil, "RECOVERY_BEGUN"); err != nil {
		return OperatorRecoveryOptions{}, err
	}
	if err = tx.Commit(); err != nil {
		return OperatorRecoveryOptions{}, err
	}
	return OperatorRecoveryOptions{
		CeremonyID: base64.RawURLEncoding.EncodeToString(ceremony), Options: options,
	}, nil
}

// FinishRecovery preserves the existing Identity actor and every permission.
// Recovery replaces old authenticators and revokes only Operator sessions in
// one transaction. A real, user-verified WebAuthn attestation is mandatory;
// successful recovery NEVER issues an authentication session.
func (s *OperatorPasskeyAuth) FinishRecovery(ctx context.Context, proof, ceremonyID string, credentialJSON []byte) error {
	if !s.recoveryAvailable() {
		return ErrUnauthorized
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
	actor, err := lockApprovedRecoveryActor(ctx, tx, digest)
	if err != nil {
		return err
	}
	var storedSession, storedChallenge []byte
	err = tx.QueryRowContext(ctx, `SELECT session_data,challenge
FROM operator_passkey_ceremonies
WHERE ceremony_id=$1 AND actor_id=$2 AND rp_id=$3 AND kind='RECOVER'
AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,
		ceremony[:], actor, s.rpID).Scan(&storedSession, &storedChallenge)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUnauthorized
	}
	if err != nil {
		return err
	}
	var data webauthn.SessionData
	if err = json.Unmarshal(storedSession, &data); err != nil {
		return ErrUnauthorized
	}
	challenge, err := base64.RawURLEncoding.Strict().DecodeString(data.Challenge)
	if err != nil || !bytes.Equal(challenge, storedChallenge) ||
		data.UserVerification != protocol.VerificationRequired ||
		data.GetRelyingPartyID(s.rpID) != s.rpID ||
		!validRecoveryUserHandle(data.UserID) {
		return ErrUnauthorized
	}
	var storedHandle []byte
	err = tx.QueryRowContext(ctx, `SELECT user_handle FROM operator_passkey_users
WHERE rp_id=$1 AND actor_id=$2 FOR UPDATE`, s.rpID, actor).Scan(&storedHandle)
	missingUser := errors.Is(err, sql.ErrNoRows)
	if err != nil && !missingUser {
		return err
	}
	if !missingUser && !bytes.Equal(storedHandle, data.UserID) {
		return ErrUnauthorized
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(credentialJSON)
	if err != nil {
		return ErrUnauthorized
	}
	user := &initialOperatorUser{id: actor, handle: data.UserID}
	credential, err := s.rp.CreateCredential(user, data, parsed)
	if err != nil || credential == nil || !credential.Flags.UserPresent ||
		!credential.Flags.UserVerified || len(credential.ID) < 16 || len(credential.ID) > 1024 {
		return ErrUnauthorized
	}
	encoded, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	if missingUser {
		_, err = tx.ExecContext(ctx, `INSERT INTO operator_passkey_users
(rp_id,actor_id,user_handle) VALUES($1,$2,$3)`, s.rpID, actor, data.UserID)
		if err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE operator_passkey_credentials
SET revoked_at=clock_timestamp()
WHERE rp_id=$1 AND actor_id=$2 AND revoked_at IS NULL`, s.rpID, actor)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO operator_passkey_credentials
(rp_id,credential_id,actor_id,credential_json,sign_count,backup_eligible,backup_state)
VALUES($1,$2,$3,$4,$5,$6,$7)`, s.rpID, credential.ID, actor,
		string(encoded), credential.Authenticator.SignCount,
		credential.Flags.BackupEligible, credential.Flags.BackupState)
	if err != nil {
		return err
	}
	// Invalidate all previously minted Operator tokens; do not modify other roles.
	_, err = tx.ExecContext(ctx, `UPDATE actor_roles SET version=version+1,updated_at=clock_timestamp()
WHERE actor_id=$1 AND role='operator' AND status='ACTIVE'`, actor)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at=clock_timestamp()
WHERE actor_id=$1 AND role='operator' AND revoked_at IS NULL
AND issued_at<=clock_timestamp()`, actor)
	if err != nil {
		return err
	}
	changed, err := tx.ExecContext(ctx, `UPDATE operator_passkey_recovery_proofs
SET consumed_at=clock_timestamp() WHERE proof_digest=$1 AND actor_id=$2
AND consumed_at IS NULL AND revoked_at IS NULL`, digest[:], actor)
	if err != nil {
		return err
	}
	rows, err := changed.RowsAffected()
	if err != nil || rows != 1 {
		return ErrUnauthorized
	}
	// Other outstanding proofs and ceremonies for this actor cannot replace the newly registered key.
	_, err = tx.ExecContext(ctx, `UPDATE operator_passkey_recovery_proofs
SET revoked_at=clock_timestamp() WHERE actor_id=$1 AND consumed_at IS NULL
AND revoked_at IS NULL`, actor)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE operator_passkey_ceremonies
SET consumed_at=clock_timestamp() WHERE actor_id=$1 AND kind='RECOVER'
AND consumed_at IS NULL`, actor)
	if err != nil {
		return err
	}
	credentialDigest := sha256.Sum256(credential.ID)
	if err = operatorPasskeyAudit(ctx, tx, actor, credentialDigest[:], "RECOVERED"); err != nil {
		return err
	}
	return tx.Commit()
}
