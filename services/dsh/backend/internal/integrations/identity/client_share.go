package identity

import "context"

func (c *Client) ResolveClientShareRecipient(ctx context.Context, phoneE164 string) (string, error) {
	return c.inner.ResolveClientShareRecipient(ctx, phoneE164)
}
