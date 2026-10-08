package domain

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type Actor struct {
	ID              string
	PhoneE164       string
	SecurityEnabled bool
	Version         int
}

type CanonicalActorResolution struct {
	ActorID         string `json:"actorId"`
	SecurityEnabled bool   `json:"securityEnabled"`
	Version         int    `json:"version"`
}

type ActorRole struct {
	ActorID     string
	Role        string
	Enabled     bool
	ActivatedAt *time.Time
	Version     int
}

type ActorRoleView struct {
	ActorID           string     `json:"actorId"`
	PhoneE164         string     `json:"phoneE164"`
	Role              string     `json:"role"`
	Enabled           bool       `json:"enabled"`
	ActivatedAt       *time.Time `json:"activatedAt,omitempty"`
	SecurityEnabled   bool       `json:"securityEnabled"`
	ActorVersion      int        `json:"actorVersion"`
	RoleVersion       int        `json:"roleVersion"`
	CredentialVersion int        `json:"credentialVersion,omitempty"`
	ActorCreated      bool       `json:"actorCreated,omitempty"`
	RoleCreated       bool       `json:"roleCreated,omitempty"`
}

type OperatorProfile struct {
	ID              string     `json:"id"`
	FullNameAr      string     `json:"fullNameAr"`
	PhoneE164       string     `json:"phoneE164,omitempty"`
	ActorID         string     `json:"actorId,omitempty"`
	RoleEnabled     *bool      `json:"roleEnabled,omitempty"`
	SecurityEnabled *bool      `json:"securityEnabled,omitempty"`
	ActivatedAt     *time.Time `json:"activatedAt,omitempty"`
	State           string     `json:"state"`
	Version         int        `json:"version"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

type OperatorProfilePage struct {
	Items      []OperatorProfile `json:"items"`
	Limit      int               `json:"limit"`
	NextCursor string            `json:"nextCursor,omitempty"`
}

type OperatorProfileCreateRequest struct {
	FullNameAr string `json:"fullNameAr"`
	PhoneE164  string `json:"phoneE164"`
}

type OperatorProfileUpdateRequest struct {
	FullNameAr      string `json:"fullNameAr"`
	PhoneE164       string `json:"phoneE164"`
	ExpectedVersion int    `json:"expectedVersion"`
}

type OperatorProfileMutationRequest struct {
	ExpectedVersion int `json:"expectedVersion"`
}

type OperatorProfileResponse struct {
	Profile          OperatorProfile `json:"profile"`
	IdempotentReplay bool            `json:"idempotentReplay"`
}

type OperatorProfileGrantResponse struct {
	Profile          OperatorProfile `json:"profile"`
	Role             ActorRoleView   `json:"role"`
	IdempotentReplay bool            `json:"idempotentReplay"`
}

type OperatorPermissionAccess struct {
	ActorID          string    `json:"actorId"`
	Permission       string    `json:"permission"`
	Enabled          bool      `json:"enabled"`
	Version          int       `json:"version"`
	ChangedByActorID *string   `json:"changedByActorId,omitempty"`
	Reason           string    `json:"reason"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

const (
	OperatorPermissionOperations       = "operations"
	OperatorPermissionPartners         = "partners"
	OperatorPermissionCatalog          = "catalog"
	OperatorPermissionMarketing        = "marketing"
	OperatorPermissionFinance          = "finance"
	OperatorPermissionPlatformPolicies = "platform_policies"
)

func IsOperatorPermission(permission string) bool {
	switch permission {
	case OperatorPermissionOperations, OperatorPermissionPartners, OperatorPermissionCatalog, OperatorPermissionMarketing, OperatorPermissionFinance, OperatorPermissionPlatformPolicies:
		return true
	default:
		return false
	}
}

func OperatorPermissions() []string {
	return []string{
		OperatorPermissionOperations,
		OperatorPermissionPartners,
		OperatorPermissionCatalog,
		OperatorPermissionMarketing,
		OperatorPermissionFinance,
		OperatorPermissionPlatformPolicies,
	}
}

type SetOperatorPermissionRequest struct {
	Enabled bool `json:"enabled"`
}

type ActorSearchInput struct {
	Role    string
	Query   string
	Enabled *bool
	Sort    string
	Limit   int
	Cursor  string
}

type ActorSearchPage struct {
	Items      []ActorRoleView `json:"items"`
	Limit      int             `json:"limit"`
	NextCursor string          `json:"nextCursor,omitempty"`
}

type ActorRoleReadBatchRequest struct {
	Role     string   `json:"role"`
	ActorIDs []string `json:"actorIds"`
}

type ActorRoleReadBatchResponse struct {
	Items []ActorRoleView `json:"items"`
}

type ProvisionActorRoleInput struct {
	PhoneE164 string `json:"phoneE164"`
	Role      string `json:"role"`
}

type PhoneRequest struct {
	Phone string `json:"phone"`
}

type ManagedChallengeRequest struct {
	Phone string `json:"phone"`
	Role  string `json:"role"`
}

type ClientCredentialProofRequest struct {
	Phone            string `json:"phone"`
	Code             string `json:"code"`
	Password         string `json:"password"`
	ClientInstanceId string `json:"clientInstanceId"`
}

type ClientRecoveryProofRequest struct {
	Phone    string `json:"phone"`
	Code     string `json:"code"`
	Password string `json:"password"`
}

type ManagedRecoveryProofRequest struct {
	Phone            string `json:"phone"`
	Role             string `json:"role"`
	VerificationCode string `json:"verificationCode"`
	Password         string `json:"password"`
}

type PasswordLoginRequest struct {
	Phone            string `json:"phone"`
	Password         string `json:"password"`
	ClientInstanceId string `json:"clientInstanceId"`
}

type ManagedPasswordLoginRequest struct {
	Phone            string `json:"phone"`
	Password         string `json:"password"`
	Role             string `json:"role"`
	ClientInstanceId string `json:"clientInstanceId"`
}

type ManagedActivationRequest struct {
	Phone                   string `json:"phone"`
	Role                    string `json:"role"`
	OperatorEnrollmentToken string `json:"operatorEnrollmentToken,omitempty"`
	VerificationCode        string `json:"verificationCode"`
	Password                string `json:"password"`
	ClientInstanceId        string `json:"clientInstanceId"`
}

type OperatorEnrollmentRequest struct {
	Phone                   string `json:"phone"`
	OperatorEnrollmentToken string `json:"operatorEnrollmentToken"`
}

type OperatorPasskeyRegistrationOptionsRequest struct {
	Phone                   string `json:"phone"`
	OperatorEnrollmentToken string `json:"operatorEnrollmentToken"`
	VerificationCode        string `json:"verificationCode"`
}

type PasskeyOptions struct {
	CeremonyID string          `json:"ceremonyId"`
	PublicKey  json.RawMessage `json:"publicKey"`
}

type OperatorPasskeyRegistrationFinishRequest struct {
	CeremonyID       string          `json:"ceremonyId"`
	Credential       json.RawMessage `json:"credential"`
	ClientInstanceId string          `json:"clientInstanceId"`
}

type OperatorPasskeyAuthenticationFinishRequest struct {
	CeremonyID       string          `json:"ceremonyId"`
	Credential       json.RawMessage `json:"credential"`
	ClientInstanceId string          `json:"clientInstanceId"`
}

type OperatorRecoveryRequest struct {
	Phone              string `json:"phone"`
	RecoveryCredential string `json:"recoveryCredential"`
}

type OperatorPasskeyRecoveryRegistrationOptionsRequest struct {
	Phone              string `json:"phone"`
	RecoveryCredential string `json:"recoveryCredential"`
	VerificationCode   string `json:"verificationCode"`
}

type OperatorPasskeyRecoveryFinishRequest struct {
	CeremonyID       string          `json:"ceremonyId"`
	Credential       json.RawMessage `json:"credential"`
	ClientInstanceId string          `json:"clientInstanceId"`
}

type OperatorPasskeyRegistrationResponse struct {
	TokenPair          TokenPair `json:"tokenPair"`
	RecoveryCredential string    `json:"recoveryCredential"`
}

type OperatorEnrollmentTokenIssueRequest struct {
	PhoneE164 string `json:"phoneE164"`
	Role      string `json:"role"`
}

type OperatorEnrollmentToken struct {
	Code        string    `json:"code"`
	MaskedPhone string    `json:"maskedPhone"`
	Role        string    `json:"role"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type Challenge struct {
	ChallengeID string    `json:"challengeId"`
	MaskedPhone string    `json:"maskedPhone"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type RefreshRequest struct {
	RefreshToken     string `json:"refreshToken"`
	ClientInstanceId string `json:"clientInstanceId"`
	RefreshRequestId string `json:"refreshRequestId"`
}

type ActorIdentity struct {
	Subject                      string    `json:"subject"`
	SessionID                    string    `json:"sessionId"`
	Role                         string    `json:"role"`
	Surface                      string    `json:"surface"`
	ExpiresAt                    time.Time `json:"expiresAt"`
	Permissions                  []string  `json:"permissions,omitempty"`
	CanManageOperatorPermissions bool      `json:"canManageOperatorPermissions,omitempty"`
}

type TokenPair struct {
	AccessToken  string        `json:"accessToken"`
	RefreshToken string        `json:"refreshToken"`
	AccessExpiry time.Time     `json:"accessExpiresAt"`
	Identity     ActorIdentity `json:"identity"`
}

type RecoveryResult struct {
	Status string `json:"status"`
}

type BootstrapOperatorRequest struct {
	PhoneE164 string `json:"phoneE164"`
	Role      string `json:"role"`
}

type BootstrapOperatorResponse struct {
	Role            ActorRoleView           `json:"role"`
	EnrollmentToken OperatorEnrollmentToken `json:"enrollmentToken"`
}

type SessionInfo struct {
	SessionID     string     `json:"sessionId"`
	Role          string     `json:"role"`
	Surface       string     `json:"surface"`
	Version       int        `json:"version"`
	CreatedAt     time.Time  `json:"createdAt"`
	ExpiresAt     time.Time  `json:"expiresAt"`
	LastUsedAt    *time.Time `json:"lastUsedAt,omitempty"`
	CompromisedAt *time.Time `json:"compromisedAt,omitempty"`
}

const (
	ChallengeClientRegister  = "client_register"
	ChallengeClientRecover   = "client_recover"
	ChallengeManagedActivate = "managed_activate"
	ChallengeManagedRecover  = "managed_recover"
	ChallengeOperatorEnroll  = "operator_enroll"
	ChallengeOperatorRecover = "operator_recover"
)

var (
	ErrInvalidInput          = errors.New("invalid input")
	ErrUnauthenticated       = errors.New("unauthenticated")
	ErrForbidden             = errors.New("forbidden")
	ErrNotFound              = errors.New("not found")
	ErrConflict              = errors.New("conflict")
	ErrRateLimited           = errors.New("rate limited")
	ErrUnavailable           = errors.New("unavailable")
	ErrInvalidChallenge      = errors.New("invalid challenge")
	ErrInvalidActivation     = errors.New("invalid activation")
	ErrInvalidRefresh        = errors.New("invalid refresh")
	ErrRefreshStale          = errors.New("stale refresh")
	ErrActorBlocked          = errors.New("actor blocked")
	ErrActorSecurityDisabled = errors.New("actor security is disabled")
)

var roleSurface = map[string]string{
	"client":   "app-client",
	"partner":  "app-partner",
	"captain":  "app-captain",
	"field":    "app-field",
	"operator": "control-panel",
}

func SurfaceForRole(role string) (string, bool) {
	surface, ok := roleSurface[strings.ToLower(strings.TrimSpace(role))]
	return surface, ok
}

func CanProvisionRole(caller, role string) bool {
	role = strings.ToLower(strings.TrimSpace(role))
	switch strings.ToLower(strings.TrimSpace(caller)) {
	case "dsh":
		return role == "partner" || role == "captain" || role == "field"
	default:
		return false
	}
}

func CanBootstrapFirstOperator(caller string) bool {
	return strings.EqualFold(strings.TrimSpace(caller), "operator-bootstrap")
}

func CanReadRole(caller, role string) bool {
	caller = strings.ToLower(strings.TrimSpace(caller))
	role = strings.ToLower(strings.TrimSpace(role))
	switch caller {
	case "dsh":
		return role == "partner" || role == "captain" || role == "field" || role == "operator"
	case "control-panel":
		return role == "client" || IsManagedRole(role) || role == "operator"
	default:
		return false
	}
}

func CanSetRoleEnabled(caller, role string) bool {
	caller = strings.ToLower(strings.TrimSpace(caller))
	role = strings.ToLower(strings.TrimSpace(role))
	switch caller {
	case "dsh":
		return IsManagedRole(role)
	case "control-panel":
		return role == "client" || role == "operator"
	default:
		return false
	}
}

func CanAuthorizeReenrollment(caller, role string) bool {
	caller = strings.ToLower(strings.TrimSpace(caller))
	role = strings.ToLower(strings.TrimSpace(role))
	return caller == "dsh" && IsManagedRole(role)
}

func CanIssueOperatorEnrollmentTokenForRole(caller, role string) bool {
	caller = strings.ToLower(strings.TrimSpace(caller))
	role = strings.ToLower(strings.TrimSpace(role))
	return (caller == "control-panel" || caller == "operator-bootstrap") && role == "operator"
}

func RequiresEnrollmentToken(role string) bool {
	return false
}

func IsManagedRole(role string) bool {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "partner", "captain", "field":
		return true
	default:
		return false
	}
}

func IsManagedActivationRole(role string) bool {
	role = strings.ToLower(strings.TrimSpace(role))
	return IsManagedRole(role)
}

func IsControlPanelRole(role string) bool {
	return strings.EqualFold(strings.TrimSpace(role), "operator")
}
