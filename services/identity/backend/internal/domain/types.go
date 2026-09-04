package domain

import (
	"errors"
	"strings"
	"time"
)

type ActorStatus string

const (
	ActorStatusProvisioned       ActorStatus = "PROVISIONED"
	ActorStatusPendingActivation ActorStatus = "PENDING_ACTIVATION"
	ActorStatusActive            ActorStatus = "ACTIVE"
	ActorStatusSuspended         ActorStatus = "SUSPENDED"
	ActorStatusDeactivated       ActorStatus = "DEACTIVATED"
)

type Permission struct {
	Service string `json:"service"`
	Surface string `json:"surface"`
	Action  string `json:"action"`
	Scope   string `json:"scope"`
}

type Actor struct {
	ID                      string
	Username                string
	PhoneE164               string
	OperatorContextID       string
	Roles                   []string
	Permissions             []Permission
	PasswordHash            string
	Status                  ActorStatus
	Version                 int
	ProvisioningFingerprint string
	CreatedByService        string
}

type ActorView struct {
	ActorID           string      `json:"actorId"`
	Username          string      `json:"username"`
	PhoneE164         string      `json:"phoneE164"`
	OperatorContextID string      `json:"operatorContextId"`
	Roles             []string    `json:"roles"`
	Status            ActorStatus `json:"status"`
	Version           int         `json:"version"`
	Created           bool        `json:"created,omitempty"`
}

type ActorSearchInput struct {
	Role   string
	Query  string
	Status ActorStatus
	Limit  int
	Cursor string
}

type ActorSearchPage struct {
	Items      []ActorView `json:"items"`
	Limit      int         `json:"limit"`
	NextCursor string      `json:"nextCursor,omitempty"`
}

type ProvisionActorInput struct {
	ActorID   string `json:"actorId,omitempty"`
	Username  string `json:"username"`
	PhoneE164 string `json:"phoneE164"`
	Role      string `json:"role"`
	Password  string `json:"password,omitempty"`
}

type ActivationRequest struct {
	Phone             string `json:"phone"`
	ActorType         string `json:"actorType"`
	Code              string `json:"code"`
	DeviceFingerprint string `json:"deviceFingerprint"`
}

type OtpRequest struct {
	Phone     string `json:"phone"`
	ActorType string `json:"actorType"`
}

type IssueActivationInput struct {
	IssuedBy          string `json:"issuedBy"`
	ExpectedActorType string `json:"expectedActorType"`
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
	Subject           string          `json:"subject"`
	SessionID         string          `json:"sessionId"`
	OperatorContextID string          `json:"operatorContextId"`
	PhoneE164         string          `json:"phoneE164"`
	Roles             []string        `json:"roles"`
	Permissions       []Permission    `json:"permissions"`
	AuthState         string          `json:"authState"`
	SurfaceAccess     map[string]bool `json:"surfaceAccess"`
	SessionSurface    string          `json:"sessionSurface"`
	ExpiresAt         time.Time       `json:"expiresAt"`
}

type TokenPair struct {
	AccessToken  string        `json:"accessToken"`
	RefreshToken string        `json:"refreshToken"`
	AccessExpiry time.Time     `json:"accessExpiresAt"`
	Identity     ActorIdentity `json:"identity"`
}

type SessionInfo struct {
	SessionID     string     `json:"sessionId"`
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

func ActorHasRole(actor Actor, role string) bool {
	role = strings.ToLower(strings.TrimSpace(role))
	for _, candidate := range actor.Roles {
		if strings.ToLower(strings.TrimSpace(candidate)) == role {
			return true
		}
	}
	return false
}

func SurfaceAccess(actor Actor) map[string]bool {
	result := map[string]bool{}
	for _, role := range actor.Roles {
		if surface, ok := SurfaceForRole(role); ok {
			result[surface] = true
		}
	}
	return result
}
