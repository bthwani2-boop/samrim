package identityboundary

import (
	"context"

	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type ActorInput struct {
	ActorID   string
	Username  string
	PhoneE164 string
}

type Client struct {
	inner *identityclient.Client
}

func New(baseURL, serviceToken string) (*Client, error) {
	inner, err := identityclient.New(baseURL, "workforce", serviceToken)
	if err != nil {
		return nil, err
	}
	return &Client{inner: inner}, nil
}

func (c *Client) ProvisionCaptain(ctx context.Context, operatorContextID string, input ActorInput) (identityclient.ActorView, error) {
	return c.inner.ProvisionActor(ctx, operatorContextID, identityclient.ProvisionActorRequest{
		ActorID: input.ActorID, Username: input.Username, PhoneE164: input.PhoneE164, Role: "captain",
	})
}

func (c *Client) ProvisionField(ctx context.Context, operatorContextID string, input ActorInput) (identityclient.ActorView, error) {
	return c.inner.ProvisionActor(ctx, operatorContextID, identityclient.ProvisionActorRequest{
		ActorID: input.ActorID, Username: input.Username, PhoneE164: input.PhoneE164, Role: "field",
	})
}

func (c *Client) IssueCaptainActivation(ctx context.Context, operatorContextID, actorID, idempotencyKey, correlationID string) (identityclient.ActivationChallenge, error) {
	return c.inner.IssueActivation(ctx, operatorContextID, actorID, "captain", idempotencyKey, correlationID)
}

func (c *Client) IssueFieldActivation(ctx context.Context, operatorContextID, actorID, idempotencyKey, correlationID string) (identityclient.ActivationChallenge, error) {
	return c.inner.IssueActivation(ctx, operatorContextID, actorID, "field", idempotencyKey, correlationID)
}
