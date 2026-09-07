package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

type statusResponse struct {
	Service string `json:"service"`
	Status  string `json:"status"`
}

func Run(service, prefix, defaultPort string) error {
	return RunWithRoutesAndReadiness(service, prefix, defaultPort, nil, nil)
}

func RunWithRoutes(service, prefix, defaultPort string, register func(*http.ServeMux)) error {
	return RunWithRoutesAndReadiness(service, prefix, defaultPort, register, nil)
}

func RunWithRoutesAndReadiness(service, prefix, defaultPort string, register func(*http.ServeMux), readiness func(context.Context) error) error {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = defaultPort
	}

	mux := http.NewServeMux()
	writeStatus := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(statusResponse{Service: service, Status: "ok"})
	}
	writeReadiness := func(w http.ResponseWriter, r *http.Request) {
		if readiness != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			if err := readiness(ctx); err != nil {
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusServiceUnavailable)
				_ = json.NewEncoder(w).Encode(statusResponse{Service: service, Status: "not_ready"})
				return
			}
		}
		writeStatus(w, r)
	}

	mux.HandleFunc(prefix+"/health", writeStatus)
	mux.HandleFunc(prefix+"/readiness", writeReadiness)
	if register != nil {
		register(mux)
	}

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		log.Printf("%s API listening on %s", service, server.Addr)
		errCh <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
