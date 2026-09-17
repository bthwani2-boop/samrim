package identity

import (
	"context"
	"errors"
	"net/url"
	"strings"

	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type ActorInput struct{ PhoneE164 string }

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

func (c *Client) ProvisionCaptainWithContext(ctx context.Context, input ActorInput, correlationID, operatorActorID string) (identityclient.ActorRoleView, error) {
	return c.inner.ProvisionRoleWithContext(ctx, identityclient.ProvisionActorRoleRequest{PhoneE164: input.PhoneE164, Role: "captain"}, correlationID, operatorActorID)
}

func (c *Client) ProvisionFieldWithContext(ctx context.Context, input ActorInput, correlationID, operatorActorID string) (identityclient.ActorRoleView, error) {
	return c.inner.ProvisionRoleWithContext(ctx, identityclient.ProvisionActorRoleRequest{PhoneE164: input.PhoneE164, Role: "field"}, correlationID, operatorActorID)
}

func (c *Client) ReadActorRole(ctx context.Context, actorID, role string) (identityclient.ActorRoleView, error) {
	return c.inner.ReadRole(ctx, actorID, role)
}

func (c *Client) ReadSession(ctx context.Context, accessToken string) (identityclient.ActorIdentity, error) {
	return c.inner.ReadSession(ctx, accessToken)
}

func (c *Client) SetRoleEnabledWithContext(ctx context.Context, actorID, role string, enabled bool, correlationID, reason, operatorActorID string, expectedVersion int) error {
	return c.inner.SetRoleEnabledWithContext(ctx, actorID, role, enabled, correlationID, reason, operatorActorID, expectedVersion)
}
