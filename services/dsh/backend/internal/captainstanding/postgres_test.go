package captainstanding

import (
	"database/sql"
	"go/ast"
	"go/parser"
	"go/token"
	"testing"

	_ "github.com/lib/pq"
)

func TestCaptainStandingPostgresRejectsProtectedOrMalformedOwnerSchemas(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://localhost/no-connect?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := NewPostgresRepository(db, "dsh_test_captain_agent02"); err != nil {
		t.Fatalf("isolated dedicated DSH schema rejected: %v", err)
	}
	for _, unsafe := range []string{"", "public", "dsh", "dsh_test_", "identity_test_agent02", "dsh_test_a;DROP SCHEMA public", "dsh_test_a\"x", "dsh_test_a.b"} {
		if _, err := NewPostgresRepository(db, unsafe); err == nil {
			t.Fatalf("unsafe schema accepted: %q", unsafe)
		}
	}
	if _, err := NewPostgresRepository(nil, "dsh_test_captain_agent02"); err == nil {
		t.Fatal("nil database accepted")
	}
}

// Query text is a fixed owner statement; schema selection belongs to dbscope,
// never to an expression that assembles a SQL statement at the call site.
func TestCaptainStandingRepositoryUsesStaticOwnerSQL(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "postgres.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		method, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		switch method.Sel.Name {
		case "QueryRowContext", "QueryContext", "ExecContext":
			count++
			if len(call.Args) < 2 {
				t.Fatal("missing SQL argument")
			}
			if literal, ok := call.Args[1].(*ast.BasicLit); !ok || literal.Kind != token.STRING {
				t.Errorf("%s must receive fixed SQL text", method.Sel.Name)
			}
		}
		return true
	})
	if count == 0 {
		t.Fatal("no owner SQL calls inspected")
	}
}
