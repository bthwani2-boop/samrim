package runtime

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/storage/postgres"
)

var migrationFileName=regexp.MustCompile(`^([0-9]{3})_[a-z0-9_]+\.sql$`)

func applyMigrations(ctx context.Context,db *sql.DB,directory string)error{
	entries,err:=os.ReadDir(directory);if err!=nil{return fmt.Errorf("read identity migration directory: %w",err)}
	files:=map[int]string{}
	for _,entry:=range entries{
		if entry.IsDir(){continue}
		match:=migrationFileName.FindStringSubmatch(entry.Name());if match==nil{return fmt.Errorf("unexpected identity migration artifact: %s",entry.Name())}
		version,err:=strconv.Atoi(match[1]);if err!=nil||version<1||version>postgres.SchemaVersion{return fmt.Errorf("unsupported identity migration version in %s",entry.Name())}
		if _,exists:=files[version];exists{return fmt.Errorf("duplicate identity migration version %d",version)}
		files[version]=filepath.Join(directory,entry.Name())
	}
	for version:=1;version<=postgres.SchemaVersion;version++{if files[version]==""{return fmt.Errorf("missing identity migration version %d",version)}}
	current,err:=postgres.CurrentSchemaVersion(ctx,db);if err!=nil{return err}
	if current>postgres.SchemaVersion{return fmt.Errorf("database schema v%d is newer than runtime v%d",current,postgres.SchemaVersion)}
	for version:=current+1;version<=postgres.SchemaVersion;version++{
		raw,err:=os.ReadFile(files[version]);if err!=nil{return fmt.Errorf("read identity migration v%d: %w",version,err)}
		if err:=postgres.Migrate(ctx,db,version,string(raw));err!=nil{return err}
	}
	return nil
}
