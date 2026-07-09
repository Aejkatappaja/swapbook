// Package adapter lets a Go/templ app expose its components to Swapbook.
//
// An app registers stories (a named component with one or more variants),
// then mounts adapter.Handler on its router. The Swapbook binary reads the
// manifest and renders each variant in an isolated, HTMX-aware preview.
package adapter

import (
	"context"
	"io"
	"strconv"
	"strings"
)

// Renderer is anything that can render its HTML to a writer. templ.Component
// satisfies it out of the box; so do html/template, gomponents, or the HTML
// helper below. This keeps the adapter free of any framework dependency.
type Renderer interface {
	Render(ctx context.Context, w io.Writer) error
}

// HTML is a Renderer for a static HTML string, for fixtures and simple mocks
// without pulling in a templating library.
type HTML string

// Render writes the HTML to w.
func (h HTML) Render(_ context.Context, w io.Writer) error {
	_, err := io.WriteString(w, string(h))
	return err
}

// RenderFunc adapts a plain function to a Renderer.
type RenderFunc func(ctx context.Context, w io.Writer) error

// Render calls f.
func (f RenderFunc) Render(ctx context.Context, w io.Writer) error { return f(ctx, w) }

// Mock is a canned response for a route, served in "mock" mode instead of
// hitting the real app (so previews test interactions with no auth or DB).
type Mock struct {
	Verb      string
	Path      string
	Component Renderer
}

// Control declares one editable arg for a variant, rendered as a knob in the
// Swapbook UI. Type is "text", "number", "bool" or "select".
type Control struct {
	Name    string   `json:"name"`
	Type    string   `json:"type"`
	Default any      `json:"default"`
	Options []string `json:"options,omitempty"` // for "select"
}

// Args holds the live control values passed to a variant builder.
type Args map[string]any

// String returns arg k as a string.
func (a Args) String(k string) string {
	if v, ok := a[k].(string); ok {
		return v
	}
	return ""
}

// Int returns arg k as an int (0 if absent/unparseable).
func (a Args) Int(k string) int {
	switch v := a[k].(type) {
	case int:
		return v
	case float64:
		return int(v)
	case string:
		n, _ := strconv.Atoi(v)
		return n
	}
	return 0
}

// Bool returns arg k as a bool.
func (a Args) Bool(k string) bool {
	switch v := a[k].(type) {
	case bool:
		return v
	case string:
		return parseBool(v)
	}
	return false
}

func parseBool(s string) bool { return s == "true" || s == "1" || s == "on" }

// Variant is one rendered state of a component (e.g. "empty", "with-data").
type Variant struct {
	Name      string
	Component Renderer
	Controls  []Control
	Build     func(Args) Renderer // set for variants with live controls
	Mocks     []Mock
	Docs      string // markdown notes shown in the Swapbook docs tab
}

// Var is a shorthand constructor for a static Variant.
func Var(name string, c Renderer) Variant {
	return Variant{Name: name, Component: c}
}

// VarC builds a Variant with live controls: the UI renders a knob per Control,
// and build is re-invoked with the current Args on every change.
func VarC(name string, controls []Control, build func(Args) Renderer) Variant {
	return Variant{Name: name, Controls: controls, Build: build}
}

// Mock attaches a canned response for route ("VERB /path", e.g.
// "GET /app/rows") to the variant. Chainable. In mock mode Swapbook serves
// this component instead of forwarding the request to the app.
func (v Variant) Mock(route string, c Renderer) Variant {
	verb, path := splitRoute(route)
	v.Mocks = append(v.Mocks, Mock{Verb: verb, Path: path, Component: c})
	return v
}

// Doc attaches documentation (light markdown) shown in Swapbook's docs tab.
// Chainable.
func (v Variant) Doc(md string) Variant {
	v.Docs = md
	return v
}

func splitRoute(route string) (verb, path string) {
	if f := strings.Fields(route); len(f) == 2 {
		return strings.ToUpper(f[0]), f[1]
	}
	return "GET", strings.TrimSpace(route)
}

// Story is a component with its variants, as shown in the Swapbook gallery.
type Story struct {
	ID       string
	Name     string
	Group    string
	Variants []Variant
	Docs     string // component-level markdown, shown on the autodocs page
}

// DocStory attaches component-level documentation (markdown) to a registered
// story, shown at the top of its autodocs page. Chainable.
func (r *Registry) DocStory(name, md string) *Registry {
	id := slug(name)
	for i := range r.stories {
		if r.stories[i].ID == id {
			r.stories[i].Docs = md
			break
		}
	}
	return r
}

// Registry holds every registered story plus adapter-level config.
type Registry struct {
	stories []Story
	// HTMXSrc is the app-relative path to the htmx script the app itself
	// uses (e.g. "/static/htmx.min.js"). Swapbook proxies it so previews run
	// the same htmx as production. Empty falls back to Swapbook's embedded htmx.
	HTMXSrc string
	// CSSSrc is the app-relative path to the app stylesheet (e.g.
	// "/static/app.css"). Swapbook injects it into bare-fragment previews so
	// they render with the real app styles instead of unstyled markup.
	CSSSrc string
	// JSSrc is the app-relative path to the app behavior script (e.g.
	// "/static/app.js"). Swapbook injects it (deferred) into bare-fragment
	// previews so client-side behavior (typeaheads, delegated handlers) works.
	JSSrc string
}

// New creates an empty Registry.
func New() *Registry { return &Registry{} }

// Register adds a story built from a name and its variants. The story ID is
// the slugified name; Group is optional and set via RegisterIn.
func (r *Registry) Register(name string, variants ...Variant) {
	r.RegisterIn("", name, variants...)
}

// RegisterIn is Register with an explicit group for gallery organization.
func (r *Registry) RegisterIn(group, name string, variants ...Variant) {
	r.stories = append(r.stories, Story{
		ID:       slug(name),
		Name:     name,
		Group:    group,
		Variants: variants,
	})
}

func slug(s string) string {
	out := make([]rune, 0, len(s))
	prevDash := false
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			out = append(out, r)
			prevDash = false
		case r >= 'A' && r <= 'Z':
			out = append(out, r+('a'-'A'))
			prevDash = false
		default:
			if !prevDash && len(out) > 0 {
				out = append(out, '-')
				prevDash = true
			}
		}
	}
	for len(out) > 0 && out[len(out)-1] == '-' {
		out = out[:len(out)-1]
	}
	return string(out)
}
