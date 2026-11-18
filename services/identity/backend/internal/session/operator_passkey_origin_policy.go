package session

import (
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
)

var ErrOperatorPasskeyOrigin = errors.New("Operator WebAuthn origin and RP binding invalid")

// OperatorPasskeyOriginPolicy is a fail-closed precondition for creating the
// canonical Identity owner's real WebAuthn relying-party configuration.
// It grants no role and never issues a challenge or session on its own.
type OperatorPasskeyOriginPolicy struct {
	RPID    string
	Origins []string
}

func operatorPasskeyDNSName(host string) bool {
	if len(host) < 1 || len(host) > 253 || host != strings.ToLower(host) {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, r := range label {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
				continue
			}
			return false
		}
	}
	return true
}

// The RP ID must be a normalized multi-label DNS candidate, and each
// configured origin a canonical HTTPS origin. The WebAuthn implementation
// must independently enforce public-suffix/RP registrability and assertion
// signature; this configuration check alone does not establish trust.
// The only HTTP exception is the exact local FIDO2 test origin in an explicit
// synthetic test environment; no 127.0.0.1/IP or remote HTTP fallback.
func validateOperatorPasskeyOriginPolicy(p OperatorPasskeyOriginPolicy, isolated bool) error {
	if len(p.Origins) == 0 || len(p.Origins) > 8 ||
		p.RPID != strings.ToLower(p.RPID) || p.RPID != strings.TrimSpace(p.RPID) {
		return ErrOperatorPasskeyOrigin
	}
	local := p.RPID == "localhost"
	if local {
		if !isolated {
			return ErrOperatorPasskeyOrigin
		}
	} else if !operatorPasskeyDNSName(p.RPID) ||
		!strings.Contains(p.RPID, ".") || net.ParseIP(p.RPID) != nil {
		return ErrOperatorPasskeyOrigin
	}
	seen := make(map[string]bool, len(p.Origins))
	for _, origin := range p.Origins {
		if origin == "" || origin != strings.ToLower(origin) ||
			origin != strings.TrimSpace(origin) || seen[origin] {
			return ErrOperatorPasskeyOrigin
		}
		u, err := url.Parse(origin)
		if err != nil || u == nil || u.Host == "" || u.User != nil ||
			u.Opaque != "" || u.Path != "" || u.RawPath != "" ||
			u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawFragment != "" {
			return ErrOperatorPasskeyOrigin
		}
		if u.Scheme != "https" && !(isolated && local && u.Scheme == "http") {
			return ErrOperatorPasskeyOrigin
		}
		host := u.Hostname()
		if host == "" || host != strings.ToLower(host) ||
			net.ParseIP(host) != nil || !operatorPasskeyDNSName(host) {
			return ErrOperatorPasskeyOrigin
		}
		if local {
			if host != "localhost" {
				return ErrOperatorPasskeyOrigin
			}
		} else if host != p.RPID && !strings.HasSuffix(host, "."+p.RPID) {
			return ErrOperatorPasskeyOrigin
		}
		port := u.Port()
		if port != "" {
			value, err := strconv.Atoi(port)
			if err != nil || value <= 0 || value > 65535 {
				return ErrOperatorPasskeyOrigin
			}
		}
		// No percent encoding, trailing slash or origin normalization can
		// silently widen the preconfigured relying-party trust boundary.
		if u.String() != origin {
			return ErrOperatorPasskeyOrigin
		}
		seen[origin] = true
	}
	return nil
}
