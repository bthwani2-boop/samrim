package session

import (
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
)

var ErrOperatorPasskeyOrigin = errors.New("Operator WebAuthn origin and RP binding invalid")

const localOperatorOrigin = "http://localhost:13000"

// The configuration is a precondition for WebAuthn, not actor authority.
// The WebAuthn implementation independently verifies credential signatures,
// challenges and the relying party.
type OperatorPasskeyOriginPolicy struct {
	RPID    string
	Origins []string
}

func (p OperatorPasskeyOriginPolicy) AllowsInitialOperatorBootstrap() bool {
	return p.RPID == "localhost" && len(p.Origins) == 1 && p.Origins[0] == localOperatorOrigin
}

func operatorPasskeyDNSName(host string) bool {
	if len(host) == 0 || len(host) > 253 || host != strings.ToLower(host) {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, r := range label {
			if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
				return false
			}
		}
	}
	return true
}

func validOperatorHTTPSOrigin(origin, rpID string) bool {
	if origin == "" || origin != strings.ToLower(origin) || origin != strings.TrimSpace(origin) {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || u == nil || u.Scheme != "https" || u.Host == "" ||
		u.User != nil || u.Opaque != "" || u.Path != "" || u.RawPath != "" ||
		u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawFragment != "" ||
		u.String() != origin {
		return false
	}
	host := u.Hostname()
	if !operatorPasskeyDNSName(host) || net.ParseIP(host) != nil ||
		(host != rpID && !strings.HasSuffix(host, "."+rpID)) {
		return false
	}
	if port := u.Port(); port != "" {
		value, err := strconv.Atoi(port)
		if err != nil || value < 1 || value > 65535 {
			return false
		}
	}
	return true
}

func validateOperatorPasskeyOriginPolicy(p OperatorPasskeyOriginPolicy, isolated bool) error {
	// Local authentication, enrollment and recovery share the same exact
	// browser address. A separate local origin cannot become an implicit RP.
	if p.RPID == "localhost" {
		if isolated && p.AllowsInitialOperatorBootstrap() {
			return nil
		}
		return ErrOperatorPasskeyOrigin
	}
	if len(p.Origins) == 0 || len(p.Origins) > 8 ||
		!operatorPasskeyDNSName(p.RPID) || !strings.Contains(p.RPID, ".") ||
		net.ParseIP(p.RPID) != nil {
		return ErrOperatorPasskeyOrigin
	}
	seen := make(map[string]bool, len(p.Origins))
	for _, origin := range p.Origins {
		if seen[origin] || !validOperatorHTTPSOrigin(origin, p.RPID) {
			return ErrOperatorPasskeyOrigin
		}
		seen[origin] = true
	}
	return nil
}
