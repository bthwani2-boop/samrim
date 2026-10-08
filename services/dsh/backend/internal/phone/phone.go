package phone

import (
	"regexp"
	"strings"
	"unicode"
)

var e164Pattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

// NormalizeYemenE164 accepts a Yemeni national number or an international
// number and returns the canonical E.164 representation used by DSH.
func NormalizeYemenE164(raw string) string {
	value := strings.Map(func(r rune) rune {
		switch {
		case r >= '0' && r <= '9', r == '+':
			return r
		case r >= '\u0660' && r <= '\u0669':
			return '0' + (r - '\u0660')
		case r >= '\u06f0' && r <= '\u06f9':
			return '0' + (r - '\u06f0')
		case unicode.IsSpace(r), r == '-', r == '(', r == ')':
			return -1
		default:
			return r
		}
	}, strings.TrimSpace(raw))
	switch {
	case strings.HasPrefix(value, "00"):
		value = "+" + strings.TrimPrefix(value, "00")
	case strings.HasPrefix(value, "967"):
		value = "+" + value
	case len(value) == 10 && strings.HasPrefix(value, "0") && value[1] >= '1' && value[1] <= '9':
		value = "+967" + value[1:]
	case len(value) == 9 && strings.HasPrefix(value, "7"):
		value = "+967" + value
	}
	return value
}

func IsE164(value string) bool {
	return e164Pattern.MatchString(value)
}
