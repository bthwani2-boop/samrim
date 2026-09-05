package domain

import (
	"errors"
	"strings"
	"time"
)

type Actor struct {
	ID              string
	PhoneE164       string
	Username        string
	PasswordHash    string
	SecurityEnabled bool
	Version         int
}

type ActorRole struct {
	ActorID string
	Role    string
	Enabled bool
	Version int
}

type ActorRoleView struct {
	ActorID      string `json:"actorId"`
	PhoneE164    string `json:"phoneE164"`
	Username     string `json:"username,omitempty"`
	Role            string `json:"role"`
	Enabled         bool   `json:"enabled"`
	SecurityEnabled bool   `json:"securityEnabled"`
	ActorVersion    int    `json:"actorVersion"`
	RoleVersion  int    `json:"roleVersion"`
	ActorCreated bool   `json:"actorCreated,omitempty"`
	RoleCreated  bool   `json:"roleCreated,omitempty"`
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

type ProvisionActorRoleInput struct {
	PhoneE164 string `json:"phoneE164"`
	Role      string `json:"role"`
	Username  string `json:"username,omitempty"`
	Password  string `json:"password,omitempty"`
}

type PasswordResetRequest struct {
	Password string `json:"password"`
}

type ActivationRequest struct {
	Phone             string `json:"phone"`
	Role              string `json:"role"`
	Code              string `json:"code"`
	DeviceFingerprint string `json:"deviceFingerprint"`
}

type OtpRequest struct {
	Phone string `json:"phone"`
	Role  string `json:"role"`
}

type ActivationChallenge struct {
	ActivationID string    `json:"activationId"`
	MaskedPhone  string    `json:"maskedPhone"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

type LoginRequest struct {
	Username          string `json:"username"`
	Password          string `json:"password"`
	DeviceFingerprint string `json:"deviceFingerprint"`
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

var (
	ErrInvalidInput      = errors.New("invalid input")
	ErrUnauthenticated   = errors.New("unauthenticated")
	ErrForbidden         = errors.New("forbidden")
	ErrNotFound          = errors.New("not found")
	ErrConflict          = errors.New("conflict")
	ErrRateLimited       = errors.New("rate limited")
	ErrUnavailable       = errors.New("unavailable")
	ErrInvalidActivation = errors.New("invalid activation")
	ErrInvalidRefresh    = errors.New("invalid refresh")
	ErrActorBlocked      = errors.New("actor blocked")
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

func RoleAllowedForCaller(caller, role string) bool {
	role = strings.ToLower(strings.TrimSpace(role))
	switch strings.ToLower(strings.TrimSpace(caller)) {
	case "dsh":
		return role == "partner" || role == "captain" || role == "field"
	case "platform-control":
		return role == "operator"
	default:
		return false
	}
}

func IsPublicOtpRole(role string) bool {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "client", "partner", "captain", "field":
		return true
	default:
		return false
	}
}
