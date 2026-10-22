package postgres

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

var ErrCheckoutCustomerNoteInvalid = errors.New("checkout customer note invalid")

func NormalizeCustomerOrderNote(note string) (string, error) {
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > 500 {
		return "", ErrCheckoutCustomerNoteInvalid
	}
	for _, r := range note {
		if unicode.IsControl(r) && r != '\n' {
			return "", ErrCheckoutCustomerNoteInvalid
		}
	}
	return note, nil
}
