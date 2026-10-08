package identity

import (
	"context"
	"errors"
	"net/url"
	"strings"

	phoneformat "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/phone"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type ActorInput struct{ PhoneE164 string }

var (
	ErrInvitePhoneInvalid = errors.New("Store access invite phone is invalid")
	ErrInviteActorMissing = errors.New("no Identity actor matches the Store access invite phone")
)

type Client struct{ inner *identityclient.Client }

func ResolveBaseURL(raw, runtimeEnvironment string, allowedHostValues ...string) (identityclient.Endpoint, error) {
	environment := strings.ToLower(strings.TrimSpace(runtimeEnvironment))
	switch environment {
	case "development", "test", "staging", "production":
	default:
		return identityclient.Endpoint{}, errors.New("BTHWANI_ENV must be development, test, staging, or production")
	}
	value := strings.TrimRight(strings.TrimSpace(raw), "/")
	if value == "" {
		if environment == "development" || environment == "test" {
			value = "http://identity:8082"
		} else {
			return identityclient.Endpoint{}, errors.New("DSH_IDENTITY_API_BASE_URL is required outside local environments")
		}
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return identityclient.Endpoint{}, errors.New("DSH_IDENTITY_API_BASE_URL is invalid")
	}
	if (environment == "staging" || environment == "production") && parsed.Scheme != "https" {
		return identityclient.Endpoint{}, errors.New("DSH_IDENTITY_API_BASE_URL must use HTTPS outside local environments")
	}
	allowedHosts := parseAllowedHosts(allowedHostValues...)
	if len(allowedHosts) == 0 && (environment == "development" || environment == "test") {
		allowedHosts = []string{"identity", "localhost", "127.0.0.1", "::1"}
	}
	if len(allowedHosts) == 0 {
		return identityclient.Endpoint{}, errors.New("DSH_IDENTITY_API_ALLOWED_HOSTS is required outside local environments")
	}
	return identityclient.ParseEndpoint(value, allowedHosts)
}

func parseAllowedHosts(values ...string) []string {
	var hosts []string
	for _, value := range values {
		for _, host := range strings.Split(value, ",") {
			host = strings.TrimSpace(host)
			if host != "" {
				hosts = append(hosts, host)
			}
		}
	}
	return hosts
}

func New(endpoint identityclient.Endpoint, serviceToken string) (*Client, error) {
	inner, err := identityclient.New(endpoint, serviceToken)
	if err != nil {
		return nil, err
	}
	return &Client{inner: inner}, nil
}

func (c *Client) ProvisionPartnerWithContext(ctx context.Context, input ActorInput, correlationID, operatorActorID string) (identityclient.ActorRoleView, error) {
	return c.inner.ProvisionRoleWithContext(ctx, identityclient.ProvisionActorRoleRequest{PhoneE164: input.PhoneE164, Role: "partner"}, correlationID, operatorActorID)
}
func (c *Client) ProvisionExistingPartnerWithContext(ctx context.Context, actorID, correlationID, operatorActorID string) (identityclient.ActorRoleView, error) {
	return c.inner.ProvisionExistingRoleWithContext(ctx, strings.TrimSpace(actorID), "partner", correlationID, operatorActorID)
}

func (c *Client) ProvisionCaptainWithContext(ctx context.Context, input ActorInput, correlationID, operatorActorID string) (identityclient.ActorRoleView, error) {
	return c.inner.ProvisionRoleWithContext(ctx, identityclient.ProvisionActorRoleRequest{PhoneE164: input.PhoneE164, Role: "captain"}, correlationID, operatorActorID)
}

func (c *Client) ProvisionFieldWithContext(ctx context.Context, input ActorInput, correlationID, operatorActorID string) (identityclient.ActorRoleView, error) {
	return c.inner.ProvisionRoleWithContext(ctx, identityclient.ProvisionActorRoleRequest{PhoneE164: input.PhoneE164, Role: "field"}, correlationID, operatorActorID)
}

func (c *Client) SearchFieldRolesByPhoneE164(ctx context.Context, phone string) (identityclient.ActorRoleSearchPage, error) {
	return c.inner.SearchRolesAnyStatus(ctx, "field", strings.TrimSpace(phone))
}

func (c *Client) ResolvePartnerInviteByPhone(ctx context.Context, rawPhone string) (identityclient.ActorRoleView, error) {
	phone, err := normalizeInvitePhoneE164(rawPhone)
	if err != nil {
		return identityclient.ActorRoleView{}, err
	}
	page, err := c.inner.SearchRolesAnyStatus(ctx, "client", phone)
	if err != nil {
		return identityclient.ActorRoleView{}, err
	}
	for _, role := range page.Items {
		if role.PhoneE164 == phone && role.Role == "client" && role.ActorID != "" && role.SecurityEnabled {
			return role, nil
		}
	}
	return identityclient.ActorRoleView{}, ErrInviteActorMissing
}

func normalizeInvitePhoneE164(raw string) (string, error) {
	phone := phoneformat.NormalizeYemenE164(raw)
	if !phoneformat.IsE164(phone) {
		return "", ErrInvitePhoneInvalid
	}
	return phone, nil
}

func (c *Client) ReadActorRole(ctx context.Context, actorID, role string) (identityclient.ActorRoleView, error) {
	return c.inner.ReadRole(ctx, actorID, role)
}

func (c *Client) ReadCanonicalActor(ctx context.Context, actorID string) (identityclient.CanonicalActorResolution, error) {
	return c.inner.ReadCanonicalActor(ctx, strings.TrimSpace(actorID))
}

func (c *Client) ReadActorRoles(ctx context.Context, role string, actorIDs []string) (identityclient.ActorRoleReadBatchResponse, error) {
	return c.inner.ReadRoles(ctx, identityclient.ActorRoleReadBatchRequest{Role: identityclient.ActorType(role), ActorIds: actorIDs})
}

func (c *Client) ReadOperatorPermission(ctx context.Context, actorID, permission string) (identityclient.OperatorPermissionAccess, error) {
	return c.inner.ReadOperatorPermission(ctx, actorID, permission, "")
}

func (c *Client) ReadVerifiedActorLegalName(ctx context.Context, actorID, operatorActorID string) (identityclient.ActorLegalName, error) {
	return c.inner.ReadVerifiedActorLegalName(ctx, strings.TrimSpace(actorID), strings.TrimSpace(operatorActorID))
}

func (c *Client) ReadPendingActorLegalName(ctx context.Context, actorID, operatorActorID string) (identityclient.ActorLegalName, error) {
	return c.inner.ReadPendingActorLegalName(ctx, strings.TrimSpace(actorID), strings.TrimSpace(operatorActorID))
}

func (c *Client) SubmitActorLegalName(ctx context.Context, actorID string, input identityclient.SubmitActorLegalNameRequest, correlationID, idempotencyKey, operatorActorID string) (identityclient.ActorLegalName, error) {
	return c.inner.SubmitActorLegalName(ctx, strings.TrimSpace(actorID), input, correlationID, idempotencyKey, operatorActorID)
}

func (c *Client) VerifyActorLegalName(ctx context.Context, actorID string, version int, input identityclient.VerifyActorLegalNameRequest, correlationID, idempotencyKey, operatorActorID string) (identityclient.ActorLegalName, error) {
	return c.inner.VerifyActorLegalName(ctx, strings.TrimSpace(actorID), version, input, correlationID, idempotencyKey, operatorActorID)
}

func (c *Client) RequireOperatorPermission(ctx context.Context, actorID, permission string) error {
	access, err := c.ReadOperatorPermission(ctx, strings.TrimSpace(actorID), strings.TrimSpace(permission))
	if err != nil {
		return err
	}
	if !access.Enabled {
		return &identityclient.Error{Status: 403, Code: "FORBIDDEN", Message: "the required Operator workspace permission is not granted"}
	}
	return nil
}

func (c *Client) ReadSession(ctx context.Context, accessToken string) (identityclient.ActorIdentity, error) {
	return c.inner.ReadSession(ctx, accessToken)
}

func (c *Client) SetRoleEnabledWithContext(ctx context.Context, actorID, role string, enabled bool, correlationID, reason, operatorActorID string, expectedVersion int) error {
	return c.inner.SetRoleEnabledWithContext(ctx, actorID, role, enabled, correlationID, reason, operatorActorID, expectedVersion)
}

func (c *Client) AuthorizeReenrollmentWithContext(ctx context.Context, actorID, role, correlationID, reason, operatorActorID string, expectedActorVersion, expectedRoleVersion int) error {
	return c.inner.AuthorizeReenrollmentWithContext(ctx, actorID, role, correlationID, operatorActorID, reason, expectedActorVersion, expectedRoleVersion)
}
