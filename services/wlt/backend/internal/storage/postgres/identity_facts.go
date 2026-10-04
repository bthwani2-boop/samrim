package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"strings"
)

// IdentityFacts are the canonical DSH-to-WLT snapshot read from Identity just
// before a protected mutation. They are never accepted from a browser client.
type IdentityFacts struct {
	ActorType           string `json:"actorType"`
	ActorID             string `json:"actorId"`
	PhoneE164           string `json:"phoneE164"`
	ActorVersion        int    `json:"actorVersion"`
	RoleVersion         int    `json:"roleVersion"`
	RoleEnabled         bool   `json:"roleEnabled"`
	SecurityEnabled     bool   `json:"securityEnabled"`
	OfficialName        string `json:"officialName"`
	OfficialNameVersion int    `json:"officialNameVersion"`
	OfficialNameStatus  string `json:"officialNameStatus"`
}

func (f IdentityFacts) normalized() IdentityFacts {
	f.ActorType = strings.ToLower(strings.TrimSpace(f.ActorType))
	f.ActorID = strings.TrimSpace(f.ActorID)
	f.PhoneE164 = strings.TrimSpace(f.PhoneE164)
	f.OfficialName = strings.TrimSpace(f.OfficialName)
	f.OfficialNameStatus = strings.ToUpper(strings.TrimSpace(f.OfficialNameStatus))
	return f
}

func (f IdentityFacts) validFor(actorType, actorID string) bool {
	f = f.normalized()
	return f.ActorType == strings.ToLower(strings.TrimSpace(actorType)) &&
		f.ActorID == strings.TrimSpace(actorID) && validDestinationActor(f.ActorType) &&
		officialWalletPhoneE164Pattern.MatchString(f.PhoneE164) &&
		boundedText(f.OfficialName, 1, 320) != "" && f.ActorVersion > 0 && f.RoleVersion > 0 &&
		f.OfficialNameVersion > 0 && f.RoleEnabled && f.SecurityEnabled && f.OfficialNameStatus == "VERIFIED"
}

func (f IdentityFacts) fingerprint() string {
	f = f.normalized()
	sum := sha256.Sum256([]byte(hashFacts("identity-facts-v1", f.ActorType, f.ActorID, f.PhoneE164,
		formatInt(f.ActorVersion), formatInt(f.RoleVersion), formatBool(f.RoleEnabled), formatBool(f.SecurityEnabled),
		f.OfficialName, formatInt(f.OfficialNameVersion), f.OfficialNameStatus)))
	return hex.EncodeToString(sum[:])
}

func (f IdentityFacts) matchesSnapshot(phone, officialName string, officialNameVersion, actorVersion, roleVersion int, roleEnabled, securityEnabled bool, officialNameStatus string) bool {
	f = f.normalized()
	return f.PhoneE164 == strings.TrimSpace(phone) && f.OfficialName == strings.TrimSpace(officialName) &&
		f.OfficialNameVersion == officialNameVersion && f.ActorVersion == actorVersion && f.RoleVersion == roleVersion &&
		f.RoleEnabled == roleEnabled && f.SecurityEnabled == securityEnabled &&
		f.OfficialNameStatus == strings.ToUpper(strings.TrimSpace(officialNameStatus))
}

func (f IdentityFacts) matchesStoredDestination(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, cipher *DestinationCipher, destinationID, actorType, actorID string, requireActive bool) error {
	f = f.normalized()
	if !f.validFor(actorType, actorID) || cipher == nil {
		return ErrReverificationRequired
	}
	var storedType, storedActor, status, verificationStatus, encryptedPhone, name, nameStatus string
	var nameVersion, actorVersion, roleVersion int
	var roleEnabled, securityEnabled bool
	err := source.QueryRowContext(ctx, `SELECT actor_type,actor_id,status,verification_status,wallet_identifier_ciphertext,
		beneficiary_name,beneficiary_identity_version,identity_actor_version,identity_role_version,role_enabled,security_enabled,official_name_status
		FROM wlt.official_wallet_destinations WHERE id=$1 FOR SHARE`, strings.TrimSpace(destinationID)).Scan(
		&storedType, &storedActor, &status, &verificationStatus, &encryptedPhone, &name, &nameVersion,
		&actorVersion, &roleVersion, &roleEnabled, &securityEnabled, &nameStatus)
	if err != nil {
		return err
	}
	phone, err := cipher.decrypt(encryptedPhone)
	if err != nil {
		return err
	}
	if storedType != f.ActorType || storedActor != f.ActorID || phone != f.PhoneE164 || name != f.OfficialName ||
		nameVersion != f.OfficialNameVersion || actorVersion != f.ActorVersion || roleVersion != f.RoleVersion ||
		!roleEnabled || !securityEnabled || !f.RoleEnabled || !f.SecurityEnabled || nameStatus != "VERIFIED" ||
		f.OfficialNameStatus != "VERIFIED" || verificationStatus != "VERIFIED" ||
		(requireActive && status != "ACTIVE_FOR_PAYOUT") {
		return ErrReverificationRequired
	}
	return nil
}

func formatBool(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
