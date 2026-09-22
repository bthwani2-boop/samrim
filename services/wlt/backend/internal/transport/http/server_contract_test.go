package http

import (
	"bufio"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func TestRegisteredRoutesMatchOpenAPI(t *testing.T) {
	serverSource, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatal(err)
	}
	openAPI, err := os.Open("../../../../contracts/openapi/wlt.openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer openAPI.Close()

	routePattern := regexp.MustCompile(`mux\.HandleFunc\("([A-Z]+) ([^"]+)"`)
	registered := map[string]struct{}{}
	for _, match := range routePattern.FindAllStringSubmatch(string(serverSource), -1) {
		registered[match[1]+" "+match[2]] = struct{}{}
	}

	declared := map[string]struct{}{}
	scanner := bufio.NewScanner(openAPI)
	currentPath := ""
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "  /") && strings.HasSuffix(strings.TrimSpace(line), ":") {
			currentPath = strings.TrimSuffix(strings.TrimSpace(line), ":")
			continue
		}
		if currentPath == "" || !strings.HasPrefix(line, "    ") {
			continue
		}
		trimmed := strings.TrimSpace(line)
		for _, method := range []string{"get:", "post:", "put:", "patch:", "delete:"} {
			if trimmed == method {
				declared[strings.ToUpper(strings.TrimSuffix(method, ":"))+" "+currentPath] = struct{}{}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}

	var missing, extra []string
	for route := range registered {
		if _, ok := declared[route]; !ok {
			missing = append(missing, route)
		}
	}
	for route := range declared {
		if _, ok := registered[route]; !ok {
			extra = append(extra, route)
		}
	}
	sort.Strings(missing)
	sort.Strings(extra)
	if len(missing) != 0 || len(extra) != 0 {
		t.Fatalf("WLT OpenAPI route drift: missing=%v extra=%v", missing, extra)
	}
}
