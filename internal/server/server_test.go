package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	adapter "github.com/Aejkatappaja/swapbook/adapters/go"
)

// fakeTarget stands in for an app running the adapter, plus a normal app route
// that the reverse proxy must pass through.
func fakeTarget() *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc(adapter.MountPath+"/manifest.json", func(w http.ResponseWriter, _ *http.Request) {
		io.WriteString(w, `{"htmxSrc":"/static/htmx.min.js","stories":[]}`)
	})
	mux.HandleFunc(adapter.MountPath+"/preview/card/empty", func(w http.ResponseWriter, _ *http.Request) {
		io.WriteString(w, `<div id="frag">FRAGMENT</div>`)
	})
	mux.HandleFunc("/app/workouts/entry-row", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'self'")
		io.WriteString(w, "ROW")
	})
	// echoes back auth-relevant request headers, to prove injection reaches the target
	mux.HandleFunc("/app/whoami", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, r.Header.Get("Cookie")+"|"+r.Header.Get("X-User"))
	})
	mux.HandleFunc(adapter.MountPath+"/mocks/card/empty", func(w http.ResponseWriter, _ *http.Request) {
		io.WriteString(w, `[{"verb":"GET","path":"/app/rows","index":0}]`)
	})
	mux.HandleFunc(adapter.MountPath+"/mock/card/empty/0", func(w http.ResponseWriter, _ *http.Request) {
		io.WriteString(w, `<div>MOCKROW</div>`)
	})
	// a mock that fails, to prove the overlay propagates a non-200 status
	mux.HandleFunc(adapter.MountPath+"/mock/card/empty/1", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(422)
		io.WriteString(w, `<div>INVALID</div>`)
	})
	return httptest.NewServer(mux)
}

func testUI() UI {
	return UI{
		Index:     []byte("INDEX"),
		Inspector: []byte("/*inspector*/"),
		Assets:    map[string][]byte{"app.js": []byte("APP")},
	}
}

func TestOverlayRoutes(t *testing.T) {
	target := fakeTarget()
	defer target.Close()
	srv, err := New(target.URL, testUI())
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	// UI index
	if got := body(t, ts.URL+Overlay+"/"); got != "INDEX" {
		t.Errorf("index = %q", got)
	}
	// static asset
	if got := body(t, ts.URL+Overlay+"/app.js"); got != "APP" {
		t.Errorf("asset = %q", got)
	}
	// manifest proxied from target
	if got := body(t, ts.URL+Overlay+"/api/manifest"); !strings.Contains(got, `"htmxSrc"`) {
		t.Errorf("manifest = %q", got)
	}
	// frame wraps fragment + injects htmx + inspector
	frame := body(t, ts.URL+Overlay+"/frame/card/empty?htmx=/static/htmx.min.js")
	for _, want := range []string{`<div id="frag">FRAGMENT</div>`, `src="/static/htmx.min.js"`, "/*inspector*/", "<!doctype html>"} {
		if !strings.Contains(frame, want) {
			t.Errorf("frame missing %q\n%s", want, frame)
		}
	}
	// reverse proxy passes non-overlay paths straight to the target
	if got := body(t, ts.URL+"/app/workouts/entry-row"); got != "ROW" {
		t.Errorf("proxy passthrough = %q", got)
	}
}

func TestHeaderInjection(t *testing.T) {
	target := fakeTarget()
	defer target.Close()
	srv, err := New(target.URL, testUI(), "Cookie: session=abc", "X-User: ada", "malformed-no-colon")
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	// injected headers reach the target on a proxied (non-overlay) request
	if got := body(t, ts.URL+"/app/whoami"); got != "session=abc|ada" {
		t.Errorf("injected headers = %q, want %q", got, "session=abc|ada")
	}

	// with no headers configured, nothing is added
	plain, _ := New(target.URL, testUI())
	pts := httptest.NewServer(plain.Handler())
	defer pts.Close()
	if got := body(t, pts.URL+"/app/whoami"); got != "|" {
		t.Errorf("unexpected headers without injection: %q", got)
	}
}

func TestParseHeaders(t *testing.T) {
	got := parseHeaders([]string{"Cookie: a=b", "X-User:  ada ", "no-colon", "  : empty-name", "Authorization: Bearer x:y"})
	want := []header{
		{"Cookie", "a=b"},
		{"X-User", "ada"},
		{"Authorization", "Bearer x:y"}, // only the first colon splits; value keeps the rest
	}
	if len(got) != len(want) {
		t.Fatalf("parseHeaders len = %d, want %d (%+v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("header[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestFramePreservesFullDocument(t *testing.T) {
	page := `<!doctype html><html><head><title>x</title></head><body><form>P</form></body></html>`
	got := injectBeforeHead([]byte(page), []byte("<script>/*INS*/</script>"))
	s := string(got)
	// injected once, right before </head>, page otherwise untouched
	if strings.Count(s, "/*INS*/") != 1 {
		t.Errorf("inject count: %s", s)
	}
	if !strings.Contains(s, "<script>/*INS*/</script></head>") {
		t.Errorf("not injected before </head>: %s", s)
	}
	if strings.Count(s, "<html>") != 1 || strings.Count(s, "<body>") != 1 {
		t.Errorf("document was duplicated: %s", s)
	}
}

func TestFrameModeConfig(t *testing.T) {
	target := fakeTarget()
	defer target.Close()
	srv, _ := New(target.URL, testUI())
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	// default -> mock; explicit safe/live honored
	if got := body(t, ts.URL+Overlay+"/frame/card/empty"); !strings.Contains(got, `"mode":"mock"`) {
		t.Errorf("default not mock: %s", got)
	}
	if got := body(t, ts.URL+Overlay+"/frame/card/empty?mode=safe"); !strings.Contains(got, `"mode":"safe"`) {
		t.Errorf("safe not honored: %s", got)
	}
	if got := body(t, ts.URL+Overlay+"/frame/card/empty?mode=live"); !strings.Contains(got, `"mode":"live"`) {
		t.Errorf("live not honored: %s", got)
	}
}

func TestMockWiring(t *testing.T) {
	target := fakeTarget()
	defer target.Close()
	srv, _ := New(target.URL, testUI())
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	// mock mode injects the route->overlay-URL map into the frame config
	frame := body(t, ts.URL+Overlay+"/frame/card/empty?mode=mock")
	if !strings.Contains(frame, `"GET /app/rows":"/__sb/mock/card/empty/0"`) {
		t.Errorf("mock map not injected: %s", frame)
	}
	// the overlay serves the mock render from the adapter
	if got := body(t, ts.URL+Overlay+"/mock/card/empty/0"); got != "<div>MOCKROW</div>" {
		t.Errorf("mock render = %q", got)
	}
	// a non-200 mock status is propagated so the client sees the real code
	resp, err := http.Get(ts.URL + Overlay + "/mock/card/empty/1")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 422 {
		t.Errorf("mock status = %d, want 422", resp.StatusCode)
	}
	if b, _ := io.ReadAll(resp.Body); string(b) != "<div>INVALID</div>" {
		t.Errorf("failed mock body = %q", b)
	}
}

func TestStripsFramingHeaders(t *testing.T) {
	target := fakeTarget()
	defer target.Close()
	srv, _ := New(target.URL, testUI())
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/app/workouts/entry-row")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if xfo := resp.Header.Get("X-Frame-Options"); xfo != "" {
		t.Errorf("X-Frame-Options not stripped: %q", xfo)
	}
	if csp := resp.Header.Get("Content-Security-Policy"); csp != "" {
		t.Errorf("Content-Security-Policy not stripped: %q", csp)
	}
}

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		":8080":                  "http://localhost:8080",
		"localhost:9000":         "http://localhost:9000",
		"http://example.com:123": "http://example.com:123",
	}
	for in, want := range cases {
		u, err := Normalize(in)
		if err != nil {
			t.Fatal(err)
		}
		if u.String() != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, u.String(), want)
		}
	}
}

func body(t *testing.T, url string) string {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return string(b)
}
