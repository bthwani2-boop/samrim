package media

import (
	"net"
	"net/url"
	"strings"

	"golang.org/x/net/idna"
)

// IsPublicHTTPSURI applies the public Store media URL restrictions. It rejects
// local hostnames and addresses encoded in the URL without performing DNS.
func IsPublicHTTPSURI(raw string) bool {
	if strings.TrimSpace(raw) != raw || raw == "" {
		return false
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" ||
		parsed.User != nil || parsed.Fragment != "" {
		return false
	}
	host := parsed.Hostname()
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback()
	}
	host, err = idna.Lookup.ToASCII(host)
	if err != nil {
		return false
	}
	host = strings.ToLower(host)
	if strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") ||
		strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".") ||
		strings.Contains(host, "..") {
		return false
	}
	// Browsers normalize hostnames before checking the last label for decimal
	// or hexadecimal IPv4 syntax. Reject those aliases unless net.ParseIP
	// already recognized and classified the literal above.
	dot := strings.LastIndexByte(host, '.')
	if dot <= 0 {
		return false
	}
	lastLabel := host[dot+1:]
	if strings.Trim(lastLabel, "0123456789") == "" {
		return false
	}
	hexLabel, hasHexPrefix := strings.CutPrefix(lastLabel, "0x")
	return !hasHexPrefix || strings.Trim(hexLabel, "0123456789abcdef") != ""
}
