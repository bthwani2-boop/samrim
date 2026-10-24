package media

import (
	"encoding/binary"
	"testing"
)

func marketingTestBox(kind string, payload []byte) []byte {
	b := make([]byte, 8+len(payload))
	binary.BigEndian.PutUint32(b[:4], uint32(len(b)))
	copy(b[4:8], kind)
	copy(b[8:], payload)
	return b
}

func TestValidateMarketingMP4Bytes(t *testing.T) {
	good := append(marketingTestBox("ftyp", []byte("isom0000")), marketingTestBox("moov", []byte("movie information"))...)
	good = append(good, marketingTestBox("mdat", []byte("video bytes"))...)
	if err := ValidateMarketingMP4Bytes(good); err != nil {
		t.Fatal(err)
	}
	cases := map[string][]byte{
		"empty":         nil,
		"image":         []byte("JPEG"),
		"missing movie": append(marketingTestBox("ftyp", []byte("isom0000")), marketingTestBox("mdat", []byte("video bytes"))...),
		"truncated":     good[:len(good)-2],
		"oversized":     make([]byte, MaxUploadBytes+1),
	}
	for name, candidate := range cases {
		t.Run(name, func(t *testing.T) {
			if ValidateMarketingMP4Bytes(candidate) == nil {
				t.Fatal("invalid MP4 accepted")
			}
		})
	}
}
