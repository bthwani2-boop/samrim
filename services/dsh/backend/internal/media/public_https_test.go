package media

import "testing"

func TestIndependentPublicMediaMustUsePublicHTTPS(t *testing.T) {
	for _, tc := range []struct {
		uri  string
		safe bool
	}{
		{"https://cdn.bthwani.com/store/a.jpg", true},
		{"", false},
		{"http://cdn.bthwani.com/store/a.jpg", false},
		{"https://localhost/secret.jpg", false},
		{"https://127.0.0.1/secret.jpg", false},
		{"https://10.1.2.3/secret.jpg", false},
		{"https://store.local/secret.jpg", false},
		{"https://store.local./secret.jpg", false},
		{"https://localhost./secret.jpg", false},
		{"https://printer/secret.jpg", false},
		{"https://printer.localhost/secret.jpg", false},
		{"https://127.1/secret.jpg", false},
		{"https://2130706433/secret.jpg", false},
		{"https://0x7f.0x0.0x0.0x1/secret.jpg", false},
		{"https://１２７.０.０.１/secret.jpg", false},
		{"https://127。0。0。1/secret.jpg", false},
		{"https://[::ffff:127.0.0.1]/secret.jpg", false},
		{"https://cdn.bthwani.com./store/a.jpg", false},
		{"https://private:password@cdn.bthwani.com/a.jpg", false},
		{"file:///etc/passwd", false},
		{" https://cdn.bthwani.com/store/a.jpg ", false},
	} {
		if got := IsPublicHTTPSURI(tc.uri); got != tc.safe {
			t.Errorf("IsPublicHTTPSURI(%q)=%v, want %v", tc.uri, got, tc.safe)
		}
	}
}
