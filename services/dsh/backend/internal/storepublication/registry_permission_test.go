package storepublication

import (
	"reflect"
	"testing"
)

func TestStoreRegistryPermissions(t *testing.T) {
	tests := []struct {
		name  string
		state string
		want  []string
	}{
		{name: "published targets", state: " published ", want: []string{"partners", "marketing", "platform_policies"}},
		{name: "hidden stores", state: "hidden", want: []string{"partners"}},
		{name: "all states", state: "", want: []string{"partners"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := storeRegistryPermissions(test.state); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("storeRegistryPermissions(%q) = %v, want %v", test.state, got, test.want)
			}
		})
	}
}
