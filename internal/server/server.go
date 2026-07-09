// Package server implements the Swapbook binary: a transparent reverse proxy
// in front of a target app, with a gallery overlay mounted under /__sb/.
//
// Every request that is not part of the overlay is proxied to the target
// unchanged. Previews therefore share the target's exact URL space, so HTMX
// requests fired from inside a preview iframe (hx-get="/app/...") resolve to
// the target with no CORS and no rewriting.
package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"

	adapter "github.com/Aejkatappaja/swapbook/adapters/go"
)

// Overlay is the reserved path prefix for Swapbook's own routes.
const Overlay = "/__sb"

// Server ties the reverse proxy to the gallery overlay.
type Server struct {
	target *url.URL
	proxy  *httputil.ReverseProxy
	ui     UI
}

// UI supplies the static gallery assets and the injected inspector script.
type UI struct {
	Index     []byte
	Inspector []byte
	Assets    map[string][]byte // path (e.g. "app.js") -> bytes
}

// New builds a Server proxying to raw (":8080", "localhost:8080" or a URL).
func New(raw string, ui UI) (*Server, error) {
	t, err := normalize(raw)
	if err != nil {
		return nil, err
	}
	proxy := httputil.NewSingleHostReverseProxy(t)
	// Stream responses through instead of buffering, so Server-Sent Events
	// (text/event-stream) reach the preview live rather than hanging.
	proxy.FlushInterval = -1
	// This is a local dev workbench that frames the target's pages and injects
	// its inspector into them. Strip the app's framing guards and Content
	// Security Policy from proxied responses: X-Frame-Options / CSP
	// frame-ancestors would block framing, and a strict script-src would block
	// the injected inspector. Only ever runs against a local target you own.
	proxy.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Del("X-Frame-Options")
		resp.Header.Del("Content-Security-Policy")
		resp.Header.Del("Content-Security-Policy-Report-Only")
		return nil
	}
	return &Server{target: t, proxy: proxy, ui: ui}, nil
}

func normalize(raw string) (*url.URL, error) {
	if !strings.Contains(raw, "://") {
		if strings.HasPrefix(raw, ":") {
			raw = "localhost" + raw
		}
		raw = "http://" + raw
	}
	return url.Parse(raw)
}

// Handler returns the root http.Handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(Overlay+"/", s.serveOverlay)
	mux.Handle("/", s.proxy) // everything else -> target
	return mux
}

func (s *Server) serveOverlay(w http.ResponseWriter, r *http.Request) {
	// The workbench UI is a dev tool: never let a browser serve a stale build.
	w.Header().Set("Cache-Control", "no-store")
	path := strings.TrimPrefix(r.URL.Path, Overlay)
	switch {
	case path == "" || path == "/":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(s.ui.Index)
	case path == "/api/manifest":
		s.proxyPass(w, "/manifest.json", "application/json")
	case strings.HasPrefix(path, "/frame/"):
		s.serveFrame(w, r, strings.TrimPrefix(path, "/frame/"))
	case strings.HasPrefix(path, "/mock/"):
		s.serveMock(w, path) // path = /mock/{id}/{variant}/{index}
	default:
		if b, ok := s.ui.Assets[strings.TrimPrefix(path, "/")]; ok {
			w.Header().Set("Content-Type", contentType(path))
			w.Write(b)
			return
		}
		http.NotFound(w, r)
	}
}

// adapterGet fetches an adapter endpoint on the target. sub is the path under
// MountPath, e.g. "/manifest.json" or "/mock/card/empty/0".
func (s *Server) adapterGet(sub string) (*http.Response, error) {
	return http.Get(s.target.String() + adapter.MountPath + sub)
}

// proxyPass fetches an adapter endpoint and streams it back with contentType.
func (s *Server) proxyPass(w http.ResponseWriter, sub, contentType string) {
	resp, err := s.adapterGet(sub)
	if err != nil {
		http.Error(w, "target unreachable: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", contentType)
	// Propagate the upstream status so the UI can tell "app up but no adapter
	// mounted" (404) apart from "target unreachable" (the err path above, 502).
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// serveFrame fetches a preview fragment and wraps it in a full HTML document
// with htmx and the inspector script injected. id is "{story}/{variant}".
func (s *Server) serveFrame(w http.ResponseWriter, r *http.Request, id string) {
	sub := "/preview/" + id
	if args := controlArgs(r.URL.Query()); len(args) > 0 {
		sub += "?" + args.Encode()
	}
	resp, err := s.adapterGet(sub)
	if err != nil {
		http.Error(w, "target unreachable: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	fragment, _ := io.ReadAll(resp.Body)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	// mode drives how the inspector treats htmx requests, passed via window.__SB:
	//   mock (default) - mocked routes served from declared mocks, unmocked
	//                    mutations blocked; full interaction, no auth/DB.
	//   safe           - real requests, mutations blocked.
	//   live           - everything real.
	mode := r.URL.Query().Get("mode")
	switch mode {
	case "safe", "live", "mock":
	default:
		mode = "mock"
	}
	cfg := frameCfg{Mode: mode}
	if mode == "mock" {
		cfg.Mocks = s.fetchMocks(id)
	}
	cfgJSON, _ := json.Marshal(cfg)
	head := []byte("<script>window.__SB=" + string(cfgJSON) + ";</script><script>" + string(s.ui.Inspector) + "</script>")

	// Full-page components (e.g. templ layouts) already ship their own <head>,
	// htmx and CSS. Injecting a second <html>/htmx would nest documents and
	// break rendering, so only inject the config + inspector before </head>.
	if isFullDoc(fragment) {
		w.Write(injectBeforeHead(fragment, head))
		return
	}

	// Bare fragment: wrap in a minimal document and inject htmx, the app CSS
	// (so it renders styled) and the config + inspector.
	htmxSrc := r.URL.Query().Get("htmx")
	if htmxSrc == "" {
		htmxSrc = "/__sb/htmx.min.js" // embedded fallback
	}
	var css, js string
	if cssSrc := r.URL.Query().Get("css"); cssSrc != "" {
		css = fmt.Sprintf(`<link rel="stylesheet" href="%s">`, cssSrc)
	}
	if jsSrc := r.URL.Query().Get("js"); jsSrc != "" {
		js = fmt.Sprintf(`<script src="%s" defer></script>`, jsSrc)
	}
	// canvas background: injected last + !important so it wins over the app's
	// own CSS, letting you preview a fragment on light/dark/checker.
	bgStyle := "<style>html,body{background:" + bgValue(r.URL.Query().Get("bg")) + " !important}</style>"
	fmt.Fprintf(w, `<!doctype html>
<html>
<head>
<meta charset="utf-8">
%s
<script src="%s"></script>
%s
%s
%s
</head>
<body>%s</body>
</html>`, css, htmxSrc, js, head, bgStyle, fragment)
}

// bgValue maps a canvas background name to a CSS background value.
func bgValue(name string) string {
	switch name {
	case "dark":
		return "#14161c"
	case "checker":
		return "repeating-conic-gradient(#c9ccd4 0 25%, #ffffff 0 50%) 50% / 18px 18px"
	default:
		return "#ffffff"
	}
}

// controlArgs strips Swapbook's own frame params, leaving only component
// control args to forward to the preview render.
// controlArgs pulls the "arg."-namespaced control values out of the frame
// query and returns them unprefixed for the preview render. Frame params
// (mode/bg/htmx/…) carry no prefix and are naturally excluded, so there is no
// denylist to keep in sync and a control may safely be named "mode".
func controlArgs(q url.Values) url.Values {
	out := url.Values{}
	for k, v := range q {
		if name, ok := strings.CutPrefix(k, "arg."); ok {
			out[name] = v
		}
	}
	return out
}

// isFullDoc reports whether a preview fragment is already a full HTML document
// (checks only the leading bytes, case-insensitively, to avoid copying it all).
func isFullDoc(fragment []byte) bool {
	head := bytes.TrimSpace(bytes.TrimPrefix(fragment, []byte{0xEF, 0xBB, 0xBF})) // drop UTF-8 BOM
	if len(head) > 16 {
		head = head[:16]
	}
	head = bytes.ToLower(head)
	return bytes.HasPrefix(head, []byte("<!doctype")) || bytes.HasPrefix(head, []byte("<html"))
}

// frameCfg is the window.__SB config injected into every preview frame.
type frameCfg struct {
	Mode  string            `json:"mode"`
	Mocks map[string]string `json:"mocks,omitempty"` // "VERB /path" -> mock overlay URL
}

// fetchMocks asks the adapter which routes a variant mocks, and maps each to
// the Swapbook overlay URL that serves it. id is "{story}/{variant}".
func (s *Server) fetchMocks(id string) map[string]string {
	resp, err := s.adapterGet("/mocks/" + id)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var list []adapter.MockMeta
	if json.NewDecoder(resp.Body).Decode(&list) != nil || len(list) == 0 {
		return nil
	}
	m := make(map[string]string, len(list))
	for _, mk := range list {
		m[mk.Verb+" "+mk.Path] = Overlay + "/mock/" + id + "/" + strconv.Itoa(mk.Index)
	}
	return m
}

// serveMock proxies a mock render from the adapter. sub is the overlay path
// "/mock/{id}/{variant}/{index}", forwarded to the adapter unchanged.
func (s *Server) serveMock(w http.ResponseWriter, sub string) {
	s.proxyPass(w, sub, "text/html; charset=utf-8")
}

// indexFold is a case-insensitive bytes.Index for an ASCII-lowercase needle,
// without allocating a lowercased copy of the haystack.
func indexFold(b []byte, sub string) int {
	for i := 0; i+len(sub) <= len(b); i++ {
		match := true
		for j := 0; j < len(sub); j++ {
			c := b[i+j]
			if c >= 'A' && c <= 'Z' {
				c += 'a' - 'A'
			}
			if c != sub[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

// injectBeforeHead inserts html just before </head> (or at the document start
// if there is no head) without touching the rest of the page.
func injectBeforeHead(doc, html []byte) []byte {
	i := indexFold(doc, "</head>")
	if i < 0 {
		return append(append([]byte{}, html...), doc...)
	}
	out := make([]byte, 0, len(doc)+len(html))
	out = append(out, doc[:i]...)
	out = append(out, html...)
	out = append(out, doc[i:]...)
	return out
}

func contentType(path string) string {
	switch {
	case strings.HasSuffix(path, ".js"):
		return "text/javascript; charset=utf-8"
	case strings.HasSuffix(path, ".css"):
		return "text/css; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}
