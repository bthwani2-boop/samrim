package runtime

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/challenge"
	challengedelivery "github.com/bthwani2-boop/samrim/services/identity/backend/internal/integrations/challenge"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/storage/postgres"
	identityhttp "github.com/bthwani2-boop/samrim/services/identity/backend/internal/transport/http"
	_ "github.com/lib/pq"
)

type config struct {
	port string
	databaseURL string
	autoMigrate bool
	migrationFile string
	challengeSecret []byte
	internalTokens map[string]string
	allowedOrigins map[string]bool
	delivery challengedelivery.Sender
}

func Run(_,_,defaultPort string) error {
	cfg,err:=loadConfig(defaultPort);if err!=nil{return err}
	db,err:=sql.Open("postgres",cfg.databaseURL);if err!=nil{return fmt.Errorf("open identity database: %w",err)};defer func(){_ = db.Close()}()
	db.SetMaxOpenConns(20);db.SetMaxIdleConns(10);db.SetConnMaxLifetime(30*time.Minute)
	if cfg.autoMigrate {
		raw,err:=os.ReadFile(cfg.migrationFile);if err!=nil{return fmt.Errorf("read identity migration: %w",err)}
		ctx,cancel:=context.WithTimeout(context.Background(),30*time.Second);defer cancel()
		if err:=postgres.Migrate(ctx,db,string(raw));err!=nil{return err}
	}
	actors:=actor.New(db);sessions:=session.New(db);challenges:=challenge.New(db,actors,sessions,cfg.challengeSecret,cfg.delivery)
	readiness:=func()error{ctx,cancel:=context.WithTimeout(context.Background(),3*time.Second);defer cancel();return postgres.Ready(ctx,db)}
	handler:=identityhttp.New(actors,challenges,sessions,identityhttp.Config{InternalServiceTokens:cfg.internalTokens,AllowedOrigins:cfg.allowedOrigins,Readiness:readiness})
	server:=&http.Server{Addr:":"+cfg.port,Handler:handler,ReadHeaderTimeout:5*time.Second,ReadTimeout:15*time.Second,WriteTimeout:15*time.Second,IdleTimeout:60*time.Second}
	ctx,stop:=signal.NotifyContext(context.Background(),os.Interrupt,syscall.SIGTERM);defer stop();errCh:=make(chan error,1)
	go func(){log.Printf("identity API listening on %s",server.Addr);errCh<-server.ListenAndServe()}()
	select{case<-ctx.Done():shutdownCtx,cancel:=context.WithTimeout(context.Background(),10*time.Second);defer cancel();return server.Shutdown(shutdownCtx);case err:=<-errCh:if errors.Is(err,http.ErrServerClosed){return nil};return err}
}

func loadConfig(defaultPort string)(config,error){
	port:=env("PORT",defaultPort);databaseURL:=strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"));if databaseURL==""{return config{},errors.New("IDENTITY_DATABASE_URL is required")}
	secret:=[]byte(strings.TrimSpace(os.Getenv("IDENTITY_CHALLENGE_HMAC_SECRET")));if len(secret)<32{return config{},errors.New("IDENTITY_CHALLENGE_HMAC_SECRET must contain at least 32 bytes")}
	tokens:=map[string]string{"dsh":strings.TrimSpace(os.Getenv("IDENTITY_DSH_SERVICE_TOKEN")),"platform-control":strings.TrimSpace(os.Getenv("IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN"))};seen:=map[string]string{}
	for caller,token:=range tokens{if len(token)<24{return config{},fmt.Errorf("identity internal token for %s is not configured strongly enough",caller)};if previous,exists:=seen[token];exists{return config{},fmt.Errorf("identity internal token is shared by %s and %s",previous,caller)};seen[token]=caller}
	delivery,err:=loadDelivery();if err!=nil{return config{},err}
	migrationFile:=strings.TrimSpace(os.Getenv("IDENTITY_MIGRATION_FILE"));if migrationFile==""{migrationFile=filepath.Clean("../database/migrations/001_identity_authentication.sql");if _,err:=os.Stat(migrationFile);err!=nil{migrationFile="/app/migrations/001_identity_authentication.sql"}}
	origins:=map[string]bool{};for _,origin:=range strings.Split(env("IDENTITY_CORS_ALLOWED_ORIGINS","http://localhost:13000"),","){origin=strings.TrimSpace(origin);if origin!=""{origins[origin]=true}}
	if len(origins)==0{return config{},errors.New("IDENTITY_CORS_ALLOWED_ORIGINS is empty")}
	return config{port:port,databaseURL:databaseURL,autoMigrate:strings.EqualFold(strings.TrimSpace(os.Getenv("IDENTITY_AUTO_MIGRATE")),"true"),migrationFile:migrationFile,challengeSecret:secret,internalTokens:tokens,allowedOrigins:origins,delivery:delivery},nil
}

func loadDelivery()(challengedelivery.Sender,error){
	switch strings.ToLower(strings.TrimSpace(os.Getenv("IDENTITY_CHALLENGE_DELIVERY_MODE"))){
	case "mailpit":
		addr:=strings.TrimSpace(os.Getenv("IDENTITY_MAILPIT_SMTP_ADDR"));recipient:=strings.TrimSpace(os.Getenv("IDENTITY_MAILPIT_RECIPIENT"));if addr==""||recipient==""{return nil,errors.New("mailpit challenge delivery is not configured")};return challengedelivery.Mailpit{SMTPAddr:addr,Recipient:recipient},nil
	case "twilio":
		sid:=strings.TrimSpace(os.Getenv("IDENTITY_TWILIO_ACCOUNT_SID"));token:=strings.TrimSpace(os.Getenv("IDENTITY_TWILIO_AUTH_TOKEN"));from:=strings.TrimSpace(os.Getenv("IDENTITY_TWILIO_FROM"));if sid==""||token==""||from==""{return nil,errors.New("twilio challenge delivery is not configured")};return challengedelivery.Twilio{AccountSID:sid,AuthToken:token,From:from},nil
	case "webhook":
		endpoint:=strings.TrimSpace(os.Getenv("IDENTITY_CHALLENGE_WEBHOOK_URL"));token:=strings.TrimSpace(os.Getenv("IDENTITY_CHALLENGE_WEBHOOK_TOKEN"));if !strings.HasPrefix(endpoint,"https://")||len(token)<24{return nil,errors.New("HTTPS challenge webhook is not configured")};return challengedelivery.Webhook{URL:endpoint,Token:token},nil
	default:return nil,errors.New("IDENTITY_CHALLENGE_DELIVERY_MODE must be mailpit, twilio, or webhook")
	}
}

func env(key,fallback string)string{value:=strings.TrimSpace(os.Getenv(key));if value==""{return fallback};return value}
