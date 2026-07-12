package adapter

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestManifestAndPreview(t *testing.T) {
	reg := New()
	reg.HTMXSrc = "/static/htmx.min.js"
	reg.RegisterIn("forms", "Sign Up Form",
		Var("empty", HTML("<form>empty</form>")),
		Var("error", HTML("<form>error</form>")),
	)
	srv := httptest.NewServer(reg.Handler())
	defer srv.Close()

	// manifest
	resp, err := http.Get(srv.URL + "/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var m manifest
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		t.Fatal(err)
	}
	if m.HTMXSrc != "/static/htmx.min.js" {
		t.Errorf("htmxSrc = %q", m.HTMXSrc)
	}
	if len(m.Stories) != 1 || m.Stories[0].ID != "sign-up-form" {
		t.Fatalf("stories = %+v", m.Stories)
	}
	if m.Stories[0].Group != "forms" || len(m.Stories[0].Variants) != 2 {
		t.Errorf("story meta = %+v", m.Stories[0])
	}

	// preview
	resp, _ = http.Get(srv.URL + "/preview/sign-up-form/error")
	body := readBody(t, resp)
	if !strings.Contains(body, "<form>error</form>") {
		t.Errorf("preview body = %q", body)
	}

	// unknown variant -> 404
	resp, _ = http.Get(srv.URL + "/preview/sign-up-form/nope")
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown variant status = %d", resp.StatusCode)
	}
}

func TestGlobalMocks(t *testing.T) {
	reg := New()
	reg.Mock("GET /shared", HTML("GLOBAL"))
	reg.Register("Card",
		Var("a", HTML("<div>a</div>")).Mock("POST /save", HTML("SAVED")),
		Var("b", HTML("<div>b</div>")),
	)
	srv := httptest.NewServer(reg.Handler())
	defer srv.Close()

	// variant "a": registry mock first, then the variant's own
	resp, _ := http.Get(srv.URL + "/mocks/card/a")
	var la []MockMeta
	json.NewDecoder(resp.Body).Decode(&la)
	if len(la) != 2 || la[0].Path != "/shared" || la[1].Path != "/save" {
		t.Fatalf("a mocks = %+v", la)
	}
	// variant "b" with no own mocks still inherits the registry mock
	resp, _ = http.Get(srv.URL + "/mocks/card/b")
	var lb []MockMeta
	json.NewDecoder(resp.Body).Decode(&lb)
	if len(lb) != 1 || lb[0].Path != "/shared" {
		t.Fatalf("b mocks = %+v", lb)
	}
	// render the inherited global mock (index 0) on variant b
	if resp, _ = http.Get(srv.URL + "/mock/card/b/0"); readBody(t, resp) != "GLOBAL" {
		t.Errorf("global mock render wrong")
	}
	// render variant a's own mock (index 1, after the global)
	if resp, _ = http.Post(srv.URL+"/mock/card/a/1", "", nil); readBody(t, resp) != "SAVED" {
		t.Errorf("variant mock render wrong")
	}
}

func TestMocks(t *testing.T) {
	reg := New()
	reg.Register("Card",
		Var("empty", HTML("<div>card</div>")).
			Mock("GET /app/rows", HTML("<div>ROW</div>")).
			Mock("POST /app/save", HTML("saved")),
	)
	srv := httptest.NewServer(reg.Handler())
	defer srv.Close()

	// list mocks
	resp, _ := http.Get(srv.URL + "/mocks/card/empty")
	var list []MockMeta
	json.NewDecoder(resp.Body).Decode(&list)
	if len(list) != 2 || list[0].Verb != "GET" || list[0].Path != "/app/rows" || list[0].Index != 0 {
		t.Fatalf("mocks = %+v", list)
	}
	if list[1].Verb != "POST" || list[1].Index != 1 {
		t.Errorf("second mock = %+v", list[1])
	}
	// render mock by index (any method)
	resp, _ = http.Post(srv.URL+"/mock/card/empty/1", "", nil)
	if got := readBody(t, resp); got != "saved" {
		t.Errorf("mock render = %q", got)
	}
	// out-of-range index -> 404
	resp, _ = http.Get(srv.URL + "/mock/card/empty/9")
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("bad index status = %d", resp.StatusCode)
	}
}

// TestMockStatus proves a mock can serve a non-200 status for error-state
// previews, while a plain Mock still defaults to 200.
func TestMockStatus(t *testing.T) {
	reg := New()
	reg.Register("Card",
		Var("empty", HTML("<div>card</div>")).
			Mock("GET /app/rows", HTML("<div>ROW</div>")).
			MockStatus("POST /app/save", 422, HTML("<div>invalid</div>")),
	)
	srv := httptest.NewServer(reg.Handler())
	defer srv.Close()

	// mock with an explicit status serves it, with the body intact
	resp, _ := http.Post(srv.URL+"/mock/card/empty/1", "", nil)
	if resp.StatusCode != 422 {
		t.Errorf("mock status = %d, want 422", resp.StatusCode)
	}
	if got := readBody(t, resp); got != "<div>invalid</div>" {
		t.Errorf("mock body = %q", got)
	}
	// a plain Mock still defaults to 200
	resp, _ = http.Get(srv.URL + "/mock/card/empty/0")
	if resp.StatusCode != http.StatusOK {
		t.Errorf("default mock status = %d, want 200", resp.StatusCode)
	}
}

// TestRendererDecoupled proves the adapter takes any Renderer, not just templ:
// a custom RenderFunc renders through the same pipeline.
func TestRendererDecoupled(t *testing.T) {
	reg := New()
	reg.Register("Custom",
		Var("fn", RenderFunc(func(_ context.Context, w io.Writer) error {
			_, err := io.WriteString(w, "<b>from func</b>")
			return err
		})),
	)
	srv := httptest.NewServer(reg.Handler())
	defer srv.Close()
	resp, _ := http.Get(srv.URL + "/preview/custom/fn")
	if got := readBody(t, resp); got != "<b>from func</b>" {
		t.Errorf("render = %q", got)
	}
}

func TestControls(t *testing.T) {
	reg := New()
	reg.RegisterIn("g", "Greeter",
		VarC("hi", []Control{
			{Name: "who", Type: "text", Default: "world"},
			{Name: "loud", Type: "bool", Default: false},
		}, func(a Args) Renderer {
			s := "hello " + a.String("who")
			if a.Bool("loud") {
				s += "!!!"
			}
			return HTML("<p>" + s + "</p>")
		}),
	)
	srv := httptest.NewServer(reg.Handler())
	defer srv.Close()

	// manifest exposes the control schema
	resp, _ := http.Get(srv.URL + "/manifest.json")
	var m manifest
	json.NewDecoder(resp.Body).Decode(&m)
	vs := m.Stories[0].Variants
	if len(vs) != 1 || len(vs[0].Controls) != 2 || vs[0].Controls[0].Name != "who" {
		t.Fatalf("controls meta = %+v", vs)
	}

	// preview renders with supplied args
	resp, _ = http.Get(srv.URL + "/preview/greeter/hi?who=bob&loud=true")
	if b := readBody(t, resp); b != "<p>hello bob!!!</p>" {
		t.Errorf("render = %q", b)
	}
	// falls back to defaults when args absent
	resp, _ = http.Get(srv.URL + "/preview/greeter/hi")
	if b := readBody(t, resp); b != "<p>hello world</p>" {
		t.Errorf("default render = %q", b)
	}
}

func TestDocs(t *testing.T) {
	reg := New()
	reg.Register("Card", Var("default", HTML("<div>c</div>")).Doc("## Card\nA card."))
	srv := httptest.NewServer(reg.Handler())
	defer srv.Close()
	resp, _ := http.Get(srv.URL + "/manifest.json")
	var m manifest
	json.NewDecoder(resp.Body).Decode(&m)
	if got := m.Stories[0].Variants[0].Docs; got != "## Card\nA card." {
		t.Errorf("docs = %q", got)
	}
}

func TestSlug(t *testing.T) {
	cases := map[string]string{
		"Workout Form": "workout-form",
		"PR Card!!":    "pr-card",
		"  spaced  ":   "spaced",
	}
	for in, want := range cases {
		if got := slug(in); got != want {
			t.Errorf("slug(%q) = %q, want %q", in, got, want)
		}
	}
}

func readBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
