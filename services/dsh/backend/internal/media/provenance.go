package media

import (
	"errors"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"
)

var ErrInvalidProvenance = errors.New("media provenance is invalid")

// Provenance records the credited creator, known source, and uploader's
// statement of the rights that permit the platform to display an asset.
type Provenance struct {
	Creator           string
	SourceDescription string
	SourceURI         string
	RightsStatement   string
	RightsURI         string
	RightsAttested    bool
}

func (p Provenance) Normalized() Provenance {
	p.Creator = strings.TrimSpace(p.Creator)
	p.SourceDescription = strings.TrimSpace(p.SourceDescription)
	p.SourceURI = normalizeProvenanceURI(p.SourceURI)
	p.RightsStatement = strings.TrimSpace(p.RightsStatement)
	p.RightsURI = normalizeProvenanceURI(p.RightsURI)
	return p
}

func (p Provenance) Validate() error {
	p = p.Normalized()
	if runeLength(p.Creator) < 2 || runeLength(p.Creator) > 200 ||
		runeLength(p.SourceDescription) < 3 || runeLength(p.SourceDescription) > 1000 ||
		runeLength(p.RightsStatement) < 5 || runeLength(p.RightsStatement) > 2000 || !p.RightsAttested ||
		!validProvenanceURI(p.SourceURI) || !validProvenanceURI(p.RightsURI) {
		return ErrInvalidProvenance
	}
	return nil
}

func runeLength(value string) int {
	if !utf8.ValidString(value) {
		return 0
	}
	return utf8.RuneCountInString(value)
}

func normalizeProvenanceURI(value string) string {
	value = strings.TrimSpace(value)
	parsed, err := url.Parse(value)
	if err == nil && (strings.EqualFold(parsed.Scheme, "http") || strings.EqualFold(parsed.Scheme, "https")) {
		parsed.Scheme = strings.ToLower(parsed.Scheme)
		return parsed.String()
	}
	return value
}

func validProvenanceURI(value string) bool {
	if value == "" {
		return true
	}
	if runeLength(value) > 2048 {
		return false
	}
	for _, char := range value {
		if unicode.IsSpace(char) || unicode.IsControl(char) {
			return false
		}
	}
	parsed, err := url.Parse(value)
	if err != nil || !parsed.IsAbs() || parsed.User != nil || parsed.Hostname() == "" {
		return false
	}
	return strings.EqualFold(parsed.Scheme, "http") || strings.EqualFold(parsed.Scheme, "https")
}
