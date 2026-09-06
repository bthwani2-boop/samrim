package domain

import (
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

type ActorRole struct {
	ActorID     string
	Role        string
	Enabled     bool
	ActivatedAt *time.Time
	Version     int
}

type ActorRoleView struct {
	ActorID         string     `json:"actorId"`
	PhoneE164       string     `json:"phoneE164"`
	Role            string     `json:"role"`
	Enabled         bool       `json:"enabled"`
	ActivatedAt     *time.Time `json:"activatedAt,omitempty"`
	SecurityEnabled bool       `json:"securityEnabled"`
	ActorVersion    int        `json:"actorVersion"`
	RoleVersion     int        `json:"roleVersion"`
	ActorCreated    bool       `json:"actorCreated,omitempty"`
	RoleCreated     bool       `json:"roleCreated,omitempty"`
}

type ActorSearchInput struct {
	Role    string
	Query   string
	Enabled *bool
	Limit   int
	Cursor  string
}

type ActorSearchPage struct {
	Items      []ActorRoleView `json:"items"`
	Limit      int             `json:"limit"`
	NextCursor string          `json:"nextCursor,omitempty"`
}

type ManagedAuthState struct {
	Exists          bool
	Enabled         bool
	SecurityEnabled bool
	Activated       bool
	HasCredential   bool
}

type ProvisionActorRoleInput struct {
	PhoneE164 string `json:"phoneE164"`
	Role      string `json:"role"`
	Password  string `json:"password,omitempty"`
}

type PasswordResetRequest struct {
	Password string `json:"password"`
}

type PhoneRequest struct {
	Phone string `json:"phone"`
}

type ManagedChallengeRequest struct {
	Phone          string `json:"phone"`
	Role           string `json:"role"`
	ActivationCode string `json:"activationCode"`
}

type ManagedRecoveryChallengeRequest struct {
	Phone string `json:"phone"`
	Role  string `json:"role"`
}

type ManagedAuthStateRequest struct {
	Phone string `json:"phone"`
	Role  string `json:"role"`
}

type ControlPanelAuthStateRequest struct {
	Phone string `json:"phone"`
}

type ClientCredentialProofRequest struct {
	Phone             string `json:"phone"`
	Code              string `json:"code"`
	Password          string `json:"password"`
	DeviceFingerprint string `json:"deviceFingerprint"`
}

type PasswordLoginRequest struct {
	Phone             string `json:"phone"`
	Password          string `json:"password"`
	DeviceFingerprint string `json:"deviceFingerprint"`
}

type ManagedPasswordLoginRequest struct {
	Phone             string `json:"phone"`
	Password          string `json:"password"`
	Role              string `json:"role"`
	DeviceFingerprint string `json:"deviceFingerprint"`
}

type ManagedActivationRequest struct {
	Phone             string `json:"phone"`
	Role              string `json:"role"`
	ActivationCode    string `json:"activationCode"`
	VerificationCode  string `json:"verificationCode"`
	Password          string `json:"password"`
	DeviceFingerprint string `json:"deviceFingerprint"`
}

type ManagedRecoveryRequest struct {
	Phone             string `json:"phone"`
	Role              string `json:"role"`
	Code              string `json:"code"`
	Password          string `json:"password"`
	DeviceFingerprint string `json:"deviceFingerprint"`
}

type ManagedActivationCodeIssueRequest struct {
	PhoneE164 string `json:"phoneE164"`
	Role      string `json:"role"`
}

type ManagedActivationCode struct {
	Code        string    `json:"code"`
	MaskedPhone string    `json:"maskedPhone"`
	Role        string    `json:"role"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type OperatorLoginStartRequest struct {
	Phone    string `json:"phone"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

type OperatorLoginCompleteRequest struct {
	Phone             string `json:"phone"`
	Code              string `json:"code"`
	Role              string `json:"role"`
	DeviceFingerprint string `json:"deviceFingerprint"`
}

type Challenge struct {
	ChallengeID string    `json:"challengeId"`
	MaskedPhone string    `json:"maskedPhone"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type RefreshRequest struct {
	RefreshToken      string `json:"refreshToken"`
	DeviceFingerprint string `json:"deviceFingerprint"`
}

type ActorIdentity struct {
	Subject   string    `json:"subject"`
	SessionID string    `json:"sessionId"`
	Role      string    `json:"role"`
	Surface   string    `json:"surface"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type TokenPair struct {
	AccessToken  string        `json:"accessToken"`
	RefreshToken string        `json:"refreshToken"`
	AccessExpiry time.Time     `json:"accessExpiresAt"`
	Identity     ActorIdentity `json:"identity"`
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
	ChallengeOperatorMFA     = "operator_mfa"
)

var (
	ErrInvalidInput      = errors.New("invalid input")
	ErrUnauthenticated   = errors.New("unauthenticated")
	ErrForbidden         = errors.New("forbidden")
	ErrNotFound          = errors.New("not found")
	ErrConflict          = errors.New("conflict")
	ErrRateLimited       = errors.New("rate limited")
	ErrUnavailable       = errors.New("unavailable")
	ErrInvalidChallenge  = errors.New("invalid challenge")
	ErrInvalidActivation = errors.New("invalid activation")
	ErrInvalidRefresh    = errors.New("invalid refresh")
	ErrActorBlocked      = errors.New("actor blocked")
)

var roleSurface = map[string]string{
	"client":         "app-client",
	"partner":        "app-partner",
	"captain":        "app-captain",
	"field":          "app-field",
	"operator":       "control-panel",
	"platform_owner": "control-panel",
}

func SurfaceForRole(role string) (string, bool) {
	surface, ok := roleSurface[strings.ToLower(strings.TrimSpace(role))]
	return surface, ok
}

func RoleAllowedForCaller(caller, role string) bool {
	role = strings.ToLower(strings.TrimSpace(role))
	switch strings.ToLower(strings.TrimSpace(caller)) {
	case "dsh":
		return role == "partner" || role == "captain" || role == "field"
	case "platform-control":
		return role == "client" || role == "operator"
	case "platform-bootstrap":
		return role == "platform_owner"
	default:
		return false
	}
}

func CanIssueManagedActivationCodeForRole(caller, role string) bool {
	caller = strings.ToLower(strings.TrimSpace(caller))
	role = strings.ToLower(strings.TrimSpace(role))
	switch caller {
	case "dsh":
		return IsManagedRole(role)
	case "platform-control":
		return IsManagedActivationRole(role)
	default:
		return false
	}
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
	return IsManagedRole(role) || role == "operator"
}

func IsControlPanelRole(role string) bool {
	role = strings.ToLower(strings.TrimSpace(role))
	return role == "operator" || role == "platform_owner"
}
