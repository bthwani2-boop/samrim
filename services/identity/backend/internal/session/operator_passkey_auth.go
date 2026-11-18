package session

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

// OperatorPasskeyAuth uses the signed WebAuthn library and canonical Identity
// sessions. This service never bootstraps or self-enrolls the original Owner.
type OperatorPasskeyAuth struct {
	owner *PostgresReader
	rp    *webauthn.WebAuthn
	rpID  string
}

type OperatorPasskeyAssertionOptions struct {
	CeremonyID string                        `json:"ceremonyId"`
	Options    *protocol.CredentialAssertion `json:"options"`
}

func NewOperatorPasskeyAuth(owner *PostgresReader, policy OperatorPasskeyOriginPolicy, isolated bool) (*OperatorPasskeyAuth, error) {
	if owner == nil || owner.db == nil || !IsIsolatedTestSchema(owner.schema) {
		return nil, errors.New("isolated Identity owner unavailable")
	}
	if err := validateOperatorPasskeyOriginPolicy(policy, isolated); err != nil {
		return nil, err
	}
	rp, err := webauthn.New(&webauthn.Config{
		RPID: policy.RPID, RPDisplayName: "BThwani Operator",
		RPOrigins:              append([]string(nil), policy.Origins...),
		RPAllowCrossOrigin:     false,
		AuthenticatorSelection: protocol.AuthenticatorSelection{UserVerification: protocol.VerificationRequired},
		AttestationPreference:  protocol.PreferNoAttestation,
	})
	if err != nil {
		return nil, fmt.Errorf("invalid WebAuthn RP configuration: %w", err)
	}
	return &OperatorPasskeyAuth{owner: owner, rp: rp, rpID: policy.RPID}, nil
}

func operatorPasskeyRandom32() ([]byte, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, nil
}

func (s *OperatorPasskeyAuth) Begin(ctx context.Context) (OperatorPasskeyAssertionOptions, error) {
	if s == nil || s.owner == nil || s.rp == nil {
		return OperatorPasskeyAssertionOptions{}, errors.New("WebAuthn Identity owner not configured")
	}
	options, data, err := s.rp.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		return OperatorPasskeyAssertionOptions{}, err
	}
	if options.Response.UserVerification != protocol.VerificationRequired ||
		data.UserVerification != protocol.VerificationRequired || data.AuthorizeUVInitialization {
		return OperatorPasskeyAssertionOptions{}, ErrUnauthorized
	}
	challenge, err := base64.RawURLEncoding.Strict().DecodeString(data.Challenge)
	if err != nil || len(challenge) < 32 {
		return OperatorPasskeyAssertionOptions{}, ErrUnauthorized
	}
	id, err := operatorPasskeyRandom32()
	if err != nil {
		return OperatorPasskeyAssertionOptions{}, err
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return OperatorPasskeyAssertionOptions{}, err
	}
	tx, err := s.owner.begin(ctx, false)
	if err != nil {
		return OperatorPasskeyAssertionOptions{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO operator_passkey_ceremonies
      (ceremony_id,challenge,kind,rp_id,session_data,expires_at)
      VALUES ($1,$2,'AUTHENTICATE',$3,$4,clock_timestamp()+interval '4 minutes')`,
		id, challenge, s.rpID, string(encoded))
	if err != nil {
		return OperatorPasskeyAssertionOptions{}, err
	}
	if err = tx.Commit(); err != nil {
		return OperatorPasskeyAssertionOptions{}, err
	}
	return OperatorPasskeyAssertionOptions{CeremonyID: base64.RawURLEncoding.EncodeToString(id), Options: options}, nil
}

type operatorPasskeyUser struct {
	actorID    string
	handle     []byte
	credential webauthn.Credential
}

func (u *operatorPasskeyUser) WebAuthnID() []byte          { return append([]byte(nil), u.handle...) }
func (u *operatorPasskeyUser) WebAuthnName() string        { return "Operator" }
func (u *operatorPasskeyUser) WebAuthnDisplayName() string { return "Operator" }
func (u *operatorPasskeyUser) WebAuthnCredentials() []webauthn.Credential {
	return []webauthn.Credential{u.credential}
}

func (s *OperatorPasskeyAuth) Finish(ctx context.Context, ceremonyID string, assertionJSON []byte) (MerchantAdmission, error) {
	if s == nil || s.owner == nil || s.rp == nil {
		return MerchantAdmission{}, errors.New("WebAuthn Identity owner not configured")
	}
	if len(assertionJSON) == 0 || len(assertionJSON) > 65536 {
		return MerchantAdmission{}, ErrUnauthorized
	}
	id, err := base64.RawURLEncoding.Strict().DecodeString(ceremonyID)
	if err != nil || len(id) != 32 || base64.RawURLEncoding.EncodeToString(id) != ceremonyID {
		return MerchantAdmission{}, ErrUnauthorized
	}
	tx, err := s.owner.begin(ctx, false)
	if err != nil {
		return MerchantAdmission{}, err
	}
	defer tx.Rollback()
	var storedSession, storedChallenge []byte
	err = tx.QueryRowContext(ctx, `SELECT session_data,challenge
        FROM operator_passkey_ceremonies
        WHERE ceremony_id=$1 AND kind='AUTHENTICATE' AND rp_id=$2
          AND consumed_at IS NULL AND expires_at>clock_timestamp()
        FOR UPDATE`, id, s.rpID).Scan(&storedSession, &storedChallenge)
	if errors.Is(err, sql.ErrNoRows) {
		return MerchantAdmission{}, ErrUnauthorized
	}
	if err != nil {
		return MerchantAdmission{}, err
	}
	var sessionData webauthn.SessionData
	if err = json.Unmarshal(storedSession, &sessionData); err != nil {
		return MerchantAdmission{}, err
	}
	challenge, err := base64.RawURLEncoding.Strict().DecodeString(sessionData.Challenge)
	if err != nil || !bytes.Equal(challenge, storedChallenge) ||
		sessionData.UserVerification != protocol.VerificationRequired ||
		sessionData.AuthorizeUVInitialization ||
		sessionData.GetRelyingPartyID(s.rpID) != s.rpID {
		return MerchantAdmission{}, ErrUnauthorized
	}
	parsed, parseErr := protocol.ParseCredentialRequestResponseBytes(assertionJSON)

	var actorVersion, roleVersion int64
	var user *operatorPasskeyUser
	handler := func(rawID, userHandle []byte) (webauthn.User, error) {
		var actor string
		var storedHandle, rawCredential []byte
		var storedCounter int64
		var storedBE, storedBS bool
		err := tx.QueryRowContext(ctx, `SELECT c.actor_id,u.user_handle,c.credential_json,
            c.sign_count,c.backup_eligible,c.backup_state,a.auth_version,ar.version
            FROM operator_passkey_credentials c
            JOIN operator_passkey_users u ON u.rp_id=c.rp_id AND u.actor_id=c.actor_id
            JOIN actors a ON a.id=c.actor_id
            JOIN actor_roles ar ON ar.actor_id=a.id AND ar.role='operator'
            WHERE c.rp_id=$1 AND c.credential_id=$2 AND u.user_handle=$3
              AND c.revoked_at IS NULL AND NOT c.clone_warning
              AND a.status='ACTIVE' AND ar.status='ACTIVE'
            FOR UPDATE OF c,a,ar`, s.rpID, rawID, userHandle).Scan(
			&actor, &storedHandle, &rawCredential, &storedCounter, &storedBE, &storedBS,
			&actorVersion, &roleVersion)
		if err != nil {
			return nil, ErrUnauthorized
		}
		var credential webauthn.Credential
		if err = json.Unmarshal(rawCredential, &credential); err != nil {
			return nil, ErrUnauthorized
		}
		if !bytes.Equal(credential.ID, rawID) || !bytes.Equal(storedHandle, userHandle) ||
			int64(credential.Authenticator.SignCount) != storedCounter ||
			credential.Flags.BackupEligible != storedBE || credential.Flags.BackupState != storedBS ||
			!credential.Flags.UserVerified {
			return nil, ErrUnauthorized
		}
		user = &operatorPasskeyUser{actorID: actor, handle: storedHandle, credential: credential}
		return user, nil
	}
	var verifiedUser webauthn.User
	var verifiedCredential *webauthn.Credential
	var validationErr error
	if parseErr == nil {
		verifiedUser, verifiedCredential, validationErr = s.rp.ValidatePasskeyLogin(handler, sessionData, parsed)
	}
	if parseErr != nil || validationErr != nil || user == nil ||
		verifiedUser != user || verifiedCredential == nil ||
		!bytes.Equal(verifiedCredential.ID, user.credential.ID) {
		return MerchantAdmission{}, s.operatorPasskeyReject(ctx, tx, id)
	}
	// Clone detection is a critical failure, not an acceptable risk score.
	if verifiedCredential.Authenticator.CloneWarning {
		_, err = tx.ExecContext(ctx, `UPDATE operator_passkey_credentials SET
            clone_warning=true,revoked_at=clock_timestamp()
            WHERE rp_id=$1 AND credential_id=$2 AND revoked_at IS NULL`,
			s.rpID, verifiedCredential.ID)
		if err != nil {
			return MerchantAdmission{}, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE actor_roles SET
            version=version+1,updated_at=clock_timestamp()
            WHERE actor_id=$1 AND role='operator'`, user.actorID)
		if err != nil {
			return MerchantAdmission{}, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE auth_sessions SET
            revoked_at=clock_timestamp() WHERE actor_id=$1 AND role='operator'
            AND revoked_at IS NULL AND issued_at<=clock_timestamp()`, user.actorID)
		if err != nil {
			return MerchantAdmission{}, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE operator_passkey_ceremonies
            SET consumed_at=clock_timestamp() WHERE ceremony_id=$1`, id)
		if err != nil {
			return MerchantAdmission{}, err
		}
		digest := sha256.Sum256(verifiedCredential.ID)
		if err = operatorPasskeyAudit(ctx, tx, user.actorID, digest[:], "CREDENTIAL_REVOKED"); err != nil {
			return MerchantAdmission{}, err
		}
		if err = tx.Commit(); err != nil {
			return MerchantAdmission{}, err
		}
		return MerchantAdmission{}, ErrUnauthorized
	}

	updatedCredential, err := json.Marshal(verifiedCredential)
	if err != nil {
		return MerchantAdmission{}, err
	}
	change, err := tx.ExecContext(ctx, `UPDATE operator_passkey_credentials
        SET credential_json=$3,sign_count=$4,backup_state=$5,last_used_at=clock_timestamp()
        WHERE rp_id=$1 AND credential_id=$2 AND revoked_at IS NULL
          AND NOT clone_warning AND sign_count<=$4`,
		s.rpID, verifiedCredential.ID, string(updatedCredential),
		verifiedCredential.Authenticator.SignCount, verifiedCredential.Flags.BackupState)
	if err != nil {
		return MerchantAdmission{}, err
	}
	count, err := change.RowsAffected()
	if err != nil {
		return MerchantAdmission{}, err
	}
	if count != 1 {
		return MerchantAdmission{}, ErrUnauthorized
	}
	_, err = tx.ExecContext(ctx, `UPDATE operator_passkey_ceremonies
        SET consumed_at=clock_timestamp() WHERE ceremony_id=$1 AND consumed_at IS NULL`, id)
	if err != nil {
		return MerchantAdmission{}, err
	}
	digest := sha256.Sum256(verifiedCredential.ID)
	if err = operatorPasskeyAudit(ctx, tx, user.actorID, digest[:], "AUTHENTICATED"); err != nil {
		return MerchantAdmission{}, err
	}
	// Canonical role issuer commits the same transaction as nonce consumption,
	// credential counter persistence and audit; no partial role issuance.
	return issueRoleSessionTx(ctx, tx, user.actorID, "operator", actorVersion, roleVersion)
}

func (s *OperatorPasskeyAuth) operatorPasskeyReject(ctx context.Context, tx *sql.Tx, id []byte) error {
	if _, err := tx.ExecContext(ctx, `UPDATE operator_passkey_ceremonies
        SET consumed_at=clock_timestamp() WHERE ceremony_id=$1 AND consumed_at IS NULL`, id); err != nil {
		return err
	}
	if err := operatorPasskeyAudit(ctx, tx, nil, nil, "AUTH_REJECTED"); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return ErrUnauthorized
}

func operatorPasskeyAudit(ctx context.Context, tx *sql.Tx, actor any, credentialDigest []byte, event string) error {
	id, err := operatorPasskeyRandom32()
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO operator_passkey_audit
        (event_id,actor_id,credential_id_digest,event_kind)
        VALUES($1,$2,$3,$4)`, id, actor, credentialDigest, event)
	return err
}
