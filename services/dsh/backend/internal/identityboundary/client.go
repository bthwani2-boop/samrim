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

func (c *Client) provision(ctx context.Context, role string, input ActorInput, correlationID, operatorActorID string) (identityclient.ActorRoleView, error) {
	return c.inner.ProvisionRoleWithContext(ctx, identityclient.ProvisionActorRoleRequest{PhoneE164: input.PhoneE164, Role: role}, correlationID, operatorActorID)
}

func (c *Client) ProvisionPartnerWithContext(ctx context.Context, input ActorInput, correlationID, operatorActorID string) (identityclient.ActorRoleView, error) {
	return c.provision(ctx, "partner", input, correlationID, operatorActorID)
}

func (c *Client) ProvisionCaptainWithContext(ctx context.Context, input ActorInput, correlationID, operatorActorID string) (identityclient.ActorRoleView, error) {
	return c.provision(ctx, "captain", input, correlationID, operatorActorID)
}

func (c *Client) ProvisionFieldWithContext(ctx context.Context, input ActorInput, correlationID, operatorActorID string) (identityclient.ActorRoleView, error) {
	return c.provision(ctx, "field", input, correlationID, operatorActorID)
}

func (c *Client) SetRoleEnabledByPhoneWithContext(ctx context.Context, phone, role string, enabled bool, correlationID, reason, operatorActorID string, expectedVersion int) error {
	view, err := c.inner.LookupRoleByPhone(ctx, role, phone)
	if err != nil {
		return err
	}
	return c.inner.SetRoleEnabledWithContext(ctx, view.ActorID, role, enabled, correlationID, reason, operatorActorID, expectedVersion)
}

func (c *Client) AuthorizeReenrollmentByPhoneWithContext(ctx context.Context, phone, role, correlationID, operatorActorID string) error {
	return c.inner.AuthorizeReenrollmentByPhoneWithContext(ctx, phone, role, correlationID, operatorActorID)
}

func (c *Client) LookupRoleByPhone(ctx context.Context, phone, role string) (identityclient.ActorRoleView, error) {
	return c.inner.LookupRoleByPhone(ctx, role, phone)
}

func (c *Client) ReadActorRole(ctx context.Context, actorID, role string) (identityclient.ActorRoleView, error) {
	return c.inner.ReadRole(ctx, actorID, role)
}

func (c *Client) ReadSession(ctx context.Context, accessToken string) (identityclient.ActorIdentity, error) {
	return c.inner.ReadSession(ctx, accessToken)
}

func (c *Client) SetPartnerEnabled(ctx context.Context, phone string, enabled bool, correlationID, reason, operatorActorID string, expectedVersion int) error {
	return c.SetRoleEnabledByPhoneWithContext(ctx, phone, "partner", enabled, correlationID, reason, operatorActorID, expectedVersion)
}

func (c *Client) SetCaptainEnabled(ctx context.Context, phone string, enabled bool, correlationID, reason, operatorActorID string, expectedVersion int) error {
	return c.SetRoleEnabledByPhoneWithContext(ctx, phone, "captain", enabled, correlationID, reason, operatorActorID, expectedVersion)
}

func (c *Client) SetFieldEnabled(ctx context.Context, phone string, enabled bool, correlationID, reason, operatorActorID string, expectedVersion int) error {
	return c.SetRoleEnabledByPhoneWithContext(ctx, phone, "field", enabled, correlationID, reason, operatorActorID, expectedVersion)
}

func (c *Client) AuthorizePartnerReenrollment(ctx context.Context, phone, correlationID, operatorActorID string) error {
	return c.AuthorizeReenrollmentByPhoneWithContext(ctx, phone, "partner", correlationID, operatorActorID)
}

func (c *Client) AuthorizeCaptainReenrollment(ctx context.Context, phone, correlationID, operatorActorID string) error {
	return c.AuthorizeReenrollmentByPhoneWithContext(ctx, phone, "captain", correlationID, operatorActorID)
}

func (c *Client) AuthorizeFieldReenrollment(ctx context.Context, phone, correlationID, operatorActorID string) error {
	return c.AuthorizeReenrollmentByPhoneWithContext(ctx, phone, "field", correlationID, operatorActorID)
}

func (c *Client) Readiness(ctx context.Context) error { return c.inner.Readiness(ctx) }
