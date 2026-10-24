package identityclient

import (
	"context"
	"net/url"
	"strings"
)

// ResolveClientShareRecipient returns a private actor identifier for an exact
// client phone. Never expose whether a recipient exists to the sender.
func (c *Client) ResolveClientShareRecipient(ctx context.Context, phoneE164 string) (string, error) {
	var result struct {
		ActorID string `json:"actorId"`
	}
	err := c.do(ctx, "GET", "/internal/client-share-recipient/resolve?phoneE164="+url.QueryEscape(strings.TrimSpace(phoneE164)), "", nil, &result)
	return result.ActorID, err
}
