package identityboundary

import (
	"context"
	"errors"
	"net/url"
	"strings"

	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type ActorInput struct{ PhoneE164 string }

type Client struct{ inner *identityclient.Client }

func ResolveBaseURL(raw, runtimeEnvironment string) (string, error) {
	environment := strings.ToLower(strings.TrimSpace(runtimeEnvironment))
	switch environment {
	case "development", "test", "staging", "production":
	default:
		return "", errors.New("BTHWANI_ENV must be development, test, staging, or production")
	}
	value := strings.TrimRight(strings.TrimSpace(raw), "/")
	if value == "" {
		if environment == "development" || environment == "test" {
			return "http://identity:8082", nil
		}
		return "", errors.New("DSH_IDENTITY_API_BASE_URL is required outside local environments")
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("DSH_IDENTITY_API_BASE_URL is invalid")
	}
	if (environment == "staging" || environment == "production") && parsed.Scheme != "https" {
		return "", errors.New("DSH_IDENTITY_API_BASE_URL must use HTTPS outside local environments")
	}
	return value, nil
}

func New(baseURL, serviceToken string) (*Client, error) {
	inner, err := identityclient.New(baseURL, serviceToken)
	if err != nil {
		return nil, err
	}
	return &Client{inner: inner}, nil
}

func (c *Client) provision(ctx context.Context, role string, input ActorInput) (identityclient.ActorRoleView, error) {
	return c.inner.ProvisionRole(ctx, identityclient.ProvisionActorRoleRequest{PhoneE164: input.PhoneE164, Role: role})
}
func (c *Client) ProvisionPartner(ctx context.Context, input ActorInput) (identityclient.ActorRoleView, error) {
	return c.provision(ctx, "partner", input)
}
func (c *Client) ProvisionCaptain(ctx context.Context, input ActorInput) (identityclient.ActorRoleView, error) {
	return c.provision(ctx, "captain", input)
}
func (c *Client) ProvisionField(ctx context.Context, input ActorInput) (identityclient.ActorRoleView, error) {
	return c.provision(ctx, "field", input)
}

func (c *Client) SetPartnerEnabled(ctx context.Context, actorID string, enabled bool, correlationID string) error {
	return c.inner.SetRoleEnabled(ctx, actorID, "partner", enabled, correlationID)
}
func (c *Client) SetCaptainEnabled(ctx context.Context, actorID string, enabled bool, correlationID string) error {
	return c.inner.SetRoleEnabled(ctx, actorID, "captain", enabled, correlationID)
}
func (c *Client) SetFieldEnabled(ctx context.Context, actorID string, enabled bool, correlationID string) error {
	return c.inner.SetRoleEnabled(ctx, actorID, "field", enabled, correlationID)
}
func (c *Client) SetRoleEnabledByPhone(ctx context.Context, phone, role string, enabled bool, correlationID, reason string) error {
	return c.SetRoleEnabledByPhoneWithContext(ctx, phone, role, enabled, correlationID, reason, "", 0)
}
func (c *Client) SetRoleEnabledByPhoneWithContext(ctx context.Context, phone, role string, enabled bool, correlationID, reason, operatorActorID string, expectedVersion int) error {
	view, err := c.inner.LookupRoleByPhone(ctx, role, phone)
	if err != nil {
		return err
	}
	return c.inner.SetRoleEnabledWithContext(ctx, view.ActorID, role, enabled, correlationID, reason, operatorActorID, expectedVersion)
}

func (c *Client) AuthorizePartnerReenrollment(ctx context.Context, actorID, correlationID string) error {
	return c.inner.AuthorizeReenrollment(ctx, actorID, "partner", correlationID)
}
func (c *Client) AuthorizeCaptainReenrollment(ctx context.Context, actorID, correlationID string) error {
	return c.inner.AuthorizeReenrollment(ctx, actorID, "captain", correlationID)
}
func (c *Client) AuthorizeFieldReenrollment(ctx context.Context, actorID, correlationID string) error {
	return c.inner.AuthorizeReenrollment(ctx, actorID, "field", correlationID)
}
func (c *Client) AuthorizeReenrollment(ctx context.Context, actorID, role, correlationID string) error {
	return c.inner.AuthorizeReenrollment(ctx, actorID, role, correlationID)
}
func (c *Client) AuthorizeReenrollmentByPhone(ctx context.Context, phone, role, correlationID string) error {
	return c.inner.AuthorizeReenrollmentByPhone(ctx, phone, role, correlationID)
}
func (c *Client) LookupRoleByPhone(ctx context.Context, phone, role string) (identityclient.ActorRoleView, error) {
	return c.inner.LookupRoleByPhone(ctx, role, phone)
}
func (c *Client) Readiness(ctx context.Context) error { return c.inner.Readiness(ctx) }
