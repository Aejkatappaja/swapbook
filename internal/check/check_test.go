package check

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	adapter "github.com/Aejkatappaja/swapbook/adapters/go"
)

// fakeTarget serves a manifest with three variants: one renders, one 500s, one
// returns an empty body.
func fakeTarget() *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc(adapter.MountPath+"/manifest.json", func(w http.ResponseWriter, _ *http.Request) {
		io.WriteString(w, `{"stories":[{"id":"card","name":"Card","variants":[{"name":"ok"},{"name":"boom"},{"name":"blank"}]}]}`)
	})
	mux.HandleFunc(adapter.MountPath+"/preview/card/ok", func(w http.ResponseWriter, _ *http.Request) {
		io.WriteString(w, "<div>ok</div>")
	})
	mux.HandleFunc(adapter.MountPath+"/preview/card/boom", func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "render: boom", http.StatusInternalServerError)
	})
	mux.HandleFunc(adapter.MountPath+"/preview/card/blank", func(w http.ResponseWriter, _ *http.Request) {})
	return httptest.NewServer(mux)
}

func TestRunReportsFailures(t *testing.T) {
	ts := fakeTarget()
	defer ts.Close()

	var out strings.Builder
	failed, err := Run(ts.URL, &out)
	if err != nil {
		t.Fatalf("unexpected setup error: %v", err)
	}
	if failed != 2 {
		t.Errorf("failed = %d, want 2 (boom + blank)", failed)
	}
	report := out.String()
	for _, want := range []string{"ok   Card · ok", "FAIL Card · boom: preview 500", "FAIL Card · blank: empty response", "3 preview(s), 2 failed"} {
		if !strings.Contains(report, want) {
			t.Errorf("report missing %q\n%s", want, report)
		}
	}
}

func TestRunNoAdapter(t *testing.T) {
	// a bare server with nothing mounted under /_swapbook -> manifest 404
	ts := httptest.NewServer(http.NotFoundHandler())
	defer ts.Close()
	if _, err := Run(ts.URL, io.Discard); err == nil {
		t.Fatal("expected an error when no adapter is mounted")
	}
}

func TestRunUnreachable(t *testing.T) {
	if _, err := Run("http://127.0.0.1:1", io.Discard); err == nil {
		t.Fatal("expected an error for an unreachable target")
	}
}
