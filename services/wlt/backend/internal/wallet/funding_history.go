package wallet

import (
	"encoding/base64"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type fundingTransaction struct {
	FundingID         string    `json:"fundingId"`
	AmountYER         string    `json:"amountYer"`
	PostedAt          time.Time `json:"postedAt"`
	ReversesFundingID *string   `json:"reversesFundingId,omitempty"`
}

type fundingHistory struct {
	ActorID    string               `json:"actorId"`
	Currency   string               `json:"currency"`
	Items      []fundingTransaction `json:"items"`
	HasMore    bool                 `json:"hasMore"`
	NextCursor *string              `json:"nextCursor"`
}

type historyCursor struct {
	postedAt  time.Time
	fundingID string
}

var fundingIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{8,128}$`)

// The cursor is a bounded canonical keyset position, never an actor selector.
// Every query still uses the current verified Identity actor as its first predicate.
func parseHistoryCursor(raw string) (*historyCursor, error) {
	if raw == "" {
		return nil, nil
	}
	query, err := url.ParseQuery(raw)
	if err != nil || len(query) != 1 || len(query["cursor"]) != 1 {
		return nil, errors.New("invalid history query")
	}
	encoded := query.Get("cursor")
	if len(encoded) < 20 || len(encoded) > 240 {
		return nil, errors.New("invalid cursor length")
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil || base64.RawURLEncoding.EncodeToString(decoded) != encoded {
		return nil, errors.New("invalid cursor encoding")
	}
	stamp, id, ok := strings.Cut(string(decoded), "|")
	if !ok || !fundingIDPattern.MatchString(id) || !strings.HasSuffix(stamp, "Z") {
		return nil, errors.New("invalid cursor data")
	}
	posted, err := time.Parse(time.RFC3339Nano, stamp)
	if err != nil || posted.UTC().Format(time.RFC3339Nano) != stamp {
		return nil, errors.New("invalid cursor timestamp")
	}
	return &historyCursor{postedAt: posted, fundingID: id}, nil
}

func makeHistoryCursor(entry fundingTransaction) string {
	text := entry.PostedAt.UTC().Format(time.RFC3339Nano) + "|" + entry.FundingID
	return base64.RawURLEncoding.EncodeToString([]byte(text))
}
